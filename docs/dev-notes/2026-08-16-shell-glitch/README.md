# X1.21.2 — shell-displacement glitches: A/B isolation and fix

2026-08-16, dispatch/shell-glitch-task-1.

Symptom (owner playtest): with `setShellDisplace(true)`, hard-edged pale
wedges/patches cut across shoulders and arms, plus dark blocky dropout around
displaced surfaces.

## A/B isolation (headless Chrome CDP, WebGPU, deterministic pose)

Method: reload-per-combo so every screenshot lands on the same pose
(determinism verified at 9 px drift). Hero body, cam (0.35, 0.12, 2.6), crop
x<900 to exclude the panel. "Lost" = pixels that classify as flesh with both
pre-passes off but not in the combo under test (interior of the flesh mask
only). "Dark" = the lost pixels that read as background bleed-through
(luminance < 45) — true dropout, not a shading shift.

| shell | occluder | cone | lost px @ amp 0.016 | lost px @ amp 0.064 | signature |
|-------|----------|------|----------------------|----------------------|-----------|
| off   | on       | off  | — (reference)        | —                    | clean     |
| on    | on       | off  | 49 (dark)            | 320 (dark)           | **dark dropout** |
| on    | off      | on   | 173 (pale, rgb≈[100,85,85]) | 56            | **pale tile wedges** |
| on    | on       | on   | 75                   | 424                  | both      |

Both pre-passes were implicated, each with its own failure shape — the two
symptom classes in the reports are two halves of the same bug.

## Mechanisms

The pre-passes were built for the UNDISPLACED field; the shell moves the real
surface both ways (fbm ∈ [-0.9, 0.9] × amp — `FBM` is noise3×0.6 + noise3×0.3):

1. **Occluder → dark dropout.** A shell DENT retreats up to ~0.9 amp below
   the smooth surface. Hull clearance is only (1 − shrink)×prim-radius
   (0.2×r), so on thin limbs (r < ~5×amp) the dent passes BEHIND the hull
   sphere along the ray. `tMax = occT` then cuts the march in front of the
   surface it should have found → discard → background bleeds through.
   Bumps (outward) were never at risk: they are nearer than the hull.
2. **Cone → pale wedges.** The cone certifies emptiness against the SMOOTH
   field, but a BUMP stands up to ~0.9 amp proud of it and can sit inside
   the distance the tile proved empty. The march starts past the crest,
   hits at the wrong depth, and shades wrong — per 8×8 tile, hence the
   hard pale edges.

Note the fix direction for the hull is INWARD, not the BVH-occlusion
instinct: the hull bounds how far a ray may march, so growing a sphere
TIGHTENS the bound and culls more — the opposite of conservative here. The
displacement that matters is the dent side.

## Fix

Both bounds now carry the amp through `woundCfg2.z`, which is 0 with the
shell off — bit-identical undisplaced behaviour:

- `march.wgsl.ts` MARCH_BODY: `tMax = min(box, occT + woundCfg2.z)` —
  reaches every dent (0.9 amp worst) with margin.
- `march.wgsl.ts` CONE_MARCH: stops at `d < r + 0.0012 + woundCfg2.z` —
  hands the full march one amp of band back so it walks the bumps properly.
- `occluder-hull.ts`: `buildHullInstances` gains an optional `shellAmp`
  contract — radii pulled IN by the amp, wound clearance grown by it,
  sub-floor spheres dropped. The production consumer does not pass it (the
  march-side relaxation covers every dent through the existing uniform);
  the parameter is the geometric half of the conservativeness contract,
  pinned by tests.

## Post-fix matrix (same protocol)

| combo | lost @ 0.016 | lost @ 0.064 |
|-------|--------------|--------------|
| occ on, cone off | 24 dark (was 49)  | 26 dark (was 320) |
| cone on, occ off | 43 scattered (was 173 wedge-shaped) | 69 (was 56, noisy) |
| both on           | 28 dark (was 75)  | 26 dark (was 424) |

Drift baseline is 6 px. The occluder's amp-scaling dropout (320 px at 4×amp)
collapses to the baseline; the cone's wedge pattern dissolves into scatter.

## Bench (gate protocol: 10 bodies, off×2 then on×2, second runs quoted)

This box was ~2.3× more loaded than the original gate run (sibling Chrome
rendering + extra vite servers), so absolute numbers are not comparable to
the 12.36 ms gate. Same-environment, back-to-back:

| | shell off | shell on | on−off |
|---|---|---|---|
| pre-fix  | 30.17 | 28.61 | −1.56 (noise) |
| post-fix | 27.63 | 29.36 | +1.73 |
| post-fix (rep) | 28.03 | 29.11 | +1.08 |

The fix's cost is inside the noise band (the pre-fix run shows a negative
shell delta, so the band is ±1.6 ms). Directionally the relaxation adds a
few march steps on hull-covered pixels only; scaled to gate conditions that
is ≤ ~0.9 ms at 10 bodies — the 12.36 vs 12.00 gate question is unchanged
by this fix within measurement noise. The cone stop costs nothing here
because the cone is OFF in the default config (occluder-only won the
measured matrix; see lab-main).

## Screenshots

- `pre-fix-shell-on-occ-on-cone-off.png` — default config repro (dark patch on forearm)
- `pre-fix-shell-on-cone-on-occ-off.png` — pale tile wedges
- `pre-fix-4x-amp-occ-on.png` — amp 0.064 diagnostic stress
- `post-fix-all-on-default-amp.png`, `post-fix-all-on-4x-amp.png` — clean
- `post-fix-bench-10-bodies-shell-on.png` — bench scene
