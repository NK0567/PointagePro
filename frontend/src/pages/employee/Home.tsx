import { AlertTriangle, CheckCircle2, Coffee, LogIn, LogOut, MapPin, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, type DayView, type EventType, type Site, type Task } from '../../api';
import { useAuth } from '../../auth';
import { Alert, Badge, Button, FingerprintButton, Modal, Spinner } from '../../components/ui';
import { ACTION_LABELS, EVENT_LABELS, distance, longDate, minutes } from '../../lib/format';
import { getPosition, type Position } from '../../lib/geo';
import { biometricProof } from '../../lib/webauthn';

interface Today { site: Site | null; day: DayView; allowed: EventType[]; tasks: Task[]; unread: number }
interface GeoCheck { ok: boolean; distanceM: number; accurate: boolean; radiusM: number; maxAccuracyM: number; siteName: string; reason?: string }

const ICONS: Record<EventType, typeof LogIn> = { ARRIVAL: LogIn, BREAK_START: Coffee, BREAK_END: RotateCcw, DEPARTURE: LogOut };

const STATE_BADGE = {
  NOT_STARTED: <Badge tone="slate" dot>Pas encore pointé</Badge>,
  WORKING: <Badge tone="green" dot>Présent</Badge>,
  ON_BREAK: <Badge tone="amber" dot>En pause</Badge>,
  DONE: <Badge tone="blue" dot>Journée terminée</Badge>,
};

export function EmployeeHome() {
  const { user } = useAuth();
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState<EventType | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<Today>('/me/today'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Spinner />;
  const { day, site } = data;
  const openTasks = data.tasks.filter((t) => t.status !== 'DONE');

  return (
    <div className="space-y-5">
      {/* Identité */}
      <div className="card flex items-center gap-4 p-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-700">
          {user?.firstName[0]}{user?.lastName[0]}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{user?.lastName} {user?.firstName}</p>
          <p className="text-sm text-slate-500">{user?.jobTitle} · {user?.matricule}</p>
          <div className="mt-1">{STATE_BADGE[day.state]}</div>
        </div>
      </div>

      <p className="text-sm font-medium capitalize text-slate-500">{longDate(day.workDate)}</p>

      {!site ? (
        <Alert tone="amber" title="Aucun lieu de service">Aucun site de travail ne vous est affecté. Contactez votre responsable.</Alert>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
          <MapPin className="h-5 w-5 shrink-0 text-emerald-600" />
          <div className="text-sm">
            <p className="font-semibold text-emerald-900">{site.name}</p>
            <p className="text-emerald-800/80">Zone autorisée : {site.radiusM} m · Horaires {site.startTime} – {site.endTime}</p>
          </div>
        </div>
      )}

      {/* Action principale */}
      <div className="card p-5">
        {data.allowed.length > 0 ? (
          <div className="space-y-3">
            {data.allowed.map((a, i) => {
              const Icon = ICONS[a];
              return (
                <Button key={a} size="lg" variant={i === 0 ? 'primary' : 'secondary'} className="w-full" onClick={() => setAction(a)}>
                  <Icon className="h-5 w-5" /> {a === 'ARRIVAL' ? 'Pointer mon arrivée' : a === 'DEPARTURE' ? 'Pointer ma fin de journée' : EVENT_LABELS[a]}
                </Button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-3 text-slate-700">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            <p className="text-sm">{day.state === 'DONE' ? 'Votre journée est clôturée. À demain !' : 'Aucun pointage disponible.'}</p>
          </div>
        )}

        <dl className="mt-5 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          {[
            ['Arrivée', day.arrival || '—'],
            ['Pause', day.breaks[0]?.start || '—'],
            ['Retour', day.breaks[0]?.end || '—'],
            ['Fin', day.departure || '—'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 px-2 py-3">
              <dt className="text-xs text-slate-500">{k}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
          <span>Temps travaillé : <strong className="text-slate-900">{minutes(day.workedMin)}</strong></span>
          {day.breakMin > 0 && <span>Pauses : <strong className="text-slate-900">{minutes(day.breakMin)}</strong></span>}
          {day.lateMin > 0 && <span className="text-red-600">Retard : <strong>{minutes(day.lateMin)}</strong></span>}
        </div>
      </div>

      {/* Tâches du jour */}
      <div className="card">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Mes tâches du jour</h2>
          <Link to="/moi/taches" className="text-sm font-medium text-brand-700 hover:underline">Tout voir</Link>
        </div>
        {data.tasks.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">Aucune tâche pour aujourd'hui. Vous pourrez les déclarer en pointant votre arrivée.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.tasks.map((t, i) => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                <span className="w-5 text-sm text-slate-400">{i + 1}.</span>
                <span className={`flex-1 text-sm ${t.status === 'DONE' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{t.title}</span>
                {t.carryCount > 0 && t.status !== 'DONE' && <Badge tone="amber">Reportée</Badge>}
                {t.status === 'DONE' ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <span className="h-5 w-5 rounded-full border-2 border-slate-300" />}
              </li>
            ))}
          </ul>
        )}
        {openTasks.length > 0 && day.state !== 'NOT_STARTED' && (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Les tâches non cochées à la fin de journée seront reportées automatiquement au prochain jour travaillé.</p>
        )}
      </div>

      {action && site && (
        <PunchFlow type={action} site={site} tasks={data.tasks} onClose={() => setAction(null)} onDone={() => { setAction(null); load(); }} />
      )}
    </div>
  );
}

// ======================================================================= Flux de pointage
type Step = 'locate' | 'tasks' | 'auth' | 'success' | 'refused';

function PunchFlow({ type, site, tasks, onClose, onDone }: { type: EventType; site: Site; tasks: Task[]; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<Step>('locate');
  const [pos, setPos] = useState<Position | null>(null);
  const [geo, setGeo] = useState<GeoCheck | null>(null);
  const [geoError, setGeoError] = useState('');
  const [newTasks, setNewTasks] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const open = tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');
  const [doneIds, setDoneIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ time: string; carried?: number; next?: string } | null>(null);
  const [refusal, setRefusal] = useState<{ message: string; distanceM?: number } | null>(null);

  const locate = useCallback(async () => {
    setGeoError('');
    setGeo(null);
    try {
      const p = await getPosition();
      setPos(p);
      setGeo(await api.post<GeoCheck>('/me/geo-check', p));
    } catch (e) {
      setGeoError((e as Error).message);
    }
  }, []);
  useEffect(() => { locate(); }, [locate]);

  const needsTasks = type === 'ARRIVAL' || (type === 'DEPARTURE' && open.length > 0);

  async function authenticate() {
    setError('');
    setBusy(true);
    try {
      // Position rafraîchie juste avant l'envoi : c'est elle que le serveur contrôle.
      const fresh = await getPosition().catch(() => pos);
      const proof = await biometricProof('/me/punch/options');
      const r = await api.post<{ event: { time: string }; tasks: { carried?: number; nextDate?: string } | null }>('/me/punch', {
        ...proof, type, geo: fresh,
        tasks: type === 'ARRIVAL' ? newTasks : undefined,
        doneTaskIds: type === 'DEPARTURE' ? doneIds : undefined,
      });
      setResult({ time: r.event.time, carried: r.tasks?.carried, next: r.tasks?.nextDate });
      setStep('success');
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setRefusal({ message: e.message, distanceM: e.data?.distanceM as number | undefined });
        setStep('refused');
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const addDraft = () => {
    const v = draft.trim();
    if (v && !newTasks.includes(v)) setNewTasks([...newTasks, v]);
    setDraft('');
  };

  return (
    <Modal open onClose={step === 'success' ? onDone : onClose} title={EVENT_LABELS[type]}>
      {step === 'locate' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Vérification de votre position par rapport à votre lieu de service…</p>
          {!geo && !geoError && <Spinner label="Recherche de la position GPS…" />}
          {geoError && (
            <>
              <Alert title="Position indisponible">{geoError}</Alert>
              <Button variant="secondary" className="w-full" onClick={locate}>Réessayer</Button>
            </>
          )}
          {geo && (
            <>
              {geo.ok ? (
                <Alert tone="green" title="Vous êtes dans la zone de service">
                  {geo.siteName} · à {distance(geo.distanceM)} (rayon {geo.radiusM} m) · précision ±{Math.round(pos?.accuracy ?? 0)} m
                </Alert>
              ) : (
                <Alert title={geo.accurate ? "Vous n'êtes pas au lieu de service" : 'Position trop imprécise'}>
                  {geo.accurate
                    ? <>Vous êtes à <strong>{distance(geo.distanceM)}</strong> de « {geo.siteName} » (zone autorisée : {geo.radiusM} m). Le pointage sera refusé tant que vous n'êtes pas sur place.</>
                    : <>Précision actuelle ±{Math.round(pos?.accuracy ?? 0)} m (maximum ±{geo.maxAccuracyM} m). Rapprochez-vous d'une fenêtre ou sortez à découvert.</>}
                </Alert>
              )}
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={locate}>Actualiser</Button>
                <Button className="flex-1" disabled={!geo.ok} onClick={() => setStep(needsTasks ? 'tasks' : 'auth')}>Continuer</Button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 'tasks' && type === 'ARRIVAL' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Renseignez les tâches que vous prévoyez de réaliser aujourd'hui.</p>
          {open.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Déjà prévues</p>
              <ul className="space-y-1.5">
                {open.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <span className="flex-1">{t.title}</span>
                    {t.carryCount > 0 && <Badge tone="amber">Reportée</Badge>}
                    {t.createdBy && t.createdBy.id !== t.assigneeId && <Badge tone="blue">Assignée</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Nouvelles tâches</p>
            <div className="flex gap-2">
              <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDraft(); } }} placeholder="Ex. Contrôler les stocks" maxLength={190} />
              <Button variant="secondary" onClick={addDraft} aria-label="Ajouter la tâche"><Plus className="h-4 w-4" /></Button>
            </div>
            <ul className="mt-2 space-y-1.5">
              {newTasks.map((t) => (
                <li key={t} className="flex items-center gap-2 rounded-lg border border-brand-100 bg-brand-50/50 px-3 py-2 text-sm">
                  <span className="flex-1">{t}</span>
                  <button onClick={() => setNewTasks(newTasks.filter((x) => x !== t))} className="text-slate-400 hover:text-red-600" aria-label={`Retirer ${t}`}><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          </div>
          <Button className="w-full" onClick={() => { if (draft.trim()) addDraft(); setStep('auth'); }}>Continuer</Button>
        </div>
      )}

      {step === 'tasks' && type === 'DEPARTURE' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Cochez les tâches que vous avez terminées. Les autres seront reportées au prochain jour travaillé.</p>
          <ul className="space-y-2">
            {open.map((t) => (
              <li key={t.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={doneIds.includes(t.id)} onChange={(e) => setDoneIds(e.target.checked ? [...doneIds, t.id] : doneIds.filter((x) => x !== t.id))} />
                  <span className="flex-1">{t.title}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-700">Tâches réalisées : <strong>{doneIds.length + tasks.filter((t) => t.status === 'DONE').length} / {tasks.filter((t) => t.status !== 'CANCELLED').length}</strong></p>
          <Button className="w-full" onClick={() => setStep('auth')}>Continuer</Button>
        </div>
      )}

      {step === 'auth' && (
        <div className="flex flex-col items-center py-4 text-center">
          <FingerprintButton onClick={authenticate} busy={busy} />
          <p className="mt-6 text-lg font-semibold text-slate-900">Touchez votre empreinte</p>
          <p className="text-sm text-slate-600">pour valider : {EVENT_LABELS[type].toLowerCase()}</p>
          {error && <div className="mt-4 w-full text-left"><Alert>{error}</Alert></div>}
          <Button className="mt-6 w-full" onClick={authenticate} loading={busy}>{ACTION_LABELS[type]}</Button>
        </div>
      )}

      {step === 'success' && result && (
        <div className="py-4 text-center">
          <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500" />
          <p className="mt-3 text-lg font-semibold text-slate-900">Pointage enregistré</p>
          <p className="text-sm text-slate-600">{EVENT_LABELS[type]} validée à <strong>{result.time}</strong>.</p>
          {!!result.carried && (
            <div className="mt-4 text-left">
              <Alert tone="amber" title="Tâches non complétées">
                {result.carried} tâche(s) seront ajoutées à votre liste du {result.next?.split('-').reverse().join('/')}.
              </Alert>
            </div>
          )}
          <Button className="mt-6 w-full" onClick={onDone}>Terminé</Button>
        </div>
      )}

      {step === 'refused' && refusal && (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
            <AlertTriangle className="h-6 w-6 shrink-0" />
            <div>
              <p className="font-semibold">Pointage refusé</p>
              <p className="mt-1 text-sm">{refusal.message}</p>
            </div>
          </div>
          {refusal.distanceM != null && (
            <div className="rounded-xl bg-slate-50 p-4 text-sm">
              <p className="font-medium text-slate-900">{site.name}</p>
              <p className="text-slate-600">Distance : {distance(refusal.distanceM)} · Zone autorisée : {site.radiusM} m</p>
            </div>
          )}
          <p className="text-xs text-slate-500">Aucun pointage n'a été enregistré. Cette tentative a été signalée dans votre historique.</p>
          <Button variant="secondary" className="w-full" onClick={onClose}><X className="h-4 w-4" /> Fermer</Button>
        </div>
      )}
    </Modal>
  );
}
