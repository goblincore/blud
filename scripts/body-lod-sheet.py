#!/usr/bin/env python3
"""body-lod-sheet.py — A/B sheet for the distance mesh LOD spike (2026-11-08).

  python3 scripts/body-lod-sheet.py OUT.png TITLE  label:a.png:b.png  [label:a.png:b.png ...]

Each row is one pair (left = first image, right = second), cropped to where the two frames differ (padded, so the
bodies and their surroundings show) and scaled to the same height with nearest-neighbour, so a far body's pixels
stay pixels. A pair with no difference falls back to the frame's middle band.
"""
import sys
from PIL import Image, ImageChops, ImageDraw

ROW_H = 300
PAD = 28

def crop_box(a, b):
    diff = ImageChops.difference(a.convert('RGB'), b.convert('RGB')).convert('L').point(lambda v: 255 if v > 10 else 0)
    box = diff.getbbox()
    w, h = a.size
    if not box:
        return (w // 6, h // 4, w * 5 // 6, h * 3 // 4)
    x0, y0, x1, y1 = box
    x0, y0, x1, y1 = max(0, x0 - PAD), max(0, y0 - PAD), min(w, x1 + PAD), min(h, y1 + PAD)
    # keep a sane aspect: at least 1.3:1 wide
    if (x1 - x0) < 1.3 * (y1 - y0):
        cx = (x0 + x1) / 2; half = 0.65 * (y1 - y0)
        x0, x1 = max(0, int(cx - half)), min(w, int(cx + half))
    return (x0, y0, x1, y1)

def main():
    out, title, *rows = sys.argv[1:]
    tiles = []
    for spec in rows:
        label, pa, pb = spec.split(':')
        a, b = Image.open(pa).convert('RGB'), Image.open(pb).convert('RGB')
        box = crop_box(a, b)
        s = ROW_H / (box[3] - box[1])
        size = (max(1, int((box[2] - box[0]) * s)), ROW_H)
        tiles.append((label, a.crop(box).resize(size, Image.NEAREST), b.crop(box).resize(size, Image.NEAREST)))
    width = max(t[1].width * 2 + 30 for t in tiles) + 20
    height = 40 + sum(ROW_H + 30 for _ in tiles)
    sheet = Image.new('RGB', (width, height), (16, 16, 18))
    d = ImageDraw.Draw(sheet)
    d.text((10, 12), title, fill=(240, 230, 210))
    y = 40
    for label, a, b in tiles:
        d.text((10, y), label, fill=(220, 200, 160))
        sheet.paste(a, (10, y + 18)); sheet.paste(b, (10 + a.width + 20, y + 18))
        y += ROW_H + 30
    sheet.save(out)
    print(out, sheet.size)

if __name__ == '__main__':
    main()
