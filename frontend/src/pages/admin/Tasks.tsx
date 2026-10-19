import { CheckCircle2, Clock, History, Plus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Priority, type Task, type TaskStatus } from '../../api';
import { useAuth } from '../../auth';
import { PageTitle } from '../../components/AdminLayout';
import { Alert, Badge, Button, Card, Empty, Field, Modal, Spinner } from '../../components/ui';
import { PRIORITY, TASK_STATUS, dateTime, frDate, todayIso } from '../../lib/format';

interface Emp { id: number; firstName: string; lastName: string; matricule: string; status: string }
interface Hist { id: number; action: string; fromValue: string | null; toValue: string | null; comment: string | null; createdAt: string }

const STATUS_BADGE: Record<TaskStatus, JSX.Element> = {
  DONE: <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> Fait</Badge>,
  IN_PROGRESS: <Badge tone="blue"><Clock className="h-3 w-3" /> En cours</Badge>,
  TODO: <Badge tone="amber">En attente</Badge>,
  CANCELLED: <Badge tone="slate">Annulée</Badge>,
};

const HIST_LABELS: Record<string, string> = { CREATED: 'Créée', STATUS: 'Statut', CARRIED: 'Reportée', REASSIGNED: 'Réaffectée', RESCHEDULED: 'Replanifiée', COMMENT: 'Commentaire' };

export function AdminTasks() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN_RH' || user?.role === 'CHEF';
  const [date, setDate] = useState(todayIso());
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<{ task: Task; items: Hist[] } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => { api.get<{ tasks: Task[] }>(`/admin/tasks?date=${date}`).then((r) => setTasks(r.tasks)).catch((e) => setError(e.message)); }, [date]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<Emp[]>('/admin/users?status=ACTIVE').then(setEmps); }, []);

  const update = async (t: Task, body: Record<string, unknown>) => {
    try { await api.patch(`/admin/tasks/${t.id}`, body); load(); } catch (e) { setError((e as Error).message); }
  };
  const showHistory = async (t: Task) => setHistory({ task: t, items: await api.get<Hist[]>(`/admin/tasks/${t.id}/history`) });

  const done = tasks?.filter((t) => t.status === 'DONE').length ?? 0;

  return (
    <>
      <PageTitle
        title="Tâches"
        subtitle={tasks ? `${done} terminée(s) sur ${tasks.length} · les tâches non terminées sont reportées automatiquement` : undefined}
        action={
          <div className="flex gap-2">
            <input type="date" className="input w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
            {canEdit && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Ajouter une tâche</Button>}
          </div>
        }
      />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <Card title={`Tâches du ${frDate(date)}`}>
        {!tasks ? <Spinner /> : tasks.length === 0 ? <Empty title="Aucune tâche planifiée ce jour" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50/80"><tr>{["Nom de l'employé", 'Tâche', 'Priorité', 'Reports', 'Statut', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="td font-medium text-slate-900">{t.assignee?.lastName} {t.assignee?.firstName}</td>
                    <td className="td">{t.title}{t.comment && <p className="text-xs text-slate-500">💬 {t.comment}</p>}</td>
                    <td className="td">{t.priority === 'HIGH' || t.priority === 'URGENT' ? <Badge tone="red">{PRIORITY[t.priority]}</Badge> : PRIORITY[t.priority]}</td>
                    <td className="td">{t.carryCount > 0 ? <Badge tone="amber">{t.carryCount}× · depuis le {frDate(t.originalDate)}</Badge> : '—'}</td>
                    <td className="td">
                      {canEdit ? (
                        <select className="input w-auto py-1 text-xs" value={t.status} onChange={(e) => update(t, { status: e.target.value })}>
                          {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS[s]}</option>)}
                        </select>
                      ) : STATUS_BADGE[t.status]}
                    </td>
                    <td className="td text-right">
                      <button onClick={() => showHistory(t)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Historique de la tâche"><History className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && <TaskForm emps={emps} date={date} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {history && (
        <Modal open onClose={() => setHistory(null)} title={`Historique — ${history.task.title}`}>
          <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
            {history.items.map((h) => (
              <li key={h.id} className="text-sm">
                <p className="font-medium text-slate-900">{HIST_LABELS[h.action] ?? h.action}{h.fromValue || h.toValue ? ` : ${h.fromValue ?? ''} → ${h.toValue ?? ''}` : ''}</p>
                {h.comment && <p className="text-slate-600">{h.comment}</p>}
                <p className="text-xs text-slate-400">{dateTime(h.createdAt)}</p>
              </li>
            ))}
          </ol>
        </Modal>
      )}
    </>
  );
}

function TaskForm({ emps, date, onClose, onSaved }: { emps: Emp[]; date: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: '', description: '', priority: 'NORMAL' as Priority, assigneeId: emps[0]?.id ?? 0, plannedDate: date, dueDate: '' });
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/admin/tasks', { ...f, assigneeId: Number(f.assigneeId), dueDate: f.dueDate || null, description: f.description || null });
      onSaved();
    } catch (e) { setError((e as Error).message); }
  }
  return (
    <Modal open onClose={onClose} title="Ajouter une tâche">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Employé" required>
          <select className="input" value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: Number(e.target.value) })}>
            {emps.map((e) => <option key={e.id} value={e.id}>{e.lastName} {e.firstName} ({e.matricule})</option>)}
          </select>
        </Field>
        <Field label="Tâche" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={2} /></Field>
        <Field label="Description"><textarea className="input min-h-20" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Priorité">
            <select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
              {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
            </select>
          </Field>
          <Field label="Prévue le"><input type="date" className="input" value={f.plannedDate} onChange={(e) => setF({ ...f, plannedDate: e.target.value })} required /></Field>
          <Field label="Échéance"><input type="date" className="input" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={onClose}>Annuler</Button><Button type="submit">Ajouter</Button></div>
      </form>
    </Modal>
  );
}
