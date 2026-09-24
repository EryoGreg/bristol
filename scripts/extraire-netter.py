#!/usr/bin/env python3
"""
Extrait la section « Tête et cou » de l'Atlas Netter (6e éd. FR) vers le deck
data/anatomie/.

Deux sources se complètent :
  - epub 6e éd. (text/PL16..PL166.xhtml)  -> n° de planche, titre, groupe (fiables)
  - PDF 6e éd.                             -> rendu haute résolution de la page
                                             + liste des légendes (texte vectoriel)

Sorties :
  data/anatomie/planches-source.csv   pl ; groupe ; titre ; page_pdf ; n_legendes
  data/anatomie/planches-legendes.json { "pl001": ["Bord infra-orbitaire", ...] }
  data/anatomie/images/ebook/pl###.jpg  page PDF rendue (~200 dpi)

Usage :
  python scripts/extraire-netter.py <epub 6e> <pdf 6e> [dpi=200]
"""
import sys, os, re, json, zipfile, html

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECK = os.path.join(RACINE, "data", "anatomie")
IMG = os.path.join(DECK, "images", "ebook")
WM = "BIBLIOTHEQUE DE LA RECHERCHE"


def strip_tags(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()


def lire_epub(chemin):
    """[(pl_index 1..N, groupe, titre)]"""
    z = zipfile.ZipFile(chemin)
    noms = {n.split("/")[-1]: n for n in z.namelist()}
    out, groupe = [], ""
    for i in range(16, 167):        # PL16..PL166 = section 1 « Tête et cou »
        n = noms.get(f"PL{i}.xhtml")
        if not n:
            continue
        t = z.read(n).decode("utf-8", "replace")
        h2 = strip_tags((re.search(r"<h2[^>]*>(.*?)</h2>", t, re.S) or [None, ""])[1])
        h3 = strip_tags((re.search(r"<h3[^>]*>(.*?)</h3>", t, re.S) or [None, ""])[1])
        if h2 and h2 != "Tête et cou":
            groupe = h2
        out.append((len(out) + 1, groupe, h3))
    return out


def normaliser(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()
                  .translate(str.maketrans("àâäéèêëïîôöùûüç", "aaaeeeeiioouuuc"))).strip()


def legendes_page(page):
    """Lignes courtes = légendes ; recolle les coupures douces ('Artère et veine \\nfaciales')."""
    lignes = [l.strip() for l in page.get_text().split("\n")]
    lignes = [l for l in lignes if l and WM not in l]
    out, buf = [], ""
    for l in lignes:
        if re.fullmatch(r"(Voir aussi.*|Planche \d+|Tête et cou|\d+|Section \d+.*)", l):
            continue
        if len(l) > 60:               # phrase -> pas une légende
            if buf:
                out.append(buf.strip()); buf = ""
            continue
        if l.endswith(("et", "de", "du", "des", "la", "le", "l'", "à", "-", ",")) or l[0].islower():
            buf += " " + l
        else:
            if buf:
                out.append(buf.strip())
            buf = l
    if buf:
        out.append(buf.strip())
    # dédoublonne en gardant l'ordre
    vus, res = set(), []
    for l in out:
        k = normaliser(l)
        if k and k not in vus and len(k) > 2:
            vus.add(k); res.append(l)
    return res


def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    epub, pdf = sys.argv[1], sys.argv[2]
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 200
    import pymupdf

    os.makedirs(IMG, exist_ok=True)
    planches = lire_epub(epub)
    print(f"{len(planches)} planches (epub)")

    d = pymupdf.open(pdf)
    # index texte de toutes les pages (12..185)
    pages_txt = {i: d[i].get_text() for i in range(12, min(190, d.page_count))}

    # TSV (tabulation) : les titres de planche ne contiennent jamais de tabulation
    csv = ["pl\tgroupe\ttitre\tpage_pdf\tn_legendes"]
    legendes = {}
    for idx, groupe, titre in planches:
        pl = f"pl{idx:03d}"
        cible_titre = normaliser(titre)[:40]
        page_num = None
        candidats = []
        for i, t in pages_txt.items():
            if not re.search(rf"Planche\s+{idx}\b", t):
                continue
            # exclut les pages « sommaire de section » qui citent plein de planches
            if len(re.findall(r"Planche\s+\d+", t)) > 3 or "Sommaire" in t:
                continue
            nn = normaliser(t)
            score = (2 if cible_titre and cible_titre in nn else 0) + min(len(legendes_page(d[i])), 30) / 30
            candidats.append((score, i))
        if candidats:
            page_num = max(candidats)[1]
        legs = []
        if page_num is not None:
            page = d[page_num]
            pix = page.get_pixmap(dpi=dpi)
            # rogne les bandeaux haut/bas (filigrane « BIBLIOTHEQUE DE LA RECHERCHE… »)
            h_band = round(pix.height * 0.045)
            f_band = round(pix.height * 0.047)
            from PIL import Image as _I
            im = _I.frombytes("RGB", (pix.width, pix.height), pix.samples)
            im.crop((0, h_band, pix.width, pix.height - f_band)).save(
                os.path.join(IMG, pl + ".jpg"), quality=88)
            legs = legendes_page(page)
        legendes[pl] = legs
        cl = lambda s: re.sub(r"\s+", " ", (s or "")).replace("\t", " ").strip()
        csv.append("\t".join([pl, cl(groupe), cl(titre),
                              str(page_num + 1 if page_num is not None else ""), str(len(legs))]))

    open(os.path.join(DECK, "planches-source.csv"), "w", encoding="utf-8").write("\n".join(csv) + "\n")
    json.dump(legendes, open(os.path.join(DECK, "planches-legendes.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    n_img = len([f for f in os.listdir(IMG) if f.startswith("pl") and f.endswith(".jpg")])
    print(f"-> planches-source.csv ({len(csv)-1} lignes)")
    print(f"-> planches-legendes.json")
    print(f"-> {n_img} pages rendues @ {dpi} dpi dans {IMG}")


if __name__ == "__main__":
    main()
