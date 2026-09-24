'use strict';
/**
 * Import CSV : analyse un fichier, propose un gabarit (types devines).
 * Le CSV doit etre separe par ';' (comme les contenu.csv du projet), guillemets
 * doubles echappes — meme lecteur que import.js.
 */

const fs = require('fs');
const { lireCsv } = require('./import');

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'champ';
}

const RE_DATE = /^\s*(\d{1,4}\s*(av|ap|bc|ad)?[.\s-]|\d{4}-\d{2}-\d{2}|-?\d{2,4}\s*\/)/i;

/** Devine le type d'une colonne d'apres ses valeurs. */
function devinerType(valeurs) {
  const nn = valeurs.filter((v) => v && v.trim());
  if (!nn.length) return 'texte_court';
  const num = nn.filter((v) => /^-?\d+([.,]\d+)?$/.test(v.trim()));
  if (num.length === nn.length) return 'nombre';
  const moyLong = nn.reduce((s, v) => s + v.length, 0) / nn.length;
  if (moyLong > 80) return 'texte_long';
  const listeux = nn.filter((v) => (v.match(/[,;/]/g) || []).length >= 1);
  if (listeux.length > nn.length * 0.5) return 'liste';
  const dates = nn.filter((v) => RE_DATE.test(v));
  if (dates.length > nn.length * 0.6) return 'date';
  return 'texte_court';
}

/**
 * @param {string} cheminCsv
 * @returns {{ entetes:string[], apercu:Object[], gabaritPropose:Object,
 *             colImage:string|null, colImageSrc:string|null, colId:string|null }}
 */
function analyser(cheminCsv) {
  const lignes = lireCsv(fs.readFileSync(cheminCsv, 'utf8'));
  if (!lignes.length) return { erreur: 'CSV vide ou illisible.' };
  const entetes = Object.keys(lignes[0]);

  const bas = entetes.map((e) => e.toLowerCase().trim());
  const colId = entetes[bas.indexOf('id')] || null;
  const colImage = entetes[bas.findIndex((e) => e === 'image' || e === 'illustration' || e === 'fichier')] || null;
  const colImageSrc = entetes[bas.indexOf('image_src')] || null;
  const reserves = new Set([colId, colImage, colImageSrc].filter(Boolean));

  let ordre = 0;
  const champs = [];
  for (const e of entetes) {
    if (reserves.has(e)) continue;
    ordre += 1;
    const type = devinerType(lignes.map((l) => l[e]));
    champs.push({
      cle: slug(e),
      libelle: e,
      type,
      ordre,
      masquable: type !== 'nombre',
      evocateur: type === 'texte_court' || type === 'texte_long',
      ...(type === 'texte_long' ? { evoc_min: 40 } : {}),
      ...(ordre === 1 ? { role: 'titre' } : ordre === 2 ? { role: 'sous_titre' } : {})
    });
  }
  if (colImage) {
    champs.unshift({ cle: 'image', libelle: 'Image', type: 'image', ordre: 0, masquable: true, evocateur: true });
  }

  return {
    entetes,
    apercu: lignes.slice(0, 5),
    nLignes: lignes.length,
    colId, colImage, colImageSrc,
    gabaritPropose: { cle: '', nom: '', champs }
  };
}

module.exports = { analyser, devinerType, slug };
