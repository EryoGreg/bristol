'use strict';
/**
 * Execute un script avec le binaire Electron en mode Node.
 *
 * Necessaire parce que better-sqlite3 est compile pour l'ABI d'Electron :
 * le Node du systeme ne peut pas charger ce binaire. ELECTRON_RUN_AS_NODE
 * fait tourner Electron comme un interpreteur Node classique.
 *
 *     node scripts/lancer-node.js src/main/import.js
 */

const { spawnSync } = require('child_process');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const electron = require(path.join(RACINE, 'node_modules', 'electron'));

const cible = process.argv[2];
if (!cible) {
  console.error('Usage : node scripts/lancer-node.js <script.js> [args...]');
  process.exit(1);
}

const r = spawnSync(electron, [path.resolve(RACINE, cible), ...process.argv.slice(3)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
});
process.exit(r.status === null ? 1 : r.status);
