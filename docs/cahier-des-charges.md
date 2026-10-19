# Cahier des charges — PointagePro

## 1. Contexte

Aujourd'hui, un agent de pointage note à la main, pour chaque employé, l'heure d'arrivée, le départ et le retour de pause, puis la fin de journée. Cette méthode pose plusieurs problèmes :

- un employé peut faire pointer un collègue absent (pointage par procuration) ;
- des **noms fictifs** peuvent être ajoutés pour toucher des salaires au moment de la paie ;
- un employé peut déclarer sa présence sans être sur le lieu de travail ;
- les heures sont oubliées, mal recopiées ou modifiables ;
- les tâches non faites ne sont pas suivies d'un jour à l'autre ;
- produire l'état d'une journée pour la direction ou la paie prend du temps.

## 2. Objectifs

1. **Identifier la bonne personne** à chaque pointage, par son empreinte digitale.
2. **Prouver la présence sur le site** : aucun pointage n'est enregistré hors de la zone du lieu de service.
3. **Horodater automatiquement** l'arrivée, la pause, le retour et la fin de journée (heure du serveur, jamais saisie par l'employé).
4. **Suivre les tâches** : déclarées le matin, cochées le soir, reportées automatiquement si elles ne sont pas faites.
5. **Exporter** la situation d'une journée ou d'une période pour exploitation (RH, paie, direction).
6. Fonctionner aussi pour les employés **sans smartphone** ou **sans connexion**.

## 3. Acteurs

| Profil | Rôle |
| --- | --- |
| Super-administrateur | Configure l'entreprise, les sites, les comptes de gestion. |
| Administrateur RH | Crée les fiches, valide les comptes, traite les corrections, exporte les rapports. |
| Agent de pointage | Supervise le poste de pointage partagé, consulte les présences, exporte. |
| Chef d'équipe | Assigne et suit les tâches de son équipe uniquement. |
| Employé | Pointe, déclare et coche ses tâches, consulte son historique, signale un oubli. |
| Direction / Paie | Consulte tableaux de bord et rapports. |

Une même personne peut cumuler plusieurs rôles dans une petite structure.

## 4. Parcours principaux

### 4.1 Création d'un compte (anti-employés fictifs)

1. Les RH créent la fiche : nom, prénom, **fonction**, service, lieu de service, responsable. Un **matricule unique** est attribué.
2. Le système génère un **code d'invitation à usage unique** (valable 7 jours).
3. L'employé saisit ce code, enregistre au moins **deux doigts** dans son téléphone, puis enregistre son empreinte dans PointagePro.
4. Le compte passe « À valider » ; les RH vérifient l'identité et **valident**.
5. Le compte est actif : l'employé peut se connecter et pointer.

Personne ne peut créer un compte librement. Un compte sans empreinte enregistrée ne peut pas être activé.

### 4.2 Journée type

| Moment | Action de l'employé | Contrôles du système |
| --- | --- | --- |
| Arrivée | Touche « Pointer mon arrivée », déclare ses tâches, pose son doigt | Empreinte du titulaire du compte, position dans la zone, précision GPS suffisante, pas d'arrivée déjà enregistrée |
| Pause | « Partir en pause » + empreinte | Être au travail, nombre de pauses autorisé |
| Retour | « Retour de pause » + empreinte | Une pause doit être en cours |
| Fin de journée | Coche les tâches faites + empreinte | Arrivée enregistrée, pas de pause en cours ; les tâches non cochées sont reportées |

En cas de refus (hors zone, GPS imprécis, séquence invalide) : **rien n'est enregistré comme pointage**, un message explique la raison, la tentative est journalisée et l'employé reçoit une notification. Au bout de 3 tentatives hors zone en 12 h, les RH sont alertés.

### 4.3 Report automatique des tâches

- Les tâches non cochées à la fin de journée passent au **prochain jour travaillé** du site (dimanche, jours non ouvrés ignorés).
- Une tâche restée ouverte un jour d'absence remonte automatiquement dans la liste du jour suivant.
- La date initiale, le nombre de reports et chaque changement sont conservés (aucune tâche ne « disparaît »).

### 4.4 Employé sans smartphone ou sans connexion

| Situation | Solution |
| --- | --- |
| Pas de smartphone | **Poste de pointage partagé** (tablette sur site) supervisé par l'agent : clé biométrique personnelle (type clé FIDO2 à empreinte) ou PIN. |
| Changement de téléphone | Les RH délivrent un nouveau code ; l'ancien appareil peut être révoqué. |
| Coupure Internet | **Terminal biométrique** fixe qui stocke les pointages et les transmet au retour du réseau ; les événements tardifs sont marqués « hors ligne / à vérifier ». |

### 4.5 Rapports

L'administrateur choisit une date ou une période, un site et/ou un employé, puis exporte en **Excel**, **CSV** (séparateur « ; » compatible Excel français) ou **PDF**. L'état journalier contient : matricule, nom, fonction, statut, arrivée, pause, retour, fin, temps travaillé, tâches réalisées et anomalies.

## 5. Règles de gestion

1. Une seule arrivée valide par jour et par employé.
2. Pause possible uniquement au travail ; retour possible uniquement en pause ; fin de journée impossible pendant une pause.
3. Plusieurs pauses possibles selon le paramétrage du site (2 par défaut).
4. L'heure enregistrée est celle du serveur. Les dates sont stockées en UTC et affichées dans le fuseau du site (Africa/Douala).
5. Temps travaillé = fin − arrivée − durée des pauses.
6. Retard = arrivée après l'heure de début + tolérance du site.
7. Un oubli de pointage n'est **pas** transformé automatiquement en absence : il apparaît comme anomalie à vérifier.
8. Un pointage n'est jamais supprimé : il est **annulé avec motif**, ou complété par une **correction validée**, et l'action figure dans le journal d'audit.
9. Un responsable ne peut pas valider sa propre demande de correction.
10. Les rapports préparent la paie mais n'appliquent aucune retenue automatique.

## 6. Ce qui manquait dans l'idée de départ (spécifications ajoutées)

| Point oublié | Pourquoi c'est important | Ce qui a été prévu |
| --- | --- | --- |
| **Stockage des empreintes en base** | Un navigateur ne donne jamais accès à l'image de l'empreinte ; centraliser des empreintes brutes est risqué et juridiquement sensible. | WebAuthn : le téléphone vérifie l'empreinte et signe ; le serveur ne garde qu'une clé publique. Terminal fixe pour une biométrie centralisée si nécessaire. |
| **Utiliser l'empreinte « sur n'importe quel téléphone »** | L'empreinte enregistrée sur un téléphone ne peut pas être réutilisée sur un autre. | Poste partagé + procédure « nouvel appareil » par code RH. |
| **Inscription libre** | Permettrait de créer des employés fictifs. | Fiche créée par les RH + code d'invitation + validation. |
| **Falsification du GPS** | Une position peut être simulée sur un téléphone modifié. | Contrôle serveur, précision minimale, journal des refus, alertes, terminal fixe pour les postes sensibles. |
| **Oublis de pointage** | Sans procédure, l'agent modifierait les heures « à la main ». | Demande de correction + validation tracée. |
| **Horaires, retards, jours fériés** | Nécessaires pour calculer retards et absences. | Horaires, tolérance, jours ouvrés et pauses par site. |
| **Journal d'audit** | Prouver qui a modifié quoi en cas de litige. | Audit de toutes les actions sensibles. |
| **Départ d'un employé / téléphone perdu** | L'accès doit pouvoir être coupé immédiatement. | Suspension du compte (effet immédiat), révocation d'appareil. |
| **Plusieurs sites** | Une entreprise peut avoir plusieurs lieux de travail. | Sites multiples, chacun avec sa zone et ses horaires. |
| **Cadre légal** | Données biométriques et de localisation = données personnelles sensibles. | Minimisation (position uniquement au pointage, pas de suivi continu), information des employés, durée de conservation à définir. À valider avec un juriste au Cameroun avant le déploiement. |

## 7. Hors périmètre de la V1

- Application mobile native (la V1 est une PWA installable sur l'écran d'accueil).
- Intégration directe avec un logiciel de paie (export fourni à la place).
- Congés et absences justifiées (prévu en V2), planning par équipes tournantes, travail de nuit.
- Notifications par SMS/e-mail (les notifications sont dans l'application).

## 8. Critères d'acceptation

- Un employé ne peut pas pointer avec l'empreinte d'un autre (testé).
- Un pointage depuis l'extérieur de la zone est refusé et n'apparaît pas dans les heures (testé).
- Les séquences invalides sont refusées (testé).
- Les tâches non cochées réapparaissent le jour travaillé suivant avec leur historique (testé).
- L'état journalier s'exporte en XLSX, CSV et PDF (testé).
- Un compte créé par invitation reste inactif tant que les RH ne l'ont pas validé (testé).

Ces critères sont vérifiés automatiquement par `npm run test:e2e` (34 scénarios).
