"""Side-view stick-figure strip of a walked quadruped (dev aid, no GPU).

  GOREHOUND_DUMP=$PWD/.lab-tmp/gh-walk.json npx vitest run src/lab/sdf-zombie/characters/gorehound-blob.test.ts
  python3 scripts/gorehound-gait-strip.py .lab-tmp/gh-walk.json .lab-tmp/gh-strip.png [first] [count] [step]

Each panel is one frame, projected on the body's own forward axis (hips -> chest), so the walk reads side-on
whatever the wander heading. Near-side limbs (L) are drawn bright, far-side (R) dark; a foot within 1 cm of its
lowest height is ringed (planted)."""
import json, sys, math
from PIL import Image, ImageDraw

frames = json.load(open(sys.argv[1]))
out = sys.argv[2]
first = int(sys.argv[3]) if len(sys.argv) > 3 else 200
count = int(sys.argv[4]) if len(sys.argv) > 4 else 12
step = int(sys.argv[5]) if len(sys.argv) > 5 else 3
W, H, S = 260, 220, 140
low = {n: min(f[n][1] for f in frames[90:]) for n in ('handL', 'handR', 'footL', 'footR', 'toeL', 'toeR', 'handTipL', 'handTipR')}
img = Image.new('RGB', (W * count, H), (24, 20, 26))
d = ImageDraw.Draw(img)
CH = [('pelvis', 'hips'), ('hips', 'chest'), ('chest', 'spineB'), ('spineB', 'neck'), ('neck', 'head')]
for side, col in (('R', (90, 90, 110)), ('L', (230, 200, 120))):
    pass
for i in range(count):
    f = frames[first + i * step]
    h, c = f['hips'], f['chest']
    fx, fz = c[0] - h[0], c[2] - h[2]
    n = math.hypot(fx, fz) or 1
    fx, fz = fx / n, fz / n
    ox = W * i + W * 0.45
    def P(name):
        p = f[name]
        u = (p[0] - h[0]) * fx + (p[2] - h[2]) * fz
        return (ox + u * S, H - 12 - p[1] * S)
    d.line([(W * i, H - 12), (W * i + W, H - 12)], fill=(70, 60, 60))
    for side, col in (('R', (80, 80, 105)), ('L', (235, 205, 120))):
        for a, b in [(f'clavicle{side}', f'shoulder{side}'), (f'shoulder{side}', f'elbow{side}'), (f'elbow{side}', f'hand{side}'),
                     (f'hand{side}', f'handTip{side}'), (f'hip{side}', f'knee{side}'), (f'knee{side}', f'foot{side}'), (f'foot{side}', f'toe{side}')]:
            if a in f and b in f:
                d.line([P(a), P(b)], fill=col, width=4)
        for tip in (f'handTip{side}', f'toe{side}'):
            if tip in f and f[tip][1] - low[tip] < 0.01:
                x, y = P(tip); d.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(220, 60, 60), width=2)
    for a, b in CH:
        if a in f and b in f:
            d.line([P(a), P(b)], fill=(220, 150, 140), width=6)
    d.text((W * i + 6, 6), str(first + i * step), fill=(200, 200, 200))
img.save(out)
