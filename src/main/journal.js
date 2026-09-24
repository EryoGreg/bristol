'use strict';
/**
 * Journal de session : un fichier texte dans le dossier de donnees
 * (%APPDATA%\Tuiles et Toiles\logs\journal.log), pour suivre les deplacements
 * de l'utilisateur test et retrouver vite un bug.
 *
 * A etoffer : appeler journal.ligne() partout (navigation, actions, erreurs).
 * Cote rendu : window.api.log(msg, extra).
 */

const fs = require('fs');
const path = require('path');

let fichier = null;
const MAX = 3 * 1024 * 1024;   // rotation a 3 Mo -> .1

function safe(v) {
  if (v === undefined) return '';
  try { return '  ' + (typeof v === 'string' ? v : JSON.stringify(v)); }
  catch { return '  ' + String(v); }
}

function ligne(msg, extra) {
  const s = `${new Date().toISOString()}  ${msg}${safe(extra)}\n`;
  if (fichier) { try { fs.appendFileSync(fichier, s); } catch { /* disque plein / verrou */ } }
  try { process.stdout.write(s); } catch { /* pas de tty */ }
}

function configurer(dossier) {
  try {
    fs.mkdirSync(dossier, { recursive: true });
    fichier = path.join(dossier, 'journal.log');
    if (fs.existsSync(fichier) && fs.statSync(fichier).size > MAX) {
      fs.rmSync(fichier + '.1', { force: true });
      fs.renameSync(fichier, fichier + '.1');
    }
  } catch { fichier = null; }
  ligne('=== SESSION ===', { pid: process.pid });
}

/** Attrape ce qui casserait silencieusement le process principal. */
function armerErreurs(app) {
  process.on('uncaughtException', (e) => ligne('ERREUR uncaughtException', e && (e.stack || e.message)));
  process.on('unhandledRejection', (e) => ligne('ERREUR unhandledRejection', e && (e.stack || e.message || e)));
  if (app) {
    app.on('render-process-gone', (_e, _wc, d) => ligne('ERREUR render-process-gone', d));
    app.on('child-process-gone', (_e, d) => ligne('ERREUR child-process-gone', d));
  }
}

module.exports = { configurer, ligne, armerErreurs };
