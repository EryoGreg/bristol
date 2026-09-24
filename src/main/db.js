'use strict';
/**
 * Deux bases, deux proprietaires.
 *
 *   pack.db  (attachee sous l'alias `pack`, LECTURE SEULE par convention)
 *     gabarit      definition des champs du deck (types + drapeaux de masque)
 *     fiches       le contenu du deck, remplace en bloc a chaque MAJ de pack
 *     pack_meta    version / hash / date du pack
 *
 *   utilisateur.db  (connexion principale, INSCRIPTIBLE)
 *     user_tags, user_stats, user_corrections   marques et progression
 *     user_archive        fiches du pack masquees par l'utilisateur
 *     user_overrides      corrections de champs sur une fiche du pack
 *     fiches_locales      fiches creees par l'utilisateur
 *     reglages, sync      preferences et etat de synchro
 *
 * Une MAJ de pack = remplacer pack.db. utilisateur.db n'est jamais touche.
 * Les tables user_* pointent vers les fiches par leur `id` (stable a vie),
 * jamais par leur `ref` (numero d'affichage).
 *
 * Les champs d'une fiche vivent dans une colonne JSON `donnees` : le jeu de
 * champs est defini par le gabarit du deck, pas code en dur. `image` reste une
 * colonne (asset binaire servi tel quel, protocole dedie).
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { calculer, normaliser } = require('./masques');

// --- schemas -------------------------------------------------------------

const SCHEMA_PACK = `
CREATE TABLE IF NOT EXISTS gabarit (
  cle    TEXT PRIMARY KEY,        -- 'histoire-art', 'anatomie', ...
  nom    TEXT,
  champs TEXT                     -- JSON : [ { cle, libelle, type, ordre, ...drapeaux } ]
);
CREATE TABLE IF NOT EXISTS fiches (
  id          TEXT PRIMARY KEY,   -- identifiant stable, jamais reutilise
  ref         TEXT,               -- numero d'affichage fige ("002".."432")
  gabarit     TEXT,               -- cle du gabarit
  donnees     TEXT DEFAULT '{}',  -- JSON { champ_cle: valeur }
  image       TEXT DEFAULT '',   -- nom de fichier, ou liste '|' pour une galerie
  image_src     TEXT DEFAULT 'libre', -- 'libre' | 'ebook' | 'ebook_omis', ou liste '|' positionnelle
  image_legende TEXT DEFAULT '',    -- legendes '|' positionnelles pour la galerie
  largeur     INTEGER,
  hauteur     INTEGER,
  octets      INTEGER,
  hash_texte  TEXT,               -- hash du contenu, sert a detecter un conflit d'override
  recherche   TEXT,               -- champ normalise pour la recherche permissive
  masques     TEXT                -- JSON : masques valides precalcules
);
CREATE INDEX IF NOT EXISTS idx_fiches_recherche ON fiches(recherche);
CREATE TABLE IF NOT EXISTS pack_meta (cle TEXT PRIMARY KEY, valeur TEXT);
`;

const SCHEMA_USER = `
CREATE TABLE IF NOT EXISTS user_tags (
  fiche_id TEXT NOT NULL,
  tag      TEXT NOT NULL CHECK (tag IN ('livre', 'etoile', 'bad_smiley')),
  cree_le  TEXT NOT NULL,
  PRIMARY KEY (fiche_id, tag)
);

CREATE TABLE IF NOT EXISTS user_stats (
  fiche_id    TEXT PRIMARY KEY,
  vues        INTEGER DEFAULT 0,
  dernier_vu  TEXT
);

-- Etat de repetition espacee (FSRS-4.5), une ligne par fiche revisee.
-- Fiche absente = neuve. Keyee par l'id STABLE, comme les autres user_*.
CREATE TABLE IF NOT EXISTS user_fsrs (
  fiche_id    TEXT PRIMARY KEY,
  stabilite   REAL,
  difficulte  REAL,
  due         TEXT,               -- ISO datetime : prochaine echeance
  dernier_vu  TEXT,
  reps        INTEGER DEFAULT 0,
  lapses      INTEGER DEFAULT 0,
  etat        INTEGER DEFAULT 0   -- 0 neuve · 1 apprentissage · 2 revision · 3 reapprentissage
);
CREATE INDEX IF NOT EXISTS idx_user_fsrs_due ON user_fsrs(due);

-- Journal des revisions : stats + future re-optimisation des poids FSRS.
CREATE TABLE IF NOT EXISTS user_revlog (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id    TEXT NOT NULL,
  note        INTEGER NOT NULL,   -- 1..4
  etat_avant  INTEGER,
  stabilite   REAL,
  difficulte  REAL,
  intervalle  INTEGER,            -- jours jusqu'a la prochaine echeance
  revu_le     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_revlog_fiche ON user_revlog(fiche_id);

CREATE TABLE IF NOT EXISTS user_corrections (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id TEXT NOT NULL,
  texte    TEXT NOT NULL,
  cree_le  TEXT NOT NULL,
  exporte  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reglages (cle TEXT PRIMARY KEY, valeur TEXT);
CREATE TABLE IF NOT EXISTS sync    (cle TEXT PRIMARY KEY, valeur TEXT);

-- Fiches du pack que l'utilisateur ne veut plus voir. Archivees, jamais
-- supprimees : si le pack les reconduit, elles restent masquees.
CREATE TABLE IF NOT EXISTS user_archive (
  fiche_id TEXT PRIMARY KEY,
  cree_le  TEXT NOT NULL
);

-- Corrections de champ sur une fiche DU PACK. champ = cle d'un champ du
-- gabarit (ou image). valeur_source = ce que le pack affichait au moment de
-- la correction, pour reperer un conflit apres MAJ.
CREATE TABLE IF NOT EXISTS user_overrides (
  fiche_id      TEXT NOT NULL,
  champ         TEXT NOT NULL,
  valeur        TEXT,
  valeur_source TEXT,
  cree_le       TEXT NOT NULL,
  modifie_le    TEXT,
  PRIMARY KEY (fiche_id, champ)
);

-- Fiches creees par l'utilisateur. Meme forme que pack.fiches, plus les dates.
CREATE TABLE IF NOT EXISTS fiches_locales (
  id          TEXT PRIMARY KEY,   -- "local:<uuid>"
  ref_local   TEXT,               -- "L1", "L2"...
  gabarit     TEXT,
  donnees       TEXT DEFAULT '{}',
  image         TEXT DEFAULT '',    -- nom de fichier dans images-locales/ (liste '|' possible)
  image_src     TEXT DEFAULT 'local',
  image_legende TEXT DEFAULT '',
  largeur     INTEGER,
  hauteur     INTEGER,
  octets      INTEGER,
  hash_texte  TEXT,
  recherche   TEXT,
  masques     TEXT,
  cree_le     TEXT NOT NULL,
  modifie_le  TEXT
);

-- Vue MATERIALISEE = pack (moins user_archive, overrides plies) + fiches_locales.
-- recherche et masques y sont recalcules. Toutes les lectures de contenu la
-- visent ; reconstruite a l'ouverture et apres chaque ecriture de couche user.
CREATE TABLE IF NOT EXISTS fiches_effectives (
  id          TEXT PRIMARY KEY,
  ref         TEXT,
  est_locale  INTEGER DEFAULT 0,
  gabarit     TEXT,
  donnees       TEXT DEFAULT '{}',
  image         TEXT DEFAULT '',
  image_src     TEXT DEFAULT 'libre',
  image_legende TEXT DEFAULT '',
  largeur     INTEGER,
  hauteur     INTEGER,
  octets      INTEGER,
  recherche   TEXT,
  masques     TEXT
);
CREATE INDEX IF NOT EXISTS idx_fiches_effectives_recherche ON fiches_effectives(recherche);
`;

let db = null;
let gabaritCache = null;   // { cle, nom, champs: [...] }

// --- gabarit -----------------------------------------------------------

/** Charge (et met en cache) le gabarit du deck. Phase 1 : un seul gabarit. */
function chargerGabarit() {
  const r = instance().prepare('SELECT cle, nom, champs FROM pack.gabarit LIMIT 1').get();
  gabaritCache = r
    ? { cle: r.cle, nom: r.nom, champs: JSON.parse(r.champs || '[]') }
    : { cle: null, nom: null, champs: [] };
  return gabaritCache;
}

function gabarit() {
  return gabaritCache || chargerGabarit();
}

/** Les definitions de champ du gabarit, triees par `ordre`. */
function champs() {
  return [...gabarit().champs].sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
}

/** Champs textuels (hors image) — pour construire `recherche` et plier les overrides. */
function champsTexte() {
  return champs().filter((c) => c.type !== 'image' && c.cle !== 'image');
}

/** Cle du champ marque `role: 'categories'`, ou null. */
function champCategories() {
  const c = champs().find((x) => x.role === 'categories');
  return c ? c.cle : null;
}

// --- ouverture -------------------------------------------------------

let deckAttache = false;

/**
 * Ouvre utilisateur.db (inscriptible). Le deck (pack) s'attache ensuite via
 * attacherDeck() — le choix du deck actif vit dans reglages.deck_actif, qu'on
 * ne peut lire qu'une fois utilisateur.db ouvert.
 * @param {string} cheminUser
 * @param {string} [cheminPack]  raccourci : ouvre puis attache dans la foulee
 */
function ouvrir(cheminUser, cheminPack) {
  if (db) { if (cheminPack && !deckAttache) attacherDeck(cheminPack); return db; }
  fs.mkdirSync(path.dirname(cheminUser), { recursive: true });
  db = new Database(cheminUser);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_USER);
  if (cheminPack) attacherDeck(cheminPack);
  return db;
}

/** Attache un deck (pack.db) sous l'alias `pack` et reconstruit la vue. */
function attacherDeck(cheminPack) {
  if (deckAttache) detacherDeck();
  instance().prepare('ATTACH DATABASE ? AS pack').run(cheminPack);
  deckAttache = true;
  chargerGabarit();
  reconstruireVue();
}

/** Detache le deck courant (avant d'en attacher un autre). */
function detacherDeck() {
  if (!deckAttache) return;
  try { instance().prepare('DETACH DATABASE pack').run(); } catch (_) { /* deja detache */ }
  deckAttache = false;
  gabaritCache = null;
}

/** Lit `pack_meta` d'un fichier deck sans le garder attache. */
function packMetaDe(chemin) {
  try {
    const d = new Database(chemin, { readonly: true, fileMustExist: true });
    const out = {};
    for (const r of d.prepare('SELECT cle, valeur FROM pack_meta').all()) out[r.cle] = r.valeur;
    d.close();
    return out;
  } catch (_) { return null; }
}

function instance() {
  if (!db) throw new Error('Base non ouverte : appeler ouvrir() d abord.');
  return db;
}

/** Ferme la connexion (avant de remplacer le fichier utilisateur.db). */
function fermer() {
  if (db) { db.close(); db = null; }
  gabaritCache = null;
  deckAttache = false;
}

/**
 * Copie transactionnellement propre de utilisateur.db (sans -wal, sans la base
 * pack attachee). `cible` ne doit pas exister.
 */
function exporterVers(cible) {
  instance().prepare('VACUUM INTO ?').run(cible);
}

// --- vue effective --------------------------------------------------

function hydrater(row) {
  if (!row) return row;
  let d = {};
  try { d = JSON.parse(row.donnees || '{}'); } catch (_) { d = {}; }
  return { ...row, donnees: d };
}

/**
 * Reconstruit `fiches_effectives` = pack.fiches (moins user_archive, overrides
 * plies) + fiches_locales. Recalcule `recherche` et `masques` sur l'ensemble
 * (les masques dependent de tout le corpus).
 *
 * force=false (au lancement) : saute si la couche user est ENTIEREMENT vide,
 * que le pack n'a pas change et que la vue est deja peuplee.
 * force=true : apres toute ecriture user, appeler avec force puis
 * jeu.reinitialiserSac().
 */
function reconstruireVue({ force = false } = {}) {
  const d = instance();

  const meta = {};
  for (const r of d.prepare('SELECT cle, valeur FROM pack.pack_meta').all()) meta[r.cle] = r.valeur;
  const hashPack = meta.hash || '';
  const deckPack = meta.deck || meta.gabarit || '';

  chargerGabarit();
  const gabaritCle = gabarit().cle;

  if (!force) {
    const vide =
      d.prepare('SELECT COUNT(*) n FROM user_archive').get().n === 0 &&
      d.prepare('SELECT COUNT(*) n FROM user_overrides').get().n === 0 &&
      d.prepare('SELECT COUNT(*) n FROM fiches_locales WHERE gabarit = ?').get(gabaritCle).n === 0;
    const dejaPeuplee = d.prepare('SELECT COUNT(*) n FROM fiches_effectives').get().n > 0;
    if (vide && dejaPeuplee
        && reglage('vue_pack_hash') === hashPack
        && reglage('vue_deck') === deckPack) return;
  }

  const defs = champs();
  const clesTexte = champsTexte().map((c) => c.cle);

  const archive = new Set(
    d.prepare('SELECT fiche_id FROM user_archive').all().map((r) => r.fiche_id)
  );
  const overrides = {};
  for (const r of d.prepare('SELECT fiche_id, champ, valeur FROM user_overrides').all()) {
    (overrides[r.fiche_id] || (overrides[r.fiche_id] = {}))[r.champ] = r.valeur;
  }

  const effectives = [];
  for (const o of d.prepare('SELECT * FROM pack.fiches').all()) {
    if (archive.has(o.id)) continue;
    let donnees = {};
    try { donnees = JSON.parse(o.donnees || '{}'); } catch (_) { donnees = {}; }
    let image = o.image;
    for (const [champ, val] of Object.entries(overrides[o.id] || {})) {
      if (champ === 'image') image = val;
      else donnees[champ] = val;
    }
    effectives.push({
      id: o.id, ref: o.ref, est_locale: 0, gabarit: o.gabarit, donnees,
      image, image_src: o.image_src || 'libre', image_legende: o.image_legende || '',
      largeur: o.largeur, hauteur: o.hauteur, octets: o.octets
    });
  }
  for (const o of d.prepare('SELECT * FROM fiches_locales WHERE gabarit = ?').all(gabaritCle)) {
    let donnees = {};
    try { donnees = JSON.parse(o.donnees || '{}'); } catch (_) { donnees = {}; }
    effectives.push({
      id: o.id, ref: o.ref_local, est_locale: 1, gabarit: o.gabarit, donnees,
      image: o.image, image_src: o.image_src || 'local', image_legende: o.image_legende || '',
      largeur: o.largeur, hauteur: o.hauteur, octets: o.octets
    });
  }

  const masques = calculer(effectives, defs);

  const ins = d.prepare(`INSERT INTO fiches_effectives
    (id, ref, est_locale, gabarit, donnees, image, image_src, image_legende, largeur, hauteur, octets, recherche, masques)
    VALUES
    (@id, @ref, @est_locale, @gabarit, @donnees, @image, @image_src, @image_legende, @largeur, @hauteur, @octets, @recherche, @masques)`);
  d.transaction(() => {
    d.exec('DELETE FROM fiches_effectives');
    for (const e of effectives) {
      const texte = [e.ref, ...clesTexte.map((k) => e.donnees[k] || '')].join(' ');
      ins.run({
        id: e.id, ref: e.ref, est_locale: e.est_locale, gabarit: e.gabarit || null,
        donnees: JSON.stringify(e.donnees),
        image: e.image || '', image_src: e.image_src || 'libre', image_legende: e.image_legende || '',
        largeur: e.largeur, hauteur: e.hauteur, octets: e.octets,
        recherche: normaliser(texte),
        masques: JSON.stringify(masques.get(e.id) || [])
      });
    }
  })();

  definirReglage('vue_pack_hash', hashPack);
  definirReglage('vue_deck', deckPack);
}

// --- fiches (lecture) ----------------------------------------------

function compterFiches() {
  return instance().prepare('SELECT COUNT(*) n FROM fiches_effectives').get().n;
}

function fiche(id) {
  return hydrater(instance().prepare('SELECT * FROM fiches_effectives WHERE id = ?').get(id));
}

function packMeta() {
  const out = {};
  for (const r of instance().prepare('SELECT cle, valeur FROM pack.pack_meta').all()) {
    out[r.cle] = r.valeur;
  }
  return out;
}

/**
 * Clauses SQL « chaque mot doit apparaitre » pour une recherche texte
 * permissive (accents / casse / ponctuation deja neutralises par normaliser).
 * Un mot doit etre le DEBUT d'un mot indexe. Un mot purement numerique matche
 * en plus le numero de fiche.
 */
function clausesTexte(texte, colRecherche = 'recherche', colRef = 'ref') {
  const sql = [];
  const params = [];
  for (const mot of normaliser(texte || '').split(' ').filter(Boolean)) {
    if (/^\d+$/.test(mot)) {
      sql.push(`((' ' || ${colRecherche}) LIKE ? OR ${colRef} LIKE ?)`);
      params.push('% ' + mot + '%', '%' + mot + '%');
    } else {
      sql.push(`(' ' || ${colRecherche}) LIKE ?`);
      params.push('% ' + mot + '%');
    }
  }
  return { sql, params };
}

/** Valeurs normalisees du champ « categories » d'une fiche (colonne donnees). */
function categoriesDe(donnees) {
  const cle = champCategories();
  if (!cle) return new Set();
  return new Set(
    String(donnees[cle] || '').split(/[,/;]/).map((s) => normaliser(s)).filter(Boolean)
  );
}

/**
 * Recherche permissive : accents, casse et ponctuation ignores des deux cotes.
 * `categories` (optionnel) : filtre supplementaire sur le champ marque
 * `role:'categories'`. soustractif=false -> au moins un ; true -> tous.
 */
function chercher({ texte = '', categories = null, soustractif = false, limite = 200 } = {}) {
  let sql = 'SELECT * FROM fiches_effectives WHERE 1 = 1';
  const { sql: cs, params } = clausesTexte(texte);
  for (const c of cs) sql += ' AND ' + c;
  sql += ' ORDER BY ref';
  let rows = instance().prepare(sql).all(...params).map(hydrater);

  const cibles = [...new Set(categories || [])].filter(Boolean);
  if (cibles.length) {
    rows = rows.filter((o) => {
      const tg = categoriesDe(o.donnees);
      return soustractif ? cibles.every((c) => tg.has(c)) : cibles.some((c) => tg.has(c));
    });
  }
  return rows.slice(0, limite);
}

/**
 * Fiches filtrees par categories de jeu (champ `role:'categories'`).
 *   soustractif=false (additif) : la fiche porte AU MOINS UNE des `valeurs`
 *   soustractif=true            : la fiche porte TOUTES les `valeurs`
 */
function parCategorie(valeurs, soustractif = false) {
  const cibles = [...new Set(Array.isArray(valeurs) ? valeurs : [valeurs])].filter(Boolean);
  if (!cibles.length) return [];
  return instance().prepare('SELECT * FROM fiches_effectives').all().map(hydrater).filter((o) => {
    const tags = categoriesDe(o.donnees);
    return soustractif ? cibles.every((c) => tags.has(c)) : cibles.some((c) => tags.has(c));
  });
}

/** Recherche par numero, tolerante aux zeros superflus ou manquants. */
function parNumero(saisie) {
  const n = parseInt(String(saisie).replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return [];
  return instance().prepare(
    'SELECT * FROM fiches_effectives WHERE CAST(ref AS INTEGER) = ?'
  ).all(n).map(hydrater);
}

// --- tags utilisateur --------------------------------------------------

function tagsDe(ficheId) {
  return instance().prepare('SELECT tag FROM user_tags WHERE fiche_id = ?')
    .all(ficheId).map((r) => r.tag);
}

function basculerTag(ficheId, tag) {
  const d = instance();
  const existe = d.prepare(
    'SELECT 1 FROM user_tags WHERE fiche_id = ? AND tag = ?'
  ).get(ficheId, tag);
  if (existe) {
    d.prepare('DELETE FROM user_tags WHERE fiche_id = ? AND tag = ?').run(ficheId, tag);
    return false;
  }
  d.prepare('INSERT INTO user_tags (fiche_id, tag, cree_le) VALUES (?, ?, ?)')
    .run(ficheId, tag, new Date().toISOString());
  return true;
}

/**
 * Fiches portant un tag utilisateur, dans l'ordre CHRONOLOGIQUE d'ajout du tag.
 */
function parTagUtilisateur(tag, texte = '') {
  let sql = `SELECT o.*, t.cree_le AS tag_cree_le FROM fiches_effectives o
       JOIN user_tags t ON t.fiche_id = o.id
      WHERE t.tag = ?`;
  const { sql: cs, params: cp } = clausesTexte(texte, 'o.recherche', 'o.ref');
  for (const c of cs) sql += ' AND ' + c;
  sql += ' ORDER BY t.cree_le, o.ref';
  return instance().prepare(sql).all(tag, ...cp).map(hydrater);
}

/** Retire toutes les marques livre / etoile / bad_smiley. @returns {number} */
function effacerTousLesTags() {
  return instance().prepare('DELETE FROM user_tags').run().changes;
}

function comptesTags() {
  const lignes = instance().prepare(
    'SELECT tag, COUNT(*) n FROM user_tags GROUP BY tag'
  ).all();
  const out = { livre: 0, etoile: 0, bad_smiley: 0 };
  for (const l of lignes) out[l.tag] = l.n;
  return out;
}

// --- reglages et synchro ----------------------------------------------

function reglage(cle, defaut = null) {
  const r = instance().prepare('SELECT valeur FROM reglages WHERE cle = ?').get(cle);
  return r ? r.valeur : defaut;
}

function definirReglage(cle, valeur) {
  instance().prepare(
    'INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur'
  ).run(cle, String(valeur));
}

function etatSync(cle, defaut = null) {
  const r = instance().prepare('SELECT valeur FROM sync WHERE cle = ?').get(cle);
  return r ? r.valeur : defaut;
}

function definirEtatSync(cle, valeur) {
  instance().prepare(
    'INSERT INTO sync (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur'
  ).run(cle, String(valeur));
}

module.exports = {
  ouvrir, attacherDeck, detacherDeck, packMetaDe, instance, fermer, exporterVers,
  reconstruireVue, SCHEMA_PACK, SCHEMA_USER,
  gabarit, champs, champsTexte, champCategories,
  compterFiches, fiche, packMeta, chercher, parCategorie, parNumero,
  tagsDe, basculerTag, parTagUtilisateur, comptesTags, effacerTousLesTags,
  reglage, definirReglage, etatSync, definirEtatSync
};
