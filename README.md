# Tuiles & Toiles

Entraînement mémoriel en histoire de l'art. 431 œuvres tirées d'un Google Doc,
présentées comme des tuiles dont une partie des informations est masquée.

## Démarrer

```bash
npm install
npm run import      # manifest.csv -> data/tuiles.db (à faire une fois)
npm run dev         # Vite + Electron
```

| Commande | Effet |
|---|---|
| `npm run dev` | serveur Vite puis Electron, rechargement à chaud du rendu |
| `npm run build` | compile le rendu dans `dist/` |
| `npm run import` | (re)construit la base depuis `data/manifest.csv` |
| `npm run dist` | installateur Windows via electron-builder |

## Structure

```
src/main/          processus principal Electron (Node)
  index.js         fenêtre, protocole tuile://, canaux IPC
  preload.js       pont vers le rendu, seule surface exposée
  db.js            SQLite : schéma et requêtes
  masques.js       moteur de masques (le cœur du jeu)
  jeu.js           tirage en sac sans remise
  import.js        manifest.csv -> base

src/renderer/      interface (React)
  App.jsx          menu, jeu, coquille avec barre latérale
  icones.jsx       icônes SVG
  styles.css       jetons visuels issus des maquettes

scripts/           outils de build, indépendants des shims npm
data/              431 JPEG + manifest.csv + tuiles.db
design/            les 9 maquettes .dc.html
tools/             extraction et tests côté Google Docs
```

## Le moteur de masques

Une tuile montre certains champs et en cache d'autres. Un masque n'est retenu
pour une œuvre que s'il respecte quatre règles, vérifiées à l'import sur les
431 œuvres :

1. **discriminant** — les champs visibles ne désignent qu'une seule œuvre
2. **évocateur** — au moins un indice qu'un humain peut relier à l'œuvre
   (image, titre, description d'au moins 60 caractères, ou artiste quand il
   n'a qu'une œuvre au corpus)
3. **sans fuite** — aucun champ visible ne contient la réponse d'un champ caché
   (22 descriptions citent le nom de l'artiste ou le titre)
4. **incomplet** — au moins un champ caché

**La date n'est jamais révélée**, ni comme champ visible ni comme indice :
c'est ce que l'entraînement vise à faire mémoriser. Mesuré : chaque œuvre
conserve au minimum 45 masques valides sans elle.

## Le document source n'est jamais modifié

Le Google Doc appartient à un tiers et sert de source unique. L'application
le lira en `documents.readonly` : elle en est techniquement incapable de le
modifier. Les corrections proposées par l'utilisateur restent en base et
s'exportent en CSV.

## Synchronisation (à implémenter)

Mesuré sur le document réel : remplacer une image ne change **rien** dans la
structure renvoyée par l'API Docs — ni `inlineObjectId`, ni dimensions. Seuls
le `revisionId` et le `contentUri` bougent. D'où :

1. `revisionId` inchangé → rien à faire
2. sinon lire le document
3. diff **texte** → ajouts, suppressions, corrections
4. diff **contentUri** → sous-ensemble d'images à vérifier
5. `Range: bytes=0-0` sur ce sous-ensemble → ne retélécharger que les écarts

Les étapes 3 et 4 sont **indépendantes** : un diff texte concluant n'autorise
pas à sauter la vérification des images, sinon une modification simultanée
texte + image passerait inaperçue.

## Attention au chemin du projet

Le dossier contient une espace et un `&`. Sous Windows, les raccourcis
`node_modules/.bin/*.cmd` générés par npm passent par cmd, où `&` sépare deux
commandes : ils échouent. Les scripts de ce dépôt appellent donc chaque outil
par son chemin JS (`node node_modules/vite/bin/vite.js`) au lieu du raccourci.

`electron-builder` n'a pas été testé dans ces conditions et échouera
probablement. **Renommer le dossier en `tuiles-et-toiles` réglerait le sujet
définitivement.**

## Port du serveur de développement

Vite écoute sur **5500**, pas sur le 5173 habituel : cette machine réserve
plusieurs plages de ports (Hyper-V / WinNAT) dont 5173 et 4173 font partie.
Un `listen EACCES` sur un port libre en apparence vient de là. La liste :

```bash
netsh interface ipv4 show excludedportrange protocol=tcp
```
