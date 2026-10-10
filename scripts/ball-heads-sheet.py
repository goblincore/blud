#!/usr/bin/env python3
"""The sheet of the eight ball-headed humanoids, before and after they draw a fitted anatomical skull.

    python3 scripts/ball-heads-sheet.py <frames dir> <out jpg> [column,column,...]   (default: before,after)

The frames are those of scripts/ball-heads-look.mjs (<column>__<character>__<view>.png and ball-heads.json). One row
a character; for each column: the bare bone from the front and from three-quarter (clean: VHS off, 0.6 m, the eye
level with the head), the flesh drawn half see-through over the bone (the flesh frame and the bone frame of one
camera, blended), and the face shot away with real rounds as the game ships (VHS on, 1.5 m, the player's eye
height), from the front and from three-quarter. Under each row: what the head is drawn with; for a fitted skull the
fit, its size, its share of the head it was fitted to (the skin: the flesh without painted hair), how far its orbits
stand from the painted eyes (read from skeleton-spike/skull-cast.ts, whose test holds the number) and what the fit
cost.

Every tile is the same window of the world around the head (WINDOW_M metres square), cut from the whole frame and
enlarged to the tile.
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WINDOW_M = 0.40
PAD = 4
BG = (18, 16, 16)
INK = (232, 226, 214)
DIM = (150, 144, 134)

COLUMNS = {
    'before': ('?skull=sculpt', 'before: every character draws its sculpted bone'),
    'after': ('no skull parameter: the default', 'after: the eight draw the anatomical skull, fitted'),
}
VIEWS = [
    ('bone-front', None, 'bone, front'),
    ('bone-quarter', None, 'bone, three-quarter'),
    ('flesh-front', 'bone-front', 'flesh half see-through'),
    ('shot-front', None, 'face shot away, as shipped, 1.5 m'),
    ('shot-quarter', None, 'the same, three-quarter'),
]


def font(size):
    for path in ('/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def window(frames, shots, name, size, under=None):
    """The WINDOW_M square about the head in frame `name`, at `size` pixels; blended half and half with frame
    `under` when one is given. None when the frame is missing."""
    shot = shots.get(name)
    path = frames / f'{name}.png'
    if not shot or not shot.get('centre') or not shot.get('pxPerM') or not path.exists():
        return None
    img = Image.open(path).convert('RGB')
    if under is not None:
        other = frames / f'{under}.png'
        if not other.exists():
            return None
        img = Image.blend(img, Image.open(other).convert('RGB'), 0.5)
    half = WINDOW_M / 2 * shot['pxPerM']
    cx, cy = shot['centre']
    return img.crop((round(cx - half), round(cy - half), round(cx + half), round(cy + half))).resize((size, size), Image.LANCZOS)


def eyes_off():
    """Each ball head's `eyesOff` (mm) from the table in skull-cast.ts."""
    text = (Path(__file__).resolve().parent.parent / 'src/lab/sdf-zombie/webgpu/skeleton-spike/skull-cast.ts').read_text()
    return {m.group(1): float(m.group(2)) for m in re.finditer(r"^  '?([a-z-]+)'?: \{\n(?:.*\n)*?    fill: \{[^}]*eyesOff: (-?[\d.]+)", text, re.M)}


def caption(boot, character, off):
    """The fit and its numbers, for a boot that draws the anatomical skull; what it draws, for one that does not."""
    fit = boot.get('fit')
    if not fit:
        return f"sculpted bone ({boot.get('material')})"
    if 'min' not in fit:
        return f"anatomical, {fit['name']}"
    size = [1000 * (fit['max'][k] - fit['min'][k]) for k in range(3)]
    flesh = fit['flesh']
    wide, deep = size[0] / (2000 * flesh['half']), size[2] / (1000 * (flesh['front'] + flesh['back']))
    where = ''
    if character in off:
        where = ', orbits on the painted eyes' if abs(off[character]) <= 2 else f', orbits {off[character]:.0f} mm over the painted eyes'
    radius = f", eyes r {1000 * fit['eyes'][0]['radius']:.0f} mm" if fit.get('eyes') else ''
    return (f"anatomical, {fit['name']}: {size[0]:.0f} x {size[1]:.0f} x {size[2]:.0f} mm, "
            f"{wide:.2f} of the head wide, {deep:.2f} deep{where}{radius}, fitted in {fit['madeMs']:.0f} ms")


def main():
    frames, out = Path(sys.argv[1]), Path(sys.argv[2])
    cols = (sys.argv[3] if len(sys.argv) > 3 else 'before,after').split(',')
    manifest = json.loads((frames / 'ball-heads.json').read_text())
    off = eyes_off()
    shots, boots = manifest['shots'], manifest['boots']
    cast = []
    for name in shots.values():
        if name['character'] not in cast:
            cast.append(name['character'])
    tile, label_w, head_h, foot_h = 196, 150, 64, 22
    col_w = len(VIEWS) * (tile + PAD)
    width = label_w + len(cols) * (col_w + 3 * PAD)
    height = head_h + len(cast) * (tile + foot_h + PAD)
    sheet = Image.new('RGB', (width, height), BG)
    draw = ImageDraw.Draw(sheet)
    big, small, tiny = font(17), font(13), font(11)
    for ci, col in enumerate(cols):
        x0 = label_w + ci * (col_w + 3 * PAD)
        query, what = COLUMNS.get(col, (col, ''))
        draw.text((x0, 6), what or col, font=big, fill=INK)
        draw.text((x0, 28), query, font=small, fill=DIM)
        for vi, (_, _, text) in enumerate(VIEWS):
            draw.text((x0 + vi * (tile + PAD), 46), text, font=tiny, fill=DIM)
    for ri, character in enumerate(cast):
        y0 = head_h + ri * (tile + foot_h + PAD)
        draw.text((8, y0 + 8), character, font=big, fill=INK)
        any_boot = next((boots.get(f'{c}/{character}') for c in cols if boots.get(f'{c}/{character}')), None)
        if any_boot:
            draw.text((8, y0 + 32), f"head {any_boot.get('headY', 0):.2f} m up", font=tiny, fill=DIM)
        for ci, col in enumerate(cols):
            x0 = label_w + ci * (col_w + 3 * PAD)
            boot = boots.get(f'{col}/{character}', {})
            for vi, (view, under, _) in enumerate(VIEWS):
                t = window(frames, shots, f'{col}__{character}__{view}', tile, f'{col}__{character}__{under}' if under else None)
                x = x0 + vi * (tile + PAD)
                if t is None:
                    draw.rectangle((x, y0, x + tile - 1, y0 + tile - 1), outline=DIM)
                    draw.text((x + 8, y0 + 8), 'not taken', font=tiny, fill=DIM)
                else:
                    sheet.paste(t, (x, y0))
            shot = boot.get('shot')
            note = caption(boot, character, off) + (f"; {shot['volleys']} volley, {shot['headWounds']} head wounds" if shot else '')
            draw.text((x0, y0 + tile + 4), note, font=tiny, fill=INK)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=88)
    print(f'{out}: {sheet.size[0]} x {sheet.size[1]}, {len(cast)} characters, columns {cols}')


if __name__ == '__main__':
    main()
