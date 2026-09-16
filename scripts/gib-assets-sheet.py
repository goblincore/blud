#!/usr/bin/env python3
"""A/B contact sheets for the Task 3 gib-asset visual gate.

Rows are frames, columns are the two arms (march on the left, assets on the
right), so a silhouette/material difference reads directly across a row. This is
the reviewer's instrument for the frames `scripts/sdf-gib-assets-look.mjs`
writes.

    scripts/gib-assets-sheet.py <dirA> <dirB> <out.jpg> [--frames f013,...]
        [--tile 380x285] [--crop CX,CY,W,H] [--labels march,assets]
        [--every N]
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont


def pick_frames(names, every):
    rest = sorted(n[:-4] for n in names if n.endswith('.png') and n.startswith('f'))
    pre = sorted(n[:-4] for n in names if n.endswith('-pre.png'))
    picks = pre[:1]
    if every and len(rest) > every:
        picks += rest[::every]
        if rest[-1] not in picks:
            picks.append(rest[-1])
    else:
        picks += rest
    return picks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dirA')
    ap.add_argument('dirB')
    ap.add_argument('out')
    ap.add_argument('--frames', default='')
    ap.add_argument('--every', type=int, default=0)
    ap.add_argument('--tile', default='380x285')
    ap.add_argument('--crop', default='')
    ap.add_argument('--labels', default='march,assets')
    args = ap.parse_args()

    tw, th = (int(v) for v in args.tile.lower().split('x'))
    crop = None
    if args.crop:
        cx, cy, cw, ch = (float(v) for v in args.crop.split(','))
        crop = (cx, cy, cw, ch)
    labelA, labelB = args.labels.split(',')

    names = os.listdir(args.dirA)
    frames = ([f for f in args.frames.split(',') if f] if args.frames
              else pick_frames(names, args.every))
    if not frames:
        print('no frames', file=sys.stderr)
        return 2

    def load(d, f):
        p = os.path.join(d, f + '.png')
        if not os.path.exists(p):
            return None
        im = Image.open(p).convert('RGB')
        if crop:
            w, h = im.size
            x0 = int((crop[0] - crop[2] / 2) * w)
            y0 = int((crop[1] - crop[3] / 2) * h)
            im = im.crop((max(0, x0), max(0, y0),
                          min(w, x0 + int(crop[2] * w)), min(h, y0 + int(crop[3] * h))))
        return im.resize((tw, th))

    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 14)
    except Exception:
        font = ImageFont.load_default()

    cols = 2
    rows = len(frames)
    sheet = Image.new('RGB', (tw * cols, (th + 18) * rows), (12, 12, 14))
    draw = ImageDraw.Draw(sheet)
    for r, f in enumerate(frames):
        y = r * (th + 18)
        draw.text((6, y + 2), f'{f}  [{labelA}]', fill=(230, 230, 230), font=font)
        draw.text((tw + 6, y + 2), f'{f}  [{labelB}]', fill=(230, 230, 230), font=font)
        a = load(args.dirA, f)
        b = load(args.dirB, f)
        if a:
            sheet.paste(a, (0, y + 18))
        if b:
            sheet.paste(b, (tw, y + 18))
    sheet.save(args.out, quality=88)
    print(f'{args.out}: {len(frames)} frames x 2 arms -> {sheet.size[0]}x{sheet.size[1]}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
