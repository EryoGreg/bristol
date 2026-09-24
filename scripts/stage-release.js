'use strict';
/**
 * Prepare le contenu pour l'empaquetage (npm run dist) :
 *   1. reconstruit data/pack.db en mode --release (images `ebook` omises)
 *   2. copie data/<deck>/images/libre/* -> data/images/ (a plat, gitignore)
 *   3. extrait pack_meta.attributions -> data/ATTRIBUTIONS.md (embarque avec le pack)
 *
 * data/images/ est ce que electron-builder embarque (extraResources). Il ne
 * contient JAMAIS d'image sous licence.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const DATA = path.join(RACINE, 'data');
const electron = require(path.join(RACINE, 'node_modules', 'electron'));

let deck = process.argv[2];
if (!deck) {
  // deck actif memorise dans utilisateur.db
  try {
    const Database = require(path.join(RACINE, 'node_modules', 'better-sqlite3'));
    const d = new Database(path.join(DATA, 'utilisateur.db'), { readonly: true, fileMustExist: true });
    deck = (d.prepare("SELECT valeur FROM reglages WHERE cle = 'deck_actif'").get() || {}).valeur;
    d.close();
  } catch (_) { /* pas de base */ }
}
if (!deck) {
  try { deck = JSON.parse(fs.readFileSync(path.join(DATA, 'deck-actif.json'), 'utf8')).deck; } catch (_) { /* */ }
}
if (!deck) {
  try { deck = (fs.readdirSync(path.join(DATA, 'packs')).find((f) => f.endsWith('.db')) || '').replace(/\.db$/, ''); } catch (_) { /* */ }
}
deck = deck || 'art';

console.log('stage-release : deck "%s"', deck);
const r = spawnSync(electron, [path.join(RACINE, 'src', 'main', 'import.js'), deck, '--release'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
});
if (r.status) process.exit(r.status || 1);

const src = path.join(DATA, deck, 'images', 'libre');
const dst = path.join(DATA, 'images');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
let n = 0;
if (fs.existsSync(src)) {
  for (const f of fs.readdirSync(src)) {
    if (fs.statSync(path.join(src, f)).isFile()) { fs.copyFileSync(path.join(src, f), path.join(dst, f)); n++; }
  }
}
console.log('stage-release : %d image(s) libre(s) copiee(s) -> data/images/', n);

// import.js --release ecrit data/ATTRIBUTIONS.md (embarque via extraResources).
if (fs.existsSync(path.join(DATA, 'ATTRIBUTIONS.md'))) {
  console.log('stage-release : data/ATTRIBUTIONS.md pret');
} else {
  console.warn('stage-release : ATTENTION data/ATTRIBUTIONS.md manquant');
}
