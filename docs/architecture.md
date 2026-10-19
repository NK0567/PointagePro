# Architecture technique

```
 Téléphone employé (PWA)        Poste partagé (tablette)        Terminal biométrique
        │ HTTPS                        │ HTTPS                        │ HTTPS + clé d'API
        └──────────────┬───────────────┴──────────────┬───────────────┘
                       ▼                              ▼
              Nginx (HTTPS, fichiers du frontend React, proxy /api)
                                      │
                       API Node.js / Express / TypeScript (PM2)
                       ├─ Authentification : WebAuthn, sessions, rôles
                       ├─ Règles de pointage : séquence, géozone, horodatage
                       ├─ Tâches : déclaration, clôture, report
                       ├─ Rapports : calcul des journées, exports XLSX/CSV/PDF
                       └─ Journal d'audit, notifications
                                      │ Prisma
                                   MySQL (port fermé à Internet)
```

| Couche | Technologie |
| --- | --- |
| Interface | React 18, TypeScript, Vite, Tailwind CSS 4, Leaflet (cartes OpenStreetMap), lucide-react |
| API | Node.js, Express 4, TypeScript, Zod (validation), Helmet, express-rate-limit |
| Biométrie | `@simplewebauthn/server` et `@simplewebauthn/browser` (WebAuthn / passkeys) |
| Données | MySQL/MariaDB, Prisma ORM |
| Exports | ExcelJS, PDFKit, CSV UTF-8 |

## 1. Empreinte digitale : comment ça marche

L'empreinte n'est **jamais** envoyée au serveur ni stockée dans la base.

1. **Enregistrement** : le téléphone crée une paire de clés liée à PointagePro. La clé privée reste dans la puce sécurisée du téléphone et ne peut être utilisée qu'après vérification de l'empreinte. Le serveur ne reçoit que la **clé publique** (table `Authenticator`).
2. **Connexion / pointage** : le serveur envoie un défi aléatoire (valable 5 min, usage unique). Le téléphone demande l'empreinte, puis signe le défi. Le serveur vérifie la signature, que l'empreinte a bien été vérifiée (indicateur *user verification*), l'origine du site et le compteur anti-clonage.
3. **Chaque pointage exige une nouvelle signature** liée au compte connecté : un collègue qui emprunte une session ouverte ne peut pas pointer avec son propre doigt.

« Au minimum deux doigts » : ce réglage se fait dans le téléphone (empreintes enregistrées dans Android ou iOS). L'écran d'enregistrement le demande explicitement à l'employé.

**Limite connue** : sur un téléphone, *toute* empreinte enregistrée dans le téléphone déverrouille la clé. C'est pourquoi chaque employé utilise son propre téléphone, et pourquoi le poste partagé utilise une clé biométrique personnelle, un PIN supervisé ou un terminal dédié.

## 2. Géolocalisation

- Le navigateur fournit la position et sa précision au moment du pointage seulement (pas de suivi continu).
- Le **serveur** calcule la distance au site (formule de haversine) et refuse si `distance > rayon` ou `précision > précision maximale`.
- Les refus sont enregistrés dans `PunchRejection` avec la distance, et ne comptent jamais comme pointages.
- Un écran de pré-vérification (`/me/geo-check`) informe l'employé avant qu'il pose le doigt ; la décision définitive reste celle du pointage.

## 3. Modèle de données (principales tables)

| Table | Contenu |
| --- | --- |
| `Site` | Coordonnées, rayon, précision max, fuseau, horaires, tolérance de retard, jours ouvrés, pauses max |
| `User` | Matricule, identité, fonction, service, rôle, statut (INVITED, PENDING, ACTIVE, SUSPENDED), site, responsable, code d'invitation, PIN haché, mot de passe haché (gestion) |
| `Authenticator` | Identifiant et clé publique WebAuthn, compteur, nom de l'appareil, révocation |
| `AttendanceEvent` | Type, heure officielle (UTC), date de travail locale, source (MOBILE, KIOSK, TERMINAL, CORRECTION), position, distance, hors ligne, à vérifier, annulation avec motif |
| `PunchRejection` | Tentatives refusées et leur raison |
| `Task` / `TaskHistory` | Tâches (date prévue, date d'origine, nombre de reports, statut) et historique complet |
| `CorrectionRequest` | Demandes de correction et décision |
| `Notification` | Notifications dans l'application |
| `TerminalDevice` | Terminaux déclarés (clé d'API hachée) |
| `AuditLog` | Journal des actions sensibles |

Une journée n'est **jamais stockée** : elle est recalculée à partir des événements (`summarizeDay`), ce qui garantit que corrections et annulations sont toujours prises en compte.

## 4. API (préfixe `/api`)

| Méthode | Route | Rôle |
| --- | --- | --- |
| POST | `/auth/enroll/check`, `/auth/enroll/options`, `/auth/enroll/verify` | Enregistrement d'une empreinte avec code d'invitation |
| POST | `/auth/webauthn/login/options`, `/auth/webauthn/login/verify` | Connexion par empreinte |
| POST | `/auth/login`, `/auth/logout` · GET `/auth/me` | Connexion des comptes de gestion, session |
| GET | `/me/today` | Journée en cours, actions possibles, tâches |
| POST | `/me/geo-check` | Vérification indicative de la position |
| POST | `/me/punch/options`, `/me/punch` | Pointage (empreinte + position) |
| GET/POST/PATCH | `/me/tasks` | Tâches de l'employé |
| GET | `/me/history` · `/me/devices` · `/me/notifications` | Historique, appareils, notifications |
| GET/POST | `/me/corrections` | Signaler un pointage oublié |
| GET | `/admin/dashboard` | Statistiques et pointages du jour |
| GET/POST/PATCH | `/admin/users…` | Employés, validation, suspension, invitations, révocation d'appareil |
| GET/POST/PUT | `/admin/sites…` | Sites et zones |
| GET/POST | `/admin/attendance…`, `/admin/corrections…` | Journal des pointages, annulation, vérification, corrections |
| GET/POST/PATCH | `/admin/tasks…` | Tâches et historique |
| GET | `/admin/audit` · `/admin/terminals` | Audit, terminaux |
| GET | `/reports/daily`, `/reports/period`, `/reports/export` | Rapports et exports |
| GET/POST | `/kiosk/employee/:matricule`, `/kiosk/options`, `/kiosk/punch` | Poste partagé |
| POST | `/terminal/events` | Synchronisation d'un terminal biométrique (en-tête `X-Terminal-Key`) |

Exemple de synchronisation d'un terminal :

```json
POST /api/terminal/events
X-Terminal-Key: pt_1a2b3c4d_…
{ "events": [ { "deviceEventId": "evt-0001", "matricule": "EMP-0004", "type": "ARRIVAL", "occurredAt": "2026-10-15T07:58:00+01:00" } ] }
```

Réponse : `ok`, `review` (hors ligne ou séquence incohérente, à vérifier), `duplicate` (déjà reçu) ou `unknown_employee`.

## 5. Sécurité

- Session dans un cookie `HttpOnly`, `SameSite=Strict`, `Secure` en production ; compte rechargé à chaque requête (une suspension prend effet immédiatement).
- Contrôle de l'en-tête `Origin` sur les requêtes qui modifient des données (protection CSRF).
- Contrôle des rôles sur chaque route ; un chef d'équipe ne voit que son équipe.
- Limitation des tentatives ; blocage 15 min après 5 échecs de mot de passe ou de PIN.
- Mots de passe et PIN hachés (bcrypt), clés de terminal hachées (SHA-256), affichées une seule fois.
- Verrou de base de données sur l'employé pendant un pointage (pas de double pointage simultané).
- Helmet (en-têtes HTTP), validation Zod de toutes les entrées.
- Journal d'audit pour toute action sensible.

## 6. Limites et évolutions

- Les défis WebAuthn sont gardés en mémoire : suffisant pour une instance ; à placer dans Redis si l'API est répartie sur plusieurs serveurs.
- Un GPS falsifié sur un téléphone modifié reste théoriquement possible : pour les postes à risque, utiliser le terminal fixe.
- V2 envisagée : congés et absences justifiées, plannings par équipe, notifications SMS, tableau de bord de tendances, intégration paie.
