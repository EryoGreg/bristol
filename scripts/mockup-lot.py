# -*- coding: utf-8 -*-
"""Genere un mockup HTML d'un lot de fiches anatomie (rendu 'comme dans l'app',
tout revele, images embarquees en base64). Sortie sur stdout path.

  python scripts/mockup-lot.py <slug1> <slug2> ...  > sortie.html
"""
import sys, os, csv, json, base64, html, mimetypes

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECK = os.path.join(RACINE, "data", "anatomie")
LIBRE = os.path.join(DECK, "images", "libre")
slugs = sys.argv[1:]

credits = json.load(open(os.path.join(DECK, "credits-libre.json"), encoding="utf-8"))
rows = {}
with open(os.path.join(DECK, "contenu.csv"), encoding="utf-8") as fh:
    for r in csv.DictReader(fh, delimiter="\t"):
        rows[r["id"]] = r

def datauri(fichier):
    p = os.path.join(LIBRE, fichier)
    mime = mimetypes.guess_type(p)[0] or "image/jpeg"
    if fichier.lower().endswith(".svg"):
        mime = "image/svg+xml"
    b = base64.b64encode(open(p, "rb").read()).decode()
    return f"data:{mime};base64,{b}"

def esc(s): return html.escape(s or "", quote=True)

def dots(n):
    n = int(n or 0)
    d = "".join(f'<span class="dot{" on" if i < n else ""}"></span>' for i in range(5))
    return f'<div class="dots">{d}<b>{n}/5</b></div>'

def credit_line(fichier):
    c = credits.get(fichier, {})
    if not c:
        return ""
    page = c.get("source", "")
    return (f'<span class="credit">{esc(fichier)}&nbsp;: {esc(c.get("auteur","voir source"))} '
            f'&mdash; {esc(c.get("licence","?"))} &mdash; '
            f'<a href="{esc(page)}">Wikimedia Commons</a></span>')

def galerie(row):
    parts = [p.strip() for p in row["image"].split("|") if p.strip()]
    if not parts:
        return ""
    legs = [x.strip() for x in row.get("image_legende", "").split("|")]
    if len(parts) == 1:
        leg = legs[0] if legs and legs[0] else ""
        cap = f'<div class="gcap">{esc(leg)}</div>' if leg else ""
        return (f'<div class="cadre"><img src="{datauri(parts[0])}" alt=""></div>{cap}')
    imgs = "".join(
        f'<button class="gthumb{" on" if i==0 else ""}" data-i="{i}">'
        f'<img src="{datauri(p)}" alt=""></button>' for i, p in enumerate(parts))
    slides = "".join(
        f'<img class="gslide{" on" if i==0 else ""}" data-i="{i}" '
        f'src="{datauri(p)}" alt="">' for i, p in enumerate(parts))
    caps = json.dumps(legs)
    return (f'<div class="cadre galerie" data-caps=\'{caps}\'>{slides}</div>'
            f'<div class="gstrip">{imgs}</div>'
            f'<div class="gcap">{esc(legs[0] if legs else "")}</div>')

FICHES = []
for i, s in enumerate(slugs, 1):
    r = rows[s]
    parts = [p.strip() for p in r["image"].split("|") if p.strip()]
    cred = "".join(credit_line(p) for p in parts)
    FICHES.append(f"""
    <article class="fiche">
      <div class="fiche-tete"><span class="ref">#{i:02d}</span>
        <span class="fil">{esc(r["region"])} &middot; {esc(r["systeme"])}</span></div>
      <div class="corps">
        {galerie(r)}
        <div class="grille">
          <div class="champ" style="grid-column:1/-1">
            <div class="etq">Nom (fran&ccedil;ais)</div>
            <div class="val titre">{esc(r["nom_fr"])}</div>
            <div class="val latin">{esc(r["nom_latin"])}</div></div>
          <div class="champ"><div class="etq">Importance</div>{dots(r["importance"])}</div>
          <div class="champ"><div class="etq">R&eacute;gion</div><div class="val">{esc(r["region"])}</div></div>
        </div>
        <div class="bloc first"><div class="etq">Fonction / r&ocirc;le</div><p>{esc(r["fonction"])}</p></div>
        <div class="bloc"><div class="etq">Rapports anatomiques</div><p>{esc(r["rapports"])}</p></div>
        <div class="bloc"><div class="etq">Notes cliniques</div><p>{esc(r["notes_cliniques"])}</p></div>
        <div class="pied"><div class="etq">Sources</div>
          {"".join(f'<a href="{esc(u.strip())}">{esc(u.strip())}</a>' if u.strip().startswith("http") else f'<span class="credit">{esc(u.strip())}</span>' for u in r["sources"].split(";"))}
          {cred}
        </div>
      </div>
    </article>""")

DOC = """<title>Fiches face superficielle</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500&family=Instrument+Sans:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap">
<style>
:root{--fond:#14110f;--surface:#1d1917;--surface-2:#262120;--trait:#2e2724;--trait-fort:#3a322c;
--carte-bord:#322b27;--encre:#f0e9df;--encre-vive:#f7f1e7;--tuile-ink:#d9cdbd;--attenue:#9c9088;
--discret:#8a7d71;--efface:#4e453d;--laiton:#d2a24c;--etoile:#e8c34a;--lien:#d9b978;
--serif:'Bodoni Moda',Didot,Georgia,serif;--sans:'Instrument Sans','Segoe UI',system-ui,sans-serif;
--mono:'Space Mono',ui-monospace,monospace;}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){
--fond:#e9e0cf;--surface:#f4eee1;--surface-2:#e2d6bf;--trait:#cdbd9c;--trait-fort:#b09c78;
--carte-bord:#d0c1a1;--encre:#241e16;--encre-vive:#130f0b;--tuile-ink:#33291d;--attenue:#5b4f3d;
--discret:#786a54;--efface:#b6a483;--laiton:#8a5a16;--etoile:#8f6a0f;--lien:#7a4f13;}}
:root[data-theme="light"]{--fond:#e9e0cf;--surface:#f4eee1;--surface-2:#e2d6bf;--trait:#cdbd9c;
--trait-fort:#b09c78;--carte-bord:#d0c1a1;--encre:#241e16;--encre-vive:#130f0b;--tuile-ink:#33291d;
--attenue:#5b4f3d;--discret:#786a54;--efface:#b6a483;--laiton:#8a5a16;--etoile:#8f6a0f;--lien:#7a4f13;}
*{box-sizing:border-box;}
body{margin:0;background:var(--fond);color:var(--encre);font-family:var(--sans);line-height:1.6;}
.wrap{max-width:720px;margin:0 auto;padding:38px 20px 80px;}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;
border-bottom:1px solid var(--trait);padding-bottom:18px;margin-bottom:30px;}
.brand{font-family:var(--serif);font-size:21px;color:var(--encre-vive);}
.brand span{color:var(--laiton);}
.sub{font-size:12.5px;color:var(--discret);margin-top:5px;max-width:52ch;line-height:1.5;}
.tgl{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;
color:var(--discret);border:1px solid var(--trait-fort);border-radius:7px;padding:6px 10px;
background:none;cursor:pointer;white-space:nowrap;}
.tgl:hover{color:var(--laiton);border-color:var(--laiton);}
.deck{display:flex;flex-direction:column;gap:26px;}
.fiche{background:var(--surface);border:1px solid var(--carte-bord);border-radius:13px;overflow:hidden;}
.fiche-tete{display:flex;justify-content:space-between;align-items:center;padding:13px 18px;
border-bottom:1px solid var(--trait);}
.ref{font-family:var(--mono);font-size:13px;color:var(--laiton);letter-spacing:.06em;}
.fil{font-family:var(--mono);font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--discret);}
.corps{padding:18px 18px 6px;}
.cadre{background:var(--surface-2);border:1px solid var(--trait);border-radius:9px;height:300px;
display:flex;align-items:center;justify-content:center;padding:12px;position:relative;}
.cadre img{max-width:100%;max-height:100%;object-fit:contain;display:block;border-radius:3px;}
.galerie .gslide{display:none;}
.galerie .gslide.on{display:block;}
.gstrip{display:flex;gap:7px;margin-top:8px;flex-wrap:wrap;}
.gthumb{width:58px;height:58px;padding:0;border:1px solid var(--trait-fort);border-radius:7px;
overflow:hidden;background:var(--surface-2);cursor:pointer;}
.gthumb img{width:100%;height:100%;object-fit:cover;display:block;}
.gthumb.on{border-color:var(--laiton);box-shadow:0 0 0 1px var(--laiton);}
.gcap{font-size:12px;color:var(--attenue);font-style:italic;margin-top:6px;}
.grille{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px;margin:16px 0 4px;}
.champ{min-width:0;}
.etq{font-family:var(--mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;
color:var(--discret);margin-bottom:5px;}
.val{font-size:14.5px;color:var(--tuile-ink);}
.val.titre{font-family:var(--serif);font-size:24px;line-height:1.15;color:var(--encre-vive);
text-wrap:balance;margin-bottom:2px;}
.val.latin{font-family:var(--mono);font-size:12.5px;color:var(--attenue);}
.dots{display:flex;gap:5px;align-items:center;}
.dot{width:11px;height:11px;border-radius:50%;background:var(--efface);}
.dot.on{background:var(--etoile);}
.dots b{font-family:var(--mono);font-size:12px;color:var(--attenue);margin-left:4px;}
.bloc{border-top:1px solid var(--trait);padding:13px 0;}
.bloc.first{border-top:none;}
.bloc p{margin:0;font-size:14px;color:var(--tuile-ink);line-height:1.62;}
.pied{border-top:1px solid var(--trait);margin-top:2px;padding:13px 0 6px;
display:flex;flex-direction:column;gap:5px;}
.pied a{color:var(--lien);text-decoration:none;font-size:12.5px;word-break:break-word;}
.pied a:hover{text-decoration:underline;}
.credit{font-size:11px;color:var(--discret);}
.credit a{font-size:11px;}
.note{font-family:var(--mono);font-size:11px;color:var(--discret);text-align:center;margin-top:34px;}
a:focus-visible,.tgl:focus-visible,.gthumb:focus-visible{outline:2px solid var(--laiton);outline-offset:2px;}
@media (max-width:520px){.grille{grid-template-columns:1fr;}.cadre{height:230px;}}
</style>
<div class="wrap">
  <header><div>
    <div class="brand">Bristol <span>&middot;</span> Anatomie &mdash; T&ecirc;te et cou</div>
    <div class="sub">Lot&nbsp;1a &mdash; face superficielle (mimique, mastication, parotide, fascias). Rendu comme dans l'application, tout r&eacute;v&eacute;l&eacute;. Deux fiches ont une galerie (image + GIF rotatif).</div>
  </div><button class="tgl" id="tgl" type="button">Th&egrave;me</button></header>
  <div class="deck">__FICHES__</div>
  <div class="note">15 fiches &middot; images 100100&nbsp;%%nbsp;% libres (Gray 1918, CC-BY-SA) &middot; sous_licence = 0</div>
</div>
<script>
document.getElementById('tgl').onclick=function(){
 var r=document.documentElement,c=r.getAttribute('data-theme');
 r.setAttribute('data-theme',c==='dark'?'light':(c==='light'?'dark':'light'));};
document.querySelectorAll('.galerie').forEach(function(g){
 var caps=JSON.parse(g.getAttribute('data-caps')||'[]');
 var strip=g.parentNode.querySelector('.gstrip');
 var cap=g.parentNode.querySelector('.gcap');
 strip.querySelectorAll('.gthumb').forEach(function(b){
  b.onclick=function(){
   var i=+b.dataset.i;
   g.querySelectorAll('.gslide').forEach(function(s){s.classList.toggle('on',+s.dataset.i===i);});
   strip.querySelectorAll('.gthumb').forEach(function(t){t.classList.toggle('on',t===b);});
   if(cap)cap.textContent=caps[i]||'';};});});
</script>"""

out = DOC.replace("__FICHES__", "".join(FICHES))
sys.stdout.reconfigure(encoding="utf-8")
print(out)
