'use strict';
/**
 * Import d'une image pour une tuile locale.
 *
 * - reduit le cote max a 1400 px (comme le corpus)
 * - vise <= 500 Ko : JPEG q85 -> q descend jusqu'a 45, puis dimensions -15 %
 *   par palier ; PNG garde seulement si l'image a de VRAIS pixels transparents
 * - ecrit dans images-locales/ sous un nom UUID, renvoie nom + dimensions + poids
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Jimp = require('jimp');

const COTE_MAX = 1400;
const POIDS_MAX = 500 * 1024;

function aVraieTransparence(img) {
  if (!img.hasAlpha()) return false;
  let transparent = false;
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function scan(x, y, idx) {
    if (this.bitmap.data[idx + 3] < 250) transparent = true;
  });
  return transparent;
}

function cote(img) { return Math.max(img.bitmap.width, img.bitmap.height); }

/**
 * @param {string|Buffer} source  chemin de fichier ou octets bruts
 * @param {string} dossierCible   images-locales/
 * @returns {Promise<{nom, largeur, hauteur, octets, redimensionnee}>}
 */
async function importer(source, dossierCible) {
  const img = await Jimp.read(source);
  const cote0 = cote(img);

  if (cote0 > COTE_MAX) {
    if (img.bitmap.width >= img.bitmap.height) img.resize(COTE_MAX, Jimp.AUTO);
    else img.resize(Jimp.AUTO, COTE_MAX);
  }

  let buf;
  let ext;

  if (aVraieTransparence(img)) {
    ext = 'png';
    buf = await img.getBufferAsync(Jimp.MIME_PNG);
    while (buf.length > POIDS_MAX && cote(img) > 500) {
      img.scaleToFit(Math.round(cote(img) * 0.85), Math.round(cote(img) * 0.85));
      buf = await img.getBufferAsync(Jimp.MIME_PNG);
    }
  } else {
    ext = 'jpg';
    let q = 85;
    img.quality(q).background(0xffffffff);   // fond blanc si l'alpha etait opaque
    buf = await img.getBufferAsync(Jimp.MIME_JPEG);
    while (buf.length > POIDS_MAX && q > 45) {
      q -= 8;
      img.quality(q);
      buf = await img.getBufferAsync(Jimp.MIME_JPEG);
    }
    while (buf.length > POIDS_MAX && cote(img) > 500) {
      img.scaleToFit(Math.round(cote(img) * 0.85), Math.round(cote(img) * 0.85)).quality(q);
      buf = await img.getBufferAsync(Jimp.MIME_JPEG);
    }
  }

  fs.mkdirSync(dossierCible, { recursive: true });
  const nom = crypto.randomUUID() + '.' + ext;
  fs.writeFileSync(path.join(dossierCible, nom), buf);

  return {
    nom,
    largeur: img.bitmap.width,
    hauteur: img.bitmap.height,
    octets: buf.length,
    redimensionnee: cote0 > COTE_MAX || cote(img) < cote0
  };
}

module.exports = { importer, POIDS_MAX, COTE_MAX };
