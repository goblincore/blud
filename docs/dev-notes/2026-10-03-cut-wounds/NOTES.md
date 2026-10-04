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

**The lip was not measured on the CPU** (superseded by the fix round below: cutLip is now its CPU mirror and the
whole field is in the Lipschitz test). Its look is unchecked until Task 8's gate (photo
plus a luma profile across the cut line). No cut has been rendered on the GPU yet either: no staged scene
carries one. This task proves that the shader compiles and changes no existing pixel. It does not prove the
cut looks right.

**Reach** (corrected in the fix round below; the first version argued sag stays under 0.6 h, which is wrong). The
per-wound reach (`w.w * max(2, 2 rimOffset + 3 rimWidth) + 4k + slack` = 3.56 h + 0.06 + slack at the shipped
uniforms) and the per-ray list use `w.w` = the half-length for a cut. The sag can reach h: a silhouette-to-silhouette
chord lies on the limb's axis plane (the arm fixture: sag 0.05 = h). The deepest carved point is about `sag + dEff`
from the midpoint, at most h + 1.4 h = 2.4 h. The lip reaches about `(lipOffset + 3 lipWidth) kerf` = 5.1 kerf
sideways (77 mm at kerf 0.015), whatever the half-length, so on a short cut it is the `4k` = 0.06 term, not the
3.56 h rim factor, that covers it. Measured with the CPU mirror (cutCarve + cutLip, 1 to 2 mm grid, single wound,
exact slack `max(0, -d)`): the farthest sample the cut changes is 1.97 h (arm silhouette, rod), 2.25 h (arm
silhouette, kerf 0.015; farthest RAISED 2.09 h), 2.19 h (0.2 m cut along the torso), 1.55 h (around the torso) and
4.17 h on a 0.015 half-length, kerf-0.015 cut whose reach is 7.56 h. No changed sample lies outside the reach. (The
review's own JS mirror reported 2.13 h for its worst raised sample; I did not reproduce that exact figure.)

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

## Task 5 fix round (2026-10-03): lip, mask, depth cap, lid, threat masks

Base: `ffe5a3eb`. The review measured, with a JS mirror (torso cut, rod calibre, META.z 0.8, default woundCfg): the
lip bulged the back skin behind a front cut by ~2.35 mm; the mask was 1.0 on that back skin (an infinite slab along
the inward axis); the lip ate the slot (rendered half-width 5.0 against 11.1 mm carve-only, open centre depth 47 of
60 mm); and a slash across a thin limb's silhouette opened its back (the depth was capped by the flesh behind the
anchor, but the floor sits at sag + depth).

What changed, CPU mirror first (`cut-wound.ts`), then the WGSL copies it term for term (text-pinned in
`wounds.wgsl.test.ts`):

- **`cutLip`** = `amp x exp(-lx^2) x rim x offKerf x nearSkin`. `nearSkin = 1 - smoothstep(0, 2 lipW, s)` on the
  slot's depth coordinate keeps the lip at the near skin (the back skin is deep in `s`, though `dIn` is ~0 there).
  `offKerf = smoothstep(kerfT, kerfT + lipW, |u|)` keeps it out of the kerf. The rim gate's band is now the wound's
  scale, `max(peak lip height, lipW)`, constant along the slot. The crater's form (a band of the local height) has
  slope x height = 1.5 whatever the scale: the combined field measured |grad| 2.51 at a 0.015 half-length,
  kerf-0.015 cut (the amp also shrinks toward the tips, which added an along-slot term). Variants tried on a coarse
  grid: band = peak height alone 2.065, band = max(peak, lipW) 1.991 (chosen). The redundant `step(|ca|, h)` is gone
  (prof is 0 past the tips).
- **`cutMask`** = `band x ends x far`, `far = 1 - smoothstep(dEff + kerf, dEff + 2 kerf, plane - sag)`. The WGSL
  loads META for the sag inside the flag-32 branch. The kerf is floored at 1e-4 in both (WGSL leaves
  `smoothstep(e, e, x)` undefined).
- **`stampCut`**: inward first, then the sag, then the flesh probed to `(sag + depth) / thickFrac`;
  `carveDepth = max(kerf, min(depth, thickFrac thick - sag, 1.4 halfLen))`.
- **The lid** (`s + kerf`, the previous agent's addition, kept in cutCarve and the WGSL). Its comment claimed it
  stops the carve slicing a foreign limb in the open channel above a cut. **It does not**: inside any flesh
  `dIn < 0`, so `s >= -dIn > 0` and the lid never binds. A CPU check (a 3 cm ball 15 mm above a chest cut, union
  field as `dIn`) found the carve positive at 92k of the ball's 128k grid points, lid or not. That lid only made the
  carve negative more than one kerf from every skin above the chord. (This round's notes said that kept that empty
  space from being raised "out to the reach". That overstated it: smax raises d only where the carve is within 4 kW
  of d, i.e. within ~2 cm of the skin.) **Superseded in round 2** by a lid on the raw plane, which does close the
  channel.
- **`applyWounds`**: `if (length(wCap.xyz) < 0.5) { continue; }` first in the cut branch.
- **Threat masks** (`wound-threat.ts` `cutThreatWound`, `cutLipAmp`; `zombie-gpu.ts` threatMasks; the sphere was
  tightened in round 2). A cut row is no longer the half-length sphere. It is the shader's reach sphere (the channel above the cut is carved anywhere in
  reach), the slot's box (|along| <= h, |side| <= 1.35 kerf, each widened by (1/carveK - 1) x (group radius +
  margin) because the carve is scaled by carveK), and a slab at `sag + max(dEff, kerf)`. The lip amp is
  `kerf x lipHeight x META.z` (7.2 mm for the rod) rather than `h x rimSplay x META.z` (44 mm at h 0.1).
  `lastWoundThreatIn` now carries `offsetScales` (the sag) and `cuts`. The unit test puts a foreign group in the
  channel 0.15 m above a cut: the crater form misses it, the cut form flags it, and cutCarve is positive inside it.

### Measured (CPU mirror, `cut-wound.test.ts`; rod calibre, META.z 0.8, kW = 0.015 x clamp(kerf / 0.05, 0.1, 1))

| check | before (ffe5a3eb lip / stamp) | after |
| --- | --- | --- |
| lip on the back skin (torso along, around, arm along) | ~2.35 mm (review) | 0.0000 mm max |
| mask on the back skin | 1.0 (review) | 0 |
| slot half-width 1 mm below the pre-wound skin (torso along; carve-only 18.34) | 6.32 mm | 13.48 mm (73.5%) |
| ... one blend width (kW = 3 mm) below (carve-only 13.70) | 5.26 mm | 12.20 mm (89.1%; around 88.6%, arm 89.3%) |
| ... 5 mm below (carve-only 11.26) | 4.70 mm | 11.02 mm (97.9%) |
| open centre depth (carve-only 60.02; around 21.82) | 47.08 mm (around 8.88) | 60.02 mm (around 21.82), 100% |
| lip raise at \|u\| = 1.5 kerf | not measured | 2.92 / 2.96 / 2.95 mm |
| whole-field Lipschitz max | 2.51 (with the first gated lip) | 2.075 (the carve's floor term; bound 2.2) |
| silhouette chord, back-skin samples opened (rod / kerf 0.015) | 1447 / 2293, 835 / 1393 within \|a\| <= 0.7 h | 234 / 784, 0 within \|a\| <= 0.7 h |

The slot-width test measures a fixed depth below the PRE-WOUND skin, found along `inward` at each |u|. The first
version probed 1 mm below the chord plane: off the slot a curved torso's skin falls away below that plane, so the
carve-only scan never met flesh and returned its 30 mm cap (the "46.5%" failure). The criterion is >= 80% one blend
width down. Above that depth the slot's edge IS the smax fillet (carve-only 18.3 mm half-width 1 mm down, against a
10 mm kerf), and the lip, centred at 1.5 kerf, everts that edge by design. So 1 mm down the test asserts only that
the lip never narrows the slot below the kerf (13.5 >= 10 mm). The 73.5% at 1 mm is recorded here, not hidden.

**Silhouette chord: the test's criterion was restated, with numbers.** After the depth cap, sag 0.05, depth 0.03. The
remaining openings are all at the tips: |a| >= 0.904 h (rod), >= 0.747 h (kerf 0.015). They sit at most 20.1 / 32.5 mm
below the chord plane, under the slot's dEff + kW (33 / 34.5 mm). Rod: no sample has the carve itself positive; the
smax blend opens them where the round arm's back rises to within the blend's reach of the kerf floor (depthT >=
kerf). A straight blade 30 mm below the axis plane would sever the arm's sides wherever |a| > 0.8 h, so this is the
blade's geometry, not a leak. No cheap principled fix exists for the tips: the depth cap cannot move the kerf floor,
and the floor is what keeps short slots' slope bounded. The test now asserts: no opening within |a| <= 0.7 h, every
opening shallower than dEff + kW below the chord plane, and sag + depth <= thickFrac x thick. HEAD fails the first
assertion with 835 / 1393.

### Shader checks

- `npx vitest run march-golden -u` (golden updated).
- `node scripts/compile-census.mjs 2`: both boots `phase=ready`, `uncapturedCount 0`, no device loss. March-family
  module 301519 B (was 299883 B), 9 entries per boot (gib and crowd compile in the background, as before). Boot 1
  truly cold: warmMs 40069, asyncFirst 38038, drawOnce 1664.3; boot 2 warm: warmMs 2491, drawOnce 1655.6, median
  march compile 42.6 ms.
- `node scripts/march-hash.mjs` (ports 5241/9241): no pin moved. Default `d7392d52…` / wounded `76bd51aa…` on 2/2
  boots; crowd quad `0c71e712…` / wounded `bf6836cd…`; per-body `470ff0b3…` / wounded `f618070e…`. The same values
  as Task 5: no staged scene carries a flag-32 wound, and the threat-mask change touches cut rows only.

### Cold-boot `drawOnce` (`scripts/boot-time.mjs 5241 9241`), truly cold, interleaved

Base = a separate `git worktree` at `ffe5a3eb`; new = `73289ded`. Each boot nudged `hash13`'s `0.1031` to a unique
nonce in its own tree (0.103211 to 0.103220, base on the odd ones) and restored the file afterwards. Load average 2.8
to 5.2.

| build | drawOnce ms | warmMs |
| --- | --- | --- |
| base `ffe5a3eb` | 1615.2, 1620.0, 1622.6, 1635.7, 1645.0 (median 1622.6, spread 29.8) | 40407, 40338, 40317, 41994, 41857 (median 40407) |
| fix round | 1607.6, 1625.0, 1633.5, 1631.9, 1650.2 (median 1631.9, spread 42.6) | 39936, 40045, 40833, 41795, 42251 (median 40833) |

Per pair, drawOnce moved -7.6, +5.0, +10.9, -3.8 and +5.2 ms, and warmMs -471, -293, +516, -199 and +394 ms. Both are
noise: the extra lip gates and the mask's META load cost nothing measurable. **Acceptance met**: the new max (1650.2)
is within the base spread + 10% of Task 2's result (~1810 ms).

## Task 5 fix round 2 (2026-10-03): normal-gated mask, raw-plane lid, tight threat sphere, null-cap guards

Base `b61beff4`; commit `f2be31cc`.

**C1: the far-skin mask stripe on thin limbs.** `far` fades from dEff + kerf to dEff + 2 kerf below the chord plane,
and stampCut makes sag + dEff = 0.8 thick. So the floor sits 0.2 thick above the back skin, and whenever 0.2 thick is
under 2 kerf the back skin is inside the band.
- The fix: woundMask and `cutMask(p, nrm, ...)` multiply by `cBack = 1 - smoothstep(0.25, 0.6, dot(nrm, inward))`.
  `far` stays as a second guard.
- The slot's walls (dot ~ 0), floor and skin (~ -1) keep the band (tested with analytic normals).

Max back-skin mask (back skin = outward normal z < -0.2, analytic normals), `far` only -> with the gate:

| arm radius | rod | kerf 0.015 |
| --- | --- | --- |
| 0.02 | 1.000 -> 0.146 | 1.000 -> 0.853 |
| 0.03 | 0.762 -> 0 | 1.000 -> 0.146 |
| 0.04 | 0.131 -> 0 | 0.957 -> 0 |
| 0.045 | 0 -> 0 | 0.224 -> 0 |

The "before" column matches the review's probe. What remains at r 0.02 / 0.03 is on the limb's sides,
dot(nrm, inward) 0.26 to 0.5 (15 to 30 degrees past the side). There the 2.2-kerf band is wider than the arm, so the cut
wraps it. The back proper (dot >= 0.6) is 0 for every radius. The test pins both numbers.

**I1: the lid is on the raw plane**, `min(..., dot(rel, inward) + kerf + lidSlack x halfLen)`, lidSlack 0.25, in
cutCarve and the WGSL. It closes the channel above a cut inside a foreign limb, which the round-1 `s`-based lid never did.
- **Owner zero set**, sampled (scratch grid, 21.5M near-surface samples, |d| < 2 cm, smax with vs without the lid):
  - Convex fixtures: 0 sign flips with or without the slack. These are torso along / around at half-length 0.015 to
    0.175, arm along, the arm silhouette and the oblique view, at kerf 0.006 / 0.01 / 0.015.
  - **Concave crease fixtures DO rise above the anchor's tangent plane.** These are an arm blended into the torso's
    side (blendK 0.03), cut over the top, across the front and obliquely into the armpit. No slack: 69882 flips of
    4.4M. 0.25 h: 1863, all on the armpit cut (kerf 0.006 and 0.01). 0.5 h: 0.
  - **I took 0.25 h**, as the review suggested. A larger slack weakens the foreign-limb protection, and a flip can only
    REMOVE carve (the lid lowers the carve): the cut stops short of a wall that rises steeply above the anchor. It
    never opens flesh.
  - The committed test samples a coarser grid (1.28M samples). It asserts 0 flips on the convex fixtures, <= 0.5% on
    the armpit (177 of 50843 at kerf 0.006) and 0 on the other creases. It also asserts the lid only ever lowers the
    field.
- **Foreign ball** (3 cm, its bottom 5 mm above the lid of a 0.1 m chest cut): 5376 of 14013 inside points carved
  without the lid, 0 with it (max carve -0.0049).
- **The wound-threat hand** (0.15 m above a half-length-0.05 cut): carve +0.0068 -> -0.0697. The review's -0.0784
  was without the slack.
- **Lipschitz unchanged**: the lid's gradient is carveK. Whole field 2.075 at lip scale 0.8.

**The threat sphere is the box, not the reach.**
- cutThreatWound adds an outward (lid) face, `kerf + lidSlack h`, to the box's faces. Each face is still widened by
  (1/carveK - 1)(group radius + margin).
- The sphere is now the smaller of two bounds. The first is the exact reach form, reach + carveK x halfWidth: kept,
  because the GPU's reach skip is exact. The second is the box's corner sphere, boxR = |(h, max(floor, outward), hw)| +
  carveK hw, plus sqrt(3)/carveK x (group radius + margin) for the carve falling off slower than distance outside the
  box. The derivation is in the function's comment.
- Rod at half-length 0.1: reach form 0.675 m; box form **0.127 m** + 2.47 x (group radius + margin). Undistorted groups
  are bounded by the box faces, which removes the column in front of every cut. The corner sphere bounds distorted
  groups.
- **No-miss check** (wound-threat.test.ts, the cut-wound fixtures at three kerfs):
  - 278663 positive-carve samples (dIn = the union with a 1 mm group at the sample): every one flagged at margin 0 and
    at 0.125.
  - 795 random groups whose ball holds a sample where s_g(p) < carve(p) + margin: every one flagged.
  - Not covered: distorted groups.

**I2 / I3: null caps.**
- character-view uploads `{ n: [0,0,0], depth: 0 }` for a cut row without a carve normal (it used to send null, which
  leaves the slot's stale CAP row).
- woundMask's cut branch skips a row with no inward axis, as applyWounds' does.
- threatMasks / cutThreatWound give such a row no threat and no lip amp. Tested in character-view and wound-threat.

**M1:** silhouette counts pinned: rod <= 300 opened at >= 0.85 h; kerf 0.015 <= 900 at >= 0.7 h. Measured 234 at
0.904 h and 784 at 0.747 h; the raw-plane lid did not change them.

**M4: the lip scale is clamped** to `CUT_SHADE.maxLipScale` = 1.1 (cutLip, the WGSL `min(wMeta.z, 1.1)`, cutLipAmp).
- Full sweep: 2.075 at lip scales 0.8 to 1.1, and **2.275 at 1.333**: the lip's along-slot slope at the tip of a
  0.015 half-length, kerf-0.015 cut.
- The committed Lipschitz row at the clamp sweeps half-lengths 0.015 and 0.05 only (the full sweep took 225 s):
  1.995. The rod's 0.8 row stays the full sweep (2.075).

### Shader checks

- `npx vitest run march-golden -u` (golden updated).
- `compile-census.mjs 2`: both boots `phase=ready`, `uncapturedCount 0`, no device loss. March module 302047 B
  (was 301519 B), 9 entries per boot. Boot 1 cold: warmMs 42722, drawOnce 1711.2. Boot 2 warm: drawOnce 1923.0, at
  load average ~6; see below.
- `march-hash.mjs` (5241/9241): no pin moved. Default `d7392d52…` / `76bd51aa…` on 2/2 boots; crowd quad
  `0c71e712…` / `bf6836cd…`; per-body `470ff0b3…` / `f618070e…`.

### Cold boot, interleaved, truly cold (hash13 nonces 0.103221 to 0.103238), base `b61beff4` worktree vs `f2be31cc`

| set (load average) | base drawOnce | new drawOnce | base / new warmMs |
| --- | --- | --- | --- |
| 1 (9.5 falling to 3.1) | 1654.1, 1618.2, 1618.1, 1628.7 | 1619.7, **1929.9**, 1625.9, 1595.2 | 42519 41126 43969 42333 / 41157 43064 42096 41687 |
| 2 (3.0 to 2.2) | 1616.2, 1589.0, 1596.2, 1591.7 | 1609.6, 1611.5, 1608.2, 1598.5 | 40355 40316 40274 39886 / 40135 40415 40385 40135 |

All 8 pairs: base median 1617.2 (spread 65.1), new median 1610.6 (spread 30.7 without the 1929.9). On the quiet
set: base 1594.0, new 1608.9 (+15 ms, inside the base set's 27 ms spread). Six more alternating boots afterwards
(the OS cache missed: warmMs ~39 to 41 s): base 1597.6, 1599.3, 1597.9, 1593.6, 1610.2, 1604.8; new 1606.0,
1599.9, 1591.8, 1607.8, 1671.4, 1617.5.

**The 1929.9 outlier.** One new-build boot read 1929.9 at load ~8, and the census's warm boot read 1923.0 at load ~6.
No base boot did (14 boots, max 1654.1 at load 9.5), and no new-build boot did in the 10 boots after the load fell.
I read it as load, but two hits on one side is not proof. **Acceptance:** every boot but that one is under ~1810 ms;
that one is over.

## Task 8: the capture gate (2026-10-04)

`scripts/cut-wound-gate.mjs` (bash, not zsh):

```
export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
node scripts/cut-wound-gate.mjs 5241 9241
```

Bare ring page, frozen zombies, headless Chrome 154.0.8037.93, 1280 x 800, shipped render (march target 400 x 300,
neural upscale to 800 x 600). Photos in [`gate/`](gate/). Runs 7 and 8 (the committed script) at `fb35b370` + this change: **24 checks, 0 failed**,
zero console errors, the same pixel numbers both times. Load average ~2.3.

`actorWounds` (`game-seams-world.ts`) now also returns `shape` ('cut' or 'crater'), `kerf`, `prim` and `limb`.

### Where the gate departs from the plan's snippet, and why

- **Stances face the body's front** (the head frame's forward). The plan's room-centre stance showed one zombie's back
  and another's side: the torso was edge-on and only 2 of G's 4 grid columns hit it.
- **W**: the grid is 0.04 x 0.035 m (plan 0.06 x 0.05), plus a prim check. The torso is three prims (#5, #6, #7: 10 / 15
  / 15 of the 40 hits), and a merge only joins wounds on one prim (`MERGE`), so a lone wound on a prim of its own is
  evicted by design. With the plan's grid from the front, the first hit point (the bottom-left corner) ended 2.5 cm
  outside every wound. That run did not log prims, so I did not establish whether that hit was a lone wound on another
  prim (evicted by design) or something else. With the tighter grid every hit has same-prim partners and all 10 first
  hits stay covered (gaps -0.055 to -0.081 m).
- **G** checks two batches of 8 (wounds 17-24, then 25-32), not one, so the whole ring above 16 is checked on the GPU.
- **K / H**: no hand step between the before and after photos. Two stepped frames sway the view model and its light:
  0.41 / 0.69 mean |dLuma| over a head with nothing else changed (measured). The cut shows on the capture's own locked
  renders: 6.43 mean |dLuma| over the head with no step.
- **The view model stays visible.** Hiding it (`setViewModelVisible(false)`) halves the head's mean luma (72.4 -> 37.6),
  so the light rides with it.
- **Blood is off** (`setBleed(false)`) for W, G, K, H and C: those photos judge the carve and its shading. R switches the
  bleed back on (the rod's real path).
- **Free aim is off for photos**, because its DOM reticle draws over the cut. R turns free aim on for its `setAimPoint` sweep.
- **K is framed 6 cm above the cut's midpoint**, so the screen-centre dot (always drawn) is clear of the profile's band.
- **R:** the canvas mousedown needs pointer lock, which headless Chrome cannot take. **The pointer-lock path was NOT
  exercised.** `rodPress` / `rodRelease` call the harness's `onMouseDown` / `onMouseUp`. The sweep is setAimPoint x
  -0.15 -> +0.15 over 20 `step`s, at 1.1 m from the torso.
- **Bone colour.** head-damage-gate's `isBone` (tuned on the lit skull: g/r 0.62-0.92, b/g 0.45-0.85) reads 0 on the
  exposed bone here. The skeleton is `mesh` and its bone renders about 185/110/112 under the red-tinted light. The gate
  uses `isPale` (r >= 120, g and b >= 0.5 r, r >= 1.4 g, which excludes the grey view model). **Proof that the pale patch in the K slot is bone:** I made an A/B
  boot with `?skeleton=procedural`, the same zombie and the same cut ([`gate/K-skeleton-ab.png`](gate/K-skeleton-ab.png),
  3x, left mesh, right procedural). The crisp pink patch becomes a dim grey-green bone.

### Results (runs 7 and 8)

| check | measured |
| --- | --- |
| W | 30 hits keep 30 wounds; 40 keep exactly 32; the first 10 hit points all covered |
| G | 16 far-side + 8 + 8 near-side wounds; every new spot changes: min mean \|dLuma\| 11.57 (17-24), 13.17 (25-32); noise max 0.29 |
| K | one cut, shape 'cut'; darkest interior 7.3 vs shoulders 23.1 / 87.9 (dip 15.8 >= 8); slot mean 32.4 -> 18.3; bone in the slot 0 -> 0.058, beside it 0.060 -> 0.051 |
| H | within 5 cm of the cut 7.37 mean \|dLuma\|; outside it 0.78 (twin renders 0.11), 1.8% of pixels over 6 |
| R | slot 6 selectable, armed, holds on press; 20 samples; 1 cut, half-length 0.11 m |
| C | 3 cuts stamped |

**Thresholds** come from the first read images. The renders are deterministic: two locked renders differ by at most
0.3 in every measured disc. The thresholds are:
- G_SPOT_MIN 5 (the lowest spot measured 11.6);
- K_DIP_MIN 8 (the dimmest view measured 15.7);
- H_IN_MIN 4 (7.4 measured);
- H_OUT_MAX 1.0 and an outside share of at most 3% (measured 0.78-0.81 and 1.8%).

The H outside-band margin is thin. The residue sits in one cluster at the right eye's lower lid, just outside the 5 cm
band ([`gate/H-diff.png`](gate/H-diff.png): red = |dLuma| x 8, yellow = outside-band pixels over 6, blue = the band's
edge). **Its cause was not isolated.**

**G per spot** (mean |dLuma| in a 0.6-crater-radius disc against the previous photo):

| batch | spots |
| --- | --- |
| 17-24 | 30.7, 26.3, 28.2, 17.4, 24.7, 32.2, 11.6, 20.8 |
| 25-32 | 27.9, 27.0, 38.6, 36.1, 34.8, 22.3, 13.2, 17.3 |

The far-side stamps moved those near-side discs by 0-1.26 (G-00 -> G-16).

**K luma profile** across the cut at its midpoint (px 641, 477), kerf 14.8 px, averaged +-25 px along the cut.
Before -> after, at t px from the cut line:

| t | -40 | -22 | -10 | -6 | 0 | +6 | +10 | +22 | +40 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before | 21 | 25 | 29 | 30 | 32 | 35 | 37 | 45 | 59 |
| after | 22 | 17 | 10 | 10 | 46 | 7 | 11 | 21 | 62 |

The t = 0 peak is the exposed sternum (bone mesh). Past about 2 kerf both sides return to the uncut skin. **The lips do
not read lit in this view.** At the ridges (1.5 kerf) luma fell, 24.5 -> 17.4 (left) and 44.5 -> 20.7 (right). The
wet-lip shading band (2.2 kerf) darkens them on this shadowed chest. In the side-lit C photo the lips read bright orange.

### Frame cost (`timeDraws(120)` median, ungated)

Each row is one run, all on the same framings:

| run | 0.6 m: 0 wounds (x2) | 16 far | 24 | 32 | 2 m: 0 (x2) | 32 |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 19.9 / 19.6 | - | - | 42.8 | 17.0 / 16.8 | 21.1 |
| 3 | 21.4 / 21.0 | - | - | 45.8 | 15.7 / 18.1 | 22.0 |
| 5 | 20.9 / 20.5 | - | - | 37.6 | 14.7 / 15.9 | 20.9 |
| 7 | 21.0 / 20.3 | 23.1 | 33.2 | 37.5 | 14.4 / 16.1 | 19.4 |
| 8 (final) | 20.8 / 20.0 | 24.3 | 35.1 | 37.4 | 14.7 / 15.6 | 19.6 |

- At 0.6 m (the torso fills the frame), 32 wounds add +17 to +25 ms. The 16 far-side wounds alone add ~2.5 ms with no
  visible pixel.
- At 2 m they add +4 to +6 ms. The baselines spread by up to 2.4 ms, and the 32-wound reading varies by 8 ms between runs.

**C, 3 cuts at 0.6 m**: 17.4 / 19.2 -> 23.5 (run 2), 21.1 / 20.7 -> 23.6 (run 3), 20.4 / 20.0 -> 22.0 (run 5),
18.9 / 20.3 -> 20.7 (run 7), 20.3 / 20.1 -> 21.2 (run 8). That is +1 to +5 ms, inside a 0.4 to 1.8 ms baseline spread.

### What the photos show

- `K-before` / `K-after` (+ `-crop`): the zombie's chest from 0.6 m, eye at standing height, most of the chest in shadow,
  the flashlight's hot spot on its right side. After: a thin vertical dark slit down the sternum. Inside it sits a crisp
  pale-pink sliver, which is the sternum bone mesh (it renders at output resolution, so its edges are hard against the
  soft half-res march). The shotgun covers the slit's lower third. The slot is visible, but in the shadow it reads as a
  thin dark line, not a lipped gash.
- `H-before` / `H-after` (+ `-crop`, `H-diff`): the face. After: a diagonal gash from under the left eye across the nose to
  the right cheek. It has a dark interior, an orange-lit jagged upper edge and wet white specular spots on the lower lip.
  It reads clearly as a slash.
- `R-before` / `R-after`: the rod (a dark steel cylinder from the lower right toward the centre; this is the first time it
  has been seen in a render) with the zombie at 1.1 m. After the sweep: a long horizontal slit across the belly, about
  0.22 m. It has a dark interior and a glossy red lit lip, and the bleed's drops run down from its middle. It reads strongly.
- `G-00` / `G-16` / `G-24` / `G-32`: G-16 is unchanged from G-00 (all 16 wounds are on the back). G-24 has 8 distinct
  round craters (rim, dark bowl, crisp pink rib patches inside). G-32 has 16 overlapping craters: a honeycomb over the
  chest and belly.
- `W-40`: 40 merged pellet hits make one large chest cavity with the sternum and rib (bone mesh) exposed.
- `C-before` / `C-3cuts`: three cuts (vertical, diagonal across it, a horizontal one low), lit orange from the side. The
  lips read bright here and the bone shows at the crossing. **Unrelated to the cuts:** a large flat pale-yellow polygon
  covers the lower-left of BOTH frames at this stance, before any cut. It is a scene element near the camera; not investigated.
- In every photo I saw no holes through the body, no speckle and no seams on or around the cuts. The hard-edged bone
  patches are the skeleton=mesh exposure path (craters show them too), not a cut artefact.

### Look loop: no constant changed

The task allowed one-constant changes only for a clear readability defect. **None was found.** The slot is visible in every
photo, including the dimmest (K). So `CUT_SHADE` and `ROD_CALIBRE` are unchanged, and no WGSL changed (no golden, census
or march-hash work was needed for this task).

**Look suggestions for the owner** (not applied):

1. **Lips in shadow.** On a shadowed surface the lips read darker than the uncut skin: the wet-lip band darkens the
   ridges. Candidates: `CUT_SHADE.lipHeight`, or less darkening in the wet-lip shading of a cut's band. Scale matters
   here: at 0.6 m the rod's 1 cm kerf is ~5 march px wide and the ~3 mm lip ridge about one march px. So a lip that
   reads at this march scale may have to be larger than the CPU slope tests assume.
2. **Slit width.** `ROD_CALIBRE.kerf` 0.01 gives a 2 cm slit, which reads as a thin line at 0.6 m in shadow. If the
   stand-in should read from further away, try a wider kerf (one constant).
3. **Exposed bone looks aliased.** The bone mesh renders crisp at output resolution inside the soft upscaled flesh, as
   hard-edged pink rectangles. This predates the cuts (skeleton=mesh), but a slot exposes it along its whole length.

### march-hash (after the main merge)

No pin moved. Default `d7392d52…` / wounded `76bd51aa…` on 2/2 boots. Crowd quad `0c71e712…` / `bf6836cd…`. Per-body
`470ff0b3…` / `f618070e…`. Header updated.
