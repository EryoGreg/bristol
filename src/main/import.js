'use strict';
/**
 * Fabrique le pack d'un deck :
 *   data/<deck>/gabarit.json + data/<deck>/contenu.csv + data/<deck>/registre.json
 *   + data/<deck>/images/{libre,ebook}/
 *     ->  data/pack.db  (+ data/deck-actif.json)
 *
 * pack.db ne contient QUE du contenu : la table `gabarit`, la table `fiches` et
 * `pack_meta`. Les tables user_* vivent dans utilisateur.db, jamais touchees ici.
 *
 * Le registre gele l'identifiant stable (`id`) et le numero d'affichage (`ref`)
 * de chaque fiche, keyes par le `id` (slug) de la ligne CSV.
 *
 * Provenance des images (colonne CSV `image_src`, defaut 'libre') :
 *   libre  -> data/<deck>/images/libre/<fichier>   diffusable
 *   ebook  -> data/<deck>/images/ebook/<fichier>   sous licence, usage perso
 *
 *     npm run import -- <deck>              build complet (par defaut : deck-actif.json)
 *     npm run import -- <deck> --release    omet les images `ebook` (release publique)
 *     npm run import -- <deck> --audit      liste la provenance, ne construit rien
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { SCHEMA_PACK } = require('./db');
const { calculer, normaliser } = require('./masques');

const RACINE = path.resolve(__dirname, '..', '..');
const DATA = path.join(RACINE, 'data');
const PACKS = path.join(DATA, 'packs');
const DECK_ACTIF = path.join(DATA, 'deck-actif.json');
const VERSION = '1.0.0';

/**
 * Lecteur CSV/TSV minimal, guillemets doubles echappes.
 *
 * Separateur AUTO-DETECTE d'apres la 1re ligne : TABULATION si presente,
 * sinon ';'. La tabulation ne peut pas etre saisie par megarde dans une
 * cellule -> aucun risque de decalage de colonnes avec de la prose francaise
 * (qui, elle, contient des ';'). Les fichiers TSV sont donc le format sur.
 *
 * Verifie que chaque ligne a le meme nombre de champs que l'entete : sinon
 * jette une erreur explicite (plutot qu'un decalage silencieux).
 */
function lireCsv(texte, { strict = true } = {}) {
  const sep = texte.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ';';
  const lignes = [];
  let champ = '', ligne = [], dansGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (dansGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') { champ += '"'; i++; } else dansGuillemets = false;
      } else champ += c;
    } else if (c === '"') dansGuillemets = true;
    else if (c === sep) { ligne.push(champ); champ = ''; }
    else if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
    else if (c !== '\r') champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  if (!lignes.length) return [];
  const entetes = lignes[0].map((h) => h.replace(/^﻿/, '').trim());
  const corps = lignes.slice(1).filter((l) => l.some((v) => v.trim()));
  if (strict) {
    corps.forEach((l, k) => {
      if (l.length !== entetes.length) {
        throw new Error(
          `Ligne ${k + 2} : ${l.length} champs au lieu de ${entetes.length} `
          + `(separateur "${sep === '\t' ? 'TAB' : sep}"). `
          + `Un "${sep}" dans un champ ? -> passer le fichier en TSV (tabulation). `
          + `Debut : ${l.slice(0, 3).join(' | ')}`);
      }
    });
  }
  return corps.map((l) => Object.fromEntries(entetes.map((h, i) => [h, (l[i] || '').trim()])));
}

function hashTexte(donnees, champs) {
  return crypto.createHash('sha1')
    .update(champs.map((c) => donnees[c.cle] || '').join(' '))
    .digest('hex')
    .slice(0, 16);
}

function args() {
  const argv = process.argv.slice(2);
  const deck = argv.find((a) => !a.startsWith('-'))
    || (() => { try { return JSON.parse(fs.readFileSync(DECK_ACTIF, 'utf8')).deck; } catch (_) { return 'art'; } })();
  return {
    deck: deck || 'art',
    release: argv.includes('--release'),
    audit: argv.includes('--audit')
  };
}

function main() {
  const { deck, release, audit } = args();
  const dossier = path.join(DATA, deck);
  // Build normal -> data/packs/<deck>.db (bibliotheque de decks installes).
  // Build --release -> data/pack.db (artefact d'empaquetage, cf stage-release.js).
  const PACK = release ? path.join(DATA, 'pack.db') : path.join(PACKS, deck + '.db');
  const F_GABARIT = path.join(dossier, 'gabarit.json');
  const F_CSV = path.join(dossier, 'contenu.csv');
  const F_REGISTRE = path.join(dossier, 'registre.json');
  const F_CREDITS = path.join(dossier, 'credits-libre.json');   // filename image -> { structure, auteur, licence, source, note? }
  const F_OCCLUSIONS = path.join(dossier, 'occlusions.json');   // slug -> { image, zones:[{x,y,w,h,texte}] }
  const DOSSIER_IMAGES = path.join(dossier, 'images');
  const credits = fs.existsSync(F_CREDITS) ? JSON.parse(fs.readFileSync(F_CREDITS, 'utf8')) : {};
  const occlusions = fs.existsSync(F_OCCLUSIONS) ? JSON.parse(fs.readFileSync(F_OCCLUSIONS, 'utf8')) : {};

  for (const [nom, f] of [['gabarit', F_GABARIT], ['contenu', F_CSV], ['registre', F_REGISTRE]]) {
    if (!fs.existsSync(f)) { console.error(`${nom} introuvable : ${f}`); process.exit(1); }
  }

  const gabaritBrut = JSON.parse(fs.readFileSync(F_GABARIT, 'utf8'));
  const gabarit = Array.isArray(gabaritBrut)
    ? { cle: deck, nom: deck, champs: gabaritBrut }
    : { cle: gabaritBrut.cle || deck, nom: gabaritBrut.nom || deck, champs: gabaritBrut.champs || [] };
  const champs = [...gabarit.champs].sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  const clesTexte = champs.filter((c) => c.type !== 'image' && c.cle !== 'image').map((c) => c.cle);
  const champTitre = (champs.find((c) => c.role === 'titre') || champs.find((c) => c.type === 'texte_court') || {}).cle;

  const brutes = lireCsv(fs.readFileSync(F_CSV, 'utf8'));
  const registre = JSON.parse(fs.readFileSync(F_REGISTRE, 'utf8'));
  let refMax = Math.max(0, ...Object.values(registre).map((e) => parseInt(e.ref, 10) || 0));
  let nouveaux = 0;

  // Verifie la presence physique de chaque image dans le sous-dossier de sa
  // provenance. `src` inconnu ou fichier absent -> avertissement (pas fatal).
  const imgManquantes = [];
  function verifierImage(fichier, src) {
    if (!fichier) return;
    const p = path.join(DOSSIER_IMAGES, src, fichier);
    if (!fs.existsSync(p)) imgManquantes.push(`${src}/${fichier}`);
  }

  /**
   * Decoupe les colonnes `image` / `image_src` / `image_legende` d'une ligne en
   * une liste de parts { fichier, src, legende }.
   *
   *   image          = liste '|' de noms de fichier (1 = comportement d'origine)
   *   image_src      = 1 valeur (s'applique a toutes) OU liste '|' positionnelle
   *   image_legende  = liste '|' positionnelle des legendes (optionnelle)
   *
   * `src` inconnu -> traite comme 'ebook' (prudence), avec un avertissement.
   */
  function partsImage(row) {
    const fichiers = String(row.image || '').split('|').map((s) => s.trim()).filter(Boolean);
    if (!fichiers.length) return [];
    const srcs = String(row.image_src || 'libre').split('|').map((s) => s.trim().toLowerCase());
    const legs = String(row.image_legende || '').split('|').map((s) => s.trim());
    return fichiers.map((fichier, i) => {
      let src = srcs[i] || srcs[0] || 'libre';
      if (src !== 'libre' && src !== 'ebook') {
        console.warn(`  ! ${row.id} : image_src="${src}" inconnu, traite comme "ebook" (prudence)`);
        src = 'ebook';
      }
      return { fichier, src, legende: legs[i] || '' };
    });
  }

  const fiches = brutes.map((row) => {
    let e = registre[row.id];
    if (!e) {
      refMax += 1;
      e = { id: 'p:' + crypto.randomBytes(5).toString('hex'), ref: String(refMax).padStart(3, '0') };
      registre[row.id] = e;
      nouveaux += 1;
    }
    const donnees = {};
    for (const cle of clesTexte) donnees[cle] = row[cle] || '';

    // Occlusion d'image : contenu dans le sidecar occlusions.json (keye par slug),
    // jamais dans le CSV (JSON avec guillemets -> incompatible TSV).
    if (occlusions[row.id] && Array.isArray(occlusions[row.id].zones)) {
      const cleOcc = (champs.find((c) => c.type === 'occlusion') || {}).cle;
      if (cleOcc) donnees[cleOcc] = JSON.stringify(occlusions[row.id]);
    }

    let parts = partsImage(row);
    for (const p of parts) verifierImage(p.fichier, p.src);
    const avaitEbook = parts.some((p) => p.src === 'ebook');

    // Release : on retire les parts sous licence, on garde les parts libres.
    if (release) parts = parts.filter((p) => p.src !== 'ebook');

    const image = parts.map((p) => p.fichier).join('|');
    const image_legende = parts.map((p) => p.legende).join('|');
    let image_src = [...new Set(parts.map((p) => p.src))].join('|') || 'libre';
    if (release && !parts.length && avaitEbook) image_src = 'ebook_omis';

    return {
      id: e.id, ref: e.ref, gabarit: gabarit.cle, slug: row.id,
      donnees, image, image_src, image_legende, avaitEbook,
      partsLibres: parts.filter((p) => p.src === 'libre').map((p) => p.fichier),
      largeur: parseInt(row.largeur, 10) || null,
      hauteur: parseInt(row.hauteur, 10) || null,
      octets: parseInt(row.octets, 10) || null
    };
  });

  // sous_licence = fiches dont au moins une part est `ebook` (0 apres --release).
  const nEbook = release ? 0 : fiches.filter((o) => o.avaitEbook).length;
  const nOmises = fiches.filter((o) => o.image_src === 'ebook_omis').length;

  // Sources des images. `credits-libre.json` present => le deck s'engage a
  // crediter : toute image `libre` doit y figurer (erreur sinon). Absent => on
  // n'exige rien, sauf en --release (impossible de diffuser sans credits).
  const imagesLibres = [...new Set(fiches.flatMap((o) => o.partsLibres))];
  const suitCredits = fs.existsSync(F_CREDITS);
  if (!suitCredits && imagesLibres.length && release) {
    console.error(`\nERREUR : ${imagesLibres.length} image(s) libre(s) mais pas de ${path.basename(F_CREDITS)} `
      + `-> impossible de construire les remerciements pour une diffusion.`);
    process.exit(1);
  }
  const creditsManquants = suitCredits ? imagesLibres.filter((f) => !credits[f]) : [];
  if (creditsManquants.length && !audit) {
    console.error(`\nERREUR : ${creditsManquants.length} image(s) libre(s) sans source dans ${path.basename(F_CREDITS)} :`);
    for (const f of creditsManquants) console.error('  - ' + f);
    console.error(`Ajouter { "structure", "auteur", "licence", "source" } pour chacune.`);
    process.exit(1);
  }

  /** Remerciements du pack (markdown), a partir des images reellement embarquees. */
  function construireAttributions() {
    const g = Array.isArray(gabaritBrut) ? {} : gabaritBrut;
    const L = [`# ${gabarit.nom} — remerciements et sources`, ''];
    if (g.credits) L.push(g.credits, '');
    if (g.licence) L.push(`Licence du deck : ${g.licence}`, '');
    L.push('## Images', '',
      'Toutes les images de ce pack sont sous licence libre (domaine public, CC0 ou',
      'CC-BY-SA). Les images CC-BY-SA (et leurs éventuelles retouches) restent sous',
      'cette licence ; merci de conserver ces mentions.', '');
    const parLic = {};
    for (const f of imagesLibres.sort()) {
      const c = credits[f]; if (!c) continue;
      (parLic[c.licence] || (parLic[c.licence] = [])).push({ f, c });
    }
    for (const lic of Object.keys(parLic).sort()) {
      L.push(`### ${lic}`, '');
      for (const { f, c } of parLic[lic]) {
        L.push(`- **${c.structure}** — ${c.auteur} — ${c.source}`
          + (c.note ? `  \n  _${c.note}_` : ''));
      }
      L.push('');
    }
    L.push('## Contenu des fiches', '',
      'Rédigé pour le projet. Références par fiche : voir le champ « Sources » de',
      'chaque fiche (liens Wikipédia / littérature).', '');
    return L.join('\n');
  }
  const attributions = construireAttributions();

  // --- mode audit : rapport seul -----------------------------------------
  if (audit) {
    console.log(`\nProvenance des images — deck "${deck}" (${fiches.length} fiches)\n`);
    const rows = fiches
      .filter((o) => o.avaitEbook || o.image_src === 'ebook_omis')
      .map((o) => [o.ref, (o.donnees[champTitre] || o.slug).slice(0, 40), o.image || '(omise)', o.image_src]);
    const w = [3, 40, 32, 14];
    const ligne = (c) => c.map((v, i) => String(v).padEnd(w[i])).join('  ');
    console.log(ligne(['ref', 'titre', 'image', 'source']));
    console.log(ligne(w.map((n) => '-'.repeat(n))));
    for (const r of rows) console.log(ligne(r));
    console.log(`\n${nEbook} fiche(s) a image SOUS LICENCE (ebook).`);
    console.log(`Un build --release les livrerait sans image.`);
    if (imgManquantes.length) console.log(`\n${imgManquantes.length} fichier(s) image absent(s) : ${imgManquantes.slice(0, 10).join(', ')}${imgManquantes.length > 10 ? '…' : ''}`);
    return;
  }

  if (imgManquantes.length) {
    console.warn(`! ${imgManquantes.length} image(s) absente(s) du disque : ${imgManquantes.slice(0, 8).join(', ')}${imgManquantes.length > 8 ? '…' : ''}`);
  }
  if (nouveaux) {
    fs.writeFileSync(F_REGISTRE, JSON.stringify(registre, null, 1) + '\n');
    console.log('Registre complete : %d nouvelle(s) fiche(s)', nouveaux);
  }

  const t0 = Date.now();
  const masques = calculer(fiches, champs);
  console.log('Masques calcules en %d ms', Date.now() - t0);

  fs.mkdirSync(path.dirname(PACK), { recursive: true });
  for (const suffixe of ['', '-wal', '-shm']) fs.rmSync(PACK + suffixe, { force: true });
  const d = new Database(PACK);
  d.exec(SCHEMA_PACK);

  const insG = d.prepare('INSERT INTO gabarit (cle, nom, champs) VALUES (?, ?, ?)');
  const insF = d.prepare(`
    INSERT INTO fiches
      (id, ref, gabarit, donnees, image, image_src, image_legende, largeur, hauteur, octets, hash_texte, recherche, masques)
    VALUES
      (@id, @ref, @gabarit, @donnees, @image, @image_src, @image_legende, @largeur, @hauteur, @octets, @hash_texte, @recherche, @masques)
  `);
  const meta = d.prepare('INSERT OR REPLACE INTO pack_meta (cle, valeur) VALUES (?, ?)');

  d.transaction(() => {
    insG.run(gabarit.cle, gabarit.nom, JSON.stringify(champs));
    for (const o of fiches) {
      const texte = [o.ref, ...clesTexte.map((k) => o.donnees[k] || '')].join(' ');
      insF.run({
        id: o.id, ref: o.ref, gabarit: o.gabarit,
        donnees: JSON.stringify(o.donnees),
        image: o.image, image_src: o.image_src, image_legende: o.image_legende || '',
        largeur: o.largeur, hauteur: o.hauteur, octets: o.octets,
        hash_texte: hashTexte(o.donnees, champs),
        recherche: normaliser(texte),
        masques: JSON.stringify(masques.get(o.id) || [])
      });
    }
    const contenu = JSON.stringify(fiches) + '|' + [...masques.entries()].sort().join(';');
    meta.run('deck', deck);
    meta.run('gabarit', gabarit.cle);
    meta.run('gabarit_nom', gabarit.nom || gabarit.cle);
    meta.run('version', VERSION);
    meta.run('cree_le', new Date().toISOString());
    meta.run('n_fiches', String(fiches.length));
    meta.run('sous_licence', String(nEbook));   // 0 apres --release
    meta.run('release', release ? '1' : '0');
    meta.run('attributions', attributions);
    meta.run('hash', crypto.createHash('sha1').update(contenu).digest('hex').slice(0, 16));
  })();

  d.pragma('wal_checkpoint(TRUNCATE)');
  d.close();
  for (const suffixe of ['-wal', '-shm']) fs.rmSync(PACK + suffixe, { force: true });

  fs.writeFileSync(DECK_ACTIF, JSON.stringify({ deck }, null, 1) + '\n');
  fs.writeFileSync(path.join(dossier, 'ATTRIBUTIONS.md'), attributions);   // copie lisible dans le deck
  if (release) fs.writeFileSync(path.join(DATA, 'ATTRIBUTIONS.md'), attributions);   // embarque a cote de pack.db

  const stats = fiches.map((o) => (masques.get(o.id) || []).length).sort((a, b) => a - b);
  console.log('pack.db : deck "%s"%s | %d fiches | masques min %d / med %d / max %d',
    deck, release ? ' [RELEASE]' : '', fiches.length, stats[0], stats[stats.length >> 1], stats[stats.length - 1]);
  console.log('Sans aucun masque valide : %d', fiches.filter((o) => (masques.get(o.id) || []).length === 0).length);
  if (release && nOmises) console.log('Images sous licence OMISES : %d', nOmises);
  else if (nEbook) console.log('Images sous licence embarquees : %d (build perso — ne pas diffuser)', nEbook);
  console.log('-> %s', PACK);
}

if (require.main === module) main();
module.exports = { lireCsv, hashTexte };
