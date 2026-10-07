#!/usr/bin/env python3
"""The two sheets made when the sculpted skull, `full`, became the default skull.

    python3 scripts/sculpt-skull-default-sheet.py cast <frames dir> <out jpg> [column,column,...]
    python3 scripts/sculpt-skull-default-sheet.py cell <frames dir> <out jpg>

`cast`: the frames of scripts/sculpt-skull-cast-look.mjs (<column>__<character>__<view>.png and cast.json). One row a
character, its bare head bone from the front and from three-quarter under each column's page query (clean: VHS off,
0.6 m). The row's label says which paint the default draws that head with.

`cell`: the frames of scripts/sculpt-skull-look.mjs run with COLS=full-1cm,full SCENES=soldier-face,zombie-bare
(<column>__<scene>__<view>.png and shots.json). One row a head cell (1 cm, 5 mm), one column a view.

Every tile is the same window of the world around the head (WINDOW_M metres square), cut from the whole frame and
enlarged to the tile, as scripts/sculpt-skull-sheet.py does.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WINDOW_M = 0.34
PAD = 4
BG = (18, 16, 16)
INK = (232, 226, 214)
DIM = (150, 144, 134)
BOX = (240, 196, 60)
WARN = (236, 120, 96)

CAST_COLUMNS = {
    'classic': ('?sculpt=classic', 'the first look: the first paint on every head'),
    'default': ('no skull parameter', 'the page as it ships'),
    'every-head': ('?sculpt=full&sculptheads=all', 'the second paint on every head'),
}
CAST_VIEWS = [('clean-0p6-front', 'front'), ('clean-0p6-quarter', 'three-quarter')]
CELL_ROWS = [('full-1cm', '?sculpt=full-1cm', 'the head at the 1 cm cell'), ('full', '?sculpt=full (the default)', 'the head at the 5 mm cell')]
CELL_VIEWS = [
    ('soldier-face', 'ships-2p5', 'Soldier, face shot away\nas the game ships, 2.5 m'),
    ('soldier-face', 'ships-1p0', 'Soldier, face shot away\nas the game ships, 1 m'),
    ('soldier-face', 'clean-0p6', 'Soldier, face shot away\nclean, 0.6 m'),
    ('zombie-bare', 'ships-2p5-front', 'Zombie, flesh hidden\nas the game ships, 2.5 m'),
    ('zombie-bare', 'ships-1p0-front', 'Zombie, flesh hidden\nas the game ships, 1 m'),
    ('zombie-bare', 'clean-0p6-front', 'Zombie, flesh hidden\nclean, 0.6 m'),
    ('zombie-bare', 'clean-0p6-quarter', 'Zombie, flesh hidden\nclean, three-quarter, 0.6 m'),
]


def font(size):
    for path in ('/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def tile(frames, shot, name, size):
    """The world window around the head, cut from the frame and enlarged to the tile. Returns (image, enlargement)."""
    path = frames / f'{name}.png'
    if not shot or not path.exists() or not shot.get('centre') or not shot.get('pxPerM'):
        return None, None
    frame = Image.open(path).convert('RGB')
    half = WINDOW_M * shot['pxPerM'] / 2
    cx, cy = shot['centre']
    box = (round(cx - half), round(cy - half), round(cx + half), round(cy + half))
    return frame.crop(box).resize((size, size), Image.LANCZOS), size / (2 * half)


def missing(draw, x, y, size, small):
    draw.rectangle((x, y, x + size - 1, y + size - 1), outline=DIM)
    draw.text((x + 12, y + 12), 'no frame', fill=DIM, font=small)


def cast(frames, out, cols):
    data = json.loads((frames / 'cast.json').read_text())
    shots, boots = data['shots'], data['boots']
    characters = []
    for shot in shots.values():
        if shot['character'] not in characters:
            characters.append(shot['character'])
    size, gutter, head = 300, 190, 96
    per = len(CAST_VIEWS)
    width = gutter + len(cols) * per * (size + PAD) + (len(cols) - 1) * 3 * PAD + PAD
    height = head + len(characters) * (size + PAD) + PAD
    img = Image.new('RGB', (width, height), BG)
    draw = ImageDraw.Draw(img)
    big, mid, small = font(24), font(16), font(13)
    draw.text((PAD * 2, 8), 'Every humanoid\'s bare head bone: the first look, and the default', fill=INK, font=big)
    draw.text((PAD * 2, 40), 'Flesh hidden, VHS off, 0.6 m. Each tile is a 0.34 m window around the head. The eye is level with a head at or above 1.62 m, and looks down on a lower one.', fill=DIM, font=small)
    x_of = lambda c, v: gutter + c * (per * (size + PAD) + 3 * PAD) + v * (size + PAD) + PAD
    for c, col in enumerate(cols):
        name, caption = CAST_COLUMNS.get(col, (col, ''))
        draw.text((x_of(c, 0), 58), name, fill=BOX if c == 0 else INK, font=mid)
        draw.text((x_of(c, 0), 78), caption, fill=DIM, font=small)
        for v, (_, label) in enumerate(CAST_VIEWS):
            draw.text((x_of(c, v) + size - 8 - draw.textlength(label, font=small), 78), label, fill=DIM, font=small)
    default = boots.get('default', {}).get('heads', {})
    for r, character in enumerate(characters):
        y = head + r * (size + PAD)
        draw.text((PAD * 2, y + 8), character, fill=INK, font=mid)
        lines = []
        info = default.get(character)
        if info:
            lines.append(f"head at {info['headY']:.2f} m")
            if info.get('paint') is not None:
                lines.append(f"default: paint {info['paint']}")
        front = shots.get(f'{cols[0]}__{character}__clean-0p6-front')
        if front and abs(front.get('pitchDeg', 0)) > 0.5:
            lines.append(f"seen from {abs(front['pitchDeg']):.0f} deg above")
        draw.multiline_text((PAD * 2, y + 32), '\n'.join(lines), fill=DIM, font=small, spacing=4)
        if info and info.get('paint') == 1:
            draw.multiline_text((PAD * 2, y + 36 + 17 * len(lines)), 'kept on the\nfirst paint', fill=WARN, font=small, spacing=4)
        for c, col in enumerate(cols):
            for v, (view, _) in enumerate(CAST_VIEWS):
                name = f'{col}__{character}__{view}'
                cut, _k = tile(frames, shots.get(name), name, size)
                if cut is None:
                    missing(draw, x_of(c, v), y, size, small)
                else:
                    img.paste(cut, (x_of(c, v), y))
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, quality=88)
    print(f'wrote {out} {width} x {height}')


def cell(frames, out):
    data = json.loads((frames / 'shots.json').read_text())
    shots, boots = data['shots'], data['boots']
    size, gutter, head = 280, 170, 110
    width = gutter + len(CELL_VIEWS) * (size + PAD) + PAD
    height = head + len(CELL_ROWS) * (size + PAD) + PAD
    img = Image.new('RGB', (width, height), BG)
    draw = ImageDraw.Draw(img)
    big, mid, small = font(24), font(16), font(13)
    draw.text((PAD * 2, 8), 'The default skull at a 1 cm head cell and at 5 mm', fill=INK, font=big)
    draw.text((PAD * 2, 40), 'The second sculpt under the second paint; only the carved head\'s extraction cell differs. Each tile is a 0.34 m window around the head, enlarged from the frame by the factor under its heading.', fill=DIM, font=small)
    for v, (scene, view, label) in enumerate(CELL_VIEWS):
        x = gutter + v * (size + PAD) + PAD
        draw.multiline_text((x, 60), label, fill=INK, font=small, spacing=3)
    for r, (col, name, caption) in enumerate(CELL_ROWS):
        y = head + r * (size + PAD)
        draw.text((PAD * 2, y + 8), name, fill=INK, font=small)
        draw.text((PAD * 2, y + 28), caption, fill=DIM, font=small)
        lines = []
        for kind in ('soldier', 'zombie'):
            cache = (boots.get(f'{col}/{kind}') or {}).get('cache')
            if cache:
                stats = cache['stats']
                lines.append(f"{kind} boot: {stats['extractMs']:.0f} ms of\nextraction, {cache['totals']['tris']:,}\ntriangles cached")
        draw.multiline_text((PAD * 2, y + 54), '\n'.join(lines), fill=DIM, font=small, spacing=3)
        for v, (scene, view, _) in enumerate(CELL_VIEWS):
            x = gutter + v * (size + PAD) + PAD
            shot_name = f'{col}__{scene}__{view}'
            cut, k = tile(frames, shots.get(shot_name), shot_name, size)
            if cut is None:
                missing(draw, x, y, size, small)
                continue
            img.paste(cut, (x, y))
            if r == 0:
                draw.text((x, 94), f'frame x {k:.1f}', fill=DIM, font=small)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, quality=90)
    print(f'wrote {out} {width} x {height}')


def main():
    kind, frames, out = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    if kind == 'cast':
        cast(frames, out, sys.argv[4].split(',') if len(sys.argv) > 4 else ['classic', 'default'])
    elif kind == 'cell':
        cell(frames, out)
    else:
        sys.exit(f'unknown sheet {kind}: cast or cell')


if __name__ == '__main__':
    main()
