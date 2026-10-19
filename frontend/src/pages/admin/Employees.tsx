import { CheckCircle2, Copy, KeyRound, Pencil, Plus, Search, ShieldOff, Smartphone, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Role, type Site } from '../../api';
import { isAdmin, useAuth } from '../../auth';
import { PageTitle } from '../../components/AdminLayout';
import { Alert, Badge, Button, Card, Empty, Field, Modal, Spinner } from '../../components/ui';
import { ACCOUNT_STATUS, ROLE_LABELS, dateTime } from '../../lib/format';

interface Emp {
  id: number; matricule: string; firstName: string; lastName: string; email: string | null; phone: string | null;
  role: Role; status: string; jobTitle: string; department: string | null; siteId: number | null; managerId: number | null;
  inviteCode: string | null; inviteExpiresAt: string | null; hasPin: boolean; devices: number;
  site: { id: number; name: string } | null; manager: { id: number; firstName: string; lastName: string } | null;
  deviceList?: { id: number; deviceLabel: string; createdAt: string; lastUsedAt: string | null; revoked: boolean }[];
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'blue' | 'red'> = { ACTIVE: 'green', PENDING: 'amber', INVITED: 'blue', SUSPENDED: 'red' };

export function Employees() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<Emp[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [q, setQ] = useState('');
  const status = params.get('status') ?? '';
  const [editing, setEditing] = useState<Emp | 'new' | null>(null);
  const [detail, setDetail] = useState<Emp | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) });
    api.get<Emp[]>(`/admin/users?${qs}`).then(setList);
  }, [q, status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<Site[]>('/admin/sites').then(setSites); }, []);

  const openDetail = async (e: Emp) => setDetail(await api.get<Emp>(`/admin/users/${e.id}`));

  return (
    <>
      <PageTitle
        title="Employés"
        subtitle="Fiches du personnel, comptes, appareils biométriques et affectations"
        action={admin && <Button onClick={() => setEditing('new')}><UserPlus className="h-4 w-4" /> Nouvel employé</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Rechercher (nom, matricule, fonction)" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
          <option value="">Tous les statuts</option>
          {Object.entries(ACCOUNT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <Card>
        {!list ? <Spinner /> : list.length === 0 ? <Empty title="Aucun employé trouvé" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead className="bg-slate-50/80"><tr>{['Employé', 'Fonction', 'Rôle', 'Lieu de service', 'Empreinte', 'Statut', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((e) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => openDetail(e)}>
                    <td className="td"><p className="font-medium text-slate-900">{e.lastName} {e.firstName}</p><p className="text-xs text-slate-500">{e.matricule}</p></td>
                    <td className="td">{e.jobTitle}<p className="text-xs text-slate-500">{e.department}</p></td>
                    <td className="td">{ROLE_LABELS[e.role]}</td>
                    <td className="td">{e.site?.name ?? <span className="text-slate-400">Non affecté</span>}</td>
                    <td className="td">{e.devices > 0 ? <Badge tone="green">{e.devices} appareil(s)</Badge> : <Badge tone="slate">Aucune</Badge>}</td>
                    <td className="td"><Badge tone={STATUS_TONE[e.status]}>{ACCOUNT_STATUS[e.status]}</Badge></td>
                    <td className="td text-right">
                      {admin && e.status === 'PENDING' && (
                        <Button size="sm" variant="success" onClick={async (ev) => { ev.stopPropagation(); await api.post(`/admin/users/${e.id}/status`, { status: 'ACTIVE' }); load(); }}>
                          <CheckCircle2 className="h-4 w-4" /> Valider
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <EmployeeForm
          initial={editing === 'new' ? null : editing}
          sites={sites}
          managers={(list ?? []).filter((x) => x.role === 'CHEF' || x.role === 'ADMIN_RH' || x.role === 'SUPER_ADMIN')}
          canSuper={user?.role === 'SUPER_ADMIN'}
          onClose={() => setEditing(null)}
          onSaved={(e) => { setEditing(null); load(); openDetail(e); }}
        />
      )}
      {detail && (
        <EmployeeDetail
          emp={detail}
          admin={admin}
          selfId={user!.id}
          onClose={() => setDetail(null)}
          onEdit={() => { setEditing(detail); setDetail(null); }}
          onChanged={async () => { load(); setDetail(await api.get<Emp>(`/admin/users/${detail.id}`)); }}
        />
      )}
    </>
  );
}

function EmployeeForm({ initial, sites, managers, canSuper, onClose, onSaved }: {
  initial: Emp | null; sites: Site[]; managers: Emp[]; canSuper: boolean; onClose: () => void; onSaved: (e: Emp) => void;
}) {
  const [f, setF] = useState({
    firstName: initial?.firstName ?? '', lastName: initial?.lastName ?? '', jobTitle: initial?.jobTitle ?? '',
    department: initial?.department ?? '', email: initial?.email ?? '', phone: initial?.phone ?? '',
    role: (initial?.role ?? 'EMPLOYE') as Role, siteId: initial?.siteId ?? sites[0]?.id ?? null, managerId: initial?.managerId ?? null,
    matricule: initial?.matricule ?? '', password: '', pin: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = { ...f, siteId: f.siteId ? Number(f.siteId) : null, managerId: f.managerId ? Number(f.managerId) : null, matricule: f.matricule || undefined };
    try {
      const saved = initial ? await api.patch<Emp>(`/admin/users/${initial.id}`, body) : await api.post<Emp>('/admin/users', body);
      onSaved(saved);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const staff = f.role !== 'EMPLOYE';
  return (
    <Modal open onClose={onClose} title={initial ? `Modifier ${initial.firstName} ${initial.lastName}` : 'Nouvel employé'} wide>
      <form onSubmit={submit} className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom" required><input className="input" value={f.lastName} onChange={set('lastName')} required /></Field>
          <Field label="Prénom" required><input className="input" value={f.firstName} onChange={set('firstName')} required /></Field>
          <Field label="Fonction" required><input className="input" value={f.jobTitle} onChange={set('jobTitle')} required placeholder="Technicien" /></Field>
          <Field label="Service"><input className="input" value={f.department} onChange={set('department')} placeholder="Maintenance" /></Field>
          <Field label="Lieu de service" required>
            <select className="input" value={f.siteId ?? ''} onChange={set('siteId')}>
              <option value="">— Aucun —</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Responsable">
            <select className="input" value={f.managerId ?? ''} onChange={set('managerId')}>
              <option value="">— Aucun —</option>
              {managers.filter((m) => m.id !== initial?.id).map((m) => <option key={m.id} value={m.id}>{m.lastName} {m.firstName} ({ROLE_LABELS[m.role]})</option>)}
            </select>
          </Field>
          <Field label="Rôle">
            <select className="input" value={f.role} onChange={set('role')}>
              {(Object.keys(ROLE_LABELS) as Role[]).filter((r) => canSuper || r !== 'SUPER_ADMIN').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </Field>
          {!initial && <Field label="Matricule" hint="Laissez vide pour une numérotation automatique (EMP-0007…)"><input className="input uppercase" value={f.matricule} onChange={set('matricule')} /></Field>}
          <Field label="Téléphone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
          <Field label={staff ? 'E-mail (connexion administration)' : 'E-mail'}><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
          {staff && <Field label={initial ? 'Nouveau mot de passe' : 'Mot de passe'} hint="8 caractères minimum. Laissez vide pour une connexion par empreinte uniquement."><input className="input" type="password" value={f.password} onChange={set('password')} minLength={8} autoComplete="new-password" /></Field>}
          <Field label={initial?.hasPin ? 'Nouveau PIN kiosque' : 'PIN kiosque'} hint="4 à 6 chiffres. Pour pointer sur le poste partagé, sous la supervision de l'agent."><input className="input" inputMode="numeric" value={f.pin} onChange={set('pin')} pattern="\d{4,6}" /></Field>
        </div>
        {!initial && <Alert tone="blue">Un <strong>code d'invitation</strong> (valable 7 jours) sera généré : remettez-le à l'employé pour qu'il enregistre son empreinte. Son compte restera « À valider » jusqu'à votre validation.</Alert>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" loading={busy}>{initial ? 'Enregistrer' : <><Plus className="h-4 w-4" /> Créer la fiche</>}</Button>
        </div>
      </form>
    </Modal>
  );
}

function EmployeeDetail({ emp, admin, selfId, onClose, onEdit, onChanged }: { emp: Emp; admin: boolean; selfId: number; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); onChanged(); } catch (e) { setError((e as Error).message); }
  };
  const inviteLink = emp.inviteCode ? `${location.origin}/inscription?code=${emp.inviteCode}` : '';
  const valid = emp.inviteExpiresAt && new Date(emp.inviteExpiresAt) > new Date();

  return (
    <Modal open onClose={onClose} title={`${emp.lastName} ${emp.firstName}`} wide>
      <div className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[emp.status]}>{ACCOUNT_STATUS[emp.status]}</Badge>
          <Badge>{ROLE_LABELS[emp.role]}</Badge>
          <Badge>{emp.matricule}</Badge>
          {emp.hasPin && <Badge tone="violet">PIN kiosque défini</Badge>}
        </div>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-slate-500">Fonction</dt><dd className="font-medium">{emp.jobTitle}</dd></div>
          <div><dt className="text-slate-500">Service</dt><dd className="font-medium">{emp.department ?? '—'}</dd></div>
          <div><dt className="text-slate-500">Lieu de service</dt><dd className="font-medium">{emp.site?.name ?? '—'}</dd></div>
          <div><dt className="text-slate-500">Responsable</dt><dd className="font-medium">{emp.manager ? `${emp.manager.lastName} ${emp.manager.firstName}` : '—'}</dd></div>
          <div><dt className="text-slate-500">Téléphone</dt><dd className="font-medium">{emp.phone ?? '—'}</dd></div>
          <div><dt className="text-slate-500">E-mail</dt><dd className="font-medium break-all">{emp.email ?? '—'}</dd></div>
        </dl>

        {admin && emp.inviteCode && valid && (
          <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
            <p className="text-sm font-semibold text-brand-900">Code d'invitation (enregistrement de l'empreinte)</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="rounded-lg bg-white px-3 py-1.5 font-mono text-lg font-bold tracking-[0.25em] text-brand-800 ring-1 ring-brand-200">{emp.inviteCode}</span>
              <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(inviteLink)}><Copy className="h-3.5 w-3.5" /> Copier le lien</Button>
            </div>
            <p className="mt-2 text-xs text-brand-800/80">Valable jusqu'au {dateTime(emp.inviteExpiresAt!)} · usage unique · lien : {inviteLink}</p>
          </div>
        )}

        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-900">Appareils biométriques</h4>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {(emp.deviceList ?? []).length === 0 && <li className="px-4 py-3 text-sm text-slate-500">Aucune empreinte enregistrée.</li>}
            {(emp.deviceList ?? []).map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <Smartphone className="h-4 w-4 text-slate-400" />
                <div className="flex-1">
                  <p className="font-medium">{d.deviceLabel} {d.revoked && <Badge tone="red">Révoqué</Badge>}</p>
                  <p className="text-xs text-slate-500">Ajouté le {dateTime(d.createdAt)}{d.lastUsedAt ? ` · dernier usage ${dateTime(d.lastUsedAt)}` : ''}</p>
                </div>
                {admin && !d.revoked && <Button size="sm" variant="ghost" onClick={() => confirm('Révoquer cet appareil ?') && run(() => api.post(`/admin/devices/${d.id}/revoke`))}>Révoquer</Button>}
              </li>
            ))}
          </ul>
        </div>

        {admin && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={onEdit}><Pencil className="h-4 w-4" /> Modifier</Button>
            <Button variant="secondary" onClick={() => run(() => api.post(`/admin/users/${emp.id}/invite`))}><KeyRound className="h-4 w-4" /> {emp.devices ? 'Code pour un nouvel appareil' : 'Nouveau code d\'invitation'}</Button>
            {emp.id !== selfId && (emp.status === 'ACTIVE' ? (
              <Button variant="danger" onClick={() => confirm('Suspendre ce compte ? L\'employé ne pourra plus se connecter ni pointer.') && run(() => api.post(`/admin/users/${emp.id}/status`, { status: 'SUSPENDED' }))}><ShieldOff className="h-4 w-4" /> Suspendre</Button>
            ) : (
              <Button variant="success" onClick={() => run(() => api.post(`/admin/users/${emp.id}/status`, { status: 'ACTIVE' }))}><CheckCircle2 className="h-4 w-4" /> {emp.status === 'SUSPENDED' ? 'Réactiver' : 'Valider le compte'}</Button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
