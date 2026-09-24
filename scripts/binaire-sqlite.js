'use strict';
/**
 * Recupere le binaire better-sqlite3 compile pour l'ABI d'Electron.
 *
 * On evite volontairement electron-rebuild : il passe par node-gyp, qui casse
 * quand le chemin du projet contient une espace (« DEV PROJECTS »). Les
 * binaires precompiles existent, autant les prendre.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const RACINE = path.resolve(__dirname, '..');
const MODULE = path.join(RACINE, 'node_modules', 'better-sqlite3');
const BINAIRE = path.join(MODULE, 'build', 'Release', 'better_sqlite3.node');
const PREBUILD = path.join(RACINE, 'node_modules', 'prebuild-install', 'bin.js');

if (!fs.existsSync(MODULE)) {
  console.log('better-sqlite3 absent : rien a faire.');
  process.exit(0);
}

const electron = require(path.join(RACINE, 'node_modules', 'electron', 'package.json')).version;

try {
  execFileSync(process.execPath,
    [PREBUILD, '--runtime', 'electron', '--target', electron, '--tag-prefix', 'v'],
    { cwd: MODULE, stdio: 'inherit' });
} catch (e) {
  console.error('Telechargement du binaire echoue.');
  process.exit(1);
}

if (!fs.existsSync(BINAIRE)) {
  console.error('Binaire absent apres telechargement : ' + BINAIRE);
  process.exit(1);
}
console.log('better-sqlite3 pret pour Electron ' + electron);
