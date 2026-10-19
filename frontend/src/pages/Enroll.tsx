import { ArrowLeft, CheckCircle2, Fingerprint, Hand, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Alert, Button, Field, FingerprintButton, Logo } from '../components/ui';
import { registerDevice, webauthnSupported } from '../lib/webauthn';

interface Invite {
  employee: { matricule: string; firstName: string; lastName: string; jobTitle: string; site: string | null; status: string };
  devices: number;
}

function guessDevice() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Téléphone Android';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Windows/i.test(ua)) return 'Ordinateur Windows';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'Appareil';
}

export function Enroll() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [label, setLabel] = useState(guessDevice());
  const [fingers, setFingers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<string | null>(null);

  async function check(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      setInvite(await api.post<Invite>('/auth/enroll/check', { code: code.trim().toUpperCase() }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setError('');
    setBusy(true);
    try {
      const r = await registerDevice(code.trim().toUpperCase(), label);
      setResult(r.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-brand-50 to-[#f4f7fc] px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <Link to="/connexion" className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-brand-700"><ArrowLeft className="h-4 w-4" /> Connexion</Link>
        </div>

        <div className="card p-6">
          <h1 className="text-xl font-bold text-slate-900">Enregistrement de l'empreinte</h1>

          {result ? (
            <div className="py-6 text-center">
              <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500" />
              <p className="mt-4 text-lg font-semibold text-slate-900">Empreinte enregistrée</p>
              {result === 'PENDING' ? (
                <p className="mt-2 text-sm text-slate-600">Votre compte doit maintenant être <strong>validé par l'administrateur</strong>. Vous recevrez l'accès dès la validation.</p>
              ) : (
                <p className="mt-2 text-sm text-slate-600">Ce téléphone peut désormais être utilisé pour vous connecter et pointer.</p>
              )}
              <Link to="/connexion"><Button className="mt-6 w-full">Aller à la connexion</Button></Link>
            </div>
          ) : !invite ? (
            <form onSubmit={check} className="mt-4 space-y-4">
              <p className="text-sm text-slate-600">Saisissez le code d'invitation remis par le service RH. Il garantit que seul un employé réellement recruté peut créer son accès.</p>
              {error && <Alert>{error}</Alert>}
              <Field label="Code d'invitation" required>
                <input className="input text-center font-mono text-lg uppercase tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXXXXX" maxLength={12} required />
              </Field>
              <Button type="submit" className="w-full" loading={busy}>Continuer</Button>
            </form>
          ) : (
            <div className="mt-4 space-y-5">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Employé</p>
                <p className="mt-1 font-semibold text-slate-900">{invite.employee.lastName} {invite.employee.firstName}</p>
                <p className="text-sm text-slate-600">{invite.employee.jobTitle} · {invite.employee.matricule}</p>
                {invite.employee.site && <p className="text-sm text-slate-600">Lieu de service : {invite.employee.site}</p>}
                {invite.devices > 0 && <p className="mt-2 text-xs text-amber-700">{invite.devices} appareil(s) déjà enregistré(s) : vous ajoutez un nouvel appareil.</p>}
              </div>

              <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4 text-sm text-brand-900">
                <p className="flex items-center gap-2 font-semibold"><Hand className="h-4 w-4" /> Avant de continuer</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>Dans les <strong>réglages de votre téléphone</strong>, enregistrez au moins <strong>deux doigts</strong> (par exemple les deux index), en variant les angles.</li>
                  <li>Revenez ici et touchez le bouton : votre téléphone vous demandera votre empreinte.</li>
                </ol>
                <p className="mt-2 flex items-start gap-2 text-xs text-brand-800/80"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Votre empreinte ne quitte jamais le téléphone : PointagePro reçoit uniquement une clé cryptographique qui prouve que c'est bien vous.</p>
              </div>

              <label className="flex items-start gap-3 text-sm text-slate-700">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={fingers} onChange={(e) => setFingers(e.target.checked)} />
                J'ai enregistré au moins deux doigts dans les réglages de mon téléphone.
              </label>

              <Field label="Nom de cet appareil"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} /></Field>

              {!webauthnSupported() && <Alert tone="amber">Ce navigateur ne prend pas en charge la biométrie. Utilisez Chrome, Safari ou Edge à jour, ou le poste de pointage de l'entreprise.</Alert>}
              {error && <Alert>{error}</Alert>}

              <div className="flex flex-col items-center pt-2">
                <FingerprintButton onClick={fingers ? register : undefined} busy={busy} size="md" label="Enregistrer mon empreinte" />
                <Button className="mt-5 w-full" onClick={register} loading={busy} disabled={!fingers}>
                  <Fingerprint className="h-4 w-4" /> Enregistrer mon empreinte
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
