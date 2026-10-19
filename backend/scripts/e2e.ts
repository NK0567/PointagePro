/**
 * Test de bout en bout de l'API avec un authentificateur WebAuthn logiciel (ES256).
 * Simule ce que fait le téléphone : clé privée locale, signature après « vérification biométrique ».
 * Prérequis : API démarrée (npm run dev) et base de démonstration (npm run db:seed).
 * Lancer : npm run test:e2e   — puis relancer npm run db:seed pour retrouver des données propres.
 */
import crypto from 'node:crypto';

const API = process.env.API ?? 'http://localhost:4500/api';
const ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5250';
const RP_ID = process.env.RP_ID ?? 'localhost';
const SITE = { lat: 4.0712, lon: 9.6858 }; // Entrepôt principal (seed)

// ------------------------------------------------------------------ mini CBOR
function cborHead(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b;
}
function cbor(v: unknown): Buffer {
  if (typeof v === 'number') return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  if (typeof v === 'string') { const s = Buffer.from(v, 'utf8'); return Buffer.concat([cborHead(3, s.length), s]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([cborHead(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([cborHead(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('type CBOR non géré');
}

const b64u = (b: Buffer) => b.toString('base64url');
const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest();

class SoftAuthenticator {
  key = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  credId = crypto.randomBytes(32);
  counter = 0;

  register(options: { challenge: string }) {
    const jwk = this.key.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const len = Buffer.alloc(2); len.writeUInt16BE(this.credId.length);
    const authData = Buffer.concat([sha256(RP_ID), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, this.credId, cose]);
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: ORIGIN, crossOrigin: false }));
    return {
      id: b64u(this.credId), rawId: b64u(this.credId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientData), attestationObject: b64u(cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))), transports: ['internal'] },
    };
  }

  /** flags 0x05 = présence (UP) + vérification de l'utilisateur (UV, l'empreinte) */
  sign(options: { challenge: string }, flags = 0x05) {
    this.counter++;
    const cnt = Buffer.alloc(4); cnt.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha256(RP_ID), Buffer.from([flags]), cnt]);
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: ORIGIN, crossOrigin: false }));
    const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.key.privateKey);
    return {
      id: b64u(this.credId), rawId: b64u(this.credId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature) },
    };
  }
}

// ------------------------------------------------------------------ client HTTP
class Client {
  cookie = '';
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const r = await fetch(API + path, {
      method,
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const type = r.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data: data as any, type };
  }
}

let failures = 0;
function check(label: string, cond: boolean, info?: unknown) {
  console.log(`${cond ? '✔' : '✘'} ${label}${!cond && info !== undefined ? ' → ' + JSON.stringify(info).slice(0, 300) : ''}`);
  if (!cond) failures++;
}

const inZone = { latitude: SITE.lat + 0.0002, longitude: SITE.lon + 0.0001, accuracy: 15 };
const atHome = { latitude: 4.0500, longitude: 9.7600, accuracy: 12 };

async function enroll(code: string, auth: SoftAuthenticator) {
  const c = new Client();
  const o = await c.call('POST', '/auth/enroll/options', { code });
  if (o.status !== 200) return o;
  const v = await c.call('POST', '/auth/enroll/verify', { code, ticket: o.data.ticket, response: auth.register(o.data.options), deviceLabel: 'Test e2e' });
  return v;
}

async function login(matricule: string, auth: SoftAuthenticator) {
  const c = new Client();
  const o = await c.call('POST', '/auth/webauthn/login/options', { matricule });
  const v = await c.call('POST', '/auth/webauthn/login/verify', { ticket: o.data.ticket, response: auth.sign(o.data.options) });
  return { c, v };
}

async function punch(c: Client, auth: SoftAuthenticator, type: string, geo: unknown, extra: Record<string, unknown> = {}) {
  const o = await c.call('POST', '/me/punch/options', {});
  return c.call('POST', '/me/punch', { ticket: o.data.ticket, response: auth.sign(o.data.options), type, geo, ...extra });
}

async function main() {
  const health = await new Client().call('GET', '/health');
  check('API joignable', health.status === 200, health);

  // 1. Enrôlement d'un employé actif (nouvel appareil) puis connexion par empreinte
  const k1 = new SoftAuthenticator();
  const e1 = await enroll('DEMO1AX2', k1);
  check('Enrôlement empreinte EMP-0001', e1.status === 200 && e1.data.status === 'ACTIVE', e1.data);
  const reuse = await enroll('DEMO1AX2', new SoftAuthenticator());
  check('Code d\'invitation à usage unique', reuse.status === 400, reuse.data);

  const { c: emp, v: lv } = await login('EMP-0001', k1);
  check('Connexion par empreinte', lv.status === 200 && lv.data.user.matricule === 'EMP-0001', lv.data);

  const noUv = await (async () => {
    const c = new Client();
    const o = await c.call('POST', '/auth/webauthn/login/options', { matricule: 'EMP-0001' });
    return c.call('POST', '/auth/webauthn/login/verify', { ticket: o.data.ticket, response: k1.sign(o.data.options, 0x01) });
  })();
  check('Refus sans vérification biométrique (UV)', noUv.status === 401, noUv.data);

  // 2. Règles de pointage
  let r = await punch(emp, k1, 'ARRIVAL', atHome);
  check('Refus hors zone (domicile)', r.status === 422 && r.data.code === 'OUT_OF_ZONE', r.data);
  r = await punch(emp, k1, 'ARRIVAL', { ...inZone, accuracy: 400 });
  check('Refus position imprécise', r.status === 422 && r.data.code === 'LOW_ACCURACY', r.data);
  r = await punch(emp, k1, 'BREAK_START', inZone);
  check('Refus pause avant arrivée', r.status === 422 && r.data.code === 'SEQUENCE', r.data);
  r = await punch(emp, k1, 'ARRIVAL', inZone, { tasks: ['Vérifier les machines', 'Contrôler les stocks', 'Nettoyer la zone B'] });
  check('Arrivée dans la zone + déclaration des tâches', r.status === 200 && r.data.tasks?.created === 3, r.data);
  r = await punch(emp, k1, 'ARRIVAL', inZone);
  check('Refus double arrivée', r.status === 422 && r.data.code === 'SEQUENCE', r.data);

  // Une autre personne ne peut pas pointer à la place de EMP-0001
  const k2 = new SoftAuthenticator();
  await enroll('DEMO2BY2', k2);
  const o = await emp.call('POST', '/me/punch/options', {});
  r = await emp.call('POST', '/me/punch', { ticket: o.data.ticket, response: k2.sign(o.data.options), type: 'BREAK_START', geo: inZone });
  check('Empreinte d\'un collègue refusée', r.status === 401, r.data);

  r = await punch(emp, k1, 'BREAK_START', inZone);
  check('Départ en pause', r.status === 200, r.data);
  r = await punch(emp, k1, 'DEPARTURE', inZone);
  check('Refus fin de journée pendant la pause', r.status === 422 && r.data.code === 'SEQUENCE', r.data);
  r = await punch(emp, k1, 'BREAK_END', inZone);
  check('Retour de pause', r.status === 200, r.data);

  const today = await emp.call('GET', '/me/today');
  check('Tâches du jour (dont report de la veille)', today.data.tasks.some((t: any) => t.carryCount > 0), today.data.tasks.map((t: any) => [t.title, t.carryCount]));
  const done = today.data.tasks.slice(0, 2).map((t: any) => t.id);
  r = await punch(emp, k1, 'DEPARTURE', inZone, { doneTaskIds: done });
  check('Fin de journée + report automatique', r.status === 200 && r.data.tasks.done === 2 && r.data.tasks.carried >= 1, r.data);
  const after = await emp.call('GET', '/me/today');
  check('Journée clôturée', after.data.day.state === 'DONE' && after.data.allowed.length === 0, after.data.day);

  // 3. Invitation → validation RH
  const k3 = new SoftAuthenticator();
  const e3 = await enroll('BIENVENU', k3);
  check('Nouvel employé : compte en attente de validation', e3.data.status === 'PENDING', e3.data);
  const pend = await login('EMP-0006', k3);
  check('Connexion refusée avant validation', pend.v.status === 403, pend.v.data);

  const admin = new Client();
  const al = await admin.call('POST', '/auth/login', { email: 'admin@pointagepro.cm', password: 'Admin@2026' });
  check('Connexion administrateur', al.status === 200, al.data);
  const users = await admin.call('GET', '/admin/users?q=EMP-0006');
  const act = await admin.call('POST', `/admin/users/${users.data[0].id}/status`, { status: 'ACTIVE' });
  check('Validation du compte par les RH', act.status === 200, act.data);
  check('Connexion après validation', (await login('EMP-0006', k3)).v.status === 200);

  const forbidden = await emp.call('GET', '/admin/users');
  check('Un employé n\'accède pas à l\'administration', forbidden.status === 403, forbidden.data);

  // 4. Tableau de bord et exports
  const dash = await admin.call('GET', '/admin/dashboard');
  check('Tableau de bord', dash.status === 200 && dash.data.stats.present >= 1, dash.data.stats);
  for (const format of ['xlsx', 'csv', 'pdf']) {
    const x = await admin.call('GET', `/reports/export?kind=daily&format=${format}`);
    check(`Export journalier ${format.toUpperCase()}`, x.status === 200 && Buffer.isBuffer(x.data) && x.data.length > 200, { status: x.status, type: x.type });
  }
  const period = await admin.call('GET', `/reports/period?from=${dash.data.date.slice(0, 8)}01&to=${dash.data.date}`);
  check('Synthèse de période', period.status === 200 && period.data.rows.length >= 5, period.data);

  // 5. Poste partagé (kiosque) avec PIN supervisé
  const agent = new Client();
  await agent.call('POST', '/auth/login', { email: 'agent@pointagepro.cm', password: 'Agent@2026' });
  r = await agent.call('POST', '/kiosk/punch', { matricule: 'EMP-0003', pin: '0000', type: 'ARRIVAL', geo: inZone });
  check('Kiosque : PIN erroné refusé', r.status === 401, r.data);
  r = await agent.call('POST', '/kiosk/punch', { matricule: 'EMP-0003', pin: '1234', type: 'ARRIVAL', geo: inZone });
  check('Kiosque : arrivée par PIN', r.status === 200 && r.data.method === 'pin', r.data);

  // 6. Terminal biométrique : synchronisation idempotente / hors ligne
  const term = await admin.call('POST', '/admin/terminals', { name: 'Terminal entrée', siteId: dash.data.rows[0] ? (await admin.call('GET', '/admin/sites')).data.find((s: any) => s.name === 'Entrepôt principal').id : 1 });
  const key = term.data.apiKey;
  const evts = { events: [{ deviceEventId: 'evt-0001', matricule: 'EMP-0004', type: 'ARRIVAL', occurredAt: new Date(Date.now() - 2 * 3600_000).toISOString() }] };
  const t1 = await new Client().call('POST', '/terminal/events', evts, { 'x-terminal-key': key });
  check('Terminal : événement hors ligne reçu et marqué à vérifier', t1.status === 200 && t1.data.results[0].status === 'review', t1.data);
  const t2 = await new Client().call('POST', '/terminal/events', evts, { 'x-terminal-key': key });
  check('Terminal : doublon ignoré', t2.data.results[0].status === 'duplicate', t2.data);
  const t3 = await new Client().call('POST', '/terminal/events', evts, { 'x-terminal-key': 'pt_00000000_faux' });
  check('Terminal : clé invalide refusée', t3.status === 401, t3.data);

  const auditLog = await admin.call('GET', '/admin/audit');
  check('Journal d\'audit alimenté', auditLog.data.total > 5, auditLog.data.total);

  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests sont passés.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
