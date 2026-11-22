"""Compose .lab-tmp/doom/emitters-light-sheet.png from scripts/sdf-game-doom-emitlight.mjs's shots (hand-off item 2g
part B1): one row per pose, columns B1 off / half / default / double gain. Also prints each pose's measured
patches (mean linear-ish 0..255 RGB of a screen rect next to the emitters, and G/R, B/R) per column, and
draws the rects on the sheet."""
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(".lab-tmp/doom/emitlight")
OUT = Path(".lab-tmp/doom/emitters-light-sheet.png")
COLS = ["off", "half", "default", "double"]
TITLES = {"off": "B1 OFF", "half": "1/2 GAIN", "default": "DEFAULT", "double": "2x GAIN"}
LABELS = {
    "computer": "computer room (zone 2)", "computer-off": "computer room, torch OFF",
    "screens": "south screen wall + soldier", "screens-off": "south screens, torch OFF",
    "alcove": "east alcove (s60) + 2 flayers", "alcove-off": "east alcove, torch OFF",
    "ledge": "sector 21 ledge: strips, banks", "ledge-off": "sector 21 ledge, torch OFF",
    "corridor": "zone 7 fluorescent corridor", "corridor-off": "zone 7 corridor, torch OFF",
    "exitsign": "exit sign passage", "exitsign-off": "exit passage, torch OFF",
}
# Measured rects per pose (960 x 720 shot px): what sits next to the emitters (see the sheet's boxes).
RECTS = {
    "computer-off": {"left wall over banks": (0, 60, 200, 200), "floor": (0, 560, 400, 640)},
    "screens-off": {"floor below screens": (0, 470, 380, 600), "bezel strip": (0, 440, 960, 470)},
    "alcove-off": {"alcove wall": (330, 200, 630, 420), "floor": (300, 470, 660, 560)},
    "ledge-off": {"ledge wall": (0, 200, 300, 420), "floor": (0, 480, 400, 600)},
    "corridor-off": {"corridor wall": (600, 250, 900, 450), "floor": (500, 500, 900, 620)},
    "exitsign-off": {"passage wall": (0, 250, 300, 500), "floor": (300, 520, 660, 640)},
}


def mean(img, box):
    px = img.crop(box).getdata()
    n = len(px)
    return tuple(sum(p[i] for p in px) / n for i in range(3))


poses = sys.argv[1:] or list(LABELS)
cols = [c for c in COLS if (ROOT / c).is_dir()]
rows = [p for p in poses if all((ROOT / c / f"{p}.png").exists() for c in cols)]
if not rows:
    sys.exit(f"no shots under {ROOT} (run scripts/sdf-game-doom-emitlight.sh)")
cw, ch, left, top = 480, 360, 230, 40
sheet = Image.new("RGB", (left + len(cols) * cw, top + len(rows) * ch), "#111")
g = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
except OSError:
    font = ImageFont.load_default()
for j, c in enumerate(cols):
    g.text((left + j * cw + 10, 10), TITLES[c], fill="#fc6", font=font)
for i, p in enumerate(rows):
    g.text((10, top + i * ch + ch // 2 - 10), LABELS.get(p, p), fill="#ddd", font=font)
    for j, c in enumerate(cols):
        img = Image.open(ROOT / c / f"{p}.png").convert("RGB")
        for name, box in RECTS.get(p, {}).items():
            r, gg, b = mean(img, box)
            print(f"{p:14s} {name:22s} {c:8s} RGB {r:6.1f} {gg:6.1f} {b:6.1f}  G/R {gg / max(r, 1e-3):5.2f}  B/R {b / max(r, 1e-3):5.2f}")
        shot = img.resize((cw, ch))
        d = ImageDraw.Draw(shot)
        for box in RECTS.get(p, {}).values():
            d.rectangle([v // 2 for v in box], outline="#f0f")
        sheet.paste(shot, (left + j * cw, top + i * ch))
sheet.save(OUT)
print(f"sheet: {OUT}")
