import type { EventType, Priority, Role, TaskStatus } from '../api';

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super-administrateur',
  ADMIN_RH: 'Administrateur RH',
  AGENT: 'Agent de pointage',
  CHEF: "Chef d'équipe",
  EMPLOYE: 'Employé',
  DIRECTION: 'Direction / Paie',
};

export const EVENT_LABELS: Record<EventType, string> = {
  ARRIVAL: 'Arrivée',
  BREAK_START: 'Départ en pause',
  BREAK_END: 'Retour de pause',
  DEPARTURE: 'Fin de journée',
};

export const ACTION_LABELS: Record<EventType, string> = {
  ARRIVAL: "Valider l'arrivée",
  BREAK_START: 'Partir en pause',
  BREAK_END: 'Valider le retour de pause',
  DEPARTURE: 'Valider la fin de journée',
};

export const TASK_STATUS: Record<TaskStatus, string> = {
  TODO: 'À faire',
  IN_PROGRESS: 'En cours',
  DONE: 'Fait',
  CANCELLED: 'Annulée',
};

export const PRIORITY: Record<Priority, string> = { LOW: 'Faible', NORMAL: 'Normale', HIGH: 'Élevée', URGENT: 'Urgente' };

export const ACCOUNT_STATUS: Record<string, string> = {
  INVITED: 'Invité',
  PENDING: 'À valider',
  ACTIVE: 'Actif',
  SUSPENDED: 'Suspendu',
};

export const SOURCE_LABELS: Record<string, string> = {
  MOBILE: 'Téléphone',
  KIOSK: 'Poste partagé',
  TERMINAL: 'Terminal',
  CORRECTION: 'Correction',
};

export const REJECTION_LABELS: Record<string, string> = {
  OUT_OF_ZONE: 'Hors zone',
  LOW_ACCURACY: 'GPS imprécis',
  NO_POSITION: 'Sans position',
  NO_SITE: 'Sans site',
  SEQUENCE: 'Séquence invalide',
};

export function minutes(min: number) {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

export const frDate = (iso: string) => iso.split('-').reverse().join('/');

export function longDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function dateTime(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function distance(m?: number | null) {
  if (m == null) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
}
