export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public data?: Record<string, unknown>) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && data?.code === 'UNAUTHENTICATED' && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('pp:logout'));
    }
    throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`, data?.code, data ?? undefined);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  put: <T>(p: string, b: unknown) => request<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
};

/** Télécharge un fichier (export) en conservant le cookie de session. */
export async function download(path: string, fallbackName: string) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error ?? 'Export impossible');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ----------------------------------------------------------------- Types
export type Role = 'SUPER_ADMIN' | 'ADMIN_RH' | 'AGENT' | 'CHEF' | 'EMPLOYE' | 'DIRECTION';
export type EventType = 'ARRIVAL' | 'BREAK_START' | 'BREAK_END' | 'DEPARTURE';
export type DayState = 'NOT_STARTED' | 'WORKING' | 'ON_BREAK' | 'DONE';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface Site {
  id: number; name: string; address: string | null; latitude: number; longitude: number; radiusM: number;
  maxAccuracyM: number; timezone: string; startTime: string; endTime: string; lateToleranceMin: number;
  workDays: string; maxBreaks: number; active: boolean; _count?: { users: number };
}

export interface User {
  id: number; matricule: string; firstName: string; lastName: string; email: string | null;
  role: Role; status: string; jobTitle: string; department: string | null; siteId: number | null; site?: Site | null;
}

export interface Task {
  id: number; title: string; description: string | null; priority: Priority; status: TaskStatus;
  assigneeId: number; plannedDate: string; originalDate: string; dueDate: string | null; carryCount: number;
  comment: string | null; completedAt: string | null;
  assignee?: { id: number; firstName: string; lastName: string; matricule: string };
  createdBy?: { id: number; firstName: string; lastName: string };
}

export interface DayView {
  workDate: string; state: DayState; arrival: string; departure: string;
  breaks: { start: string; end: string }[]; workedMin: number; breakMin: number; lateMin: number; anomalies: string[];
}

export interface DailyRow {
  userId: number; matricule: string; name: string; jobTitle: string; department: string | null; site: string | null;
  status: 'PRESENT' | 'LATE' | 'ON_BREAK' | 'DONE' | 'ABSENT' | 'NOT_YET' | 'OFF';
  arrival: string; breakStart: string; breakEnd: string; departure: string;
  breakMin: number; workedMin: number; lateMin: number; tasksDone: number; tasksTotal: number; anomalies: string[];
}

export interface Notification { id: number; level: 'info' | 'success' | 'warning' | 'danger'; title: string; body: string; read: boolean; createdAt: string }
