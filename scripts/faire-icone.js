'use strict';
/**
 * Fabrique build/icon.ico (+ build/icon.png) a partir de icone-source.jpg.
 *
 * L'image source est un portrait ; l'icone doit etre carree. On garde le
 * ratio : la vignette nette est posee en entier (contain) sur un fond = la
 * meme image floutee et assombrie. Mona Lisa ET le chat restent visibles.
 *
 *     node scripts/faire-icone.js
 */

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const pngToIco = require('png-to-ico').default;

const SRC = path.resolve(__dirname, '..', 'icone-source.jpg');
const OUT = path.resolve(__dirname, '..', 'build');
const MAITRE = 1024;
const TAILLES = [256, 128, 64, 48, 32, 16];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const src = await Jimp.read(SRC);

  const fond = src.clone().cover(MAITRE, MAITRE).blur(18).brightness(-0.4);
  const vignette = src.clone().contain(MAITRE, MAITRE);          // ratio conserve, centre
  fond.composite(vignette, 0, 0);

  fs.writeFileSync(path.join(OUT, 'icon.png'), await fond.getBufferAsync(Jimp.MIME_PNG));

  const pngs = [];
  for (const t of TAILLES) {
    pngs.push(await fond.clone().resize(t, t, Jimp.RESIZE_BICUBIC).getBufferAsync(Jimp.MIME_PNG));
  }
  fs.writeFileSync(path.join(OUT, 'icon.ico'), await pngToIco(pngs));

  console.log('build/icon.png (1024) + build/icon.ico (' + TAILLES.join(',') + ')');
})().catch((e) => { console.error(e); process.exit(1); });
