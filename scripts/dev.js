'use strict';
/**
 * Lance le serveur Vite puis Electron.
 *
 * On appelle chaque binaire par son chemin JS plutot que par les raccourcis
 * de node_modules/.bin : ces raccourcis passent par cmd, qui coupe le chemin
 * du projet sur l'espace et sur le « & » de « Tuiles & Toiles ».
 */

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const RACINE = path.resolve(__dirname, '..');
const VITE = path.join(RACINE, 'node_modules', 'vite', 'bin', 'vite.js');
const electron = require(path.join(RACINE, 'node_modules', 'electron'));

const PORT = 5500;
let enCours = [];

function arreter(code) {
  for (const p of enCours) { try { p.kill(); } catch (_) { /* deja mort */ } }
  process.exit(code);
}
process.on('SIGINT', () => arreter(0));
process.on('SIGTERM', () => arreter(0));

function attendrePort(port, restant = 60) {
  return new Promise((ok, ko) => {
    const essai = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); ok(); });
      s.once('error', () => {
        s.destroy();
        if (--restant <= 0) return ko(new Error('Vite n a pas demarre sur ' + port));
        setTimeout(essai, 500);
      });
    };
    essai();
  });
}

const vite = spawn(process.execPath, [VITE], { cwd: RACINE, stdio: 'inherit' });
enCours.push(vite);
vite.on('exit', (c) => arreter(c || 0));

attendrePort(PORT).then(() => {
  const app = spawn(electron, ['.'], { cwd: RACINE, stdio: 'inherit' });
  enCours.push(app);
  app.on('exit', (c) => arreter(c || 0));
}).catch((e) => {
  console.error(e.message);
  arreter(1);
});
