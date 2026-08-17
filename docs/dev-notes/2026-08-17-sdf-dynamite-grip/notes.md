# X1.27 — baked dynamite grip & underhand release (dispatch chain)

Design: [2026-08-17-sdf-dynamite-grip-release-design.md](../../superpowers/specs/2026-08-17-sdf-dynamite-grip-release-design.md) ·
plan: [2026-08-17-sdf-dynamite-grip-release.md](../../superpowers/plans/2026-08-17-sdf-dynamite-grip-release.md)

## Chain recovery note (honest provenance)

Task B's dispatch run (2026-08-17 17:35:40Z) finished in 21 s with **zero
commits** (agent no-op reported as done/exit 0), so Task C started against a
branch missing the v2 clip asset. Task C's agent detected this and executed
Task B per its plan section inline **before** any Task C work, as a separate
commit with the plan-specified message. All Task B gates were run.

## Task B — bake and validate the six-frame depth atlas

- **Union grid:** dims (131, 178, 102) per frame, voxel ≈ 1.497 / 1.494 /
  1.489 mm (≤ 1.5 mm target), 12 mm margin added once to the union AABB of all
  six posed soups; atlas (131, 178, 612), frame-major along Z, X-fastest
  inside every slab. One common GridSpec for every frame (`clip_grid`).
- **Output:** `public/assets/lab/hand-sdf-dynamite-grip-r.r16f` =
  28 541 232 bytes (**27.22 MiB**, inside the 24–30 MiB expectation, far under
  the 35 MiB stop-gate). Bake wall time ≈ 46 s including the Blender pose
  re-solve.
- **Per-frame validation:** all six slabs pass X1.26 `validate_field` (finite,
  negative core, wholly-positive boundary); inside fraction 9.4% → 9.1% as the
  hand closes. Winding probes pass per frame (bake_field).
- **Manifest:** version 2, `kind: hand-sdf-clip`, frames keyed 0.0–1.0,
  timing close 0.22 s / swing 0.24 s / releaseAt 0.15 s / release 0.12 s,
  `sha256.binary` + `sha256.source` (DavidFischer hand) recorded, `prop`
  contract hash-bound to `dynamite-bundle-grip.glb`
  (`4b900499…d836`). `--validate-only` re-derives everything from checked-in
  bytes alone (no Blender, no source downloads).
- **Midpoint diagnostics:** `clip-midpoints-sheet.png` (five alpha-0.5
  isosurfaces). The plan asks to reject ghosted double digits, lost web
  spaces, or mitten bridges; this dispatch harness cannot view images, so the
  gate ran **numerically** too (`scripts/clip_midpoint_probe.py`, kept as a
  diagnostic): depth-guarded row scan along the thumbward axis —
  **0 ghost rows, 0 mitten rows** across all five adjacent pairs (a ghost is
  one digit splitting into two deep surfaces where both parents hold the same
  digit; a mitten is a web gap open in both parents bridging over in the
  blend). Separation improves through the close: rows with ≥ 4 separate
  digit intervals grow 82 → 400 from open to firm-grip, max intervals/row 4
  → 5 once the thumb locks. The owner re-checks the sheet visually at the
  Task F gate.
- **Blender 5.2 re-entry gotcha (fixed inline):** `--python THIS_FILE -- …`
  passes the FULL argv; scripts must slice at `--` (Task A's idiom, now in
  `bake_hand_sdf_clip.py` too). First run crashed the midpoint render with
  `unrecognized arguments` before the fix.
- **Attribution:** DavidFischer derivative list extended with the clip
  binary/manifest/midpoint sheet; DJMaesen list extended with the manifest's
  embedded prop contract (ATTRIBUTIONS.md).

### Task B verification

```
uv run scripts/test_bake_hand_sdf_clip.py -v   # 25/25 OK (incl. real asset)
uv run scripts/bake_hand_sdf_clip.py           # bake + midpoint sheet
uv run scripts/bake_hand_sdf_clip.py --validate-only
   -> clip v2 frames=6 atlas=[131,178,612] 27.22 MiB: 6 slabs valid, hashes match
uv run scripts/test_bake_hand_sdf.py           # 19/19 OK (v1 helpers untouched)
git diff scripts/bake_hand_sdf.py              # empty (Task A already exported helpers)
```

## Task C — strict v2 loading + adjacent-slab WGSL sampling

(recorded below after implementation)
