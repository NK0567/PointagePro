<<<<<<< HEAD
# PointagePro

Application web de **pointage sécurisé** pour l'entreprise : chaque employé valide sa présence avec **son empreinte digitale**, **uniquement depuis son lieu de service**, déclare ses tâches le matin et coche celles qu'il a faites le soir. Les tâches non terminées passent automatiquement au lendemain. L'administration suit tout en temps réel et exporte l'état de la journée (Excel, CSV, PDF).

> Objectif : supprimer le pointage par procuration (« pointer pour un ami »), les employés fictifs sur la liste de paie et le pointage depuis la maison.

## Fonctionnalités de la V1

| Module | Contenu |
| --- | --- |
| Authentification biométrique | WebAuthn / passkeys : l'empreinte reste dans le téléphone, le serveur vérifie une signature cryptographique. Mot de passe réservé aux comptes de gestion. |
| Comptes contrôlés | Pas d'inscription libre : les RH créent la fiche → code d'invitation à usage unique → l'employé enregistre son empreinte → les RH **valident** le compte. |
| Pointage | Arrivée, départ en pause, retour, fin de journée. Heure du **serveur**, séquence contrôlée (pas de double arrivée, pas de retour sans pause, etc.). Nouvelle empreinte exigée à **chaque** pointage. |
| Géolocalisation | Site sur carte + rayon autorisé + précision GPS maximale. Contrôle **côté serveur** ; refus journalisé, alerte aux RH après 3 tentatives hors zone. |
| Tâches | Déclarées à l'arrivée, cochées à la sortie, **report automatique** au prochain jour travaillé avec compteur de reports et historique. Tâches assignées par le chef d'équipe. |
| Poste partagé (kiosque) | Pour les employés sans smartphone : tablette sur site supervisée par l'agent de pointage (clé biométrique personnelle ou PIN). |
| Terminal biométrique | API `POST /api/terminal/events` pour un lecteur d'empreintes fixe, idempotente, avec gestion du hors-ligne. |
| Corrections | L'employé signale un oubli ; un responsable valide → événement « Correction » tracé (rien n'est modifié en silence). |
| Rapports | État journalier et synthèse de période : présences, retards, absences, heures travaillées, anomalies, tâches. Export **XLSX / CSV / PDF**. |
| Audit | Journal de toutes les actions sensibles (connexions, validations, exports, corrections…). |

## Démarrage rapide (développement)

Prérequis : Node.js 20+ et MySQL/MariaDB (XAMPP convient).

```bash
# 1. Base de données
mysql -uroot -e "CREATE DATABASE pointagepro_bd CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

# 2. API (port 4500)
cd backend
npm install
cp .env.example .env        # puis ajuster DATABASE_URL / JWT_SECRET
npx prisma db push
npm run db:seed             # données de démonstration
npm run dev

# 3. Interface web (port 5250) — dans un second terminal
cd frontend
npm install
npm run dev
```

Ouvrir http://localhost:5250.

### Comptes de démonstration

| Profil | Identifiant | Secret |
| --- | --- | --- |
| Super-administrateur | admin@pointagepro.cm | Admin@2026 |
| Agent de pointage | agent@pointagepro.cm | Agent@2026 |
| Chef d'équipe | chef@pointagepro.cm | Chef@2026 |
| Employés EMP-0001 à EMP-0005 | PIN kiosque | 1234 |
| Codes pour enregistrer une empreinte | DEMO1AX2, DEMO2BY2, DEMO3CZ2, DEMO4DW2, DEMO5EK2 | — |
| Nouvel employé à enrôler (EMP-0006) | code d'invitation | BIENVENU |

> **Tester l'empreinte sur un vrai téléphone** : WebAuthn n'accepte que `localhost` ou une adresse **HTTPS**. Pour essayer depuis un téléphone, déployez en HTTPS (voir [docs/deploiement.md](docs/deploiement.md)) ou utilisez un tunnel HTTPS, puis mettez à jour `RP_ID` et `APP_ORIGIN`.

### Tests de bout en bout

```bash
cd backend
npm run test:e2e   # API démarrée ; simule un téléphone avec un authentificateur WebAuthn logiciel
npm run db:seed    # remettre les données de démonstration au propre
```

34 scénarios : empreinte d'un collègue refusée, pointage depuis le domicile refusé, GPS imprécis, séquences invalides, report des tâches, validation RH, exports, kiosque, terminal hors ligne, doublons, audit…

## Structure

```
pointagePro/
├── backend/            API Express + TypeScript + Prisma (MySQL)
│   ├── prisma/         schéma et données de démonstration
│   ├── src/routes/     auth, espace employé, administration, rapports, kiosque/terminal
│   ├── src/services/   règles de pointage, tâches, WebAuthn, rapports & exports
│   └── scripts/e2e.ts  tests de bout en bout
├── frontend/           React + Vite + Tailwind (PWA installable)
└── docs/               cahier des charges, architecture, méthode, déploiement
```

## Documentation

- [Cahier des charges](docs/cahier-des-charges.md) — besoin, règles de gestion, spécifications ajoutées
- [Architecture technique](docs/architecture.md) — biométrie, géolocalisation, données, API, sécurité
- [Méthode de réalisation](docs/methode-realisation.md) — démarche Agile/Scrum, sprints, pilote
- [Mise en ligne](docs/deploiement.md) — VPS Linux, Nginx, HTTPS, PM2, sauvegardes
=======
# PointagePro
>>>>>>> 19133d9cf61c2bce95d6332641805b3e07d002e8
