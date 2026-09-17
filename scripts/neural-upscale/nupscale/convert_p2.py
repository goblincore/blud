"""Convert a P2 pair capture (full frames, single-ray targets) to dataset v2 for the pre-flight.

Usage: python -m nupscale.convert_p2 /tmp/blud-upscale-data/smoke-2026-09-11-r4 /tmp/blud-upscale-data/preflight-v2
The last sequence becomes validation. P2 has no head/wound annotations, so regions are empty.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .constants import DATASET_FORMAT

CROP_PAD = 8


def flesh_box(alpha: np.ndarray) -> tuple[int, int, int, int] | None:
    """(x0, y0, x1, y1), end-exclusive, of alpha < 1; None when there is no flesh."""
    ys, xs = np.nonzero(alpha < 1)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def pair_crop(inp: np.ndarray, target: np.ndarray, pad: int = CROP_PAD) -> tuple[int, int, int, int] | None:
    """Contracts §1 crop rule in input px: (x, y, w, h), or None when neither image has flesh."""
    h, w = inp.shape[:2]
    boxes = []
    a = flesh_box(inp[..., 3])
    if a:
        boxes.append(a)
    b = flesh_box(target[..., 3])
    if b:
        boxes.append((b[0] // 2, b[1] // 2, -(-b[2] // 2), -(-b[3] // 2)))
    if not boxes:
        return None
    x0 = max(min(bx[0] for bx in boxes) - pad, 0)
    y0 = max(min(bx[1] for bx in boxes) - pad, 0)
    x1 = min(max(bx[2] for bx in boxes) + pad, w)
    y1 = min(max(bx[3] for bx in boxes) + pad, h)
    return x0, y0, x1 - x0, y1 - y0


def distance_class(distance: float) -> str:
    return "close" if distance < 1.5 else "medium" if distance < 3.5 else "far"


def _save(path: Path, array: np.ndarray) -> int:
    np.save(path, np.ascontiguousarray(array, dtype="<f4"))
    return path.stat().st_size


def convert_p2(src: Path | str, dst: Path | str, *, showcase: int = 12) -> dict:
    src, dst = Path(src), Path(dst)
    manifest = json.loads((src / "manifest.json").read_text())
    if "frames" not in manifest:
        raise ValueError(f"{src}: not a P2 capture manifest (no 'frames')")
    if dst.exists() and any(dst.iterdir()):
        raise FileExistsError(f"{dst} exists and is not empty")
    (dst / "pairs").mkdir(parents=True, exist_ok=True)
    val_seq = max(int(f["seq"]) for f in manifest["frames"])
    pairs, sequences, skipped = [], {}, 0
    for fr in manifest["frames"]:
        inp = np.load(src / fr["input"])
        tgt = np.load(src / fr["target"])
        crop = pair_crop(inp, tgt)
        if crop is None:
            skipped += 1
            continue
        x, y, w, h = crop
        seq, frame = int(fr["seq"]), int(fr["frame"])
        pid = f"s{seq:04d}-f{frame:03d}"
        split = "val" if seq == val_seq else "train"
        cls = distance_class(float(fr["dist"]))
        d = dst / "pairs" / pid
        d.mkdir(parents=True)
        t = tgt[2 * y:2 * (y + h), 2 * x:2 * (x + w)]
        size = _save(d / "in.npy", inp[y:y + h, x:x + w])
        size += _save(d / "target.npy", t)
        size += _save(d / "target-coverage.npy", (t[..., 3:4] < 1).astype(np.float32))
        pairs.append({
            "id": pid, "seq": seq, "frame": frame, "split": split, "showcase": False,
            "class": cls, "lookAt": "torso", "character": f"p2-body-{fr.get('body')}", "room": fr.get("room"),
            "distance": fr["dist"], "orbitDeg": None, "wounds": 0,
            "crop": {"x": x, "y": y, "w": w, "h": h},
            "files": {"in": f"pairs/{pid}/in.npy", "target": f"pairs/{pid}/target.npy",
                      "targetCoverage": f"pairs/{pid}/target-coverage.npy", "native": None},
            "regions": {"heads": [], "wounds": []},
            "inputCoverage": fr.get("inputCoverage"), "iouPrev": None, "bytes": size, "p2": fr,
        })
        sequences.setdefault(seq, {"id": seq, "split": split, "captured": 0, "class": cls, "room": fr.get("room")})
        sequences[seq]["captured"] += 1
    for e in [p for p in pairs if p["split"] == "val"][:showcase]:
        e["showcase"] = True
    out = {
        "format": DATASET_FORMAT,
        "created": datetime.now(timezone.utc).isoformat(),
        "checkout": manifest.get("checkout"),
        "convertedFrom": str(src),
        "note": "P2 single-ray targets (not supersampled), no regions: pre-flight only",
        "near": manifest["near"],
        "far": manifest["far"],
        "input": manifest.get("input"),
        "target": {**(manifest.get("target") or {}), "samples": 1},
        "rowOrder": "row 0 = top",
        "checks": manifest.get("checks", {}),
        "stats": {"skippedEmpty": skipped},
        "sequences": list(sequences.values()),
        "pairs": pairs,
    }
    (dst / "pairs.jsonl").write_text("".join(json.dumps(p) + "\n" for p in pairs))
    (dst / "sequences.jsonl").write_text("".join(json.dumps(s) + "\n" for s in sequences.values()))
    (dst / "manifest.json").write_text(json.dumps(out, indent=1))
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Convert a P2 pair capture to dataset v2 (pre-flight only).")
    ap.add_argument("src")
    ap.add_argument("dst")
    args = ap.parse_args(argv)
    m = convert_p2(args.src, args.dst)
    splits = [p["split"] for p in m["pairs"]]
    print(f"OK {len(m['pairs'])} pairs ({splits.count('train')} train, {splits.count('val')} val), "
          f"skipped {m['stats']['skippedEmpty']} empty -> {args.dst}")


if __name__ == "__main__":
    main()
