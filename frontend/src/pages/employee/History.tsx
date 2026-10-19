import { History as HistoryIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type DayView } from '../../api';
import { Alert, Badge, Empty, Spinner } from '../../components/ui';
import { REJECTION_LABELS, dateTime, longDate, minutes } from '../../lib/format';

interface Rejection { id: number; code: string; message: string; createdAt: string }

export function EmployeeHistory() {
  const [data, setData] = useState<{ days: DayView[]; rejections: Rejection[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get<{ days: DayView[]; rejections: Rejection[] }>('/me/history').then(setData).catch((e) => setError(e.message)); }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Spinner />;
  const total = data.days.reduce((s, d) => s + d.workedMin, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Historique</h1>
        <p className="text-sm text-slate-500">14 derniers jours · {minutes(total)} travaillées</p>
      </div>
      {data.days.length === 0 && <div className="card"><Empty icon={<HistoryIcon className="h-10 w-10" />} title="Aucun pointage sur la période" /></div>}
      <div className="space-y-3">
        {data.days.map((d) => (
          <div key={d.workDate} className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold capitalize text-slate-900">{longDate(d.workDate)}</p>
              <span className="text-sm font-semibold tabular-nums text-brand-700">{minutes(d.workedMin)}</span>
            </div>
            <p className="mt-1 text-sm tabular-nums text-slate-600">
              {d.arrival || '—'} → {d.breaks.map((b) => `pause ${b.start}–${b.end || '?'}`).join(', ') || 'sans pause'} → {d.departure || '—'}
            </p>
            {(d.lateMin > 0 || d.anomalies.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.lateMin > 0 && <Badge tone="red">Retard {minutes(d.lateMin)}</Badge>}
                {d.anomalies.map((a) => <Badge key={a} tone="amber">{a}</Badge>)}
              </div>
            )}
          </div>
        ))}
      </div>
      {data.rejections.length > 0 && (
        <div className="card">
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Tentatives refusées</h2>
          <ul className="divide-y divide-slate-100">
            {data.rejections.map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2"><Badge tone="red">{REJECTION_LABELS[r.code] ?? r.code}</Badge><span className="text-xs text-slate-500">{dateTime(r.createdAt)}</span></div>
                <p className="mt-1 text-slate-600">{r.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
