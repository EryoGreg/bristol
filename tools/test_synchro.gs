/**
 * Tuiles & Toiles -- test de stabilite des identifiants d'image.
 *
 * QUESTION A TRANCHER
 *   Quand on fait "Remplacer l'image" dans Google Docs, l'identifiant de
 *   l'objet (inlineObjectId) est-il conserve ou recree ?
 *   De la reponse depend la cle de synchronisation de l'application :
 *     - conserve  -> le remplacement d'image est INVISIBLE, il faut un
 *                    signal de repli (dimensions, poids)
 *     - recree    -> le remplacement est detecte gratuitement
 *
 * PREPARATION (une fois)
 *   1. script.google.com -> Nouveau projet -> coller ce fichier -> Enregistrer
 *   2. Lancer  autoriser()  et accepter les permissions demandees.
 *
 *   Rien d'autre : si le service avance "Docs" n'est pas installe, le script
 *   appelle l'API REST directement. L'ajouter reste possible (panneau de
 *   gauche, Services +, "Google Docs API") mais n'est pas necessaire.
 *
 * DEROULE DU TEST  (deux manches)
 *
 *   MANCHE A -- le contentUri est-il stable d'une lecture a l'autre ?
 *     1. purgerInstantanes()
 *     2. snapshot()
 *     3. snapshot()            SANS RIEN TOUCHER au document entre les deux
 *     4. comparer()
 *        "contentUri identiques" attendu si l'URI depend du contenu.
 *        Si "REGENERE a chaque lecture", la piste est morte, s'arreter la.
 *
 *   MANCHE B -- le contentUri change-t-il quand l'image change ?
 *     5. Remplacer une image dans le document, noter le titre de l'oeuvre
 *     6. snapshot()
 *     7. comparer()
 *        Resultat espere : "Mixte" avec la seule oeuvre modifiee listee.
 *
 * Le document n'est jamais modifie par ce script : lecture seule.
 */

var DOC_ID = '1A3-KpwlE9qW0qJP4muqMrShMsJsgq3QU6SB5qjN2JtY';   // copie de test
var DOSSIER_TEST = 'Tuiles & Toiles - test synchro';


/** A LANCER EN PREMIER : declenche l'ecran de consentement et verifie l'acces. */
function autoriser() {
  var doc = docGet_(DOC_ID);
  var voie = (typeof Docs !== 'undefined' && Docs.Documents) ? 'service avance Docs' : 'API REST';
  Logger.log('AUTORISATION OK  (voie : %s)', voie);
  Logger.log('Document : %s', doc.title);
  Logger.log('revisionId : %s', doc.revisionId);
  Logger.log('Lancer maintenant snapshot().');
}


/**
 * Lit le document via l'API Docs.
 * Utilise le service avance "Docs" s'il a ete ajoute ; sinon appelle
 * directement l'API REST avec le jeton du script. Les deux voies sont
 * en lecture seule et renvoient exactement la meme structure.
 */
function docGet_(id) {
  if (typeof Docs !== 'undefined' && Docs.Documents) {
    return Docs.Documents.get(id);
  }
  var reponse = UrlFetchApp.fetch(
    'https://docs.googleapis.com/v1/documents/' + encodeURIComponent(id),
    {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
  var code = reponse.getResponseCode();
  if (code !== 200) {
    throw new Error('API Docs : HTTP ' + code + ' -- ' + reponse.getContentText().substring(0, 300));
  }
  return JSON.parse(reponse.getContentText());
}


/**
 * Jamais appelee. Sa seule presence force Apps Script a demander la
 * permission de lecture des documents, necessaire a docGet_().
 */
function _porteesRequises_() {
  DocumentApp.openById(DOC_ID);
  DriveApp.getRootFolder();
}


function snapshot() {
  var doc = docGet_(DOC_ID);
  var lignes = lireLignes_(doc);

  var horodatage = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  var nom = 'snapshot-' + horodatage + '.json';
  var dossier = dossierUnique_(DOSSIER_TEST);
  dossier.createFile(Utilities.newBlob(JSON.stringify(lignes), 'application/json', nom));

  var avecImage = lignes.filter(function (l) { return l.objets.length > 0; }).length;
  Logger.log('Instantane enregistre : %s', nom);
  Logger.log('Lignes lues : %s | dont avec image : %s', lignes.length, avecImage);
  Logger.log('revisionId du document : %s', doc.revisionId);

  // Deux contentUri en clair : leur structure dira quelle partie est stable.
  var exemples = [];
  lignes.forEach(function (l) {
    if (exemples.length < 2 && l.objets.length && l.objets[0].uri) {
      exemples.push(l.titre + ' -> ' + l.objets[0].uri);
    }
  });
  exemples.forEach(function (e) { Logger.log('contentUri : %s', e); });

  Logger.log('Relancer snapshot(), puis comparer().');
}


function comparer() {
  var dossier = dossierUnique_(DOSSIER_TEST);
  var fichiers = [];
  var it = dossier.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf('snapshot-') === 0) fichiers.push(f);
  }
  if (fichiers.length < 2) {
    Logger.log('Il faut deux instantanes. Trouve : %s', fichiers.length);
    return;
  }
  fichiers.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
  var apres = JSON.parse(fichiers[0].getBlob().getDataAsString());
  var avant = JSON.parse(fichiers[1].getBlob().getDataAsString());
  Logger.log('AVANT : %s  (%s lignes)', fichiers[1].getName(), avant.length);
  Logger.log('APRES : %s  (%s lignes)', fichiers[0].getName(), apres.length);
  Logger.log('');

  // appariement par titre + date, insensible a la casse et aux accents
  var index = {};
  avant.forEach(function (l) { index[cle_(l)] = l; });

  var idChange = [], tailleChange = [], texteChange = [], nouvelles = [];

  apres.forEach(function (b) {
    var a = index[cle_(b)];
    if (!a) { nouvelles.push(b); return; }
    delete index[cle_(b)];

    var idA = a.objets.map(function (o) { return o.id; }).join(',');
    var idB = b.objets.map(function (o) { return o.id; }).join(',');
    if (idA !== idB) idChange.push({ l: b, a: idA, b: idB });

    var dimA = a.objets.map(function (o) { return o.l + 'x' + o.h; }).join(',');
    var dimB = b.objets.map(function (o) { return o.l + 'x' + o.h; }).join(',');
    if (dimA !== dimB) tailleChange.push({ l: b, a: dimA, b: dimB });

    if (a.texte !== b.texte) texteChange.push(b);
  });

  var supprimees = Object.keys(index).map(function (k) { return index[k]; });

  Logger.log('=========================================================');
  Logger.log('VERDICT SUR LA CLE DE SYNCHRONISATION');
  Logger.log('=========================================================');
  if (idChange.length === 0) {
    Logger.log('Aucun identifiant d\'image n\'a change.');
    Logger.log('=> "Remplacer l\'image" CONSERVE l\'inlineObjectId.');
    Logger.log('=> L\'identifiant seul ne suffit pas a detecter un remplacement.');
    Logger.log('   Il faudra le signal de repli (dimensions ou poids).');
  } else {
    Logger.log('%s ligne(s) ont vu leur identifiant d\'image changer :', idChange.length);
    idChange.forEach(function (c) {
      Logger.log('   %s (%s)', c.l.titre, c.l.date);
      Logger.log('      avant : %s', c.a || '(aucun)');
      Logger.log('      apres : %s', c.b || '(aucun)');
    });
    Logger.log('=> "Remplacer l\'image" RECREE l\'objet.');
    Logger.log('=> Le remplacement est detecte gratuitement, sans telecharger l\'image.');
  }

  Logger.log('');
  Logger.log('--- signal candidat : contentUri ---');
  var uriIdentiques = 0, uriDifferents = 0, exemplesUri = [];
  apres.forEach(function (b) {
    var a = avant.filter(function (x) { return cle_(x) === cle_(b); })[0];
    if (!a || !a.objets.length || !b.objets.length) return;
    var ua = a.objets[0].uri || '', ub = b.objets[0].uri || '';
    if (!ua && !ub) return;
    if (ua === ub) {
      uriIdentiques++;
    } else {
      uriDifferents++;
      if (exemplesUri.length < 3) exemplesUri.push({ t: b.titre, a: ua, b: ub });
    }
  });
  Logger.log('contentUri identiques : %s | differents : %s', uriIdentiques, uriDifferents);
  if (uriDifferents === 0) {
    Logger.log('=> STABLE d\'une lecture a l\'autre : candidat serieux comme empreinte.');
  } else if (uriIdentiques === 0) {
    Logger.log('=> REGENERE a chaque lecture : inutilisable tel quel.');
    exemplesUri.forEach(function (e) {
      Logger.log('   %s', e.t);
      Logger.log('      avant : %s', e.a);
      Logger.log('      apres : %s', e.b);
    });
  } else {
    Logger.log('=> Mixte : seules certaines images ont change d\'URI. C\'est le cas ideal.');
    exemplesUri.forEach(function (e) {
      Logger.log('   %s', e.t);
      Logger.log('      avant : %s', e.a);
      Logger.log('      apres : %s', e.b);
    });
  }

  Logger.log('');
  Logger.log('--- signal de repli : dimensions ---');
  if (tailleChange.length === 0) {
    Logger.log('aucun changement de dimensions');
  } else {
    tailleChange.forEach(function (c) {
      Logger.log('   %s : %s -> %s', c.l.titre, c.a, c.b);
    });
  }

  Logger.log('');
  Logger.log('--- autres differences ---');
  Logger.log('lignes au texte modifie : %s', texteChange.length);
  texteChange.slice(0, 10).forEach(function (l) { Logger.log('   %s', l.titre); });
  Logger.log('lignes ajoutees   : %s', nouvelles.length);
  nouvelles.slice(0, 10).forEach(function (l) { Logger.log('   %s', l.titre); });
  Logger.log('lignes supprimees : %s', supprimees.length);
  supprimees.slice(0, 10).forEach(function (l) { Logger.log('   %s', l.titre); });
}


function purgerInstantanes() {
  var dossier = dossierUnique_(DOSSIER_TEST);
  var it = dossier.getFiles(), n = 0;
  while (it.hasNext()) { it.next().setTrashed(true); n++; }
  Logger.log('%s instantane(s) mis a la corbeille.', n);
}


/** Parcourt le plus grand tableau du document et en extrait une ligne par oeuvre. */
function lireLignes_(doc) {
  var inline = doc.inlineObjects || {};
  var tables = [];
  (doc.body.content || []).forEach(function (el) {
    if (el.table) tables.push(el.table);
  });
  if (!tables.length) throw new Error('Aucun tableau dans le document.');
  var table = tables[0];
  tables.forEach(function (t) { if (t.rows > table.rows) table = t; });

  return (table.tableRows || []).map(function (row, i) {
    var cellules = (row.tableCells || []).map(function (c) { return texteDe_(c); });
    var objets = [];
    (row.tableCells || []).forEach(function (c) { collecterObjets_(c, inline, objets); });
    return {
      i: i,
      titre: (cellules[2] || '').trim(),
      date: (cellules[3] || '').trim(),
      texte: cellules.join(' | '),
      objets: objets
    };
  });
}

function texteDe_(noeud) {
  var out = '';
  (noeud.content || []).forEach(function (el) {
    if (el.paragraph) {
      (el.paragraph.elements || []).forEach(function (e) {
        if (e.textRun) out += e.textRun.content;
      });
    }
    if (el.table) out += texteDeTable_(el.table);
  });
  return out.replace(/\s+/g, ' ').trim();
}

function texteDeTable_(t) {
  var out = '';
  (t.tableRows || []).forEach(function (r) {
    (r.tableCells || []).forEach(function (c) { out += ' ' + texteDe_(c); });
  });
  return out;
}

function collecterObjets_(noeud, inline, out) {
  (noeud.content || []).forEach(function (el) {
    if (el.paragraph) {
      (el.paragraph.elements || []).forEach(function (e) {
        if (!e.inlineObjectElement) return;
        var id = e.inlineObjectElement.inlineObjectId;
        var eo = inline[id] && inline[id].inlineObjectProperties
          && inline[id].inlineObjectProperties.embeddedObject;
        var t = eo && eo.size || {};
        out.push({
          id: id,
          l: t.width ? Math.round(t.width.magnitude) : 0,
          h: t.height ? Math.round(t.height.magnitude) : 0,
          src: (eo && eo.imageProperties && eo.imageProperties.sourceUri) || '',
          uri: (eo && eo.imageProperties && eo.imageProperties.contentUri) || ''
        });
      });
    }
    if (el.table) {
      (el.table.tableRows || []).forEach(function (r) {
        (r.tableCells || []).forEach(function (c) { collecterObjets_(c, inline, out); });
      });
    }
  });
}

function cle_(l) {
  return (l.titre + '|' + l.date)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9|]+/g, ' ')
    .trim();
}

function dossierUnique_(nom) {
  var it = DriveApp.getFoldersByName(nom);
  return it.hasNext() ? it.next() : DriveApp.createFolder(nom);
}
