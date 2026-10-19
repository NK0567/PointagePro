import type { Request } from 'express';
import { prisma } from '../db';

export async function audit(
  req: Request | null,
  action: string,
  opts: { entity?: string; entityId?: string | number; details?: unknown; actorId?: number | null } = {},
) {
  await prisma.auditLog.create({
    data: {
      actorId: opts.actorId ?? req?.user?.id ?? null,
      action,
      entity: opts.entity,
      entityId: opts.entityId != null ? String(opts.entityId) : undefined,
      details: (opts.details ?? undefined) as never,
      ip: req?.ip,
    },
  });
}

export async function notify(userId: number, level: 'info' | 'success' | 'warning' | 'danger', title: string, body: string) {
  await prisma.notification.create({ data: { userId, level, title, body } });
}

/** Notifie tous les responsables RH / super-admins actifs */
export async function notifyAdmins(level: 'info' | 'success' | 'warning' | 'danger', title: string, body: string) {
  const admins = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN_RH'] }, status: 'ACTIVE' },
    select: { id: true },
  });
  if (admins.length) await prisma.notification.createMany({ data: admins.map((a) => ({ userId: a.id, level, title, body })) });
}
