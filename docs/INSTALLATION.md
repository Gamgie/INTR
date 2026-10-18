# Mise en ligne sur intr.gamgie.com

Tout ce que Clément fait lui-même, étape par étape. Les valeurs secrètes (jeton kDrive, mot de passe)
ne sont jamais écrites ici, ni dans le code, ni dans une conversation : elles vivent uniquement dans
les réglages de Vercel. Le dépôt `Gamgie/INTR` est public : aucun document personnel ne doit y entrer
(le `.gitignore` exclut déjà `data/` et tous les `*.pdf`).

## Comment ça marche

- L'app tourne sur **Vercel** (région Paris), comme Ogma.
- Ses données vivent dans **un dossier de ton kDrive** :
  - `intr.json` : contrats, structures, périodes, réglages
  - `documents/` : les PDF importés (bulletins, contrats, AEM, notifications ARE), découpés page par
    page quand un PDF contient plusieurs bulletins
- Chaque sauvegarde remplace `intr.json` : kDrive garde les versions précédentes.
  Une suppression dans l'app envoie le fichier dans la corbeille kDrive.
- Tes dossiers d'origine (`Finance/Pole Emploi/Intermittence/2022`, …) ne sont jamais modifiés.

## 1. Le dossier de l'app dans kDrive

1. Dans kDrive (web), dans ton kDrive **pro**, crée le dossier `INTR`, par exemple dans
   `Finance/Pole Emploi/Intermittence/`.
2. Ouvre-le. L'adresse du navigateur ressemble à :
   `https://ksuite.infomaniak.com/2216131/kdrive/app/drive/3830432/files/NOMBRE`
   - `3830432` est l'**identifiant du kDrive** (`KDRIVE_DRIVE_ID`) : c'est celui de ton kDrive pro
   - le nombre à la place de `NOMBRE` (le dernier de l'adresse, propre à ton dossier `INTR`) est
     l'**identifiant du dossier** (`KDRIVE_FOLDER_ID`). Ne recopie pas un nombre d'exemple : ouvre
     vraiment le dossier `INTR` dans kDrive et lis l'adresse.
   - `2216131` est l'identifiant de l'organisation kSuite, l'app n'en a pas besoin

## 2. Le jeton kDrive

1. https://manager.infomaniak.com/v3/ng/accounts/token/list → **Créer un jeton**.
2. Application : un nom parlant, `INTR`. Portée (scope) : **drive**. Durée : illimitée.
3. Copie le jeton (affiché une seule fois) directement dans Vercel à l'étape 3. Ne le colle nulle
   part ailleurs.

Ce jeton donne accès à tout le kDrive : s'il fuit, supprime-le dans la même page et crée-en un autre.

## 3. Vercel

1. https://vercel.com → **Add New > Project** → importer `Gamgie/INTR`
   (si Vercel ne voit pas le dépôt : **Adjust GitHub App Permissions** et ajouter `INTR`).
2. Framework : SvelteKit (détecté). Ne rien changer d'autre.
3. **Environment Variables** :

| Key | Valeur | Type |
|---|---|---|
| `ACCESS_PASSWORD` | un mot de passe long, rien que pour l'app | Secret |
| `KDRIVE_TOKEN` | le jeton de l'étape 2 | Secret |
| `KDRIVE_DRIVE_ID` | `3830432` | Config |
| `KDRIVE_FOLDER_ID` | le dernier nombre de l'adresse du dossier `INTR` | Config |

4. **Deploy**. Ensuite, chaque envoi sur la branche `main` met le site à jour tout seul.
5. **Settings > Functions** : vérifier que **Fluid Compute** est activé (les imports avec OCR
   peuvent durer jusqu'à 5 minutes).

## 4. Adresse intr.gamgie.com (chez Wix)

Comme pour Ogma, les DNS de gamgie.com sont chez Wix.

1. Vercel, **Settings > Domains** : ajouter `intr.gamgie.com`.
2. Wix, **Domaines > gamgie.com > Gérer les enregistrements DNS > CNAME** : nom d'hôte
   `intr`, valeur donnée par Vercel, **sans point final**, TTL 1 heure.
3. Attendre que Vercel affiche le domaine en vert (quelques minutes à une heure).

## 5. Sur l'iPhone

1. Ouvrir https://intr.gamgie.com dans **Safari**, se connecter avec `ACCESS_PASSWORD`.
2. **Partager > Sur l'écran d'accueil**.
3. Ouvrir l'app depuis l'icône et se reconnecter une fois : l'app installée a sa propre session,
   valable 180 jours.

## 6. Importer tes documents

Dans l'app, onglet **Intermittence**, panneau **Import depuis kDrive** :

1. Colle l'adresse kDrive du dossier `Finance/Pole Emploi/Intermittence` (copiée depuis le
   navigateur), puis **Lire le dossier**. L'app liste ses sous-dossiers : `2022`, `2023`, `2024`,
   `2026`, `GUSO`, `Archive`… Tout est coché par défaut sauf `Ressource`.
2. Coche ce que tu veux, puis **Importer**. Chaque fichier passe par la même analyse que le bouton
   « Importer » (classement, découpage des PDF multi-bulletins, OCR des scans, rattachement aux
   contrats). Garde la page ouverte : l'import se fait fichier par fichier, avec une barre de
   progression. Sur iPhone, mieux vaut le faire depuis l'ordinateur la première fois.
3. Relancer reprend seulement les fichiers pas encore importés. Les originaux ne sont jamais
   modifiés.

Les fichiers Excel (comme `Déclaration.xlsx`) ne sont pas analysés par l'app.

## 7. Ranger le dossier kDrive

Toujours dans **Intermittence**, panneau **Ranger le dossier kDrive** (après l'import) :

1. **Préparer le rangement** : l'app montre où ira chaque fichier, sans rien toucher.
   - Année en cours (ou à venir) : `2026/MM/Employeur/`
   - Années passées : `Archive/AAAA/MM/Employeur/`
   - Nom : `[CODE] AAAA-MM-JJ Employeur.pdf`, par exemple `[BP] 2026-07-14 Compagnie Gamgie.pdf`.
     Codes : `[BP]` bulletin de paie, `[AEM]`, `[CS]` Congés Spectacles, `[CT]` contrat de travail,
     `[ARE]` notification France Travail, `[GUSO]`, `[DOC]` autre document. Quand seul le mois
     est connu (fichier non analysé), le nom porte `AAAA-MM`. Deux fichiers de même nom prennent
     « 2 », « 3 »…
   - « Année » = année d'intermittence : du lendemain d'une date anniversaire à la suivante.
     Fin novembre et décembre de l'année civile précédente vont dans `MM (AAAA)`, par exemple
     `2026/12 (2025)/`, pour ne pas se mêler au même mois de l'année suivante.
   - Restent en place : `Ressource`, les fichiers non PDF/image, ceux sans date reconnue.
2. **Ranger N fichiers** : fichier par fichier, avec une barre de progression.
3. **Annuler le dernier rangement** remet chaque fichier à sa place et sous son ancien nom.
4. **Dossiers vides à la corbeille** : les anciens dossiers vidés partent dans la corbeille kDrive
   (récupérables).

Les dates anniversaire se règlent dans l'onglet **Historique**. Après l'anniversaire de l'année
en cours, relance le rangement : l'année qui se termine part dans `Archive`.

## Développement local

```sh
npm install
ACCESS_PASSWORD=essai npm run dev        # données dans data/, sur le disque
npm test                                 # analyse des documents, statistiques, règles des annexes
npm run test:kdrive                      # paquet Vercel complet contre un faux kDrive
```

Avec les trois variables `KDRIVE_*` dans `.env.local`, le serveur local lit et écrit dans kDrive.

## Mises à jour de Ben Kuper

Le dépôt d'origine est branché en `upstream` :

```sh
git fetch upstream
git merge upstream/main
```

Les fichiers propres à ce portage : `src/lib/server/persistence.ts`, `src/lib/server/kdriveClient.js`,
`src/lib/rules.ts`, `scripts/vercel-include-dynamic.mjs`, `scripts/test-kdrive.mjs`.
