# Shared post-hit probes (perf plan task 3) — measured and REJECTED

`pose5-BEFORE-6probes.png` vs `pose5-AFTER-4probes-FLAT.png`: same pose, same
wounds, cosmetics frozen, only the AO/scatter probe change differs. AFTER is
visibly flatter — the arms merge into the torso and joint shading is gone.

**The change:** fold the AO and scatter probes out of the tetrahedron gradient
`calcNormal` already computes, instead of each doing its own `mapBody`. Post-hit
field evaluations 6 -> 4.

**Why the look breaks.** For a true distance field at a hit point, `d ~ 0` and
`dot(grad, n) ~ |grad| ~ 1`, so the extrapolation
`ao = (d + dot(grad,n)*0.06)/0.06` returns **~1.0 — fully unoccluded — almost
everywhere.** The real probe samples the field 6 cm along the normal, which in a
crease or a joint is less than 0.06 and correctly darkens. So this does not
"linearise away some concavity"; it removes ambient occlusion globally.

Measured over 6 poses, wounded zombie, cosmetics frozen:

| pose | mean flesh luma 6 -> 4 | delta | dark tail p10 |
|---|---|---|---|
| 0 | 137.8 -> 156.1 | +18.3 | 66.6 -> 74.6 |
| 1 | 129.0 -> 143.6 | +14.6 | 50.5 -> 57.4 |
| 2 | 81.0 -> 95.0 | +14.1 | 28.0 -> 29.4 |
| 3 | 85.9 -> 88.7 | +2.8 | 30.7 -> 30.4 |
| 4 | 117.6 -> 126.2 | +8.6 | 44.5 -> 49.2 |
| 5 | 152.6 -> 175.3 | +22.7 | **80.2 -> 112.4** |
| **all** | **117.3 -> 130.8** | **+13.5** | |

The dark tail lifting is the tell: the plan's caveat predicted crater-concavity
lifting only, which would leave creases alone. Creases lifted too.

**And it buys nothing.** Interleaved A/B, min of 2 reps per side, scale 0.7,
12 s, identical host conditions:

| | BEFORE (6) | AFTER (4) |
|---|---|---|
| A p50 | **69.9** | 74.5 |
| A p95 | 170.3 | 169.3 |
| B p50 | 38.7 | 38.9 |
| B p95 | 89.5 | 85.4 |

Scene A slightly worse, scene B slightly better, all inside run-to-run spread.

**The lesson for the rest of the perf plan.** Post-hit probes are 6 evals paid
ONCE per hit pixel; the march loop runs ~6-8 steps per pixel, each folding
dozens of primitives. Post-hit shading is not the bottleneck, so plan task 3's
premise does not hold. Effort belongs on step count and fill — per-tile lists,
LOD, the shell-march direction.

The plan's own fallback (keep the real AO probe, share only scatter, 6 -> 5) was
not measured: it is strictly less of a win than a 6 -> 4 that already measured
as nothing.

**Caveat on the numbers.** Absolute values here are well above the recorded
baselines (A p50 42.8) because the host was still recovering from load; the
interleave is what makes the comparison valid, not the absolute figures. Two
reps, not the protocol's five — the visual gate was disqualifying on its own.
