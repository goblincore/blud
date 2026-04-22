#!/usr/bin/env python3
"""Bake BLOOD.PAL into a 16x16 LUT PNG for the palette-dither shader.

Each pixel is one palette entry (R/G/B from the palette, A=0xFF). The shader
samples via a texture2D lookup to snap scene colors to the Blood palette.

Dev-only placeholder pipeline — the LUT is regenerated from the user's
local BLOOD.RFF and should never be committed (see .gitignore).
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

from PIL import Image

# Reuse palette loader from the sprite extractor.
sys.path.insert(0, str(Path(__file__).parent))
from extract_blood_sprites import read_palette_from_rff  # type: ignore


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("rff_path", type=Path, help="Path to BLOOD.RFF")
    p.add_argument(
        "--out",
        type=Path,
        default=Path("public/assets/post-fx/BLOOD.PAL.png"),
        help="Output 16x16 PNG",
    )
    args = p.parse_args()

    pal = read_palette_from_rff(args.rff_path)
    if len(pal) != 768:
        raise SystemExit(f"expected 768-byte palette, got {len(pal)}")

    img = Image.new("RGBA", (16, 16))
    for i in range(256):
        r, g, b = pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]
        img.putpixel((i % 16, i // 16), (r, g, b, 255))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    img.save(args.out)
    print(f"wrote {args.out} (16x16 RGBA, 256 entries)")


if __name__ == "__main__":
    main()
