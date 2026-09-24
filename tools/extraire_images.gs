/**
 * Tuiles & Toiles -- extraction des images du GDoc "Liste d'oeuvres".
 *
 * Contourne la limite d'export de 10 Mo : les images sont lues une par une
 * et deposees dans un NOUVEAU dossier Drive. Le document source est
 * uniquement LU, jamais modifie.
 *
 * MODE D'EMPLOI
 *   1. script.google.com  ->  Nouveau projet
 *   2. Coller tout ce fichier, remplacer le contenu par defaut, Enregistrer
 *   3. Selectionner la fonction  autoriser  dans le menu deroulant du haut,
 *      puis Executer. Une fenetre "Autorisation requise" s'ouvre :
 *        Examiner les autorisations  ->  choisir le compte
 *        ->  Parametres avances  ->  Acceder a <nom du projet> (non securise)
 *        ->  Autoriser
 *      Le journal doit afficher  AUTORISATION OK.
 *      Si aucune fenetre n'apparait : le bloqueur de fenetres du navigateur
 *      l'a supprimee. L'autoriser pour script.google.com et relancer.
 *   4. Selectionner  extraireImages  et Executer.
 *   5. Relancer tant que le journal n'affiche pas  === TERMINE ===
 *      (chaque execution traite BATCH lignes, pour rester sous les 6 min)
 *   6. Dans Drive, clic droit sur le dossier  ->  Telecharger
 *      (Drive zippe cote serveur, pas de limite de 10 Mo)
 *
 *   Pour repartir de zero :  lancer  reinitialiser()
 *
 * Si l'etape 3 renvoie une erreur de permission (document en lecture seule) :
 * faire  Fichier > Creer une copie  dans le GDoc -- cela cree un fichier
 * distinct sans toucher a l'original -- puis mettre l'ID de la copie dans
 * DOC_ID ci-dessous.
 */

var DOC_ID = '1toBoXypD2b-WWTPhlWoBXsNtZAH2l5fC4oHOw1FCYPo';
var DOSSIER = 'Tuiles & Toiles - images';
var BATCH = 120;   // lignes par execution ; baisser si depassement de delai

// Colonnes du tableau (0 = colonne des images)
var C_IMG = 0, C_ARTISTE = 1, C_TITRE = 2, C_DATE = 3, C_LIEU = 4, C_DESC = 5, C_TAGS = 6;


/**
 * A LANCER EN PREMIER. Ne fait presque rien, mais touche les deux services
 * dont le script a besoin : cela force l'ecran de consentement Google a
 * demander les bonnes autorisations, sans mobiliser 6 minutes d'execution.
 */
function autoriser() {
  var titre = DocumentApp.openById(DOC_ID).getName();
  var racine = DriveApp.getRootFolder().getName();
  Logger.log('AUTORISATION OK');
  Logger.log('Document lu      : %s', titre);
  Logger.log('Drive accessible : %s', racine);
  Logger.log('Lancer maintenant extraireImages().');
}


function extraireImages() {
  var props = PropertiesService.getScriptProperties();
  var debut = Number(props.getProperty('curseur') || 0);

  var doc = DocumentApp.openById(DOC_ID);
  var tables = doc.getBody().getTables();
  if (!tables.length) throw new Error('Aucun tableau dans le document.');

  var table = tables[0];
  for (var t = 1; t < tables.length; t++) {
    if (tables[t].getNumRows() > table.getNumRows()) table = tables[t];
  }
  var total = table.getNumRows();

  var dossier = dossierUnique_(DOSSIER);
  var lignes = JSON.parse(props.getProperty('manifeste') || '[]');
  var vus = JSON.parse(props.getProperty('vus') || '{}');

  var fin = Math.min(debut + BATCH, total);
  Logger.log('Lignes %s a %s sur %s', debut + 1, fin, total);

  for (var r = debut; r < fin; r++) {
    var row = table.getRow(r);
    var cell = function (i) {
      return i < row.getNumCells() ? row.getCell(i).getText().replace(/\s+/g, ' ').trim() : '';
    };

    var titre = cell(C_TITRE), date = cell(C_DATE);

    // ligne d'en-tete ou ligne vide
    if (r === 0 && cell(C_ARTISTE).toLowerCase().indexOf('artiste') === 0) continue;
    if (!titre && !date && !cell(C_ARTISTE) && !cell(C_TAGS)) continue;

    var base = slug_(titre) + '_' + slug_(date).substring(0, 16);
    vus[base] = (vus[base] || 0) + 1;
    var id = vus[base] === 1 ? base : base + '-' + vus[base];

    var images = imagesDe_(row);
    var nomFichier = '';
    if (images.length) {
      var blob = images[0].getBlob();
      var ext = extension_(blob.getContentType());
      nomFichier = id + ext;
      blob.setName(nomFichier);
      dossier.createFile(blob);
    }

    lignes.push([
      id, r + 1, titre, date, cell(C_ARTISTE), cell(C_LIEU), cell(C_DESC), nomFichier, cell(C_TAGS)
    ]);
  }

  props.setProperty('curseur', String(fin));
  props.setProperty('manifeste', JSON.stringify(lignes));
  props.setProperty('vus', JSON.stringify(vus));

  if (fin >= total) {
    ecrireManifeste_(dossier, lignes);
    var sansImage = lignes.filter(function (l) { return !l[6]; }).length;
    Logger.log('=== TERMINE ===');
    Logger.log('Oeuvres : %s | images ecrites : %s | sans image : %s',
      lignes.length, lignes.length - sansImage, sansImage);
    Logger.log('Dossier Drive : %s', dossier.getUrl());
  } else {
    Logger.log('Relancer extraireImages() -- reste %s lignes.', total - fin);
  }
}


function reinitialiser() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  Logger.log('Curseur remis a zero. Supprimer aussi le dossier Drive avant de relancer.');
}


/** Toutes les images en ligne d'une ligne de tableau, colonne 0 en premier. */
function imagesDe_(row) {
  var out = [];
  for (var c = 0; c < row.getNumCells(); c++) {
    collecter_(row.getCell(c), out);
  }
  return out;
}

function collecter_(element, out) {
  var type = element.getType();
  if (type === DocumentApp.ElementType.INLINE_IMAGE) {
    out.push(element.asInlineImage());
    return;
  }
  if (typeof element.getNumChildren !== 'function') return;
  for (var i = 0; i < element.getNumChildren(); i++) {
    collecter_(element.getChild(i), out);
  }
}

function dossierUnique_(nom) {
  var it = DriveApp.getFoldersByName(nom);
  return it.hasNext() ? it.next() : DriveApp.createFolder(nom);
}

function extension_(mime) {
  if (!mime) return '.png';
  if (mime.indexOf('jpeg') >= 0 || mime.indexOf('jpg') >= 0) return '.jpg';
  if (mime.indexOf('gif') >= 0) return '.gif';
  if (mime.indexOf('webp') >= 0) return '.webp';
  if (mime.indexOf('bmp') >= 0) return '.bmp';
  if (mime.indexOf('svg') >= 0) return '.svg';
  return '.png';
}

function slug_(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 48) || 'sans-titre';
}

function ecrireManifeste_(dossier, lignes) {
  var entete = ['id', 'ligne', 'titre', 'date', 'artiste', 'lieu', 'description', 'image', 'tags'];
  var csv = [entete].concat(lignes).map(function (l) {
    return l.map(function (v) {
      v = String(v == null ? '' : v);
      return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(';');
  }).join('\n');

  var anciens = dossier.getFilesByName('manifest.csv');
  while (anciens.hasNext()) anciens.next().setTrashed(true);

  dossier.createFile(Utilities.newBlob('\ufeff' + csv, 'text/csv', 'manifest.csv'));
}
