'use strict';
/**
 * Telecharge les 3 familles de polices (Google Fonts) en local pour que
 * l'application fonctionne hors ligne. Ne garde que les sous-ensembles
 * latin + latin-ext (suffisant pour le francais, guillemets, oe).
 *
 *     node scripts/polices.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DOSSIER = path.resolve(__dirname, '..', 'src', 'renderer', 'fonts');
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500'
  + '&family=Instrument+Sans:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const SOUS_ENSEMBLES = new Set(['latin', 'latin-ext']);

function get(url, headers = {}) {
  return new Promise((ok, ko) => {
    https.get(url, { headers: { 'User-Agent': UA, ...headers } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return get(r.headers.location, headers).then(ok, ko);
      }
      if (r.statusCode !== 200) return ko(new Error(url + ' -> ' + r.statusCode));
      const morceaux = [];
      r.on('data', (d) => morceaux.push(d));
      r.on('end', () => ok(Buffer.concat(morceaux)));
    }).on('error', ko);
  });
}

(async () => {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const css = (await get(CSS_URL)).toString('utf8');

  // Chaque bloc @font-face est precede d'un commentaire /* <sous-ensemble> */
  const blocs = css.split('@font-face').slice(1);
  const commentaires = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\//g)].map((m) => m[1]);

  let sortie = '/* Polices locales — genere par scripts/polices.js, ne pas editer a la main. */\n';
  let n = 0;

  for (let i = 0; i < blocs.length; i++) {
    const sousEnsemble = commentaires[i];
    if (!SOUS_ENSEMBLES.has(sousEnsemble)) continue;

    const bloc = blocs[i].slice(0, blocs[i].indexOf('}') + 1);
    const famille = (bloc.match(/font-family:\s*'([^']+)'/) || [])[1];
    const poids = (bloc.match(/font-weight:\s*(\d+)/) || [])[1];
    const urlWoff2 = (bloc.match(/url\((https:\/\/[^)]+\.woff2)\)/) || [])[1];
    if (!famille || !poids || !urlWoff2) continue;

    const nomFichier = famille.toLowerCase().replace(/\s+/g, '-')
      + `-${poids}-${sousEnsemble}.woff2`;
    fs.writeFileSync(path.join(DOSSIER, nomFichier), await get(urlWoff2, { Referer: 'https://fonts.googleapis.com/' }));
    n++;

    sortie += '@font-face' + bloc.replace(/url\(https:\/\/[^)]+\.woff2\)/, `url(./${nomFichier})`) + '\n';
  }

  fs.writeFileSync(path.join(DOSSIER, 'polices.css'), sortie);
  console.log(`${n} fichiers woff2 + polices.css dans ${DOSSIER}`);
})().catch((e) => { console.error(e); process.exit(1); });
