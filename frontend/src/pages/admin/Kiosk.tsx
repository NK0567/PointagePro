import { ArrowLeft, CheckCircle2, Delete, Fingerprint, KeyRound, MapPin, Plus, XCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, type DayState, type EventType, type Task } from '../../api';
import { useAuth } from '../../auth';
import { Alert, Button, FingerprintButton, Logo } from '../../components/ui';
import { EVENT_LABELS } from '../../lib/format';
import { getPosition, type Position } from '../../lib/geo';
import { biometricProof } from '../../lib/webauthn';

interface Info {
  employee: { id: number; matricule: string; firstName: string; lastName: string; jobTitle: string; site: string | null; hasPin: boolean; devices: number };
  state: DayState; arrival: string; allowed: EventType[]; tasks: Task[];
}

type Step = 'id' | 'action' | 'tasks' | 'auth' | 'done';

/** Poste de pointage partagé : tablette fixe sur le site, supervisée par l'agent de pointage. */
export function Kiosk() {
  const { user } = useAuth();
  const [clock, setClock] = useState(new Date());
  const [pos, setPos] = useState<Position | null>(null);
  const [posError, setPosError] = useState('');
  const [step, setStep] = useState<Step>('id');
  const [matricule, setMatricule] = useState('');
  const [info, setInfo] = useState<Info | null>(null);
  const [type, setType] = useState<EventType | null>(null);
  const [newTasks, setNewTasks] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [doneIds, setDoneIds] = useState<number[]>([]);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const refresh = () => getPosition().then((p) => { setPos(p); setPosError(''); }).catch((e) => setPosError(e.message));
    refresh();
    const t = setInterval(refresh, 120_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (step !== 'done') return;
    const t = setTimeout(reset, 6000);
    return () => clearTimeout(t);
  }, [step]);

  function reset() {
    setStep('id'); setMatricule(''); setInfo(null); setType(null); setNewTasks([]); setDraft(''); setDoneIds([]); setPin(''); setError(''); setOutcome(null);
  }

  async function identify(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const m = /^\d+$/.test(matricule) ? `EMP-${matricule.padStart(4, '0')}` : matricule;
      const i = await api.get<Info>(`/kiosk/employee/${encodeURIComponent(m)}`);
      setInfo(i);
      setStep('action');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  function choose(t: EventType) {
    setType(t);
    const open = info!.tasks.filter((x) => x.status !== 'DONE');
    setStep(t === 'ARRIVAL' || (t === 'DEPARTURE' && open.length) ? 'tasks' : 'auth');
  }

  async function submit(method: 'pin' | 'webauthn') {
    if (!info || !type) return;
    setError('');
    setBusy(true);
    try {
      const geo = await getPosition().catch(() => pos);
      let auth: Record<string, unknown> = { pin };
      if (method === 'webauthn') auth = await biometricProof('/kiosk/options', { matricule: info.employee.matricule });
      const r = await api.post<{ event: { time: string }; tasks: { carried?: number } | null }>('/kiosk/punch', {
        matricule: info.employee.matricule, type, geo, ...auth,
        tasks: type === 'ARRIVAL' ? newTasks : undefined, doneTaskIds: type === 'DEPARTURE' ? doneIds : undefined,
      });
      setOutcome({ ok: true, text: `${EVENT_LABELS[type]} de ${info.employee.firstName} ${info.employee.lastName} enregistrée à ${r.event.time}.${r.tasks?.carried ? ` ${r.tasks.carried} tâche(s) reportée(s) au prochain jour.` : ''}` });
      setStep('done');
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) { setOutcome({ ok: false, text: e.message }); setStep('done'); }
      else setError((e as Error).message);
    } finally { setBusy(false); setPin(''); }
  }

  const key = (k: string) => setPin((p) => (k === '<' ? p.slice(0, -1) : p.length < 6 ? p + k : p));

  return (
    <div className="flex min-h-full flex-col bg-gradient-to-br from-navy-950 via-navy-900 to-brand-800 text-white">
      <header className="flex items-center justify-between px-6 py-4">
        <Logo light />
        <div className="text-right">
          <p className="text-3xl font-bold tabular-nums">{clock.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
          <p className="text-sm capitalize text-blue-100/70">{clock.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-10">
        <div className="w-full max-w-lg rounded-3xl bg-white p-6 text-slate-900 shadow-2xl sm:p-8">
          {step === 'id' && (
            <form onSubmit={identify} className="space-y-5 text-center">
              <h1 className="text-2xl font-bold">Poste de pointage</h1>
              <p className="text-slate-600">Saisissez votre matricule</p>
              <input autoFocus className="input text-center font-mono text-2xl uppercase tracking-widest" value={matricule} onChange={(e) => setMatricule(e.target.value.toUpperCase())} placeholder="EMP-0001 ou 1" />
              {error && <Alert>{error}</Alert>}
              <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!matricule.trim()}>Continuer</Button>
            </form>
          )}

          {step !== 'id' && info && step !== 'done' && (
            <div className="mb-5 flex items-center gap-4 rounded-2xl bg-slate-50 p-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-700">{info.employee.firstName[0]}{info.employee.lastName[0]}</div>
              <div className="flex-1">
                <p className="text-lg font-semibold">{info.employee.lastName} {info.employee.firstName}</p>
                <p className="text-sm text-slate-500">{info.employee.jobTitle} · {info.employee.matricule}</p>
              </div>
              <button onClick={reset} className="rounded-lg p-2 text-slate-400 hover:bg-slate-200" aria-label="Annuler"><ArrowLeft className="h-5 w-5" /></button>
            </div>
          )}

          {step === 'action' && info && (
            <div className="space-y-3">
              {info.allowed.length === 0 && <Alert tone="blue">Journée déjà clôturée pour cet employé.</Alert>}
              {info.allowed.map((a) => <Button key={a} size="lg" className="w-full" variant={a === info.allowed[0] ? 'primary' : 'secondary'} onClick={() => choose(a)}>{EVENT_LABELS[a]}</Button>)}
            </div>
          )}

          {step === 'tasks' && info && type === 'ARRIVAL' && (
            <div className="space-y-4">
              <p className="font-semibold">Tâches du jour</p>
              <ul className="space-y-1.5 text-sm">
                {info.tasks.filter((t) => t.status !== 'DONE').map((t) => <li key={t.id} className="rounded-lg bg-slate-50 px-3 py-2">{t.title}{t.carryCount > 0 && <span className="ml-2 text-xs text-amber-700">(reportée)</span>}</li>)}
                {newTasks.map((t) => <li key={t} className="rounded-lg bg-brand-50 px-3 py-2">{t}</li>)}
              </ul>
              <div className="flex gap-2">
                <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ajouter une tâche" onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { setNewTasks([...newTasks, draft.trim()]); setDraft(''); } }} />
                <Button variant="secondary" onClick={() => { if (draft.trim()) { setNewTasks([...newTasks, draft.trim()]); setDraft(''); } }} aria-label="Ajouter"><Plus className="h-4 w-4" /></Button>
              </div>
              <Button size="lg" className="w-full" onClick={() => setStep('auth')}>Continuer</Button>
            </div>
          )}

          {step === 'tasks' && info && type === 'DEPARTURE' && (
            <div className="space-y-3">
              <p className="font-semibold">Cochez les tâches terminées</p>
              {info.tasks.filter((t) => t.status !== 'DONE').map((t) => (
                <label key={t.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                  <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={doneIds.includes(t.id)} onChange={(e) => setDoneIds(e.target.checked ? [...doneIds, t.id] : doneIds.filter((x) => x !== t.id))} />
                  {t.title}
                </label>
              ))}
              <Button size="lg" className="w-full" onClick={() => setStep('auth')}>Continuer</Button>
            </div>
          )}

          {step === 'auth' && info && (
            <div className="space-y-5 text-center">
              {info.employee.devices > 0 && (
                <div className="flex flex-col items-center">
                  <FingerprintButton onClick={() => submit('webauthn')} busy={busy} size="md" />
                  <p className="mt-3 text-sm text-slate-600">Empreinte sur votre clé de sécurité biométrique</p>
                </div>
              )}
              {info.employee.hasPin && (
                <div>
                  {info.employee.devices > 0 && <p className="mb-3 text-xs uppercase tracking-wide text-slate-400">ou</p>}
                  <p className="mb-2 flex items-center justify-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4" /> Code PIN (sous la supervision de l'agent)</p>
                  <div className="mb-3 flex justify-center gap-2">{Array.from({ length: 6 }, (_, i) => <span key={i} className={`h-3 w-3 rounded-full ${i < pin.length ? 'bg-brand-700' : 'bg-slate-200'}`} />)}</div>
                  <div className="mx-auto grid max-w-64 grid-cols-3 gap-2">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', '<', '0', 'OK'].map((k) => (
                      <button
                        key={k}
                        onClick={() => (k === 'OK' ? submit('pin') : key(k))}
                        disabled={busy || (k === 'OK' && pin.length < 4)}
                        className={`rounded-xl py-3 text-lg font-semibold transition disabled:opacity-40 ${k === 'OK' ? 'bg-brand-700 text-white' : 'bg-slate-100 hover:bg-slate-200'}`}
                      >
                        {k === '<' ? <Delete className="mx-auto h-5 w-5" /> : k}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!info.employee.hasPin && info.employee.devices === 0 && <Alert tone="amber">Aucun moyen d'authentification enregistré pour cet employé. Contactez les RH.</Alert>}
              {error && <Alert>{error}</Alert>}
            </div>
          )}

          {step === 'done' && outcome && (
            <div className="py-6 text-center">
              {outcome.ok ? <CheckCircle2 className="mx-auto h-20 w-20 text-emerald-500" /> : <XCircle className="mx-auto h-20 w-20 text-red-500" />}
              <p className="mt-4 text-xl font-bold">{outcome.ok ? 'Pointage enregistré' : 'Pointage refusé'}</p>
              <p className="mt-2 text-slate-600">{outcome.text}</p>
              <Button size="lg" className="mt-6 w-full" onClick={reset}>Employé suivant</Button>
            </div>
          )}
        </div>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-xs text-blue-100/70">
        <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {pos ? `Position du poste ±${Math.round(pos.accuracy)} m` : posError || 'Localisation du poste…'}</span>
        <span className="flex items-center gap-1.5"><Fingerprint className="h-3.5 w-3.5" /> Supervisé par {user?.firstName} {user?.lastName} · <Link to="/admin" className="underline">Quitter</Link></span>
      </footer>
    </div>
  );
}
