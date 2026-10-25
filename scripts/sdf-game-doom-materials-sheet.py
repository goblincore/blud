"""Compose .lab-tmp/doom/materials-before-after.png from scripts/sdf-game-doom-materials.mjs's shots:
one row per pose, one column per variant folder under .lab-tmp/doom/mat/ that has the pose.
SHEET_COLUMNS=before,prev,after (default; not COLUMNS, the shell's terminal width) — "prev" is a copy of an earlier "after" run (e.g. 4a267574)."""
import os
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(".lab-tmp/doom/mat")
OUT = Path(".lab-tmp/doom/materials-before-after.png")
LABELS = {
    "start": "start room (zone 4)", "tech": "window room: tech walls, light-panel bays", "door": "zone 7 corridor, door east",
    "nukage": "nukage pool from the walkway", "corridor": "corridor east (zone 9)", "lightceil": "light-panel ceiling (zone 11)",
    "exitdoor": "facing the exit door", "start-off": "start room, flashlight OFF", "tech-off": "window room, flashlight OFF",
}
poses = sys.argv[1:] or list(LABELS)
COLS = [c for c in os.environ.get("SHEET_COLUMNS", "before,prev,after").split(",") if (ROOT / c).is_dir()]
if not COLS:
    sys.exit(f"no shot folders: none of SHEET_COLUMNS under {ROOT} exist (run scripts/sdf-game-doom-materials.sh)")
TITLES = {"before": "OLD STONE (?sectormat=0)", "prev": "FIRST MATERIALS (4a267574)", "after": "GRIMY MATERIALS (now)"}
cw, ch, left, top = 480, 360, 200, 40
rows = [p for p in poses if all((ROOT / c / f"{p}.png").exists() for c in COLS)]
if not rows:
    sys.exit(f"no pose has a shot in every column {COLS}")
sheet = Image.new("RGB", (left + len(COLS) * cw, top + len(rows) * ch), "#111")
g = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
except OSError:
    font = ImageFont.load_default()
for c, v in enumerate(COLS):
    g.text((left + c * cw + 8, 10), TITLES.get(v, v), fill="white", font=font)
for r, p in enumerate(rows):
    y = top + r * ch
    words, line, lines = LABELS.get(p, p).split(), "", []
    for w in words:
        if len(line) + len(w) > 19: lines.append(line); line = w
        else: line = f"{line} {w}".strip()
    lines.append(line)
    for k, t in enumerate(lines):
        g.text((8, y + 12 + k * 22), t, fill="white", font=font)
    for c, v in enumerate(COLS):
        im = Image.open(ROOT / v / f"{p}.png").convert("RGB").resize((cw - 4, ch - 4))
        sheet.paste(im, (left + c * cw + 2, y + 2))
OUT.parent.mkdir(parents=True, exist_ok=True)
sheet.save(OUT)
print(OUT, sheet.size)
