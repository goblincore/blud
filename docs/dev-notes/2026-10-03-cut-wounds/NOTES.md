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
  field as `dIn`) found the carve positive at 92k of the ball's 128k grid points, lid or not. What the lid does do:
  the carve is negative more than one kerf from every skin above the chord, so that empty space is no longer raised
  by the smax or flagged as a raiser out to the reach. No zero set changes. Comments corrected. The foreign limb is
  restored by the owner re-fold, so the threat mask has to cover the channel (next item).
- **`applyWounds`**: `if (length(wCap.xyz) < 0.5) { continue; }` first in the cut branch.
- **Threat masks** (`wound-threat.ts` `cutThreatWound`, `cutLipAmp`; `zombie-gpu.ts` threatMasks). A cut row is no
  longer the half-length sphere. It is the shader's reach sphere (the channel above the cut is carved anywhere in
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
