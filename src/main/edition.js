'use strict';
/**
 * Ajouts locaux : creer / modifier / supprimer des fiches.
 *
 * Les fiches creees vivent dans fiches_locales (utilisateur.db). Toute
 * ecriture reconstruit fiches_effectives (force) et vide le sac de tirage.
 *
 * Les champs sont pilotes par le gabarit du deck : `creer`/`modifier` recoivent
 * un objet { <cle de champ>: valeur, image: <nom de fichier> } et le rangent
 * dans la colonne JSON `donnees` (sauf `image`, colonne dediee).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const jeu = require('./jeu');

let dossierImages = null;
function configurer(dossierImagesLocales) { dossierImages = dossierImagesLocales; }

/** Cles de champ textuelles du gabarit (hors image). */
function clesTexte() {
  return db.champsTexte().map((c) => c.cle);
}

/**
 * Supprime les fichiers de images-locales/ qu'aucune fiche locale ni override
 * ne reference (import annule, image remplacee, crash en cours d'edition).
 */
function nettoyerOrphelines() {
  if (!dossierImages || !fs.existsSync(dossierImages)) return;
  const utilises = new Set();
  for (const r of db.instance().prepare("SELECT image FROM fiches_locales WHERE image <> ''").all()) {
    utilises.add(r.image);
  }
  for (const r of db.instance().prepare("SELECT valeur FROM user_overrides WHERE champ = 'image' AND valeur <> ''").all()) {
    utilises.add(r.valeur);
  }
  for (const f of fs.readdirSync(dossierImages)) {
    if (!utilises.has(f)) { try { fs.rmSync(path.join(dossierImages, f)); } catch { /* verrou */ } }
  }
}

/** Supprime une image tout juste importee si rien ne la reference (annulation). */
function oublierImage(nom) {
  if (!dossierImages || !nom) return;
  const refDb = db.instance()
    .prepare("SELECT 1 FROM fiches_locales WHERE image = ? UNION SELECT 1 FROM user_overrides WHERE champ='image' AND valeur = ?")
    .get(nom, nom);
  if (!refDb) { try { fs.rmSync(path.join(dossierImages, nom)); } catch { /* deja parti */ } }
}

/** Numero d'affichage local, monotone, jamais reutilise : L1, L2, L3... */
function prochainRefLocal() {
  const n = parseInt(db.reglage('ref_local_seq', '0'), 10) + 1;
  db.definirReglage('ref_local_seq', String(n));
  return 'L' + n;
}

/** Range les valeurs recues en { donnees:{...}, image:'' }. */
function repartir(champs) {
  const v = (x) => String(x == null ? '' : x).trim();
  const donnees = {};
  for (const cle of clesTexte()) donnees[cle] = v(champs[cle]);
  return { donnees, image: v(champs.image) };
}

/**
 * Cree une fiche locale.
 * @param {Object} champs { <cle de champ>: valeur, image }
 * @returns {{ id, ref, masques }} masques = nombre de masques valides.
 */
function creer(champs = {}) {
  const id = 'local:' + crypto.randomUUID();
  const ref = prochainRefLocal();
  const t = new Date().toISOString();
  const { donnees, image } = repartir(champs);

  db.instance().prepare(`INSERT INTO fiches_locales
    (id, ref_local, gabarit, donnees, image, image_src, cree_le, modifie_le)
    VALUES (@id, @ref, @gabarit, @donnees, @image, 'local', @t, @t)`)
    .run({ id, ref, t, gabarit: db.gabarit().cle || null, donnees: JSON.stringify(donnees), image });

  appliquer();
  const o = db.fiche(id);
  return { id, ref, masques: JSON.parse((o && o.masques) || '[]').length };
}

/**
 * Cree plusieurs fiches locales d'un coup (import CSV) : une transaction, un
 * seul appliquer() final.
 * @param {Array<Object>} lot  liste de { <cle de champ>: valeur, image? }
 * @returns {{ crees: number }}
 */
function creerLot(lot = []) {
  const d = db.instance();
  const t = new Date().toISOString();
  const gab = db.gabarit().cle || null;
  const stmt = d.prepare(`INSERT INTO fiches_locales
    (id, ref_local, gabarit, donnees, image, image_src, cree_le, modifie_le)
    VALUES (@id, @ref, @gabarit, @donnees, @image, 'local', @t, @t)`);
  d.transaction(() => {
    for (const champs of lot) {
      const { donnees, image } = repartir(champs);
      stmt.run({
        id: 'local:' + crypto.randomUUID(),
        ref: prochainRefLocal(),
        gabarit: gab, t,
        donnees: JSON.stringify(donnees),
        image
      });
    }
  })();
  appliquer();
  return { crees: lot.length };
}

/** Valeurs effectives d'une fiche, pretes pour l'editeur (image = nom brut). */
function fiche(id) {
  const o = db.fiche(id);
  if (!o) return null;
  const valeurs = {};
  for (const cle of clesTexte()) valeurs[cle] = (o.donnees && o.donnees[cle]) || '';
  return { id, ref: o.ref, estLocale: !!o.est_locale, valeurs, image: o.image || '' };
}

/**
 * Applique des changements a une fiche.
 *  - fiche locale : UPDATE direct de fiches_locales
 *  - fiche du pack : ecrit/retire des lignes user_overrides (comparaison a la
 *    valeur DU PACK). Remettre un champ a la valeur du pack retire l'override.
 */
function modifier(id, champs = {}) {
  const d = db.instance();
  const t = new Date().toISOString();
  const { donnees, image } = repartir(champs);

  if (id.startsWith('local:')) {
    d.prepare(`UPDATE fiches_locales SET donnees=@donnees, image=@image, modifie_le=@t WHERE id=@id`)
      .run({ id, t, donnees: JSON.stringify(donnees), image });
  } else {
    const pack = d.prepare('SELECT * FROM pack.fiches WHERE id = ?').get(id);
    if (!pack) return { erreur: 'fiche introuvable' };
    let packDonnees = {};
    try { packDonnees = JSON.parse(pack.donnees || '{}'); } catch (_) { packDonnees = {}; }

    const cibles = [...clesTexte().map((cle) => [cle, donnees[cle], String(packDonnees[cle] == null ? '' : packDonnees[cle])]),
      ['image', image, String(pack.image == null ? '' : pack.image)]];

    for (const [champ, nouv, source] of cibles) {
      const revenirAuPack = nouv === source || (champ === 'image' && nouv === '');
      if (revenirAuPack) {
        d.prepare('DELETE FROM user_overrides WHERE fiche_id=? AND champ=?').run(id, champ);
      } else {
        d.prepare(`INSERT INTO user_overrides (fiche_id, champ, valeur, valeur_source, cree_le, modifie_le)
          VALUES (?,?,?,?,?,?)
          ON CONFLICT(fiche_id, champ) DO UPDATE SET valeur=excluded.valeur, modifie_le=excluded.modifie_le`)
          .run(id, champ, nouv, source, t, t);
      }
    }
  }

  appliquer();
  const o = db.fiche(id);
  return { id, ref: o && o.ref, masques: JSON.parse((o && o.masques) || '[]').length };
}

/**
 * Supprime une fiche.
 *  - locale : DELETE de fiches_locales (+ tags/stats, image balayee)
 *  - pack   : INSERT user_archive (archivee, jamais vraiment supprimee)
 */
function supprimer(id) {
  const d = db.instance();
  if (id.startsWith('local:')) {
    d.prepare('DELETE FROM fiches_locales WHERE id=?').run(id);
    d.prepare('DELETE FROM user_tags WHERE fiche_id=?').run(id);
    d.prepare('DELETE FROM user_stats WHERE fiche_id=?').run(id);
    d.prepare('DELETE FROM user_overrides WHERE fiche_id=?').run(id);
    appliquer();
    return { archivee: false };
  }
  d.prepare('INSERT OR IGNORE INTO user_archive (fiche_id, cree_le) VALUES (?, ?)')
    .run(id, new Date().toISOString());
  appliquer();
  return { archivee: true };
}

function appliquer() {
  db.reconstruireVue({ force: true });
  jeu.reinitialiserSac();
  nettoyerOrphelines();
}

module.exports = {
  configurer, creer, creerLot, fiche, modifier, supprimer, nettoyerOrphelines, oublierImage
};
