#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26"]
# ///
"""Validate a neural-upscale capture v2 dataset against docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §1.

Usage: uv run scripts/upscale-dataset-check.py ~/blud-upscale-data/<name>
"""
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np


def main(root: str) -> int:
    base = Path(root).expanduser()
    manifest = json.loads((base / "manifest.json").read_text())
    problems: list[str] = []
    if manifest.get("format") != "blud-upscale-dataset/2":
        problems.append(f"format {manifest.get('format')}")
    classes: Counter = Counter()
    splits: Counter = Counter()
    for p in manifest["pairs"]:
        pid, c = p["id"], p["crop"]
        h, w = c["h"], c["w"]
        a = np.load(base / p["files"]["in"])
        t = np.load(base / p["files"]["target"])
        cov = np.load(base / p["files"]["targetCoverage"])
        if a.shape != (h, w, 4) or a.dtype != np.float32:
            problems.append(f"{pid}: in {a.shape} {a.dtype}")
        if t.shape != (2 * h, 2 * w, 4) or t.dtype != np.float32:
            problems.append(f"{pid}: target {t.shape} {t.dtype}")
        if cov.shape != (2 * h, 2 * w, 1):
            problems.append(f"{pid}: coverage {cov.shape}")
        for name, arr in (("in", a), ("target", t), ("coverage", cov)):
            if not np.isfinite(arr).all():
                problems.append(f"{pid}: non-finite values in {name}")
        if t.shape[:2] == cov.shape[:2] and not np.array_equal(t[..., 3] < 1, cov[..., 0] >= 0.5):
            problems.append(f"{pid}: target alpha disagrees with coverage >= 0.5")
        if (p["split"] == "val") != (p["files"]["native"] is not None):
            problems.append(f"{pid}: native file present={p['files']['native'] is not None} for split {p['split']}")
        if p["files"]["native"]:
            n = np.load(base / p["files"]["native"])
            if n.shape != (2 * h, 2 * w, 4):
                problems.append(f"{pid}: native {n.shape}")
        for r in p["regions"]["heads"] + p["regions"]["wounds"]:
            if not (-r["r"] <= r["x"] <= 2 * w + r["r"] and -r["r"] <= r["y"] <= 2 * h + r["r"]):
                problems.append(f"{pid}: region outside its crop {r}")
        classes[p["class"]] += 1
        splits[p["split"]] += 1
    showcase = sum(1 for p in manifest["pairs"] if p["showcase"])
    heads = sum(1 for p in manifest["pairs"] if p["regions"]["heads"])
    wounds = sum(1 for p in manifest["pairs"] if p["regions"]["wounds"])
    print(f"pairs {len(manifest['pairs'])}  classes {dict(classes)}  splits {dict(splits)}  showcase {showcase}  with-head {heads}  with-wound {wounds}")
    print(f"stats {manifest.get('stats')}")
    for q in problems[:20]:
        print("PROBLEM", q)
    print("OK" if not problems else f"FAIL ({len(problems)} problems)")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
