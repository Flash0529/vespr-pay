#!/usr/bin/env python3
"""Generates every VESPR logo and icon file from one geometry (no image tools needed: numpy + zlib only).
The mark is a hexagon split by a thin vertical gap with a triangular notch cut into the middle: two mirrored pieces.
  python3 make-brand.py            writes app/brand/*.svg, desktop/build/{icon.icns,icon.ico,icon.png,icons/*.png}, ide/brand/{code-192.png,code-512.png,favicon.ico,code-icon.svg}
Blue: BRAND (the icon square) and ACCENT (text and dots on dark) are defined once, here and in app/prototype.html tokens."""
import os, struct, zlib, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
BRAND = (47, 107, 255)        # #2f6bff, the icon square
ACCENT_DARK = '#6c9dff'; ACCENT_LIGHT = '#1f56e0'

# ---- geometry in a 100 x 100 box, read from the founder's drawing (2026-10-28): an elongated hexagon (width 0.8 of its height, short vertical sides) cut into four dark pieces
# by a thin vertical gap (above and below) and a wide upward triangle whose base corners sit on the two lower side vertices.
G = 1.8                                   # half width of the vertical gap
XL, XR, YT, YB = 15.0, 85.0, 6.0, 94.0   # hexagon box
YST, YSB = 38.6, 61.4                     # where the vertical sides start and end
APEX_Y = 29.0                             # apex of the triangle
YUB, YLT = 60.2, 62.0                     # upper pieces stop here at the sides, lower pieces start here (a hairline of white pokes out at each corner)
def lerp_y(p, q, x): return p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0])
XG = 50 - G
HEX = [(50, YT), (XR, YST), (XR, YSB), (50, YB), (XL, YSB), (XL, YST)]
UL = [(XG, lerp_y((50, YT), (XL, YST), XG)), (XL, YST), (XL, YUB), (XG, lerp_y((XL, YUB), (50, APEX_Y), XG))]
LL_x0 = XL + (YLT - YSB) * (50 - XL) / (YB - YSB)
LL = [(LL_x0, YLT), (XG, YLT), (XG, lerp_y((XL, YSB), (50, YB), XG))]
mirror = lambda poly: [(100 - x, y) for x, y in poly]
UR, LR = mirror(UL), mirror(LL)
PIECES = [UL, UR, LL, LR]
NOTCH = [(50, APEX_Y), (XR, YSB), (XL, YSB)]

def pts(poly): return ' '.join(f'{x:.2f},{y:.2f}' for x, y in poly)
def polys(cls=''): return ''.join(f'<polygon{(" class=" + chr(34) + cls + str(i) + chr(34)) if cls else ""} points="{pts(q)}"/>' for i, q in enumerate(PIECES))

# ---- SVG files
def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True); open(path, 'w').write(text)
write(os.path.join(HERE, 'logo.svg'), f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>VESPR</title><g fill="currentColor">{polys()}</g></svg>\n')
write(os.path.join(HERE, 'favicon.svg'), f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>VESPR</title><rect width="100" height="100" rx="18" fill="#2f6bff"/><g fill="#fff" transform="translate(50 50) scale(1.02) translate(-50 -50)">{polys()}</g></svg>\n')
write(os.path.join(HERE, 'icon.svg'), f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>VESPR</title><rect width="100" height="100" rx="22" fill="#2f6bff"/><g fill="#fff" transform="translate(50 50) scale(.72) translate(-50 -50)">{polys()}</g></svg>\n')
# loader: the mark folds onto itself and unravels, on a loop. The left half flips over the vertical axis onto the right half, then the lower half flips up over the
# horizontal axis, the little folded shape holds a moment, and it opens again in the reverse order. The mark is symmetric, so each flip lands exactly on its mirror.
# Pieces are shaded by the fold angle (darkest edge-on, lighter on the back of the sheet), and a hairline outline shows the layers while folded.
DUR = 2.6; BASE, BACK, SHADE = '#2f6bff', '#6f98ff', '#1a3a94'
T = dict(x0=4, x1=20, y0=22, y1=38, y2=46, y3=62, x2=64, x3=80)   # percent of the loop: fold x, fold y, hold, open y, open x, hold
def fold_kf(a, b, c, d, axis):   # one flip a->b (scale 1 to -1), held to c, flip back c->d
    s = 'scaleX' if axis == 'x' else 'scaleY'; e = 'animation-timing-function:cubic-bezier(.65,0,.35,1)'
    return f'0%,{a}%{{transform:{s}(1);{e}}}{b}%,{c}%{{transform:{s}(-1);{e}}}{d}%,100%{{transform:{s}(1)}}'
def shade_kf(steps):   # [(percent, 'B'|'K'|'S')] -> fill and outline keyframes; outline shows whenever a piece is off its home spot
    col = {'B': BASE, 'K': BACK, 'S': SHADE}
    return ''.join(f'{p}%{{fill:{col[c]};stroke-opacity:{0 if c == "B" and p in (0, 100) else .85}}}' for p, c in steps)
t = T
SH = {
  'ul': [(0, 'B'), (t['x0'], 'B'), ((t['x0'] + t['x1']) / 2, 'S'), (t['x1'], 'K'), (t['x2'], 'K'), ((t['x2'] + t['x3']) / 2, 'S'), (t['x3'], 'B'), (100, 'B')],
  'lr': [(0, 'B'), (t['y0'], 'B'), ((t['y0'] + t['y1']) / 2, 'S'), (t['y1'], 'K'), (t['y2'], 'K'), ((t['y2'] + t['y3']) / 2, 'S'), (t['y3'], 'B'), (100, 'B')],
  'll': [(0, 'B'), (t['x0'], 'B'), ((t['x0'] + t['x1']) / 2, 'S'), (t['x1'], 'K'), (t['y0'], 'K'), ((t['y0'] + t['y1']) / 2, 'S'), (t['y1'], 'B'), (t['y2'], 'B'),
         ((t['y2'] + t['y3']) / 2, 'S'), (t['y3'], 'K'), (t['x2'], 'K'), ((t['x2'] + t['x3']) / 2, 'S'), (t['x3'], 'B'), (100, 'B')],
}
LOADER = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Loading">
<title>Loading</title>
<style>
.p{{fill:{BASE};stroke:#0c1a4a;stroke-width:.5;stroke-linejoin:round;stroke-opacity:0}}
.fx,.fy{{transform-box:view-box;transform-origin:50px 50px}}
.fx{{animation:fx {DUR}s linear infinite}}
.fy{{animation:fy {DUR}s linear infinite}}
.ul{{animation:sul {DUR}s linear infinite}} .lr{{animation:slr {DUR}s linear infinite}} .ll{{animation:sll {DUR}s linear infinite}}
@keyframes fx{{{fold_kf(t['x0'], t['x1'], t['x2'], t['x3'], 'x')}}}
@keyframes fy{{{fold_kf(t['y0'], t['y1'], t['y2'], t['y3'], 'y')}}}
@keyframes sul{{{shade_kf(SH['ul'])}}}
@keyframes slr{{{shade_kf(SH['lr'])}}}
@keyframes sll{{{shade_kf(SH['ll'])}}}
@media (prefers-reduced-motion:reduce){{.fx,.fy,.p{{animation:none}}}}
</style>
<polygon class="p ur" points="{pts(PIECES[1])}"/>
<g class="fx"><polygon class="p ul" points="{pts(PIECES[0])}"/></g>
<g class="fy"><polygon class="p lr" points="{pts(PIECES[3])}"/></g>
<g class="fy"><g class="fx"><polygon class="p ll" points="{pts(PIECES[2])}"/></g></g>
</svg>
'''
write(os.path.join(HERE, 'loader.svg'), LOADER)

# ---- raster: signed-distance anti-aliasing, numpy only
def sd_poly(px, py, poly):
    n = len(poly); d = np.full(px.shape, 1e9); inside = np.zeros(px.shape, bool)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        ex, ey = x2 - x1, y2 - y1; l2 = ex * ex + ey * ey
        t = np.clip(((px - x1) * ex + (py - y1) * ey) / l2, 0, 1)
        d = np.minimum(d, np.hypot(px - (x1 + t * ex), py - (y1 + t * ey)))
        c = ((y1 > py) != (y2 > py)) & (px < (x2 - x1) * (py - y1) / (y2 - y1 + 1e-12) + x1)
        inside ^= c
    return np.where(inside, -d, d)
def sd_rrect(px, py, cx, cy, hw, hh, r):
    qx, qy = np.abs(px - cx) - (hw - r), np.abs(py - cy) - (hh - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
def coverage(sd, px_per_unit): return np.clip(0.5 - sd * px_per_unit, 0, 1)

def render(size, margin=0.0, radius=0.22, logo_scale=0.72, bg=BRAND, fg=(255, 255, 255)):
    """margin: fraction of the canvas left transparent around the square (macOS: 0.0996); radius: corner radius as a fraction of the square"""
    s = 100.0 / size; ys, xs = np.mgrid[0:size, 0:size]; px = (xs + .5) * s; py = (ys + .5) * s
    inner = 100 * (1 - 2 * margin); r = radius * inner
    sq = coverage(sd_rrect(px, py, 50, 50, inner / 2, inner / 2, r), 1 / s)
    k = logo_scale * inner / 100
    def tf(poly): return [(50 + (x - 50) * k, 50 + (y - 50) * k) for x, y in poly]
    logo = np.maximum.reduce([coverage(sd_poly(px, py, tf(q)), 1 / s) for q in PIECES])
    rgb = np.zeros((size, size, 3)); rgb[:] = bg
    rgb = rgb * (1 - logo[..., None]) + np.array(fg) * logo[..., None]
    out = np.dstack([rgb, sq * 255]).clip(0, 255).astype(np.uint8)
    return out
def render_mark(size, color):  # the mark alone on transparent, for small UI icons
    s = 100.0 / size; ys, xs = np.mgrid[0:size, 0:size]; px = (xs + .5) * s; py = (ys + .5) * s
    a = np.maximum.reduce([coverage(sd_poly(px, py, q), 1 / s) for q in PIECES])
    out = np.zeros((size, size, 4), np.uint8); out[..., :3] = color; out[..., 3] = (a * 255).astype(np.uint8); return out

def png(arr):
    h, w = arr.shape[:2]; raw = b''.join(b'\x00' + arr[y].tobytes() for y in range(h))
    def chunk(t, d): c = struct.pack('>I', len(d)) + t + d; return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
def ico(entries):  # [(size, pngbytes)]
    head = struct.pack('<HHH', 0, 1, len(entries)); off = 6 + 16 * len(entries); dirs = b''; data = b''
    for size, b in entries:
        dirs += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(b), off + len(data)); data += b
    return head + dirs + data
def icns(items):  # [(type, pngbytes)]
    body = b''.join(t + struct.pack('>I', 8 + len(b)) + b for t, b in items)
    return b'icns' + struct.pack('>I', 8 + len(body)) + body
def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True); open(path, 'wb').write(data)

if __name__ == '__main__':
    D = os.path.join(ROOT, 'desktop', 'build'); I = os.path.join(ROOT, 'ide', 'brand')
    # Linux and the generic source: square with soft corners, full bleed
    for n in (16, 24, 32, 48, 64, 128, 256, 512, 1024): save(os.path.join(D, 'icons', f'{n}x{n}.png'), png(render(n)))
    save(os.path.join(D, 'icon.png'), png(render(1024)))
    # Windows: multi-size ico
    save(os.path.join(D, 'icon.ico'), ico([(n, png(render(n))) for n in (16, 24, 32, 48, 64, 128, 256)]))
    # macOS: the Apple template keeps a ~10% transparent margin around the square
    mac = {b'icp4': 16, b'icp5': 32, b'icp6': 64, b'ic07': 128, b'ic08': 256, b'ic09': 512, b'ic10': 1024, b'ic11': 32, b'ic12': 64, b'ic13': 256, b'ic14': 512}
    items = []
    for t, n in mac.items():
        px = n if t not in (b'ic11', b'ic12', b'ic13', b'ic14') else n * 2
        px = {b'ic11': 32, b'ic12': 64, b'ic13': 256, b'ic14': 512}.get(t, n)
        items.append((t, png(render(px if t not in (b'ic11', b'ic12', b'ic13', b'ic14') else px, margin=0.0996, radius=0.2237))))
    save(os.path.join(D, 'icon.icns'), icns(items))
    # the browser SDE (title bar mark, PWA and tab icons)
    save(os.path.join(I, 'code-512.png'), png(render(512))); save(os.path.join(I, 'code-192.png'), png(render(192)))
    fav = lambda n: png(render(n, radius=0.18, logo_scale=1.02))
    save(os.path.join(I, 'favicon.ico'), ico([(16, fav(16)), (32, fav(32)), (48, fav(48))]))
    save(os.path.join(HERE, 'favicon.ico'), ico([(16, fav(16)), (32, fav(32)), (48, fav(48))])); save(os.path.join(HERE, 'favicon-32.png'), fav(32)); save(os.path.join(HERE, 'favicon-16.png'), fav(16))
    write(os.path.join(I, 'code-icon.svg'), f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="{ACCENT_DARK}">{polys()}</g></svg>\n')
    # the web app: favicon set
    save(os.path.join(HERE, 'icon-192.png'), png(render(192))); save(os.path.join(HERE, 'icon-512.png'), png(render(512)))
    print('brand files written')
