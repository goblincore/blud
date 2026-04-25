#!/usr/bin/env python3
"""Extract SEQ animations from BLOOD.RFF into JSON manifests.

Usage: python -m scripts.extract_seq <blood.rff> --out <dir> --ids 4352,4353,...
       python -m scripts.extract_seq <blood.rff> --out <dir> --only zombie-idle

Axe zombie SEQ IDs (seqStartId=4352, from NotBlood aizomba.cpp + actor.cpp):
  offset 0  → SEQ 4352: idle
  offset 1  → SEQ 4353: death-normal / recoil2
  offset 2  → SEQ 4354: death-explode (gib)
  offset 3  → SEQ 4355: burn-chase/goto/search
  offset 4  → SEQ 4356: tesla-recoil
  offset 5  → SEQ 4357: recoil
  offset 6  → SEQ 4358: hack/attack
  offset 7  → SEQ 4359: death-gib variant
  offset 8  → SEQ 4360: chase/goto/search (walk)
  offset 11 → SEQ 4363: stand
  offset 13 → SEQ 4365: death-burn
  offset 14 → SEQ 4366: death-spirit
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

from scripts.rff_reader import read_rff, iter_by_ext
from scripts.seq_parser import parse_seq


# Axe zombie SEQ IDs (seqStartId=4352)
SEQ_NAMES_BY_ID: dict[int, str] = {
    4352: "zombie-idle",
    4353: "zombie-death-normal",       # also recoil2
    4354: "zombie-death-explode",      # gib death
    4355: "zombie-burn-chase",         # burning zombie chase
    4356: "zombie-tesla-recoil",
    4357: "zombie-recoil",
    4358: "zombie-attack",             # hack
    4359: "zombie-death-gib",          # gib variant
    4360: "zombie-chase",              # walk/chase/goto/search
    4363: "zombie-stand",
    4365: "zombie-death-burn",
    4366: "zombie-death-spirit",
    # Shotgun cultist SEQs (seqStartId=11520, from NotBlood aicult.cpp AISTATE seq offsets)
    # offsets: 0=idle, 1=death-normal, 2=death-gib, 5=recoil, 6=shotgun-fire, 9=chase
    11520: "cultist-shotgun-idle",
    11521: "cultist-shotgun-death-normal",
    11522: "cultist-shotgun-death-gib",
    11525: "cultist-shotgun-recoil",
    11526: "cultist-shotgun-fire",
    11529: "cultist-shotgun-chase",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("rff", help="Path to BLOOD.RFF")
    ap.add_argument("--out", required=True, help="Output directory")
    ap.add_argument("--ids", help="Comma-separated list of SEQ IDs to extract")
    ap.add_argument("--only", help="Extract single SEQ by name (from SEQ_NAMES_BY_ID)")
    ap.add_argument("--angle-stride", type=int, default=5,
                    help="Angle stride for tile offset division (default: 5)")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    entries = read_rff(Path(args.rff))
    seqs = list(iter_by_ext(entries, "SEQ"))

    wanted_ids: set[int] | None = None
    if args.ids:
        wanted_ids = {int(s) for s in args.ids.split(",")}
    if args.only:
        name_to_id = {v: k for k, v in SEQ_NAMES_BY_ID.items()}
        if args.only not in name_to_id:
            raise SystemExit(f"unknown SEQ name {args.only!r}; known: {sorted(name_to_id)}")
        wanted_ids = {name_to_id[args.only]}

    written = 0
    for e in seqs:
        if wanted_ids is not None and e.id not in wanted_ids:
            continue
        name = SEQ_NAMES_BY_ID.get(e.id, e.name.lower() or f"seq-{e.id}")
        parsed = parse_seq(e.data)
        manifest = seq_parsed_to_manifest(name, parsed, args.angle_stride)
        path = out_dir / f"{name}.json"
        path.write_text(json.dumps(manifest, indent=2))
        print(f"  wrote {path.name} ({parsed['nFrames']} frames, baseTile={manifest['baseTile']})")
        written += 1
    print(f"wrote {written} SEQ manifests → {out_dir}")


def seq_parsed_to_manifest(name: str, parsed: dict, angle_stride: int) -> dict:
    """Convert raw parsed SEQ dict → schema-matching manifest.

    Schema (per spec):
      {
        "name": str,
        "kind": "seq",
        "loop": bool,
        "baseTile": int,
        "angleStride": int,
        "frames": [
          {"tileOffset": int, "durMs": int},
          ...
        ]
      }
    """
    tiles = [f["tile"] for f in parsed["frames"]]
    base_tile = min(tiles) if tiles else 0
    ticks = parsed["ticksPerFrame"]
    dur_ms = round(ticks * 1000 / 120)
    # If angle_stride > 1, frames in a multi-rotation SEQ show offsets
    # like 0, 5, 10, 15, ... — i.e., increments of angle_stride.
    # tileOffset = (frame.tile - base_tile) // angle_stride so that
    # runtime reconstructs baseTile + tileOffset*angleStride + v.
    # For angle_stride == 1, tileOffset = frame.tile - base_tile literally.
    loop = True  # hand-correct per animation after extraction
    frames = []
    for f in parsed["frames"]:
        raw_offset = f["tile"] - base_tile
        tile_offset = raw_offset // angle_stride if angle_stride > 1 else raw_offset
        frames.append({"tileOffset": tile_offset, "durMs": dur_ms})
    return {
        "name": name, "kind": "seq", "loop": loop,
        "baseTile": base_tile, "angleStride": angle_stride,
        "frames": frames,
    }


if __name__ == "__main__":
    main()
