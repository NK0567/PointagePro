import type { AttendanceEvent, EventSource, EventType, Site, User } from '@prisma/client';
import { prisma } from '../db';
import { HttpError } from '../lib/errors';
import { distanceMeters } from '../lib/geo';
import { audit, notify, notifyAdmins } from '../lib/audit';
import { localTime, localToUtc, workDateOf, DEFAULT_TZ } from '../lib/time';

export const EVENT_LABELS: Record<EventType, string> = {
  ARRIVAL: 'Arrivée',
  BREAK_START: 'Départ en pause',
  BREAK_END: 'Retour de pause',
  DEPARTURE: 'Fin de journée',
};

export type DayState = 'NOT_STARTED' | 'WORKING' | 'ON_BREAK' | 'DONE';

export interface DaySummary {
  workDate: string;
  state: DayState;
  arrival: Date | null;
  departure: Date | null;
  breaks: { start: Date; end: Date | null }[];
  presenceMin: number;
  breakMin: number;
  workedMin: number;
  lateMin: number;
  anomalies: string[];
  events: AttendanceEvent[];
}

/** Reconstitue une journée à partir des événements (non annulés) — source de vérité unique. */
export function summarizeDay(eventsIn: AttendanceEvent[], site: Pick<Site, 'startTime' | 'lateToleranceMin' | 'timezone'> | null, workDate: string, now = new Date()): DaySummary {
  const events = eventsIn.filter((e) => !e.voided).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const tz = site?.timezone ?? DEFAULT_TZ;
  const anomalies: string[] = [];
  let state: DayState = 'NOT_STARTED';
  let arrival: Date | null = null;
  let departure: Date | null = null;
  const breaks: { start: Date; end: Date | null }[] = [];

  for (const e of events) {
    switch (e.type) {
      case 'ARRIVAL':
        if (!arrival) arrival = e.occurredAt;
        else anomalies.push('Arrivée en double');
        state = 'WORKING';
        break;
      case 'BREAK_START':
        breaks.push({ start: e.occurredAt, end: null });
        state = 'ON_BREAK';
        break;
      case 'BREAK_END': {
        const open = breaks.find((b) => !b.end);
        if (open) open.end = e.occurredAt;
        else anomalies.push('Retour de pause sans départ');
        state = 'WORKING';
        break;
      }
      case 'DEPARTURE':
        departure = e.occurredAt;
        state = 'DONE';
        break;
    }
  }

  const today = workDateOf(now, tz);
  const isPast = workDate < today;
  if (!arrival && events.length) anomalies.push('Arrivée manquante');
  if (arrival && !departure && isPast) anomalies.push('Fin de journée non pointée');
  if (breaks.some((b) => !b.end) && (isPast || departure)) anomalies.push('Pause non clôturée');
  if (events.some((e) => e.offline)) anomalies.push('Pointage hors ligne à vérifier');
  if (events.some((e) => e.source === 'CORRECTION')) anomalies.push('Pointage corrigé');

  const end = departure ?? (arrival && !isPast ? now : null);
  const presenceMin = arrival && end ? Math.max(0, (end.getTime() - arrival.getTime()) / 60000) : 0;
  const breakMin = breaks.reduce((s, b) => {
    const bEnd = b.end ?? (isPast ? null : now);
    return s + (bEnd ? Math.max(0, (bEnd.getTime() - b.start.getTime()) / 60000) : 0);
  }, 0);
  const workedMin = Math.max(0, presenceMin - breakMin);

  let lateMin = 0;
  if (arrival && site) {
    const expected = localToUtc(workDate, site.startTime, tz).getTime() + site.lateToleranceMin * 60000;
    if (arrival.getTime() > expected) lateMin = Math.round((arrival.getTime() - expected) / 60000) + site.lateToleranceMin;
  }

  return { workDate, state, arrival, departure, breaks, presenceMin, breakMin, workedMin, lateMin, anomalies, events };
}

export function allowedNext(state: DayState, breakCount: number, maxBreaks: number): EventType[] {
  switch (state) {
    case 'NOT_STARTED':
      return ['ARRIVAL'];
    case 'WORKING':
      return breakCount < maxBreaks ? ['BREAK_START', 'DEPARTURE'] : ['DEPARTURE'];
    case 'ON_BREAK':
      return ['BREAK_END'];
    default:
      return [];
  }
}

export async function loadDay(userId: number, workDate: string) {
  return prisma.attendanceEvent.findMany({ where: { userId, workDate }, orderBy: { occurredAt: 'asc' } });
}

export interface GeoInput {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface PunchInput {
  user: User & { site: Site | null };
  type: EventType;
  source: EventSource;
  geo?: GeoInput | null;
  recordedById?: number;
  reason?: string;
}

const SEQUENCE_MESSAGES: Record<EventType, string> = {
  ARRIVAL: 'Votre arrivée est déjà enregistrée pour aujourd\'hui.',
  BREAK_START: 'Vous ne pouvez partir en pause que lorsque vous êtes au travail (et dans la limite des pauses autorisées).',
  BREAK_END: 'Aucun départ en pause en cours : impossible d\'enregistrer un retour.',
  DEPARTURE: 'La fin de journée exige une arrivée enregistrée et aucune pause en cours.',
};

async function reject(input: PunchInput, code: string, message: string, extra: { distanceM?: number } = {}): Promise<never> {
  await prisma.punchRejection.create({
    data: {
      userId: input.user.id,
      type: input.type,
      code,
      message,
      latitude: input.geo?.latitude,
      longitude: input.geo?.longitude,
      accuracyM: input.geo?.accuracy,
      distanceM: extra.distanceM,
      source: input.source,
    },
  });
  await notify(input.user.id, 'danger', 'Pointage refusé', message);
  if (code === 'OUT_OF_ZONE') {
    const since = new Date(Date.now() - 12 * 3600_000);
    const count = await prisma.punchRejection.count({ where: { userId: input.user.id, code: 'OUT_OF_ZONE', createdAt: { gte: since } } });
    if (count === 3) {
      await notifyAdmins('warning', 'Tentatives hors zone répétées',
        `${input.user.firstName} ${input.user.lastName} (${input.user.matricule}) a tenté 3 fois de pointer hors de son lieu de service.`);
    }
  }
  throw new HttpError(422, message, code, extra);
}

/**
 * Enregistre un pointage après contrôle du lieu et de la séquence.
 * L'heure est TOUJOURS celle du serveur : l'employé ne peut pas la saisir.
 * Une action refusée est journalisée mais n'est jamais comptée comme pointage.
 */
export async function recordPunch(input: PunchInput) {
  const { user, type } = input;
  const site = user.site;
  if (!site || !site.active) return reject(input, 'NO_SITE', 'Aucun lieu de service actif ne vous est affecté. Contactez votre responsable.');

  let distanceM: number | undefined;
  if (input.source === 'MOBILE' || input.source === 'KIOSK') {
    const g = input.geo;
    if (!g || !Number.isFinite(g.latitude) || !Number.isFinite(g.longitude)) {
      return reject(input, 'NO_POSITION', 'Position indisponible : activez la localisation de l\'appareil pour pointer.');
    }
    distanceM = Math.round(distanceMeters(g.latitude, g.longitude, site.latitude, site.longitude));
    if (!Number.isFinite(g.accuracy) || g.accuracy > site.maxAccuracyM) {
      return reject(input, 'LOW_ACCURACY',
        `Position trop imprécise (±${Math.round(g.accuracy)} m, maximum ±${site.maxAccuracyM} m). Sortez à découvert ou réessayez dans quelques secondes.`,
        { distanceM });
    }
    if (distanceM > site.radiusM) {
      return reject(input, 'OUT_OF_ZONE',
        `Pointage refusé : vous êtes à ${distanceM >= 1000 ? (distanceM / 1000).toFixed(1) + ' km' : distanceM + ' m'} de « ${site.name} » (zone autorisée : ${site.radiusM} m). Rapprochez-vous du site ou contactez votre responsable si votre affectation est incorrecte.`,
        { distanceM });
    }
  }

  const now = new Date();
  const workDate = workDateOf(now, site.timezone);

  // Verrou sur la ligne utilisateur : empêche deux pointages simultanés incohérents.
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`User\` WHERE id = ${user.id} FOR UPDATE`;
    const events = await tx.attendanceEvent.findMany({ where: { userId: user.id, workDate } });
    const day = summarizeDay(events, site, workDate, now);
    if (!allowedNext(day.state, day.breaks.length, site.maxBreaks).includes(type)) return null;
    return tx.attendanceEvent.create({
      data: {
        userId: user.id,
        siteId: site.id,
        type,
        occurredAt: now,
        workDate,
        source: input.source,
        latitude: input.geo?.latitude,
        longitude: input.geo?.longitude,
        accuracyM: input.geo?.accuracy,
        distanceM,
        recordedById: input.recordedById,
        reason: input.reason,
      },
    });
  });
  if (!result) return reject(input, 'SEQUENCE', SEQUENCE_MESSAGES[type]);

  await notify(user.id, 'success', 'Pointage enregistré', `${EVENT_LABELS[type]} validée à ${localTime(now, site.timezone)}.`);
  return { event: result, workDate, site };
}

/** Insère un événement provenant d'un terminal biométrique (éventuellement hors ligne). */
export async function ingestTerminalEvent(opts: {
  terminalId: number;
  site: Site;
  user: User;
  type: EventType;
  occurredAt: Date;
  deviceEventId: string;
}) {
  const existing = await prisma.attendanceEvent.findUnique({ where: { deviceEventId: opts.deviceEventId } });
  if (existing) return { status: 'duplicate' as const, id: existing.id };
  const received = new Date();
  const offline = Math.abs(received.getTime() - opts.occurredAt.getTime()) > 5 * 60_000;
  const workDate = workDateOf(opts.occurredAt, opts.site.timezone);
  const events = await loadDay(opts.user.id, workDate);
  const day = summarizeDay(events, opts.site, workDate);
  const coherent = allowedNext(day.state, day.breaks.length, opts.site.maxBreaks).includes(opts.type);
  const ev = await prisma.attendanceEvent.create({
    data: {
      userId: opts.user.id,
      siteId: opts.site.id,
      type: opts.type,
      occurredAt: opts.occurredAt,
      workDate,
      source: 'TERMINAL',
      offline,
      needsReview: offline || !coherent || opts.occurredAt.getTime() > received.getTime() + 60_000,
      deviceEventId: opts.deviceEventId,
      reason: `Terminal #${opts.terminalId}${coherent ? '' : ' — séquence incohérente'}`,
    },
  });
  return { status: ev.needsReview ? ('review' as const) : ('ok' as const), id: ev.id };
}

export async function voidEvent(eventId: number, actorId: number, reason: string) {
  const ev = await prisma.attendanceEvent.update({ where: { id: eventId }, data: { voided: true, voidReason: reason } });
  await audit(null, 'ATTENDANCE_VOID', { actorId, entity: 'AttendanceEvent', entityId: eventId, details: { reason, type: ev.type, occurredAt: ev.occurredAt } });
  return ev;
}
