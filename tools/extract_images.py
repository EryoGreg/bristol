# -*- coding: utf-8 -*-
"""
Extrait les images de la colonne 1 du GDoc "Liste d'oeuvres" et les associe a leur oeuvre.

Entree  : le .zip produit par Google Docs (Fichier > Telecharger > Page Web (.html, compresse))
Sorties : images/<id>.<ext>   une image par oeuvre, nommee par l'ID derive
          manifest.csv        id;ligne;titre;date;artiste;lieu;image;tags

Usage :
    python extract_images.py "C:\\chemin\\Liste d'oeuvres.zip" [dossier_sortie]

Stdlib uniquement (zipfile + html.parser). Le GDoc n'est jamais modifie.
"""
import sys, os, re, csv, zipfile, unicodedata, io
from html.parser import HTMLParser

IMG_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg")


def slug(s, maxlen=48):
    """Slug ASCII stable, utilise pour construire l'ID d'une oeuvre."""
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:maxlen] or "sans-titre"


class TableParser(HTMLParser):
    """Recupere les lignes de tableau : pour chaque cellule, son texte et ses <img src>."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self._row = None
        self._cell = None
        self._depth = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "tr":
            self._row = []
        elif tag == "td" or tag == "th":
            self._cell = {"text": [], "imgs": []}
        elif tag == "img" and self._cell is not None:
            src = a.get("src", "")
            if src:
                self._cell["imgs"].append(src)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            txt = re.sub(r"\s+", " ", "".join(self._cell["text"])).strip()
            self._row.append({"text": txt, "imgs": self._cell["imgs"]})
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell["text"].append(data)


def load_zip(path):
    z = zipfile.ZipFile(path)
    names = z.namelist()
    html_names = [n for n in names if n.lower().endswith((".html", ".htm"))]
    if not html_names:
        raise SystemExit("Aucun .html dans le zip. Contenu : %s" % names[:20])
    html_name = sorted(html_names, key=lambda n: -z.getinfo(n).file_size)[0]
    raw = z.read(html_name)
    for enc in ("utf-8", "cp1252", "latin-1"):
        try:
            html = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    return z, html, html_name


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    zip_path = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(zip_path)), "extraction")
    img_dir = os.path.join(out_dir, "images")
    os.makedirs(img_dir, exist_ok=True)

    z, html, html_name = load_zip(zip_path)
    print("HTML lu :", html_name, "(%d car.)" % len(html))

    p = TableParser()
    p.feed(html)
    print("Lignes de tableau brutes :", len(p.rows))

    # La ligne d'en-tete donne l'indice des colonnes utiles.
    header_idx = None
    for i, row in enumerate(p.rows):
        joined = " ".join(c["text"].lower() for c in row)
        if "artiste" in joined and "titre" in joined and "tags" in joined:
            header_idx = i
            break
    if header_idx is None:
        raise SystemExit("En-tete introuvable (attendu : Artiste / Titre / ... / Tags).")

    header = [c["text"].strip().lower() for c in p.rows[header_idx]]
    print("En-tete :", header)

    def col(*keys):
        for k in keys:
            for j, h in enumerate(header):
                if h.startswith(k):
                    return j
        return None

    c_art, c_tit = col("artiste"), col("titre")
    c_dat, c_lie = col("date"), col("lieu")
    c_des, c_tag = col("description"), col("tags")

    rows = p.rows[header_idx + 1:]
    manifest = []
    seen = {}
    n_img = 0

    for n, row in enumerate(rows, start=1):
        def cell(j):
            return row[j]["text"] if (j is not None and j < len(row)) else ""

        titre, date = cell(c_tit), cell(c_dat)
        if not any(cell(j) for j in (c_art, c_tit, c_dat, c_des, c_tag)):
            continue  # ligne entierement vide

        base = "%s_%s" % (slug(titre), slug(date, 16))
        seen[base] = seen.get(base, 0) + 1
        wid = base if seen[base] == 1 else "%s-%d" % (base, seen[base])

        # toute image de la ligne, la colonne 1 en priorite
        srcs = []
        for c in row:
            srcs.extend(c["imgs"])
        out_name = ""
        if srcs:
            src = srcs[0]
            member = src.replace("\\", "/").lstrip("./")
            candidates = [m for m in z.namelist() if m.replace("\\", "/").endswith(member)]
            if candidates:
                member = candidates[0]
                ext = os.path.splitext(member)[1].lower()
                if ext not in IMG_EXT:
                    ext = ".png"
                out_name = wid + ext
                with open(os.path.join(img_dir, out_name), "wb") as f:
                    f.write(z.read(member))
                n_img += 1

        manifest.append({
            "id": wid, "ligne": n, "titre": titre, "date": date,
            "artiste": cell(c_art), "lieu": cell(c_lie),
            "image": out_name, "tags": cell(c_tag),
        })

    csv_path = os.path.join(out_dir, "manifest.csv")
    with io.open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "ligne", "titre", "date", "artiste", "lieu", "image", "tags"],
                           delimiter=";")
        w.writeheader()
        w.writerows(manifest)

    sans = [m for m in manifest if not m["image"]]
    print()
    print("Oeuvres      :", len(manifest))
    print("Images ecrites:", n_img, "->", img_dir)
    print("Sans image   :", len(sans))
    for m in sans[:15]:
        print("   ligne %-4s %s" % (m["ligne"], m["titre"][:60]))
    if len(sans) > 15:
        print("   ... et %d autres" % (len(sans) - 15))
    print("Manifeste    :", csv_path)


if __name__ == "__main__":
    main()
