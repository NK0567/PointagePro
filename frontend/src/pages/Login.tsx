import { ClipboardCheck, Fingerprint, KeyRound, MapPin, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, type User } from '../api';
import { isManager, useAuth } from '../auth';
import { Alert, Button, Field, FingerprintButton, Logo } from '../components/ui';
import { biometricProof, webauthnSupported } from '../lib/webauthn';

export function Login() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [mode, setMode] = useState<'empreinte' | 'admin'>('empreinte');
  const [matricule, setMatricule] = useState(() => { try { return localStorage.getItem('pp_matricule') ?? ''; } catch { return ''; } });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Navigate to={isManager(user.role) ? '/admin' : '/moi'} replace />;

  const done = (u: User) => {
    setUser(u);
    const from = (loc.state as { from?: string } | null)?.from;
    nav(from ?? (isManager(u.role) ? '/admin' : '/moi'), { replace: true });
  };

  async function withFingerprint() {
    setError('');
    setBusy(true);
    try {
      const m = matricule.trim().toUpperCase();
      const proof = await biometricProof('/auth/webauthn/login/options', m ? { matricule: m } : {});
      const r = await api.post<{ user: User }>('/auth/webauthn/login/verify', proof);
      try { localStorage.setItem('pp_matricule', r.user.matricule); } catch { /* stockage indisponible */ }
      done(r.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function withPassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api.post<{ user: User }>('/auth/login', { email, password });
      done(r.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      {/* Panneau de présentation */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-navy-950 via-navy-900 to-brand-800 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -bottom-32 left-10 h-80 w-80 rounded-full bg-brand-600/20 blur-3xl" />
        <Logo light />
        <div className="relative my-auto max-w-md">
          <Fingerprint className="mb-6 h-20 w-20 text-brand-200" strokeWidth={1.2} />
          <h1 className="text-4xl font-bold leading-tight">Votre présence, notre confiance.</h1>
          <p className="mt-4 text-lg text-blue-100/80">Le pointage sécurisé par empreinte, contrôlé sur le lieu de travail, avec le suivi des tâches de chaque journée.</p>
          <ul className="mt-10 space-y-5">
            {[
              [ShieldCheck, 'Sécurisé par empreinte digitale', "Personne ne peut pointer à votre place."],
              [MapPin, 'Géolocalisation du lieu de travail', 'Le pointage n\'est accepté que sur le site.'],
              [ClipboardCheck, 'Gestion des tâches', 'Les tâches non terminées passent au lendemain.'],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof ShieldCheck;
              return (
                <li key={t as string} className="flex gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10"><I className="h-5 w-5" /></div>
                  <div><p className="font-semibold">{t as string}</p><p className="text-sm text-blue-100/70">{d as string}</p></div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Formulaire */}
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h2 className="text-2xl font-bold text-slate-900">Connexion</h2>

          <div className="mt-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-medium">
            {(['empreinte', 'admin'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(''); }} className={`rounded-lg py-2 transition ${mode === m ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>
                {m === 'empreinte' ? 'Employé' : 'Administration'}
              </button>
            ))}
          </div>

          {error && <div className="mt-5"><Alert>{error}</Alert></div>}

          {mode === 'empreinte' ? (
            <div className="mt-6">
              <Field label="Matricule" hint="Facultatif si votre téléphone propose directement votre compte.">
                <input className="input uppercase" value={matricule} onChange={(e) => setMatricule(e.target.value)} placeholder="EMP-0001" autoComplete="username webauthn" />
              </Field>
              <div className="mt-8 flex flex-col items-center text-center">
                <FingerprintButton onClick={withFingerprint} busy={busy} label="Se connecter avec mon empreinte" />
                <p className="mt-5 text-sm text-slate-600">Touchez l'icône puis posez votre doigt sur le capteur de votre téléphone.</p>
                {!webauthnSupported() && <div className="mt-4"><Alert tone="amber">Ce navigateur ne prend pas en charge l'authentification biométrique. Utilisez un navigateur récent (Chrome, Safari, Edge) ou le poste de pointage de l'entreprise.</Alert></div>}
                <Button className="mt-6 w-full" size="lg" onClick={withFingerprint} loading={busy}>
                  <Fingerprint className="h-5 w-5" /> Se connecter
                </Button>
              </div>
              <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-600">
                Première utilisation ou nouveau téléphone ?{' '}
                <Link to="/inscription" className="font-semibold text-brand-700 hover:underline">Enregistrer mon empreinte</Link>
                <p className="mt-1 text-xs text-slate-500">Un code d'invitation délivré par l'administrateur est nécessaire.</p>
              </div>
            </div>
          ) : (
            <form onSubmit={withPassword} className="mt-6 space-y-4">
              <Field label="Adresse e-mail"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></Field>
              <Field label="Mot de passe"><input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
              <Button type="submit" className="w-full" size="lg" loading={busy}><KeyRound className="h-5 w-5" /> Se connecter</Button>
              <p className="text-center text-xs text-slate-500">Réservé aux administrateurs, agents de pointage, chefs d'équipe et à la direction.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
