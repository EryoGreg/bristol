'use strict';
/**
 * Ajouts locaux : creer / modifier / supprimer des tuiles.
 *
 * Les tuiles creees vivent dans oeuvres_locales (utilisateur.db). Toute
 * ecriture reconstruit oeuvres_effectives (force) et vide le sac de tirage.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const jeu = require('./jeu');

const CHAMPS = ['artiste', 'titre', 'date', 'lieu', 'description', 'tags', 'image'];

let dossierImages = null;
function configurer(dossierImagesLocales) { dossierImages = dossierImagesLocales; }

/**
 * Supprime les fichiers de images-locales/ qu'aucune tuile locale ni override
 * ne reference (import annule, image remplacee, crash en cours d'edition).
 */
function nettoyerOrphelines() {
  if (!dossierImages || !fs.existsSync(dossierImages)) return;
  const utilises = new Set();
  for (const r of db.instance().prepare("SELECT image FROM oeuvres_locales WHERE image <> ''").all()) {
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
    .prepare("SELECT 1 FROM oeuvres_locales WHERE image = ? UNION SELECT 1 FROM user_overrides WHERE champ='image' AND valeur = ?")
    .get(nom, nom);
  if (!refDb) { try { fs.rmSync(path.join(dossierImages, nom)); } catch { /* deja parti */ } }
}

/** Numero d'affichage local, monotone, jamais reutilise : L1, L2, L3... */
function prochainRefLocal() {
  const n = parseInt(db.reglage('ref_local_seq', '0'), 10) + 1;
  db.definirReglage('ref_local_seq', String(n));
  return 'L' + n;
}

/**
 * Cree une tuile locale.
 * @param {Object} champs { artiste, titre, date, lieu, description, tags, image }
 *   image = nom d'un fichier deja depose dans images-locales/ (S4), ou ''.
 * @returns {{ id, ref, masques }} masques = nombre de masques valides (0 -> la
 *   tuile n'apparaitra jamais au tirage).
 */
function creer(champs = {}) {
  const id = 'local:' + crypto.randomUUID();
  const ref = prochainRefLocal();
  const t = new Date().toISOString();
  const v = (c) => String(champs[c] == null ? '' : champs[c]).trim();

  db.instance().prepare(`INSERT INTO oeuvres_locales
    (id, ref_local, artiste, titre, date, lieu, description, tags, image, cree_le, modifie_le)
    VALUES (@id, @ref, @artiste, @titre, @date, @lieu, @description, @tags, @image, @t, @t)`)
    .run({
      id, ref, t,
      artiste: v('artiste'), titre: v('titre'), date: v('date'), lieu: v('lieu'),
      description: v('description'), tags: v('tags'), image: v('image')
    });

  appliquer();
  const o = db.oeuvre(id);
  return { id, ref, masques: JSON.parse((o && o.masques) || '[]').length };
}

/** Valeurs effectives d'une tuile, pretes pour l'editeur (image = nom brut). */
function tuile(id) {
  const o = db.oeuvre(id);
  if (!o) return null;
  const out = { id, ref: o.ref, estLocale: !!o.est_locale };
  for (const c of CHAMPS) out[c] = o[c] || '';
  return out;
}

/**
 * Applique des changements a une tuile.
 *  - tuile locale : UPDATE direct de oeuvres_locales
 *  - tuile du pack : ecrit/retire des lignes user_overrides (comparaison a la
 *    valeur DU PACK, pas a la valeur effective). Remettre un champ a la valeur
 *    du pack retire l'override. Vider l'image d'une tuile du pack = revenir a
 *    l'image du pack.
 */
function modifier(id, champs = {}) {
  const v = (c) => String(champs[c] == null ? '' : champs[c]).trim();
  const d = db.instance();
  const t = new Date().toISOString();

  if (id.startsWith('local:')) {
    d.prepare(`UPDATE oeuvres_locales SET
      artiste=@artiste, titre=@titre, date=@date, lieu=@lieu,
      description=@description, tags=@tags, image=@image, modifie_le=@t
      WHERE id=@id`).run({
      id, t,
      artiste: v('artiste'), titre: v('titre'), date: v('date'), lieu: v('lieu'),
      description: v('description'), tags: v('tags'), image: v('image')
    });
  } else {
    const pack = d.prepare('SELECT * FROM pack.oeuvres WHERE id = ?').get(id);
    if (!pack) return { erreur: 'oeuvre introuvable' };
    for (const c of CHAMPS) {
      const nouv = v(c);
      const source = String(pack[c] == null ? '' : pack[c]);
      const revenirAuPack = nouv === source || (c === 'image' && nouv === '');
      if (revenirAuPack) {
        d.prepare('DELETE FROM user_overrides WHERE oeuvre_id=? AND champ=?').run(id, c);
      } else {
        d.prepare(`INSERT INTO user_overrides (oeuvre_id, champ, valeur, valeur_source, cree_le, modifie_le)
          VALUES (?,?,?,?,?,?)
          ON CONFLICT(oeuvre_id, champ) DO UPDATE SET valeur=excluded.valeur, modifie_le=excluded.modifie_le`)
          .run(id, c, nouv, source, t, t);
      }
    }
  }

  appliquer();
  const o = db.oeuvre(id);
  return { id, ref: o && o.ref, masques: JSON.parse((o && o.masques) || '[]').length };
}

/**
 * Supprime une tuile.
 *  - locale : DELETE de oeuvres_locales (+ tags/stats, image balayee)
 *  - pack   : INSERT user_archive (archivee, jamais vraiment supprimee)
 */
function supprimer(id) {
  const d = db.instance();
  if (id.startsWith('local:')) {
    d.prepare('DELETE FROM oeuvres_locales WHERE id=?').run(id);
    d.prepare('DELETE FROM user_tags WHERE oeuvre_id=?').run(id);
    d.prepare('DELETE FROM user_stats WHERE oeuvre_id=?').run(id);
    d.prepare('DELETE FROM user_overrides WHERE oeuvre_id=?').run(id);
    appliquer();
    return { archivee: false };
  }
  d.prepare('INSERT OR IGNORE INTO user_archive (oeuvre_id, cree_le) VALUES (?, ?)')
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
  configurer, creer, tuile, modifier, supprimer, nettoyerOrphelines, oublierImage
};
