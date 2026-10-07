#!/usr/bin/env python3
"""Lay the frames of scripts/head-burst-look.mjs out as the before and after sheet.

    python3 scripts/head-burst-sheet.py <before dir> <after dir> <anatomical dir> <out jpg>

Each directory holds one run of the look script: <label>__<stage>__<view>.png and <label>.json (where the head is in
each frame, what each round did). <before dir> is the run with OLD=1 (the behaviour before 2026-10-07 put back with
burstTune), <after dir> the shipped rules, both on the sculpted skull (`?sculpt=full`); <anatomical dir> is the pop
scene alone on the anatomical skull (QUERY='' SCENES=slug-pop).

The sheet has two parts:

  the grid    one row a stage (pellet volleys 1 to 3, the slug on the chin, the centred slug, the body after the
              slug that took the head off), before on the left and after on the right, each as three tiles: front
              and profile as the game ships (VHS on, 1.5 m), and a clean close profile (VHS off, 0.6 m);
  the strips  the round that takes the head off, frame by frame at 60 frames a second, as the game draws it: before
              (a pellet volley, the head flies), after (a slug, the pop), the pop with the flesh out of the frame so
              the skull's pieces show, and the same two on the anatomical skull.

Every tile is the same window of the world around the head, cut from the whole frame and enlarged to the tile.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

TILE = 300
PAD = 4
GUTTER = 150
BG = (18, 16, 16)
INK = (232, 226, 214)
DIM = (150, 144, 134)
BOX = (240, 196, 60)
WINDOW_M = 0.46
STRIP_TILE = 232
STRIP_WINDOW_M = 0.9

ROWS = [
    ('pellets-1', 'Pellets, 1 volley\ncrosshair on the\nhead\'s centre, 2 m'),
    ('pellets-2', 'Pellets, 2 volleys'),
    ('pellets-3', 'Pellets, 3 volleys'),
    ('slug-chin', 'Slug, off centre\n(crosshair low: it\nlands on the chin)'),
    ('slug-split', 'Slug, centred\n(crosshair 4 cm over\nthe head\'s centre)'),
    ('slug-pop-after', 'After the round that\ntook the head off\n(the stump bleeding)'),
]
VIEWS = [('ships-front', 'front, as shipped'), ('ships-profile', 'profile, as shipped'), ('clean-profile', 'profile, clean, 0.6 m')]


def font(size):
    for path in ('/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


class Run:
    def __init__(self, directory):
        self.dir = Path(directory)
        files = sorted(self.dir.glob('*.json'))
        self.data = json.loads(files[0].read_text()) if files else {'shots': {}, 'rounds': {}, 'stages': {}}
        self.label = self.data.get('label', '')

    def tile(self, stage, view, window, size):
        name = f'{self.label}__{stage}__{view}'
        shot, path = self.data['shots'].get(name), self.dir / f'{name}.png'
        if not shot or not path.exists() or not shot.get('centre') or not shot.get('pxPerM'):
            return None
        frame = Image.open(path).convert('RGB')
        half = window * shot['pxPerM'] / 2
        cx, cy = shot['centre']
        return frame.crop((round(cx - half), round(cy - half), round(cx + half), round(cy + half))).resize((size, size), Image.LANCZOS)

    def frames(self, stage):
        return (self.data['stages'].get(stage) or {}).get('frames') or []


def pick(frames, count=9):
    """The strip's frames: one before the event (the swell's first frame, or the frame the head leaves), then the
    event and what follows, closer together at first."""
    if not frames:
        return []
    swell = next((f['k'] for f in frames if f.get('popping')), None)
    off = next((f['k'] for f in frames if not f.get('headOn')), None)
    start = swell if swell is not None else off if off is not None else 0
    steps = [-1, 1, 3, 5, 7, 8, 10, 13, 18, 24]
    ks = []
    for s in steps:
        k = start + s
        if 0 <= k < len(frames) and k not in ks:
            ks.append(k)
    return ks[:count]


def main():
    before, after, anat, out = Run(sys.argv[1]), Run(sys.argv[2]), Run(sys.argv[3]), Path(sys.argv[4])
    big, mid, small = font(24), font(16), font(13)
    strips = [
        (before, 'slug-pop', 'BEFORE: a pellet volley\ncuts the neck and the\nhead flies (a slug\nmade the opening and\ndid not cut it)'),
        (after, 'slug-pop', 'AFTER: a slug cuts the\nneck and the head\npops (sculpted skull)'),
        (after, 'pop-bare', 'The pop, the flesh\nout of the frame:\nthe sculpted skull\'s\nten fragments'),
        (anat, 'slug-pop', 'The pop on the\nanatomical skull'),
        (anat, 'pop-bare', 'The flesh out of the\nframe: the anatomical\nskull\'s fourteen plates'),
    ]
    picked = [(run, stage, label, pick(run.frames(stage))) for run, stage, label in strips]
    strip_cols = max([len(p[3]) for p in picked] + [1])
    grid_w = GUTTER + 2 * (3 * (TILE + PAD) + 3 * PAD) + PAD
    strip_w = GUTTER + strip_cols * (STRIP_TILE + PAD) + PAD
    width = max(grid_w, strip_w)
    head = 96
    grid_h = len(ROWS) * (TILE + PAD)
    strip_head = 64
    height = head + grid_h + strip_head + len(picked) * (STRIP_TILE + PAD) + PAD
    img = Image.new('RGB', (width, height), BG)
    draw = ImageDraw.Draw(img)
    draw.text((PAD * 2, 8), 'What the gun does to a zombie\'s head: before and after (2026-10-07)', fill=INK, font=big)
    draw.text((PAD * 2, 40), 'The sculpted skull (?sculpt=full), real rounds from 2 m, the cast thawed for a quarter of a second after each. Tiles: a 0.46 m window around the head. '
              'Before = the old behaviour put back with burstTune (the opening on every gun hit, the stock lip).', fill=DIM, font=small)
    half = 3 * (TILE + PAD) + 3 * PAD
    for side, (run, name) in enumerate(((before, 'BEFORE: every gun hit on the head made the burst opening'), (after, 'AFTER: ordinary wounds; a centred slug splits; the decapitating slug pops'))):
        x0 = GUTTER + side * half + PAD
        draw.text((x0, 58), name, fill=BOX if side == 0 else INK, font=mid)
        for c, (_view, caption) in enumerate(VIEWS):
            draw.text((x0 + c * (TILE + PAD), 78), caption, fill=DIM, font=small)
        for r, (stage, _label) in enumerate(ROWS):
            y = head + r * (TILE + PAD)
            for c, (view, _caption) in enumerate(VIEWS):
                x = x0 + c * (TILE + PAD)
                cut = run.tile(stage, view, WINDOW_M, TILE)
                if cut is None:
                    draw.rectangle((x, y, x + TILE - 1, y + TILE - 1), outline=DIM)
                    draw.text((x + 12, y + 12), 'no frame', fill=DIM, font=small)
                else:
                    img.paste(cut, (x, y))
    for r, (_stage, label) in enumerate(ROWS):
        draw.multiline_text((PAD * 2, head + r * (TILE + PAD) + 8), label, fill=INK, font=small, spacing=4)
    # The strips.
    y0 = head + grid_h + 8
    draw.text((PAD * 2, y0), 'The round that takes the head off, frame by frame (60 frames a second; the number is the frame after the shot)', fill=INK, font=mid)
    draw.text((PAD * 2, y0 + 24), 'As the game draws it (VHS on, no settling), from 1.5 m, three-quarter; a 0.9 m window around the head. The swell is popSwellS = 0.12 s: eight frames. The cast is held frozen.', fill=DIM, font=small)
    for r, (run, stage, label, ks) in enumerate(picked):
        y = head + grid_h + strip_head + r * (STRIP_TILE + PAD)
        draw.multiline_text((PAD * 2, y + 8), label, fill=INK, font=small, spacing=4)
        frames = run.frames(stage)
        for c, k in enumerate(ks):
            x = GUTTER + c * (STRIP_TILE + PAD) + PAD
            cut = run.tile(stage, f'f{k:02d}', STRIP_WINDOW_M, STRIP_TILE)
            if cut is None:
                draw.rectangle((x, y, x + STRIP_TILE - 1, y + STRIP_TILE - 1), outline=DIM)
                continue
            img.paste(cut, (x, y))
            f = frames[k]
            what = 'swelling' if f.get('popping') else ('head on' if f.get('headOn') else 'head off')
            draw.rectangle((x, y, x + 150, y + 18), fill=(0, 0, 0))
            draw.text((x + 4, y + 2), f'frame {k}: {what}', fill=INK, font=small)
        if not ks:
            draw.text((GUTTER + 12, y + 12), 'no frames', fill=DIM, font=small)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, quality=88)
    print(f'wrote {out} {width} x {height}')


if __name__ == '__main__':
    main()
