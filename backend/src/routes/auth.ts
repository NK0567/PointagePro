import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { ah } from '../lib/async';
import { audit, notifyAdmins } from '../lib/audit';
import { HttpError, badRequest } from '../lib/errors';
import { parse } from '../lib/validate';
import { clearSession, requireAuth, setSession } from '../middleware';
import { authenticationOptions, registrationOptions, verifyAuthentication, verifyRegistration } from '../services/webauthn';

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives, réessayez plus tard' } });
authRouter.use(limiter);

export function publicUser(u: { id: number; matricule: string; firstName: string; lastName: string; email: string | null; role: string; status: string; jobTitle: string; department: string | null; siteId: number | null }) {
  return {
    id: u.id, matricule: u.matricule, firstName: u.firstName, lastName: u.lastName, email: u.email,
    role: u.role, status: u.status, jobTitle: u.jobTitle, department: u.department, siteId: u.siteId,
  };
}

// --- Connexion par empreinte (WebAuthn) -------------------------------------
// Avec un matricule : seules les clés de cet employé sont proposées.
// Sans matricule : connexion « sans identifiant » via une passkey découvrable.
authRouter.post('/webauthn/login/options', ah(async (req, res) => {
  const { matricule } = parse(z.object({ matricule: z.string().trim().optional() }), req.body);
  let userId: number | undefined;
  if (matricule) {
    const u = await prisma.user.findUnique({ where: { matricule: matricule.toUpperCase() } });
    if (!u) throw badRequest('Matricule inconnu', 'UNKNOWN_USER');
    userId = u.id;
  }
  res.json(await authenticationOptions('login', userId));
}));

authRouter.post('/webauthn/login/verify', ah(async (req, res) => {
  const body = parse(z.object({ ticket: z.string(), response: z.any() }), req.body);
  const { user, authenticator } = await verifyAuthentication('login', body.ticket, body.response);
  if (user.status === 'PENDING') throw new HttpError(403, 'Votre compte est en attente de validation par l\'administrateur.', 'PENDING');
  if (user.status !== 'ACTIVE') throw new HttpError(403, 'Compte suspendu. Contactez l\'administrateur.', 'SUSPENDED');
  setSession(res, user.id);
  await audit(req, 'LOGIN_WEBAUTHN', { actorId: user.id, entity: 'Authenticator', entityId: authenticator.id });
  res.json({ user: publicUser(user) });
}));

// --- Connexion des comptes d'administration (mot de passe) ------------------
authRouter.post('/login', ah(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  const fail = () => new HttpError(401, 'Identifiants incorrects', 'AUTH_FAILED');
  if (!u || !u.passwordHash) throw fail();
  if (u.lockedUntil && u.lockedUntil > new Date()) throw new HttpError(423, 'Compte temporairement bloqué après plusieurs échecs. Réessayez dans 15 minutes.', 'LOCKED');
  if (!(await bcrypt.compare(password, u.passwordHash))) {
    const failed = u.failedLogins + 1;
    await prisma.user.update({ where: { id: u.id }, data: { failedLogins: failed >= 5 ? 0 : failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60_000) : null } });
    await audit(req, 'LOGIN_FAILED', { actorId: u.id, details: { email } });
    throw fail();
  }
  if (u.status !== 'ACTIVE') throw new HttpError(403, 'Compte inactif ou suspendu', 'SUSPENDED');
  await prisma.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null } });
  setSession(res, u.id);
  await audit(req, 'LOGIN_PASSWORD', { actorId: u.id });
  res.json({ user: publicUser(u) });
}));

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, ah(async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { site: true } });
  res.json({ user: { ...publicUser(u), site: u.site } });
}));

// --- Enrôlement avec un code d'invitation délivré par les RH ------------------
// Empêche la création libre de comptes (employés fictifs, usurpation d'identité).
async function userFromInvite(code: string) {
  const u = await prisma.user.findUnique({ where: { inviteCode: code.trim().toUpperCase() } });
  if (!u || !u.inviteExpiresAt || u.inviteExpiresAt < new Date()) throw badRequest('Code d\'invitation invalide ou expiré. Demandez un nouveau code à l\'administrateur.', 'BAD_INVITE');
  if (u.status === 'SUSPENDED') throw new HttpError(403, 'Compte suspendu', 'SUSPENDED');
  return u;
}

authRouter.post('/enroll/check', ah(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().min(4) }), req.body);
  const u = await userFromInvite(code);
  const devices = await prisma.authenticator.count({ where: { userId: u.id, revoked: false } });
  const site = u.siteId ? await prisma.site.findUnique({ where: { id: u.siteId } }) : null;
  res.json({
    employee: { matricule: u.matricule, firstName: u.firstName, lastName: u.lastName, jobTitle: u.jobTitle, site: site?.name ?? null, status: u.status },
    devices,
  });
}));

authRouter.post('/enroll/options', ah(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().min(4) }), req.body);
  const u = await userFromInvite(code);
  res.json(await registrationOptions(u));
}));

authRouter.post('/enroll/verify', ah(async (req, res) => {
  const body = parse(z.object({ code: z.string().min(4), ticket: z.string(), response: z.any(), deviceLabel: z.string().max(80).default('Téléphone') }), req.body);
  const u = await userFromInvite(body.code);
  const auth = await verifyRegistration(body.ticket, body.response, body.deviceLabel, u.id);
  // Premier enrôlement : le compte attend la validation des RH.
  // Nouvel appareil d'un compte actif : le code délivré par les RH vaut validation.
  const status = u.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING';
  await prisma.user.update({ where: { id: u.id }, data: { status, inviteCode: null, inviteExpiresAt: null } });
  await audit(req, 'DEVICE_ENROLLED', { actorId: u.id, entity: 'Authenticator', entityId: auth.id, details: { deviceLabel: auth.deviceLabel } });
  if (status === 'PENDING') {
    await notifyAdmins('info', 'Compte à valider', `${u.firstName} ${u.lastName} (${u.matricule}) a enregistré son empreinte et attend votre validation.`);
  }
  res.json({ ok: true, status });
}));
