#!/usr/bin/env python3
"""Build the interactive layered map artifact (#246) from a LAYERS=1 render.

Reads map.ppm (composite RGB) + map.layers (per-cell class byte) in the CWD, splits them into one
transparent PNG per layer, draws the biome / biome-name / grid overlays, and writes a self-contained
map-layers.html with a checkbox per layer (z-index stacked, height-ranked). Biome polygons come from the
canonical dataset packages/sf-game-data/data/biomes.json.

Usage: python layers.py [target_width]   (default 1600)
Only the layers whose source PNG changed need re-embedding; re-run to rebuild the (small) HTML.
"""
import base64, io, json, os, string, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

TW = int(sys.argv[1]) if len(sys.argv) > 1 else 1600
BIOMES = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'packages', 'sf-game-data', 'data', 'biomes.json')

surf = np.asarray(Image.open('map.surf.ppm').convert('RGB'), np.uint8)  # surface colour (land/water/void, no objects)
objc = np.asarray(Image.open('map.obj.ppm').convert('RGB'), np.uint8)   # object colour (rock/coral/foliage)
H, W = surf.shape[:2]
TW = min(TW, W); TH = round(TW * H / W)
cls = np.frombuffer(open('map.layers', 'rb').read(), np.uint8).reshape(H, W)
sclass = cls & 3          # 0 void · 1 water · 2 land (surface, ignoring objects)
okind = (cls >> 2) & 3    # 0 none · 1 rock · 2 coral · 3 foliage (height-ranked topmost object)
trunk = (cls & 16) > 0    # tree-trunk cross-section present

def font(sz):
    try: return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', sz)
    except: return ImageFont.load_default()

def to_png_b64(img):
    img = img.resize((TW, TH), Image.LANCZOS)
    buf = io.BytesIO(); img.save(buf, 'PNG', optimize=True)
    return base64.b64encode(buf.getvalue()).decode()

def cls_layer(mask, src):
    """RGBA: `src` colour (an HxWx3 raster, or a flat RGB tuple) where mask is true, transparent elsewhere."""
    a = np.zeros((H, W, 4), np.uint8)
    a[..., :3] = src if isinstance(src, np.ndarray) else np.array(src, np.uint8)
    a[..., 3] = np.where(mask, 255, 0)
    return Image.fromarray(a, 'RGBA')

# world-cm -> full-res pixel -> target pixel (matches overlay.py)
AX = AY = -50800.0; SCALE = 100.0; minSX = minSY = -2900; ds = 2; sc = TW / W
def px(wx, wy):
    return (((wx - AX) / SCALE - minSX) / ds * sc, ((wy - AY) / SCALE - minSY) / ds * sc)

def overlay(draw_fn):
    im = Image.new('RGBA', (TW, TH), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(im, 'RGBA'))
    buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True)
    return base64.b64encode(buf.getvalue()).decode()

biomes = json.load(open(BIOMES))['biomes']

def draw_biomes(dr):
    for b in biomes:
        for poly in b['polygons']:
            pts = [px(x, y) for x, y in poly]
            dr.line(pts + [pts[0]], fill=(255, 240, 60, 210), width=2)

def draw_names(dr):
    f = font(max(11, round(15 * sc / 0.4)))
    for b in biomes:
        allp = [px(x, y) for poly in b['polygons'] for x, y in poly]
        cx = sum(p[0] for p in allp) / len(allp); cy = sum(p[1] for p in allp) / len(allp)
        t = b['name']; bb = dr.textbbox((0, 0), t, font=f); tw, th = bb[2] - bb[0], bb[3] - bb[1]
        dr.rectangle([cx - tw / 2 - 4, cy - th / 2 - 3, cx + tw / 2 + 4, cy + th / 2 + 5], fill=(0, 0, 0, 150))
        dr.text((cx - tw / 2, cy - th / 2), t, fill=(255, 255, 255, 255), font=f)

def draw_grid(dr):
    NC, NR = 40, 34; cw, ch = TW / NC, TH / NR
    col = lambda c: string.ascii_uppercase[c] if c < 26 else 'A' + string.ascii_uppercase[c - 26]
    for c in range(NC + 1): dr.line([(c * cw, 0), (c * cw, TH)], fill=(0, 255, 255, 150), width=1)
    for r in range(NR + 1): dr.line([(0, r * ch), (TW, r * ch)], fill=(0, 255, 255, 150), width=1)
    f = font(max(9, round(13 * sc / 0.4)))
    for c in range(NC):
        for r in range(NR):
            dr.text((c * cw + 2, r * ch + 1), f"{col(c)}{r + 1}", fill=(255, 235, 0, 255), font=f, stroke_width=2, stroke_fill=(0, 0, 0, 220))

# layer stack, bottom (low z) -> top. `on` = default checked. void/water/ground come from the SURFACE raster
# (full extent, so hiding an object reveals the ground beneath); objects from the OBJECT raster.
LAYERS = [
    ('void',    'Void',        cls_layer(sclass == 0, surf),            True),
    ('water',   'Water',       cls_layer(sclass == 1, surf),            True),
    ('ground',  'Ground',      cls_layer(sclass == 2, surf),            True),
    ('coral',   'Coral',       cls_layer(okind == 2, objc),             True),
    ('rocks',   'Rocks',       cls_layer(okind == 1, objc),             True),
    ('trunks',  'Tree trunks', cls_layer(trunk, (120, 82, 52)),         True),
    ('foliage', 'Tree foliage',cls_layer(okind == 3, objc),             True),
    ('biomes',  'Biome edges', overlay(draw_biomes),                    True),
    ('names',   'Biome names', overlay(draw_names),                     True),
    ('grid',    'Grid A1-AN34',overlay(draw_grid),                      True),
]
data = []
for i, (lid, label, src, on) in enumerate(LAYERS):
    b64 = to_png_b64(src) if isinstance(src, Image.Image) else src  # overlays already b64
    data.append((lid, label, b64, on, (i + 1) * 10))

imgs = "\n".join(
    f'<img class="ly" id="ly-{lid}" style="z-index:{z};{"" if on else "display:none;"}" '
    f'src="data:image/png;base64,{b64}" alt="{label}">' for lid, label, b64, on, z in data)
rows = "\n".join(
    f'<label class="row"><input type="checkbox" data-ly="{lid}" {"checked" if on else ""}> {label}</label>'
    for lid, label, b64, on, z in data)

html = f'''<title>Satisfactory base map — layers (#246)</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:#14171c; color:#dfe3ea; font:14px/1.4 system-ui,sans-serif; }}
  #wrap {{ display:flex; align-items:flex-start; gap:14px; padding:14px; height:100vh; }}
  #map {{ position:relative; flex:1 1 auto; height:100%; overflow:hidden; background:#0d0f13; border-radius:8px;
          box-shadow:0 2px 16px #0008; cursor:grab; touch-action:none; }}
  #map.drag {{ cursor:grabbing; }}
  #view {{ position:absolute; top:0; left:0; width:{TW}px; aspect-ratio:{TW}/{TH}; transform-origin:0 0; }}
  #view img.ly {{ position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }}
  #panel {{ flex:0 0 190px; background:#1c2129; border:1px solid #2c333d; border-radius:10px; padding:12px 14px; align-self:flex-start; }}
  #panel h1 {{ font-size:13px; letter-spacing:.06em; text-transform:uppercase; color:#8b97a8; margin:0 0 6px; }}
  #panel .hint {{ color:#6b7686; font-size:11px; margin:0 0 10px; }}
  .row {{ display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer; user-select:none; }}
  .row input {{ accent-color:#e6b800; width:15px; height:15px; }}
  #reset {{ margin-top:10px; width:100%; background:#2c333d; color:#dfe3ea; border:0; border-radius:6px; padding:6px; cursor:pointer; }}
</style>
<div id="wrap">
  <div id="map"><div id="view">
{imgs}
  </div></div>
  <div id="panel">
    <h1>Layers</h1>
    <p class="hint">scroll to zoom · drag to pan</p>
{rows}
    <button id="reset">Reset view</button>
  </div>
</div>
<script>
  document.querySelectorAll('#panel input').forEach(cb => cb.addEventListener('change', () => {{
    document.getElementById('ly-' + cb.dataset.ly).style.display = cb.checked ? '' : 'none';
  }}));
  const map = document.getElementById('map'), view = document.getElementById('view');
  let sc = 1, tx = 0, ty = 0;
  const BASE = {TW};
  function fit() {{ sc = map.clientWidth / BASE; tx = 0; ty = 0; apply(); }}
  function apply() {{ view.style.transform = `translate(${{tx}}px,${{ty}}px) scale(${{sc}})`; }}
  map.addEventListener('wheel', e => {{
    e.preventDefault();
    const r = map.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015), ns = Math.min(40, Math.max(map.clientWidth / BASE * 0.9, sc * f));
    tx = mx - (mx - tx) * (ns / sc); ty = my - (my - ty) * (ns / sc); sc = ns; apply();
  }}, {{ passive: false }});
  let dragging = false, px2 = 0, py2 = 0;
  map.addEventListener('pointerdown', e => {{ dragging = true; px2 = e.clientX; py2 = e.clientY; map.classList.add('drag'); map.setPointerCapture(e.pointerId); }});
  map.addEventListener('pointermove', e => {{ if (!dragging) return; tx += e.clientX - px2; ty += e.clientY - py2; px2 = e.clientX; py2 = e.clientY; apply(); }});
  map.addEventListener('pointerup', e => {{ dragging = false; map.classList.remove('drag'); }});
  document.getElementById('reset').addEventListener('click', fit);
  window.addEventListener('resize', fit); fit();
</script>'''
open('map-layers.html', 'w').write(html)
print(f'wrote map-layers.html  ({TW}x{TH}, {len(LAYERS)} layers, {len(html)//1024} KB)')
