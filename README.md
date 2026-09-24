# Bristol

Application de bureau de **fiches de révision**, tous sujets. À partir d'une
fiche unique, le moteur génère automatiquement *N* angles de quiz (masques) au
lieu d'un recto/verso figé.

Electron + React + SQLite. Windows, mono-utilisateur. Fork de *Tuiles & Toiles*
(schéma désormais piloté par gabarit).

## Pour les testeurs

Lancer `Bristol-<version>.exe` (portable, aucune installation). Au premier
démarrage l'app crée ses données dans `%APPDATA%\Bristol\` et copie le deck
livré (**Anatomie — Tête et cou**, 205 fiches).

À vérifier pendant le test :

- **contenu des fiches** : erreurs anatomiques, coquilles, formulations. Chaque
  fiche = une structure ; les textes sont une synthèse originale à relire.
- **images** : 36 fiches portent une 2ᵉ vignette « rendu 3D » (BodyParts3D) à
  côté de la gravure Gray 1918 — dire laquelle est la meilleure, signaler les
  rendus ratés (cadrage, structure méconnaissable).
- **jeu** : les tirages sont-ils trop faciles / la réponse fuite-t-elle dans un
  champ visible / une fiche revient-elle toujours avec le même masque.
- **la synchro Google Drive est optionnelle** : l'app tourne identique sans
  compte. Le bouton n'apparaît utile qu'aux testeurs ajoutés au projet OAuth.

Remonter les bugs : *(à compléter — canal de retour)*

## Développement

```bash
npm install
npm run import -- anatomie   # data/anatomie/ -> data/packs/anatomie.db
npm run dev                  # Vite (port 5500) + Electron, rechargement à chaud
```

| Commande | Effet |
|---|---|
| `npm run dev` | serveur Vite puis Electron |
| `npm run build` | compile le rendu dans `dist/` |
| `npm run import -- <deck>` | (re)construit `data/packs/<deck>.db` depuis `data/<deck>/` |
| `npm run dist` | build portable Windows (`release/Bristol-<version>.exe`) |

`npm run dist` : `stage-release.js` reconstruit `data/pack.db` en mode
`--release` (deck actif = `data/deck-actif.json`), copie `images/libre/` à plat
dans `data/images/`, puis electron-builder empaquette. Les images `ebook`
(planches Netter sous licence) ne sont **jamais** embarquées.

## Structure

```
src/main/          processus principal Electron (Node)
  index.js         fenêtre, protocole fiche://, canaux IPC
  db.js            SQLite : utilisateur.db + ATTACH pack.db
  masques.js       moteur de masques, sujet-agnostique
  jeu.js           tirage en sac sans remise
  import.js        data/<deck>/ -> pack.db (piloté par gabarit.json)
  decks.js         multi-deck (bascule ATTACH/DETACH)
  drive.js         sauvegarde Google Drive (optionnelle, non bloquante)
src/renderer/      interface (React) — App.jsx, champs.jsx (rendu par gabarit)
scripts/           outils de build + pipeline images anatomie
data/<deck>/       gabarit.json + contenu.csv (TSV) + images/ + credits-libre.json
```

## Le gabarit

Chaque deck définit ses champs dans `data/<deck>/gabarit.json` : type
(`texte_court` / `texte_long` / `image` / `date` / `liste` / `nombre` /
`occlusion`), et des drapeaux qui pilotent le moteur de masques (`masquable`,
`toujours_cache`, `evocateur`, `verif_fuite`, `role`…). Les bitmasks de
`fiches.masques` sont indexés sur l'ordre des champs masquables du gabarit : ils
n'ont de sens qu'avec ce gabarit, qui voyage dans `pack.db`.

## Le moteur de masques

Un masque = l'ensemble des champs visibles. Retenu pour une fiche s'il est
**discriminant** (ne désigne qu'elle), **évocateur** (au moins un indice
reliable par un humain), **sans fuite** (aucun champ visible ne trahit un champ
caché) et **incomplet**. Un champ `toujours_cache` n'est jamais visible ni
indice — l'analogue générique de la « date » de T&T.

## Images du deck anatomie

- `scripts/telecharger-libre.py` — 1 image libre par fiche (Wikipédia FR +
  Commons, licences PD/CC0/CC-BY/CC-BY-SA), `dict OVERRIDE` pour forcer une
  planche. Remplit `credits-libre.json`.
- `scripts/extraire-netter.py` — planches du PDF Netter (`images/ebook/`,
  usage perso, jamais diffusé).
- `scripts/apparier-bp3d.py` + `scripts/rendre-anatomie.py` — rendus 3D
  BodyParts3D (pyrender). `--ecrire` ajoute `<id>-3d.jpg` comme vignette
  supplémentaire. `bp3d.json` = config (36 fiches). CC-BY-SA 2.1 Japan.
- `import.js` refuse de bâtir si une image `libre` n'est pas créditée dans
  `credits-libre.json`. `ATTRIBUTIONS.md` est généré, embarqué à côté de `pack.db`.

## Pièges de l'environnement

- **Port 5500** : cette machine réserve des plages (Hyper-V / WinNAT) dont 5173
  et 4173. `netsh interface ipv4 show excludedportrange protocol=tcp`.
- **better-sqlite3** compilé pour l'ABI Electron → le Node système plante
  (`NODE_MODULE_VERSION`). Passer par `node scripts/lancer-node.js <fichier>`.
- **`ffmpeg.dll` en quarantaine Defender** (faux positif Electron non signé) :
  si l'exe portable refuse de démarrer, exclure le dossier d'extraction
  `%LOCALAPPDATA%\Temp\Bristol-<version>\` ou signer l'exe.
- **pyrender** (rendus 3D) : besoin d'un contexte OpenGL → tourne sur un poste
  avec écran + GPU, pas en CI headless.
