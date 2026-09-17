#!/usr/bin/env python3
"""Load an upscale pair dataset and assert it matches its manifest (spec 2026-09-11, gate G2).

Usage: uv run --with numpy python3 scripts/upscale-pairs-load.py .upscale-data/<run>
"""
import json
import sys
from pathlib import Path

import numpy as np


def main(root: str) -> None:
    base = Path(root)
    manifest = json.loads((base / "manifest.json").read_text())
    iw, ih = manifest["input"]["w"], manifest["input"]["h"]
    tw, th = manifest["target"]["w"], manifest["target"]["h"]
    count = 0
    for fr in manifest["frames"]:
        a = np.load(base / fr["input"])
        b = np.load(base / fr["target"])
        assert a.dtype == np.float32 and a.shape == (ih, iw, 4), (fr["input"], a.dtype, a.shape)
        assert b.dtype == np.float32 and b.shape == (th, tw, 4), (fr["target"], b.dtype, b.shape)
        assert np.isfinite(a).all() and np.isfinite(b).all(), fr
        ca = float((a[..., 3] < 1).mean())
        cb = float((b[..., 3] < 1).mean())
        assert abs(ca - cb) < 0.02, (fr["input"], ca, cb)
        count += 1
    assert count == len(manifest["frames"]) and count > 0
    print(f"OK {count} pairs, input {iw}x{ih}, target {tw}x{th}, near {manifest['near']}, far {manifest['far']}")


if __name__ == "__main__":
    main(sys.argv[1])
