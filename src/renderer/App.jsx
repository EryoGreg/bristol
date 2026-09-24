import { useEffect, useState, useCallback, useRef, useMemo, createContext, useContext, Fragment } from 'react';
import * as I from './icones.jsx';
import {
  champsTries, champImage, champOcclusion, champRole, estCourt, estLong, estImage, ChampBloc,
  GalerieImage, ImageOcclusion, listerImages
} from './champs.jsx';

// Gabarit du deck courant ({ cle, nom, champs }). Fourni par <App>, consomme
// par tout ce qui affiche ou edite une fiche.
const GabaritContext = createContext({ cle: null, nom: null, champs: [] });

// Densite de la grille des galeries (tuiles visibles par ligne). Reglage
// global, cycle 5 -> 7 -> 9 -> 5, pilote par le bouton de BarreFiltres.
const GrilleContext = createContext({ colonnes: 5, cycler: () => {} });
const DENSITES = [5, 7, 9];

// Retour « intra-page » : une page ayant un état interne (aperçu ouvert,
// éditeur, partie en cours) enregistre ici un gestionnaire. souris4 le
// consulte AVANT de reculer dans l'historique des pages — sinon un aperçu
// ouvert dans Livre renverrait direct à la page précédente au lieu de se
// refermer. Le gestionnaire renvoie true s'il a absorbé le retour.
const NavContext = createContext({ setRetour: () => {} });

/* ------------------------------------------------------------------ menu */

function Menu({ etat, aller, onQuitter }) {
  return (
    <div className="menu">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div className="surtitre">
          {etat.fiches} fiches · {etat.tags.livre + etat.tags.etoile + etat.tags.bad_smiley} marquées
        </div>
        <h1>Bristol</h1>
        <div className="soustitre">
          {(etat.gabarit && etat.gabarit.nom) || 'Fiches de révision à masques auto-générés'}
        </div>
      </div>

      <div className="filet" />

      <div className="cartes">
        <button className="carte primaire" onClick={() => aller('jeu')}>
          <span className="pastille"><I.Manette t={24} /></span>
          <span>
            <div className="nom">Jouer</div>
            <div className="desc">Mode aléatoire ou par catégorie</div>
          </span>
        </button>

        {[
          ['bibliotheque', I.Bibliotheque, 'Bibliothèque', 'Toutes les fiches', etat.fiches, null],
          ['livre', I.Livre, 'Livre', 'À approfondir', etat.tags.livre, 'var(--livre)'],
          ['etoile', I.Etoile, 'Étoile', 'Favorites', etat.tags.etoile, 'var(--etoile)'],
          ['revoir', I.Revoir, 'À revoir', 'Ratées la dernière fois', etat.tags.bad_smiley, 'var(--revoir)'],
          ['edition', I.Crayon, 'Édition', 'Créer et modifier des tuiles', null, 'var(--laiton)']
        ].map(([cle, Icone, nom, desc, n, couleur]) => (
          <button key={cle} className="carte" onClick={() => aller(cle)}>
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span className="pastille" style={couleur ? { color: couleur } : undefined}>
                <Icone t={23} />
              </span>
              <span className="nombre">{n}</span>
            </span>
            <span>
              <div className="nom">{nom}</div>
              <div className="desc">{desc}</div>
            </span>
          </button>
        ))}
      </div>

      <div className="menu-actions">
        <button className="menu-lien" onClick={() => aller('options')}>
          <I.Rouage t={14} /> Options
        </button>
        <button className="menu-lien menu-quitter" onClick={onQuitter}>
          <I.Croix t={14} /> Quitter
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- jeu */

const MARQUES = [
  ['livre', I.Livre, 'livre'],
  ['etoile', I.Etoile, 'etoile'],
  ['bad_smiley', I.Revoir, 'revoir']
];

// Notation de révision espacée (FSRS).
const NOTES = [
  [1, 'Encore', 'encore'],
  [2, 'Difficile', 'difficile'],
  [3, 'Bien', 'bien'],
  [4, 'Facile', 'facile']
];

/** Intervalle en jours -> libellé court (« < 1 j », « 3 j », « 2 sem. », « 4 mois »). */
function fmtIntervalle(j) {
  if (j == null || j <= 0) return '< 1 j';
  if (j < 7) return j + ' j';
  if (j < 30) return Math.round(j / 7) + ' sem.';
  if (j < 365) return Math.round(j / 30) + ' mois';
  const a = j / 365;
  return (a < 2 ? a.toFixed(1) : Math.round(a)) + ' ans';
}

function Tuile({
  tuile, revele, sur, onReveler,
  onSuivante, onPrecedente, onMarquer, peutRevenir,
  apercu = false, onFermer, onChanger, revision = null
}) {
  // Vue plein cadre de l'image (85% de la fenetre) : locale, pas dans
  // l'historique de Jeu — changer de tuile referme toujours la vue.
  const [agrandie, setAgrandie] = useState(false);
  const [iImg, setIImg] = useState(0);
  useEffect(() => { setAgrandie(false); setIImg(0); }, [tuile && tuile.id]);
  useEffect(() => {
    if (!agrandie) return undefined;
    const clavier = (e) => { if (e.key === 'Escape') setAgrandie(false); };
    window.addEventListener('keydown', clavier);
    return () => window.removeEventListener('keydown', clavier);
  }, [agrandie]);

  const gabarit = useContext(GabaritContext);

  if (!tuile) return <div className="chargement">{apercu ? 'ouverture…' : 'tirage…'}</div>;
  const d = revele || tuile.champs;
  // En apercu tout est visible d'office. Sinon : un champ revele mais vide
  // reste revele — on suit l'etat, pas la verite de la valeur.
  const voit = (c) => apercu || !!revele || sur.has(c) || tuile.champs[c] != null;

  const champOcc = champOcclusion(gabarit);
  const valOcc = champOcc ? d[champOcc.cle] : null;
  const estOcc = !!(valOcc && valOcc.zones && valOcc.zones.length);

  const champImg = champImage(gabarit);
  // `revele` (jeu.completer) aplatit les champs mais force `image` a la 1re url
  // (vignette de carte) : la galerie complete reste dans `.champs`.
  const valImg = champImg
    ? ((revele && revele.champs && revele.champs[champImg.cle]) ?? d[champImg.cle])
    : null;
  const images = champImg && !estOcc ? listerImages(valImg, tuile.image_legende) : [];
  const iImgSur = Math.min(iImg, Math.max(0, images.length - 1));
  const imageZoom = estOcc ? (valOcc.image || null) : (images.length ? images[iImgSur].url : null);
  const reste = champsTries(gabarit).filter(
    (c) => (!champImg || c.cle !== champImg.cle) && (!champOcc || c.cle !== champOcc.cle)
  );
  const courts = reste.filter(estCourt);
  const autres = reste.filter((c) => !estCourt(c));   // texte_long, liste — pleine largeur, dans l'ordre

  return (
    <>
      {/* Tuile centrale + tuile suivante, meme rangee : meme taille, meme
          alignement haut/bas, un seul et meme intervalle entre elles. Le
          rail des marques est cale en haut a gauche de la tuile centrale. */}
      <div className="rangee-tuiles">
        <div className="rail">
          {MARQUES.map(([tag, Icone, classe]) => (
            <button
              key={tag}
              className={'marque ' + classe + (tuile.tagsUtilisateur.includes(tag) ? ' on' : '')}
              onClick={() => onMarquer(tag)}
              title={tag}
            >
              <Icone t={32} />
            </button>
          ))}
        </div>

        <div className="tuile">
          <div className="tete">
            <span className="numero">#{tuile.ref}</span>
            <span style={{ fontSize: 11.5, color: 'var(--discret)' }}>
              {apercu
                ? 'Tuile complète — rien n’est masqué'
                : 'Clic sur une zone masquée pour la révéler'}
            </span>
          </div>

          {/* Image a hauteur fluide (clamp) ; chaque champ garde une hauteur
              fixe (.valeur) donc reveler un champ ne deplace jamais les
              autres. Sur une fenetre courte, .corps defile plutot que de
              rogner les tags. */}
          <div className="corps">
            {estOcc ? (
              <ImageOcclusion
                val={valOcc}
                cachee={apercu ? null : tuile.occCachee}
                revele={!!revele}
                onReveler={() => onReveler(null)}
                onZoom={() => setAgrandie(true)}
              />
            ) : champImg && (voit(champImg.cle) && images.length
              // <img> est un element remplace : un flex-basis dessus n'est pas
              // fiable. Un cadre en div porte la hauteur ; l'image le remplit.
              ? <GalerieImage
                  images={images}
                  i={iImgSur}
                  onI={setIImg}
                  onZoom={() => setAgrandie(true)}
                />
              : <button className="masque image" onClick={() => onReveler(champImg.cle)}>
                  <I.OeilBarre t={26} /> image masquée
                </button>)}

            <div className="corps-reste">
              {courts.length > 0 && (
                <div className="grille2">
                  {courts.map((c) => (
                    <ChampBloc key={c.cle} champ={c} valeur={d[c.cle]} voit={voit} onReveler={onReveler} />
                  ))}
                </div>
              )}
              {autres.map((c) => (
                <ChampBloc key={c.cle} champ={c} valeur={d[c.cle]} voit={voit} onReveler={onReveler} />
              ))}
            </div>
          </div>
        </div>

        {!apercu && <div className="suivante" onClick={onSuivante} />}
      </div>

      {/* Sous la tuile, alignee sur elle (pas sur le rail) : actions. En
          apercu (tuile agrandie depuis une galerie) tout est deja visible :
          seul « Fermer ». */}
      <div className="ligne-actions">
        {apercu ? (
          <>
            <span className="compteur-sac">Aperçu — aucune donnée masquée</span>
            <div className="actions-droite">
              <button className="bouton-neutre" onClick={onFermer}>
                <I.Croix t={14} /> Fermer
              </button>
            </div>
          </>
        ) : revision ? (
          <>
            <div className="actions-gauche">
              <span className="revision-compteur">
                {revision.dus} due{revision.dus > 1 ? 's' : ''} · {revision.nouvelles} nouvelle{revision.nouvelles > 1 ? 's' : ''}
              </span>
            </div>
            <div className="actions-droite">
              {!revele ? (
                <button className="bouton-valide" onClick={() => onReveler(null)}>
                  <I.Coche /> Révéler <span className="raccourci">Espace</span>
                </button>
              ) : (
                <div className="notation">
                  {NOTES.map(([n, mot, classe]) => (
                    <button
                      key={n}
                      className={'note-btn ' + classe}
                      onClick={() => revision.onNoter(n)}
                    >
                      <span className="note-mot">{mot}</span>
                      <span className="note-intervalle">{fmtIntervalle(revision.apercu[n])}</span>
                      <span className="raccourci">{n}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="actions-gauche">
              {onChanger && (
                <button className="bouton-neutre" onClick={onChanger} title="Choisir un autre mode de tirage">
                  <I.Fleche t={16} retour /> Mode
                </button>
              )}
              <span className="compteur-sac">{tuile.restant} fiches restantes dans le sac</span>
            </div>
            <div className="actions-droite">
              <button
                className="bouton-neutre"
                onClick={onPrecedente}
                disabled={!peutRevenir}
                style={peutRevenir ? undefined : { opacity: 0.35, cursor: 'default' }}
                title="Tuile précédente (flèche gauche)"
              >
                <I.Fleche t={18} retour /> Précédente
              </button>
              <button className="bouton-valide" onClick={() => onReveler(null)}>
                <I.Coche /> Tout révéler
              </button>
              <button className="bouton-neutre" onClick={onSuivante}>
                Suivante <I.Fleche />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Reclic sur l'image (ou n'importe ou autour) pour refermer. */}
      {agrandie && imageZoom && (
        <div className="recouvrement-image" onClick={() => setAgrandie(false)}>
          <div className="cadre-image-agrandie">
            <img className="image-agrandie" src={imageZoom} alt="" />
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------ nouvelle partie */

// Ecran de choix du mode, avant le premier tirage. Aleatoire : toutes les
// oeuvres, tag de jeu toujours censure. Categorie : une ou plusieurs familles
// de tags (choix multiple), tag de jeu visible s'il est seul sur la tuile.
function NouvellePartie({ onLancer }) {
  const [mode, setMode] = useState('aleatoire');
  const [cats, setCats] = useState(null);
  const [choisies, setChoisies] = useState([]);   // valeurs de categorie
  const [q, setQ] = useState('');
  // Combinaison des catégories choisies :
  //   additif (défaut) : l'œuvre porte AU MOINS UNE des catégories
  //   soustractif      : l'œuvre porte TOUTES les catégories
  const [soustractif, setSoustractif] = useState(false);
  const [apercu, setApercu] = useState(null);     // { total, possibles }

  useEffect(() => { window.api.jeu.categories().then(setCats); }, []);

  // Aperçu du résultat (nb de tuiles, catégories encore ajoutables en
  // soustractif). Tout en mémoire côté main sur ~431 lignes → instantané.
  useEffect(() => {
    if (mode !== 'categorie') { setApercu(null); return undefined; }
    let vivant = true;
    const h = setTimeout(async () => {
      const r = await window.api.jeu.apercuCategories({ cats: choisies, soustractif });
      if (vivant) setApercu(r);
    }, 70);
    return () => { vivant = false; clearTimeout(h); };
  }, [mode, choisies, soustractif]);

  const filtrees = useMemo(() => {
    if (!cats) return [];
    const n = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!n) return cats;
    return cats.filter((c) => c.valeur.includes(n) || c.label.toLowerCase().includes(n));
  }, [cats, q]);

  const basculerCat = (v) => setChoisies((s) =>
    s.includes(v) ? s.filter((x) => x !== v) : [...s, v]);

  // En soustractif, une catégorie qui ferait tomber le résultat à 0 est
  // désactivée (sauf si déjà choisie — on peut toujours la retirer).
  const possibles = apercu && apercu.possibles ? new Set(apercu.possibles) : null;
  const bloquee = (v) => !!possibles && !choisies.includes(v) && !possibles.has(v);

  const total = apercu ? apercu.total : null;
  const peutLancer = mode === 'aleatoire'
    || (choisies.length > 0 && (total == null || total > 0));
  const lancer = () => {
    if (peutLancer) onLancer(mode === 'categorie' ? { cats: choisies, soustractif } : null);
  };

  return (
    <div className="nouvelle-partie">
      <div className="np-tete">
        <h2>Nouvelle partie</h2>
        <div className="soustitre">Choisir un mode de tirage, puis lancer.</div>
      </div>

      <div className="np-modes">
        <button
          className={'np-mode' + (mode === 'aleatoire' ? ' actif' : '')}
          onClick={() => setMode('aleatoire')}
        >
          <span className="np-radio" />
          <span>
            <div className="np-mode-nom">Aléatoire</div>
            <div className="np-mode-desc">
              Tirage dans toutes les œuvres, sac sans remise. Le tag de jeu est toujours censuré.
            </div>
          </span>
        </button>

        <button
          className={'np-mode' + (mode === 'categorie' ? ' actif' : '')}
          onClick={() => setMode('categorie')}
        >
          <span className="np-radio" />
          <span>
            <div className="np-mode-nom">Par catégorie</div>
            <div className="np-mode-desc">
              Tirage dans une ou plusieurs catégories. Le tag de jeu reste visible s’il est seul
              sur la tuile, censuré s’il en accompagne d’autres.
            </div>
          </span>
        </button>

        <button
          className={'np-lancer' + (peutLancer ? '' : ' off')}
          disabled={!peutLancer}
          onClick={lancer}
        >
          <span>Lancer <I.Fleche /></span>
          {mode === 'categorie' && (
            <span className="np-lancer-sub">
              {choisies.length === 0
                ? 'choisir au moins une catégorie'
                : total == null ? '…'
                : total === 0 ? 'aucune fiche — combinaison impossible'
                : total + (total > 1 ? ' tuiles' : ' tuile')}
            </span>
          )}
        </button>
      </div>

      {mode === 'categorie' && (
        <div className="np-cats">
          <div className="np-cats-barre">
            <input
              className="biblio-recherche"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filtrer les catégories…"
            />
            <button
              className={'np-combi ' + (soustractif ? 'soustr' : 'addit')}
              onClick={() => setSoustractif((s) => !s)}
              title={soustractif
                ? 'Soustractif : les fiches portant TOUTES les catégories choisies. Cliquer pour repasser en additif.'
                : 'Additif : les fiches portant AU MOINS UNE catégorie choisie. Cliquer pour passer en soustractif.'}
            >
              <span className="np-combi-signe">{soustractif ? '−' : '+'}</span>
              <span className="np-combi-mot">{soustractif ? 'toutes' : 'au moins une'}</span>
            </button>
          </div>
          {!cats ? (
            <div className="chargement">chargement…</div>
          ) : filtrees.length === 0 ? (
            <div className="galerie-vide">Aucune catégorie.</div>
          ) : (
            <div className="np-chips">
              {filtrees.map((c) => (
                <button
                  key={c.valeur}
                  className={'np-chip' + (choisies.includes(c.valeur) ? ' actif' : '')
                    + (bloquee(c.valeur) ? ' bloquee' : '')}
                  disabled={bloquee(c.valeur)}
                  onClick={() => basculerCat(c.valeur)}
                >
                  {c.label} <span className="np-chip-n">{c.n}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Choix du mode, puis la partie. La cle sur <Partie> force un etat neuf
// (sac, historique) a chaque changement de mode.
function Jeu({ onEtat }) {
  const [filtre, setFiltre] = useState(undefined);   // undefined = pas encore choisi

  // souris4 : revenir au choix du mode avant de quitter la page Jouer.
  const { setRetour } = useContext(NavContext);
  useEffect(() => {
    setRetour(filtre !== undefined ? () => { setFiltre(undefined); return true; } : null);
    return () => setRetour(null);
  }, [filtre]);

  if (filtre === undefined) return <NouvellePartie onLancer={setFiltre} />;
  return (
    <Partie
      key={JSON.stringify(filtre)}
      filtre={filtre}
      onChanger={() => setFiltre(undefined)}
      onEtat={onEtat}
    />
  );
}

function Partie({ filtre, onChanger, onEtat }) {
  const [tuile, setTuile] = useState(null);
  const [revele, setRevele] = useState(null);
  const [sur, setSur] = useState(new Set());
  // Pile des tuiles deja vues : revenir en arriere ne repioche pas dans le
  // sac, on restitue la tuile telle qu'elle etait, revelations comprises.
  const [historique, setHistorique] = useState([]);
  // Pile inverse : la ou "Precedente" depose la tuile quittee, pour que
  // "Suivante" la retrouve au lieu de retirer une tuile neuve du sac. Un
  // vrai nouveau tirage (pile vide) la laisse intacte a vide.
  const futurRef = useRef([]);

  const tirer = useCallback(async () => {
    setTuile((precedente) => {
      if (precedente) {
        setHistorique((h) => [...h, { tuile: precedente, revele, sur }].slice(-50));
      }
      return precedente;
    });

    if (futurRef.current.length) {
      const suivante = futurRef.current.pop();
      setRevele(suivante.revele);
      setSur(suivante.sur);
      setTuile(suivante.tuile);
    } else {
      const suivante = await window.api.jeu.tirer(filtre);
      setRevele(null);
      setSur(new Set());
      setTuile(suivante);
    }
  }, [revele, sur, filtre]);

  const precedente = useCallback(() => {
    setHistorique((h) => {
      if (!h.length) return h;
      const derniere = h[h.length - 1];
      setTuile((actuelle) => {
        futurRef.current.push({ tuile: actuelle, revele, sur });
        if (futurRef.current.length > 50) futurRef.current.shift();
        return derniere.tuile;
      });
      setRevele(derniere.revele);
      setSur(derniere.sur);
      return h.slice(0, -1);
    });
  }, [revele, sur]);

  useEffect(() => { window.api.jeu.tirer(filtre).then(setTuile); }, [filtre]);

  const reveler = async (champ) => {
    if (champ === null) {
      setRevele(await window.api.jeu.reveler(tuile.id));
    } else {
      setSur((s) => new Set(s).add(champ));
      const complet = await window.api.jeu.reveler(tuile.id);
      setTuile((t) => ({ ...t, champs: { ...t.champs, [champ]: complet[champ] } }));
    }
  };

  const marquer = async (tag) => {
    const r = await window.api.tags.basculer(tuile.id, tag);
    setTuile((t) => ({
      ...t,
      tagsUtilisateur: r.actif
        ? [...t.tagsUtilisateur, tag]
        : t.tagsUtilisateur.filter((x) => x !== tag)
    }));
    onEtat();
  };

  useEffect(() => {
    const clavier = (e) => {
      if (e.code === 'Space') { e.preventDefault(); reveler(null); }
      if (e.code === 'ArrowRight') tirer();
      if (e.code === 'ArrowLeft') precedente();
      if (e.key.toLowerCase() === 'l') marquer('livre');
      if (e.key.toLowerCase() === 'e') marquer('etoile');
      if (e.key.toLowerCase() === 's') marquer('bad_smiley');
    };
    window.addEventListener('keydown', clavier);
    return () => window.removeEventListener('keydown', clavier);
  });

  return (
    <div className="jeu">
      <Tuile
        tuile={tuile} revele={revele} sur={sur}
        onReveler={reveler} onSuivante={tirer} onPrecedente={precedente}
        onMarquer={marquer} peutRevenir={historique.length > 0}
        onChanger={onChanger}
      />
    </div>
  );
}

/* ------------------------------------------------------- revision espacee */

// Boucle de repetition espacee (FSRS). Sa propre boucle, sans historique
// arriere : une fiche notee est notee. Reutilise <Tuile> via la prop `revision`.
function PageRevision({ onEtat }) {
  const [tuile, setTuile] = useState(null);
  const [revele, setRevele] = useState(null);
  const [sur, setSur] = useState(new Set());
  const [fini, setFini] = useState(false);
  const [stats, setStats] = useState(null);

  const avancer = useCallback(async () => {
    const t = await window.api.revision.tirer();
    if (!t) {
      setTuile(null);
      setFini(true);
      setStats(await window.api.revision.stats());
      return;
    }
    setRevele(null);
    setSur(new Set());
    setFini(false);
    setTuile(t);
  }, []);

  useEffect(() => {
    (async () => { await window.api.revision.file(); await avancer(); })();
  }, [avancer]);

  const reveler = async (champ) => {
    if (champ === null) {
      setRevele(await window.api.jeu.reveler(tuile.id));
    } else {
      setSur((s) => new Set(s).add(champ));
      const complet = await window.api.jeu.reveler(tuile.id);
      setTuile((t) => ({ ...t, champs: { ...t.champs, [champ]: complet[champ] } }));
    }
  };

  const noter = async (n) => {
    if (!tuile || !revele) return;
    await window.api.revision.noter(tuile.id, n);
    onEtat();
    await avancer();
  };

  const marquer = async (tag) => {
    if (!tuile) return;
    const r = await window.api.tags.basculer(tuile.id, tag);
    setTuile((t) => ({
      ...t,
      tagsUtilisateur: r.actif
        ? [...t.tagsUtilisateur, tag]
        : t.tagsUtilisateur.filter((x) => x !== tag)
    }));
    onEtat();
  };

  useEffect(() => {
    const clavier = (e) => {
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); if (!revele) reveler(null); }
      else if (revele && '1234'.includes(e.key)) noter(parseInt(e.key, 10));
      else if (e.key.toLowerCase() === 'l') marquer('livre');
      else if (e.key.toLowerCase() === 'e') marquer('etoile');
      else if (e.key.toLowerCase() === 's') marquer('bad_smiley');
    };
    window.addEventListener('keydown', clavier);
    return () => window.removeEventListener('keydown', clavier);
  });

  if (fini) return <RevisionFinie stats={stats} onRelancer={async () => { await window.api.revision.file(); avancer(); }} />;
  if (!tuile) return <div className="chargement">chargement…</div>;

  return (
    <div className="jeu">
      <Tuile
        tuile={tuile} revele={revele} sur={sur}
        onReveler={reveler} onMarquer={marquer}
        onSuivante={() => {}} onPrecedente={() => {}} peutRevenir={false}
        revision={{
          onNoter: noter,
          apercu: tuile.apercu || { 1: 0, 2: 1, 3: 3, 4: 15 },
          dus: tuile.dusRestants || 0,
          nouvelles: tuile.nouvellesRestantes || 0
        }}
      />
    </div>
  );
}

function RevisionFinie({ stats, onRelancer }) {
  const s = stats || {};
  const ech = s.echeances || [];
  const maxN = Math.max(1, ...ech.map((e) => e.n));
  return (
    <div className="revision-vide">
      <div className="revision-vide-tete">
        <I.Boucle t={34} />
        <h2>Révision terminée</h2>
        <p>
          {s.revuesAujourdhui
            ? `${s.revuesAujourdhui} fiche${s.revuesAujourdhui > 1 ? 's' : ''} revue${s.revuesAujourdhui > 1 ? 's' : ''} aujourd’hui`
            : 'Rien à réviser pour le moment'}
          {s.retention30j != null && ` · rétention 30 j : ${Math.round(s.retention30j * 100)} %`}
        </p>
      </div>
      {ech.length > 0 && (
        <div className="echeances">
          <div className="echeances-titre">Prochaines échéances</div>
          <div className="echeances-barres">
            {ech.map((e) => (
              <div key={e.jour} className="echeance" title={`J+${e.jour} : ${e.n}`}>
                <div className="echeance-barre" style={{ height: Math.round((e.n / maxN) * 46) + 2 }} />
                <div className="echeance-jour">{e.jour === 0 ? 'auj.' : 'J' + e.jour}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <button className="bouton-neutre" onClick={onRelancer}><I.Rafraichir t={15} /> Vérifier à nouveau</button>
    </div>
  );
}

/* ---------------------------------------------------------------- coquille */

function Barre({ page, aller, etat, repliee, basculer, onQuitter }) {
  const rev = etat.revision || { dus: 0, nouvelles: 0 };
  const items = [
    ['menu', I.Maison, 'Accueil', null],
    ['revision', I.Boucle, 'Révision', (rev.dus + rev.nouvelles) || null],
    ['jeu', I.Manette, 'Jouer', null],
    ['bibliotheque', I.Bibliotheque, 'Bibliothèque', etat.fiches],
    ['livre', I.Livre, 'Livre', etat.tags.livre],
    ['etoile', I.Etoile, 'Étoile', etat.tags.etoile],
    ['revoir', I.Revoir, 'À revoir', etat.tags.bad_smiley],
    ['edition', I.Crayon, 'Édition', null],
    ['decks', I.Grille, 'Decks', (etat.decks || []).length || null]
  ];
  return (
    <aside className={'barre' + (repliee ? ' repliee' : '')}>
      <button className="entree" onClick={basculer}>
        <I.Hamburger />
        {!repliee && <span className="libelle" style={{ fontFamily: 'var(--serif)', fontSize: 16 }}>Bristol</span>}
      </button>
      {items.map(([cle, Icone, nom, n]) => (
        <button key={cle} className={'entree' + (page === cle ? ' active' : '')} onClick={() => aller(cle)}>
          <Icone />
          <span className="libelle">{nom}</span>
          {n != null && <span className="compte">{n}</span>}
        </button>
      ))}
      <span style={{ flexGrow: 1 }} />
      <button className="entree" onClick={() => aller('options')}><I.Rouage /><span className="libelle">Options</span></button>
      <button className="entree" onClick={onQuitter} style={{ color: 'var(--revoir)' }}>
        <I.Croix /><span className="libelle">Quitter</span>
      </button>
    </aside>
  );
}

function EnChantier({ nom }) {
  return <div className="chargement">{nom} — à construire</div>;
}

/* ----------------------------------------------- apercu (tuile agrandie) */

// Ordre d'affichage des pastilles de tag sur une carte : livre, etoile,
// a-revoir — le meme que le rail du jeu.
const PIPS = [
  ['livre', 'var(--livre)'],
  ['etoile', 'var(--etoile)'],
  ['bad_smiley', 'var(--revoir)']
];

// Carte commune a la Bibliotheque et aux galeries. Clic n'importe ou =
// agrandir ; la croix (galeries seulement) retire le tag sans agrandir.
function CarteTuile({ o, onOuvrir, onRetirer, nomRetirer }) {
  const gabarit = useContext(GabaritContext);
  const cTitre = champRole(gabarit, 'titre');
  const cSous = champRole(gabarit, 'sous_titre');
  const titre = cTitre ? o[cTitre.cle] : null;
  const sousTitre = cSous ? o[cSous.cle] : null;
  return (
    <div className="carte-galerie" onClick={onOuvrir}>
      {onRetirer && (
        <button
          className="carte-galerie-retirer"
          onClick={(e) => { e.stopPropagation(); onRetirer(); }}
          title={nomRetirer}
        >
          <I.Croix t={12} />
        </button>
      )}
      {o.image
        ? <img className="carte-galerie-image" src={o.image} alt="" loading="lazy" />
        : <div className="carte-galerie-image carte-galerie-image-vide" />}
      <div className="carte-galerie-corps">
        <span className="numero">#{o.ref}{o.imageSrc === 'ebook' ? ' · perso' : ''}</span>
        <div className="carte-galerie-titre">{titre || '—'}</div>
        <div className="carte-galerie-artiste">{sousTitre || '—'}</div>
      </div>
      {o.tagsUtilisateur && o.tagsUtilisateur.length > 0 && (
        <div className="carte-galerie-pips">
          {PIPS.filter(([t]) => o.tagsUtilisateur.includes(t))
            .map(([t, c]) => <span key={t} className="pip" style={{ background: c }} />)}
        </div>
      )}
    </div>
  );
}

// Recouvrement plein ecran : la tuile agrandie a la taille exacte du jeu,
// mais TOUT visible (rien de masque). Les sections qu'un tirage cacherait
// sont soulignees en pointilles dore. Marquer y fonctionne partout —
// Bibliotheque, Livre, Étoile, À revoir.
const SUR_VIDE = new Set();

function RecouvrementApercu({ id, onFermer, onEtat }) {
  const [tuile, setTuile] = useState(null);

  useEffect(() => {
    setTuile(null);
    window.api.jeu.apercu(id).then(setTuile);
  }, [id]);

  const marquer = async (tag) => {
    const r = await window.api.tags.basculer(id, tag);
    setTuile((t) => ({
      ...t,
      tagsUtilisateur: r.actif
        ? [...t.tagsUtilisateur, tag]
        : t.tagsUtilisateur.filter((x) => x !== tag)
    }));
    if (onEtat) onEtat();
  };

  useEffect(() => {
    const clavier = (e) => {
      if (e.key === 'Escape') {
        // Une vue image plein cadre est ouverte par-dessus : la laisser se
        // fermer d'abord, ne pas refermer tout l'apercu du meme coup.
        if (document.querySelector('.recouvrement-image')) return;
        onFermer();
        return;
      }
      if (!tuile) return;
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key.toLowerCase() === 'l') marquer('livre');
      if (e.key.toLowerCase() === 'e') marquer('etoile');
      if (e.key.toLowerCase() === 's') marquer('bad_smiley');
    };
    window.addEventListener('keydown', clavier);
    return () => window.removeEventListener('keydown', clavier);
  });

  return (
    <div className="recouvrement-apercu" onClick={onFermer}>
      <div className="jeu apercu-jeu" onClick={(e) => e.stopPropagation()}>
        <Tuile
          tuile={tuile} revele={null} sur={SUR_VIDE}
          onReveler={() => {}} onMarquer={marquer}
          apercu onFermer={onFermer}
          onSuivante={() => {}} onPrecedente={() => {}} peutRevenir={false}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------- barre de filtres commune */

const TRI_LABEL = { ajout: 'Ordre d’ajout', numero: 'Numéro' };

// Trie une liste de tuiles. En 'ajout', la liste arrive deja triee par
// cree_le (cote base) : on ne fait qu'appliquer le sens.
function trier(tuiles, tri, sens) {
  const t = tuiles.slice();
  if (tri === 'numero') {
    t.sort((a, b) => String(a.ref).localeCompare(String(b.ref), undefined, { numeric: true }));
  }
  if (sens === 'desc') t.reverse();
  return t;
}

// Selecteur de tags (Bibliotheque) : a droite du champ de recherche. Un
// bouton ouvre un panneau de chips ; le +/− choisit additif (au moins un tag)
// ou soustractif (tous les tags). L'etat vit chez le parent.
function SelecteurTags({ choisies, onChoisies, soustractif, onSoustractif }) {
  const [ouvert, setOuvert] = useState(false);
  const [cats, setCats] = useState(null);
  const [q, setQ] = useState('');
  const enveloppe = useRef(null);

  useEffect(() => { if (ouvert && !cats) window.api.jeu.categories().then(setCats); }, [ouvert, cats]);
  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e) => { if (enveloppe.current && !enveloppe.current.contains(e.target)) setOuvert(false); };
    const echap = (e) => { if (e.key === 'Escape') setOuvert(false); };
    document.addEventListener('mousedown', dehors);
    window.addEventListener('keydown', echap);
    return () => { document.removeEventListener('mousedown', dehors); window.removeEventListener('keydown', echap); };
  }, [ouvert]);

  const filtrees = useMemo(() => {
    if (!cats) return [];
    const n = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return n ? cats.filter((c) => c.valeur.includes(n) || c.label.toLowerCase().includes(n)) : cats;
  }, [cats, q]);

  const basculer = (v) => onChoisies(
    choisies.includes(v) ? choisies.filter((x) => x !== v) : [...choisies, v]
  );

  return (
    <div className="sel-tags" ref={enveloppe}>
      <button
        className={'tri-bouton' + (choisies.length ? ' actif' : '')}
        onClick={() => setOuvert((o) => !o)}
        title="Filtrer par tags"
      >
        <I.Etiquette t={14} /> Tags{choisies.length ? ' · ' + choisies.length : ''}
      </button>
      <button
        className={'np-combi sel-tags-combi ' + (soustractif ? 'soustr' : 'addit')}
        onClick={() => onSoustractif(!soustractif)}
        title={soustractif
          ? 'Soustractif : les fiches portant TOUS les tags choisis. Cliquer pour repasser en additif.'
          : 'Additif : les fiches portant AU MOINS UN tag choisi. Cliquer pour passer en soustractif.'}
      >
        <span className="np-combi-signe">{soustractif ? '−' : '+'}</span>
      </button>

      {ouvert && (
        <div className="sel-tags-pop">
          <div className="sel-tags-haut">
            <input
              className="biblio-recherche"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filtrer les tags…"
              autoFocus
            />
            {choisies.length > 0 && (
              <button className="tri-bouton" onClick={() => onChoisies([])}>Tout retirer</button>
            )}
          </div>
          {!cats ? (
            <div className="chargement">chargement…</div>
          ) : filtrees.length === 0 ? (
            <div className="galerie-vide">Aucun tag.</div>
          ) : (
            <div className="sel-tags-liste">
              {filtrees.map((c) => (
                <button
                  key={c.valeur}
                  className={'np-chip' + (choisies.includes(c.valeur) ? ' actif' : '')}
                  onClick={() => basculer(c.valeur)}
                >
                  {c.label} <span className="np-chip-n">{c.n}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Bascule de tri (un seul bouton), sens (fleche verticale haut/bas) et champ
// de recherche permissif — identiques sur Bibliotheque, Livre, Étoile, À
// revoir. `triModes` : ['ajout','numero'] pour les galeries de tag,
// ['numero'] seul pour la Bibliotheque (pas de date d'ajout). `tags`
// (optionnel) : { choisies, onChoisies, soustractif, onSoustractif } ->
// affiche le selecteur de tags a droite de la recherche (Bibliotheque).
function BarreFiltres({ triModes, tri, onTri, sens, onSens, q, onQ, tags }) {
  const multi = triModes.length > 1;
  const { colonnes, cycler } = useContext(GrilleContext);
  return (
    <div className="galerie-tri">
      <button
        className="tri-bouton"
        onClick={multi ? () => onTri(triModes[(triModes.indexOf(tri) + 1) % triModes.length]) : undefined}
        style={multi ? undefined : { cursor: 'default' }}
        title={multi ? 'Basculer le tri' : undefined}
      >
        {multi && <I.Echange t={14} />}
        {TRI_LABEL[tri]}
      </button>
      <button
        className="tri-bouton tri-sens"
        onClick={() => onSens(sens === 'asc' ? 'desc' : 'asc')}
        title={sens === 'asc' ? 'Ordre croissant — cliquer pour inverser' : 'Ordre décroissant — cliquer pour inverser'}
      >
        <I.FlecheVert t={16} bas={sens === 'desc'} />
      </button>
      <button
        className="tri-bouton tri-cols"
        onClick={cycler}
        title="Nombre de tuiles par ligne"
      >
        <I.Grille t={14} /> {colonnes}/ligne
      </button>
      <input
        className="biblio-recherche"
        type="text"
        value={q}
        onChange={(e) => onQ(e.target.value)}
        placeholder="Rechercher : titre, artiste, lieu, description, tags, numéro…"
      />
      {tags && <SelecteurTags {...tags} />}
    </div>
  );
}

/* ------------------------------------------------------- galeries (tags) */

// Un seul gabarit pour Livre / Étoile / À revoir : seuls le tag interroge et
// la couleur d'accent changent d'une page a l'autre.
function Galerie({ nom, tag, couleur, Icone, description, onEtat }) {
  const [brut, setBrut] = useState(null);
  const [tri, setTri] = useState('ajout');
  const [sens, setSens] = useState('asc');
  const [q, setQ] = useState('');
  const [apercuId, setApercuId] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => { setBrut(null); }, [tag]);
  useEffect(() => {
    let vivant = true;
    const h = setTimeout(async () => {
      const r = await window.api.fiches.parTag(tag, q.trim() || undefined);
      if (vivant) setBrut(r);
    }, 120);
    return () => { vivant = false; clearTimeout(h); };
  }, [tag, q, nonce]);

  const retirer = async (id) => {
    await window.api.tags.basculer(id, tag);
    setNonce((n) => n + 1);
    if (onEtat) onEtat();
  };
  const fermerApercu = () => { setApercuId(null); setNonce((n) => n + 1); };

  // souris4 : refermer l'aperçu avant de quitter la page.
  const { setRetour } = useContext(NavContext);
  useEffect(() => {
    setRetour(apercuId ? () => { fermerApercu(); return true; } : null);
    return () => setRetour(null);
  }, [apercuId]);

  const ordonnees = useMemo(() => (brut ? trier(brut, tri, sens) : null), [brut, tri, sens]);
  const filtre = q.trim().length > 0;

  return (
    <div className="galerie" style={{ '--accent': couleur }}>
      <div className="galerie-tete">
        <span className="galerie-icone"><Icone t={22} /></span>
        <div>
          <h2>{nom}</h2>
          <div className="soustitre">{description}</div>
        </div>
        <span className="galerie-compte">{brut ? brut.length : '…'}</span>
      </div>

      <BarreFiltres
        triModes={['ajout', 'numero']}
        tri={tri} onTri={setTri}
        sens={sens} onSens={setSens}
        q={q} onQ={setQ}
      />

      {!ordonnees ? (
        <div className="chargement">chargement…</div>
      ) : ordonnees.length === 0 ? (
        <div className="galerie-vide">
          {filtre ? 'Aucun résultat.' : `Aucune fiche marquée ${nom.toLowerCase()} pour l'instant.`}
        </div>
      ) : (
        <div className="galerie-grille">
          {ordonnees.map((o) => (
            <CarteTuile
              key={o.id}
              o={o}
              onOuvrir={() => setApercuId(o.id)}
              onRetirer={() => retirer(o.id)}
              nomRetirer={'Retirer de ' + nom}
            />
          ))}
        </div>
      )}

      {apercuId && (
        <RecouvrementApercu id={apercuId} onFermer={fermerApercu} onEtat={onEtat} />
      )}
    </div>
  );
}

function PageLivre({ onEtat }) {
  return <Galerie nom="Livre" tag="livre" couleur="var(--livre)" Icone={I.Livre}
    description="Tuiles à approfondir" onEtat={onEtat} />;
}
function PageEtoile({ onEtat }) {
  return <Galerie nom="Étoile" tag="etoile" couleur="var(--etoile)" Icone={I.Etoile}
    description="Tuiles favorites" onEtat={onEtat} />;
}
function PageRevoir({ onEtat }) {
  return <Galerie nom="À revoir" tag="bad_smiley" couleur="var(--revoir)" Icone={I.Revoir}
    description="Ratées la dernière fois" onEtat={onEtat} />;
}

/* ----------------------------------------------------------- bibliotheque */

// Toutes les fiches du corpus. Le filtre passe par la recherche permissive
// de la base (accents / casse / ponctuation ignores des deux cotes, chaque
// mot devant apparaitre quelque part hors image). Clic = agrandir, avec le
// rail de marquage comme partout.
function PageBibliotheque({ onEtat, onChoisirTuile }) {
  const [q, setQ] = useState('');
  const [sens, setSens] = useState('asc');
  const [catsFiltre, setCatsFiltre] = useState([]);       // tags selectionnes
  const [soustractif, setSoustractif] = useState(false);
  const [resultats, setResultats] = useState(null);
  const [total, setTotal] = useState(null);
  const [apercuId, setApercuId] = useState(null);
  const [nonce, setNonce] = useState(0);
  const choix = !!onChoisirTuile;

  useEffect(() => {
    let vivant = true;
    const t = setTimeout(async () => {
      const criteres = {};
      if (q.trim()) criteres.texte = q;
      if (catsFiltre.length) { criteres.categories = catsFiltre; criteres.soustractif = soustractif; }
      const actif = Object.keys(criteres).length > 0;
      const r = await window.api.fiches.toutes(actif ? criteres : undefined);
      if (!vivant) return;
      setResultats(r);
      if (!actif) setTotal(r.length);
    }, 120);
    return () => { vivant = false; clearTimeout(t); };
  }, [q, catsFiltre, soustractif, nonce]);

  const fermerApercu = () => { setApercuId(null); setNonce((n) => n + 1); };

  // souris4 : refermer l'aperçu d'abord (sauf en mode choix, géré par PageEdition).
  const { setRetour } = useContext(NavContext);
  useEffect(() => {
    if (choix) return undefined;
    setRetour(apercuId ? () => { fermerApercu(); return true; } : null);
    return () => setRetour(null);
  }, [apercuId, choix]);

  const filtre = q.trim().length > 0 || catsFiltre.length > 0;
  const affichees = useMemo(
    () => (resultats ? trier(resultats, 'numero', sens) : null),
    [resultats, sens]
  );

  return (
    <div className="galerie" style={{ '--accent': 'var(--laiton)' }}>
      <div className="galerie-tete">
        <span className="galerie-icone"><I.Bibliotheque t={22} /></span>
        <div>
          <h2>{choix ? 'Choisir une fiche' : 'Bibliothèque'}</h2>
          <div className="soustitre">{choix ? 'Clic pour la modifier ou la supprimer' : 'Toutes les fiches'}</div>
        </div>
        <span className="galerie-compte">
          {affichees ? affichees.length : '…'}
          {filtre && total != null ? ' / ' + total : ''}
        </span>
      </div>

      <BarreFiltres
        triModes={['numero']}
        tri="numero" onTri={() => {}}
        sens={sens} onSens={setSens}
        q={q} onQ={setQ}
        tags={{
          choisies: catsFiltre, onChoisies: setCatsFiltre,
          soustractif, onSoustractif: setSoustractif
        }}
      />

      {!affichees ? (
        <div className="chargement">chargement…</div>
      ) : affichees.length === 0 ? (
        <div className="galerie-vide">Aucune fiche ne correspond.</div>
      ) : (
        <div className="galerie-grille">
          {affichees.map((o) => (
            <CarteTuile key={o.id} o={o}
              onOuvrir={choix ? () => onChoisirTuile(o) : () => setApercuId(o.id)} />
          ))}
        </div>
      )}

      {!choix && apercuId && (
        <RecouvrementApercu id={apercuId} onFermer={fermerApercu} onEtat={onEtat} />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- edition */

// Un champ texte de l'editeur, dans la meme case (.valeur) qu'en affichage.
function ChampEdit({ etiquette, v, onChange, placeholder, serif, mono, grand }) {
  return (
    <div className="champ">
      <div className="etiquette">{etiquette}</div>
      <div className={'valeur' + (grand ? ' valeur-titre' : '')}>
        <input
          className={'editeur-input' + (serif ? ' e-serif' : '') + (mono ? ' e-mono' : '')}
          value={v}
          onChange={onChange}
          placeholder={placeholder}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// Meme gabarit qu'une tuile affichee, tous les champs editables et vides.
// L'ID/ref est attribue a l'enregistrement. Image : S4.
function pesee(o) {
  const ko = Math.round(o / 1024);
  return ko >= 1024 ? (ko / 1024).toFixed(1) + ' Mo' : ko + ' Ko';
}

function memeChamps(a, b, cles) {
  return cles.every((c) => (a[c] || '') === (b[c] || ''));
}

// Cextrait une URL d'image d'un depot venant d'une page web.
function urlDepuisDrop(dt) {
  const uri = dt.getData('text/uri-list');
  if (uri) { const l = uri.split(/\r?\n/).find((x) => x && !x.startsWith('#')); if (l) return l.trim(); }
  const html = dt.getData('text/html');
  const m = html && html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
  if (m) return m[1];
  const txt = dt.getData('text/plain');
  if (txt && /^https?:\/\//i.test(txt.trim())) return txt.trim();
  return null;
}

// Meme gabarit qu'une tuile affichee, champs editables.
//   mode 'creer'    : champs vides, bouton « Valider la création »
//   mode 'modifier' : champs pre-remplis, « Valider les changements » (grise
//                     tant que rien n'a change), + « Supprimer la fiche »
// Editeur graphique des zones d'occlusion : dessin a la souris sur l'image,
// libelle par zone. `value` = chaine JSON { image, zones:[{x,y,w,h,texte}] }.
function EditeurOcclusion({ value, onChange }) {
  const parse = (s) => {
    try { const o = typeof s === 'string' ? JSON.parse(s) : s; return o && typeof o === 'object' ? o : {}; }
    catch (_) { return {}; }
  };
  const init = parse(value);
  const [image, setImage] = useState(init.image || '');
  const [zones, setZones] = useState(Array.isArray(init.zones) ? init.zones : []);
  const [sel, setSel] = useState(null);
  const [trace, setTrace] = useState(null);   // rectangle en cours { x0,y0,x,y }
  const imgRef = useRef(null);

  const pousser = (img, zs) => onChange(JSON.stringify({ image: img, zones: zs }));

  const choisirImg = async () => {
    const r = await window.api.edition.choisirImage();
    if (r && r.nom) { setImage(r.nom); pousser(r.nom, zones); }
  };

  const rel = (e) => {
    const r = imgRef.current.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1)
    };
  };
  const onDown = (e) => {
    if (!image || e.button !== 0) return;
    const p = rel(e);
    setTrace({ x0: p.x, y0: p.y, x: p.x, y: p.y });
    setSel(null);
  };
  const onMove = (e) => { if (trace) { const p = rel(e); setTrace((t) => ({ ...t, x: p.x, y: p.y })); } };
  const onUp = () => {
    if (!trace) return;
    const z = {
      x: Math.min(trace.x0, trace.x), y: Math.min(trace.y0, trace.y),
      w: Math.abs(trace.x - trace.x0), h: Math.abs(trace.y - trace.y0)
    };
    setTrace(null);
    if (z.w < 0.02 || z.h < 0.02) return;
    const t = window.prompt('Libellé de la zone :', '');
    if (t == null) return;
    const zs = [...zones, { ...z, texte: t.trim() }];
    setZones(zs); pousser(image, zs); setSel(zs.length - 1);
  };
  const majTexte = (i, t) => {
    const zs = zones.map((z, k) => (k === i ? { ...z, texte: t } : z));
    setZones(zs); pousser(image, zs);
  };
  const suppr = (i) => {
    const zs = zones.filter((_, k) => k !== i);
    setZones(zs); pousser(image, zs); setSel(null);
  };

  return (
    <div className="occ-editeur">
      <div className="occ-editeur-toile" onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
        {image ? (
          <>
            <img ref={imgRef} src={'fiche://' + image} alt="" draggable={false} />
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="occ-editeur-svg">
              {zones.map((z, i) => (
                <rect key={i} x={z.x * 1000} y={z.y * 1000} width={z.w * 1000} height={z.h * 1000}
                      rx="4" className={'occ-edit-zone' + (i === sel ? ' sel' : '')}
                      onMouseDown={(e) => { e.stopPropagation(); setSel(i); }} />
              ))}
              {trace && (
                <rect className="occ-edit-trace"
                      x={Math.min(trace.x0, trace.x) * 1000} y={Math.min(trace.y0, trace.y) * 1000}
                      width={Math.abs(trace.x - trace.x0) * 1000} height={Math.abs(trace.y - trace.y0) * 1000} />
              )}
            </svg>
          </>
        ) : (
          <button className="bouton-neutre" onClick={choisirImg}><I.OeilBarre t={16} /> Choisir le schéma</button>
        )}
      </div>
      {image && (
        <div className="occ-editeur-liste">
          <div className="options-note">Glisser sur l’image pour tracer une zone. {zones.length} zone{zones.length > 1 ? 's' : ''}.</div>
          {zones.map((z, i) => (
            <div key={i} className={'occ-editeur-ligne' + (i === sel ? ' sel' : '')} onMouseEnter={() => setSel(i)}>
              <input value={z.texte} onChange={(e) => majTexte(i, e.target.value)} placeholder="libellé" />
              <button className="occ-editeur-x" onClick={() => suppr(i)} title="Supprimer"><I.Croix t={12} /></button>
            </div>
          ))}
          <button className="bouton-neutre" onClick={choisirImg} style={{ marginTop: 6 }}>
            <I.Rafraichir t={13} /> Changer de schéma
          </button>
        </div>
      )}
    </div>
  );
}

function EditeurTuile({ mode, tuile, onFini, onAnnuler, onSupprimer }) {
  const gabarit = useContext(GabaritContext);
  const cOcc = champOcclusion(gabarit);
  const champsDef = champsTries(gabarit).filter((c) => !estImage(c) && (!cOcc || c.cle !== cOcc.cle));
  const cTitre = champRole(gabarit, 'titre');
  const cles = [...champsDef.map((c) => c.cle), 'image', ...(cOcc ? [cOcc.cle] : [])];

  const vides = Object.fromEntries(cles.map((c) => [c, '']));
  const initial = mode === 'modifier'
    ? {
        ...Object.fromEntries(champsDef.map((c) => [
          c.cle, (tuile.valeurs && tuile.valeurs[c.cle]) || ''
        ])),
        image: tuile.image || '',
        ...(cOcc ? { [cOcc.cle]: (tuile.valeurs && tuile.valeurs[cOcc.cle]) || '' } : {})
      }
    : vides;
  const imageInitiale = initial.image || '';

  const [champs, setChamps] = useState(initial);
  const [imgInfo, setImgInfo] = useState(null);
  const [imgErreur, setImgErreur] = useState(null);
  const [imgEnCours, setImgEnCours] = useState(false);
  const [survol, setSurvol] = useState(false);
  const [enCours, setEnCours] = useState(false);

  const set = (c) => (e) => setChamps((x) => ({ ...x, [c]: e.target.value }));

  const dirty = !memeChamps(champs, initial, cles);
  const peutValider = mode === 'modifier'
    ? dirty
    : ((cTitre && (champs[cTitre.cle] || '').trim().length > 0) || (champs.image || '').trim().length > 0);

  // Ne « oublie » que les images importees pendant cette session.
  const purge = (nom) => { if (nom && nom !== imageInitiale) window.api.edition.oublierImage(nom); };

  const poser = (info) => {
    setImgErreur(null);
    if (!info) return;
    if (info.erreur) { setImgErreur(info.erreur); return; }
    purge(champs.image);
    setChamps((x) => ({ ...x, image: info.nom }));
    setImgInfo(info);
  };
  const retirerImage = () => {
    purge(champs.image);
    setChamps((x) => ({ ...x, image: '' }));
    setImgInfo(null);
  };

  const choisir = async () => {
    if (imgEnCours || champs.image) return;
    setImgEnCours(true);
    try { poser(await window.api.edition.choisirImage()); } finally { setImgEnCours(false); }
  };
  const deposer = async (e) => {
    e.preventDefault();
    setSurvol(false);
    if (imgEnCours) return;
    const f = [...(e.dataTransfer.files || [])].find((x) => x.type.startsWith('image/'));
    const url = f ? null : urlDepuisDrop(e.dataTransfer);
    if (!f && !url) { setImgErreur('Dépôt non reconnu — glisse un fichier ou une image d’une page web.'); return; }
    setImgEnCours(true);
    try {
      poser(f
        ? await window.api.edition.importerImage(await f.arrayBuffer())
        : await window.api.edition.importerImageUrl(url));
    } finally { setImgEnCours(false); }
  };

  const annuler = () => { purge(champs.image); onAnnuler(); };
  const valider = async () => {
    if (!peutValider || enCours) return;
    setEnCours(true);
    try {
      onFini(mode === 'modifier'
        ? await window.api.edition.modifier(tuile.id, champs)
        : await window.api.edition.creer(champs));
    } catch (e) {
      setEnCours(false);
    }
  };

  const teteInfo = mode === 'modifier'
    ? (tuile.estLocale ? 'tuile locale' : 'œuvre du pack — tes corrections priment, réversibles')
    : 'champs libres — le numéro est attribué à l’enregistrement';

  return (
    <div className="jeu apercu-jeu editeur-jeu">
      <div className="rangee-tuiles">
        <div className="tuile">
          <div className="tete">
            <span className="numero">{mode === 'modifier' ? '#' + tuile.ref : 'nouvelle tuile'}</span>
            <span style={{ fontSize: 11.5, color: 'var(--discret)' }}>{teteInfo}</span>
          </div>

          <div className="corps">
            <div
              className={'cadre-image editeur-image' + (survol ? ' survol' : '')}
              onClick={choisir}
              onDragOver={(e) => { e.preventDefault(); setSurvol(true); }}
              onDragLeave={() => setSurvol(false)}
              onDrop={deposer}
            >
              {champs.image ? (
                <>
                  <img className="visuel" src={'fiche://' + champs.image} alt="" />
                  <button className="editeur-image-x" onClick={retirerImage} title="Retirer l’image">
                    <I.Croix t={13} />
                  </button>
                  {imgInfo && (
                    <span className="editeur-image-info">
                      {imgInfo.largeur}×{imgInfo.hauteur} · {pesee(imgInfo.octets)}
                      {imgInfo.redimensionnee ? ' · redimensionnée' : ''}
                    </span>
                  )}
                </>
              ) : (
                <div className="editeur-image-vide">
                  <I.OeilBarre t={24} />
                  <span>{imgEnCours ? 'import…' : 'Glisser une image ici ou cliquer'}</span>
                  <span style={{ textTransform: 'none', letterSpacing: 0, opacity: 0.7 }}>
                    {imgErreur || 'fichier ou image d’une page web · redimensionnée ≤ 500 Ko'}
                  </span>
                </div>
              )}
            </div>

            {cOcc && (
              <div className="champ champ-description">
                <div className="etiquette">{cOcc.libelle}</div>
                <EditeurOcclusion
                  value={champs[cOcc.cle]}
                  onChange={(json) => setChamps((x) => ({ ...x, [cOcc.cle]: json }))}
                />
              </div>
            )}

            <div className="corps-reste">
              <div className="grille2">
                {champsDef.filter(estCourt).map((c) => (
                  <ChampEdit
                    key={c.cle}
                    etiquette={c.libelle}
                    v={champs[c.cle]}
                    onChange={set(c.cle)}
                    serif={c.role === 'titre'}
                    grand={c.role === 'titre'}
                    mono={c.type === 'date' || c.type === 'nombre'}
                    placeholder={c.toujours_cache ? 'masquée au tirage' : undefined}
                  />
                ))}
              </div>

              {champsDef.filter((c) => !estCourt(c)).map((c) => (
                estLong(c) ? (
                  <div key={c.cle} className="champ champ-description">
                    <div className="etiquette">{c.libelle}</div>
                    <textarea
                      className="editeur-textarea"
                      value={champs[c.cle]}
                      onChange={set(c.cle)}
                      spellCheck={false}
                    />
                  </div>
                ) : (
                  <ChampEdit
                    key={c.cle}
                    etiquette={c.libelle}
                    v={champs[c.cle]}
                    onChange={set(c.cle)}
                    placeholder={c.type === 'liste' ? 'séparés par des virgules' : undefined}
                  />
                )
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="ligne-actions">
        <div className="actions-gauche">
          {mode === 'modifier' && (
            <button className="bouton-danger" onClick={() => onSupprimer(tuile)}>
              <I.Croix t={14} /> Supprimer la fiche
            </button>
          )}
          <span className="compteur-sac">
            {mode === 'modifier' && !tuile.estLocale
              ? 'Correction locale — la source reste intacte'
              : 'Tuile locale — jamais envoyée au pack, exportable'}
          </span>
        </div>
        <div className="actions-droite">
          <button className="bouton-neutre" onClick={annuler}>
            <I.Croix t={14} /> Annuler
          </button>
          <button
            className="bouton-valide"
            onClick={valider}
            disabled={!peutValider || enCours}
            style={(!peutValider || enCours) ? { opacity: 0.4, cursor: 'default' } : undefined}
          >
            <I.Coche /> {mode === 'modifier' ? 'Valider les changements' : 'Valider la création'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PageEdition({ onEtat }) {
  const [mode, setMode] = useState(null);   // null (choix) | 'creer' | 'liste' | { tuile }
  const [toast, setToast] = useState(null);
  const [demandeSuppr, setDemandeSuppr] = useState(null);   // la tuile a supprimer

  const notifier = (m) => { setToast(m); setTimeout(() => setToast(null), 6000); };

  // souris4 : dérouler l'état interne (dialogue -> éditeur -> liste -> accueil
  // Édition) avant de quitter la page.
  const { setRetour } = useContext(NavContext);
  useEffect(() => {
    let f = null;
    if (demandeSuppr) f = () => { setDemandeSuppr(null); return true; };
    else if (mode && mode.tuile) f = () => { setMode('liste'); return true; };
    else if (mode === 'creer' || mode === 'liste') f = () => { setMode(null); return true; };
    setRetour(f);
    return () => setRetour(null);
  }, [mode, demandeSuppr]);

  const finiCreation = (r) => {
    setMode(null);
    if (onEtat) onEtat();
    notifier(r.masques === 0
      ? `Tuile #${r.ref} créée — 0 masque valide, elle n’apparaîtra pas au tirage.`
      : `Tuile #${r.ref} créée (${r.masques} masques valides).`);
  };
  const finiModif = (r) => {
    setMode(null);
    if (onEtat) onEtat();
    notifier(`#${r.ref} enregistrée${r.masques === 0 ? ' — 0 masque valide' : ` (${r.masques} masques)`}.`);
  };
  const ouvrir = async (o) => {
    const t = await window.api.edition.fiche(o.id);
    if (t) setMode({ tuile: t });
  };
  const confirmerSuppr = async () => {
    const t = demandeSuppr;
    setDemandeSuppr(null);
    const r = await window.api.edition.supprimer(t.id);
    setMode(null);
    if (onEtat) onEtat();
    notifier(`#${t.ref} supprimée.`);
  };

  if (mode === 'creer') {
    return <EditeurTuile mode="creer" onFini={finiCreation} onAnnuler={() => setMode(null)} />;
  }
  if (mode === 'liste') {
    return (
      <>
        <PageBibliotheque onEtat={onEtat} onChoisirTuile={ouvrir} />
        <button className="edition-retour" onClick={() => setMode(null)}>
          <I.Fleche t={16} retour /> Retour
        </button>
      </>
    );
  }
  if (mode && mode.tuile) {
    return (
      <>
        <EditeurTuile
          mode="modifier"
          tuile={mode.tuile}
          onFini={finiModif}
          onAnnuler={() => setMode('liste')}
          onSupprimer={setDemandeSuppr}
        />
        {demandeSuppr && (
          <BoiteConfirmation
            titre={demandeSuppr.estLocale ? 'Suppression de la fiche locale' : 'Suppression de la fiche'}
            texteConfirmer="CONFIRMER"
            onAnnuler={() => setDemandeSuppr(null)}
            onConfirmer={confirmerSuppr}
          >
            {!demandeSuppr.estLocale && (
              <p>
                Cette tuile fait partie d’un pack. Vous vous apprêtez à la supprimer.
                Cette action n’est pas conseillée.
              </p>
            )}
            <p style={{ fontWeight: 700, color: 'var(--revoir)' }}>
              IL N’EST PAS POSSIBLE DE REVENIR EN ARRIÈRE UNE FOIS LA SUPPRESSION EFFECTUÉE&nbsp;!
            </p>
          </BoiteConfirmation>
        )}
      </>
    );
  }

  return (
    <div className="galerie" style={{ '--accent': 'var(--laiton)' }}>
      <div className="galerie-tete">
        <span className="galerie-icone"><I.Crayon t={22} /></span>
        <div>
          <h2>Édition</h2>
          <div className="soustitre">Tes ajouts et corrections locales — jamais dans le pack, exportables</div>
        </div>
      </div>

      {toast && <div className="options-confirmation"><I.Coche t={14} /> {toast}</div>}

      <div className="edition-choix">
        <button className="carte" onClick={() => setMode('creer')}>
          <span className="pastille"><I.Crayon t={22} /></span>
          <span>
            <div className="nom">Créer une fiche</div>
            <div className="desc">Champs vides, à remplir librement</div>
          </span>
        </button>
        <button className="carte" onClick={() => setMode('liste')}>
          <span className="pastille"><I.Bibliotheque t={22} /></span>
          <span>
            <div className="nom">Modifier ou supprimer</div>
            <div className="desc">Choisir une fiche dans la liste</div>
          </span>
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- decks */

const TYPES_CHAMP = ['texte_court', 'texte_long', 'date', 'nombre', 'liste', 'image'];

function AssistantCsv({ gabarit, onFini, onAnnuler }) {
  const [etape, setEtape] = useState('debut');   // debut | mode | deck | ajout
  const [ana, setAna] = useState(null);          // resultat de csv:analyser
  const [nomDeck, setNomDeck] = useState('');
  const [champs, setChamps] = useState([]);      // gabarit editable (mode deck)
  const [mapping, setMapping] = useState({});    // header -> cle champ (mode ajout)
  const [occupe, setOccupe] = useState(false);
  const [err, setErr] = useState(null);

  const choisir = async () => {
    setErr(null);
    const r = await window.api.csv.analyser();
    if (r.annule) return;
    if (r.erreur) { setErr(r.erreur); return; }
    setAna(r);
    setChamps(r.gabaritPropose.champs);
    const m = {};
    for (const h of r.entetes) {
      const c = (gabarit.champs || []).find((x) => x.libelle === h || x.cle === h);
      m[h] = c ? c.cle : '__ignore__';
    }
    setMapping(m);
    setEtape('mode');
  };

  const majChamp = (i, patch) => setChamps((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const creerDeck = async () => {
    setOccupe(true); setErr(null);
    const r = await window.api.csv.creerDeck({
      deck: nomDeck.trim(),
      gabarit: { champs },
      chemin: ana.chemin
    });
    if (r.erreur) { setOccupe(false); setErr(r.erreur); return; }
    onFini();
  };

  const ajouter = async () => {
    setOccupe(true); setErr(null);
    const r = await window.api.csv.ajouter({ chemin: ana.chemin, mapping });
    if (r.erreur) { setOccupe(false); setErr(r.erreur); return; }
    onFini();
  };

  return (
    <div className="options" style={{ maxWidth: 760 }}>
      <h2>Importer un CSV</h2>
      {err && <div className="sauv-msg erreur">{err}</div>}

      {etape === 'debut' && (
        <section>
          <div className="soustitre">
            Fichier séparé par « ; », en-têtes en première ligne. Une colonne
            <code> id </code> sert de clé stable, <code> image </code> nomme le fichier image.
          </div>
          <button className="bouton-valide" onClick={choisir}>Choisir un fichier CSV…</button>
        </section>
      )}

      {etape === 'mode' && ana && (
        <section>
          <div className="soustitre">{ana.nLignes} ligne(s), {ana.entetes.length} colonne(s) : {ana.entetes.join(', ')}</div>
          <div className="np-modes">
            <button className="np-mode" onClick={() => setEtape('deck')}>
              <span className="np-radio" />
              <span><div className="np-mode-nom">Nouveau deck</div>
                <div className="np-mode-desc">Le CSV devient un pack à part entière (gabarit dérivé, ajustable).</div></span>
            </button>
            <button className="np-mode" onClick={() => setEtape('ajout')} disabled={!gabarit || !gabarit.cle}>
              <span className="np-radio" />
              <span><div className="np-mode-nom">Ajouter au deck courant{gabarit && gabarit.nom ? ' (' + gabarit.nom + ')' : ''}</div>
                <div className="np-mode-desc">Chaque ligne devient une fiche locale. Mapper les colonnes aux champs existants.</div></span>
            </button>
          </div>
        </section>
      )}

      {etape === 'deck' && (
        <section>
          <label className="etiquette">Nom du deck</label>
          <input className="editeur-input" value={nomDeck} onChange={(e) => setNomDeck(e.target.value)}
            placeholder="ex. Anatomie — Tête et cou" />
          <table className="csv-table">
            <thead><tr><th>Colonne</th><th>Type</th><th>Masquable</th><th>Évocateur</th><th>Toujours caché</th><th>Rôle</th></tr></thead>
            <tbody>
              {champs.map((c, i) => (
                <tr key={c.cle}>
                  <td>{c.libelle}</td>
                  <td>
                    <select value={c.type} onChange={(e) => majChamp(i, { type: e.target.value })}>
                      {TYPES_CHAMP.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td><input type="checkbox" checked={!!c.masquable} onChange={(e) => majChamp(i, { masquable: e.target.checked })} /></td>
                  <td><input type="checkbox" checked={!!c.evocateur} onChange={(e) => majChamp(i, { evocateur: e.target.checked })} /></td>
                  <td><input type="checkbox" checked={!!c.toujours_cache} onChange={(e) => majChamp(i, { toujours_cache: e.target.checked })} /></td>
                  <td>
                    <select value={c.role || ''} onChange={(e) => majChamp(i, { role: e.target.value || undefined })}>
                      <option value="">—</option>
                      <option value="titre">titre</option>
                      <option value="sous_titre">sous-titre</option>
                      <option value="categories">catégories</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="bouton-valide" disabled={occupe || !nomDeck.trim()} onClick={creerDeck}>
            {occupe ? 'Construction…' : 'Créer le deck'}
          </button>
        </section>
      )}

      {etape === 'ajout' && ana && (
        <section>
          <div className="soustitre">Chaque colonne du CSV → un champ du deck courant, ou « ignorer ».</div>
          <table className="csv-table">
            <thead><tr><th>Colonne CSV</th><th>Champ du deck</th></tr></thead>
            <tbody>
              {ana.entetes.map((h) => (
                <tr key={h}>
                  <td>{h}</td>
                  <td>
                    <select value={mapping[h] || '__ignore__'} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}>
                      <option value="__ignore__">— ignorer —</option>
                      <option value="image">image</option>
                      {(gabarit.champs || []).filter((c) => c.type !== 'image').map((c) => (
                        <option key={c.cle} value={c.cle}>{c.libelle}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="bouton-valide" disabled={occupe} onClick={ajouter}>
            {occupe ? 'Ajout…' : `Ajouter ${ana.nLignes} fiche(s)`}
          </button>
        </section>
      )}

      <div className="filet" />
      <button className="bouton-neutre" onClick={onAnnuler}><I.Croix t={14} /> Fermer</button>
    </div>
  );
}

function PageDecks({ onEtat }) {
  const gabarit = useContext(GabaritContext);
  const [decks, setDecks] = useState(null);
  const [assistant, setAssistant] = useState(false);
  const [occupe, setOccupe] = useState(null);

  const { setRetour } = useContext(NavContext);
  useEffect(() => {
    setRetour(assistant ? () => { setAssistant(false); return true; } : null);
    return () => setRetour(null);
  }, [assistant]);

  useEffect(() => { window.api.decks.lister().then(setDecks); }, []);

  const activer = async (deck) => {
    setOccupe(deck);
    const r = await window.api.decks.activer(deck);
    if (r && r.erreur) { setOccupe(null); return; }
    window.location.reload();
  };

  if (assistant) {
    return <AssistantCsv gabarit={gabarit} onAnnuler={() => setAssistant(false)}
      onFini={() => window.location.reload()} />;
  }

  return (
    <div className="options">
      <h2>Decks</h2>
      <div className="soustitre">Un deck = un sujet (son gabarit + ses fiches). Le deck actif alimente le jeu et la bibliothèque.</div>

      <section>
        {!decks ? <div className="chargement">chargement…</div>
          : decks.length === 0 ? <div className="galerie-vide">Aucun deck installé.</div>
          : (
            <div className="decks-liste">
              {decks.map((d) => (
                <div key={d.deck} className={'deck-carte' + (d.actif ? ' actif' : '')}>
                  <div className="deck-nom">{d.nom}{d.actif && <span className="deck-actif-pastille">actif</span>}</div>
                  <div className="deck-meta">
                    {d.nFiches} fiche(s) · gabarit <code>{d.gabaritCle}</code>
                    {d.sousLicence > 0 && <span className="deck-licence"> · {d.sousLicence} image(s) sous licence</span>}
                    {d.release && <span> · release</span>}
                  </div>
                  {!d.actif && (
                    <button className="bouton-neutre" disabled={occupe === d.deck} onClick={() => activer(d.deck)}>
                      {occupe === d.deck ? 'activation…' : 'Activer'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
      </section>

      <div className="filet" />
      <section>
        <div className="etiquette">Import</div>
        <button className="bouton-valide" onClick={() => setAssistant(true)}>Importer un CSV…</button>
      </section>
    </div>
  );
}

/* --------------------------------------------------------------- options */

const THEMES = [
  ['auto', 'Auto (Windows)'],
  ['clair', 'Clair'],
  ['parchemin', 'Parchemin'],
  ['lin', 'Lin'],
  ['sepia', 'Sépia'],
  ['sepia-profond', 'Sépia profond'],
  ['taupe', 'Taupe'],
  ['ardoise', 'Ardoise claire'],
  ['sombre', 'Sombre'],
  ['dracula', 'Dracula']
];

const RACCOURCIS = [
  ['bureau', 'Ajouter au bureau', 'Sur le bureau — retirer'],
  ['menu', 'Ajouter au menu Démarrer', 'Dans le menu Démarrer — retirer'],
  ['taskbar', 'Épingler à la barre des tâches', 'Épinglé à la barre — détacher']
];

function Options({ etat, onEtat }) {
  const [confirmation, setConfirmation] = useState(false);
  const [demandeEffacement, setDemandeEffacement] = useState(false);
  const [effacementFait, setEffacementFait] = useState(null);
  const [raccourcis, setRaccourcis] = useState(null);
  const [raccourciEnCours, setRaccourciEnCours] = useState(null);
  const [raccourciManuel, setRaccourciManuel] = useState(false);
  const [sauvMsg, setSauvMsg] = useState(null);          // { ok } | { erreur }
  const [sauvImport, setSauvImport] = useState(null);    // zip choisi, en attente de confirmation
  const [sauvOccupe, setSauvOccupe] = useState(false);
  const [drv, setDrv] = useState(null);                  // etat Google Drive
  const [drvOccupe, setDrvOccupe] = useState(false);
  const [drvMsg, setDrvMsg] = useState(null);
  const [drvConflit, setDrvConflit] = useState(null);    // { sens: 'pousser'|'tirer', distantModifie? }
  const [drvAction, setDrvAction] = useState(null);      // 'connexion' | 'envoi' | 'recuperation'

  const totalMarques = etat.tags.livre + etat.tags.etoile + etat.tags.bad_smiley;

  const flashSauv = (m) => { setSauvMsg(m); setTimeout(() => setSauvMsg(null), 7000); };

  const exporterDonnees = async () => {
    setSauvOccupe(true); setSauvMsg(null);
    const r = await window.api.sauvegarde.exporter();
    setSauvOccupe(false);
    if (r.annule) return;
    flashSauv(r.erreur ? { erreur: r.erreur } : { ok: 'Exporté : ' + r.chemin });
  };

  const choisirImport = async () => {
    setSauvOccupe(true); setSauvMsg(null);
    const r = await window.api.sauvegarde.choisir();
    setSauvOccupe(false);
    if (r.annule) return;
    if (r.erreur) { flashSauv({ erreur: r.erreur }); return; }
    setSauvImport(r);
  };

  const confirmerImport = async () => {
    const chemin = sauvImport.chemin;
    setSauvImport(null); setSauvOccupe(true);
    const r = await window.api.sauvegarde.importer(chemin);
    if (r && r.erreur) { setSauvOccupe(false); flashSauv({ erreur: r.erreur }); return; }
    window.location.reload();   // la base a changé — repartir propre
  };

  useEffect(() => { window.api.drive.etat().then(setDrv); }, []);
  const drvFlash = (m) => { setDrvMsg(m); setTimeout(() => setDrvMsg(null), 8000); };

  const drvConnecter = async () => {
    setDrvOccupe(true); setDrvMsg(null); setDrvAction('connexion');
    const r = await window.api.drive.connecter();
    setDrvOccupe(false); setDrvAction(null);
    setDrv(r);
    if (r.erreur) drvFlash({ erreur: r.erreur });
  };
  const drvDeconnecter = async () => { setDrv(await window.api.drive.deconnecter()); };

  const drvPousser = async (forcer) => {
    setDrvOccupe(true); setDrvMsg(null); setDrvAction('envoi');
    const r = await window.api.drive.pousser({ forcer: !!forcer });
    setDrvOccupe(false); setDrvAction(null);
    if (r.conflit) { setDrvConflit(r); return; }
    if (r.erreur) { drvFlash({ erreur: r.erreur }); return; }
    setDrv(await window.api.drive.etat());
    drvFlash({ ok: 'Sauvegardé sur Drive.' });
  };
  const drvTirer = async (forcer) => {
    setDrvOccupe(true); setDrvMsg(null); setDrvAction('recuperation');
    const r = await window.api.drive.tirer({ forcer: !!forcer });
    if (r.aJour) { setDrvOccupe(false); setDrvAction(null); drvFlash({ ok: 'Déjà à jour avec Drive.' }); return; }
    if (r.erreur) { setDrvOccupe(false); setDrvAction(null); drvFlash({ erreur: r.erreur }); return; }
    window.location.reload();
  };

  useEffect(() => { window.api.raccourcis.etat().then(setRaccourcis); }, []);

  const basculerRaccourci = async (type) => {
    setRaccourciEnCours(type);
    const r = await window.api.raccourcis.basculer(type);
    setRaccourcis(r.etat);
    setRaccourciManuel(r.manuel);
    setRaccourciEnCours(null);
  };

  const definir = async (cle, valeur) => {
    await window.api.reglages.definir(cle, valeur);
    onEtat();
  };

  const reinitialiser = async () => {
    await definir('theme', 'auto');
    await window.api.reglages.definir('sidebar_repliee', '0');
    onEtat();
    setConfirmation(true);
    setTimeout(() => setConfirmation(false), 2400);
  };

  const effacerMarques = async () => {
    const r = await window.api.tags.effacerTout();
    setDemandeEffacement(false);
    setEffacementFait(r.supprimes);
    onEtat();
    setTimeout(() => setEffacementFait(null), 3500);
  };

  const rev = etat.reglagesRevision || { nouvellesParJour: 20, maxParJour: 0, retention: 0.9 };
  const [retention, setRetention] = useState(rev.retention);
  const [demandeResetFsrs, setDemandeResetFsrs] = useState(false);
  const [resetFsrsFait, setResetFsrsFait] = useState(false);
  const reinitProgression = async () => {
    await window.api.revision.reinitialiser();
    setDemandeResetFsrs(false);
    setResetFsrsFait(true);
    onEtat();
    setTimeout(() => setResetFsrsFait(false), 3500);
  };

  return (
    <div className="options">
      <h2>Options</h2>

      <section>
        <div className="etiquette">Thème</div>
        <div className="choix-themes">
          {THEMES.map(([cle, nom]) => (
            <button
              key={cle}
              className={'theme-bouton' + (etat.theme === cle ? ' actif' : '')}
              onClick={() => definir('theme', cle)}
            >
              <span className={'echantillon echantillon-' + cle} />
              {nom}
            </button>
          ))}
        </div>
      </section>

      {raccourcis && (
        <>
          <div className="filet" />
          <section>
            <div className="etiquette">Raccourcis</div>
            <div className="choix-raccourcis">
              {RACCOURCIS.map(([cle, labelAjout, labelPose]) => {
                const pose = raccourcis[cle];
                return (
                  <button
                    key={cle}
                    className={'raccourci-bouton' + (pose ? ' pose' : '')}
                    onClick={() => basculerRaccourci(cle)}
                    disabled={raccourciEnCours === cle}
                  >
                    {pose ? <I.Coche t={14} /> : <span className="raccourci-plus">+</span>}
                    {raccourciEnCours === cle ? '…' : (pose ? labelPose : labelAjout)}
                  </button>
                );
              })}
            </div>
            {raccourciManuel && (
              <div className="options-note" style={{ color: 'var(--laiton)' }}>
                Windows n’autorise plus l’épinglage automatique. Le dossier s’est ouvert : clic droit
                sur « Bristol » → Épingler à la barre des tâches (ou glisse-le sur la barre).
              </div>
            )}
            <div className="options-note">
              Les raccourcis pointent vers l’exe portable actuel. Si tu le déplaces, refais-les.
            </div>
          </section>
        </>
      )}

      <div className="filet" />

      <section>
        <div className="etiquette">Révision espacée</div>
        <div className="reglages-revision">
          <label>
            <span>Nouvelles fiches par jour</span>
            <input
              type="number" min="0" max="500" defaultValue={rev.nouvellesParJour}
              onBlur={(e) => definir('revision_nouvelles_par_jour', String(Math.max(0, parseInt(e.target.value, 10) || 0)))}
            />
          </label>
          <label>
            <span>Plafond de révisions par jour <em>(0 = illimité)</em></span>
            <input
              type="number" min="0" max="9999" defaultValue={rev.maxParJour}
              onBlur={(e) => definir('revision_max_par_jour', String(Math.max(0, parseInt(e.target.value, 10) || 0)))}
            />
          </label>
          <label>
            <span>Rétention cible : <b>{Math.round(retention * 100)} %</b></span>
            <input
              type="range" min="0.80" max="0.97" step="0.01" value={retention}
              onChange={(e) => setRetention(parseFloat(e.target.value))}
              onMouseUp={(e) => definir('revision_retention', e.target.value)}
            />
          </label>
        </div>
        <div className="options-note">
          Plus la rétention cible est haute, plus les fiches reviennent souvent (0,90 par défaut).
        </div>
        {!demandeResetFsrs ? (
          <button className="bouton-danger" onClick={() => setDemandeResetFsrs(true)}>
            <I.Croix t={14} /> Réinitialiser la progression de révision
          </button>
        ) : (
          <div className="options-confirmation-danger">
            Effacer tous les intervalles et l’historique de révision ?
            <button className="bouton-danger" onClick={reinitProgression}>Oui, effacer</button>
            <button className="bouton-neutre" onClick={() => setDemandeResetFsrs(false)}>Annuler</button>
          </div>
        )}
        {resetFsrsFait && <div className="options-confirmation"><I.Coche t={14} /> Progression réinitialisée</div>}
      </section>

      <div className="filet" />

      <section>
        <div className="etiquette">Préférences d'affichage</div>
        <button className="bouton-neutre" onClick={reinitialiser}>
          <I.Rafraichir t={16} /> Réinitialiser thème et barre latérale
        </button>
        {confirmation && <div className="options-confirmation"><I.Coche t={14} /> Préférences réinitialisées</div>}
        <div className="options-note">
          Les tuiles marquées livre / étoile / à revoir et la progression ne sont jamais touchées ici.
        </div>
      </section>

      <div className="filet" />

      <section>
        <div className="etiquette">Tuiles marquées</div>
        <button
          className="bouton-danger"
          onClick={() => setDemandeEffacement(true)}
          disabled={totalMarques === 0}
          style={totalMarques === 0 ? { opacity: 0.4, cursor: 'default' } : undefined}
        >
          <I.Croix t={14} /> Effacer toutes les marques livre / étoile / à revoir
        </button>
        {effacementFait != null && (
          <div className="options-confirmation">
            <I.Coche t={14} /> {effacementFait} marque{effacementFait > 1 ? 's' : ''} effacée{effacementFait > 1 ? 's' : ''}
          </div>
        )}
        <div className="options-note">
          {totalMarques > 0
            ? `${totalMarques} tuile${totalMarques > 1 ? 's' : ''} actuellement marquée${totalMarques > 1 ? 's' : ''}.`
            : 'Aucune fiche marquée pour l’instant.'}
        </div>
      </section>

      <div className="filet" />

      <section>
        <div className="etiquette">Google Drive</div>
        {!drv ? (
          <div className="options-note">…</div>
        ) : !drv.configure ? (
          <div className="options-note">
            Synchronisation non disponible sur cette version (client OAuth absent).
          </div>
        ) : !drv.connecte ? (
          <>
            <button className="bouton-neutre" onClick={drvConnecter} disabled={drvOccupe}>
              <I.Nuage t={16} /> {drvOccupe ? 'Connexion…' : 'Connecter Google Drive'}
            </button>
            <div className="options-note">
              Ouvre le navigateur pour autoriser l’accès. L’application ne voit que le
              dossier « Tuiles et Toiles » qu’elle crée dans ton Drive — rien d’autre.
            </div>
          </>
        ) : (
          <>
            <div className="choix-raccourcis">
              <button className="bouton-neutre" onClick={() => drvPousser(false)} disabled={drvOccupe}>
                <I.FlecheVert t={16} /> Sauvegarder sur Drive
              </button>
              <button className="bouton-neutre" onClick={() => setDrvConflit({ sens: 'tirer' })} disabled={drvOccupe}>
                <I.FlecheVert t={16} bas /> Restaurer depuis Drive
              </button>
              <button className="bouton-neutre" onClick={drvDeconnecter} disabled={drvOccupe}>
                <I.Croix t={14} /> Déconnecter
              </button>
            </div>
            <div className="options-note">
              Connecté : {drv.email || 'compte Google'}.{' '}
              {drv.synchroLe
                ? 'Dernière synchro le ' + new Date(drv.synchroLe).toLocaleString('fr-FR') + '.'
                : 'Jamais synchronisé depuis ce poste.'}
            </div>
          </>
        )}
        {drvAction && (
          <div className="drive-encours">
            <span className="drive-pastille" />
            {drvAction === 'envoi' ? 'Envoi des données vers Google Drive…'
              : drvAction === 'recuperation' ? 'Récupération des données depuis Google Drive…'
              : 'Connexion à Google Drive — autorise l’accès dans le navigateur…'}
          </div>
        )}
        {drvMsg && drvMsg.ok && <div className="options-confirmation"><I.Coche t={14} /> {drvMsg.ok}</div>}
        {drvMsg && drvMsg.erreur && (
          <div className="options-note" style={{ color: 'var(--revoir)' }}>{drvMsg.erreur}</div>
        )}
      </section>

      {drvConflit && (
        <BoiteConfirmation
          titre={drvConflit.sens === 'pousser' ? 'Sauvegarde Drive plus récente' : 'Restaurer depuis Drive ?'}
          texteConfirmer={drvConflit.sens === 'pousser' ? 'Écraser avec mes données locales' : 'Remplacer le local'}
          onAnnuler={() => setDrvConflit(null)}
          onConfirmer={() => {
            const s = drvConflit.sens;
            setDrvConflit(null);
            if (s === 'pousser') drvPousser(true); else drvTirer(true);
          }}
        >
          {drvConflit.sens === 'pousser' ? (
            <p>
              La sauvegarde sur Drive a été modifiée depuis ta dernière synchro
              {drvConflit.distantModifie
                ? ' (le ' + new Date(drvConflit.distantModifie).toLocaleString('fr-FR') + ')'
                : ''}. La remplacer par tes données locales ? L’ancienne version distante
              est copiée dans « Tuiles et Toiles/historique/ » avant l’écrasement.
            </p>
          ) : (
            <p>
              Les données locales seront <strong>remplacées</strong> par la sauvegarde Drive.
              Une copie de ta base actuelle est gardée à côté. L’application se relance.
            </p>
          )}
        </BoiteConfirmation>
      )}

      <div className="filet" />

      <section>
        <div className="etiquette">Sauvegarde des données</div>
        <div className="choix-raccourcis">
          <button className="bouton-neutre" onClick={exporterDonnees} disabled={sauvOccupe}>
            <I.FlecheVert t={16} bas /> Exporter mes données (.zip)
          </button>
          <button className="bouton-neutre" onClick={choisirImport} disabled={sauvOccupe}>
            <I.FlecheVert t={16} /> Importer une sauvegarde…
          </button>
        </div>
        {sauvMsg && sauvMsg.ok && (
          <div className="options-confirmation"><I.Coche t={14} /> {sauvMsg.ok}</div>
        )}
        {sauvMsg && sauvMsg.erreur && (
          <div className="options-note" style={{ color: 'var(--revoir)' }}>{sauvMsg.erreur}</div>
        )}
        <div className="options-note">
          Le zip contient tes tuiles créées, tes corrections, tes archives et tes marques —
          pas le pack. Dépose-le dans un dossier Google Drive pour le retrouver sur un autre
          poste. L’import <strong>remplace</strong> les données locales (une copie de
          l’ancienne base est gardée à côté).
        </div>
      </section>

      {sauvImport && (
        <BoiteConfirmation
          titre="Importer cette sauvegarde ?"
          texteConfirmer="Importer et remplacer"
          onAnnuler={() => setSauvImport(null)}
          onConfirmer={confirmerImport}
        >
          <p>
            Toutes les données locales (tuiles créées, corrections, archives, marques,
            réglages) seront <strong>remplacées</strong> par le contenu de la sauvegarde.
          </p>
          {sauvImport.manifest && (
            <p className="options-note">
              Sauvegarde du{' '}
              {new Date(sauvImport.manifest.exporteLe).toLocaleString('fr-FR')} ·{' '}
              {sauvImport.manifest.fichesLocales ?? '?'} fiche(s) locale(s) ·{' '}
              {sauvImport.manifest.marques ?? '?'} marque(s) · pack{' '}
              {sauvImport.manifest.pack || '?'}
            </p>
          )}
          <p>
            Une copie de ta base actuelle est gardée
            (utilisateur.db.avant-import-…). L’application se relance après l’import.
          </p>
        </BoiteConfirmation>
      )}

      {demandeEffacement && (
        <BoiteConfirmation
          titre="Effacer toutes les marques ?"
          texteConfirmer="Tout effacer"
          onAnnuler={() => setDemandeEffacement(false)}
          onConfirmer={effacerMarques}
        >
          <p>
            Les {totalMarques} marques livre, étoile et à revoir seront retirées.
            Les {etat.fiches} fiches, leurs informations, tes corrections et ta
            progression ne sont pas touchées — seules les marques disparaissent.
          </p>
          <p>
            Tu pourras re-marquer n’importe quelle tuile à tout moment. Cette
            action ne peut pas être annulée.
          </p>
        </BoiteConfirmation>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- confirmation */

// Boite de dialogue commune (fermeture de l'appli, effacement des marques…).
// Clic dehors ou Échap = Annuler.
// validerEntree : Entrée ou Espace (hors focus sur un bouton) valent « oui ».
// confirmerVariante : 'danger' (rouge, défaut) ou 'valide' (vert, action non destructive).
function BoiteConfirmation({ titre, texteConfirmer, onAnnuler, onConfirmer, validerEntree = false, confirmerVariante = 'danger', children }) {
  useEffect(() => {
    const clavier = (e) => {
      if (e.key === 'Escape') { onAnnuler(); return; }
      if (!validerEntree) return;
      const surBouton = e.target && e.target.tagName === 'BUTTON';
      if (!surBouton && (e.key === 'Enter' || e.key === ' ' || e.code === 'Space')) {
        e.preventDefault();
        onConfirmer();
      }
    };
    window.addEventListener('keydown', clavier);
    return () => window.removeEventListener('keydown', clavier);
  }, [onAnnuler, onConfirmer, validerEntree]);

  return (
    <div className="recouvrement" onClick={onAnnuler}>
      <div className="boite-dialogue" onClick={(e) => e.stopPropagation()}>
        <h3>{titre}</h3>
        {children}
        <div className="actions">
          <button className="bouton-neutre" onClick={onAnnuler}>Annuler</button>
          {confirmerVariante === 'valide' ? (
            <button className="bouton-valide" onClick={onConfirmer}>
              <I.Coche t={14} /> {texteConfirmer}
            </button>
          ) : (
            <button className="bouton-danger" onClick={onConfirmer}>
              <I.Croix t={14} /> {texteConfirmer}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmationFermeture({ onAnnuler, onConfirmer }) {
  return (
    <BoiteConfirmation
      titre="Fermer Bristol ?"
      texteConfirmer="Quitter"
      validerEntree
      onAnnuler={onAnnuler}
      onConfirmer={onConfirmer}
    >
      <p>La progression et les tuiles marquées sont déjà enregistrées.</p>
    </BoiteConfirmation>
  );
}

// Propose au premier lancement d'ajouter un raccourci. Rien n'est cree sans clic.
function PropositionRaccourcis({ onFermer }) {
  const [rc, setRc] = useState(null);
  const [enCours, setEnCours] = useState(null);
  const [manuel, setManuel] = useState(false);

  useEffect(() => { window.api.raccourcis.etat().then(setRc); }, []);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onFermer(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onFermer]);

  const basculer = async (type) => {
    setEnCours(type);
    const r = await window.api.raccourcis.basculer(type);
    setRc(r.etat);
    setManuel(r.manuel);
    setEnCours(null);
  };

  if (!rc) return null;

  return (
    <div className="recouvrement" onClick={onFermer}>
      <div className="boite-dialogue" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
        <h3>Ajouter un raccourci ?</h3>
        <p>Pour retrouver Bristol facilement. Rien n’est ajouté sans ton clic.</p>
        <div className="choix-raccourcis" style={{ margin: '4px 0 14px' }}>
          {RACCOURCIS.map(([cle, labelAjout, labelPose]) => {
            const pose = rc[cle];
            return (
              <button
                key={cle}
                className={'raccourci-bouton' + (pose ? ' pose' : '')}
                onClick={() => basculer(cle)}
                disabled={enCours === cle}
              >
                {pose ? <I.Coche t={14} /> : <span className="raccourci-plus">+</span>}
                {enCours === cle ? '…' : (pose ? labelPose : labelAjout)}
              </button>
            );
          })}
        </div>
        {manuel && (
          <p style={{ color: 'var(--laiton)' }}>
            Windows n’autorise plus l’épinglage automatique : le dossier s’est ouvert,
            clic droit sur l’icône → Épingler à la barre des tâches.
          </p>
        )}
        <p className="options-note">Tu pourras revenir là-dessus dans les Options.</p>
        <div className="actions">
          <button className="bouton-neutre" onClick={onFermer}>Plus tard</button>
          <button className="bouton-valide" onClick={onFermer}>
            <I.Coche t={14} /> Terminé
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [etat, setEtat] = useState(null);
  const [page, setPage] = useState('menu');
  const [repliee, setRepliee] = useState(false);
  const [confirmerFermeture, setConfirmerFermeture] = useState(false);
  const [racPerimes, setRacPerimes] = useState(null);
  const [proposerRaccourcis, setProposerRaccourcis] = useState(false);
  const [colonnes, setColonnes] = useState(5);

  // Historique de navigation (souris4 = reculer, souris5 = avancer). `nonce`
  // rejoue le montage de la page : cliquer l'onglet parent depuis une
  // sous-page (Édition -> modifier) ramène bien à la page parent.
  const histoRef = useRef({ pile: ['menu'], pos: 0 });
  const [navNonce, setNavNonce] = useState(0);

  // Gestionnaire de retour interne posé par la page courante (voir NavContext).
  const retourInterneRef = useRef(null);
  const setRetour = useCallback((fn) => { retourInterneRef.current = fn || null; }, []);
  const navValue = useMemo(() => ({ setRetour }), [setRetour]);

  const charger = useCallback(async () => setEtat(await window.api.etat()), []);
  useEffect(() => { charger(); }, [charger]);

  // Densite de grille : chargee du reglage, appliquee en var CSS globale,
  // cyclee 5 -> 7 -> 9 par le bouton de BarreFiltres.
  useEffect(() => {
    if (etat && etat.grilleColonnes) setColonnes(etat.grilleColonnes);
  }, [etat && etat.grilleColonnes]);
  useEffect(() => {
    document.documentElement.style.setProperty('--grille-cols', colonnes);
  }, [colonnes]);
  const cyclerColonnes = useCallback(() => {
    setColonnes((c) => {
      const n = DENSITES[(DENSITES.indexOf(c) + 1) % DENSITES.length] || DENSITES[0];
      window.api.reglages.definir('grille_colonnes', String(n));
      window.api.log('grille -> ' + n + '/ligne');
      return n;
    });
  }, []);

  // Ctrl+F : donner le focus au champ de recherche de la page courante.
  useEffect(() => {
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        const inp = document.querySelector('.biblio-recherche');
        if (inp) { e.preventDefault(); inp.focus(); inp.select(); }
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  // Navigation tracee (journal.log). A etoffer : logger aussi les actions
  // internes des pages. Chaque appel empile la page et remonte le composant
  // (nonce) — y compris quand on reclique l'onglet courant.
  const naviguer = useCallback((p) => {
    window.api.log('page -> ' + p);
    retourInterneRef.current = null;
    const h = histoRef.current;
    h.pile = h.pile.slice(0, h.pos + 1);
    if (h.pile[h.pos] !== p) { h.pile.push(p); h.pos = h.pile.length - 1; }
    setPage(p);
    setNavNonce((n) => n + 1);
  }, []);

  const reculer = useCallback(() => {
    // D'abord fermer l'état interne de la page (aperçu, éditeur…) s'il y en a.
    if (retourInterneRef.current && retourInterneRef.current()) return;
    const h = histoRef.current;
    if (h.pos <= 0) return;
    h.pos -= 1;
    window.api.log('page <- ' + h.pile[h.pos] + ' (souris4)');
    setPage(h.pile[h.pos]);
    setNavNonce((n) => n + 1);
  }, []);

  const avancer = useCallback(() => {
    retourInterneRef.current = null;
    const h = histoRef.current;
    if (h.pos >= h.pile.length - 1) return;
    h.pos += 1;
    window.api.log('page -> ' + h.pile[h.pos] + ' (souris5)');
    setPage(h.pile[h.pos]);
    setNavNonce((n) => n + 1);
  }, []);

  useEffect(() => { window.api.log('rendu prêt'); }, []);

  // Boutons lateraux de la souris : 3 = precedent, 4 = suivant. preventDefault
  // sur mousedown coupe la navigation d'historique par defaut de Chromium ;
  // onNav couvre les touches physiques remontees en app-command (Windows). Un
  // garde-temps evite un double saut si les deux voies se declenchent.
  const gardeSouris = useRef(0);
  useEffect(() => {
    const sauter = (fn) => {
      const t = Date.now();
      if (t - gardeSouris.current < 300) return;
      gardeSouris.current = t;
      fn();
    };
    const onUp = (e) => {
      if (e.button === 3) { e.preventDefault(); sauter(reculer); }
      else if (e.button === 4) { e.preventDefault(); sauter(avancer); }
    };
    const onDown = (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); };
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousedown', onDown);
    const desab = window.api.onNav
      ? window.api.onNav((sens) => sauter(sens === 'reculer' ? reculer : avancer))
      : null;
    return () => {
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousedown', onDown);
      if (desab) desab();
    };
  }, [reculer, avancer]);

  // A chaque ouverture : les raccourcis qui pointent vers un ancien
  // emplacement de l'exe -> proposer de les remettre a jour.
  useEffect(() => {
    window.api.raccourcis.perimes().then((l) => { if (l && l.length) setRacPerimes(l); });
  }, []);

  // Premier lancement (Windows) : proposer d'ajouter un raccourci.
  useEffect(() => {
    if (etat && !etat.raccourcisProposes) {
      window.api.raccourcis.etat().then((rc) => { if (rc) setProposerRaccourcis(true); });
    }
  }, [etat && etat.raccourcisProposes]);

  useEffect(() => {
    if (etat) setRepliee(etat.sidebarRepliee);
  }, [etat && etat.sidebarRepliee]);

  // Applique la palette choisie (attribut data-theme lu par styles.css) et
  // suit le theme Windows en direct quand 'auto' est actif.
  useEffect(() => {
    if (!etat) return undefined;
    let actif = true;
    const appliquer = (systeme) => {
      document.documentElement.dataset.theme = etat.theme === 'auto' ? systeme : etat.theme;
    };
    window.api.themeSysteme().then((s) => { if (actif) appliquer(s); });
    const desabonner = window.api.onThemeSysteme(appliquer);
    return () => { actif = false; desabonner(); };
  }, [etat && etat.theme]);

  const basculer = () => {
    const v = !repliee;
    setRepliee(v);
    window.api.reglages.definir('sidebar_repliee', v ? '1' : '0');
  };

  // Croix (fenetre ou barre laterale) et « Quitter » : proposent directement
  // de fermer l'application. Le retour a l'accueil se fait par l'onglet dedie.
  const tenterFermeture = useCallback(() => {
    setConfirmerFermeture(true);
  }, []);

  useEffect(() => window.api.onTenterFermeture(tenterFermeture), [tenterFermeture]);

  const dialogueFermeture = confirmerFermeture && (
    <ConfirmationFermeture
      onAnnuler={() => setConfirmerFermeture(false)}
      onConfirmer={() => window.api.quitter()}
    />
  );

  const NOMS_RAC = { bureau: 'le bureau', menu: 'le menu Démarrer', taskbar: 'la barre des tâches' };
  const reparerRaccourcis = async () => {
    await window.api.raccourcis.reparer(racPerimes.map((r) => r.type));
    setRacPerimes(null);
  };
  const dialogueRaccourcis = racPerimes && (
    <BoiteConfirmation
      titre="Raccourcis à mettre à jour ?"
      texteConfirmer="Mettre à jour"
      confirmerVariante="valide"
      onAnnuler={() => setRacPerimes(null)}
      onConfirmer={reparerRaccourcis}
    >
      <p>
        {racPerimes.length > 1 ? 'Des raccourcis' : 'Un raccourci'} vers Bristol
        ({racPerimes.map((r) => NOMS_RAC[r.type]).join(', ')}) pointe
        {racPerimes.length > 1 ? 'nt' : ''} vers un ancien emplacement de l’application.
        Le{racPerimes.length > 1 ? 's' : ''} faire pointer vers l’exe actuel ?
      </p>
    </BoiteConfirmation>
  );

  const fermerProposition = () => {
    setProposerRaccourcis(false);
    window.api.reglages.definir('raccourcis_proposes', '1');
    charger();
  };
  const dialoguePropositionRaccourcis = proposerRaccourcis && (
    <PropositionRaccourcis onFermer={fermerProposition} />
  );

  if (!etat) return <div className="chargement">chargement…</div>;
  if (page === 'menu') {
    return (
      <>
        <Menu etat={etat} aller={naviguer} onQuitter={tenterFermeture} />
        {dialogueFermeture}
        {dialogueRaccourcis}
        {dialoguePropositionRaccourcis}
      </>
    );
  }

  return (
    <GabaritContext.Provider value={etat.gabarit || { cle: null, nom: null, champs: [] }}>
    <GrilleContext.Provider value={{ colonnes, cycler: cyclerColonnes }}>
     <NavContext.Provider value={navValue}>
      <div className="appli">
        <Barre
          page={page} aller={naviguer} etat={etat} repliee={repliee} basculer={basculer}
          onQuitter={tenterFermeture}
        />
        <div className="contenu">
          {/* cle = page + nonce : recliquer l'onglet courant (ou revenir via
              souris4/5) remonte la page et repart de son etat initial. */}
          <Fragment key={page + '#' + navNonce}>
            {page === 'jeu' ? <Jeu onEtat={charger} />
              : page === 'revision' ? <PageRevision onEtat={charger} />
              : page === 'options' ? <Options etat={etat} onEtat={charger} />
              : page === 'bibliotheque' ? <PageBibliotheque onEtat={charger} />
              : page === 'edition' ? <PageEdition onEtat={charger} />
              : page === 'decks' ? <PageDecks onEtat={charger} />
              : page === 'livre' ? <PageLivre onEtat={charger} />
              : page === 'etoile' ? <PageEtoile onEtat={charger} />
              : page === 'revoir' ? <PageRevoir onEtat={charger} />
              : <EnChantier nom={page} />}
          </Fragment>
        </div>
        {dialogueFermeture}
        {dialogueRaccourcis}
        {dialoguePropositionRaccourcis}
      </div>
     </NavContext.Provider>
    </GrilleContext.Provider>
    </GabaritContext.Provider>
  );
}
