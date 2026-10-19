import { AlertTriangle, Bell, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type Notification } from '../../api';
import { Button, Empty, Spinner } from '../../components/ui';
import { dateTime } from '../../lib/format';

const ICON = {
  success: <CheckCircle2 className="h-6 w-6 text-emerald-500" />,
  danger: <XCircle className="h-6 w-6 text-red-500" />,
  warning: <AlertTriangle className="h-6 w-6 text-amber-500" />,
  info: <Info className="h-6 w-6 text-brand-600" />,
};

export function Notifications() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const load = () => api.get<Notification[]>('/me/notifications').then(setItems);
  useEffect(() => { load(); }, []);
  if (!items) return <Spinner />;
  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
        {unread > 0 && <Button size="sm" variant="secondary" onClick={async () => { await api.post('/me/notifications/read-all'); load(); }}>Tout marquer comme lu</Button>}
      </div>
      <div className="card divide-y divide-slate-100">
        {items.length === 0 && <Empty icon={<Bell className="h-10 w-10" />} title="Aucune notification" />}
        {items.map((n) => (
          <div key={n.id} className={`flex gap-4 px-5 py-4 ${n.read ? '' : 'bg-brand-50/40'}`}>
            <div className="shrink-0">{ICON[n.level]}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-slate-900">{n.title}</p>
                <span className="shrink-0 text-xs text-slate-400">{dateTime(n.createdAt)}</span>
              </div>
              <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
