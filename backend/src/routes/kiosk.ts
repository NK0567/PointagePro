import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { ah } from '../lib/async';
import { audit } from '../lib/audit';
import { HttpError, badRequest, notFound } from '../lib/errors';
import { localTime, workDateOf, DEFAULT_TZ } from '../lib/time';
import { parse } from '../lib/validate';
import { requireAuth, requireRole } from '../middleware';
import { allowedNext, ingestTerminalEvent, loadDay, recordPunch, summarizeDay } from '../services/attendance';
import { carryOverdue, closeDayTasks, createTasksForDay } from '../services/tasks';
import { authenticationOptions, verifyAuthentication } from '../services/webauthn';

// ============================================================ Poste partagé (kiosque)
// Pour les employés sans smartphone : l'agent de pointage ouvre le kiosque sur une tablette
// installée sur le site. L'employé s'identifie par son empreinte (clé de sécurité biométrique
// personnelle) ou, à défaut, par son PIN sous la supervision de l'agent.
export const kioskRouter = Router();
kioskRouter.use(requireAuth, requireRole('SUPER_ADMIN', 'ADMIN_RH', 'AGENT'));

const geoSchema = z.object({ latitude: z.number(), longitude: z.number(), accuracy: z.number().nonnegative() });
const eventType = z.enum(['ARRIVAL', 'BREAK_START', 'BREAK_END', 'DEPARTURE']);

async function findEmployee(matricule: string) {
  const u = await prisma.user.findUnique({ where: { matricule: matricule.trim().toUpperCase() }, include: { site: true } });
  if (!u) throw notFound('Matricule inconnu');
  if (u.status !== 'ACTIVE') throw new HttpError(403, 'Compte non actif : contactez les RH', 'INACTIVE');
  return u;
}

kioskRouter.get('/employee/:matricule', ah(async (req, res) => {
  const u = await findEmployee(req.params.matricule);
  const tz = u.site?.timezone ?? DEFAULT_TZ;
  const workDate = workDateOf(new Date(), tz);
  await carryOverdue(u.id, workDate);
  const day = summarizeDay(await loadDay(u.id, workDate), u.site, workDate);
  const tasks = await prisma.task.findMany({ where: { assigneeId: u.id, plannedDate: workDate, status: { in: ['TODO', 'IN_PROGRESS', 'DONE'] } }, orderBy: { id: 'asc' } });
  const devices = await prisma.authenticator.count({ where: { userId: u.id, revoked: false } });
  res.json({
    employee: { id: u.id, matricule: u.matricule, firstName: u.firstName, lastName: u.lastName, jobTitle: u.jobTitle, site: u.site?.name ?? null, hasPin: !!u.pinHash, devices },
    state: day.state,
    arrival: localTime(day.arrival, tz),
    allowed: u.site ? allowedNext(day.state, day.breaks.length, u.site.maxBreaks) : [],
    tasks,
  });
}));

kioskRouter.post('/options', ah(async (req, res) => {
  const { matricule } = parse(z.object({ matricule: z.string() }), req.body);
  const u = await findEmployee(matricule);
  res.json(await authenticationOptions('punch', u.id));
}));

kioskRouter.post('/punch', rateLimit({ windowMs: 60_000, limit: 30 }), ah(async (req, res) => {
  const b = parse(z.object({
    matricule: z.string(),
    type: eventType,
    geo: geoSchema.nullable(),
    pin: z.string().optional(),
    ticket: z.string().optional(),
    response: z.any().optional(),
    tasks: z.array(z.string().max(190)).max(30).optional(),
    doneTaskIds: z.array(z.number().int()).optional(),
  }), req.body);
  const u = await findEmployee(b.matricule);

  let method: 'webauthn' | 'pin';
  if (b.ticket && b.response) {
    const { user } = await verifyAuthentication('punch', b.ticket, b.response);
    if (user.id !== u.id) throw new HttpError(401, 'Empreinte ne correspondant pas à ce matricule', 'AUTH_FAILED');
    method = 'webauthn';
  } else if (b.pin) {
    if (u.lockedUntil && u.lockedUntil > new Date()) throw new HttpError(423, 'PIN bloqué 15 minutes après plusieurs erreurs', 'LOCKED');
    if (!u.pinHash || !(await bcrypt.compare(b.pin, u.pinHash))) {
      const failed = u.failedLogins + 1;
      await prisma.user.update({ where: { id: u.id }, data: { failedLogins: failed >= 5 ? 0 : failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60_000) : null } });
      await audit(req, 'KIOSK_PIN_FAILED', { entity: 'User', entityId: u.id });
      throw new HttpError(401, 'PIN incorrect', 'AUTH_FAILED');
    }
    await prisma.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null } });
    method = 'pin';
  } else {
    throw badRequest('Authentification requise (empreinte ou PIN)');
  }

  const { event, workDate, site } = await recordPunch({
    user: u, type: b.type, source: 'KIOSK', geo: b.geo, recordedById: req.user!.id,
    reason: method === 'pin' ? 'Kiosque — PIN sous supervision' : 'Kiosque — empreinte',
  });
  let tasks: unknown = null;
  if (b.type === 'ARRIVAL' && b.tasks?.length) tasks = { created: (await createTasksForDay(u.id, u.id, workDate, b.tasks)).length };
  if (b.type === 'DEPARTURE') tasks = await closeDayTasks(u.id, workDate, b.doneTaskIds ?? [], site.workDays);
  res.json({ event: { ...event, time: localTime(event.occurredAt, site.timezone) }, method, tasks });
}));

// ============================================================ Terminal biométrique (API machine)
// Le terminal identifie l'employé par empreinte en local et transmet les événements.
// Idempotent (deviceEventId), tolérant au hors-ligne : les événements tardifs sont marqués « à vérifier ».
export const terminalRouter = Router();
terminalRouter.use(rateLimit({ windowMs: 60_000, limit: 120 }));

terminalRouter.post('/events', ah(async (req, res) => {
  const key = req.header('x-terminal-key') ?? '';
  const m = /^pt_([0-9a-f]{8})_/.exec(key);
  const terminal = m ? await prisma.terminalDevice.findFirst({ where: { keyPrefix: m[1] }, include: { site: true } }) : null;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  if (!terminal || !terminal.active || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(terminal.keyHash))) {
    throw new HttpError(401, 'Terminal non autorisé', 'TERMINAL_AUTH');
  }
  const { events } = parse(z.object({
    events: z.array(z.object({
      deviceEventId: z.string().min(6).max(120),
      matricule: z.string(),
      type: eventType,
      occurredAt: z.string().datetime({ offset: true }),
    })).min(1).max(500),
  }), req.body);

  const results = [];
  for (const e of events) {
    const user = await prisma.user.findUnique({ where: { matricule: e.matricule.toUpperCase() } });
    if (!user || user.status !== 'ACTIVE') { results.push({ deviceEventId: e.deviceEventId, status: 'unknown_employee' }); continue; }
    const occurredAt = new Date(e.occurredAt);
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) { results.push({ deviceEventId: e.deviceEventId, status: 'future_rejected' }); continue; }
    const r = await ingestTerminalEvent({
      terminalId: terminal.id, site: terminal.site, user, type: e.type, occurredAt, deviceEventId: `T${terminal.id}:${e.deviceEventId}`,
    });
    results.push({ deviceEventId: e.deviceEventId, ...r });
  }
  await prisma.terminalDevice.update({ where: { id: terminal.id }, data: { lastSeenAt: new Date() } });
  await audit(null, 'TERMINAL_SYNC', { entity: 'TerminalDevice', entityId: terminal.id, details: { count: events.length } });
  res.json({ results });
}));
