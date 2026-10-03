# Cut wounds M1: measurement notes

Plan: `docs/superpowers/plans/` (cut wounds M1). Spec: `docs/superpowers/specs/2026-10-03-cut-wounds-design.md`.
Base for every "before" number: `a66c1c4a` (Task 1 merged). Machine: the owner's Mac, headless Chrome 154,
fresh profile per boot. Its timers are noisy, so each number comes with its spread.

## Task 2: wound limit 16 -> 32 (2026-10-03)

`MAX_WOUNDS = 32` (`damage.ts`). Every WGSL wound loop bound, the per-ray list's `min(count, N)` clamp and
`gWoundList: array<i32, N>` are now `${MAX_WOUNDS}` (`fields/wounds.wgsl.ts` applyWounds and woundMask,
`fields/tissue.wgsl.ts` charMask, `fields/groups.wgsl.ts`, `body/blocks/setup/wound-list.wgsl.ts`,
`normal-gradient.wgsl.ts` ngWounds), so the shader and the CPU ring cannot disagree again.

**Not verified yet:** wounds 17 to 32 have not been checked on the GPU, and the frame cost of a full
32-wound ring has not been measured. Task 8's gate covers both. Every capture below stages fewer than 16
wounds.

What else depends on the cap:

- **Blasts.** `explosion-aoe.ts` `BLAST_WOUNDS_PER_BODY = 16` (was `MAX_WOUNDS`). A blast's stamping and
  sever results are unchanged, but older wounds now survive it, so a blasted body can carry up to 32 live
  wounds.
- **The frozen GLSL twin.** `/sdf-lab.html` (`march.glsl.ts`, `zombie.ts`) keeps its own
  `GLSL_MAX_WOUNDS = 16`. Its `setWounds` now uploads the NEWEST 16 of the longer ring. It used to upload
  the first 16, so every shot after the 16th was invisible.
- **The normal-gradient probe.** `webgpu/normal-gradient-probe.ts`'s fixture texture is now `MAX_WOUNDS`
  wide. Separately, and NOT fixed here: its `ngWoundProbe` calls `applyWounds` with 7 arguments, but
  `applyWounds` takes 8 (`band`), so that GPU probe would fail to compile today.

### Cold-boot `drawOnce` (`scripts/boot-time.mjs`, the gate)

| run set | drawOnce ms | warmMs |
| --- | --- | --- |
| base, 5 runs | 1627.3, 1644.9, 1632.3, 1631.5, 1630.6 (median 1631.5, spread 17.6) | 2907, 2448, 2396, 2396, 2428 |
| 32, 5 runs straight after | 1633.0, 1669.6, 1691.8, 1696.8, 1731.3 (median 1691.8) | 2398-2568 |
| interleaved, MAX_WOUNDS 16 | 1637.3, 1748.9, 1712.0, 1750.8, 1750.3 (median 1748.9) | 2425-2632 |
| interleaved, MAX_WOUNDS 32 | 1639.3, 1709.0, 1683.8, 1711.8, 1735.4 (median 1709.0) | 2399-2536 |

The straight-after set climbs run by run (load average was around 10 at the time). The interleaved pairs
(16 then 32, five times, same minutes) show the climb is machine-wide: 32 is no slower than 16 in any
pair but the first, where they tie. The interleaved 16 build compiles the same WGSL as the base (the loop
bounds interpolate back to `16`; only stripped comments differ). **Acceptance (within the base spread +
10%, about 1810 ms against the base max of 1645): met.** The 24 fallback was not needed.

### Compile census (`scripts/compile-census.mjs 3`)

All boots `phase=ready`, no uncaptured GPU errors, no device loss.

| build | warmMs | drawOnce | march-family module | median march compile ms |
| --- | --- | --- | --- | --- |
| base | 2448 / 2392 / 2403 | 1673.6 / 1623.2 / 1619.0 | 295616 B (+ gib 293881 B, crowd 295184 B) | 39.2 / 39.2 / 39.8 |
| 32 | 38105 / 2474 / 2480 | 1603.3 / 1680.2 / 1693.8 | 295624 B | 39.8 / 40.5 / 39.8 |

Two traps here.

- **The OS Metal shader cache outlives the fresh Chrome profile.** The base text was already in it, so
  the base boots were warm. The first 32 boot paid the real compile (asyncFirst 36.2 s, two march
  pipelines about 18 s each); later boots hit the cache.
- **Missing gib and crowd entries.** The 32 census shows 9 march-family entries per boot, not 13: the gib
  and crowd march variants compile in the background after the loader, and the census snapshots at
  `ready`. The base had them cached, so they landed by frame 11. A 40 s probe of the 32 build showed the
  gib variant (293889 B) landing about 11 s in and the crowd job still compiling at 40 s, with no console
  or GPU errors. Once compiled, the crowd job is `ready` (march-hash waits for it and hashed the crowd
  path).

**A like-for-like true-cold comparison.** I nudged `hash13`'s `0.1031` constant (the 2026-09-19 cold-cache
method; a comment is stripped and does not miss the cache) to a unique value per boot, interleaved, and
reverted it afterwards (`math.wgsl.ts` is unchanged in the commit):

| build | nonce | warmMs | asyncFirst | drawOnce |
| --- | --- | --- | --- | --- |
| 32 | 0.103171 | 38352 | 36177 | 1611.9 |
| 16 | 0.103172 | 38844 | 36711 | 1603.6 |
| 32 | 0.103173 | 37414 | 35299 | 1586.3 |
| 16 | 0.103174 | 37331 | 35207 | 1609.3 |

At 32, a truly cold compile costs the same as at 16.

### march-hash (`scripts/march-hash.mjs`)

Base: default `d7392d52…`, wounded `76bd51aa…`. At 32: default `d7392d52…` on 2/2 boots, crowd quad
`0c71e712…` and per-body `470ff0b3…` on 1/1 each, and the wounded variants unchanged. No pin moved. The
header records the re-verification.

## Task 5: the cut in WGSL (carve, mask, normals) (2026-10-03)

Base for this section: `1b6ccf5e` (Tasks 1 to 4). What changed:

- `fields/wounds.wgsl.ts` applyWounds: a cut branch (flag 32) right after the cap load and before the preset branch.
  It reads `ROW_WOUND_CUT` only inside the branch and always `continue`s, so a cut never reaches the crater rim
  code, which reads `META.w` as an offset scale (for a cut, `META.w` is the sag). The carve is `cutCarve`
  (`cut-wound.ts`) term for term: `cs = max(-dIn, dot(rel, in) - sag)`, `dEff = min(depth, 1.4 halfLen)`,
  `depthT = max(dEff prof, max(kerf, 1e-4))`, `kerfT = kerf (1 + jag) (0.35 + 0.65 prof)`, the same vWall and the
  same `min(...) * carveK`. A text test pins each term. The GPU adds three things the CPU mirror does not have:
  - The frame is re-orthogonalised (inward normalised, along made orthogonal to it). Guarded divides are used
    rather than `normalize`, so a degenerate row cannot produce a NaN.
  - The jag noise is sampled in the slot's own frame (along, side, inward), so it moves with the wound. The
    plan's snippet sampled world-space `rel`, which would make the jag swim as the body turns.
  - The lips. Their amplitude per point (`kerf * lipHeight * META.z * prof`) is added to `gWoundAmp` for the
    re-fold pre-scan, as a crater's amp is.
- woundMask: a cut footprint, a band of `kerf..kerf * maskWidth` either side of the segment that fades over
  0.85 to 1.15 half-lengths. It uses the same frame, feeds `m`, the cavity mask (flag 1) and the tear and wet-only
  masks (flags 8 and 16, the same as the radial path), and skips the radial disc.
- `normal-gradient.wgsl.ts` ngWounds: a flag-32 row returns to calcNormal's finite-difference taps (`gNgReason = 1`),
  as a torn row does. The return comes before the META load.

**The jag's slope.** The CPU Lipschitz test runs with jag = 0. I ran a scratch measurement, not committed: a JS
port of `hash13`/`noise3` fed into `cutCarve`'s jag argument, on flat skin, 0.7 mm grid, the same halfLen,
depth and kerf sweep. It gave a max |grad| of **2.032** (worst at h 0.1, depth 0.15, kerf 0.006, which is the
floor term, not the jagged wall). That is within the 2.2 bound. The JS hash runs in f64 while the GPU runs in
f32, so the noise values differ, but its slope statistics are the same.

**The lip was not measured on the CPU.** Its steepness and its look are unchecked until Task 8's gate (photo
plus a luma profile across the cut line). No cut has been rendered on the GPU yet either: no staged scene
carries one. This task proves that the shader compiles and changes no existing pixel. It does not prove the
cut looks right.

**Reach.** The per-wound reach (`w.w * max(2, ...) + 4k + slack`) and the per-ray list use `w.w` = the half-length
for a cut. The deepest carved point is about `dEff + sag` from the midpoint (`dEff <= min(0.15, 1.4 h)`), and
the lip extends to 1.2 h. Both stay inside `2 h + 4k + slack` for any sag up to `0.6 h + 4k`, which covers the
stamp's chord sags. I argued this; I did not test it.

### Compile census (`scripts/compile-census.mjs 2`, after)

Both boots `phase=ready`, `uncapturedCount 0`, no device loss. The march-family module is 299883 B (9 entries per
boot; the gib and crowd variants compile in the background, as in Task 2). Boot 1 was truly cold: warmMs 40784,
asyncFirst 38868, two march pipelines at about 19.2 s each. Boot 2 was warm: warmMs 2456, drawOnce 1655.5, median
march compile 39.9 ms.

### Cold-boot `drawOnce` (`scripts/boot-time.mjs 5241 9241`), truly cold, interleaved

Each boot nudged `hash13`'s `0.1031` to a unique nonce (the Task 2 method; reverted, `math.wgsl.ts` unchanged
in the commit). The base runs swapped in `wounds.wgsl.ts` and `normal-gradient.wgsl.ts` from `1b6ccf5e` between
boots. Load average was 2 to 4.

| build | nonces | drawOnce ms | warmMs |
| --- | --- | --- | --- |
| base `1b6ccf5e` | 0.103191 (before any edit), 93, 95, 97, 99 | 1591.3, 1605.5, 1609.5, 1621.7, 1677.4 (median 1609.5, spread 86.1) | 39536, 39089, 40029, 38981, 41255 (median 39536) |
| + cut branch | 0.103192, 94, 96, 98 | 1627.7, 1612.3, 1627.4, 1640.7 (median 1627.6, spread 28.4) | 41012, 40676, 41032, 40666 (median 40844) |

**drawOnce: met.** The new max (1640.7) is below the base max (1677.4), and both are well under Task 2's +10%
line (about 1810 ms).

**Cold compile cost.** The whole cold warm-up moved by about +1.3 s median (+3.3%) on a 39.5 s compile. In the
interleaved pairs it was +1.9, +0.6, +2.1 and -0.6 s, so the extra compile time is real but small and noisy. It is
the WGSL compile cost of the cut branch, which runs on the warm-up path. drawOnce is not affected.

### march-hash

No pin moved (re-verified, header updated). Default: `d7392d52…` / wounded `76bd51aa…` on 2/2. Crowd quad:
`0c71e712…` / wounded `bf6836cd…`. Per-body: `470ff0b3…` / wounded `f618070e…`. The crowd and per-body wounded
hashes were also taken at the base `1b6ccf5e` and are identical. This was expected: no staged scene carries a
flag-32 wound.
