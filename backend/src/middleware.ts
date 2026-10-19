import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { config } from './config';
import { prisma } from './db';
import { HttpError, forbidden } from './lib/errors';

export const COOKIE = 'pp_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: number; role: Role; siteId: number | null; firstName: string; lastName: string };
    }
  }
}

export const ADMIN_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN_RH'];
export const STAFF_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN_RH', 'AGENT', 'CHEF', 'DIRECTION'];

export function setSession(res: Response, userId: number) {
  const token = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: `${config.sessionHours}h` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProd,
    maxAge: config.sessionHours * 3600 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE, { path: '/' });
}

/** Recharge l'utilisateur à chaque requête : une suspension prend effet immédiatement. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) throw new HttpError(401, 'Session expirée, veuillez vous reconnecter', 'UNAUTHENTICATED');
    let payload: { sub: number };
    try {
      payload = jwt.verify(token, config.jwtSecret) as unknown as { sub: number };
    } catch {
      throw new HttpError(401, 'Session expirée, veuillez vous reconnecter', 'UNAUTHENTICATED');
    }
    const u = await prisma.user.findUnique({ where: { id: Number(payload.sub) } });
    if (!u || u.status !== 'ACTIVE') throw new HttpError(401, 'Compte inactif ou suspendu', 'UNAUTHENTICATED');
    req.user = { id: u.id, role: u.role, siteId: u.siteId, firstName: u.firstName, lastName: u.lastName };
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
    next();
  };
