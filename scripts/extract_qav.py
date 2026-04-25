#!/usr/bin/env python3
"""Extract QAV animations from BLOOD.RFF into JSON manifests.

Usage: python -m scripts.extract_qav <blood.rff> --out <dir> [--ids 5,6,7]
       python -m scripts.extract_qav <blood.rff> --out <dir> --only dynamite-idle

QAV IDs for dynamite (verified by reading NotBlood weapon.cpp + parsing BLOOD.RFF
QAV binaries — see docs/dev-notes/2026-04-22-notblood-source-reference.md):
  5  = BUNUP / lighter ignite (spray-can standalone — NOT used for TNT flow)
  7  = dynamite lower variant (BUNDOWN2, fuse extinguishes)
  16 = TNT raise from spray can (BUNUP — short, fuse already lit)
  18 = TNT raise normal (BUNUP2 — raise + flick + ignite + bundle reveal, 10 frames)
  19 = TNT lower (BUNDOWN, fuse stays lit)
  20 = TNT idle holding loop (BUNIDLE — short 6-frame calm loop)
  21 = TNT fuse-burn cooking (BUNFUSE — 66 frames, sparks near end, callbackId=2 at frame 65 for self-explode)
  22 = TNT drop bundle (BUNDROP)
  23 = TNT throw (BUNTHRO)
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

from scripts.rff_reader import read_rff, iter_by_ext
from scripts.qav_parser import parse_qav


# Dynamite QAV IDs (from NotBlood weapon.cpp processTNT + WeaponRaise/WeaponLower)
QAV_NAMES_BY_ID: dict[int, str] = {
    5:  "dynamite-lighter-ignite",
    7:  "dynamite-lighter-lower",
    16: "dynamite-raise-from-spray",
    18: "dynamite-raise",
    19: "dynamite-lower",
    20: "dynamite-idle",
    21: "dynamite-fuse-burn",
    22: "dynamite-drop",
    23: "dynamite-throw",
    # Flare pistol QAVs — single-pistol mode (no kPwUpTwoGuns powerup)
    # source: NotBlood weapon.cpp WeaponRaise(41) / WeaponLower(44) / processFire(43) / weaponQav idle(42)
    41: "flare-raise",
    42: "flare-idle",
    43: "flare-fire",
    44: "flare-lower",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("rff", help="Path to BLOOD.RFF")
    ap.add_argument("--out", required=True, help="Output directory")
    ap.add_argument("--ids", help="Comma-separated list of QAV IDs to extract")
    ap.add_argument("--only", help="Extract single QAV by name (from QAV_NAMES_BY_ID)")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    entries = read_rff(Path(args.rff))
    qavs = list(iter_by_ext(entries, "QAV"))

    wanted_ids: set[int] | None = None
    if args.ids:
        wanted_ids = {int(s) for s in args.ids.split(",")}
    if args.only:
        name_to_id = {v: k for k, v in QAV_NAMES_BY_ID.items()}
        if args.only not in name_to_id:
            raise SystemExit(f"unknown QAV name {args.only!r}; known: {sorted(name_to_id)}")
        wanted_ids = {name_to_id[args.only]}

    written = 0
    for e in qavs:
        if wanted_ids is not None and e.id not in wanted_ids:
            continue
        name = QAV_NAMES_BY_ID.get(e.id, e.name.lower() or f"qav-{e.id}")
        parsed = parse_qav(e.data)
        manifest = qav_parsed_to_manifest(name, parsed)
        path = out_dir / f"{name}.json"
        path.write_text(json.dumps(manifest, indent=2))
        print(f"  wrote {path.name} ({parsed['nFrames']} frames)")
        written += 1
    print(f"wrote {written} QAV manifests → {out_dir}")


def qav_parsed_to_manifest(name: str, parsed: dict) -> dict:
    """Convert raw parsed QAV dict → schema-matching manifest.

    Schema (per spec):
      {
        "name": str,
        "kind": "qav",
        "loop": bool,
        "nFrames": int,
        "frames": [
          {
            "durMs": int,
            "layers": [{"tile": int, "ox": int, "oy": int, "scale": float}, ...]
          }
        ]
      }
    """
    # Blood ticks are 1/120 s. ticksPerFrame from header → durMs.
    ticks_per_frame = parsed["ticksPerFrame"]
    dur_ms = round(ticks_per_frame * 1000 / 120)
    # QAV loop flag: conservative default is loop=True; hand-edit per
    # animation after extraction.
    loop = True
    frames = []
    for f in parsed["frames"]:
        layers = []
        for t in f["tiles"]:
            # Skip null layers: picnum=0 with all-zero offsets and default scale.
            # Blood's QAV format uses either picnum=-1 or picnum=0 for unused
            # tile slots in the fixed 8-element array.
            if (t["picnum"] == 0 and t["x"] == 0 and t["y"] == 0
                    and t["z"] == 0 and t.get("stat", 0) == 0):
                continue
            # stat bit 4 (0x10) = x-flip (mirror horizontally)
            flip_x = bool(t.get("stat", 0) & 0x10)
            layers.append({
                "tile": t["picnum"],
                "ox": t["x"],
                "oy": t["y"],
                "scale": t["z"] / 65536.0 if t["z"] else 1.0,
                "flipX": flip_x,
            })
        frames.append({"durMs": dur_ms, "layers": layers})
    return {
        "name": name, "kind": "qav", "loop": loop,
        "nFrames": parsed["nFrames"], "frames": frames,
    }


if __name__ == "__main__":
    main()
