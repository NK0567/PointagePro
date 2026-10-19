import { Clock, Download, FileSpreadsheet, FileText, Table, UserCheck, UserX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, download, type DailyRow, type Site } from '../../api';
import { PageTitle } from '../../components/AdminLayout';
import { DayStatusBadge } from '../../components/DayStatus';
import { Alert, Badge, Button, Card, Spinner, Stat } from '../../components/ui';
import { minutes, todayIso } from '../../lib/format';

interface PeriodRow { matricule: string; name: string; jobTitle: string; workDays: number; presentDays: number; absentDays: number; lateDays: number; lateMin: number; workedMin: number; anomalies: number; tasksDone: number }
interface Emp { id: number; firstName: string; lastName: string }

export function Reports() {
  const [kind, setKind] = useState<'daily' | 'period'>('daily');
  const [date, setDate] = useState(todayIso());
  const [from, setFrom] = useState(todayIso().slice(0, 8) + '01');
  const [to, setTo] = useState(todayIso());
  const [siteId, setSiteId] = useState('');
  const [userId, setUserId] = useState('');
  const [sites, setSites] = useState<Site[]>([]);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [daily, setDaily] = useState<DailyRow[] | null>(null);
  const [period, setPeriod] = useState<PeriodRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api.get<Site[]>('/admin/sites').then(setSites);
    api.get<Emp[]>('/admin/users?status=ACTIVE').then(setEmps);
  }, []);

  const filters = new URLSearchParams({ ...(siteId ? { siteId } : {}), ...(userId ? { userId } : {}) });
  const query = kind === 'daily' ? `date=${date}&${filters}` : `from=${from}&to=${to}&${filters}`;

  useEffect(() => {
    setError('');
    if (kind === 'daily') { setDaily(null); api.get<{ rows: DailyRow[] }>(`/reports/daily?${query}`).then((r) => setDaily(r.rows)).catch((e) => setError(e.message)); }
    else { setPeriod(null); api.get<{ rows: PeriodRow[] }>(`/reports/period?${query}`).then((r) => setPeriod(r.rows)).catch((e) => setError(e.message)); }
  }, [kind, query]);

  async function exportAs(format: 'xlsx' | 'csv' | 'pdf') {
    setBusy(format);
    try { await download(`/reports/export?kind=${kind}&format=${format}&${query}`, `rapport.${format}`); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }

  const present = daily?.filter((r) => r.arrival).length ?? 0;
  const absent = daily?.filter((r) => r.status === 'ABSENT').length ?? 0;
  const worked = daily?.reduce((s, r) => s + r.workedMin, 0) ?? 0;

  return (
    <>
      <PageTitle title="Rapports" subtitle="États de présence exploitables pour les RH et la paie — Excel, CSV ou PDF" />
      <Card className="mb-6 p-5">
        <div className="mb-4 inline-grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-medium">
          {(['daily', 'period'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`rounded-lg px-4 py-1.5 ${kind === k ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>{k === 'daily' ? 'Journée' : 'Période'}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {kind === 'daily' ? (
            <label className="block"><span className="label">Date</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          ) : (
            <>
              <label className="block"><span className="label">Du</span><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="block"><span className="label">Au</span><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </>
          )}
          <label className="block"><span className="label">Lieu de service</span>
            <select className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)}><option value="">Tous</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          <label className="block"><span className="label">Employé</span>
            <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Tous</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.lastName} {e.firstName}</option>)}</select>
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button onClick={() => exportAs('xlsx')} loading={busy === 'xlsx'}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
            <Button variant="secondary" onClick={() => exportAs('csv')} loading={busy === 'csv'}><Table className="h-4 w-4" /> CSV</Button>
            <Button variant="secondary" onClick={() => exportAs('pdf')} loading={busy === 'pdf'}><FileText className="h-4 w-4" /> PDF</Button>
          </div>
        </div>
      </Card>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      {kind === 'daily' && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat icon={<Download className="h-5 w-5" />} label="Employés suivis" value={daily?.length ?? '…'} />
            <Stat icon={<UserCheck className="h-5 w-5" />} label="Présents" value={present} tone="green" />
            <Stat icon={<UserX className="h-5 w-5" />} label="Absents" value={absent} tone="red" />
            <Stat icon={<Clock className="h-5 w-5" />} label="Heures travaillées" value={minutes(worked)} tone="violet" />
          </div>
          <Card title="Aperçu de la journée">
            {!daily ? <Spinner /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead className="bg-slate-50/80"><tr>{['Nom', 'Fonction', 'Arrivée', 'Pause', 'Retour', 'Fin', 'Travaillé', 'Tâches', 'Statut', 'Anomalies'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {daily.map((r) => (
                      <tr key={r.userId}>
                        <td className="td font-medium text-slate-900">{r.name}</td>
                        <td className="td">{r.jobTitle}</td>
                        <td className="td tabular-nums">{r.arrival || '—'}</td>
                        <td className="td tabular-nums">{r.breakStart || '—'}</td>
                        <td className="td tabular-nums">{r.breakEnd || '—'}</td>
                        <td className="td tabular-nums">{r.departure || '—'}</td>
                        <td className="td tabular-nums">{minutes(r.workedMin)}</td>
                        <td className="td tabular-nums">{r.tasksTotal ? `${r.tasksDone}/${r.tasksTotal}` : '—'}</td>
                        <td className="td"><DayStatusBadge status={r.status} /></td>
                        <td className="td"><div className="flex flex-wrap gap-1">{r.anomalies.map((a) => <Badge key={a} tone="amber">{a}</Badge>)}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {kind === 'period' && (
        <Card title="Synthèse par employé">
          {!period ? <Spinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead className="bg-slate-50/80"><tr>{['Nom', 'Fonction', 'Jours ouvrés', 'Présences', 'Absences', 'Retards', 'Cumul retards', 'Heures', 'Anomalies', 'Tâches faites'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {period.map((r) => (
                    <tr key={r.matricule}>
                      <td className="td font-medium text-slate-900">{r.name}<p className="text-xs font-normal text-slate-500">{r.matricule}</p></td>
                      <td className="td">{r.jobTitle}</td>
                      <td className="td tabular-nums">{r.workDays}</td>
                      <td className="td tabular-nums">{r.presentDays}</td>
                      <td className="td tabular-nums">{r.absentDays ? <Badge tone="red">{r.absentDays}</Badge> : 0}</td>
                      <td className="td tabular-nums">{r.lateDays ? <Badge tone="amber">{r.lateDays}</Badge> : 0}</td>
                      <td className="td tabular-nums">{minutes(r.lateMin)}</td>
                      <td className="td font-semibold tabular-nums">{minutes(r.workedMin)}</td>
                      <td className="td tabular-nums">{r.anomalies}</td>
                      <td className="td tabular-nums">{r.tasksDone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <p className="mt-4 text-xs text-slate-500">Les états préparent la paie mais n'appliquent aucune retenue automatique : les anomalies (oubli de pointage, pointage hors ligne, correction) doivent être vérifiées avant exploitation.</p>
    </>
  );
}
