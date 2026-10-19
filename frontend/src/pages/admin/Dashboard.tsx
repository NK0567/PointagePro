import { AlertTriangle, Clock, Coffee, UserCheck, UserX, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type DailyRow } from '../../api';
import { PageTitle } from '../../components/AdminLayout';
import { DayStatusBadge } from '../../components/DayStatus';
import { Alert, Badge, Card, Spinner, Stat } from '../../components/ui';
import { REJECTION_LABELS, longDate, minutes } from '../../lib/format';

interface Dash {
  date: string;
  stats: { total: number; present: number; late: number; absent: number; onBreak: number; notYet: number; done: number };
  rows: DailyRow[];
  pendingAccounts: number;
  pendingCorrections: number;
  rejections: { id: number; code: string; message: string; time: string; user: { firstName: string; lastName: string; matricule: string } }[];
}

export function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api.get<Dash>('/admin/dashboard').then(setD).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 30_000); // rafraîchissement automatique
    return () => clearInterval(t);
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!d) return <Spinner />;

  return (
    <>
      <PageTitle title="Tableau de bord" subtitle={`Situation du ${longDate(d.date)} — actualisée toutes les 30 s`} />

      {(d.pendingAccounts > 0 || d.pendingCorrections > 0) && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {d.pendingAccounts > 0 && (
            <Link to="/admin/employes?status=PENDING"><Alert tone="blue" title={`${d.pendingAccounts} compte(s) à valider`}>Des employés ont enregistré leur empreinte et attendent votre validation.</Alert></Link>
          )}
          {d.pendingCorrections > 0 && (
            <Link to="/admin/pointages"><Alert tone="amber" title={`${d.pendingCorrections} demande(s) de correction`}>Pointages oubliés à examiner.</Alert></Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat icon={<Users className="h-5 w-5" />} label="Employés attendus" value={d.stats.total} />
        <Stat icon={<UserCheck className="h-5 w-5" />} label="Présents aujourd'hui" value={d.stats.present} tone="green" />
        <Stat icon={<Clock className="h-5 w-5" />} label="En retard" value={d.stats.late} tone="red" />
        <Stat icon={<UserX className="h-5 w-5" />} label="Absents" value={d.stats.absent} tone="violet" hint={d.stats.notYet ? `${d.stats.notYet} pas encore arrivé(s)` : undefined} />
        <Stat icon={<Coffee className="h-5 w-5" />} label="En pause" value={d.stats.onBreak} tone="amber" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title="Pointages du jour" action={<Link to="/admin/rapports" className="text-sm font-medium text-brand-700 hover:underline">Exporter</Link>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50/80">
                <tr>
                  {['Nom', 'Fonction', 'Arrivée', 'Pause', 'Retour', 'Fin', 'Travaillé', 'Tâches', 'Statut'].map((h) => <th key={h} className="th">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.rows.map((r) => (
                  <tr key={r.userId} className="hover:bg-slate-50/60">
                    <td className="td"><p className="font-medium text-slate-900">{r.name}</p><p className="text-xs text-slate-500">{r.matricule}</p></td>
                    <td className="td">{r.jobTitle}</td>
                    <td className="td tabular-nums">{r.arrival || '—'}</td>
                    <td className="td tabular-nums">{r.breakStart || '—'}</td>
                    <td className="td tabular-nums">{r.breakEnd || '—'}</td>
                    <td className="td tabular-nums">{r.departure || '—'}</td>
                    <td className="td tabular-nums">{minutes(r.workedMin)}</td>
                    <td className="td tabular-nums">{r.tasksTotal ? `${r.tasksDone}/${r.tasksTotal}` : '—'}</td>
                    <td className="td"><DayStatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Alertes du jour">
          {d.rejections.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">Aucune tentative refusée aujourd'hui.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.rejections.map((r) => (
                <li key={r.id} className="flex gap-3 px-5 py-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                  <div className="min-w-0 text-sm">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-900">{r.user.lastName} {r.user.firstName}</p>
                      <span className="text-xs text-slate-400">{r.time}</span>
                    </div>
                    <Badge tone="red">{REJECTION_LABELS[r.code] ?? r.code}</Badge>
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
