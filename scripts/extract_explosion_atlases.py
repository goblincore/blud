#!/usr/bin/env python3
"""Extract NotBlood's air + ground explosion animations into Blud VFX placeholder atlases.

NotBlood `actExplodeSprite` (actor.cpp ~5995) picks the explosion ANIMATION by
floor contact for the standard dynamite bundle (kThingArmedTNTBundle):

    if (gSpriteHit[nXSprite].florhit == 0) seqSpawn(4, ...);   // AIR  burst
    else                                   seqSpawn(3, ...);   // GROUND burst

So SEQ 4 is the compact mid-air fireball (tiles 984-986) and SEQ 3 is the
flat-bottomed ground dome (tiles 2378-2380). Both use nType=kExplosionStandard
for timing/damage — only the visual SEQ differs. Blud previously rendered ONE
mushroom-cloud atlas (tiles 2384-2388) for every detonation, which has a tall
rising stem that reads as "floating" when a dynamite explodes in mid-air.

This script re-parses SEQ 3 + SEQ 4 from BLOOD.RFF (no hardcoded tile numbers —
the tiles are derived from the SEQ), copies the matching decoded tile PNGs out of
the sprite-scan dump, and writes two placeholder atlases:

    public/assets/vfx/explosion-air-placeholder/      (SEQ 4)
    public/assets/vfx/explosion-ground-placeholder/   (SEQ 3)

Each manifest's `frames` list mirrors the SEQ's hold pattern (one entry per SEQ
frame, pointing at the unique-tile file index) so playback timing matches
NotBlood at `frameDurationMs` per frame.

Placeholder dirs are gitignored dev-only assets (never ship).

Usage:
    python -m scripts.extract_explosion_atlases <BLOOD.RFF> \
        --scan /Users/donny/Pictures/blud-sprite-scan \
        --out public/assets/vfx
"""
from __future__ import annotations
import argparse
import json
import shutil
from pathlib import Path

from scripts.rff_reader import read_rff, iter_by_ext
from scripts.seq_parser import parse_seq

# SEQ id → (placeholder dir name, human role) — see module docstring / actor.cpp.
EXPLOSION_SEQS = {
    4: ("explosion-air-placeholder", "air"),
    3: ("explosion-ground-placeholder", "ground"),
}


def find_tile_png(scan_dir: Path, tile: int) -> Path:
    """Locate a decoded tile PNG in the sprite-scan dump (zero-padded 5-digit)."""
    name = f"{tile:05d}.png"
    matches = list(scan_dir.glob(f"*_tiles/{name}")) + list(scan_dir.glob(name))
    if not matches:
        raise SystemExit(f"tile {tile} ({name}) not found under {scan_dir}")
    return matches[0]


def build_atlas(seq_id: int, dir_name: str, role: str, entries, scan_dir: Path, out_base: Path) -> None:
    seqs = {e.id: e for e in iter_by_ext(entries, "SEQ")}
    if seq_id not in seqs:
        raise SystemExit(f"SEQ {seq_id} not in BLOOD.RFF")
    parsed = parse_seq(seqs[seq_id].data)
    frames = parsed["frames"]
    tiles_in_order = [f["tile"] for f in frames]

    # Unique tiles, first-seen order → file index 0,1,2,...
    unique: list[int] = []
    for t in tiles_in_order:
        if t not in unique:
            unique.append(t)
    tile_to_idx = {t: i for i, t in enumerate(unique)}

    out_dir = out_base / dir_name
    out_dir.mkdir(parents=True, exist_ok=True)

    # Copy unique tile PNGs as 0.png, 1.png, ...
    for tile, idx in tile_to_idx.items():
        shutil.copy(find_tile_png(scan_dir, tile), out_dir / f"{idx}.png")

    dur_ms = round(parsed["ticksPerFrame"] * 1000 / 120)
    manifest = {
        "asset": f"explosion-{role}",
        "source": (
            f"NotBlood SEQ {seq_id} ({role} burst), tiles {unique}. "
            f"actExplodeSprite kThingArmedTNTBundle: florhit==0 -> SEQ 4 (air), else SEQ 3 (ground). "
            f"nType=kExplosionStandard. {parsed['nFrames']} SEQ frames @ {parsed['ticksPerFrame']} tics "
            f"({dur_ms} ms) each; held tiles collapsed to {len(unique)} files, frames[] mirrors the hold pattern."
        ),
        "frameDurationMs": dur_ms,
        "frames": [{"file": f"{tile_to_idx[t]}.png", "tile": t} for t in tiles_in_order],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"  {dir_name}: {len(unique)} tiles {unique} -> {len(tiles_in_order)} frames @ {dur_ms}ms")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("rff", help="Path to BLOOD.RFF")
    ap.add_argument("--scan", required=True, help="Sprite-scan dump dir (decoded tile PNGs)")
    ap.add_argument("--out", required=True, help="Output base dir (e.g. public/assets/vfx)")
    args = ap.parse_args()

    entries = read_rff(Path(args.rff))
    scan_dir = Path(args.scan)
    out_base = Path(args.out)
    print(f"extracting explosion atlases → {out_base}")
    for seq_id, (dir_name, role) in EXPLOSION_SEQS.items():
        build_atlas(seq_id, dir_name, role, entries, scan_dir, out_base)


if __name__ == "__main__":
    main()
