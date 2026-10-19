import { CheckCircle2, ClipboardList, Plus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Task, type TaskStatus } from '../../api';
import { Alert, Badge, Button, Empty, Spinner } from '../../components/ui';
import { PRIORITY, TASK_STATUS, frDate, longDate } from '../../lib/format';

export function EmployeeTasks() {
  const [data, setData] = useState<{ date: string; tasks: Task[] } | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => api.get<{ date: string; tasks: Task[] }>('/me/tasks').then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api.post('/me/tasks', { title });
      setTitle('');
      load();
    } catch (e) { setError((e as Error).message); }
  }

  async function setStatus(t: Task, status: TaskStatus) {
    await api.patch(`/me/tasks/${t.id}`, { status }).catch((e) => setError(e.message));
    load();
  }

  if (!data) return error ? <Alert>{error}</Alert> : <Spinner />;
  const done = data.tasks.filter((t) => t.status === 'DONE').length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Mes tâches</h1>
        <p className="text-sm capitalize text-slate-500">{longDate(data.date)} · {done}/{data.tasks.length} réalisée(s)</p>
      </div>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={add} className="flex gap-2">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ajouter une tâche pour aujourd'hui" maxLength={190} />
        <Button type="submit"><Plus className="h-4 w-4" /> Ajouter</Button>
      </form>
      <div className="card divide-y divide-slate-100">
        {data.tasks.length === 0 && <Empty icon={<ClipboardList className="h-10 w-10" />} title="Aucune tâche aujourd'hui" />}
        {data.tasks.map((t) => (
          <div key={t.id} className="flex items-start gap-3 px-4 py-3.5">
            <button
              onClick={() => setStatus(t, t.status === 'DONE' ? 'TODO' : 'DONE')}
              className="mt-0.5"
              aria-label={t.status === 'DONE' ? 'Marquer comme non faite' : 'Marquer comme faite'}
            >
              {t.status === 'DONE' ? <CheckCircle2 className="h-6 w-6 text-emerald-500" /> : <span className="block h-6 w-6 rounded-full border-2 border-slate-300 hover:border-brand-600" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${t.status === 'DONE' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs text-slate-500">{t.description}</p>}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {t.status === 'IN_PROGRESS' && <Badge tone="blue">{TASK_STATUS[t.status]}</Badge>}
                {(t.priority === 'HIGH' || t.priority === 'URGENT') && <Badge tone="red">Priorité {PRIORITY[t.priority].toLowerCase()}</Badge>}
                {t.carryCount > 0 && <Badge tone="amber">Reportée {t.carryCount}× · prévue le {frDate(t.originalDate)}</Badge>}
                {t.createdBy && t.createdBy.id !== t.assigneeId && <Badge tone="violet">Assignée par {t.createdBy.firstName}</Badge>}
              </div>
            </div>
            {t.status === 'TODO' && <Button size="sm" variant="ghost" onClick={() => setStatus(t, 'IN_PROGRESS')}>Commencer</Button>}
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">Les tâches non terminées au moment de pointer la fin de journée sont automatiquement reportées au prochain jour travaillé, sans perdre leur historique.</p>
    </div>
  );
}
