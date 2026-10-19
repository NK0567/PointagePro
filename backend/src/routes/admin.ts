import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { ah } from '../lib/async';
import { audit, notify } from '../lib/audit';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { isHHMM, isWorkDate, localTime, localToUtc, workDateOf, DEFAULT_TZ } from '../lib/time';
import { parse } from '../lib/validate';
import { ADMIN_ROLES, STAFF_ROLES, requireAuth, requireRole } from '../middleware';
import { voidEvent } from '../services/attendance';
import { dailyReport } from '../services/reports';
import { taskInclude } from '../services/tasks';


export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole(...STAFF_ROLES));


const adminOnly = requireRole(...ADMIN_ROLES);

/** Un chef d'équipe ne voit que son équipe ; les autres profils de gestion voient tout. */
function scopeUsers(req: Request): Prisma.UserWhereInput {
  return req.user!.role === 'CHEF' ? { OR: [{ managerId: req.user!.id }, { id: req.user!.id }] } : {};
}

function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
}

// ============================================================ Tableau de bord
adminRouter.get('/dashboard', ah(async (req, res) => {
  const today = workDateOf(new Date(), DEFAULT_TZ);
  const siteId = req.query.siteId ? Number(req.query.siteId) : undefined;
  const rows = await dailyReport(today, { siteId });
  let visible = rows;
  if (req.user!.role === 'CHEF') {
    const team = await prisma.user.findMany({ where: scopeUsers(req), select: { id: true } });
    const ids = new Set(team.map((t) => t.id));
    visible = rows.filter((r) => ids.has(r.userId));
  }
  const count = (s: string[]) => visible.filter((r) => s.includes(r.status)).length;
  const [pendingAccounts, pendingCorrections, rejections] = await Promise.all([
    prisma.user.count({ where: { status: 'PENDING' } }),
    prisma.correctionRequest.count({ where: { status: 'PENDING' } }),
    prisma.punchRejection.findMany({
      where: { createdAt: { gte: localToUtc(today, '00:00') } },
      include: { user: { select: { firstName: true, lastName: true, matricule: true } } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
  ]);
  res.json({
    date: today,
    stats: {
      total: visible.filter((r) => r.status !== 'OFF').length,
      present: visible.filter((r) => r.arrival).length,
      late: visible.filter((r) => r.lateMin > 0).length,
      absent: count(['ABSENT']),
      onBreak: count(['ON_BREAK']),
      notYet: count(['NOT_YET']),
      done: visible.filter((r) => r.departure).length,
    },
    rows: visible,
    pendingAccounts,
    pendingCorrections,
    rejections: rejections.map((r) => ({ ...r, time: localTime(r.createdAt) })),
  });
}));

// ============================================================ Employés
const userBody = z.object({
  matricule: z.string().trim().max(20).optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  jobTitle: z.string().trim().min(1).max(80),
  department: z.string().trim().max(80).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(30).optional().nullable(),
  role: z.enum(['SUPER_ADMIN', 'ADMIN_RH', 'AGENT', 'CHEF', 'EMPLOYE', 'DIRECTION']).default('EMPLOYE'),
  siteId: z.number().int().nullable().optional(),
  managerId: z.number().int().nullable().optional(),
  hiredAt: z.string().optional().nullable(),
  password: z.string().min(8).optional().or(z.literal('')),
  pin: z.string().regex(/^\d{4,6}$/, 'le PIN doit contenir 4 à 6 chiffres').optional().or(z.literal('')),
});

const userSelect = {
  id: true, matricule: true, firstName: true, lastName: true, email: true, phone: true, role: true, status: true,
  jobTitle: true, department: true, siteId: true, managerId: true, hiredAt: true, inviteCode: true, inviteExpiresAt: true,
  createdAt: true, pinHash: true,
  site: { select: { id: true, name: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { authenticators: { where: { revoked: false } } } },
} satisfies Prisma.UserSelect;

const exposeUser = (u: Prisma.UserGetPayload<{ select: typeof userSelect }>) => {
  const { pinHash, ...rest } = u;
  return { ...rest, hasPin: !!pinHash, devices: u._count.authenticators };
};

adminRouter.get('/users', ah(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const where: Prisma.UserWhereInput = {
    AND: [
      scopeUsers(req),
      q ? { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { matricule: { contains: q } }, { jobTitle: { contains: q } }] } : {},
      status ? { status: status as never } : {},
    ],
  };
  const users = await prisma.user.findMany({ where, select: userSelect, orderBy: [{ status: 'asc' }, { lastName: 'asc' }] });
  res.json(users.map(exposeUser));
}));

adminRouter.get('/users/:id', ah(async (req, res) => {
  const u = await prisma.user.findFirst({ where: { AND: [{ id: Number(req.params.id) }, scopeUsers(req)] }, select: userSelect });
  if (!u) throw notFound('Employé introuvable');
  const devices = await prisma.authenticator.findMany({
    where: { userId: u.id }, select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true, revoked: true }, orderBy: { createdAt: 'desc' },
  });
  res.json({ ...exposeUser(u), deviceList: devices });
}));

async function nextMatricule() {
  const last = await prisma.user.findFirst({ where: { matricule: { startsWith: 'EMP-' } }, orderBy: { matricule: 'desc' } });
  const n = last ? Number(last.matricule.slice(4)) + 1 : 1;
  return `EMP-${String(n).padStart(4, '0')}`;
}

function guardRole(req: Request, role: Role) {
  if (role === 'SUPER_ADMIN' && req.user!.role !== 'SUPER_ADMIN') throw forbidden('Seul un super-administrateur peut attribuer ce rôle');
}

adminRouter.post('/users', adminOnly, ah(async (req, res) => {
  const b = parse(userBody, req.body);
  guardRole(req, b.role);
  const isStaffLogin = b.role !== 'EMPLOYE' && !!b.password;
  if (isStaffLogin && !b.email) throw badRequest('Un e-mail est requis pour un compte de gestion avec mot de passe');
  const code = inviteCode();
  const u = await prisma.user.create({
    data: {
      matricule: (b.matricule || (await nextMatricule())).toUpperCase(),
      firstName: b.firstName, lastName: b.lastName, jobTitle: b.jobTitle, department: b.department || null,
      email: b.email ? b.email.toLowerCase() : null, phone: b.phone || null, role: b.role,
      siteId: b.siteId ?? null, managerId: b.managerId ?? null, hiredAt: b.hiredAt ? new Date(b.hiredAt) : null,
      passwordHash: b.password ? await bcrypt.hash(b.password, 11) : null,
      pinHash: b.pin ? await bcrypt.hash(b.pin, 10) : null,
      // Compte de gestion avec mot de passe : actif immédiatement. Employé : invitation + validation.
      status: isStaffLogin ? 'ACTIVE' : 'INVITED',
      inviteCode: code,
      inviteExpiresAt: new Date(Date.now() + 7 * 86400_000),
    },
    select: userSelect,
  });
  await audit(req, 'USER_CREATED', { entity: 'User', entityId: u.id, details: { matricule: u.matricule, role: u.role } });
  res.status(201).json(exposeUser(u));
}));

adminRouter.patch('/users/:id', adminOnly, ah(async (req, res) => {
  const b = parse(userBody.partial(), req.body);
  const id = Number(req.params.id);
  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) throw notFound('Employé introuvable');
  if (b.role) guardRole(req, b.role);
  if (before.role === 'SUPER_ADMIN' && req.user!.role !== 'SUPER_ADMIN') throw forbidden();
  const data: Prisma.UserUncheckedUpdateInput = {
    firstName: b.firstName, lastName: b.lastName, jobTitle: b.jobTitle, department: b.department,
    phone: b.phone, role: b.role, siteId: b.siteId, managerId: b.managerId,
    email: b.email === '' ? null : b.email?.toLowerCase(),
    hiredAt: b.hiredAt ? new Date(b.hiredAt) : undefined,
  };
  if (b.password) data.passwordHash = await bcrypt.hash(b.password, 11);
  if (b.pin) data.pinHash = await bcrypt.hash(b.pin, 10);
  const u = await prisma.user.update({ where: { id }, data, select: userSelect });
  const changed = Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && !['password', 'pin'].includes(k)).map(([k, v]) => [k, { avant: (before as Record<string, unknown>)[k], après: v }]));
  await audit(req, 'USER_UPDATED', { entity: 'User', entityId: id, details: { changed, password: !!b.password, pin: !!b.pin } });
  res.json(exposeUser(u));
}));

adminRouter.post('/users/:id/status', adminOnly, ah(async (req, res) => {
  const { status, reason } = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().max(300).optional() }), req.body);
  const id = Number(req.params.id);
  if (id === req.user!.id) throw badRequest('Vous ne pouvez pas modifier votre propre statut');
  const u = await prisma.user.findUnique({ where: { id }, include: { _count: { select: { authenticators: { where: { revoked: false } } } } } });
  if (!u) throw notFound();
  if (status === 'ACTIVE' && !u.passwordHash && u._count.authenticators === 0) {
    throw badRequest('Ce compte n\'a encore enregistré aucune empreinte : il ne peut pas être activé.');
  }
  await prisma.user.update({ where: { id }, data: { status } });
  await audit(req, status === 'ACTIVE' ? 'USER_ACTIVATED' : 'USER_SUSPENDED', { entity: 'User', entityId: id, details: { reason, previous: u.status } });
  if (status === 'ACTIVE') await notify(id, 'success', 'Compte validé', 'Votre compte a été validé. Vous pouvez désormais pointer avec votre empreinte.');
  res.json({ ok: true });
}));

/** Nouveau code d'invitation : premier enrôlement, ou ajout/remplacement d'un appareil. */
adminRouter.post('/users/:id/invite', adminOnly, ah(async (req, res) => {
  const id = Number(req.params.id);
  const code = inviteCode();
  const u = await prisma.user.update({ where: { id }, data: { inviteCode: code, inviteExpiresAt: new Date(Date.now() + 7 * 86400_000) } });
  await audit(req, 'INVITE_ISSUED', { entity: 'User', entityId: id });
  res.json({ inviteCode: u.inviteCode, inviteExpiresAt: u.inviteExpiresAt });
}));

adminRouter.post('/devices/:id/revoke', adminOnly, ah(async (req, res) => {
  const d = await prisma.authenticator.update({ where: { id: Number(req.params.id) }, data: { revoked: true } });
  await audit(req, 'DEVICE_REVOKED', { entity: 'Authenticator', entityId: d.id, details: { userId: d.userId, by: 'admin' } });
  await notify(d.userId, 'warning', 'Appareil révoqué', `L'appareil « ${d.deviceLabel} » ne peut plus être utilisé pour pointer.`);
  res.json({ ok: true });
}));

// ============================================================ Sites
const siteBody = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(200).optional().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusM: z.number().int().min(20).max(5000),
  maxAccuracyM: z.number().int().min(10).max(500).default(80),
  timezone: z.string().default('Africa/Douala'),
  startTime: z.string().refine(isHHMM, 'format HH:MM'),
  endTime: z.string().refine(isHHMM, 'format HH:MM'),
  lateToleranceMin: z.number().int().min(0).max(120),
  workDays: z.string().regex(/^[1-7](,[1-7])*$/),
  maxBreaks: z.number().int().min(0).max(6),
  active: z.boolean().default(true),
});

adminRouter.get('/sites', ah(async (_req, res) => {
  const sites = await prisma.site.findMany({ include: { _count: { select: { users: true } } }, orderBy: { name: 'asc' } });
  res.json(sites);
}));

adminRouter.post('/sites', adminOnly, ah(async (req, res) => {
  const s = await prisma.site.create({ data: parse(siteBody, req.body) });
  await audit(req, 'SITE_CREATED', { entity: 'Site', entityId: s.id, details: s });
  res.status(201).json(s);
}));

adminRouter.put('/sites/:id', adminOnly, ah(async (req, res) => {
  const id = Number(req.params.id);
  const before = await prisma.site.findUnique({ where: { id } });
  if (!before) throw notFound('Site introuvable');
  const s = await prisma.site.update({ where: { id }, data: parse(siteBody, req.body) });
  await audit(req, 'SITE_UPDATED', { entity: 'Site', entityId: id, details: { avant: before, après: s } });
  res.json(s);
}));

// ============================================================ Pointages
adminRouter.get('/attendance', ah(async (req, res) => {
  const date = typeof req.query.date === 'string' && isWorkDate(req.query.date) ? req.query.date : workDateOf(new Date());
  const userId = req.query.userId ? Number(req.query.userId) : undefined;
  const events = await prisma.attendanceEvent.findMany({
    where: { workDate: date, ...(userId ? { userId } : {}), user: scopeUsers(req) },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, matricule: true } },
      recordedBy: { select: { firstName: true, lastName: true } },
      site: { select: { name: true, timezone: true } },
    },
    orderBy: { occurredAt: 'desc' },
  });
  const rejections = await prisma.punchRejection.findMany({
    where: { createdAt: { gte: localToUtc(date, '00:00'), lt: localToUtc(date, '23:59') }, ...(userId ? { userId } : {}), user: scopeUsers(req) },
    include: { user: { select: { firstName: true, lastName: true, matricule: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    date,
    events: events.map((e) => ({ ...e, time: localTime(e.occurredAt, e.site?.timezone) })),
    rejections: rejections.map((r) => ({ ...r, time: localTime(r.createdAt) })),
  });
}));

adminRouter.post('/attendance/:id/void', adminOnly, ah(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(300) }), req.body);
  res.json(await voidEvent(Number(req.params.id), req.user!.id, reason));
}));

adminRouter.post('/attendance/:id/review', adminOnly, ah(async (req, res) => {
  const ev = await prisma.attendanceEvent.update({ where: { id: Number(req.params.id) }, data: { needsReview: false } });
  await audit(req, 'ATTENDANCE_REVIEWED', { entity: 'AttendanceEvent', entityId: ev.id });
  res.json(ev);
}));

// ============================================================ Corrections
adminRouter.get('/corrections', ah(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'PENDING';
  res.json(await prisma.correctionRequest.findMany({
    where: { ...(status !== 'ALL' ? { status: status as never } : {}), user: scopeUsers(req) },
    include: { user: { select: { id: true, firstName: true, lastName: true, matricule: true } }, reviewer: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  }));
}));

/** Une correction validée crée un événement CORRECTION traçable (jamais une modification silencieuse). */
adminRouter.post('/corrections/:id/review', adminOnly, ah(async (req, res) => {
  const { approve, comment } = parse(z.object({ approve: z.boolean(), comment: z.string().max(500).optional() }), req.body);
  const c = await prisma.correctionRequest.findUnique({ where: { id: Number(req.params.id) }, include: { user: { include: { site: true } } } });
  if (!c) throw notFound();
  if (c.status !== 'PENDING') throw badRequest('Demande déjà traitée');
  if (c.userId === req.user!.id) throw forbidden('Vous ne pouvez pas valider votre propre correction');
  await prisma.correctionRequest.update({ where: { id: c.id }, data: { status: approve ? 'APPROVED' : 'REJECTED', reviewerId: req.user!.id, reviewComment: comment, reviewedAt: new Date() } });
  if (approve) {
    const tz = c.user.site?.timezone ?? DEFAULT_TZ;
    await prisma.attendanceEvent.create({
      data: {
        userId: c.userId, siteId: c.user.siteId, type: c.type, workDate: c.workDate,
        occurredAt: localToUtc(c.workDate, c.requestedTime, tz), source: 'CORRECTION',
        recordedById: req.user!.id, reason: `Correction #${c.id} : ${c.reason}`,
      },
    });
  }
  await audit(req, approve ? 'CORRECTION_APPROVED' : 'CORRECTION_REJECTED', { entity: 'CorrectionRequest', entityId: c.id, details: { comment } });
  await notify(c.userId, approve ? 'success' : 'danger', approve ? 'Correction acceptée' : 'Correction refusée',
    `Votre demande du ${c.workDate.split('-').reverse().join('/')} a été ${approve ? 'acceptée' : 'refusée'}${comment ? ` : ${comment}` : '.'}`);
  res.json({ ok: true });
}));

// ============================================================ Tâches
const taskBody = z.object({
  title: z.string().trim().min(2).max(190),
  description: z.string().max(4000).optional().nullable(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  assigneeId: z.number().int(),
  plannedDate: z.string().refine(isWorkDate),
  dueDate: z.string().refine(isWorkDate).optional().nullable(),
});

const canManageTasks = requireRole('SUPER_ADMIN', 'ADMIN_RH', 'CHEF');

adminRouter.get('/tasks', ah(async (req, res) => {
  const date = typeof req.query.date === 'string' && isWorkDate(req.query.date) ? req.query.date : workDateOf(new Date());
  const tasks = await prisma.task.findMany({
    where: { plannedDate: date, assignee: scopeUsers(req), ...(req.query.userId ? { assigneeId: Number(req.query.userId) } : {}) },
    include: taskInclude,
    orderBy: [{ assignee: { lastName: 'asc' } }, { id: 'asc' }],
  });
  res.json({ date, tasks });
}));

adminRouter.get('/tasks/:id/history', ah(async (req, res) => {
  res.json(await prisma.taskHistory.findMany({ where: { taskId: Number(req.params.id) }, orderBy: { createdAt: 'asc' } }));
}));

adminRouter.post('/tasks', canManageTasks, ah(async (req, res) => {
  const b = parse(taskBody, req.body);
  const assignee = await prisma.user.findFirst({ where: { AND: [{ id: b.assigneeId }, scopeUsers(req)] } });
  if (!assignee) throw forbidden('Employé hors de votre périmètre');
  const t = await prisma.task.create({
    data: { ...b, originalDate: b.plannedDate, createdById: req.user!.id, history: { create: { action: 'CREATED', toValue: b.plannedDate, actorId: req.user!.id } } },
    include: taskInclude,
  });
  await notify(b.assigneeId, 'info', 'Nouvelle tâche', `« ${t.title} » vous a été assignée pour le ${b.plannedDate.split('-').reverse().join('/')}.`);
  res.status(201).json(t);
}));

adminRouter.patch('/tasks/:id', canManageTasks, ah(async (req, res) => {
  const b = parse(taskBody.partial().extend({ status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(), comment: z.string().max(1000).optional() }), req.body);
  const t = await prisma.task.findFirst({ where: { id: Number(req.params.id), assignee: scopeUsers(req) } });
  if (!t) throw notFound('Tâche introuvable');
  const history: Prisma.TaskHistoryCreateWithoutTaskInput[] = [];
  if (b.status && b.status !== t.status) history.push({ action: 'STATUS', fromValue: t.status, toValue: b.status, actorId: req.user!.id, comment: b.comment });
  if (b.assigneeId && b.assigneeId !== t.assigneeId) history.push({ action: 'REASSIGNED', fromValue: String(t.assigneeId), toValue: String(b.assigneeId), actorId: req.user!.id, comment: b.comment });
  if (b.plannedDate && b.plannedDate !== t.plannedDate) history.push({ action: 'RESCHEDULED', fromValue: t.plannedDate, toValue: b.plannedDate, actorId: req.user!.id, comment: b.comment });
  const { comment, ...rest } = b;
  const updated = await prisma.task.update({
    where: { id: t.id },
    data: { ...rest, completedAt: b.status === 'DONE' ? new Date() : b.status ? null : undefined, history: { create: history } },
    include: taskInclude,
  });
  if (b.assigneeId && b.assigneeId !== t.assigneeId) await notify(b.assigneeId, 'info', 'Tâche réaffectée', `« ${t.title} » vous a été réaffectée.`);
  res.json(updated);
}));

// ============================================================ Journal d'audit
adminRouter.get('/audit', adminOnly, ah(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * 50, take: 50 }),
    prisma.auditLog.count(),
  ]);
  const actorIds = [...new Set(items.map((i) => i.actorId).filter((x): x is number => !!x))];
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true, matricule: true } });
  res.json({ page, total, items: items.map((i) => ({ ...i, actor: actors.find((a) => a.id === i.actorId) ?? null })) });
}));

// ============================================================ Terminaux biométriques
adminRouter.get('/terminals', adminOnly, ah(async (_req, res) => {
  res.json(await prisma.terminalDevice.findMany({ include: { site: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }));
}));

adminRouter.post('/terminals', adminOnly, ah(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(80), siteId: z.number().int() }), req.body);
  const secret = crypto.randomBytes(24).toString('base64url');
  const keyPrefix = crypto.randomBytes(4).toString('hex');
  const key = `pt_${keyPrefix}_${secret}`;
  const t = await prisma.terminalDevice.create({ data: { ...b, keyPrefix, keyHash: crypto.createHash('sha256').update(key).digest('hex') } });
  await audit(req, 'TERMINAL_CREATED', { entity: 'TerminalDevice', entityId: t.id });
  // La clé n'est affichée qu'une seule fois.
  res.status(201).json({ ...t, apiKey: key });
}));

adminRouter.post('/terminals/:id/toggle', adminOnly, ah(async (req, res) => {
  const t = await prisma.terminalDevice.findUniqueOrThrow({ where: { id: Number(req.params.id) } });
  const u = await prisma.terminalDevice.update({ where: { id: t.id }, data: { active: !t.active } });
  await audit(req, u.active ? 'TERMINAL_ENABLED' : 'TERMINAL_DISABLED', { entity: 'TerminalDevice', entityId: t.id });
  res.json(u);
}));


