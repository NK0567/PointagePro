import { Smartphone, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type EventType } from '../../api';
import { useAuth } from '../../auth';
import { Alert, Badge, Button, Card, Field } from '../../components/ui';
import { EVENT_LABELS, ROLE_LABELS, dateTime, frDate, todayIso } from '../../lib/format';

interface Device { id: number; deviceLabel: string; createdAt: string; lastUsedAt: string | null; revoked: boolean }
interface Correction { id: number; workDate: string; type: EventType; requestedTime: string; reason: string; status: string; reviewComment: string | null }

export function Profile() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [form, setForm] = useState({ workDate: todayIso(), type: 'DEPARTURE' as EventType, requestedTime: '17:00', reason: '' });
  const [msg, setMsg] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);

  const load = useCallback(() => {
    api.get<Device[]>('/me/devices').then(setDevices);
    api.get<Correction[]>('/me/corrections').then(setCorrections);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function revoke(d: Device) {
    if (!confirm(`Retirer « ${d.deviceLabel} » ? Il ne pourra plus servir à pointer.`)) return;
    await api.post(`/me/devices/${d.id}/revoke`);
    load();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/me/corrections', form);
      setMsg({ tone: 'green', text: 'Demande envoyée. Un responsable va la traiter.' });
      setForm({ ...form, reason: '' });
      load();
    } catch (e) { setMsg({ tone: 'red', text: (e as Error).message }); }
  }

  return (
    <div className="space-y-5">
      <Card title="Mon profil">
        <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
          <div><dt className="text-slate-500">Nom</dt><dd className="font-medium">{user?.lastName} {user?.firstName}</dd></div>
          <div><dt className="text-slate-500">Matricule</dt><dd className="font-medium">{user?.matricule}</dd></div>
          <div><dt className="text-slate-500">Fonction</dt><dd className="font-medium">{user?.jobTitle}</dd></div>
          <div><dt className="text-slate-500">Rôle</dt><dd className="font-medium">{user && ROLE_LABELS[user.role]}</dd></div>
          <div className="col-span-2"><dt className="text-slate-500">Lieu de service</dt><dd className="font-medium">{user?.site?.name ?? 'Non affecté'}</dd></div>
        </dl>
      </Card>

      <Card title="Mes appareils biométriques">
        <ul className="divide-y divide-slate-100">
          {devices.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">Aucun appareil enregistré.</li>}
          {devices.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-5 py-3">
              <Smartphone className="h-5 w-5 text-slate-400" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-slate-900">{d.deviceLabel} {d.revoked && <Badge tone="red">Révoqué</Badge>}</p>
                <p className="text-xs text-slate-500">Ajouté le {dateTime(d.createdAt)}{d.lastUsedAt ? ` · utilisé le ${dateTime(d.lastUsedAt)}` : ''}</p>
              </div>
              {!d.revoked && <button onClick={() => revoke(d)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Retirer l'appareil"><Trash2 className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Nouveau téléphone ou téléphone perdu ? Demandez un nouveau code d'invitation à l'administrateur pour enregistrer votre empreinte sur un autre appareil.</p>
      </Card>

      <Card title="Signaler un pointage oublié">
        <form onSubmit={submit} className="space-y-4 p-5">
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input type="date" className="input" value={form.workDate} max={todayIso()} onChange={(e) => setForm({ ...form, workDate: e.target.value })} required /></Field>
            <Field label="Heure réelle"><input type="time" className="input" value={form.requestedTime} onChange={(e) => setForm({ ...form, requestedTime: e.target.value })} required /></Field>
          </div>
          <Field label="Pointage concerné">
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as EventType })}>
              {(Object.keys(EVENT_LABELS) as EventType[]).map((k) => <option key={k} value={k}>{EVENT_LABELS[k]}</option>)}
            </select>
          </Field>
          <Field label="Motif" required><textarea className="input min-h-20" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} minLength={5} required placeholder="Ex. téléphone déchargé au moment de pointer" /></Field>
          <Button type="submit" className="w-full">Envoyer la demande</Button>
        </form>
        {corrections.length > 0 && (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {corrections.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>{EVENT_LABELS[c.type]} · {frDate(c.workDate)} à {c.requestedTime}{c.reviewComment ? ` — ${c.reviewComment}` : ''}</span>
                <Badge tone={c.status === 'APPROVED' ? 'green' : c.status === 'REJECTED' ? 'red' : 'amber'}>{c.status === 'APPROVED' ? 'Acceptée' : c.status === 'REJECTED' ? 'Refusée' : 'En attente'}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
