import { Check, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, type EventType } from '../../api';
import { isAdmin, useAuth } from '../../auth';
import { PageTitle } from '../../components/AdminLayout';
import { Alert, Badge, Button, Card, Empty, Spinner } from '../../components/ui';
import { EVENT_LABELS, REJECTION_LABELS, SOURCE_LABELS, dateTime, distance, frDate, todayIso } from '../../lib/format';

interface Ev {
  id: number; type: EventType; time: string; source: string; distanceM: number | null; accuracyM: number | null;
  offline: boolean; needsReview: boolean; voided: boolean; voidReason: string | null; reason: string | null;
  user: { id: number; firstName: string; lastName: string; matricule: string }; recordedBy: { firstName: string; lastName: string } | null; site: { name: string } | null;
}
interface Rej { id: number; type: EventType; code: string; message: string; time: string; distanceM: number | null; accuracyM: number | null; user: { firstName: string; lastName: string; matricule: string } }
interface Corr {
  id: number; workDate: string; type: EventType; requestedTime: string; reason: string; status: string; reviewComment: string | null; createdAt: string;
  user: { firstName: string; lastName: string; matricule: string }; reviewer: { firstName: string; lastName: string } | null;
}

export function AttendancePage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState<{ events: Ev[]; rejections: Rej[] } | null>(null);
  const [corr, setCorr] = useState<Corr[]>([]);
  const [corrFilter, setCorrFilter] = useState('PENDING');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<{ events: Ev[]; rejections: Rej[] }>(`/admin/attendance?date=${date}`).then(setData).catch((e) => setError(e.message));
    api.get<Corr[]>(`/admin/corrections?status=${corrFilter}`).then(setCorr);
  }, [date, corrFilter]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => { setError(''); try { await fn(); load(); } catch (e) { setError((e as Error).message); } };

  const voidIt = (ev: Ev) => {
    const reason = prompt(`Motif de l'annulation du pointage « ${EVENT_LABELS[ev.type]} » de ${ev.user.firstName} ${ev.user.lastName} :`);
    if (reason && reason.trim().length >= 5) act(() => api.post(`/admin/attendance/${ev.id}/void`, { reason }));
  };
  const review = (c: Corr, approve: boolean) => {
    const comment = approve ? undefined : prompt('Motif du refus (facultatif) :') ?? undefined;
    act(() => api.post(`/admin/corrections/${c.id}/review`, { approve, comment }));
  };

  return (
    <>
      <PageTitle
        title="Pointages"
        subtitle="Journal des événements, tentatives refusées et demandes de correction"
        action={<input type="date" className="input w-auto" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />}
      />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <Card title={`Demandes de correction`} className="mb-6" action={
        <select className="input w-auto py-1.5 text-xs" value={corrFilter} onChange={(e) => setCorrFilter(e.target.value)}>
          <option value="PENDING">En attente</option><option value="APPROVED">Acceptées</option><option value="REJECTED">Refusées</option><option value="ALL">Toutes</option>
        </select>
      }>
        {corr.length === 0 ? <p className="px-5 py-5 text-sm text-slate-500">Aucune demande.</p> : (
          <ul className="divide-y divide-slate-100">
            {corr.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-slate-900">{c.user.lastName} {c.user.firstName} <span className="font-normal text-slate-500">· {c.user.matricule}</span></p>
                  <p className="text-slate-700">{EVENT_LABELS[c.type]} le <strong>{frDate(c.workDate)}</strong> à <strong>{c.requestedTime}</strong></p>
                  <p className="text-xs text-slate-500">« {c.reason} » — demandé le {dateTime(c.createdAt)}</p>
                </div>
                {c.status === 'PENDING' && admin ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="success" onClick={() => review(c, true)}><Check className="h-4 w-4" /> Accepter</Button>
                    <Button size="sm" variant="secondary" onClick={() => review(c, false)}><X className="h-4 w-4" /> Refuser</Button>
                  </div>
                ) : (
                  <Badge tone={c.status === 'APPROVED' ? 'green' : c.status === 'REJECTED' ? 'red' : 'amber'}>
                    {c.status === 'APPROVED' ? 'Acceptée' : c.status === 'REJECTED' ? 'Refusée' : 'En attente'}{c.reviewer ? ` par ${c.reviewer.firstName}` : ''}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card title={`Événements du ${frDate(date)}`}>
          {!data ? <Spinner /> : data.events.length === 0 ? <Empty title="Aucun pointage ce jour" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px]">
                <thead className="bg-slate-50/80"><tr>{['Heure', 'Employé', 'Action', 'Source', 'Distance', 'État', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.events.map((e) => (
                    <tr key={e.id} className={e.voided ? 'opacity-50' : ''}>
                      <td className="td font-semibold tabular-nums">{e.time}</td>
                      <td className="td"><p className="font-medium text-slate-900">{e.user.lastName} {e.user.firstName}</p><p className="text-xs text-slate-500">{e.user.matricule}</p></td>
                      <td className="td">{EVENT_LABELS[e.type]}</td>
                      <td className="td">{SOURCE_LABELS[e.source]}{e.recordedBy && <p className="text-xs text-slate-500">par {e.recordedBy.firstName} {e.recordedBy.lastName}</p>}</td>
                      <td className="td tabular-nums">{distance(e.distanceM)}{e.accuracyM != null && <p className="text-xs text-slate-500">±{Math.round(e.accuracyM)} m</p>}</td>
                      <td className="td">
                        {e.voided ? <Badge tone="slate">Annulé</Badge> : e.needsReview ? <Badge tone="amber">À vérifier</Badge> : e.source === 'CORRECTION' ? <Badge tone="violet">Corrigé</Badge> : <Badge tone="green">Valide</Badge>}
                        {e.offline && <p className="mt-1 text-xs text-amber-700">Hors ligne</p>}
                        {e.voidReason && <p className="mt-1 text-xs text-slate-500">{e.voidReason}</p>}
                      </td>
                      <td className="td text-right whitespace-nowrap">
                        {admin && !e.voided && e.needsReview && <Button size="sm" variant="ghost" onClick={() => act(() => api.post(`/admin/attendance/${e.id}/review`))}>Valider</Button>}
                        {admin && !e.voided && <Button size="sm" variant="ghost" onClick={() => voidIt(e)}>Annuler</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Tentatives refusées">
          {!data ? <Spinner /> : data.rejections.length === 0 ? <p className="px-5 py-5 text-sm text-slate-500">Aucune tentative refusée.</p> : (
            <ul className="divide-y divide-slate-100">
              {data.rejections.map((r) => (
                <li key={r.id} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">{r.user.lastName} {r.user.firstName}</p>
                    <span className="text-xs tabular-nums text-slate-500">{r.time}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone="red">{REJECTION_LABELS[r.code] ?? r.code}</Badge>
                    <span className="text-xs text-slate-500">{EVENT_LABELS[r.type]}{r.distanceM != null ? ` · ${distance(r.distanceM)} du site` : ''}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
