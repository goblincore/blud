#!/usr/bin/env python3
"""Contact sheets for the rupture/slough/refraction review frames.

Frames come from scripts/sdf-rupture-look.mjs as `fNNN.png` (plus `f000-pre.png`).
A sheet is the only practical way to judge a 200 ms rupture: eight stills side by
side across the tear window read as motion, where one frame at an arbitrary
moment reads as a blob.

    scripts/rupture-sheet.py <dir> <out.jpg> [--frames f000-pre,f004,...]
        [--tile 400x300] [--cols 4] [--crop CX,CY,W,H]   # crop in 0..1 units
        [--label-prefix P]

`--crop` is what makes an anatomy sheet legible: the body occupies a small part
of the 800x600 gameplay frame, and a 0..1 crop window around it fills the tile.
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont


def default_frames(names):
    """Evenly spaced picks across the sequence, keeping the pre frame first."""
    pre = [n for n in names if n.endswith("-pre")]
    rest = [n for n in names if not n.endswith("-pre")]
    rest.sort()
    picks = pre[:1]
    if len(rest) > 12:
        step = (len(rest) - 1) / 11
        idx = sorted({round(i * step) for i in range(12)})
        picks += [rest[i] for i in idx]
    else:
        picks += rest
    return picks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("out")
    ap.add_argument("--frames", default="")
    ap.add_argument("--tile", default="400x300")
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--crop", default="")
    ap.add_argument("--label-prefix", default="")
    args = ap.parse_args()

    tw, th = (int(v) for v in args.tile.lower().split("x"))
    names = sorted(
        os.path.splitext(f)[0]
        for f in os.listdir(args.dir)
        if f.endswith(".png") and not f.endswith("-sheet.png")
    )
    if not names:
        sys.exit(f"no PNG frames in {args.dir}")
    picks = (
        [p.strip() for p in args.frames.split(",") if p.strip()]
        if args.frames
        else default_frames(names)
    )
    crop = None
    if args.crop:
        cx, cy, cw, ch = (float(v) for v in args.crop.split(","))
        crop = (cx, cy, cw, ch)

    cols = max(1, args.cols)
    rows = (len(picks) + cols - 1) // cols
    sheet = Image.new("RGB", (tw * cols, th * rows), (8, 8, 10))
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 20)
    except OSError:
        font = ImageFont.load_default()

    for i, name in enumerate(picks):
        path = os.path.join(args.dir, name + ".png")
        if not os.path.exists(path):
            sys.exit(f"missing frame {path}")
        im = Image.open(path).convert("RGB")
        if crop:
            W, H = im.size
            box = (int(crop[0] * W), int(crop[1] * H),
                   int((crop[0] + crop[2]) * W), int((crop[1] + crop[3]) * H))
            im = im.crop(box)
        im = im.resize((tw, th))
        dr = ImageDraw.Draw(im)
        label = args.label_prefix + name
        dr.rectangle([0, 0, 170, 24], fill=(0, 0, 0))
        dr.text((5, 2), label, fill=(255, 225, 120), font=font)
        sheet.paste(im, ((i % cols) * tw, (i // cols) * th))

    sheet.save(args.out, quality=90)
    print(f"{args.out}: {len(picks)} tiles {sheet.size[0]}x{sheet.size[1]} from {args.dir}")


if __name__ == "__main__":
    main()
