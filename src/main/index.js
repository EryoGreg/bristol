'use strict';
/**
 * Processus principal Electron.
 *
 * Isolation stricte : le rendu n'a aucun acces a Node. Tout passe par les
 * canaux IPC declares plus bas et exposes via preload.js. C'est indispensable
 * ici, le processus principal detiendra le jeton OAuth.
 */

const { app, BrowserWindow, ipcMain, nativeTheme, protocol, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { spawnSync } = require('child_process');
const db = require('./db');
const jeu = require('./jeu');
const edition = require('./edition');
const images = require('./images');
const raccourcis = require('./raccourcis');
const journal = require('./journal');
const sauvegarde = require('./sauvegarde');
const drive = require('./drive');
const decks = require('./decks');
const csvImport = require('./csv-import');

// Avant tout getPath('userData') : sinon Electron nomme le dossier d'apres le
// champ "name" du package.json (bristol).
app.setName('Bristol');

const DEV = !app.isPackaged;

// Contenu livre avec l'application (extraResources), lecture seule.
const DATA_LIVRE = DEV
  ? path.resolve(__dirname, '..', '..', 'data')
  : path.join(process.resourcesPath, 'data');

// Emplacement inscriptible : %APPDATA%\Bristol (pas a cote de l'exe, pas dans
// le cache temporaire du stub portable). En dev : le depot.
const DOSSIER_USER = DEV ? DATA_LIVRE : app.getPath('userData');

// Images des fiches creees par l'utilisateur.
const DOSSIER_IMAGES_LOCALES = path.join(DOSSIER_USER, 'images-locales');

// Decks installes : data/packs/<deck>.db (dev = depot, empaquete = ressources).
const DOSSIER_PACKS = path.join(DATA_LIVRE, 'packs');

// pack.db empaquete = le deck livre (release), a plat dans les ressources.
const PACK_LIVRE = path.join(DATA_LIVRE, 'pack.db');
const PACK_INSTALLE = path.join(DOSSIER_USER, 'pack.db');
// utilisateur.db = tags, archive, overrides, fiches locales. Jamais ecrase.
const USER = path.join(DOSSIER_USER, 'utilisateur.db');

// Racine des images du deck actif — recalculee a chaque bascule (dev).
// Empaquete : un seul deck, images a plat sous resources/data/images/.
let DOSSIER_IMAGES = path.join(DATA_LIVRE, 'images');
function majDossierImages(deck) {
  DOSSIER_IMAGES = (DEV && deck)
    ? path.join(DATA_LIVRE, deck, 'images')
    : path.join(DATA_LIVRE, 'images');
}

/** Chemin du pack a attacher pour le deck `deck`. */
function cheminPack(deck) {
  if (!DEV) return fs.existsSync(PACK_INSTALLE) ? PACK_INSTALLE : PACK_LIVRE;
  const p = path.join(DOSSIER_PACKS, (deck || '') + '.db');
  if (fs.existsSync(p)) return p;
  return fs.existsSync(PACK_LIVRE) ? PACK_LIVRE : p;   // fallback dev
}

// Icone de fenetre en dev (l'exe empaquete porte deja la sienne).
const ICONE = path.join(__dirname, '..', '..', 'build', 'icon.png');

function preparerDonnees() {
  if (DEV) return;   // dev : data/packs/<deck>.db (import) + data/utilisateur.db
  fs.mkdirSync(DOSSIER_USER, { recursive: true });

  // Copie le pack livre s'il manque, ou si l'exe embarque une version STRICTEMENT
  // plus recente. Un pack telecharge plus tard (version superieure) n'est donc
  // jamais ecrase par le pack du bundle.
  const vInstall = lireVersionPack(PACK_INSTALLE);
  const vLivree = lireVersionPack(PACK_LIVRE);
  if (vLivree && (!vInstall || versionSuperieure(vLivree, vInstall))) {
    fs.copyFileSync(PACK_LIVRE, PACK_INSTALLE);
  }
}

// Lit pack_meta.version sans garder la connexion ouverte.
function lireVersionPack(chemin) {
  if (!fs.existsSync(chemin)) return null;
  const Database = require('better-sqlite3');
  try {
    const d = new Database(chemin, { readonly: true, fileMustExist: true });
    const r = d.prepare("SELECT valeur FROM pack_meta WHERE cle = 'version'").get();
    d.close();
    return r ? r.valeur : null;
  } catch (_) { return null; }
}

// a strictement superieure a b ? (semver "x.y.z")
function versionSuperieure(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

let fenetre = null;
let fermetureAutorisee = false;

// Les images vivent sur disque, hors du bundle : un protocole dedie evite
// d'ouvrir file:// au rendu.
protocol.registerSchemesAsPrivileged([
  { scheme: 'fiche', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#14110F',
    show: false,
    autoHideMenuBar: true,
    icon: fs.existsSync(ICONE) ? ICONE : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  fenetre.once('ready-to-show', () => fenetre.show());

  // Erreurs et console du rendu -> journal.
  fenetre.webContents.on('console-message', (_e, niveau, message, ligne, source) => {
    if (niveau >= 3) journal.ligne('[ui] console.error', { message, source: source + ':' + ligne });
  });
  fenetre.webContents.on('render-process-gone', (_e, d) => journal.ligne('ERREUR rendu perdu', d));
  fenetre.webContents.on('did-fail-load', (_e, code, desc) => journal.ligne('ERREUR did-fail-load', { code, desc }));

  // Garde-fou fermeture : la croix Windows ne quitte pas directement, le rendu
  // affiche d'abord le dialogue de confirmation. Seul app:quitter (bouton du
  // dialogue) leve la garde.
  fenetre.on('close', (e) => {
    if (fermetureAutorisee) return;
    e.preventDefault();
    fenetre.webContents.send('app:tenter-fermeture');
  });

  // Boutons lateraux de la souris (Windows) : naviguer dans l'historique de
  // pages de l'appli, pas dans l'historique du webContents.
  fenetre.on('app-command', (e, cmd) => {
    if (cmd === 'browser-backward') { e.preventDefault(); fenetre.webContents.send('app:nav', 'reculer'); }
    else if (cmd === 'browser-forward') { e.preventDefault(); fenetre.webContents.send('app:nav', 'avancer'); }
  });

  if (DEV) {
    fenetre.loadURL('http://127.0.0.1:5500');
  } else {
    fenetre.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  journal.configurer(path.join(DOSSIER_USER, 'logs'));
  journal.armerErreurs(app);
  journal.ligne('demarrage', { dev: DEV, version: app.getVersion() });
  preparerDonnees();

  protocol.handle('fiche', (requete) => {
    const brut = decodeURIComponent(new URL(requete.url).hostname
      + new URL(requete.url).pathname).replace(/^\/+/, '');
    const nom = path.basename(brut);
    // Image locale d'abord (fiche creee), puis image du pack : a plat (paquet)
    // ou dans les sous-dossiers de provenance libre/ ebook/ (dev).
    const dossiers = [
      DOSSIER_IMAGES_LOCALES,
      DOSSIER_IMAGES,
      path.join(DOSSIER_IMAGES, 'libre'),
      path.join(DOSSIER_IMAGES, 'ebook')
    ];
    for (const dossier of dossiers) {
      const cible = path.join(dossier, nom);
      if (cible.startsWith(dossier) && fs.existsSync(cible)) {
        return net.fetch(pathToFileURL(cible).toString());
      }
    }
    return new Response('', { status: 404 });
  });

  // 1. Ouvre utilisateur.db seul, 2. resout le deck actif (reglage), 3. attache.
  db.ouvrir(USER);
  decks.configurer(DOSSIER_PACKS);
  const deck = decks.actifOuDefaut()
    || (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_LIVRE, 'deck-actif.json'), 'utf8')).deck; } catch (_) { return null; } })()
    || 'art';
  majDossierImages(deck);
  db.attacherDeck(cheminPack(deck));
  db.definirReglage('deck_actif', deck);

  edition.configurer(DOSSIER_IMAGES_LOCALES);
  edition.nettoyerOrphelines();   // images importees jamais validees
  sauvegarde.configurer({
    user: USER, imagesLocales: DOSSIER_IMAGES_LOCALES, pack: cheminPack(deck), versionApp: app.getVersion()
  });
  drive.configurer({ dossierUser: DOSSIER_USER });

  // Premier lancement : thème Dracula par défaut (aucun réglage encore posé).
  if (db.reglage('theme') == null) db.definirReglage('theme', 'dracula');

  journal.ligne('base ouverte', { deck, fiches: db.compterFiches(), theme: db.reglage('theme') });

  // Aucun raccourci n'est cree automatiquement : au premier lancement le rendu
  // propose (bureau / barre / menu Demarrer), rappel qu'Options le refait.
  creerFenetre();

  // Theme 'auto' : pousse le changement au rendu sans qu'il ait a sonder.
  nativeTheme.on('updated', () => {
    if (fenetre) {
      fenetre.webContents.send('theme:systeme-change', nativeTheme.shouldUseDarkColors ? 'sombre' : 'clair');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) creerFenetre();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- canaux IPC ------------------------------------------------------------

ipcMain.handle('etat', () => {
  const meta = db.packMeta();
  return {
    fiches: db.compterFiches(),
    gabarit: { cle: db.gabarit().cle, nom: db.gabarit().nom, champs: db.champs() },
    deck: meta.deck || db.reglage('deck_actif') || null,
    sousLicence: parseInt(meta.sous_licence, 10) || 0,
    attributions: meta.attributions || null,
    decks: decks.lister(),
    tags: db.comptesTags(),
    revision: jeu.compteursRevision(),
    reglagesRevision: {
      nouvellesParJour: parseInt(db.reglage('revision_nouvelles_par_jour', '20'), 10) || 20,
      maxParJour: parseInt(db.reglage('revision_max_par_jour', '200'), 10) || 0,
      retention: parseFloat(db.reglage('revision_retention', '0.9')) || 0.9
    },
    theme: db.reglage('theme', 'auto'),
    sidebarRepliee: db.reglage('sidebar_repliee', '0') === '1',
    grilleColonnes: parseInt(db.reglage('grille_colonnes', '5'), 10) || 5,
    raccourcisProposes: db.reglage('raccourcis_proposes', '0') === '1',
    derniereSynchro: db.etatSync('derniere_synchro')
  };
});

ipcMain.on('journal', (_e, msg, extra) => journal.ligne('[ui] ' + msg, extra));

// --- decks ---------------------------------------------------------------

/** Bascule le deck actif : ATTACH + dossier images + config sauvegarde. */
function basculerDeck(deck) {
  const r = decks.activer(deck);
  if (r.erreur) return r;
  majDossierImages(deck);
  sauvegarde.configurer({
    user: USER, imagesLocales: DOSSIER_IMAGES_LOCALES, pack: cheminPack(deck), versionApp: app.getVersion()
  });
  journal.ligne('deck activé', { deck, fiches: db.compterFiches() });
  return { ok: true, deck };
}

ipcMain.handle('decks:lister', () => decks.lister());
ipcMain.handle('decks:activer', (_e, deck) => basculerDeck(deck));

// --- import CSV --------------------------------------------------------

ipcMain.handle('csv:analyser', async () => {
  const r = await dialog.showOpenDialog(fenetre, {
    title: 'Choisir un fichier CSV',
    filters: [{ name: 'CSV', extensions: ['csv', 'tsv', 'txt'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths[0]) return { annule: true };
  try {
    return { chemin: r.filePaths[0], ...csvImport.analyser(r.filePaths[0]) };
  } catch (e) {
    return { erreur: 'CSV illisible : ' + e.message };
  }
});

ipcMain.handle('csv:creerDeck', (_e, { deck, gabarit, chemin }) => {
  try {
    const cleDeck = csvImport.slug(deck);
    if (!cleDeck) return { erreur: 'Nom de deck invalide.' };
    const dossier = path.join(DATA_LIVRE, cleDeck);
    if (fs.existsSync(path.join(dossier, 'gabarit.json'))) return { erreur: 'Un deck "' + cleDeck + '" existe déjà.' };
    fs.mkdirSync(path.join(dossier, 'images', 'libre'), { recursive: true });
    fs.mkdirSync(path.join(dossier, 'images', 'ebook'), { recursive: true });
    fs.writeFileSync(path.join(dossier, 'gabarit.json'),
      JSON.stringify({ cle: cleDeck, nom: deck || cleDeck, champs: gabarit.champs }, null, 2));
    fs.copyFileSync(chemin, path.join(dossier, 'contenu.csv'));
    fs.writeFileSync(path.join(dossier, 'registre.json'), '{}\n');

    const electron = require(path.join(__dirname, '..', '..', 'node_modules', 'electron'));
    const res = spawnSync(electron, [path.join(__dirname, 'import.js'), cleDeck], {
      stdio: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    if (res.status) return { erreur: 'Build échoué : ' + String(res.stderr || res.stdout).slice(-400) };

    const r = basculerDeck(cleDeck);
    journal.ligne('csv creerDeck', { deck: cleDeck });
    return r.erreur ? r : { ok: true, deck: cleDeck };
  } catch (e) {
    journal.ligne('ERREUR csv creerDeck', { message: e.message });
    return { erreur: e.message };
  }
});

ipcMain.handle('csv:ajouter', (_e, { chemin, mapping }) => {
  try {
    const lignes = require('./import').lireCsv(fs.readFileSync(chemin, 'utf8'));
    const lot = lignes.map((row) => {
      const champs = {};
      for (const [colCsv, cleChamp] of Object.entries(mapping)) {
        if (cleChamp && cleChamp !== '__ignore__') champs[cleChamp] = row[colCsv] || '';
      }
      return champs;
    });
    const r = edition.creerLot(lot);
    journal.ligne('csv ajouter', { crees: r.crees });
    return { ok: true, ...r };
  } catch (e) {
    journal.ligne('ERREUR csv ajouter', { message: e.message });
    return { erreur: e.message };
  }
});

ipcMain.handle('edition:creer', (_e, champs) => {
  const r = edition.creer(champs || {});
  journal.ligne('edition creer', { ref: r.ref, masques: r.masques });
  return r;
});
ipcMain.handle('edition:fiche', (_e, id) => edition.fiche(id));
ipcMain.handle('edition:modifier', (_e, { id, champs }) => {
  const r = edition.modifier(id, champs || {});
  journal.ligne('edition modifier', { id, ref: r.ref, masques: r.masques });
  return r;
});
ipcMain.handle('edition:supprimer', (_e, id) => {
  const r = edition.supprimer(id);
  journal.ligne('edition supprimer', { id, archivee: r.archivee });
  return r;
});

ipcMain.handle('edition:importerImageUrl', async (_e, url) => {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return { erreur: 'URL non supportée.' };
    const res = await net.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          + '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return { erreur: 'Téléchargement refusé (' + res.status + ').' };
    if (!(res.headers.get('content-type') || '').startsWith('image/')) {
      return { erreur: 'Le lien ne pointe pas vers une image.' };
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength > 25 * 1024 * 1024) return { erreur: 'Image trop lourde (> 25 Mo).' };
    return await images.importer(Buffer.from(ab), DOSSIER_IMAGES_LOCALES);
  } catch (e) {
    return { erreur: 'Échec : ' + e.message + '. Télécharge l’image puis glisse le fichier.' };
  }
});

ipcMain.handle('edition:choisirImage', async () => {
  const r = await dialog.showOpenDialog(fenetre, {
    title: 'Choisir une image',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return images.importer(r.filePaths[0], DOSSIER_IMAGES_LOCALES);
});

ipcMain.handle('edition:importerImage', (_e, octets) =>
  images.importer(Buffer.from(octets), DOSSIER_IMAGES_LOCALES));

ipcMain.handle('edition:oublierImage', (_e, nom) => edition.oublierImage(nom));

ipcMain.handle('sauvegarde:exporter', async () => {
  const defaut = 'bristol-' + new Date().toISOString().slice(0, 10) + '.zip';
  const r = await dialog.showSaveDialog(fenetre, {
    title: 'Exporter mes données',
    defaultPath: path.join(app.getPath('documents'), defaut),
    filters: [{ name: 'Archive zip', extensions: ['zip'] }]
  });
  if (r.canceled || !r.filePath) return { annule: true };
  try {
    const out = sauvegarde.exporter(r.filePath);
    journal.ligne('sauvegarde export', { chemin: r.filePath, octets: out.octets });
    return { chemin: r.filePath, ...out };
  } catch (e) {
    journal.ligne('ERREUR sauvegarde export', { message: e.message });
    return { erreur: e.message };
  }
});

ipcMain.handle('sauvegarde:choisir', async () => {
  const r = await dialog.showOpenDialog(fenetre, {
    title: 'Choisir une sauvegarde',
    filters: [{ name: 'Archive zip', extensions: ['zip'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths[0]) return { annule: true };
  return { chemin: r.filePaths[0], ...sauvegarde.inspecter(r.filePaths[0]) };
});

ipcMain.handle('sauvegarde:importer', (_e, chemin) => {
  try {
    const out = sauvegarde.importer(chemin);
    if (out.erreur) { journal.ligne('sauvegarde import refuse', { chemin, erreur: out.erreur }); return out; }
    journal.ligne('sauvegarde import', { chemin, comptes: out.comptes });
    return out;
  } catch (e) {
    journal.ligne('ERREUR sauvegarde import', { message: e.message });
    return { erreur: e.message };
  }
});

ipcMain.handle('drive:etat', () => drive.etat());
ipcMain.handle('drive:connecter', async () => {
  const r = await drive.connecter();
  journal.ligne('drive connecter', { connecte: !!r.connecte, erreur: r.erreur || null });
  return { ...drive.etat(), ...r };
});
ipcMain.handle('drive:deconnecter', () => { drive.deconnecter(); journal.ligne('drive deconnecter'); return drive.etat(); });
// Jeton refuse par Google en cours d'operation : drive.js relance le flux
// OAuth ; on previent le rendu pour qu'il affiche « autorise dans le navigateur ».
const surReconnexionDrive = (e) => () => {
  journal.ligne('drive reconnexion auto');
  if (!e.sender.isDestroyed()) e.sender.send('drive:reconnexion');
};
ipcMain.handle('drive:pousser', async (e, opts) => {
  const r = await drive.pousser(opts || {}, surReconnexionDrive(e));
  journal.ligne('drive pousser', { ok: !!r.ok, conflit: !!r.conflit, reconnecte: !!r.reconnecte, erreur: r.erreur || null });
  return r;
});
ipcMain.handle('drive:tirer', async (e, opts) => {
  const r = await drive.tirer(opts || {}, surReconnexionDrive(e));
  journal.ligne('drive tirer', { ok: !!r.ok, aJour: !!r.aJour, reconnecte: !!r.reconnecte, erreur: r.erreur || null });
  return r;
});

ipcMain.handle('raccourcis:etat', () => raccourcis.etat());
ipcMain.handle('raccourcis:perimes', () => raccourcis.perimes());
ipcMain.handle('raccourcis:basculer', async (_e, type) => {
  const r = await raccourcis.basculer(type);
  return { etat: raccourcis.etat(), manuel: r.manuel };
});
ipcMain.handle('raccourcis:reparer', (_e, types) => {
  raccourcis.reparer(types);
  return raccourcis.etat();
});

ipcMain.handle('jeu:tirer', (_e, tagJeu) => jeu.tirer(tagJeu || null));
ipcMain.handle('jeu:reveler', (_e, id) => jeu.reveler(id));
ipcMain.handle('jeu:apercu', (_e, id) => jeu.apercu(id));
ipcMain.handle('jeu:categories', () => jeu.categories());
ipcMain.handle('jeu:apercuCategories', (_e, sel) => jeu.apercuCategories(sel || {}));

ipcMain.handle('revision:file', () => jeu.fileRevision());
ipcMain.handle('revision:tirer', () => jeu.tirerRevision());
ipcMain.handle('revision:noter', (_e, { id, note }) => jeu.noter(id, note));
ipcMain.handle('revision:apercuNotes', (_e, id) => jeu.apercuNotes(id));
ipcMain.handle('revision:stats', () => jeu.statsRevision());
ipcMain.handle('revision:reinitialiser', () => { jeu.reinitialiserProgression(); return true; });

ipcMain.handle('fiches:chercher', (_e, criteres) => db.chercher(criteres || {}));
ipcMain.handle('fiches:numero', (_e, n) => db.parNumero(n));
ipcMain.handle('fiches:parTag', (_e, { tag, texte } = {}) => jeu.listerParTag(tag, texte));
ipcMain.handle('fiches:toutes', (_e, criteres) => jeu.listerToutes(criteres));

ipcMain.handle('tags:basculer', (_e, { id, tag }) => ({
  actif: db.basculerTag(id, tag),
  comptes: db.comptesTags()
}));

ipcMain.handle('tags:effacerTout', () => ({
  supprimes: db.effacerTousLesTags(),
  comptes: db.comptesTags()
}));

// Themes a fond clair : pilotent les elements natifs (menus, boites systeme)
// en mode clair. Tout le reste est en mode sombre.
const THEMES_CLAIRS = new Set([
  'clair', 'parchemin', 'lin', 'sepia', 'sepia-profond', 'taupe', 'ardoise'
]);

ipcMain.handle('reglages:definir', (_e, { cle, valeur }) => {
  db.definirReglage(cle, valeur);
  if (cle === 'theme') {
    // Le rendu affiche notre propre palette via data-theme ; ceci ne pilote
    // que les elements natifs (menus, boites systeme).
    nativeTheme.themeSource = valeur === 'auto'
      ? 'system'
      : (THEMES_CLAIRS.has(valeur) ? 'light' : 'dark');
  }
  return true;
});

ipcMain.handle('theme:systeme', () => (nativeTheme.shouldUseDarkColors ? 'sombre' : 'clair'));

// La confirmation de fermeture est une fenetre HTML aux tons de l'appli (voir
// App.jsx), pas une boite de dialogue Windows : plus de son systeme. Ce canal
// ferme directement, la question a deja ete posee cote rendu.
ipcMain.handle('app:quitter', () => {
  fermetureAutorisee = true;
  if (fenetre) fenetre.close(); else app.quit();
  return true;
});
