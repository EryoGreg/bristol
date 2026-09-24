'use strict';
/**
 * Moteur de masques — generique, pilote par le gabarit du deck.
 *
 * Un « masque » est l'ensemble des champs VISIBLES d'une fiche au tirage.
 * Les champs `toujours_cache` (l'equivalent de la « date » en histoire de
 * l'art) ne sont jamais visibles : ils ne comptent pas dans le masque.
 *
 * Un masque n'est retenu pour une fiche que s'il satisfait quatre regles :
 *   1. discriminant  -- les champs visibles ne designent qu'une seule fiche
 *   2. evocateur     -- au moins un indice qu'un humain peut relier a la fiche
 *   3. sans fuite    -- aucun champ visible ne contient la reponse d'un champ cache
 *   4. incomplet     -- au moins un champ masquable est cache
 *
 * Chaque champ du gabarit porte des drapeaux :
 *   masquable        le moteur peut le cacher (sinon : toujours visible)
 *   toujours_cache   jamais visible au tirage
 *   evocateur        peut servir d'indice a lui seul
 *   evoc_min         longueur mini du texte pour compter comme evocateur
 *                    (defaut 60 pour texte_long, 0 sinon)
 *   evoc_si_unique   evocateur quand sa valeur est unique dans le corpus
 *   verif_fuite      ce champ, s'il est cache, ne doit pas etre trahi par un
 *                    champ texte_long visible
 *   fuite_min_mots   nb de mots significatifs requis pour qu'une fuite compte
 *                    (defaut 2)
 *
 * Tout est precalcule a l'import : le tirage se contente de piocher dans la
 * liste des masques valides de la fiche. Les bitmasks sont indexes sur l'ordre
 * des champs masquables du gabarit — ils n'ont de sens qu'avec ce gabarit,
 * lequel voyage dans pack.db.
 */

function normaliser(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function motsSignificatifs(s) {
  return normaliser(s).split(' ').filter((m) => m.length > 3);
}

function estImage(champ) {
  return champ.type === 'image' || champ.cle === 'image';
}

function brut(fiche, champ) {
  const v = fiche.donnees && fiche.donnees[champ.cle];
  return String(v == null ? '' : v);
}

/** La valeur d'un champ, sous forme comparable. */
function valeur(fiche, champ) {
  if (estImage(champ)) return fiche.id;                 // une image par fiche
  if (champ.type === 'liste') {
    return [...new Set(
      brut(fiche, champ).split(/[,/;]|\bet\b/).map(normaliser).filter(Boolean)
    )].sort().join('+');
  }
  return normaliser(brut(fiche, champ));
}

function evocMin(champ) {
  if (champ.evoc_min != null) return champ.evoc_min;
  return champ.type === 'texte_long' ? 60 : 0;
}

/** Champs que le moteur peut cacher (dans l'ordre : c'est l'ordre des bits). */
function champsMasquables(champs) {
  return champs.filter((c) => c.masquable && !c.toujours_cache);
}

/**
 * Calcule les masques valides de chaque fiche.
 * @param {Array<Object>} fiches   [{ id, donnees:{cle:valeur}, ... }]
 * @param {Array<Object>} champs   definitions de champ du gabarit
 * @returns {Map<string, number[]>} id -> masques valides (bitmasks)
 */
/** Zones d'occlusion d'une fiche (JSON dans donnees.<cle>), ou null. */
function occlusionDe(fiche, cleOcc) {
  if (!cleOcc) return null;
  let v = fiche.donnees && fiche.donnees[cleOcc];
  if (!v) return null;
  try { if (typeof v === 'string') v = JSON.parse(v); } catch (_) { return null; }
  return v && Array.isArray(v.zones) && v.zones.length ? v : null;
}

function calculer(fiches, champs) {
  const masquables = champsMasquables(champs);
  const cleOcc = (champs.find((c) => c.type === 'occlusion') || {}).cle || null;
  const CH = masquables.map((c) => c.cle);
  const BIT = {};
  CH.forEach((c, i) => { BIT[c] = 1 << i; });
  const TOUT = (1 << CH.length) - 1;
  const parCle = Object.fromEntries(masquables.map((c) => [c.cle, c]));

  // comptage des valeurs pour les champs evoc_si_unique
  const compteUnique = {};
  for (const c of champs) {
    if (!c.evoc_si_unique) continue;
    const m = new Map();
    for (const f of fiches) {
      const v = valeur(f, c);
      if (v) m.set(v, (m.get(v) || 0) + 1);
    }
    compteUnique[c.cle] = m;
  }

  const meta = fiches.map((f) => {
    const mm = {};
    for (const c of masquables) {
      mm[c.cle] = {
        aValeur: !!valeur(f, c),
        assezLong: brut(f, c).trim().length >= evocMin(c),
        unique: !!(c.evoc_si_unique && compteUnique[c.cle].get(valeur(f, c)) === 1)
      };
    }
    return mm;
  });

  // discriminance : pour chaque masque, une cle par fiche, puis comptage
  const discriminant = fiches.map(() => new Set());
  for (let m = 1; m <= TOUT; m++) {
    const visibles = CH.filter((c) => m & BIT[c]);
    const compte = new Map();
    const cles = fiches.map((f) => {
      const k = visibles.map((c) => valeur(f, parCle[c])).join('');
      compte.set(k, (compte.get(k) || 0) + 1);
      return k;
    });
    for (let i = 0; i < fiches.length; i++) {
      if (compte.get(cles[i]) === 1) discriminant[i].add(m);
    }
  }

  const evocateurs = masquables.filter((c) => c.evocateur || c.evoc_si_unique);
  const longsMasquables = masquables.filter((c) => c.type === 'texte_long');
  const sujetsFuite = champs.filter((c) => c.verif_fuite);

  const resultat = new Map();
  fiches.forEach((f, i) => {
    // Fiche a occlusion d'image : pas de moteur de masque texte. Un seul
    // « masque » factice ; jeu.js choisit la zone cachee au tirage.
    if (occlusionDe(f, cleOcc)) { resultat.set(f.id, [0]); return; }
    const valides = [];
    for (let m = 1; m < TOUT; m++) {          // < TOUT : au moins un champ masquable cache
      if (!discriminant[i].has(m)) continue;
      const voit = (cle) => BIT[cle] !== undefined && (m & BIT[cle]) !== 0;

      // regle 2 : au moins un evocateur visible
      let evoc = false;
      for (const c of evocateurs) {
        if (!voit(c.cle) || !meta[i][c.cle].aValeur) continue;
        if (c.evocateur) {
          if (c.type === 'texte_long' && !meta[i][c.cle].assezLong) continue;
          evoc = true; break;
        }
        if (c.evoc_si_unique && meta[i][c.cle].unique) { evoc = true; break; }
      }
      if (!evoc) continue;

      // regle 3 : un champ texte_long visible ne doit pas trahir un champ
      // `verif_fuite` cache.
      let fuite = false;
      for (const long of longsMasquables) {
        if (!voit(long.cle)) continue;
        const d = normaliser(brut(f, long));
        if (!d) continue;
        for (const cible of sujetsFuite) {
          if (cible.cle === long.cle || voit(cible.cle)) continue;
          const mots = motsSignificatifs(brut(f, cible));
          const seuil = cible.fuite_min_mots != null ? cible.fuite_min_mots : 2;
          if (mots.length >= seuil && mots.every((w) => d.includes(w))) { fuite = true; break; }
        }
        if (fuite) break;
      }
      if (fuite) continue;

      valides.push(m);
    }
    resultat.set(f.id, valides);
  });

  return resultat;
}

/**
 * Traduit un bitmask en objet { cle: visible } pour l'affichage.
 * masque null -> tout visible (hors `toujours_cache`).
 */
function decrire(masque, champs) {
  const masquables = champsMasquables(champs);
  const BIT = {};
  masquables.forEach((c, i) => { BIT[c.cle] = 1 << i; });
  const out = {};
  for (const c of champs) {
    if (c.toujours_cache) out[c.cle] = false;
    else if (BIT[c.cle] === undefined) out[c.cle] = true;       // non masquable
    else out[c.cle] = masque == null ? true : (masque & BIT[c.cle]) !== 0;
  }
  return out;
}

module.exports = { calculer, decrire, normaliser, valeur, champsMasquables, occlusionDe };
