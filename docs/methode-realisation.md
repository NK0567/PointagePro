# Méthode de réalisation

Démarche **Agile (Scrum)** : des itérations courtes de 1 à 2 semaines, chacune livrant une version utilisable montrée à l'entreprise. On ne développe pas tout d'un coup : on valide d'abord le cœur (identité + lieu + horaires), puis on enrichit.

## Phase 0 — Cadrage (1 semaine)

- Observer le pointage actuel avec l'agent : heures réelles, pauses, cas particuliers (retards, oublis, sorties autorisées).
- Lister les sites, leurs coordonnées, leurs horaires et le rayon réaliste de chaque zone.
- Recenser le parc de téléphones : combien d'employés ont un smartphone compatible ? → dimensionner les postes partagés.
- Définir qui valide les comptes, les corrections, et qui reçoit les exports.
- Informer les employés : finalité, données collectées (position au moment du pointage uniquement), durée de conservation. Faire valider par un juriste (biométrie et géolocalisation).

**Livrable** : ce cahier des charges validé et les maquettes.

## Phase 1 — Socle (sprints 1 et 2) ✅ réalisé

- Base de données, API, rôles, journal d'audit.
- Fiches employés, invitations, validation des comptes.
- Enregistrement et connexion par empreinte (WebAuthn).
- Pointage avec contrôle de séquence et géozone côté serveur.

## Phase 2 — Fonctions métier (sprints 3 et 4) ✅ réalisé

- Tâches : déclaration, clôture, report automatique, assignation par le chef.
- Tableau de bord temps réel, journal des pointages, corrections.
- Rapports journaliers et de période, exports XLSX / CSV / PDF.
- Poste partagé (kiosque) et API des terminaux biométriques.

## Phase 3 — Tests (1 à 2 semaines)

| Type | Contenu |
| --- | --- |
| Automatique | `npm run test:e2e` : 34 scénarios (fraude à l'empreinte, hors zone, séquences, reports, exports…) |
| Appareils | Android et iPhone de différentes gammes, Chrome / Safari / Samsung Internet ; enregistrement, pointage, changement de téléphone |
| Terrain | Mesurer la précision GPS réelle sur chaque site (intérieur, entrepôt, sous-sol) et ajuster rayon et précision maximale |
| Fraude | Tentative avec le doigt d'un collègue, depuis le domicile, double arrivée, retour sans pause |
| Panne | Coupure réseau, GPS désactivé, téléphone déchargé → corrections |
| Sécurité | Droits par rôle, accès d'un employé à l'administration, sessions expirées |

## Phase 4 — Pilote (2 à 4 semaines)

1. Choisir **un site et une équipe** de 10 à 20 personnes.
2. Faire tourner **en parallèle** l'ancien pointage papier et PointagePro.
3. Comparer chaque jour les deux états ; analyser les écarts et les refus.
4. Ajuster rayons, tolérances, pauses et messages.
5. Recueillir l'avis des employés et de l'agent de pointage.

**Critère de sortie** : écarts expliqués, aucun blocage d'employé non résolu, exports acceptés par la paie.

## Phase 5 — Déploiement progressif

- Étendre site par site ; former l'agent de pointage et les RH (création, validation, corrections, exports).
- Distribuer les codes d'invitation lors d'une séance d'enrôlement encadrée (vérification de la pièce d'identité).
- Installer les postes partagés là où beaucoup d'employés n'ont pas de smartphone.

## Phase 6 — Exploitation et évolution

- Surveillance, sauvegardes, mises à jour de sécurité (voir [deploiement.md](deploiement.md)).
- Revue mensuelle des anomalies et des tentatives refusées.
- Évolutions V2 selon les retours : congés, plannings par équipe, notifications SMS, intégration paie.

## Organisation Scrum suggérée

| Rôle | Qui |
| --- | --- |
| Product Owner | Le responsable RH (ou l'agent de pointage), qui priorise les besoins |
| Développeur(s) | L'équipe technique |
| Utilisateurs pilotes | Agent de pointage, un chef d'équipe, quelques employés |

Rituels : planification en début de sprint, point rapide quotidien, démonstration et rétrospective en fin de sprint.
