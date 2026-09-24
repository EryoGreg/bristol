# -*- coding: utf-8 -*-
"""Ajoute des fiches a data/anatomie/contenu.csv depuis un fichier JSON.

  python scripts/ajouter-fiches.py data/anatomie/lots/<lot>.json

Le JSON = liste d'objets ; chaque objet a les cles de COLS (image_src defaut
'libre', image_legende defaut ''). Verifie l'absence de tab / newline, refuse
un id deja present, ecrit en TSV.
"""
import sys, os, json, csv

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV = os.path.join(RACINE, "data", "anatomie", "contenu.csv")
COLS = ["id","image","image_src","image_legende","nom_fr","nom_latin","region",
        "systeme","fonction","rapports","notes_cliniques","sources","importance"]

def main():
    lot = json.load(open(sys.argv[1], encoding="utf-8"))
    existants = set()
    with open(CSV, encoding="utf-8") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            existants.add(r["id"])
    lignes = []
    for f in lot:
        if f["id"] in existants:
            print(f"  ! {f['id']} deja present, ignore"); continue
        f.setdefault("image_src", "libre")
        f.setdefault("image_legende", "")
        row = [str(f.get(c, "")) for c in COLS]
        for v in row:
            assert "\t" not in v and "\n" not in v, (f["id"], v[:60])
        lignes.append("\t".join(row))
    if not lignes:
        print("rien a ajouter"); return
    txt = open(CSV, encoding="utf-8").read()
    if not txt.endswith("\n"):
        txt += "\n"
    open(CSV, "w", encoding="utf-8", newline="").write(txt + "\n".join(lignes) + "\n")
    print(f"{len(lignes)} fiches ajoutees -> {CSV}")

if __name__ == "__main__":
    main()
