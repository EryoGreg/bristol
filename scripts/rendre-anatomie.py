#!/usr/bin/env python3
"""Rendu 3D de structures anatomiques depuis BodyParts3D, piloté par bp3d.json.

Pour chaque fiche de  data/anatomie/bp3d.json['fiches'] :
  - charge le maillage cible + les maillages de contexte (STL du miroir
    Kevin-Mattheus-Moerman/BodyParts3D, keyé par FMA, mis en cache)
  - deux passes opaques séparées (cible / contexte) rendues avec pyrender
    offscreen, recomposées en NumPy — contourne le tri de transparence bancal
    de pyrender
  - cible en rouge opaque, toujours au-dessus ; contexte en trace fantôme grise
    pour situer

BodyParts3D, (c) The Database Center for Life Science, CC-BY-SA 2.1 Japan.
https://lifesciencedb.jp/bp3d/

Sorties :
  (défaut)      PNG 1400 px -> data/anatomie/_bp3d-rendu/<id>.png   (relecture)
  --gif         GIF tournant -> data/anatomie/_bp3d-rendu/<id>.gif  (relecture)
  --ecrire      JPEG <=1500 px -> data/anatomie/images/libre/<id>.jpg
                + entrée dans credits-libre.json  (intègre au deck)

  python scripts/rendre-anatomie.py [--ecrire] [--gif] [--fiche <id> ...] [--force]
"""
from __future__ import annotations

import io
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import trimesh

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import pyrender  # noqa: E402  (import après reconfigure : ok)
from PIL import Image  # noqa: E402

RACINE = Path(__file__).resolve().parent.parent
DECK = RACINE / "data" / "anatomie"
CACHE = DECK / "_bp3d-cache"
RENDU = DECK / "_bp3d-rendu"
LIBRE = DECK / "images" / "libre"
CONFIG = DECK / "bp3d.json"
CREDITS = DECK / "credits-libre.json"

STL_URL = (
    "https://raw.githubusercontent.com/Kevin-Mattheus-Moerman/BodyParts3D/main/"
    "assets/BodyParts3D_data/stl/FMA{fma}.stl"
)
CREDIT = {
    "auteur": "The Database Center for Life Science — BodyParts3D",
    "licence": "CC-BY-SA 2.1 Japan",
    "source": "https://lifesciencedb.jp/bp3d/",
}

COULEUR_CIBLE = np.array([0.83, 0.22, 0.20])
COULEUR_CONTEXTE = np.array([0.42, 0.44, 0.52])
GHOST = 0.42                 # opacité de la trace fantôme du contexte (0-1)
TAILLE = 1400
SS = 2                       # super-échantillonnage anti-aliasing
JPEG_MAX_PX = 1500
JPEG_MAX_KO = 450

CAMERAS = {  # (azimut°, élévation°) — az 0 = face, +90 = côté ; el + = vue plongeante
    "avant": (12, 6),
    "avant_leger": (20, 8),
    "trois_quarts": (35, 12),
    "trois_quarts_haut": (35, 28),
    "trois_quarts_bas": (35, -18),
    "profil": (80, 6),
    "profil_haut": (72, 24),
}
CADRAGE = 5.2  # distance caméra = rayon cible × CADRAGE (plus grand = plus large)


# --------------------------------------------------------------------------- STL
_meshes: dict[int, trimesh.Trimesh | None] = {}


def charger_stl(fma: int) -> trimesh.Trimesh | None:
    if fma in _meshes:
        return _meshes[fma]
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"FMA{fma}.stl"
    if not f.exists():
        try:
            print(f"  ↓ FMA{fma}")
            with urllib.request.urlopen(STL_URL.format(fma=fma), timeout=60) as r:
                f.write_bytes(r.read())
        except urllib.error.HTTPError as e:
            print(f"  ! FMA{fma} absent du miroir ({e.code})")
            _meshes[fma] = None
            return None
    m = trimesh.load(io.BytesIO(f.read_bytes()), file_type="stl")
    if isinstance(m, trimesh.Scene):
        m = trimesh.util.concatenate(tuple(m.geometry.values()))
    _meshes[fma] = m
    return m


# ------------------------------------------------------------------------ caméra
def matrice_camera(centre, dist, azimut_deg, elev_deg):
    """BodyParts3D : +X = côté, -Y = antérieur (face), +Z = supérieur."""
    az, el = np.radians(azimut_deg), np.radians(elev_deg)
    direction = np.array([np.sin(az) * np.cos(el),
                          -np.cos(az) * np.cos(el),
                          np.sin(el)])
    oeil = centre + direction * dist
    f = centre - oeil
    f /= np.linalg.norm(f)
    up = np.array([0.0, 0.0, 1.0])           # up vertical -> aucun roll
    s = np.cross(f, up)
    s /= np.linalg.norm(s)
    u = np.cross(s, f)
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = s, u, -f, oeil
    return M


# ------------------------------------------------------------------------ rendu
def _passe(r, meshes, cam_pose, rayon, couleur, rough, ambient, gain):
    sc = pyrender.Scene(bg_color=[0, 0, 0, 0], ambient_light=[ambient] * 3)
    mat = pyrender.MetallicRoughnessMaterial(
        baseColorFactor=[*couleur, 1.0], metallicFactor=0.0, roughnessFactor=rough)
    for m in meshes:
        sc.add(pyrender.Mesh.from_trimesh(m, material=mat, smooth=True))
    sc.add(pyrender.PerspectiveCamera(yfov=np.radians(32.0)), pose=cam_pose)
    for dx, dy, it in [(-0.8, 0.5, 2.4 * gain), (1.1, 0.1, 1.4 * gain)]:
        lp = cam_pose.copy()
        lp[:3, 3] += lp[:3, 0] * rayon * dx * 2 + lp[:3, 1] * rayon * dy * 2
        sc.add(pyrender.DirectionalLight(color=np.ones(3), intensity=it), pose=lp)
    col, depth = r.render(sc)
    return col.astype(np.float32) / 255.0, depth


def _composite(rgb_ctx, d_ctx, rgb_tgt, d_tgt, px):
    out = np.ones((px, px, 3), np.float32)
    if rgb_ctx is not None:
        m = d_ctx > 0
        out[m] = out[m] * (1 - GHOST) + rgb_ctx[m] * GHOST
    m = d_tgt > 0
    out[m] = rgb_tgt[m]
    return np.clip(out, 0, 1)


def rendre(nom, spec, contextes, mode):
    cible = charger_stl(spec["cible"])
    if cible is None:
        print(f"[{nom}] cible FMA{spec['cible']} indisponible — sautée")
        return None

    ctx_fmas = spec.get("contexte", [])
    if isinstance(ctx_fmas, str):
        ctx_fmas = contextes.get(ctx_fmas, [])
    contexte = [m for fma in ctx_fmas if fma != spec["cible"]
                for m in [charger_stl(fma)] if m is not None]

    # cadrage sur la cible (elle occupe ~55 % de l'image, le contexte déborde)
    lo, hi = cible.bounds
    centre = (lo + hi) / 2.0
    rayon_cible = np.linalg.norm(hi - lo) / 2.0
    rayon = max(rayon_cible, 20.0)
    dist = rayon * CADRAGE

    az, el = CAMERAS[spec.get("cam", "trois_quarts")]
    frames = range(0, 360, 15) if mode == "gif" else [0]   # 24 vues pour le GIF
    px = TAILLE * SS
    r = pyrender.OffscreenRenderer(px, px)
    imgs = []
    try:
        for delta in frames:
            cam_pose = matrice_camera(centre, dist, az + delta, el)
            rc = (_passe(r, contexte, cam_pose, rayon, COULEUR_CONTEXTE, 0.95, .15, .5)
                  if contexte else (None, None))
            rt = _passe(r, [cible], cam_pose, rayon, COULEUR_CIBLE, 0.55, .40, 1.0)
            out = _composite(rc[0], rc[1], rt[0], rt[1], px)
            im = Image.fromarray((out * 255).astype(np.uint8))
            if SS > 1:
                im = im.resize((TAILLE, TAILLE), Image.LANCZOS)
            imgs.append(im)
    finally:
        r.delete()

    if mode == "gif":
        RENDU.mkdir(parents=True, exist_ok=True)
        out = RENDU / f"{nom}.gif"
        gif = [im.resize((720, 720), Image.LANCZOS).quantize(colors=128, dither=Image.NONE)
               for im in imgs]
        gif[0].save(out, save_all=True, append_images=gif[1:], duration=110, loop=0,
                    optimize=True)
    elif mode == "ecrire":
        LIBRE.mkdir(parents=True, exist_ok=True)
        out = LIBRE / f"{nom}-3d.jpg"       # part ajoutée, jamais l'image existante
        im = imgs[0]
        if max(im.size) > JPEG_MAX_PX:
            im.thumbnail((JPEG_MAX_PX, JPEG_MAX_PX), Image.LANCZOS)
        q = 88
        while q >= 60:
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=q, optimize=True)
            if buf.tell() <= JPEG_MAX_KO * 1024:
                break
            q -= 6
        out.write_bytes(buf.getvalue())
    else:
        RENDU.mkdir(parents=True, exist_ok=True)
        out = RENDU / f"{nom}.png"
        imgs[0].save(out)

    print(f"[{nom}] → {out.relative_to(RACINE)}"
          + (f"  ({out.stat().st_size // 1024} Ko)" if mode == "ecrire" else ""))
    return spec


def maj_credits(rendues):
    cr = json.loads(CREDITS.read_text("utf-8")) if CREDITS.exists() else {}
    for nom, spec in rendues.items():
        cr[f"{nom}-3d.jpg"] = {
            "structure": spec.get("_nom", nom),
            **CREDIT,
            "note": f"Rendu 3D — FMA{spec['cible']}"
                    + (f" (concept FMA{spec['concept']})" if "concept" in spec else "")
                    + ", contexte + composite via scripts/rendre-anatomie.py",
        }
    CREDITS.write_text(json.dumps(cr, ensure_ascii=False, indent=1), "utf-8")
    print(f"credits-libre.json : {len(rendues)} entrée(s) BodyParts3D")


def maj_contenu(rendues):
    """Ajoute `<id>-3d.jpg` comme part image supplémentaire dans contenu.csv (TSV)."""
    p = DECK / "contenu.csv"
    lignes = p.read_text("utf-8").splitlines()
    entete = lignes[0].split("\t")
    i_id, i_img = entete.index("id"), entete.index("image")
    n = 0
    for k in range(1, len(lignes)):
        cels = lignes[k].split("\t")
        if len(cels) <= max(i_id, i_img):
            continue
        fid = cels[i_id]
        if fid not in rendues:
            continue
        parts = [x for x in cels[i_img].split("|") if x]
        if f"{fid}-3d.jpg" not in parts:
            parts.append(f"{fid}-3d.jpg")
            cels[i_img] = "|".join(parts)
            lignes[k] = "\t".join(cels)
            n += 1
    p.write_text("\n".join(lignes) + "\n", "utf-8")
    print(f"contenu.csv : {n} fiche(s) — part 3D ajoutée")


def main(argv):
    mode = "gif" if "--gif" in argv else "ecrire" if "--ecrire" in argv else "rendu"
    force = "--force" in argv
    filtres = [argv[i + 1] for i, a in enumerate(argv) if a == "--fiche"]

    cfg = json.loads(CONFIG.read_text("utf-8"))
    contextes = cfg.get("_contextes", {})
    fiches = cfg["fiches"]
    if filtres:
        fiches = {k: v for k, v in fiches.items() if k in filtres}

    rendues = {}
    for nom, spec in fiches.items():
        if mode == "ecrire" and not force and (LIBRE / f"{nom}-3d.jpg").exists():
            print(f"[{nom}] {nom}-3d.jpg existe déjà — --force pour régénérer")
            continue
        try:
            r = rendre(nom, spec, contextes, mode)
            if r is not None:
                rendues[nom] = r
        except Exception:  # noqa: BLE001
            import traceback
            traceback.print_exc()

    if mode == "ecrire" and rendues:
        maj_credits(rendues)
        maj_contenu(rendues)


if __name__ == "__main__":
    main(sys.argv[1:])
