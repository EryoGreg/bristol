'use strict';
/**
 * Amorce data/registre.json — le registre GELE : pour chaque oeuvre, un
 * identifiant stable (jamais reutilise) et un numero d'affichage fige (jamais
 * renumerote). Cle = le slug actuel du manifeste, ce qui permet a l'import de
 * retrouver la ligne meme si le CSV est reordonne.
 *
 * A lancer UNE fois puis versionner. Ensuite, `npm run import` complete le
 * registre pour les nouvelles oeuvres sans jamais toucher les entrees existantes.
 *
 *     node scripts/registre-init.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { lireCsv } = require('../src/main/import');

const RACINE = path.resolve(__dirname, '..');
const CSV = path.join(RACINE, 'data', 'manifest.csv');
const REGISTRE = path.join(RACINE, 'data', 'registre.json');

function main() {
  if (fs.existsSync(REGISTRE)) {
    console.error('data/registre.json existe deja — ne pas re-amorcer (il est gele).');
    process.exit(1);
  }
  const oeuvres = lireCsv(fs.readFileSync(CSV, 'utf8'));
  const registre = {};
  for (const o of oeuvres) {
    const ref = parseInt(o.ligne, 10);
    registre[o.id] = {
      id: 'p:' + crypto.randomBytes(5).toString('hex'),
      ref: String(Number.isFinite(ref) ? ref : 0).padStart(3, '0')
    };
  }
  fs.writeFileSync(REGISTRE, JSON.stringify(registre, null, 1) + '\n');
  console.log('%d entrees -> %s', Object.keys(registre).length, REGISTRE);
}

main();
