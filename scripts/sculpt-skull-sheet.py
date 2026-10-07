#!/usr/bin/env python3
"""Lay the frames of scripts/sculpt-skull-look.mjs out as the two look sheets.

    python3 scripts/sculpt-skull-sheet.py <frames dir> <out dir> [column,column,...]

<frames dir> holds <column>__<scene>__<view>.png and shots.json (where the head is in each frame). Two JPEGs are
written to <out dir>:

    sheet-as-the-game-ships.jpg   every scene from 2.5 m and from 1 m, as the game draws it (VHS on, wounds bleeding)
    sheet-clean-close-up.jpg      every scene from 0.6 m with VHS off and the blood drops cleared, and the jaw from
                                  0.45 m

Every tile is the same window of the world around the head (WINDOW_M metres square), cut from the whole frame and
enlarged to the tile, so a head is the same size in every tile and what differs is how many of the game's pixels it
was drawn with: a tile from 2.5 m is the frame enlarged about three times, one from 1 m about 1.2 times, and one from
0.6 m is about the frame's own size. The enlargement is written on each row. The first column (the skull as it is
today) is boxed.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WINDOW_M = 0.34
TILE = 372
GUTTER = 140
HEAD = 92
PAD = 4
BG = (18, 16, 16)
INK = (232, 226, 214)
DIM = (150, 144, 134)
BOX = (240, 196, 60)

COLUMNS = {
    'old': ('old skull (today)', '?skull=sculpt: the reference'),
    'shape': ('shape', 'new bone at the 1 cm cell, old paint'),
    'shape-fine': ('shape-fine', 'new bone at a 5 mm cell, old paint'),
    'paint': ('paint', 'old bone, new paint and painted relief'),
    'full': ('full', 'new bone at 5 mm under the new paint'),
    'anatomical': ('anatomical', 'the GLB skull (the default)'),
}
SHIPS = [
    ('soldier-face', 'ships-2p5', 'Soldier, face shot away\n2.5 m'),
    ('soldier-face', 'ships-1p0', 'Soldier, face shot away\n1 m'),
    ('soldier-bare', 'ships-2p5-front', 'Soldier, flesh hidden\nfront, 2.5 m'),
    ('soldier-bare', 'ships-1p0-front', 'Soldier, flesh hidden\nfront, 1 m'),
    ('soldier-bare', 'ships-2p5-quarter', 'Soldier, flesh hidden\nthree-quarter, 2.5 m'),
    ('soldier-bare', 'ships-1p0-quarter', 'Soldier, flesh hidden\nthree-quarter, 1 m'),
    ('soldier-bare', 'ships-0p8-jaw', 'Soldier, jaw and teeth\nthree-quarter, from\nbelow, 0.8 m'),
    ('zombie-burst', 'ships-2p5', 'Zombie, two slugs\n2.5 m'),
    ('zombie-burst', 'ships-1p0', 'Zombie, two slugs\n1 m'),
    ('zombie-chop1', 'ships-2p5', 'Zombie, axe chop 1\n2.5 m'),
    ('zombie-chop1', 'ships-1p0', 'Zombie, axe chop 1\n1 m'),
    ('zombie-chop2', 'ships-2p5', 'Zombie, axe chop 2\n2.5 m'),
    ('zombie-chop2', 'ships-1p0', 'Zombie, axe chop 2\n1 m'),
    ('zombie-bare', 'ships-2p5-front', 'Zombie, flesh hidden\nfront, 2.5 m'),
    ('zombie-bare', 'ships-1p0-front', 'Zombie, flesh hidden\nfront, 1 m'),
    ('zombie-bare', 'ships-2p5-quarter', 'Zombie, flesh hidden\nthree-quarter, 2.5 m'),
    ('zombie-bare', 'ships-1p0-quarter', 'Zombie, flesh hidden\nthree-quarter, 1 m'),
    ('zombie-bare', 'ships-0p8-jaw', 'Zombie, jaw and teeth\nthree-quarter, level,\n0.8 m'),
]
CLEAN = [
    ('soldier-face', 'clean-0p6', 'Soldier, face shot away\n0.6 m'),
    ('soldier-bare', 'clean-0p6-front', 'Soldier, flesh hidden\nfront, 0.6 m'),
    ('soldier-bare', 'clean-0p6-quarter', 'Soldier, flesh hidden\nthree-quarter, 0.6 m'),
    ('soldier-bare', 'clean-0p45-jaw', 'Soldier, jaw and teeth\nthree-quarter, from\nbelow, 0.45 m'),
    ('zombie-burst', 'clean-0p6', 'Zombie, two slugs\n0.6 m'),
    ('zombie-chop1', 'clean-0p6', 'Zombie, axe chop 1\n0.6 m'),
    ('zombie-chop2', 'clean-0p6', 'Zombie, axe chop 2\n0.6 m'),
    ('zombie-bare', 'clean-0p6-front', 'Zombie, flesh hidden\nfront, 0.6 m'),
    ('zombie-bare', 'clean-0p6-quarter', 'Zombie, flesh hidden\nthree-quarter, 0.6 m'),
    ('zombie-bare', 'clean-0p45-jaw', 'Zombie, jaw and teeth\nthree-quarter, level,\n0.45 m'),
]


def font(size):
    for path in ('/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def tile(frames, shots, col, scene, view):
    """The world window around the head, cut from the frame and enlarged to the tile. Returns (image, enlargement)."""
    name = f'{col}__{scene}__{view}'
    shot, path = shots.get(name), frames / f'{name}.png'
    if not shot or not path.exists() or not shot.get('centre') or not shot.get('pxPerM'):
        return None, None
    frame = Image.open(path).convert('RGB')
    half = WINDOW_M * shot['pxPerM'] / 2
    cx, cy = shot['centre']
    box = (round(cx - half), round(cy - half), round(cx + half), round(cy + half))
    return frame.crop(box).resize((TILE, TILE), Image.LANCZOS), TILE / (2 * half)


def sheet(frames, shots, cols, rows, title, note, out):
    width = GUTTER + len(cols) * (TILE + PAD) + PAD
    height = HEAD + len(rows) * (TILE + PAD) + PAD
    img = Image.new('RGB', (width, height), BG)
    draw = ImageDraw.Draw(img)
    big, mid, small = font(24), font(17), font(13)
    draw.text((PAD * 2, 8), title, fill=INK, font=big)
    draw.text((PAD * 2, 40), note, fill=DIM, font=small)
    for c, col in enumerate(cols):
        x = GUTTER + c * (TILE + PAD) + PAD
        name, caption = COLUMNS.get(col, (col, ''))
        draw.text((x, 58), name, fill=BOX if c == 0 else INK, font=mid)
        draw.text((x, 78), caption, fill=DIM, font=small)
    for r, (scene, view, label) in enumerate(rows):
        y = HEAD + r * (TILE + PAD)
        scale = None
        for c, col in enumerate(cols):
            x = GUTTER + c * (TILE + PAD) + PAD
            cut, k = tile(frames, shots, col, scene, view)
            if cut is None:
                draw.rectangle((x, y, x + TILE - 1, y + TILE - 1), outline=DIM)
                draw.text((x + 12, y + 12), 'no frame', fill=DIM, font=small)
                continue
            img.paste(cut, (x, y))
            scale = scale or k
        draw.multiline_text((PAD * 2, y + 8), label, fill=INK, font=small, spacing=4)
        if scale:
            draw.text((PAD * 2, y + 22 + 17 * (label.count(chr(10)) + 1)), f'frame x {scale:.1f}', fill=DIM, font=small)
    # The reference column's box.
    x0 = GUTTER + PAD - 3
    draw.rectangle((x0, HEAD - 3, x0 + TILE + 5, height - PAD + 1), outline=BOX, width=3)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, quality=88)
    print(f'wrote {out} {width} x {height}')


def main():
    frames, out = Path(sys.argv[1]), Path(sys.argv[2])
    cols = sys.argv[3].split(',') if len(sys.argv) > 3 else ['old', 'shape', 'shape-fine', 'paint', 'full']
    shots = json.loads((frames / 'shots.json').read_text())['shots']
    sheet(frames, shots, cols, SHIPS, 'The sculpted skull\'s variants, as the game ships',
          'Default post chain (VHS on), default 800 x 600 internal resolution, wounds bleeding, the player\'s eye height. Each tile is a 0.34 m window around the head, enlarged from the frame by the factor on its row.',
          out / 'sheet-as-the-game-ships.jpg')
    sheet(frames, shots, cols, CLEAN, 'The sculpted skull\'s variants, clean close-up',
          'VHS off, blood drops cleared, 0.6 m (the jaw rows 0.45 m, three-quarter). For inspecting the work: the game is not judged at this distance.',
          out / 'sheet-clean-close-up.jpg')


if __name__ == '__main__':
    main()
