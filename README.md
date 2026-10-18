# InterMittens

Application SvelteKit de gestion d’intermittence: structures, projets, contrats, documents,
notifications ARE, périodes d’intermittence et statistiques.

> **Version de Clément (Gamgie/INTR)**, portée depuis [benkuper/InterMittens](https://github.com/benkuper/InterMittens) :
> hébergement Vercel sur intermittent.gamgie.com, données dans kDrive, installable sur iPhone,
> calculs alignés sur les annexes 8 et 10 de la convention du 15 novembre 2024 (`src/lib/rules.ts`).
> Mise en ligne : [docs/INSTALLATION.md](docs/INSTALLATION.md).

## Développement local

```sh
npm install
npm run dev
```

L’interface locale tourne par défaut sur `http://127.0.0.1:5173/`.

## Données

Les données sont stockées dans:

```txt
data/intermittens.json
data/documents/
```

Le dossier `data/` doit être persistant et sauvegardé. Il est ignoré par Git.

## Import de documents

Les PDF numériques et les PDF scannés sont analysés automatiquement. Lorsqu'une page ne
contient pas assez de texte extractible, une OCR française locale est appliquée avant la
classification et la détection des dates, heures, cachets et montants. L'analyse OCR est limitée
aux 20 premières pages scannées d'un même fichier.

## Hébergement en ligne

À mettre sur le serveur:

1. Le dépôt/app Node buildé.
2. Node.js 22 ou plus récent.
3. Un dossier persistant `data/` en écriture pour le process Node.
4. Un reverse proxy HTTPS qui expose l’app sur:

```txt
https://<site.com>/intermittens
```

Build et lancement:

```sh
npm ci
$env:BASE_PATH="/intermittens" # PowerShell
npm run build
$env:HOST="127.0.0.1"
$env:PORT="3017"
node build
```

Sous Linux/systemd, l’équivalent:

```sh
BASE_PATH=/intermittens npm run build
HOST=127.0.0.1 PORT=3017 node build
```

Reverse proxy Nginx indicatif:

```nginx
location /intermittens/ {
    proxy_pass http://127.0.0.1:3017;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Dans l’app locale, onglet `Intermittence`:

```txt
URL serveur: https://yoursite.fr/intermittens
Synchro distante: Oui
```

Ensuite, l’interface locale pousse les sauvegardes et uploads vers le serveur distant.

## Validation

```sh
npm run check
npm run lint
npm run build
```

## Scripts de deploiement

Les vraies valeurs de serveur restent dans `.env.local`, ignore par Git. Ne mets pas
l'URL publique, l'hote, l'utilisateur, le chemin distant ou les secrets dans les fichiers suivis.
L'accès web est protégé par mot de passe. `ACCESS_PASSWORD` dans `.env.local` permet de remplacer
le mot de passe par défaut ; sa modification déconnecte automatiquement les navigateurs déjà reconnus.

Configuration locale et creation des dossiers distants:

```sh
npm run setup
```

Upload seul, sans redemarrage du process distant:

```sh
npm run upload
```

Deploiement complet: build, upload, installation distante des dependances si le
lockfile a change, puis redemarrage du process Node distant:

```sh
npm run deploy
```

`npm run publish` reste un alias de `npm run deploy`.

Runtime distant:

```sh
npm run remote:status
npm run remote:install
npm run remote:restart
npm run remote:stop
```

Simulation sans build ni connexion reelle:

```sh
npm run deploy:dry-run
```

Par defaut, le script peut lire `.vscode/sftp.json` localement pour uploader en SFTP.
Ce fichier reste ignore par Git. Le mode SFTP envoie `build/`, `package.json`,
`package-lock.json` et `_passenger.cjs` vers le `remotePath`, en preservant `data/`.
Laisse plutot `DEPLOY_UPLOAD_NODE_MODULES=false` si le serveur peut lancer npm:
`remote:install` installe alors les dependances directement sur Linux, seulement
quand `package-lock.json` change. Cela evite d'envoyer des modules natifs prepares
sur Windows vers l'hebergement.
Si l'app tourne derriere un proxy, renseigne `DEPLOY_PUBLIC_ORIGIN` (par exemple
`https://goldengeek.org`) ou `DEPLOY_HEALTH_URL`: les scripts l'utilisent pour
fixer `ORIGIN` et eviter les erreurs CSRF `Cross-site POST form submissions`.
Les scripts fixent aussi `BODY_SIZE_LIMIT` a 10 MiB par defaut pour accepter les
PDF d'import; ajuste `DEPLOY_BODY_SIZE_LIMIT` si ton hebergeur impose une autre
limite.

Sur un hebergement Plesk/Passenger avec Node.js active, configure l'application
Node dans Plesk avec `_passenger.cjs` comme fichier de demarrage, ou `app.js` /
`server.js` si ton panneau ne propose pas les fichiers `.cjs`, et `/intermittens`
comme chemin public/base URI. Le script touche `tmp/restart.txt` pour demander un
redemarrage au prochain acces.

Ne mets `DEPLOY_WRITE_HTACCESS=true` que si l'hebergeur autorise explicitement les
directives Passenger dans `.htaccess`.

Si Plesk ne permet pas de configurer Node sans acces admin, `remote:restart` utilise
le binaire Node Plesk local, lance l'app sur `127.0.0.1:3017`, puis ecrit une petite
regle `.htaccess` de proxy vers ce port. Les valeurs reelles restent dans `.env.local`.

Le mode SSH (`DEPLOY_TRANSPORT=ssh`) cree une release distante avec un lien `current`,
un dossier persistant `shared/data`, puis peut lancer `DEPLOY_INSTALL_COMMAND` et
`DEPLOY_RESTART_COMMAND`.
