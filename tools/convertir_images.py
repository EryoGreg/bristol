# -*- coding: utf-8 -*-
"""
Convertit les PNG exportes du GDoc en JPEG redimensionnes, directement depuis
le zip (rien n'est extrait sur disque), et enrichit le manifeste.

    python tools/convertir_images.py "<archive.zip>" [dossier_sortie]

Sorties :
    data/images/<id>.jpg   une image par oeuvre
    data/manifest.csv      manifeste d'origine + largeur, hauteur, octets
"""
import sys, os, io, csv, zipfile, time

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Pillow est requis :  python -m pip install Pillow")

COTE_MAX = 1400
QUALITE = 82
EXT_IMG = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp')


def humain(n):
    for unite in ('o', 'Ko', 'Mo', 'Go'):
        if n < 1024:
            return "%.1f %s" % (n, unite)
        n /= 1024.0
    return "%.1f To" % n


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    zip_path = sys.argv[1]
    racine = sys.argv[2] if len(sys.argv) > 2 else 'data'
    img_dir = os.path.join(racine, 'images')
    os.makedirs(img_dir, exist_ok=True)

    z = zipfile.ZipFile(zip_path)
    membres = z.namelist()

    # --- manifeste d'origine ---
    man_nom = [m for m in membres if m.lower().endswith('manifest.csv')]
    lignes, entetes = [], []
    if man_nom:
        brut = z.read(man_nom[0]).decode('utf-8-sig')
        lecteur = csv.DictReader(io.StringIO(brut), delimiter=';')
        entetes = lecteur.fieldnames or []
        lignes = list(lecteur)
        print("Manifeste : %d lignes, colonnes %s" % (len(lignes), entetes))
    else:
        print("ATTENTION : aucun manifest.csv dans l'archive.")

    par_image = {}
    for l in lignes:
        if l.get('image'):
            par_image[os.path.basename(l['image'])] = l

    images = [m for m in membres if m.lower().endswith(EXT_IMG)]
    print("Images dans l'archive : %d" % len(images))
    print("Conversion : cote max %d px, JPEG qualite %d\n" % (COTE_MAX, QUALITE))

    avant = apres = 0
    faits, echecs, orphelines = [], [], []
    t0 = time.time()

    for n, membre in enumerate(sorted(images), 1):
        nom = os.path.basename(membre)
        brut = z.read(membre)
        avant += len(brut)
        try:
            im = Image.open(io.BytesIO(brut))
            im.load()
        except Exception as e:
            echecs.append((nom, str(e)[:60]))
            continue

        l0, h0 = im.size
        if im.mode in ('RGBA', 'LA', 'P'):
            im = im.convert('RGBA')
            fond = Image.new('RGB', im.size, (255, 255, 255))
            fond.paste(im, mask=im.split()[-1])
            im = fond
        elif im.mode != 'RGB':
            im = im.convert('RGB')

        if max(im.size) > COTE_MAX:
            r = COTE_MAX / float(max(im.size))
            im = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))),
                           Image.LANCZOS)

        sortie = os.path.splitext(nom)[0] + '.jpg'
        chemin = os.path.join(img_dir, sortie)
        im.save(chemin, 'JPEG', quality=QUALITE, optimize=True, progressive=True)
        taille = os.path.getsize(chemin)
        apres += taille

        ligne = par_image.get(nom)
        if ligne is None:
            orphelines.append(nom)
            ligne = {c: '' for c in entetes} if entetes else {}
            ligne['id'] = os.path.splitext(nom)[0]
        ligne['image'] = sortie
        ligne['largeur'] = im.width
        ligne['hauteur'] = im.height
        ligne['octets'] = taille
        ligne['_source_l'] = l0
        ligne['_source_h'] = h0
        faits.append(ligne)

        if n % 50 == 0:
            print("  %3d / %d  (%.0f s)" % (n, len(images), time.time() - t0))

    # --- manifeste enrichi ---
    colonnes = (entetes or ['id', 'ligne', 'titre', 'date', 'artiste', 'lieu', 'image', 'tags'])
    colonnes = list(colonnes) + ['largeur', 'hauteur', 'octets']
    ordre = {l.get('image'): l for l in faits}
    sortie_csv = os.path.join(racine, 'manifest.csv')
    with io.open(sortie_csv, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=colonnes, delimiter=';', extrasaction='ignore')
        w.writeheader()
        for l in sorted(faits, key=lambda x: int(x.get('ligne') or 0)):
            w.writerow(l)

    sans_image = [l for l in lignes if not l.get('image')]

    print("\n" + "=" * 62)
    print("Converties      : %d" % len(faits))
    print("Echecs          : %d" % len(echecs))
    for nom, err in echecs[:10]:
        print("    %s -- %s" % (nom, err))
    print("Sans entree au manifeste : %d" % len(orphelines))
    for nom in orphelines[:10]:
        print("    %s" % nom)
    print("Lignes du manifeste sans image : %d" % len(sans_image))
    print("-" * 62)
    print("Avant : %s" % humain(avant))
    print("Apres : %s   (%.1f %% du volume d'origine)"
          % (humain(apres), 100.0 * apres / avant if avant else 0))
    print("Duree : %.0f s" % (time.time() - t0))
    print("Sorties : %s  et  %s" % (img_dir, sortie_csv))


if __name__ == '__main__':
    main()
