// Toutes les dates sont stockées en UTC ; la « journée de travail » est calculée
// dans le fuseau horaire du site (Africa/Douala par défaut, UTC+1 sans heure d'été).

export const DEFAULT_TZ = 'Africa/Douala';

function parts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return p as Record<string, string>;
}

/** AAAA-MM-JJ dans le fuseau donné */
export function workDateOf(date: Date, tz = DEFAULT_TZ): string {
  const p = parts(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** HH:MM dans le fuseau donné */
export function localTime(date: Date | null | undefined, tz = DEFAULT_TZ): string {
  if (!date) return '';
  const p = parts(date, tz);
  return `${p.hour}:${p.minute}`;
}

/** Décalage (en minutes) du fuseau par rapport à UTC à une date donnée */
function tzOffsetMinutes(date: Date, tz: string): number {
  const p = parts(date, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/** Convertit « AAAA-MM-JJ » + « HH:MM » heure locale du site en instant UTC */
export function localToUtc(workDate: string, hhmm: string, tz = DEFAULT_TZ): Date {
  const [y, m, d] = workDate.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, h, min));
  return new Date(guess.getTime() - tzOffsetMinutes(guess, tz) * 60000);
}

/** 1 = lundi … 7 = dimanche */
export function isoWeekday(workDate: string): number {
  const [y, m, d] = workDate.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function addDays(workDate: string, n: number): string {
  const [y, m, d] = workDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Prochain jour travaillé après workDate selon les jours ouvrés du site (« 1,2,3,4,5 ») */
export function nextWorkDay(workDate: string, workDays = '1,2,3,4,5'): string {
  const days = new Set(workDays.split(',').map((s) => Number(s.trim())).filter(Boolean));
  let d = addDays(workDate, 1);
  for (let i = 0; i < 14 && days.size > 0 && !days.has(isoWeekday(d)); i++) d = addDays(d, 1);
  return d;
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 370; d = addDays(d, 1)) out.push(d);
  return out;
}

export const isWorkDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isHHMM = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function minutesToHHMM(min: number): string {
  const sign = min < 0 ? '-' : '';
  const a = Math.abs(Math.round(min));
  return `${sign}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
}
