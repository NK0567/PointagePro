import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import crypto from 'node:crypto';
import type { Authenticator, User } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import { HttpError, badRequest } from '../lib/errors';

/**
 * Défis WebAuthn en mémoire (durée de vie 5 min, usage unique).
 * Suffisant pour une instance unique ; en multi-instance, les déplacer dans Redis ou MySQL.
 */
type Pending = { challenge: string; userId?: number; purpose: string; expires: number };
const pending = new Map<string, Pending>();

function keep(p: Omit<Pending, 'expires'>): string {
  const id = crypto.randomUUID();
  pending.set(id, { ...p, expires: Date.now() + 5 * 60_000 });
  for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
  return id;
}

function take(id: string | undefined, purpose: string): Pending {
  const p = id ? pending.get(id) : undefined;
  if (id) pending.delete(id);
  if (!p || p.purpose !== purpose || p.expires < Date.now()) {
    throw badRequest('Demande expirée, veuillez recommencer', 'CHALLENGE_EXPIRED');
  }
  return p;
}

const transportsOf = (a: Pick<Authenticator, 'transports'>) =>
  (a.transports ? a.transports.split(',') : undefined) as AuthenticatorTransportFuture[] | undefined;

export async function registrationOptions(user: User) {
  const existing = await prisma.authenticator.findMany({ where: { userId: user.id, revoked: false } });
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userName: user.matricule,
    userDisplayName: `${user.firstName} ${user.lastName}`,
    userID: new TextEncoder().encode(`pp-user-${user.id}`),
    attestationType: 'none',
    excludeCredentials: existing.map((a) => ({ id: a.credentialId, transports: transportsOf(a) })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  const ticket = keep({ challenge: options.challenge, userId: user.id, purpose: 'register' });
  return { ticket, options };
}

export async function verifyRegistration(ticket: string, response: RegistrationResponseJSON, deviceLabel: string, expectedUserId: number) {
  const p = take(ticket, 'register');
  if (p.userId !== expectedUserId) throw badRequest('Demande invalide pour ce compte', 'CHALLENGE_EXPIRED');
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: p.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserVerification: true,
    });
  } catch (e) {
    throw badRequest(`Enregistrement biométrique refusé : ${(e as Error).message}`, 'WEBAUTHN');
  }
  if (!verification.verified || !verification.registrationInfo) throw badRequest('Enregistrement biométrique refusé', 'WEBAUTHN');
  const { credential, credentialBackedUp } = verification.registrationInfo;
  return prisma.authenticator.create({
    data: {
      userId: expectedUserId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: credential.transports?.join(',') ?? response.response.transports?.join(','),
      deviceLabel: deviceLabel.slice(0, 80) || 'Appareil',
      backedUp: credentialBackedUp,
    },
  });
}

/** Options d'authentification ; si userId est fourni, seules ses clés sont acceptées. */
export async function authenticationOptions(purpose: 'login' | 'punch', userId?: number) {
  let allow: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;
  if (userId) {
    const auths = await prisma.authenticator.findMany({ where: { userId, revoked: false } });
    if (!auths.length) throw badRequest('Aucun appareil biométrique enregistré pour ce compte', 'NO_AUTHENTICATOR');
    allow = auths.map((a) => ({ id: a.credentialId, transports: transportsOf(a) }));
  }
  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    allowCredentials: allow,
    userVerification: 'required',
  });
  const ticket = keep({ challenge: options.challenge, userId, purpose });
  return { ticket, options };
}

/** Vérifie la preuve WebAuthn et retourne l'utilisateur authentifié. */
export async function verifyAuthentication(purpose: 'login' | 'punch', ticket: string, response: AuthenticationResponseJSON) {
  const p = take(ticket, purpose);
  const auth = await prisma.authenticator.findUnique({ where: { credentialId: response.id }, include: { user: true } });
  if (!auth || auth.revoked) throw new HttpError(401, 'Empreinte non reconnue sur ce compte', 'AUTH_FAILED');
  if (p.userId && auth.userId !== p.userId) throw new HttpError(401, 'Cette empreinte appartient à un autre compte', 'AUTH_FAILED');
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: p.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserVerification: true,
      credential: {
        id: auth.credentialId,
        publicKey: new Uint8Array(auth.publicKey),
        counter: Number(auth.counter),
        transports: transportsOf(auth),
      },
    });
  } catch (e) {
    throw new HttpError(401, `Authentification biométrique refusée : ${(e as Error).message}`, 'AUTH_FAILED');
  }
  if (!verification.verified) throw new HttpError(401, 'Authentification biométrique refusée', 'AUTH_FAILED');
  await prisma.authenticator.update({
    where: { id: auth.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });
  return { user: auth.user, authenticator: auth };
}
