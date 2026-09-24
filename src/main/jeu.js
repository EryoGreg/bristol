'use strict';
/**
 * Tirage des fiches.
 *
 * Sac sans remise : on ne repioche pas une fiche tant que le sac n'est pas
 * epuise. Evite de revoir trois fois la meme dans une session.
 *
 * Les champs affiches / masques sont pilotes par le gabarit du deck
 * (db.champs()). Un champ `toujours_cache` n'est jamais montre au tirage.
 */

const db = require('./db');
const fsrs = require('./fsrs');
const { decrire, normaliser, occlusionDe } = require('./masques');

let sac = [];
let filtreCourant = null;   // cle stable du filtre courant, null = aleatoire
let sacRevision = null;     // [{ id, neuve }] ou null si pas encore construit

function melanger(t) {
  for (let i = t.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [t[i], t[j]] = [t[j], t[i]];
  }
  return t;
}

function normFiltre(f) {
  if (!f) return null;
  if (typeof f === 'string' || Array.isArray(f)) {
    const cats = (Array.isArray(f) ? f : [f]).filter(Boolean);
    return cats.length ? { cats, soustractif: false } : null;
  }
  const cats = (f.cats || []).filter(Boolean);
  return cats.length ? { cats, soustractif: !!f.soustractif } : null;
}
function cleFiltre(f) {
  return f ? (f.soustractif ? '&' : '|') + f.cats.slice().sort().join('|') : null;
}

function remplirSac(filtre) {
  const f = normFiltre(filtre);
  const lignes = f
    ? db.parCategorie(f.cats, f.soustractif)
    : db.instance().prepare('SELECT id FROM fiches_effectives').all();
  sac = melanger(lignes.map((l) => l.id));
  filtreCourant = cleFiltre(f);
}

function estImage(champ) {
  return champ.type === 'image' || champ.cle === 'image';
}

/**
 * Valeur d'un champ prete a afficher.
 * image -> tableau [{ url:'fiche://x', legende }] (longueur 1 pour une seule
 * image ; `fiche.image` peut etre une liste separee par '|').
 */
function valeurAffichee(champ, fiche) {
  if (estImage(champ)) {
    const parts = String(fiche.image || '').split('|').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    const legs = String(fiche.image_legende || '').split('|').map((s) => s.trim());
    return parts.map((f, i) => ({ url: 'fiche://' + f, legende: legs[i] || '' }));
  }
  const v = fiche.donnees ? fiche.donnees[champ.cle] : '';
  return v == null ? '' : v;
}

/** 1re URL d'image d'une fiche, pour les vignettes de carte (retrocompat). */
function imagePrincipale(fiche) {
  const f = String(fiche.image || '').split('|')[0].trim();
  return f ? 'fiche://' + f : null;
}

/** Champ de type `occlusion` du gabarit, ou null. */
function champOcclusion() {
  return db.champs().find((c) => c.type === 'occlusion') || null;
}

/** Contenu d'occlusion d'une fiche { image, zones } prefixe fiche://, ou null. */
function occlusionFiche(fiche) {
  const c = champOcclusion();
  const occ = c && occlusionDe(fiche, c.cle);
  if (!occ) return null;
  return { cle: c.cle, image: 'fiche://' + occ.image, zones: occ.zones };
}

/**
 * Construit les cartes { cle: valeur|null } et { cle: bool } d'une fiche pour
 * un masque donne. `masque` null -> tout visible (hors toujours_cache).
 *
 * Fiche a occlusion d'image : tout est visible, `champs.<cle>` porte
 * { image, zones } et `occCachee` designe la zone masquee (tiree au hasard,
 * `revele=true` -> aucune zone masquee).
 */
function projeter(fiche, masque, { revele = false } = {}) {
  const defs = db.champs();
  const occ = occlusionFiche(fiche);
  if (occ) {
    const visible = decrire(null, defs);
    const champs = {};
    for (const c of defs) {
      champs[c.cle] = c.cle === occ.cle
        ? { image: occ.image, zones: occ.zones }
        : valeurAffichee(c, fiche);
    }
    const occCachee = revele ? null : Math.floor(Math.random() * occ.zones.length);
    return { visible, champs, occCachee };
  }
  const visible = decrire(masque, defs);
  const champs = {};
  for (const c of defs) {
    champs[c.cle] = visible[c.cle] ? valeurAffichee(c, fiche) : null;
  }
  return { visible, champs };
}

/**
 * @param {null|string|string[]|{cats:string[],soustractif:boolean}} filtre
 * @returns {Object|null} la fiche a afficher, masque compris
 */
function tirer(filtre = null) {
  const f = normFiltre(filtre);
  if (!sac.length || filtreCourant !== cleFiltre(f)) remplirSac(filtre);
  if (!sac.length) return null;

  const id = sac.pop();
  const o = db.fiche(id);
  if (!o) return tirer(filtre);

  const masques = JSON.parse(o.masques || '[]');
  if (!masques.length) return tirer(filtre);
  const masque = masques[Math.floor(Math.random() * masques.length)];
  const { visible, champs, occCachee } = projeter(o, masque);

  db.instance().prepare(
    `INSERT INTO user_stats (fiche_id, vues, dernier_vu) VALUES (?, 1, ?)
     ON CONFLICT(fiche_id) DO UPDATE SET vues = vues + 1, dernier_vu = excluded.dernier_vu`
  ).run(id, new Date().toISOString());

  return {
    id: o.id,
    ref: o.ref,
    estLocale: !!o.est_locale,
    imageSrc: o.image_src || 'libre',
    masque,
    visible,
    champs,
    occCachee,
    restant: sac.length,
    tagsUtilisateur: db.tagsDe(o.id)
  };
}

/**
 * Categories jouables : valeurs distinctes du champ `role:'categories'`,
 * normalisees. n = nombre de fiches portant la categorie.
 */
function categories() {
  const cle = db.champCategories();
  if (!cle) return [];
  const rows = db.instance().prepare('SELECT donnees FROM fiches_effectives').all();
  const map = new Map();
  for (const r of rows) {
    let donnees = {};
    try { donnees = JSON.parse(r.donnees || '{}'); } catch (_) { donnees = {}; }
    const vues = new Set();
    for (const b of String(donnees[cle] || '').split(/[,/;]/).map((s) => s.trim()).filter(Boolean)) {
      const k = normaliser(b);
      if (!k || vues.has(k)) continue;
      vues.add(k);
      const e = map.get(k) || { valeur: k, label: b, n: 0 };
      e.n += 1;
      map.set(k, e);
    }
  }
  return [...map.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

/**
 * Apercu d'une combinaison de categories AVANT le tirage.
 * @returns {{ total:number, possibles:string[]|null }}
 */
function apercuCategories({ cats = [], soustractif = false } = {}) {
  const cle = db.champCategories();
  const rows = db.instance().prepare('SELECT donnees FROM fiches_effectives').all();
  const ensembles = rows.map((r) => {
    let donnees = {};
    try { donnees = JSON.parse(r.donnees || '{}'); } catch (_) { donnees = {}; }
    return new Set(
      String((cle && donnees[cle]) || '').split(/[,/;]/).map((s) => normaliser(s)).filter(Boolean)
    );
  });
  const choisies = cats.filter(Boolean);

  const compte = (sel, sous) => {
    if (!sel.length) return rows.length;
    return ensembles.reduce((n, tg) => n + (
      sous ? sel.every((c) => tg.has(c)) : sel.some((c) => tg.has(c))
    ), 0);
  };

  const total = compte(choisies, soustractif);

  let possibles = null;
  if (soustractif) {
    possibles = [];
    const toutes = new Set();
    for (const s of ensembles) for (const v of s) toutes.add(v);
    for (const v of toutes) {
      if (choisies.includes(v)) continue;
      if (compte([...choisies, v], true) > 0) possibles.push(v);
    }
  }
  return { total, possibles };
}

/**
 * Fiche complete, prete a afficher (hors tirage, rien n'y est masque).
 * Les valeurs de champ sont aussi mises a plat sur l'objet pour les vues qui
 * lisent `o.<cle>` directement (galeries, revelation).
 */
function completer(o) {
  const defs = db.champs();
  const occ = occlusionFiche(o);
  const champs = {};
  for (const c of defs) {
    champs[c.cle] = occ && c.cle === occ.cle
      ? { image: occ.image, zones: occ.zones }
      : valeurAffichee(c, o);
  }
  return {
    ...champs,
    id: o.id,
    ref: o.ref,
    estLocale: !!o.est_locale,
    imageSrc: o.image_src || 'libre',
    champs,
    image: imagePrincipale(o),
    occCachee: null,
    tagsUtilisateur: db.tagsDe(o.id),
    creeLe: o.tag_cree_le || null
  };
}

/**
 * Apercu d'une fiche precise, ouvert depuis la Bibliotheque ou une galerie.
 * RIEN n'est masque ; `visible` reste renseigne (masque valide tire au hasard)
 * pour que le rendu souligne en pointilles les champs qu'un tirage cacherait.
 */
function apercu(id) {
  const o = db.fiche(id);
  if (!o) return null;

  const masques = JSON.parse(o.masques || '[]');
  const masque = masques.length ? masques[Math.floor(Math.random() * masques.length)] : null;
  const defs = db.champs();
  const visible = decrire(masque, defs);
  const occ = occlusionFiche(o);

  const champs = {};
  for (const c of defs) {
    champs[c.cle] = occ && c.cle === occ.cle
      ? { image: occ.image, zones: occ.zones }
      : valeurAffichee(c, o);
  }

  return {
    id: o.id,
    ref: o.ref,
    estLocale: !!o.est_locale,
    imageSrc: o.image_src || 'libre',
    masque,
    visible,
    champs,
    occCachee: null,
    restant: null,
    tagsUtilisateur: db.tagsDe(o.id)
  };
}

/** Tout reveler : renvoie la fiche complete, champs `toujours_cache` compris. */
function reveler(id) {
  const o = db.fiche(id);
  return o ? completer(o) : null;
}

function listerParTag(tag, texte) {
  return db.parTagUtilisateur(tag, texte || '').map(completer);
}

function listerToutes(criteres) {
  return db.chercher({ ...(criteres || {}), limite: 100000 }).map(completer);
}

function reinitialiserSac() {
  sac = [];
  filtreCourant = null;
}

// ====================================================================
//  Revision espacee (FSRS)
// ====================================================================

const JOUR_MS = 86400000;

function debutJourISO() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function finJourISO() {
  const d = new Date(); d.setHours(23, 59, 59, 999);
  return d.toISOString();
}
function reglageNombre(cle, defaut) {
  const v = parseFloat(db.reglage(cle, String(defaut)));
  return Number.isFinite(v) ? v : defaut;
}
function retentionCible() {
  return Math.min(Math.max(reglageNombre('revision_retention', 0.9), 0.7), 0.99);
}

/** Ligne user_fsrs d'une fiche, ou null si jamais revisee. */
function carteFsrs(id) {
  return db.instance().prepare('SELECT * FROM user_fsrs WHERE fiche_id = ?').get(id) || null;
}

/** Nb de fiches neuves deja introduites aujourd'hui (compte sur le journal). */
function nouvellesFaitesAujourdhui() {
  return db.instance().prepare(
    'SELECT COUNT(*) n FROM user_revlog WHERE etat_avant = 0 AND revu_le >= ?'
  ).get(debutJourISO()).n;
}

/** Ids des fiches du deck actif dont l'echeance est atteinte, plus urgentes d'abord. */
function idsDus() {
  return db.instance().prepare(`
    SELECT f.fiche_id id FROM user_fsrs f
    JOIN fiches_effectives e ON e.id = f.fiche_id
    WHERE f.due <= ? ORDER BY f.due
  `).all(finJourISO()).map((r) => r.id);
}

/** Ids des fiches du deck actif jamais revisees, dans l'ordre d'affichage. */
function idsNeuves(limite) {
  if (limite <= 0) return [];
  return db.instance().prepare(`
    SELECT e.id FROM fiches_effectives e
    LEFT JOIN user_fsrs f ON f.fiche_id = e.id
    WHERE f.fiche_id IS NULL
    ORDER BY CAST(e.ref AS INTEGER), e.ref
    LIMIT ?
  `).all(Math.floor(limite)).map((r) => r.id);
}

/**
 * (Re)construit la file de revision du jour et la memorise.
 * @returns {{ total:number, dus:number, nouvelles:number }}
 */
function fileRevision() {
  const parJour = Math.max(0, Math.floor(reglageNombre('revision_nouvelles_par_jour', 20)));
  const restantNeuves = Math.max(0, parJour - nouvellesFaitesAujourdhui());
  const maxParJour = Math.max(0, Math.floor(reglageNombre('revision_max_par_jour', 200)));

  let dus = melanger(idsDus());
  let neuves = idsNeuves(restantNeuves);

  if (maxParJour > 0 && dus.length + neuves.length > maxParJour) {
    if (dus.length >= maxParJour) { dus = dus.slice(0, maxParJour); neuves = []; }
    else neuves = neuves.slice(0, maxParJour - dus.length);
  }

  sacRevision = [
    ...dus.map((id) => ({ id, neuve: false })),
    ...neuves.map((id) => ({ id, neuve: true }))
  ];
  return { total: sacRevision.length, dus: dus.length, nouvelles: neuves.length };
}

function restantsRevision() {
  const s = sacRevision || [];
  return {
    dusRestants: s.filter((x) => !x.neuve).length,
    nouvellesRestantes: s.filter((x) => x.neuve).length
  };
}

/** Prochaine fiche de la file de revision (null si file vide). */
function tirerRevision() {
  if (!sacRevision) fileRevision();
  if (!sacRevision.length) return null;

  const { id, neuve } = sacRevision.shift();
  const o = db.fiche(id);
  if (!o) return tirerRevision();

  const masques = JSON.parse(o.masques || '[]');
  const masque = masques.length ? masques[Math.floor(Math.random() * masques.length)] : null;
  const { visible, champs, occCachee } = projeter(o, masque);

  const carte = carteFsrs(id);
  return {
    id: o.id,
    ref: o.ref,
    estLocale: !!o.est_locale,
    imageSrc: o.image_src || 'libre',
    masque,
    visible,
    champs,
    occCachee,
    restant: sacRevision.length,
    tagsUtilisateur: db.tagsDe(o.id),
    revision: true,
    neuve: !carte,
    etat: carte ? carte.etat : 0,
    apercu: fsrs.apercu(carte, retentionCible()),
    ...restantsRevision()
  };
}

/** Intervalles (jours) que donnerait chaque note maintenant, sans rien ecrire. */
function apercuNotes(id) {
  return fsrs.apercu(carteFsrs(id), retentionCible());
}

/**
 * Enregistre une note (1..4) pour une fiche et met a jour sa planification.
 * @returns {{ intervalle:number, due:string, dusRestants:number, nouvellesRestantes:number }}
 */
function noter(id, note) {
  const n = Math.min(Math.max(parseInt(note, 10) || 3, 1), 4);
  const retention = retentionCible();
  const carte = carteFsrs(id);
  const now = new Date();
  const nowISO = now.toISOString();

  let stabilite;
  let difficulte;
  let intervalleJours;
  let etatAvant;
  let reps;
  let lapses;

  if (!carte) {
    const p = fsrs.premiere(n);
    stabilite = p.stabilite;
    difficulte = p.difficulte;
    intervalleJours = n === 1 ? 0 : fsrs.intervalleJours(stabilite, retention);
    etatAvant = 0;
    reps = 1;
    lapses = n === 1 ? 1 : 0;
  } else {
    const elapsed = Math.max(0, (now - new Date(carte.dernier_vu || nowISO)) / JOUR_MS);
    const r = fsrs.suivante(carte, n, elapsed, retention);
    stabilite = r.stabilite;
    difficulte = r.difficulte;
    intervalleJours = r.intervalleJours;
    etatAvant = carte.etat;
    reps = (carte.reps || 0) + 1;
    lapses = (carte.lapses || 0) + (n === 1 ? 1 : 0);
  }

  const etat = n === 1 ? 3 : 2;
  const due = n === 1
    ? new Date(now.getTime() + 60000).toISOString()
    : new Date(now.getTime() + intervalleJours * JOUR_MS).toISOString();

  db.instance().prepare(`
    INSERT INTO user_fsrs (fiche_id, stabilite, difficulte, due, dernier_vu, reps, lapses, etat)
    VALUES (@id, @stabilite, @difficulte, @due, @vu, @reps, @lapses, @etat)
    ON CONFLICT(fiche_id) DO UPDATE SET
      stabilite = excluded.stabilite, difficulte = excluded.difficulte,
      due = excluded.due, dernier_vu = excluded.dernier_vu,
      reps = excluded.reps, lapses = excluded.lapses, etat = excluded.etat
  `).run({ id, stabilite, difficulte, due, vu: nowISO, reps, lapses, etat });

  db.instance().prepare(`
    INSERT INTO user_revlog (fiche_id, note, etat_avant, stabilite, difficulte, intervalle, revu_le)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, n, etatAvant, stabilite, difficulte, Math.round(intervalleJours), nowISO);

  if (n === 1 && sacRevision) sacRevision.push({ id, neuve: false });

  return { intervalle: intervalleJours, due, ...restantsRevision() };
}

/** Tableau de bord de la revision. */
function statsRevision() {
  const d = db.instance();
  const parJour = Math.max(0, Math.floor(reglageNombre('revision_nouvelles_par_jour', 20)));
  const dus = idsDus().length;
  const nouvelles = Math.min(
    Math.max(0, parJour - nouvellesFaitesAujourdhui()),
    d.prepare(`SELECT COUNT(*) n FROM fiches_effectives e
              LEFT JOIN user_fsrs f ON f.fiche_id = e.id WHERE f.fiche_id IS NULL`).get().n
  );
  const revuesAujourdhui = d.prepare(
    'SELECT COUNT(*) n FROM user_revlog WHERE revu_le >= ?'
  ).get(debutJourISO()).n;

  const il30 = new Date(Date.now() - 30 * JOUR_MS).toISOString();
  const rev = d.prepare(
    'SELECT note, etat_avant FROM user_revlog WHERE revu_le >= ? AND etat_avant <> 0'
  ).all(il30);
  const retention30j = rev.length
    ? rev.filter((r) => r.note >= 3).length / rev.length
    : null;

  const echeances = [];
  const base = new Date(); base.setHours(0, 0, 0, 0);
  for (let i = 0; i < 14; i++) {
    const a = new Date(base.getTime() + i * JOUR_MS).toISOString();
    const b = new Date(base.getTime() + (i + 1) * JOUR_MS).toISOString();
    const n = d.prepare(`
      SELECT COUNT(*) n FROM user_fsrs f JOIN fiches_effectives e ON e.id = f.fiche_id
      WHERE f.due >= ? AND f.due < ?
    `).get(i === 0 ? '0000' : a, b).n;
    echeances.push({ jour: i, n });
  }

  return { dus, nouvelles, revuesAujourdhui, retention30j, echeances };
}

/** Compteurs legers pour le badge de la barre laterale. */
function compteursRevision() {
  const s = statsRevision();
  return { dus: s.dus, nouvelles: s.nouvelles };
}

/** Efface toute la progression FSRS (Options -> reinitialiser). */
function reinitialiserProgression() {
  const d = db.instance();
  d.exec('DELETE FROM user_fsrs; DELETE FROM user_revlog;');
  sacRevision = null;
}

function reinitialiserSacRevision() {
  sacRevision = null;
}

module.exports = {
  tirer, reveler, apercu, categories, apercuCategories,
  listerParTag, listerToutes, reinitialiserSac,
  fileRevision, tirerRevision, apercuNotes, noter, statsRevision,
  compteursRevision, reinitialiserProgression, reinitialiserSacRevision
};
