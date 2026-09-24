/* Banc d'essai du rendu : stub de window.api avec des donnees figees, pour
   verifier App.jsx dans un navigateur ordinaire (hors Electron).
   NE PAS EMBARQUER. Charge via /harness.html en dev. */
import fixture from './_fixture.json';

const noop = () => {};
const P = (v) => Promise.resolve(v);
const carte = fixture.tirer;

window.api = {
  etat: () => P(fixture.etat),
  log: noop,
  themeSysteme: () => P('sombre'),
  onThemeSysteme: () => noop,
  onTenterFermeture: () => noop,
  onNav: () => noop,
  quitter: noop,
  jeu: {
    tirer: () => P({ ...fixture.tirer, restant: 42 }),
    reveler: () => P(fixture.toutes[0]),
    apercu: () => P(fixture.apercu),
    categories: () => P([{ valeur: 'peinture', label: 'Peinture', n: 165 }, { valeur: 'huile', label: 'Huile', n: 154 }]),
    apercuCategories: () => P({ total: 165, possibles: null })
  },
  revision: {
    file: () => P({ total: 3, dus: 1, nouvelles: 2 }),
    tirer: () => P({
      ...fixture.tirer, restant: 2, revision: true, neuve: true, etat: 0,
      apercu: { 1: 0, 2: 1, 3: 3, 4: 15 }, dusRestants: 1, nouvellesRestantes: 1
    }),
    noter: () => P({ intervalle: 3, due: new Date().toISOString(), dusRestants: 1, nouvellesRestantes: 1 }),
    apercuNotes: () => P({ 1: 0, 2: 1, 3: 3, 4: 15 }),
    stats: () => P({ dus: 0, nouvelles: 0, revuesAujourdhui: 12, retention30j: 0.91,
      echeances: Array.from({ length: 14 }, (_, i) => ({ jour: i, n: i % 4 === 0 ? 6 : i })) }),
    reinitialiser: () => P(true)
  },
  fiches: {
    chercher: () => P(fixture.toutes),
    numero: () => P([]),
    parTag: () => P([]),
    toutes: () => P(fixture.toutes)
  },
  tags: { basculer: () => P({ actif: true, comptes: fixture.etat.tags }), effacerTout: () => P({ supprimes: 0, comptes: fixture.etat.tags }) },
  decks: {
    lister: () => P(fixture.etat.decks),
    activer: (d) => P({ ok: true, deck: d })
  },
  csv: {
    analyser: () => P({ chemin: '/tmp/x.csv', entetes: ['id', 'nom', 'famille', 'notes'], nLignes: 12,
      apercu: [{ id: 'a', nom: 'Alpha', famille: 'X', notes: 'texte' }],
      colId: 'id', colImage: null, colImageSrc: null,
      gabaritPropose: { cle: '', nom: '', champs: [
        { cle: 'nom', libelle: 'nom', type: 'texte_court', ordre: 1, masquable: true, evocateur: true, role: 'titre' },
        { cle: 'famille', libelle: 'famille', type: 'texte_court', ordre: 2, masquable: true, evocateur: true, role: 'sous_titre' },
        { cle: 'notes', libelle: 'notes', type: 'texte_long', ordre: 3, masquable: true, evocateur: true, evoc_min: 40 }
      ] } }),
    creerDeck: () => P({ ok: true, deck: 'test' }),
    ajouter: () => P({ ok: true, crees: 12 })
  },
  reglages: { definir: () => P(true) },
  edition: {
    creer: () => P({ id: 'local:x', ref: 'L1', masques: 40 }),
    fiche: () => P({ id: carte.id, ref: carte.ref, estLocale: true, image: '', valeurs: fixture.toutes[0].champs }),
    modifier: () => P({ id: carte.id, ref: carte.ref, masques: 40 }),
    supprimer: () => P({ archivee: false }),
    choisirImage: () => P(null),
    importerImage: () => P({ erreur: 'stub' }),
    importerImageUrl: () => P({ erreur: 'stub' }),
    oublierImage: noop
  },
  sauvegarde: { exporter: () => P({ annule: true }), choisir: () => P({ annule: true }), importer: () => P({ erreur: 'stub' }) },
  drive: { etat: () => P({ configure: false, connecte: false }), connecter: () => P({}), deconnecter: () => P({}), pousser: () => P({}), tirer: () => P({}) },
  raccourcis: { etat: () => P(null), perimes: () => P([]), basculer: () => P({ etat: null }), reparer: () => P(null) }
};

import('./main.jsx');
