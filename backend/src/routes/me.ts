import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ah } from '../lib/async';
import { audit, notifyAdmins } from '../lib/audit';
import { badRequest, notFound } from '../lib/errors';
import { distanceMeters } from '../lib/geo';
import { addDays, isHHMM, isWorkDate, localTime, workDateOf, DEFAULT_TZ } from '../lib/time';
import { parse } from '../lib/validate';
import { requireAuth } from '../middleware';
import { allowedNext, loadDay, recordPunch, summarizeDay } from '../services/attendance';
import { carryOverdue, closeDayTasks, createTasksForDay, taskInclude } from '../services/tasks';
import { authenticationOptions, verifyAuthentication } from '../services/webauthn';

export const meRouter = Router();
meRouter.use(requireAuth);

const geoSchema = z.object({ latitude: z.number(), longitude: z.number(), accuracy: z.number().nonnegative() });
const eventType = z.enum(['ARRIVAL', 'BREAK_START', 'BREAK_END', 'DEPARTURE']);

async function me(userId: number) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { site: true } });
}

function serializeDay(day: ReturnType<typeof summarizeDay>, tz: string) {
  return {
    workDate: day.workDate,
    state: day.state,
    arrival: localTime(day.arrival, tz),
    departure: localTime(day.departure, tz),
    breaks: day.breaks.map((b) => ({ start: localTime(b.start, tz), end: localTime(b.end, tz) })),
    workedMin: Math.round(day.workedMin),
    breakMin: Math.round(day.breakMin),
    lateMin: day.lateMin,
    anomalies: day.anomalies,
  };
}

meRouter.get('/today', ah(async (req, res) => {
  const u = await me(req.user!.id);
  const tz = u.site?.timezone ?? DEFAULT_TZ;
  const workDate = workDateOf(new Date(), tz);
  await carryOverdue(u.id, workDate);
  const [events, tasks, unread] = await Promise.all([
    loadDay(u.id, workDate),
    prisma.task.findMany({ where: { assigneeId: u.id, plannedDate: workDate, status: { not: 'CANCELLED' } }, include: taskInclude, orderBy: [{ carryCount: 'desc' }, { id: 'asc' }] }),
    prisma.notification.count({ where: { userId: u.id, read: false } }),
  ]);
  const day = summarizeDay(events, u.site, workDate);
  res.json({
    site: u.site,
    day: serializeDay(day, tz),
    allowed: u.site ? allowedNext(day.state, day.breaks.length, u.site.maxBreaks) : [],
    tasks,
    unread,
  });
}));

/** Vérification indicative de la position (n'enregistre rien) — l'accord définitif est donné au pointage. */
meRouter.post('/geo-check', ah(async (req, res) => {
  const g = parse(geoSchema, req.body);
  const u = await me(req.user!.id);
  if (!u.site) return res.json({ ok: false, reason: 'NO_SITE' });
  const distanceM = Math.round(distanceMeters(g.latitude, g.longitude, u.site.latitude, u.site.longitude));
  const accurate = g.accuracy <= u.site.maxAccuracyM;
  res.json({ ok: accurate && distanceM <= u.site.radiusM, distanceM, accurate, radiusM: u.site.radiusM, maxAccuracyM: u.site.maxAccuracyM, siteName: u.site.name });
}));

meRouter.post('/punch/options', ah(async (req, res) => {
  res.json(await authenticationOptions('punch', req.user!.id));
}));

/**
 * Pointage : exige une nouvelle preuve biométrique (WebAuthn) appartenant au compte connecté
 * ET une position dans la zone du lieu de service. Les deux sont vérifiés côté serveur.
 */
meRouter.post('/punch', ah(async (req, res) => {
  const body = parse(z.object({
    ticket: z.string(),
    response: z.any(),
    type: eventType,
    geo: geoSchema.nullable(),
    tasks: z.array(z.string().max(190)).max(30).optional(),
    doneTaskIds: z.array(z.number().int()).optional(),
  }), req.body);
  await verifyAuthentication('punch', body.ticket, body.response);
  const u = await me(req.user!.id);
  const { event, workDate, site } = await recordPunch({ user: u, type: body.type, source: 'MOBILE', geo: body.geo });
  let tasksResult: unknown = null;
  if (body.type === 'ARRIVAL' && body.tasks?.length) {
    tasksResult = { created: (await createTasksForDay(u.id, u.id, workDate, body.tasks)).length };
  }
  if (body.type === 'DEPARTURE') {
    tasksResult = await closeDayTasks(u.id, workDate, body.doneTaskIds ?? [], site.workDays);
  }
  res.json({ event: { ...event, time: localTime(event.occurredAt, site.timezone) }, tasks: tasksResult });
}));

// --- Tâches de l'employé ------------------------------------------------------
meRouter.get('/tasks', ah(async (req, res) => {
  const u = await me(req.user!.id);
  const today = workDateOf(new Date(), u.site?.timezone ?? DEFAULT_TZ);
  const date = typeof req.query.date === 'string' && isWorkDate(req.query.date) ? req.query.date : today;
  if (date === today) await carryOverdue(u.id, today);
  const tasks = await prisma.task.findMany({ where: { assigneeId: u.id, plannedDate: date }, include: taskInclude, orderBy: { id: 'asc' } });
  res.json({ date, tasks });
}));

meRouter.post('/tasks', ah(async (req, res) => {
  const { title } = parse(z.object({ title: z.string().trim().min(2).max(190) }), req.body);
  const u = await me(req.user!.id);
  const today = workDateOf(new Date(), u.site?.timezone ?? DEFAULT_TZ);
  const [task] = await createTasksForDay(u.id, u.id, today, [title]);
  res.status(201).json(task);
}));

meRouter.patch('/tasks/:id', ah(async (req, res) => {
  const body = parse(z.object({ status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(), comment: z.string().max(1000).optional() }), req.body);
  const t = await prisma.task.findFirst({ where: { id: Number(req.params.id), assigneeId: req.user!.id } });
  if (!t) throw notFound('Tâche introuvable');
  const updated = await prisma.task.update({
    where: { id: t.id },
    data: {
      status: body.status,
      comment: body.comment,
      completedAt: body.status === 'DONE' ? new Date() : body.status ? null : undefined,
      history: {
        create: [
          ...(body.status && body.status !== t.status ? [{ action: 'STATUS', fromValue: t.status, toValue: body.status, actorId: req.user!.id }] : []),
          ...(body.comment ? [{ action: 'COMMENT', comment: body.comment, actorId: req.user!.id }] : []),
        ],
      },
    },
  });
  res.json(updated);
}));

// --- Historique ---------------------------------------------------------------
meRouter.get('/history', ah(async (req, res) => {
  const u = await me(req.user!.id);
  const tz = u.site?.timezone ?? DEFAULT_TZ;
  const today = workDateOf(new Date(), tz);
  const to = typeof req.query.to === 'string' && isWorkDate(req.query.to) ? req.query.to : today;
  const from = typeof req.query.from === 'string' && isWorkDate(req.query.from) ? req.query.from : addDays(to, -13);
  const events = await prisma.attendanceEvent.findMany({ where: { userId: u.id, workDate: { gte: from, lte: to } }, orderBy: { occurredAt: 'asc' } });
  const dates = [...new Set(events.map((e) => e.workDate))].sort().reverse();
  const days = dates.map((d) => serializeDay(summarizeDay(events.filter((e) => e.workDate === d), u.site, d), tz));
  const rejections = await prisma.punchRejection.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 10 });
  res.json({ from, to, days, rejections });
}));

// --- Appareils biométriques ---------------------------------------------------
meRouter.get('/devices', ah(async (req, res) => {
  const devices = await prisma.authenticator.findMany({
    where: { userId: req.user!.id },
    select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true, revoked: true, backedUp: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(devices);
}));

meRouter.post('/devices/:id/revoke', ah(async (req, res) => {
  const d = await prisma.authenticator.findFirst({ where: { id: Number(req.params.id), userId: req.user!.id } });
  if (!d) throw notFound('Appareil introuvable');
  await prisma.authenticator.update({ where: { id: d.id }, data: { revoked: true } });
  await audit(req, 'DEVICE_REVOKED', { entity: 'Authenticator', entityId: d.id, details: { by: 'self' } });
  res.json({ ok: true });
}));

// --- Demandes de correction (pointage oublié) --------------------------------
meRouter.get('/corrections', ah(async (req, res) => {
  res.json(await prisma.correctionRequest.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 }));
}));

meRouter.post('/corrections', ah(async (req, res) => {
  const body = parse(z.object({ workDate: z.string().refine(isWorkDate), type: eventType, requestedTime: z.string().refine(isHHMM, 'format HH:MM'), reason: z.string().trim().min(5).max(1000) }), req.body);
  const u = await me(req.user!.id);
  if (body.workDate > workDateOf(new Date(), u.site?.timezone ?? DEFAULT_TZ)) throw badRequest('Impossible de corriger une date future');
  const c = await prisma.correctionRequest.create({ data: { ...body, userId: u.id } });
  await notifyAdmins('info', 'Demande de correction', `${u.firstName} ${u.lastName} demande une correction pour le ${body.workDate.split('-').reverse().join('/')}.`);
  res.status(201).json(c);
}));

// --- Notifications ------------------------------------------------------------
meRouter.get('/notifications', ah(async (req, res) => {
  res.json(await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 }));
}));

meRouter.post('/notifications/read-all', ah(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, read: false }, data: { read: true } });
  res.json({ ok: true });
}));
