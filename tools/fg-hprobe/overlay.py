#!/usr/bin/env python3
"""Reusable overlay for #246 base-map renders: biome outlines+labels + coordinate grid.
Usage: python overlay.py <map.ppm> <sea_label e.g. -1755>
Writes <base>_labeled.png + updates map-artifact.html embed. Grid = 40x34 (ds=2 renders).
Biome outlines come from the canonical dataset packages/sf-game-data/data/biomes.json (#239)."""
import json, base64, os, re, string, sys
from PIL import Image, ImageDraw, ImageFont

BIOMES = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      '..', '..', 'packages', 'sf-game-data', 'data', 'biomes.json')

src = sys.argv[1]
sea = sys.argv[2] if len(sys.argv) > 2 else "-1699"
base = src.rsplit('.', 1)[0]
im = Image.open(src).convert('RGB')
W, H = im.size
dr = ImageDraw.Draw(im, 'RGBA')

# render grid params (ds=2): world-cm biome coords -> pixel
AX = AY = -50800.0; SCALE = 100.0; minSX = minSY = -2540 - 360; ds = 2  # -360 PADQ margin
def px(wx, wy):
    return (((wx - AX) / SCALE - minSX) / ds, ((wy - AY) / SCALE - minSY) / ds)
def font(sz):
    try: return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', sz)
    except: return ImageFont.load_default()

# biomes (outline + name) — polygons are world-cm rings in the canonical dataset
for b in json.load(open(BIOMES))['biomes']:
    allp = []
    for poly in b['polygons']:
        pts = [px(x, y) for x, y in poly]; allp += pts
        dr.line(pts + [pts[0]], fill=(255, 240, 60, 200), width=3)
    cx = sum(p[0] for p in allp) / len(allp); cy = sum(p[1] for p in allp) / len(allp)
    t = b['name']; bb = dr.textbbox((0, 0), t, font=font(30)); tw, th = bb[2]-bb[0], bb[3]-bb[1]
    dr.rectangle([cx-tw/2-5, cy-th/2-4, cx+tw/2+5, cy+th/2+6], fill=(0, 0, 0, 170))
    dr.text((cx-tw/2, cy-th/2), t, fill=(255, 255, 255, 255), font=font(30))

# coordinate grid: A-.. x 1-34, half the old cell size (40 cols x 34 rows), single ref per cell e.g. "AB27".
NC, NR = 40, 34
cw, ch = W/NC, H/NR
def collabel(c):  # 0->A .. 25->Z, 26->AA .. 39->AN
    return string.ascii_uppercase[c] if c < 26 else 'A' + string.ascii_uppercase[c-26]
# grid lines (bright)
for c in range(NC+1): dr.line([(c*cw, 0), (c*cw, H)], fill=(0, 255, 255, 190), width=2)
for r in range(NR+1): dr.line([(0, r*ch), (W, r*ch)], fill=(0, 255, 255, 190), width=2)
# cell labels (top-left of each cell)
fid = font(16)
for c in range(NC):
    for r in range(NR):
        dr.text((c*cw+3, r*ch+2), f"{collabel(c)}{r+1}", fill=(255, 235, 0, 255), font=fid,
                stroke_width=3, stroke_fill=(0, 0, 0, 235))

im.save(base + '_labeled.png')
im.convert('RGB').save(base + '_embed.jpg', quality=80, optimize=True)
b64 = base64.b64encode(open(base + '_embed.jpg', 'rb').read()).decode()
html = open('map-artifact.html').read()
html = re.sub(r'src="data:image/[^"]*"', 'src="data:image/jpeg;base64,' + b64 + '"', html, count=1)
html = re.sub(r'<b>Z = &minus;\d+</b> \([a-z]+\)', f'<b>Z = &minus;{sea.lstrip("-")}</b> (locked)', html)
open('map-artifact.html', 'w').write(html)
print('overlay done:', base + '_labeled.png')
