# -*- coding: utf-8 -*-
"""
Ajoute la colonne `description` au manifeste.

Le script Apps Script d'extraction ne l'exportait pas : les 431 descriptions
manquaient en base. On les reprend dans l'export texte brut du document et on
les apparie au manifeste.

    python tools/ajouter_descriptions.py <export_texte.txt>

Ecrit data/manifest.csv en place, apres sauvegarde en data/manifest.sans-description.csv
"""
import sys, io, os, re, csv, shutil, unicodedata, collections

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFESTE = os.path.join(RACINE, 'data', 'manifest.csv')
SEP_LIGNE = '\r\n\t  \r\n\r\n'


def cellules(bloc):
    out = []
    for ligne in bloc.split('\r\n'):
        if ligne.startswith('\t'):
            out.append(ligne[1:])
        elif out:
            out[-1] += '\n' + ligne
    return out


def lire_document(chemin):
    """Rend une liste de dicts dans l'ordre du tableau, en-tete exclue."""
    txt = io.open(chemin, encoding='utf-8', newline='').read().replace('﻿', '')
    lignes = []
    for bloc in txt.split(SEP_LIGNE):
        c = cellules(bloc)
        while len(c) >= 6:
            lignes.append([x.strip() for x in c[:6]])
            c = c[6:]
            while c and not c[0].strip():
                c = c[1:]
    champs = ['artiste', 'titre', 'date', 'lieu', 'description', 'tags']
    return [dict(zip(champs, l)) for l in lignes[1:] if any(l)]


def norm(s):
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    doc = lire_document(sys.argv[1])
    print("Document : %d lignes" % len(doc))

    with io.open(MANIFESTE, encoding='utf-8-sig', newline='') as f:
        lecteur = csv.DictReader(f, delimiter=';')
        colonnes = list(lecteur.fieldnames)
        manifeste = list(lecteur)
    print("Manifeste : %d lignes, colonnes %s" % (len(manifeste), colonnes))

    if 'description' in colonnes:
        print("La colonne description existe deja. Rien a faire.")
        return

    # appariement principal : titre + date normalises
    index = collections.defaultdict(list)
    for i, d in enumerate(doc):
        index[(norm(d['titre']), norm(d['date']))].append(i)

    pris = set()
    apparies = 0
    for m in manifeste:
        cle = (norm(m.get('titre')), norm(m.get('date')))
        candidats = [i for i in index.get(cle, []) if i not in pris]
        if len(candidats) == 1:
            m['description'] = doc[candidats[0]]['description']
            pris.add(candidats[0])
            apparies += 1
        else:
            m['description'] = None          # repli plus bas

    # repli : position dans le tableau (ligne du manifeste = index + 2)
    par_position = 0
    for m in manifeste:
        if m.get('description') is not None:
            continue
        i = int(m.get('ligne') or 0) - 2
        if 0 <= i < len(doc) and i not in pris:
            m['description'] = doc[i]['description']
            pris.add(i)
            par_position += 1

    restants = [m for m in manifeste if m.get('description') is None]
    for m in restants:
        m['description'] = ''

    print("Apparies par titre+date : %d" % apparies)
    print("Apparies par position   : %d" % par_position)
    print("Sans description        : %d" % len(restants))
    for m in restants[:10]:
        print("   ligne %-5s %s" % (m.get('ligne'), (m.get('titre') or '')[:56]))

    vides = sum(1 for m in manifeste if not m['description'].strip())
    print("Descriptions vides au total : %d  (8 attendues, elles le sont dans le document)" % vides)

    sauvegarde = os.path.join(RACINE, 'data', 'manifest.sans-description.csv')
    shutil.copy2(MANIFESTE, sauvegarde)

    sortie = colonnes[:]
    sortie.insert(sortie.index('lieu') + 1, 'description')
    with io.open(MANIFESTE, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=sortie, delimiter=';', extrasaction='ignore')
        w.writeheader()
        w.writerows(manifeste)
    print("\nManifeste reecrit : %s" % MANIFESTE)
    print("Sauvegarde        : %s" % sauvegarde)


if __name__ == '__main__':
    main()
