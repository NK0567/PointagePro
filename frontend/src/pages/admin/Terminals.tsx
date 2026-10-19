import { Copy, Cpu, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, type Site } from '../../api';
import { PageTitle } from '../../components/AdminLayout';
import { Alert, Badge, Button, Card, Empty, Field, Modal } from '../../components/ui';
import { dateTime } from '../../lib/format';

interface Terminal { id: number; name: string; keyPrefix: string; active: boolean; lastSeenAt: string | null; createdAt: string; site: { name: string } }

export function Terminals() {
  const [list, setList] = useState<Terminal[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', siteId: 0 });
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  const load = () => api.get<Terminal[]>('/admin/terminals').then(setList);
  useEffect(() => { load(); api.get<Site[]>('/admin/sites').then((s) => { setSites(s); setForm((f) => ({ ...f, siteId: s[0]?.id ?? 0 })); }); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const t = await api.post<{ apiKey: string }>('/admin/terminals', { name: form.name, siteId: Number(form.siteId) });
      setKey(t.apiKey);
      setOpen(false);
      load();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <PageTitle
        title="Terminaux biométriques"
        subtitle="Lecteurs d'empreintes fixes installés sur site (employés sans smartphone, zones à risque de fraude)"
        action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Déclarer un terminal</Button>}
      />
      {key && (
        <div className="mb-6">
          <Alert tone="amber" title="Clé d'API du terminal — affichée une seule fois">
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-white px-2 py-1 font-mono text-xs ring-1 ring-amber-200">{key}</code>
              <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(key)}><Copy className="h-3.5 w-3.5" /> Copier</Button>
            </div>
            <p className="mt-2">Configurez-la dans le logiciel du terminal (en-tête <code>X-Terminal-Key</code>). Elle n'est pas conservée en clair.</p>
          </Alert>
        </div>
      )}
      <Card>
        {list.length === 0 ? <Empty icon={<Cpu className="h-10 w-10" />} title="Aucun terminal déclaré">Les terminaux transmettent leurs pointages à <code>POST /api/terminal/events</code>, y compris après une coupure réseau.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-slate-50/80"><tr>{['Terminal', 'Site', 'Clé', 'Dernière synchro', 'État', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((t) => (
                  <tr key={t.id}>
                    <td className="td font-medium text-slate-900">{t.name}</td>
                    <td className="td">{t.site.name}</td>
                    <td className="td font-mono text-xs">pt_{t.keyPrefix}_…</td>
                    <td className="td">{t.lastSeenAt ? dateTime(t.lastSeenAt) : 'Jamais'}</td>
                    <td className="td">{t.active ? <Badge tone="green">Actif</Badge> : <Badge tone="red">Désactivé</Badge>}</td>
                    <td className="td text-right"><Button size="sm" variant="ghost" onClick={async () => { await api.post(`/admin/terminals/${t.id}/toggle`); load(); }}>{t.active ? 'Désactiver' : 'Réactiver'}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Déclarer un terminal">
        <form onSubmit={create} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Nom" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Terminal entrée principale" /></Field>
          <Field label="Site d'installation">
            <select className="input" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: Number(e.target.value) })}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </Field>
          <div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Annuler</Button><Button type="submit">Générer la clé</Button></div>
        </form>
      </Modal>
    </>
  );
}
