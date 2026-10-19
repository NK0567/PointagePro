import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { prisma } from '../db';
import { datesBetween, isoWeekday, localTime, localToUtc, minutesToHHMM, workDateOf, DEFAULT_TZ } from '../lib/time';
import { summarizeDay } from './attendance';

export interface ReportFilter {
  siteId?: number;
  userId?: number;
  department?: string;
}

export type DayStatus = 'PRESENT' | 'LATE' | 'ON_BREAK' | 'DONE' | 'ABSENT' | 'NOT_YET' | 'OFF';

export const STATUS_LABELS: Record<DayStatus, string> = {
  PRESENT: 'Présent',
  LATE: 'En retard',
  ON_BREAK: 'En pause',
  DONE: 'Journée terminée',
  ABSENT: 'Absent',
  NOT_YET: 'Pas encore arrivé',
  OFF: 'Repos',
};

export interface DailyRow {
  userId: number;
  matricule: string;
  name: string;
  jobTitle: string;
  department: string | null;
  site: string | null;
  status: DayStatus;
  arrival: string;
  breakStart: string;
  breakEnd: string;
  departure: string;
  breakMin: number;
  workedMin: number;
  lateMin: number;
  tasksDone: number;
  tasksTotal: number;
  anomalies: string[];
}

function employeeWhere(f: ReportFilter): Prisma.UserWhereInput {
  return {
    status: 'ACTIVE',
    role: { not: 'SUPER_ADMIN' },
    siteId: f.siteId ?? { not: null },
    ...(f.userId ? { id: f.userId } : {}),
    ...(f.department ? { department: f.department } : {}),
  };
}

export async function dailyReport(workDate: string, f: ReportFilter = {}): Promise<DailyRow[]> {
  const users = await prisma.user.findMany({ where: employeeWhere(f), include: { site: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
  const ids = users.map((u) => u.id);
  const [events, tasks] = await Promise.all([
    prisma.attendanceEvent.findMany({ where: { userId: { in: ids }, workDate } }),
    prisma.task.findMany({
      where: {
        assigneeId: { in: ids },
        OR: [{ plannedDate: workDate }, { status: 'DONE', completedAt: { gte: localToUtc(workDate, '00:00'), lt: localToUtc(workDate, '23:59') } }],
      },
      select: { assigneeId: true, status: true, plannedDate: true },
    }),
  ]);
  // Tâches reportées depuis ce jour : comptent dans le total du jour d'origine
  const carriedFrom = await prisma.taskHistory.findMany({
    where: { action: 'CARRIED', fromValue: workDate, task: { assigneeId: { in: ids } } },
    select: { task: { select: { assigneeId: true } } },
  });

  const now = new Date();
  return users.map((u) => {
    const site = u.site;
    const tz = site?.timezone ?? DEFAULT_TZ;
    const day = summarizeDay(events.filter((e) => e.userId === u.id), site, workDate, now);
    const workDays = new Set((site?.workDays ?? '1,2,3,4,5').split(',').map(Number));
    const isWorkDay = workDays.has(isoWeekday(workDate));
    const today = workDateOf(now, tz);

    let status: DayStatus;
    if (day.state === 'NOT_STARTED') {
      if (!isWorkDay) status = 'OFF';
      else if (workDate > today) status = 'NOT_YET';
      else if (workDate === today && site && now.getTime() < localToUtc(workDate, site.startTime, tz).getTime() + site.lateToleranceMin * 60000) status = 'NOT_YET';
      else status = 'ABSENT';
    } else if (day.state === 'ON_BREAK') status = 'ON_BREAK';
    else if (day.state === 'DONE') status = day.lateMin > 0 ? 'LATE' : 'DONE';
    else status = day.lateMin > 0 ? 'LATE' : 'PRESENT';

    const own = tasks.filter((t) => t.assigneeId === u.id);
    const doneToday = own.filter((t) => t.status === 'DONE').length;
    const openToday = own.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED' && t.plannedDate === workDate).length;
    const carried = carriedFrom.filter((c) => c.task.assigneeId === u.id).length;
    const anomalies = [...day.anomalies];
    if (day.lateMin > 0) anomalies.unshift(`Retard ${minutesToHHMM(day.lateMin)}`);

    return {
      userId: u.id,
      matricule: u.matricule,
      name: `${u.lastName} ${u.firstName}`,
      jobTitle: u.jobTitle,
      department: u.department,
      site: site?.name ?? null,
      status,
      arrival: localTime(day.arrival, tz),
      breakStart: localTime(day.breaks[0]?.start, tz),
      breakEnd: localTime(day.breaks[0]?.end, tz),
      departure: localTime(day.departure, tz),
      breakMin: Math.round(day.breakMin),
      workedMin: Math.round(day.workedMin),
      lateMin: day.lateMin,
      tasksDone: doneToday,
      tasksTotal: doneToday + openToday + carried,
      anomalies,
    };
  });
}

export interface PeriodRow {
  matricule: string;
  name: string;
  jobTitle: string;
  site: string | null;
  workDays: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  lateMin: number;
  workedMin: number;
  anomalies: number;
  tasksDone: number;
}

export async function periodReport(from: string, to: string, f: ReportFilter = {}): Promise<PeriodRow[]> {
  const dates = datesBetween(from, to);
  const acc = new Map<number, PeriodRow>();
  for (const d of dates) {
    const rows = await dailyReport(d, f);
    for (const r of rows) {
      const p = acc.get(r.userId) ?? {
        matricule: r.matricule, name: r.name, jobTitle: r.jobTitle, site: r.site,
        workDays: 0, presentDays: 0, absentDays: 0, lateDays: 0, lateMin: 0, workedMin: 0, anomalies: 0, tasksDone: 0,
      };
      if (r.status !== 'OFF' && r.status !== 'NOT_YET') p.workDays++;
      if (r.arrival) p.presentDays++;
      if (r.status === 'ABSENT') p.absentDays++;
      if (r.lateMin > 0) { p.lateDays++; p.lateMin += r.lateMin; }
      p.workedMin += r.workedMin;
      p.anomalies += r.anomalies.filter((a) => !a.startsWith('Retard')).length;
      p.tasksDone += r.tasksDone;
      acc.set(r.userId, p);
    }
  }
  return [...acc.values()];
}

// ---------------------------------------------------------------- Exports

type Col = { header: string; key: string; width: number };

const DAILY_COLS: Col[] = [
  { header: 'Matricule', key: 'matricule', width: 11 },
  { header: 'Nom', key: 'name', width: 24 },
  { header: 'Fonction', key: 'jobTitle', width: 18 },
  { header: 'Statut', key: 'statusLabel', width: 15 },
  { header: 'Arrivée', key: 'arrival', width: 9 },
  { header: 'Pause', key: 'breakStart', width: 9 },
  { header: 'Retour', key: 'breakEnd', width: 9 },
  { header: 'Fin', key: 'departure', width: 9 },
  { header: 'Temps travaillé', key: 'worked', width: 13 },
  { header: 'Tâches', key: 'tasks', width: 9 },
  { header: 'Anomalies', key: 'anomaliesText', width: 34 },
];

const PERIOD_COLS: Col[] = [
  { header: 'Matricule', key: 'matricule', width: 11 },
  { header: 'Nom', key: 'name', width: 24 },
  { header: 'Fonction', key: 'jobTitle', width: 18 },
  { header: 'Jours ouvrés', key: 'workDays', width: 11 },
  { header: 'Présences', key: 'presentDays', width: 10 },
  { header: 'Absences', key: 'absentDays', width: 10 },
  { header: 'Retards', key: 'lateDays', width: 9 },
  { header: 'Cumul retards', key: 'late', width: 12 },
  { header: 'Heures travaillées', key: 'worked', width: 15 },
  { header: 'Anomalies', key: 'anomalies', width: 10 },
  { header: 'Tâches faites', key: 'tasksDone', width: 12 },
];

export const flattenDaily = (rows: DailyRow[]) =>
  rows.map((r) => ({
    ...r,
    statusLabel: STATUS_LABELS[r.status],
    worked: r.workedMin ? minutesToHHMM(r.workedMin) : '',
    tasks: r.tasksTotal ? `${r.tasksDone}/${r.tasksTotal}` : '',
    anomaliesText: r.anomalies.join(' ; '),
  }));

export const flattenPeriod = (rows: PeriodRow[]) =>
  rows.map((r) => ({ ...r, late: minutesToHHMM(r.lateMin), worked: minutesToHHMM(r.workedMin) }));

export function columnsFor(kind: 'daily' | 'period') {
  return kind === 'daily' ? DAILY_COLS : PERIOD_COLS;
}

export function toCsv(cols: Col[], rows: Record<string, unknown>[]): Buffer {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => esc(c.header)).join(';'), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(';'))];
  // BOM UTF-8 + séparateur « ; » : ouverture directe dans Excel en français
  return Buffer.from('﻿' + lines.join('\r\n'), 'utf8');
}

export async function toXlsx(title: string, cols: Col[], rows: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PointagePro';
  const ws = wb.addWorksheet('Rapport');
  ws.addRow([title]).font = { bold: true, size: 14 };
  ws.addRow([`Généré le ${new Date().toLocaleString('fr-FR', { timeZone: DEFAULT_TZ })}`]).font = { italic: true, color: { argb: 'FF64748B' } };
  ws.addRow([]);
  const header = ws.addRow(cols.map((c) => c.header));
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    cell.alignment = { vertical: 'middle' };
  });
  for (const r of rows) ws.addRow(cols.map((c) => r[c.key] ?? ''));
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(title: string, subtitle: string, cols: Col[], rows: Record<string, unknown>[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width - 60;
    const total = cols.reduce((s, c) => s + c.width, 0);
    const widths = cols.map((c) => (c.width / total) * pageW);

    doc.fillColor('#1d4ed8').fontSize(18).font('Helvetica-Bold').text('PointagePro');
    doc.fillColor('#0f172a').fontSize(13).text(title);
    doc.fillColor('#64748b').fontSize(9).font('Helvetica').text(subtitle);
    doc.moveDown(0.6);

    const drawRow = (values: string[], y: number, headerRow: boolean) => {
      let x = 30;
      const h = 18;
      if (headerRow) doc.rect(30, y, pageW, h).fill('#1d4ed8');
      doc.fillColor(headerRow ? '#ffffff' : '#0f172a').font(headerRow ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      values.forEach((v, i) => {
        doc.text(v, x + 3, y + 5, { width: widths[i] - 6, height: h - 4, ellipsis: true, lineBreak: false });
        x += widths[i];
      });
      if (!headerRow) doc.moveTo(30, y + h).lineTo(30 + pageW, y + h).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      return y + h;
    };

    let y = drawRow(cols.map((c) => c.header), doc.y, true);
    for (const r of rows) {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = drawRow(cols.map((c) => c.header), 30, true);
      }
      y = drawRow(cols.map((c) => String(r[c.key] ?? '')), y, false);
    }
    doc.fillColor('#64748b').fontSize(8).text(`${rows.length} ligne(s) — document généré par PointagePro le ${new Date().toLocaleString('fr-FR', { timeZone: DEFAULT_TZ })}`, 30, y + 12);
    doc.end();
  });
}
