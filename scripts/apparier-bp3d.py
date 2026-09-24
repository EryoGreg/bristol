#!/usr/bin/env python3
"""Apparie les fiches du deck anatomie à des concepts BodyParts3D (FMA) rendables.

Lit  data/anatomie/contenu.csv  +  l'index FMA + la liste des STL disponibles
(miroir Kevin-Mattheus-Moerman/BodyParts3D). Traduit le nom TA latin en anglais
via un lexique + règles morphologiques, cherche le meilleur concept FMA qui
possède un maillage STL (direct, ou latéralisé « Right/Left »), et écrit un
brouillon  data/anatomie/bp3d.json .

Rien n'est rendu ici — sortie = config à relire. Voir rendre-anatomie.py.

  python scripts/apparier-bp3d.py            # (re)génère le brouillon
  python scripts/apparier-bp3d.py --montre   # affiche les candidats sans écrire
"""
from __future__ import annotations

import csv
import difflib
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RACINE = Path(__file__).resolve().parent.parent
DECK = RACINE / "data" / "anatomie"
CACHE = DECK / "_bp3d-cache"
CONFIG = DECK / "bp3d.json"

TREE_API = (
    "https://api.github.com/repos/Kevin-Mattheus-Moerman/BodyParts3D/"
    "git/trees/main?recursive=1"
)
FMA_CSV = (
    "https://raw.githubusercontent.com/Kevin-Mattheus-Moerman/BodyParts3D/main/"
    "assets/BodyParts3D_data/FMA.csv"
)

SEUIL_AUTO = 0.72  # score difflib au-dessus duquel on retient sans broncher

# systèmes où un rendu 3D BodyParts3D a du sens ET où le sous-ensemble STL livre
# la classe (os, muscles). Nerfs/artères/veines/foramens/méninges : maillages
# absents ou inexploitables -> jamais en auto, toujours à trancher.
SYSTEMES_AUTO = {"Ostéologie", "Myologie", "Myologie, Mastication"}

# --- lexique latin (TA) -> anglais (label FMA) ----------------------------------
OS = {
    "frontale": "frontal bone", "parietale": "parietal bone",
    "occipitale": "occipital bone", "temporale": "temporal bone",
    "sphenoidale": "sphenoid bone", "ethmoidale": "ethmoid bone",
    "zygomaticum": "zygomatic bone", "nasale": "nasal bone",
    "palatinum": "palatine bone", "lacrimale": "lacrimal bone",
    "maxilla": "maxilla", "mandibula": "mandible", "vomer": "vomer",
    "hyoideum": "hyoid bone",
}
MOTS = {
    # génériques
    "musculus": "", "musculi": "", "arteria": "", "vena": "", "nervus": "",
    "glandula": "", "glandulae": "", "cartilago": "", "cartilagines": "",
    "membrana": "", "ligamentum": "", "ligamenta": "", "os": "", "processus": "",
    "foramen": "foramen", "canalis": "canal", "fissura": "fissure",
    "sinus": "sinus", "concha": "concha", "tonsilla": "tonsil",
    "bulbus": "", "lamina": "lamina", "apparatus": "apparatus",
    "ductus": "duct", "tuba": "tube", "plexus": "plexus", "ganglion": "ganglion",
    "nodi": "lymph nodes", "lymphoidei": "", "regio": "region",
    "articulatio": "joint", "vagina": "sheath", "fascia": "fascia",
    # adjectifs / directions
    "superior": "superior", "inferior": "inferior", "anterior": "anterior",
    "posterior": "posterior", "medialis": "medial", "lateralis": "lateral",
    "medius": "middle", "communis": "common", "externa": "external",
    "interna": "internal", "profunda": "deep", "superficialis": "superficial",
    "magnus": "great", "major": "greater", "minor": "lesser",
    "transversus": "transverse", "sagittalis": "sagittal", "rotundum": "round",
    "ovale": "oval", "spinosum": "spinous", "lacerum": "lacerate",
    "jugulare": "jugular", "opticus": "optic", "magnum": "magnum",
    "cranii": "", "cranialis": "cranial", "cervicalis": "cervical",
    "cervicales": "cervical", "orbitalis": "orbital", "orbita": "orbit",
    # racines fréquentes
    "masseter": "masseter", "temporalis": "temporalis", "buccinator": "buccinator",
    "pterygoideus": "pterygoid", "occipitofrontalis": "occipitofrontalis",
    "orbicularis": "orbicularis", "oculi": "oculi", "oris": "oris",
    "platysma": "platysma", "sternocleidomastoideus": "sternocleidomastoid",
    "trapezius": "trapezius", "digastricus": "digastric",
    "mylohyoideus": "mylohyoid", "geniohyoideus": "geniohyoid",
    "stylohyoideus": "stylohyoid", "sternohyoideus": "sternohyoid",
    "sternothyroideus": "sternothyroid", "thyrohyoideus": "thyrohyoid",
    "omohyoideus": "omohyoid", "scalenus": "scalene", "anterior)": "anterior",
    "longus": "longus", "colli": "colli", "capitis": "capitis",
    "genioglossus": "genioglossus", "hyoglossus": "hyoglossus",
    "styloglossus": "styloglossus", "cricothyroideus": "cricothyroid",
    "cricoarytenoideus": "cricoarytenoid", "thyroarytenoideus": "thyroarytenoid",
    "arytenoideus": "arytenoid", "constrictor": "constrictor",
    "pharyngis": "pharynx", "thyroidea": "thyroid", "cricoidea": "cricoid",
    "arytenoideae": "arytenoid", "thyroiddea": "thyroid",
    "carotis": "carotid", "facialis": "facial", "lingualis": "lingual",
    "occipitalis": "occipital", "maxillaris": "maxillary", "vertebralis": "vertebral",
    "ophthalmica": "ophthalmic", "meningea": "meningeal", "thyroidea": "thyroid",
    "jugularis": "jugular", "opticus": "optic", "trigeminus": "trigeminal",
    "vagus": "vagus", "hypoglossus": "hypoglossal", "accessorius": "accessory",
    "abducens": "abducens", "trochlearis": "trochlear", "oculomotorius": "oculomotor",
    "glossopharyngeus": "glossopharyngeal", "olfactorius": "olfactory",
    "vestibulocochlearis": "vestibulocochlear", "opticus)": "optic",
    "parotidea": "parotid", "submandibularis": "submandibular",
    "sublingualis": "sublingual", "lacrimalis": "lacrimal",
    "epiglottis": "epiglottis", "lingua": "tongue", "pharynx": "pharynx",
    "larynx": "larynx", "cornea": "cornea", "lens": "lens", "retina": "retina",
    "cochlea": "cochlea", "vestibulum": "vestibule", "atlas": "atlas", "axis": "axis",
    "dentes": "tooth", "dura": "dura", "mater": "mater", "falx": "falx",
    "cerebri": "cerebri", "tentorium": "tentorium", "cerebelli": "cerebelli",
    "arachnoidea": "arachnoid", "pia": "pia", "bulbi": "",
    "rectus": "rectus", "obliquus": "oblique", "levator": "levator",
    "palpebrae": "palpebrae", "superioris": "superioris", "veli": "veli",
    "palatini": "palatini", "tympanica": "tympanic", "auditiva": "auditory",
    "semicirculares": "semicircular", "vocales": "vocal", "plicae": "folds",
}

# override manuel : id_fiche -> FMA concept (gèle l'appariement). stl_pour()
# redescend vers la version latéralisée si le concept n'a pas de maillage propre.
OVERRIDE: dict[str, int] = {
    # --- os (concepts génériques ; rendu = version droite quand pair) ---
    "os_frontal": 52734, "os_parietal": 9613, "os_occipital": 52735,
    "os_temporal": 52737, "os_sphenoide": 52736, "os_ethmoide": 52740,
    "maxillaire": 9711, "mandibule": 52748, "os_zygomatique": 52747,
    "os_nasal": 52745, "os_palatin": 52746, "vomer": 9710,
    "cornet_nasal_inferieur": 54736, "os_hyoide": 52749,
    "atlas": 12519, "axis": 12520, "vertebre_cervicale": 12521,
    # --- muscles / divers : concept générique, maillage confirmé.
    #     Les autres muscles passent par l'appariement auto (fiable sur la
    #     nomenclature myologique). Ici seulement ceux qu'auto rate. ---
    "muscle_pterygoidien_medial": 49011, "muscle_scalene_moyen": 13386,
    "cartilage_thyroide": 55099, "globe_oculaire": 12513,
}

# fiches qui ne doivent JAMAIS recevoir un rendu 3D : vues d'ensemble du crâne,
# foramens (trous, pas des maillages), régions topographiques, concepts abstraits,
# ou structures dont le maillage manque et qu'un faux positif viendrait polluer.
EXCLURE = {
    "crane_vue_anterieure", "crane_vue_laterale", "base_crane_inferieure",
    "base_crane_endocranienne", "calvaria", "fontanelle", "processus_pterygoide",
    "muscles_mimique", "muscle_orbiculaire_oeil",
    "muscle_droit_lateral", "muscle_oblique_superieur", "muscle_releveur_paupiere",
    "muscles_oculomoteurs", "anneau_tendineux_zinn", "muscles_oreille_moyenne",
    "orbite_osseuse", "muscle_occipitofrontal", "crane_vue_anterieure",
}


def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "bristol-bp3d"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def charger_index():
    CACHE.mkdir(parents=True, exist_ok=True)
    f_fma = CACHE / "FMA.csv"
    f_tree = CACHE / "tree.json"
    if not f_fma.exists():
        urllib.request.urlretrieve(FMA_CSV, f_fma)
    if not f_tree.exists():
        json.dump(http_json(TREE_API), open(f_tree, "w"))

    stl = set()
    for t in json.load(open(f_tree))["tree"]:
        m = re.match(r"assets/BodyParts3D_data/stl/FMA(\d+)[a-z]*\.stl$", t["path"])
        if m:
            stl.add(int(m.group(1)))

    label = {}
    with open(f_fma, newline="", encoding="utf-8") as fh:
        rd = csv.reader(fh)
        next(rd)
        for row in rd:
            if len(row) >= 2:
                try:
                    label[int(row[0])] = row[1]
                except ValueError:
                    pass
    par_nom = {}
    for fid, lbl in label.items():
        par_nom.setdefault(lbl.lower(), fid)
    return stl, label, par_nom


def traduire(latin: str) -> str:
    latin = latin.lower()
    latin = re.sub(r"\(.*?\)", " ", latin)
    latin = latin.replace("mm.", " ").replace("m.", " ").replace("et", " ")
    toks = re.findall(r"[a-zà-ÿ]+", latin)
    out = []
    for t in toks:
        if t in OS:
            out.append(OS[t])
        elif t in MOTS:
            if MOTS[t]:
                out.append(MOTS[t])
        else:
            out.append(t)
    return " ".join(out).strip()


def stl_pour(fid: int, stl: set, label: dict) -> int | None:
    """Renvoie le FMA à rendre pour un concept : lui-même, ou une version R/L."""
    if fid in stl:
        return fid
    lbl = label.get(fid, "")
    for cote in ("Right ", "Left "):
        cand = (par_nom_global.get((cote + lbl).lower()))
        if cand and cand in stl:
            return cand
    return None


par_nom_global: dict = {}

# plan de prise de vue par fiche : (clé de _contextes, clé de CAMERAS).
# Défaut si absent : ("crane", "trois_quarts").
PLANS = {
    # voûte / face — vue de face
    "os_frontal": ("crane", "avant"), "os_parietal": ("crane", "profil"),
    "os_occipital": ("crane", "profil"), "os_temporal": ("crane", "profil"),
    "os_sphenoide": ("crane", "avant"), "os_ethmoide": ("crane", "avant"),
    "maxillaire": ("crane", "avant"), "mandibule": ("crane", "trois_quarts"),
    "os_zygomatique": ("crane", "trois_quarts"), "os_nasal": ("crane", "avant"),
    "os_palatin": ("crane", "trois_quarts_bas"), "vomer": ("crane", "avant"),
    "cornet_nasal_inferieur": ("crane", "avant"), "os_hyoide": ("hyoide_cervical", "trois_quarts"),
    # rachis cervical
    "atlas": ("cervical", "trois_quarts"), "axis": ("cervical", "trois_quarts"),
    "vertebre_cervicale": ("cervical", "trois_quarts"),
    # masticateurs — profil
    "muscle_temporal": ("crane", "profil"), "muscle_masseter": ("crane", "profil"),
    "muscle_pterygoidien_medial": ("crane", "trois_quarts_bas"),
    "muscle_pterygoidien_lateral": ("crane", "trois_quarts_bas"),
    # suprahyoïdiens — vue antéro-inférieure
    "muscle_mylo_hyoidien": ("mandibule_hyoide", "trois_quarts_bas"),
    "muscle_genio_hyoidien": ("mandibule_hyoide", "trois_quarts_bas"),
    "muscle_stylo_hyoidien": ("mandibule_hyoide", "trois_quarts"),
    "muscle_digastrique": ("mandibule_hyoide", "trois_quarts_bas"),
    # infrahyoïdiens / larynx — cou antérieur
    "muscle_sterno_hyoidien": ("hyoide_cervical", "trois_quarts"),
    "muscle_sterno_thyroidien": ("hyoide_cervical", "trois_quarts"),
    "muscle_thyro_hyoidien": ("hyoide_cervical", "trois_quarts"),
    "muscle_omo_hyoidien": ("hyoide_cervical", "trois_quarts"),
    "cartilage_thyroide": ("hyoide_cervical", "trois_quarts"),
    # muscles latéraux du cou — profil
    "muscle_sterno_cleido_mastoidien": ("crane_cervical", "profil"),
    "muscle_trapeze": ("crane_cervical", "profil"),
    "muscle_scalene_anterieur": ("crane_cervical", "profil"),
    "muscle_scalene_moyen": ("crane_cervical", "profil"),
    "muscle_scalene_posterieur": ("crane_cervical", "profil"),
    "muscle_long_du_cou": ("crane_cervical", "profil"),
    "muscle_long_de_la_tete": ("crane_cervical", "profil"),
    # face superficielle
    "muscle_buccinateur": ("crane", "trois_quarts"),
    "muscle_orbiculaire_bouche": ("crane", "trois_quarts"),
    "platysma": ("crane_cervical", "trois_quarts"),
    "globe_oculaire": ("crane", "trois_quarts"),
}


def apparier(montre=False):
    global par_nom_global
    stl, label, par_nom = charger_index()
    par_nom_global = par_nom

    # pool = tous les labels FMA qui ont un STL exploitable
    pool = {}
    for fid, lbl in label.items():
        rid = stl_pour(fid, stl, label)
        if rid:
            pool.setdefault(lbl.lower(), (fid, rid))
    labels = list(pool)

    rows = list(csv.DictReader(open(DECK / "contenu.csv", encoding="utf-8"), delimiter="\t"))

    fiches, candidats = {}, {}
    n_auto = n_over = n_faible = n_exclu = 0
    for r in rows:
        fid_ = r["id"]
        latin = r.get("nom_latin", "")
        if fid_ in EXCLURE:
            n_exclu += 1
            continue
        if fid_ in OVERRIDE:
            concept = OVERRIDE[fid_]
            rid = stl_pour(concept, stl, label)
            if not rid:
                print(f"  ! override {fid_} -> FMA{concept} : aucun STL, ignoré")
                continue
            fiches[fid_] = {"cible": rid, "concept": concept, "systeme": r["systeme"],
                            "nom": label.get(concept, latin), "src": "override"}
            n_over += 1
            continue
        q = traduire(latin)
        best = difflib.get_close_matches(q, labels, n=4, cutoff=0.4)
        scored = sorted(
            ((difflib.SequenceMatcher(None, q, b).ratio(), b) for b in best),
            reverse=True,
        )
        qtok = {t for t in re.findall(r"[a-z]+", q) if len(t) >= 4}
        partage = scored and qtok & {
            t for t in re.findall(r"[a-z]+", scored[0][1]) if len(t) >= 4
        }
        if (r["systeme"] in SYSTEMES_AUTO and scored
                and scored[0][0] >= SEUIL_AUTO and partage):
            lbl = scored[0][1]
            concept, rid = pool[lbl]
            fiches[fid_] = {"cible": rid, "concept": concept, "nom": label[concept],
                            "systeme": r["systeme"],
                            "score": round(scored[0][0], 2), "src": "auto"}
            n_auto += 1
        else:
            candidats[fid_] = {
                "latin": latin, "requete": q,
                "pistes": [{"fma": pool[b][1], "nom": label[pool[b][0]],
                            "score": round(s, 2)} for s, b in scored],
            }
            n_faible += 1

    print(f"override {n_over} | auto {n_auto} | exclus {n_exclu} | "
          f"à trancher {n_faible} | total {len(rows)}")
    if montre:
        for k, v in candidats.items():
            print(f"\n{k}  «{v['latin']}»  -> {v['requete']}")
            for p in v["pistes"]:
                print(f"    {p['score']}  FMA{p['fma']}  {p['nom']}")
        return

    doc = {
        "_licence": "BodyParts3D, (c) The Database Center for Life Science, "
                    "CC-BY-SA 2.1 Japan — https://lifesciencedb.jp/bp3d/",
        "_note": "Brouillon généré par apparier-bp3d.py. Relire 'fiches' "
                 "(vérifier chaque FMA), compléter '_a_trancher' à la main, "
                 "puis rendre-anatomie.py. contexte = clé de _contextes ou "
                 "liste de FMA. cam = clé de CAMERAS (rendre-anatomie.py).",
        "_contextes": {
            "crane": [52734, 52735, 52736, 9710, 52748, 52788, 52789, 52738,
                      52739, 52892, 52893, 53647, 53648, 53649, 53650, 53645,
                      53646, 53655, 53656, 54737, 54738, 52749],
            "cervical": [12520, 12521, 12522, 12523, 12524],
            "crane_cervical": [52734, 52735, 52736, 52748, 52788, 52789, 52738,
                               52739, 52749, 12519, 12520, 12521, 12522, 12523],
            "hyoide_cervical": [52749, 12519, 12520, 12521, 12522, 12523, 12524],
            "mandibule_hyoide": [52748, 52749],
        },
        "fiches": {
            k: {"cible": v["cible"],
                **({"concept": v["concept"]} if v.get("concept") != v["cible"] else {}),
                "contexte": PLANS.get(k, ("crane", "trois_quarts"))[0],
                "cam": PLANS.get(k, ("crane", "trois_quarts"))[1],
                "_nom": v["nom"], "_src": v["src"],
                **({"_score": v["score"]} if "score" in v else {})}
            for k, v in fiches.items()
        },
        "_a_trancher": candidats,
    }
    CONFIG.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"-> {CONFIG.relative_to(RACINE)}")


if __name__ == "__main__":
    apparier(montre="--montre" in sys.argv)
