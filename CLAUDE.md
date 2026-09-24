# Bristol — état du projet

Application de bureau de **fiches de révision**, tous sujets. Le cœur : à partir
d'une fiche unique, le moteur génère automatiquement **N angles de quiz**
(masques) au lieu d'un recto/verso figé — c'est le différenciateur face à Anki.

Electron + React + SQLite. Windows, mono-utilisateur.

**Fork de Tuiles & Toiles** (`../tuiles-et-toiles`, en hiatus) : T&T était figé sur
6 champs « histoire de l'art ». Bristol rend le schéma **piloté par gabarit** pour
servir l'anatomie (déclencheur : Atlas Netter, section 1) ou n'importe quel sujet.

## Où on en est

**Release test buildable** (2026-09-10) : `npm run dist` → `release/Bristol-<version>.exe`
(portable, 100 Mo). Deck livré = anatomie (205 fiches, tout `libre`, diffusable).
`faire-icone.js` no-op si `icone-source.jpg` absent. `deck-actif.json` = anatomie
→ `stage-release` vise le bon deck. 36 fiches portent une 2ᵉ vignette `<id>-3d.jpg`
(rendu BodyParts3D) à côté de la gravure Gray — relecture / comparaison en app.
Reste avant diffusion : relecture du contenu **via l'app**, jugement des rendus 3D,
audit qualité des tirages (masques très permissifs : ~250/256 valides par fiche).

**Phase 1 + P2 + P2b faites** :

- schéma `gabarit` (champs typés + drapeaux de masque) + `fiches.donnees` JSON
- `masques.js` généralisé : `calculer(fiches, champs)` — sujet-agnostique
- **multi-decks** (P2b) : chaque deck construit dans `data/packs/<deck>.db` ;
  deck actif dans `reglages.deck_actif` ; page **Decks** (barre latérale) liste +
  bascule (DETACH/ATTACH + `reconstruireVue` + reload). `db.ouvrir(USER)` puis
  `db.attacherDeck(chemin)`. `src/main/decks.js`.
- **import CSV** (P2b) : page Decks → « Importer un CSV » → assistant.
  *Nouveau deck* : gabarit dérivé des en-têtes (types devinés, drapeaux
  ajustables) → `data/<deck>/` + `import.js` + activation. *Ajout au deck courant* :
  mapping colonne→champ → `edition.creerLot` (fiches locales). `src/main/csv-import.js`.
- `reconstruireVue` filtre `fiches_locales WHERE gabarit = <actif>` + garde `vue_deck`.
- build : `npm run import -- <deck>` depuis `data/<deck>/`
- terminologie renommée (`oeuvres`→`fiches`, IPC `fiches:*`, protocole `fiche://`)
- **rendu piloté par gabarit** (P2) : `src/renderer/champs.jsx` + `Tuile`,
  `CarteTuile`, `EditeurTuile`, aperçu bouclent sur `etat.gabarit.champs` (via
  `GabaritContext`). Types rendus : image, texte_court/date/nombre (grille),
  texte_long (bloc scrollable), liste. `toujours_cache` → « ? ? ? ? » révélable.
- **provenance des images** (P2) : `data/<deck>/images/{libre,ebook}/` + colonne
  CSV `image_src` + colonne `fiches.image_src`. `pack_meta.sous_licence` = compte.
  `npm run import -- <deck> --audit` (rapport) / `--release` (omet les `ebook`,
  fiche gardée). `npm run dist` → `scripts/stage-release.js` : build `--release`
  + copie `images/libre/` → `data/images/` (jamais `ebook/`).
- **régression** : pack art (431 fiches) → masques **identiques bit à bit** à T&T
  (min 35 / méd 55 / max 59, 0 bloquée). Vérifié après P1 et P2.
- deck de test `data/anatomie/` (3 fiches) : l'app tourne dessus
- banc d'essai rendu (dev) : `src/renderer/harness.{html,jsx}` stubbe `window.api`
  depuis `_fixture.json` → `http://localhost:5500/harness.html` teste App.jsx dans
  un navigateur ordinaire. Régénérer la fixture : dump depuis `db`/`jeu` (jetable).

**Suite (non fait)** :

- **P2c** : import Anki `.apkg` ; multi-deck **empaqueté** (livrer plusieurs decks +
  images) ; assistant CSV → étape « joindre un dossier d'images » ; supprimer/exporter
  un deck depuis la page Decks
- **P3** répétition espacée **FSRS** (remplace `user_stats` + tag « à revoir »)
- **P4** occlusion d'image ; cloze `{{c1::…}}`
- **P5** LaTeX/MathJax ; tags hiérarchiques ; priorité 1re classe ; champ Sources en UI
- **contenu** : deck Netter section 1 « Tête et cou » — mémoire `netter-sources`.
  - `scripts/extraire-netter.py <epub 6e> <pdf 6e>` → 151 planches rendues du PDF
    @ 200 dpi (filigrane rogné) `data/anatomie/images/ebook/pl###.jpg` (~1750px,
    gitignoré) + `planches-source.csv` + `planches-legendes.json`.
  - `scripts/telecharger-libre.py` → images `libre/` (licences PD/CC-BY/SA/CC0
    seulement) + `credits-libre.json` + `ATTRIBUTIONS.md`. Le classeur auto
    (image d'infobox / catégorie Commons) est peu fiable en anatomie → dict
    `OVERRIDE` en tête du script = planche Commons imposée par structure
    (Gray's Anatomy 1918 PD vérifié + `Skull foramina labeled.svg` composite).
    SVG et GIF gardés tels quels ; le reste → JPEG ≤ 1500 px.
  - **Pilote fait** : `data/anatomie/contenu.csv` (TSV) = 43 fiches « os et
    ligaments » (1 fiche = 1 structure). **43 images `libre`** (28 PD, 1 CC0,
    14 CC-BY-SA) → `pack_meta.sous_licence = 0`, **deck entièrement diffusable**.
    `ATTRIBUTIONS.md` + `credits-libre.json`. Qualité `libre` = gravures Gray 1918,
    légendes anglais/latin (compromis diffusable vs planches Netter).
  - `articulation_uncovertebrale.png` : aucune image libre existante → **traduit +
    relégendé** (PIL) le diagramme `Cervical vertebra blank.png` (debivort,
    CC-BY-SA 3.0) — dérivée FR avec l'uncus ajouté, reste CC-BY-SA 3.0.
  - Reste : relecture des fiches pilote ; ~108 structures des autres sous-sections.
  - **Rendus 3D BodyParts3D** (`pyrender`, alternative aux gravures Gray) :
    - `scripts/apparier-bp3d.py` → brouillon `data/anatomie/bp3d.json` :
      pour chaque fiche, concept FMA + maillage STL (miroir
      `Kevin-Mattheus-Moerman/BodyParts3D`, 925 parties). `OVERRIDE` (os),
      appariement auto (myologie, difflib + gate token/système), `EXCLURE`
      (foramens, vues d'ensemble, maillage absent), `PLANS` (contexte + caméra
      par fiche). **36 fiches appariées** (25 os/rachis + ~11 muscles + cartilage
      thyroïde + globe oculaire) ; ~50 possibles à la main, le reste hors périmètre
      (nerfs/artères/méninges : pas de maillage exploitable).
    - `scripts/rendre-anatomie.py` lit `bp3d.json` : 2 passes opaques pyrender
      (cible / contexte) recomposées NumPy — **contourne l'OIT bancal de
      pyrender**. Cible rouge opaque toujours au-dessus, contexte en fantôme gris.
      Défaut → PNG `_bp3d-rendu/` (relecture). `--gif` → GIF tournant 720 px.
      `--ecrire` → JPEG ≤ 1500 px dans `images/libre/<id>.jpg` + entrée
      `credits-libre.json` (`CC-BY-SA 2.1 Japan`, DBCLS). Refuse d'écraser une
      image du deck sans `--force`.
    - Licence CC-BY-SA 2.1-ja → remixable BY-SA 4.0, cohérent avec le deck (déjà
      partiellement BY-SA). Attribution obligatoire, `sous_licence` inchangé.
    - Cache STL `_bp3d-cache/`, sorties `_bp3d-rendu/` : gitignorés.
    - Reste : relire les 36 rendus, ajuster `PLANS` (caméra/contexte) au cas par
      cas, `--ecrire` ceux qui valent mieux que la gravure Gray ; compléter
      `bp3d.json` à la main pour les ~15 autres muscles à maillage.

**Sources des images / remerciements** :
- `data/<deck>/credits-libre.json` (versionné) = source de vérité :
  `{ "fichier.jpg": { structure, auteur, licence, source (URL Commons), note? } }`.
  `telecharger-libre.py` le remplit ; compléter à la main pour les images ajoutées.
- `import.js` **refuse de bâtir** si une image `libre` n'y figure pas (dès que le
  fichier existe), et refuse un `--release` sans ce fichier.
- Génère `pack_meta.attributions` (markdown, dans le `.db`) + `data/<deck>/ATTRIBUTIONS.md`.
  `--release` écrit aussi `data/ATTRIBUTIONS.md` → `extraResources` l'embarque à
  côté de `pack.db`. `etat.attributions` l'expose au rendu.
- Les remerciements appartiennent au **pack**, pas à l'app (chaque deck porte les
  siens). Un champ optionnel `gabarit.json:credits` / `licence` s'ajoute en tête.

**Caveat non technique** : un deck qui suit la *sélection et l'ordre* d'une section
de Netter reste une compilation dérivée, même avec des images 100 % libres. La
provenance ne couvre que les images. Une release publique d'anatomie suppose une
sélection de structures indépendante.

Plans : `C:\Users\EryoGreg\.claude\plans\lazy-conjuring-peach.md` (P1),
`vast-munching-blum.md` (P2 + P2b).

## Le gabarit (`data/<deck>/gabarit.json`)

`{ cle, nom, champs: [ champ… ] }`. Un **champ** :

| clé | rôle |
|---|---|
| `cle`, `libelle`, `type`, `ordre` | `type` ∈ texte_court / texte_long / image / date / liste / nombre |
| `masquable` | le moteur peut le cacher (sinon : toujours visible) |
| `toujours_cache` | jamais visible au tirage — l'analogue générique de la « date » de T&T |
| `evocateur` | peut servir d'indice visible à lui seul |
| `evoc_min` | longueur mini du texte pour compter comme évocateur (déf. 60 si texte_long) |
| `evoc_si_unique` | évocateur quand sa valeur est unique dans le corpus (ex. artiste) |
| `verif_fuite` | ce champ caché ne doit pas être trahi par un texte_long visible |
| `fuite_min_mots` | nb de mots significatifs requis pour qu'une fuite compte (déf. 2) |
| `role: "categories"` | champ sur lequel porte le mode catégorie (1 par gabarit) |
| `role: "titre"` / `role: "sous_titre"` | titre / sous-titre des cartes de galerie (fallback : 1er / 2e `texte_court`) |

`data/<deck>/contenu.csv` : 1 colonne par `cle` + `id` (slug) + `image` +
`image_src` (`libre` défaut / `ebook`). **Séparateur auto-détecté** par
`import.js:lireCsv` : TABULATION si présente dans l'en-tête, sinon `;`. La prose
française contient des `;` → **écrire le contenu en TSV** (tabulation, jamais
saisie par mégarde). `lireCsv` jette une erreur explicite si une ligne n'a pas le
bon nombre de champs (plus de décalage silencieux). Le deck `anatomie` est en TSV,
le pack `art` (manifest T&T) reste en `;` + guillemets.

Les bitmasks de `fiches.masques` sont indexés sur l'**ordre des champs masquables**
du gabarit → n'ont de sens qu'avec ce gabarit (qui voyage dans `pack.db`).

## Architecture données

| `pack.db` — attaché sous `pack`, lecture seule | `utilisateur.db` — connexion principale, inscriptible |
|---|---|
| `gabarit` (cle, nom, champs JSON) | `user_tags`, `user_stats`, `user_corrections`, `reglages`, `sync` |
| `fiches` (id, ref, gabarit, **donnees JSON**, image, dims, hash, recherche, masques) | `user_archive` (fiche_id) |
| `pack_meta` (deck, gabarit, version, hash, n_fiches) | `user_overrides` (fiche_id, champ, valeur, valeur_source) |
| | `fiches_locales` (mêmes champs + cree_le, modifie_le) |
| | `fiches_effectives` — vue matérialisée = pack (− archive, overrides pliés) + fiches_locales |

`db.ouvrir(USER, PACK)` → ATTACH pack.db + `chargerGabarit()`. Toute lecture de
contenu vise `fiches_effectives` (reconstruite à l'ouverture et après chaque
écriture user). `db.champs()` = les définitions triées par `ordre`.

## Règles non négociables (héritées de T&T)

1. **Le pack est du contenu, remplaçable en bloc.** `data/pack.db` est généré
   hors ligne. L'app au runtime n'y écrit jamais. MAJ de pack = remplacer le
   fichier ; `utilisateur.db` n'est jamais touché.
2. **Un champ `toujours_cache` n'est jamais visible au tirage** — révélable au
   clic comme tout autre. En histoire de l'art c'est la date.
3. **Mono-utilisateur, création locale de fiches permise.** Les fiches créées
   vivent dans `fiches_locales`, jamais dans le pack ; elles s'exportent en zip.
4. **Rien de mutable dans `pack.db`.** Tags, archivage, corrections, fiches
   locales → `utilisateur.db`, pointant les fiches par `id` (stable), jamais `ref`.

## Identité des fiches

- `id` — `p:` + 10 hex (pack) ou `local:<uuid>`, opaque, gelé dans
  `data/<deck>/registre.json`, jamais réutilisé. Clé de toutes les relations user_*.
- `ref` — numéro d'affichage figé (`"001"…`, locales `"L1"…`), jamais renuméroté.
- Le CSV `data/<deck>/contenu.csv` : une colonne par `cle` de champ + `id` (slug,
  clé du registre) + `image`. Le build gèle `slug → {id, ref}`.

## Build

```
npm run import -- <deck>            # -> data/packs/<deck>.db
npm run import -- <deck> --audit    # rapport provenance images, pas de build
npm run import -- <deck> --release  # -> data/pack.db (images ebook omises)
npm run dist                        # stage-release.js + vite + electron-builder
```
`import.js` lit `data/<deck>/{gabarit.json, contenu.csv, registre.json, images/{libre,ebook}/}`.
Build normal → `data/packs/<deck>.db` (bibliothèque de decks). `--release` →
`data/pack.db` (artefact d'empaquetage). Sans argument : deck de `data/deck-actif.json`.
`stage-release.js` résout le deck (arg / `reglages.deck_actif` / 1er pack), build
`--release`, stage `images/libre/` → `data/images/`. `extraResources` = `data/pack.db`
+ `data/images` (un seul deck livré ; multi-deck empaqueté = P2c).

En dev : `index.js` ouvre `utilisateur.db`, lit `reglages.deck_actif`, attache
`data/packs/<deck>.db`. Bascule via la page Decks (IPC `decks:activer`).

## Pièges de l'environnement (hérités de T&T, toujours valides)

- **Port Vite = 5500.** Cette machine réserve des plages (Hyper-V) dont 4173 et
  5173. `netsh interface ipv4 show excludedportrange protocol=tcp`.
- **better-sqlite3** compilé pour l'ABI d'Electron : le Node système plante
  (`NODE_MODULE_VERSION`). Passer par `node scripts/lancer-node.js <fichier>`
  (Electron en mode node). Binaire téléchargé prêt à l'emploi
  (`scripts/binaire-sqlite.js` via prebuild-install), pas compilé. `npm install`
  peut échouer sur le build gyp de better-sqlite3 — dans ce cas, copier
  `node_modules/better-sqlite3` depuis une install qui marche.
- **Backticks dans les commentaires SQL** : `db.js` définit `SCHEMA_*` comme
  template literals — pas de `` ` `` dans les commentaires à l'intérieur.
- **`productName` = `Bristol`** (pas de `&` ni d'espace — piège chemins Windows).
- **Exe portable** : `portable.unpackDirName` versionné (`Bristol-${version}`).

## Outils

- Upscaling d'images (planches Netter basse déf en secours) : **HAT** dans
  `C:\AI\HAT` (super-résolution, mode chunked). Pas LM Studio (= LLM seulement).
