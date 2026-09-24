'use strict';
/**
 * Decks installes : chaque deck construit vit dans data/packs/<deck>.db.
 * Le deck actif est memorise dans utilisateur.db (reglages.deck_actif) — pas un
 * artefact de build. Basculer = detacher / rattacher + reconstruire la vue.
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const jeu = require('./jeu');

let dossierPacks = null;
function configurer(dir) { dossierPacks = dir; }

function chemin(deck) {
  return path.join(dossierPacks, deck + '.db');
}

/** Nom de deck de tous les .db de data/packs/. */
function nomsInstalles() {
  if (!dossierPacks || !fs.existsSync(dossierPacks)) return [];
  return fs.readdirSync(dossierPacks)
    .filter((f) => f.endsWith('.db'))
    .map((f) => f.slice(0, -3));
}

/** Deck a activer au demarrage : reglage, sinon deck-actif.json, sinon 1er installe. */
function actifOuDefaut() {
  const installes = nomsInstalles();
  let actif = null;
  try { actif = db.reglage('deck_actif'); } catch (_) { /* base pas ouverte */ }
  if (actif && installes.includes(actif)) return actif;
  try {
    const hint = JSON.parse(fs.readFileSync(path.join(dossierPacks, '..', 'deck-actif.json'), 'utf8')).deck;
    if (hint && installes.includes(hint)) return hint;
  } catch (_) { /* pas d'indice */ }
  return installes[0] || null;
}

/** Liste pour l'UI : { deck, nom, gabaritCle, nFiches, sousLicence, actif }. */
function lister() {
  let actif = null;
  try { actif = db.reglage('deck_actif'); } catch (_) { /* base pas ouverte */ }
  return nomsInstalles().map((deck) => {
    const m = db.packMetaDe(chemin(deck)) || {};
    return {
      deck,
      nom: m.gabarit_nom || m.gabarit || deck,
      gabaritCle: m.gabarit || null,
      nFiches: parseInt(m.n_fiches, 10) || 0,
      sousLicence: parseInt(m.sous_licence, 10) || 0,
      release: m.release === '1',
      actif: deck === actif
    };
  }).sort((a, b) => a.deck.localeCompare(b.deck));
}

/** Active un deck : DETACH / ATTACH + reconstruction + sac remis a zero. */
function activer(deck) {
  const c = chemin(deck);
  if (!fs.existsSync(c)) return { erreur: 'Deck introuvable : ' + deck };
  db.detacherDeck();
  db.attacherDeck(c);
  db.definirReglage('deck_actif', deck);
  jeu.reinitialiserSac();
  jeu.reinitialiserSacRevision();
  return { ok: true, deck };
}

module.exports = { configurer, chemin, lister, activer, actifOuDefaut, nomsInstalles };
