import * as I from './icones.jsx';

/* Helpers de rendu pilotes par le gabarit du deck.
   Le gabarit vient de etat.gabarit ({ cle, nom, champs: [ { cle, libelle, type,
   ordre, role, masquable, toujours_cache, ... } ] }). */

export function champsTries(gabarit) {
  if (!gabarit || !Array.isArray(gabarit.champs)) return [];
  return [...gabarit.champs].sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
}

export function champImage(gabarit) {
  return champsTries(gabarit).find((c) => c.type === 'image' || c.cle === 'image') || null;
}

export function champOcclusion(gabarit) {
  return champsTries(gabarit).find((c) => c.type === 'occlusion') || null;
}

/** Champ portant `role`, sinon un fallback raisonnable. */
export function champRole(gabarit, role) {
  const cs = champsTries(gabarit);
  const explicite = cs.find((c) => c.role === role);
  if (explicite) return explicite;
  const courts = cs.filter((c) => c.type === 'texte_court');
  if (role === 'titre') return courts[0] || cs.find((c) => c.type !== 'image') || null;
  if (role === 'sous_titre') return courts[1] || null;
  return null;
}

const COURTS = new Set(['texte_court', 'date', 'nombre']);
export const estCourt = (c) => COURTS.has(c.type);
export const estLong = (c) => c.type === 'texte_long';
export const estImage = (c) => c.type === 'image' || c.cle === 'image';

/**
 * Normalise la valeur d'un champ image en liste [{ url, legende }].
 * Accepte : le tableau deja produit par jeu.js, une chaine 'fiche://x'
 * (retrocompat), ou une chaine 'a.jpg|b.gif' + legendes 'l1|l2'.
 */
export function listerImages(valeur, legendeBrute) {
  if (Array.isArray(valeur)) return valeur.filter((im) => im && im.url);
  if (!valeur || typeof valeur !== 'string') return [];
  const legs = String(legendeBrute || '').split('|').map((s) => s.trim());
  return valeur.split('|').map((s) => s.trim()).filter(Boolean).map((u, i) => ({
    url: u.startsWith('fiche://') || u.includes('://') ? u : 'fiche://' + u,
    legende: legs[i] || ''
  }));
}

/**
 * Galerie d'images d'une fiche. 1 image -> <img> simple (comportement d'avant).
 * >= 2 -> image principale + bande de vignettes + ligne de legende.
 * @param images  [{ url, legende }]
 * @param i       index actif
 * @param onI     (index) => void
 * @param onZoom  () => void   clic sur l'image principale
 */
export function GalerieImage({ images, i = 0, onI, onZoom }) {
  if (!images || !images.length) return null;
  const idx = Math.min(Math.max(i, 0), images.length - 1);
  const courante = images[idx];
  const multi = images.length > 1;

  return (
    <div className={'cadre-image' + (multi ? ' a-galerie' : '')}>
      <img className="visuel" src={courante.url} alt={courante.legende || ''}
           onClick={onZoom} />
      {multi && (
        <div className="galerie-vignettes">
          {images.map((im, k) => (
            <button
              key={im.url + k}
              className={'galerie-vignette' + (k === idx ? ' actif' : '')}
              onClick={() => onI && onI(k)}
              title={im.legende || `Image ${k + 1}`}
            >
              <img src={im.url} alt="" />
            </button>
          ))}
        </div>
      )}
      {courante.legende && <div className="galerie-legende">{courante.legende}</div>}
    </div>
  );
}

/**
 * Occlusion d'image : le schema + des rectangles legendes (coords 0..1).
 * `cachee` = index de la zone masquee (« ? ») ; null -> toutes les legendes
 * visibles. Clic sur la zone cachee -> `onReveler()`.
 * @param val     { image:'fiche://x', zones:[{x,y,w,h,texte}] }
 */
export function ImageOcclusion({ val, cachee, revele, onReveler, onZoom }) {
  if (!val || !Array.isArray(val.zones)) return null;
  const { zones } = val;
  return (
    <div className="cadre-image a-occlusion">
     <span className="occ-wrap">
      <img className="visuel" src={val.image} alt="" onClick={onZoom} />
      <svg className="occlusion-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">
        {zones.map((z, i) => {
          const estCachee = i === cachee && !revele;
          const montre = revele || i !== cachee;
          return (
            <g key={i}
               className={'occ-zone' + (estCachee ? ' cachee' : montre ? ' revelee' : '')}
               onClick={estCachee ? (e) => { e.stopPropagation(); onReveler && onReveler(); } : undefined}>
              <rect x={z.x * 1000} y={z.y * 1000} width={z.w * 1000} height={z.h * 1000} rx="4" />
              {estCachee && (
                <text x={(z.x + z.w / 2) * 1000} y={(z.y + z.h / 2) * 1000}
                      textAnchor="middle" dominantBaseline="central">?</text>
              )}
              {montre && z.texte && (
                <text x={(z.x + z.w / 2) * 1000} y={(z.y + z.h / 2) * 1000}
                      textAnchor="middle" dominantBaseline="central"
                      className={i === cachee ? 'occ-reponse' : ''}>{z.texte}</text>
              )}
            </g>
          );
        })}
      </svg>
     </span>
    </div>
  );
}

/** Rend une valeur selon le type du champ. `valeur` deja resolue (texte). */
export function ValeurChamp({ champ, valeur }) {
  const v = valeur == null || String(valeur).trim() === '' ? '—' : valeur;
  if (estLong(champ)) return <div className="texte-description">{v}</div>;
  if (champ.type === 'liste') return <div style={{ fontSize: 13, color: 'var(--attenue)' }}>{v}</div>;
  if (champ.type === 'nombre') return <div style={{ fontFamily: 'var(--mono)', fontSize: 14 }}>{v}</div>;
  if (champ.role === 'titre') {
    return <div style={{ fontFamily: 'var(--serif)', fontSize: 22, lineHeight: 1.2 }}>{v}</div>;
  }
  return <div style={{ fontSize: 14.5, color: 'var(--tuile-ink)' }}>{v}</div>;
}

/**
 * Un champ dans la tuile de jeu : valeur revelee, bouton « masqué », ou —
 * pour un champ `toujours_cache` — le bouton « ? ? ? ? » revelable au clic.
 * @param voit       (cle) => bool
 * @param onReveler  (cle|null) => void
 */
export function ChampBloc({ champ, valeur, voit, onReveler }) {
  const visible = voit(champ.cle);

  if (champ.toujours_cache && !visible) {
    return (
      <div className="champ">
        <div className="etiquette">{champ.libelle}</div>
        <button className="annee cachee" onClick={() => onReveler(champ.cle)}>
          <span className="points">? ? ? ?</span>
          <span className="note">cliquer pour révéler</span>
        </button>
      </div>
    );
  }

  if (estLong(champ)) {
    return (
      <div className="champ champ-description">
        <div className="etiquette">{champ.libelle}</div>
        <div className="valeur-description">
          {visible
            ? <ValeurChamp champ={champ} valeur={valeur} />
            : <button className="masque" onClick={() => onReveler(champ.cle)}>
                <I.OeilBarre /> masqué
              </button>}
        </div>
      </div>
    );
  }

  return (
    <div className="champ">
      <div className="etiquette">{champ.libelle}</div>
      {champ.toujours_cache ? (
        <div className="annee">
          <ValeurChamp champ={champ} valeur={valeur} />
        </div>
      ) : (
        <div className="valeur">
          {visible
            ? <ValeurChamp champ={champ} valeur={valeur} />
            : <button className="masque" onClick={() => onReveler(champ.cle)}>
                <I.OeilBarre /> masqué
              </button>}
        </div>
      )}
    </div>
  );
}
