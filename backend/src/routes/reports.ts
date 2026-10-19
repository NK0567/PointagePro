import { Router } from 'express';
import { prisma } from '../db';
import { ah } from '../lib/async';
import { audit } from '../lib/audit';
import { badRequest } from '../lib/errors';
import { datesBetween, isWorkDate, workDateOf } from '../lib/time';
import { requireAuth, requireRole } from '../middleware';
import { columnsFor, dailyReport, flattenDaily, flattenPeriod, periodReport, toCsv, toPdf, toXlsx, type ReportFilter } from '../services/reports';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireRole('SUPER_ADMIN', 'ADMIN_RH', 'AGENT', 'DIRECTION'));

function filterFrom(q: Record<string, unknown>): ReportFilter {
  return {
    siteId: q.siteId ? Number(q.siteId) : undefined,
    userId: q.userId ? Number(q.userId) : undefined,
    department: typeof q.department === 'string' && q.department ? q.department : undefined,
  };
}

const fr = (d: string) => d.split('-').reverse().join('/');

reportsRouter.get('/daily', ah(async (req, res) => {
  const date = typeof req.query.date === 'string' && isWorkDate(req.query.date) ? req.query.date : workDateOf(new Date());
  res.json({ date, rows: await dailyReport(date, filterFrom(req.query)) });
}));

reportsRouter.get('/period', ah(async (req, res) => {
  const { from, to } = req.query as Record<string, string>;
  if (!isWorkDate(from ?? '') || !isWorkDate(to ?? '') || from > to) throw badRequest('Période invalide');
  if (datesBetween(from, to).length > 93) throw badRequest('Période limitée à 3 mois');
  res.json({ from, to, rows: await periodReport(from, to, filterFrom(req.query)) });
}));

/** GET /api/reports/export?kind=daily|period&format=xlsx|csv|pdf&date=…|from=…&to=… */
reportsRouter.get('/export', ah(async (req, res) => {
  const q = req.query as Record<string, string>;
  const kind = q.kind === 'period' ? 'period' : 'daily';
  const format = ['xlsx', 'csv', 'pdf'].includes(q.format) ? q.format : 'xlsx';
  const filter = filterFrom(q);

  let title: string;
  let fileBase: string;
  let rows: Record<string, unknown>[];
  if (kind === 'daily') {
    const date = isWorkDate(q.date ?? '') ? q.date : workDateOf(new Date());
    rows = flattenDaily(await dailyReport(date, filter));
    title = `État journalier de présence — ${fr(date)}`;
    fileBase = `pointage_${date}`;
  } else {
    if (!isWorkDate(q.from ?? '') || !isWorkDate(q.to ?? '') || q.from > q.to) throw badRequest('Période invalide');
    if (datesBetween(q.from, q.to).length > 93) throw badRequest('Période limitée à 3 mois');
    rows = flattenPeriod(await periodReport(q.from, q.to, filter));
    title = `Synthèse de présence du ${fr(q.from)} au ${fr(q.to)}`;
    fileBase = `synthese_${q.from}_${q.to}`;
  }

  const site = filter.siteId ? await prisma.site.findUnique({ where: { id: filter.siteId } }) : null;
  const subtitle = [site ? `Site : ${site.name}` : 'Tous les sites', filter.department ? `Service : ${filter.department}` : null].filter(Boolean).join(' · ');
  const cols = columnsFor(kind);

  let buf: Buffer;
  let mime: string;
  if (format === 'csv') { buf = toCsv(cols, rows); mime = 'text/csv; charset=utf-8'; }
  else if (format === 'pdf') { buf = await toPdf(title, subtitle, cols, rows); mime = 'application/pdf'; }
  else { buf = await toXlsx(title, cols, rows); mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; }

  await audit(req, 'REPORT_EXPORTED', { entity: 'Report', details: { kind, format, ...q } });
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.${format}"`);
  res.send(buf);
}));
