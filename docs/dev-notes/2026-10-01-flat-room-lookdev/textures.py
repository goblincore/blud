# The Flat's otaku textures (PIL): a tileable kawaii quilt pattern, three posters, a sticker, a mousepad.
# usage: python3 textures.py OUTDIR
import math, random, sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)
KANA = '/System/Library/Fonts/Hiragino Sans GB.ttc'
ROUND = '/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf'
random.seed(7)

def font(path, size):
    try: return ImageFont.truetype(path, size)
    except Exception: return ImageFont.load_default()

def mascot(d, cx, cy, r, body=(255, 255, 255), line=(60, 40, 50), blush=(255, 150, 170), ears=True, wide=1.12):
    """Gob-chan: a round white blob with goblin ears, dot eyes, a cat mouth and blush. The goblin's own mascot."""
    w = r * wide
    if ears:
        for s in (-1, 1):
            d.polygon([(cx + s * w * 0.55, cy - r * 0.55), (cx + s * w * 1.55, cy - r * 1.05), (cx + s * w * 0.95, cy - r * 0.05)],
                      fill=body, outline=line, width=max(1, int(r * 0.06)))
    d.ellipse([cx - w, cy - r, cx + w, cy + r * 0.92], fill=body, outline=line, width=max(1, int(r * 0.06)))
    er = r * 0.11
    for s in (-1, 1):
        ex, ey = cx + s * w * 0.38, cy - r * 0.02
        d.ellipse([ex - er, ey - er * 1.25, ex + er, ey + er * 1.25], fill=line)
        d.ellipse([ex - er * 0.45 + er * 0.25, ey - er * 0.9, ex + er * 0.2 + er * 0.25, ey - er * 0.25], fill=(255, 255, 255))
        bx = cx + s * w * 0.62
        d.ellipse([bx - r * 0.17, cy + r * 0.2, bx + r * 0.17, cy + r * 0.36], fill=blush)
    lw = max(1, int(r * 0.05))
    d.arc([cx - r * 0.2, cy + r * 0.12, cx, cy + r * 0.32], 0, 180, fill=line, width=lw)
    d.arc([cx, cy + r * 0.12, cx + r * 0.2, cy + r * 0.32], 0, 180, fill=line, width=lw)

def star(d, cx, cy, r, fill, rot=0.0):
    pts = []
    for k in range(10):
        a = rot + k * math.pi / 5 - math.pi / 2
        rr = r if k % 2 == 0 else r * 0.45
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    d.polygon(pts, fill=fill)

def heart(d, cx, cy, r, fill):
    d.ellipse([cx - r, cy - r * 0.6, cx, cy + r * 0.3], fill=fill)
    d.ellipse([cx, cy - r * 0.6, cx + r, cy + r * 0.3], fill=fill)
    d.polygon([(cx - r * 0.97, cy - r * 0.05), (cx + r * 0.97, cy - r * 0.05), (cx, cy + r * 1.05)], fill=fill)

# --- the quilt: a tileable pattern (drawn 3x3 and cropped so motifs wrap) ---
T = 512
big = Image.new('RGB', (T * 3, T * 3), (250, 200, 214))
d = ImageDraw.Draw(big)
motifs = []
for k in range(7):
    motifs.append(('m', random.uniform(0, T), random.uniform(0, T), random.uniform(34, 44)))
for k in range(10):
    motifs.append(('s', random.uniform(0, T), random.uniform(0, T), random.uniform(10, 18)))
for k in range(8):
    motifs.append(('h', random.uniform(0, T), random.uniform(0, T), random.uniform(9, 14)))
for k in range(60):
    motifs.append(('d', random.uniform(0, T), random.uniform(0, T), 3.0))
for kind, x, y, r in motifs:
    for ox in range(3):
        for oy in range(3):
            X, Y = x + ox * T, y + oy * T
            if kind == 'm': mascot(d, X, Y, r)
            elif kind == 's': star(d, X, Y, r, (255, 236, 140), rot=x * 0.01)
            elif kind == 'h': heart(d, X, Y, r, (232, 96, 140))
            else: d.ellipse([X - r, Y - r, X + r, Y + r], fill=(255, 255, 255))
big.crop((T, T, 2 * T, 2 * T)).save(os.path.join(OUT, 'quilt.png'))

# --- poster 1: Gob-chan on a pink sunburst ---
W, H = 600, 840
im = Image.new('RGB', (W, H), (255, 214, 226)); d = ImageDraw.Draw(im)
for k in range(24):
    a0, a1 = k * math.tau / 24, (k + 0.5) * math.tau / 24
    d.polygon([(W / 2, H * 0.45), (W / 2 + math.cos(a0) * 1200, H * 0.45 + math.sin(a0) * 1200),
               (W / 2 + math.cos(a1) * 1200, H * 0.45 + math.sin(a1) * 1200)], fill=(255, 186, 206))
mascot(d, W / 2, H * 0.47, 175)
for k in range(9): star(d, random.uniform(40, W - 40), random.uniform(40, H * 0.75), random.uniform(14, 30), (255, 240, 120))
d.rectangle([0, H * 0.78, W, H], fill=(236, 84, 132))
d.text((W / 2, H * 0.865), 'ゴブちゃん', font=font(KANA, 92), fill=(255, 255, 255), anchor='mm', stroke_width=5, stroke_fill=(120, 30, 70))
d.text((W / 2, H * 0.955), 'GOB-CHAN  ☆  DAISUKI', font=font(ROUND, 30), fill=(255, 236, 140), anchor='mm')
im.save(os.path.join(OUT, 'poster-gobchan.png'))

# --- poster 2: the idol's sparkly anime eyes ---
im = Image.new('RGB', (W, H), (24, 22, 70)); d = ImageDraw.Draw(im)
for k in range(140):
    x, y = random.uniform(0, W), random.uniform(0, H); r = random.choice((1, 1, 2, 3))
    d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255))
glow = Image.new('RGB', (W, H), (0, 0, 0)); gd = ImageDraw.Draw(glow)
for s in (-1, 1):
    cx, cy = W / 2 + s * 140, H * 0.42
    gd.ellipse([cx - 120, cy - 150, cx + 120, cy + 150], fill=(255, 120, 200))
glow = glow.filter(ImageFilter.GaussianBlur(40))
im = Image.blend(im, Image.eval(glow, lambda v: v), 0.35); d = ImageDraw.Draw(im)
for s in (-1, 1):
    cx, cy = W / 2 + s * 140, H * 0.42
    d.ellipse([cx - 105, cy - 130, cx + 105, cy + 130], fill=(250, 250, 255))
    for k in range(12):   # the iris: a gradient of rings, violet to magenta
        t = k / 11; rr = 92 - k * 5
        col = (int(90 + 150 * t), int(40 + 40 * t), int(200 - 40 * t))
        d.ellipse([cx - rr * 0.92, cy - rr * 1.12 + 6, cx + rr * 0.92, cy + rr * 1.12 + 6], fill=col)
    d.ellipse([cx - 34, cy - 40, cx + 34, cy + 52], fill=(30, 10, 50))
    d.ellipse([cx - 62 + s * 10, cy - 92, cx - 6 + s * 10, cy - 30], fill=(255, 255, 255))
    d.ellipse([cx + 22, cy + 30, cx + 46, cy + 58], fill=(255, 255, 255))
    star(d, cx - 8, cy + 10, 16, (255, 255, 255))
    d.arc([cx - 125, cy - 160, cx + 125, cy + 100], 200, 340, fill=(20, 10, 30), width=14)
    for l in range(4):
        a = math.radians(205 + l * 18 if s < 0 else 335 - l * 18)
        x0, y0 = cx + math.cos(a) * 125, cy - 30 + math.sin(a) * 130
        d.line([x0, y0, x0 + math.cos(a) * 40, y0 + math.sin(a) * 40], fill=(20, 10, 30), width=10)
d.text((W / 2, H * 0.80), '☆マジカル☆', font=font(KANA, 78), fill=(255, 150, 210), anchor='mm', stroke_width=4, stroke_fill=(70, 20, 90))
d.text((W / 2, H * 0.90), 'キラキラ  NIGHT  LIVE', font=font(KANA, 34), fill=(180, 230, 255), anchor='mm')
im.save(os.path.join(OUT, 'poster-eyes.png'))

# --- poster 3: the game (a big red kanji for blood) ---
im = Image.new('RGB', (W, H), (14, 10, 10)); d = ImageDraw.Draw(im)
d.text((W / 2, H * 0.42), '血', font=font(KANA, 470), fill=(170, 10, 14), anchor='mm')
for k in range(26):   # drips
    x = random.uniform(120, W - 120); y = random.uniform(H * 0.45, H * 0.62); L = random.uniform(30, 160)
    d.line([x, y, x, y + L], fill=(150, 8, 12), width=random.choice((4, 6, 8)))
    d.ellipse([x - 6, y + L - 6, x + 6, y + L + 8], fill=(150, 8, 12))
d.text((W / 2, H * 0.84), 'NIGHT TRAIN', font=font(ROUND, 58), fill=(230, 220, 200), anchor='mm')
d.text((W / 2, H * 0.92), '発売中 · OUT NOW', font=font(KANA, 30), fill=(170, 10, 14), anchor='mm')
im.save(os.path.join(OUT, 'poster-blood.png'))

# --- a sticker (RGBA, a white die-cut border) and the mousepad ---
S = 256
st = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(st)
d.ellipse([8, 8, S - 8, S - 8], fill=(255, 255, 255, 255))
d.ellipse([22, 22, S - 22, S - 22], fill=(140, 220, 210, 255))
mascot(d, S / 2, S * 0.55, 62)
st.save(os.path.join(OUT, 'sticker.png'))
mp = Image.new('RGB', (512, 400), (160, 225, 220)); d = ImageDraw.Draw(mp)
for k in range(30): star(d, random.uniform(0, 512), random.uniform(0, 400), random.uniform(6, 14), (255, 255, 255))
mascot(d, 256, 215, 110)
mp.save(os.path.join(OUT, 'mousepad.png'))
print('textures in', OUT)
