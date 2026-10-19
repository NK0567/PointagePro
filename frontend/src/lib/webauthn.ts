import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from '../api';

export const webauthnSupported = () => browserSupportsWebAuthn();

function translate(e: unknown): Error {
  const err = e as { name?: string; message?: string };
  if (err?.name === 'NotAllowedError') return new Error("Authentification annulée ou délai dépassé. Touchez à nouveau le capteur d'empreinte.");
  if (err?.name === 'InvalidStateError') return new Error('Cet appareil est déjà enregistré pour ce compte.');
  if (err?.name === 'SecurityError') return new Error('Contexte non sécurisé : utilisez l\'adresse officielle en HTTPS.');
  if (err?.name === 'NotSupportedError') return new Error("Cet appareil ne propose pas d'authentification biométrique compatible.");
  return e instanceof Error ? e : new Error(String(e));
}

type Opts = { ticket: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] };

/** Demande l'empreinte à l'appareil et retourne la preuve signée (jamais l'empreinte elle-même). */
export async function biometricProof(optionsPath: string, body: unknown = {}) {
  const { ticket, options } = await api.post<Opts>(optionsPath, body);
  try {
    const response = await startAuthentication({ optionsJSON: options });
    return { ticket, response };
  } catch (e) {
    throw translate(e);
  }
}

export async function registerDevice(code: string, deviceLabel: string) {
  const { ticket, options } = await api.post<{ ticket: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('/auth/enroll/options', { code });
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (e) {
    throw translate(e);
  }
  return api.post<{ ok: boolean; status: string }>('/auth/enroll/verify', { code, ticket, response, deviceLabel });
}
