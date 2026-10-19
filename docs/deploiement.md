# Mise en ligne

Cible recommandée : **un VPS Linux (Ubuntu 24.04)**, 2 vCPU et 2–4 Go de RAM, chez un hébergeur fiable (OVH, Hetzner, Contabo, ou un hébergeur local). Un **nom de domaine** et le **HTTPS** sont obligatoires : sans HTTPS, les navigateurs refusent l'authentification par empreinte.

```
Internet ──HTTPS 443──▶ Nginx ──▶ /         fichiers statiques du frontend (frontend/dist)
                               └─▶ /api/*   API Node.js sur 127.0.0.1:4500 (PM2)
                                            └─▶ MySQL sur 127.0.0.1:3306 (jamais exposé)
```

## 1. Préparer le serveur

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx mysql-server git ufw
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2

# Pare-feu : seulement SSH et le web
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

Créer un utilisateur système dédié (`pointage`) plutôt que de travailler en root, et utiliser une connexion SSH par clé.

## 2. Base de données

```bash
sudo mysql_secure_installation
sudo mysql -e "CREATE DATABASE pointagepro_bd CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'pointage'@'localhost' IDENTIFIED BY 'MOT_DE_PASSE_LONG';
GRANT ALL ON pointagepro_bd.* TO 'pointage'@'localhost'; FLUSH PRIVILEGES;"
```

MySQL écoute uniquement sur `127.0.0.1` (valeur par défaut d'Ubuntu) : ne jamais ouvrir le port 3306.

## 3. Domaine

Chez le registraire, créer un enregistrement **A** `pointage.mon-entreprise.cm` → adresse IP du VPS.

## 4. Déployer l'application

```bash
cd /srv && sudo git clone <URL_DU_DEPOT> pointagepro && sudo chown -R pointage: pointagepro
cd /srv/pointagepro/backend
npm ci
cp .env.example .env
```

Contenu de `backend/.env` en production :

```ini
NODE_ENV=production
DATABASE_URL="mysql://pointage:MOT_DE_PASSE_LONG@localhost:3306/pointagepro_bd"
PORT=4500
JWT_SECRET="<64 caractères aléatoires : openssl rand -hex 32>"
RP_ID="pointage.mon-entreprise.cm"
RP_NAME="PointagePro"
APP_ORIGIN="https://pointage.mon-entreprise.cm"
```

> `RP_ID` doit être **exactement** le domaine (sans `https://` ni port). Les empreintes enregistrées sont liées à ce domaine : le changer plus tard oblige tous les employés à se réenrôler.

```bash
npx prisma migrate deploy   # crée les tables à partir de prisma/migrations
npm run build
pm2 start dist/server.js --name pointagepro-api
pm2 save && pm2 startup      # redémarrage automatique

cd ../frontend
npm ci && npm run build      # produit frontend/dist
```

Ne **pas** lancer `npm run db:seed` en production : il efface les données.

Créer ensuite le premier super-administrateur par un petit script ou directement en base (mot de passe haché avec bcrypt), puis créer les sites et les comptes depuis l'interface.

## 5. Nginx et HTTPS

`/etc/nginx/sites-available/pointagepro` :

```nginx
server {
    server_name pointage.mon-entreprise.cm;
    root /srv/pointagepro/frontend/dist;
    index index.html;

    client_max_body_size 2m;

    location /api/ {
        proxy_pass http://127.0.0.1:4500;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri /index.html;   # routes de l'application React
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/pointagepro /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pointage.mon-entreprise.cm   # certificat gratuit Let's Encrypt, renouvelé automatiquement
```

## 6. Sauvegardes

```bash
# /etc/cron.d/pointagepro-backup — chaque nuit à 2 h
0 2 * * * pointage mysqldump --single-transaction pointagepro_bd | gzip > /var/backups/pointagepro/$(date +\%F).sql.gz
```

- Copier les sauvegardes **hors du serveur** (stockage objet, autre machine), chiffrées.
- Conserver 30 jours de sauvegardes quotidiennes.
- **Tester une restauration** chaque mois sur une base de test.

## 7. Mises à jour

```bash
cd /srv/pointagepro && git pull
cd backend && npm ci && npx prisma migrate deploy && npm run build && pm2 reload pointagepro-api
cd ../frontend && npm ci && npm run build
```

Avant chaque mise à jour : sauvegarde de la base. En cas de problème : `git checkout <version précédente>`, reconstruire, et restaurer la sauvegarde si le schéma a changé.

Automatisation possible avec **GitHub Actions** : à chaque fusion sur `main`, exécuter les tests, puis se connecter en SSH au serveur pour lancer les commandes ci-dessus.

## 8. Surveillance

- `pm2 logs pointagepro-api` et `pm2 monit` pour l'API ; journaux Nginx dans `/var/log/nginx/`.
- Une sonde externe (UptimeRobot, gratuit) sur `https://pointage.mon-entreprise.cm/api/health`.
- Mises à jour de sécurité automatiques : `sudo apt install unattended-upgrades`.

## 9. Liste de vérification avant ouverture

- [ ] HTTPS actif, `RP_ID` et `APP_ORIGIN` corrects
- [ ] `JWT_SECRET` long et unique, `.env` non versionné
- [ ] Port MySQL fermé, pare-feu actif
- [ ] Sauvegarde et restauration testées
- [ ] Sites créés avec coordonnées et rayons mesurés sur le terrain
- [ ] Comptes de démonstration absents
- [ ] Enrôlement testé sur Android et iPhone
- [ ] Export journalier vérifié par la paie
- [ ] Employés informés (finalité, données, durée de conservation)
