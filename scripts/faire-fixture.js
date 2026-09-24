'use strict';
/**
 * Regenere src/renderer/_fixture.json : banc d'essai du rendu (harness.html).
 *
 * Boote le vrai backend (db + jeu) sur un utilisateur.db jetable et le pack
 * du deck demande, puis fige `etat` / `tirer` / `apercu` / `toutes`.
 *
 *   node scripts/lancer-node.js scripts/faire-fixture.js [deck=anatomie] [slugCarte=atlas]
 *
 * `slugCarte` choisit la fiche montree comme tirage (pratique pour verifier une
 * fiche multi-image : slug `atlas` apres l'avoir passee en galerie).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const RACINE = path.resolve(__dirname, '..');
const deck = process.argv[2] || 'anatomie';
const slugCarte = process.argv[3] || 'atlas';
const PACK = path.join(RACINE, 'data', 'packs', deck + '.db');
const USER = path.join(os.tmpdir(), `bristol-fixture-${Date.now()}.db`);

const db = require(path.join(RACINE, 'src/main/db'));
const jeu = require(path.join(RACINE, 'src/main/jeu'));

db.ouvrir(USER);
db.attacherDeck(PACK);

const meta = db.packMeta();
const etat = {
  fiches: db.compterFiches(),
  gabarit: { cle: db.gabarit().cle, nom: db.gabarit().nom, champs: db.champs() },
  deck: meta.deck || deck,
  sousLicence: parseInt(meta.sous_licence, 10) || 0,
  attributions: meta.attributions || null,
  decks: [
    { deck, nom: db.gabarit().nom, gabaritCle: db.gabarit().cle,
      nFiches: db.compterFiches(), sousLicence: parseInt(meta.sous_licence, 10) || 0,
      release: false, actif: true }
  ],
  tags: db.comptesTags(),
  revision: jeu.compteursRevision(),
  reglagesRevision: { nouvellesParJour: 20, maxParJour: 0, retention: 0.9 },
  theme: 'sombre',
  sidebarRepliee: false,
  grilleColonnes: 5,
  raccourcisProposes: false,
  derniereSynchro: null
};

const toutes = jeu.listerToutes({});
const carte = toutes.find((o) => (o.nom_fr || '').toLowerCase().includes('atlas'))
  || toutes.find((o) => o.id) || toutes[0];

// jeu.apercu attend un id ; on prend la fiche « carte » elle-meme.
const apercu = jeu.apercu(carte.id) || {};
apercu.image = Array.isArray(apercu.champs && apercu.champs.image)
  ? (apercu.champs.image[0] && apercu.champs.image[0].url) : (carte.image || null);

// Simule un tirage tout-revele sur la meme fiche (rien de masque -> galerie visible).
const tirer = {
  id: carte.id, ref: carte.ref, estLocale: false,
  imageSrc: carte.imageSrc || 'libre',
  masque: null,
  visible: Object.fromEntries(db.champs().map((c) => [c.cle, true])),
  champs: carte.champs,
  restant: 42,
  tagsUtilisateur: []
};

const fixture = { etat, tirer, apercu, toutes: toutes.slice(0, 12) };
const dest = path.join(RACINE, 'src/renderer/_fixture.json');
fs.writeFileSync(dest, JSON.stringify(fixture));
db.fermer();
fs.rmSync(USER, { force: true });
for (const s of ['-wal', '-shm']) fs.rmSync(USER + s, { force: true });

console.log(`_fixture.json regenere — deck "${deck}", carte "${carte.nom_fr}" (${carte.ref})`);
console.log('  image de la carte :', JSON.stringify(carte.champs.image));
