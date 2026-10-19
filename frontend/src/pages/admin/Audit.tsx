import { useEffect, useState } from 'react';
import { api } from '../../api';
import { PageTitle } from '../../components/AdminLayout';
import { Button, Card, Spinner } from '../../components/ui';
import { dateTime } from '../../lib/format';

interface Item { id: number; action: string; entity: string | null; entityId: string | null; details: unknown; ip: string | null; createdAt: string; actor: { firstName: string; lastName: string; matricule: string } | null }

const LABELS: Record<string, string> = {
  LOGIN_WEBAUTHN: 'Connexion par empreinte', LOGIN_PASSWORD: 'Connexion par mot de passe', LOGIN_FAILED: 'Échec de connexion',
  DEVICE_ENROLLED: 'Empreinte enregistrée', DEVICE_REVOKED: 'Appareil révoqué', USER_CREATED: 'Fiche employé créée', USER_UPDATED: 'Fiche employé modifiée',
  USER_ACTIVATED: 'Compte validé', USER_SUSPENDED: 'Compte suspendu', INVITE_ISSUED: "Code d'invitation émis", SITE_CREATED: 'Site créé', SITE_UPDATED: 'Site modifié',
  ATTENDANCE_VOID: 'Pointage annulé', ATTENDANCE_REVIEWED: 'Pointage vérifié', CORRECTION_APPROVED: 'Correction acceptée', CORRECTION_REJECTED: 'Correction refusée',
  REPORT_EXPORTED: 'Rapport exporté', TERMINAL_CREATED: 'Terminal déclaré', TERMINAL_ENABLED: 'Terminal réactivé', TERMINAL_DISABLED: 'Terminal désactivé',
  TERMINAL_SYNC: 'Synchronisation terminal', KIOSK_PIN_FAILED: 'PIN kiosque erroné',
};

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: Item[] } | null>(null);
  useEffect(() => { setData(null); api.get<{ total: number; items: Item[] }>(`/admin/audit?page=${page}`).then(setData); }, [page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;

  return (
    <>
      <PageTitle title="Journal d'audit" subtitle="Toute action sensible est tracée : auteur, date, détail et anciennes valeurs" />
      <Card>
        {!data ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50/80"><tr>{['Date', 'Auteur', 'Action', 'Objet', 'Détails'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((i) => (
                  <tr key={i.id} className="align-top">
                    <td className="td whitespace-nowrap tabular-nums">{dateTime(i.createdAt)}</td>
                    <td className="td">{i.actor ? `${i.actor.lastName} ${i.actor.firstName}` : <span className="text-slate-400">Système</span>}</td>
                    <td className="td font-medium text-slate-900">{LABELS[i.action] ?? i.action}</td>
                    <td className="td text-xs text-slate-500">{i.entity ? `${i.entity} #${i.entityId ?? ''}` : '—'}</td>
                    <td className="td"><code className="block max-w-md truncate text-xs text-slate-500" title={JSON.stringify(i.details)}>{i.details ? JSON.stringify(i.details) : ''}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
          <span>{data?.total ?? 0} entrée(s)</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</Button>
            <span>{page} / {pages}</span>
            <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Suivant</Button>
          </div>
        </div>
      </Card>
    </>
  );
}
