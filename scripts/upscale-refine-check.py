#!/usr/bin/env python3
"""Run-5 capture gate (spec docs/superpowers/specs/2026-09-13-neural-upscale-run5-sdf-refine-design.md §5).
For every pair carrying refine files: the overlap of accepted refine pixels (refine_c.w < 1) with the
target flesh mask, and the mean |refine_c.rgb - target.rgb| over accepted-and-flesh pixels against the mean
|nearest-up in.rgb - target.rgb| over the same pixels (the region the head residual acts on). PASS iff dataset-mean overlap >= 0.95 AND
closeness_refine < closeness_input. A pair with only one of the two refine files is an error (a
half-written capture must fail loudly, never read as "no refine").
Usage: uv run --with numpy python3 scripts/upscale-refine-check.py <dataset dir>"""
import json, sys
from pathlib import Path
import numpy as np

def main() -> int:
    if len(sys.argv) != 2: print(__doc__); return 2
    root = Path(sys.argv[1])
    m = json.load(open(root / "manifest.json"))
    pairs = m["pairs"]
    half = [p["id"] for p in pairs if bool(p["files"].get("refineN")) != bool(p["files"].get("refineC"))]
    if half: print(f"REFINE CHECK: FAIL — pairs with only one refine file: {half[:5]}{'...' if len(half) > 5 else ''}"); return 1
    pairs = [p for p in pairs if p["files"].get("refineC")]
    if not pairs: print("REFINE CHECK: FAIL — no pairs with refine files"); return 1
    ov = cr = ci = 0.0; n = 0; empty = 0
    for p in pairs:
        f = p["files"]
        inp = np.load(root / f["in"]); tgt = np.load(root / f["target"]); rc = np.load(root / f["refineC"])
        if rc.shape != tgt.shape: print(f"REFINE CHECK: FAIL — {p['id']}: refine_c {rc.shape} vs target {tgt.shape}"); return 1
        acc = rc[..., 3] < 1.0; flesh = tgt[..., 3] < 1.0
        if not acc.any(): empty += 1; continue
        up = inp.repeat(2, axis=0).repeat(2, axis=1)
        ov += float((acc & flesh).sum() / acc.sum())
        # Closeness is measured where the head can act: accepted AND inside the target's flesh. The
        # head residual is multiplied by `covered`, so rim pixels the refine accepts beyond the target
        # silhouette never reach the loss; they are the OVERLAP criterion's business (a halo), not this one.
        region = acc & flesh
        if not region.any(): empty += 1; continue
        cr += float(np.abs(rc[..., :3] - tgt[..., :3])[region].mean())
        ci += float(np.abs(up[..., :3] - tgt[..., :3])[region].mean())
        n += 1
    if n == 0: print("REFINE CHECK: FAIL — every pair has zero accepted pixels"); return 1
    ov, cr, ci = ov / n, cr / n, ci / n
    print(json.dumps({"pairs": n, "emptyPairs": empty, "overlap": round(ov, 4), "closeness_refine": round(cr, 5), "closeness_input": round(ci, 5)}))
    ok = ov >= 0.95 and cr < ci
    print("REFINE CHECK:", "PASS" if ok else "FAIL")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
