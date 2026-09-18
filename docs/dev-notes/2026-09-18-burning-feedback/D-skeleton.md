# D — A readable skeleton without pale limbs (task 3, 2026-09-18)

**Plan:** `docs/superpowers/plans/2026-09-18-burning-feedback-pass.md`, task 3.
**Spec:** `docs/superpowers/specs/2026-09-18-burning-feedback-pass-design.md` §D.

**Goal.** The bone-fix pass (2026-09-18, same folder as the flame-lab NOTES)
made revealed bone dark/scorched so a fully charred body stayed black. That
fixed the pale-limb regression but killed the skeleton read. This pass shades
revealed bone *as bone* — ivory with soot streaks and a cavity term — while
gating the reveal to burnt-through patches so a fully charred body's mean
luminance stays within +15% of the dark-bone build.

## Files

- `src/lab/sdf-zombie/webgpu/march.wgsl.ts` — the burn block's skeleton reveal
  (`sootNoise` + the `if (showBone > 0.0)` shading).
- `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` — the bone-shading tripwires.
- `scripts/flame-capture.mjs` — `--stages` (adds an opt-in `full` = char 1) and
  `--luma` (body-silhouette luminance report). Normal runs are unchanged.
- No change to `burn-profiles.ts`: `skeletonShow` (0.7) and `skeletonDepth`
  (0.08) are reused; ivory/streak/cavity are shader-local constants, so no new
  tuning scalar and no panel churn.

**Off-limits files untouched:** `game-main.ts`, `game-actor.ts`, `motion.ts`,
`post-aa.ts`, `flame-cards.ts`.

## Step 1 — baseline captures and numbers (before the shader change)

Command (headless Chrome, WebGPU; `--frozen` pins the pose, camera and visual
clock so the two runs frame identically):

```
LAB_VITE_PORT=5377 LAB_CDP_PORT=9377 npm run flame:capture -- \
  --technique cards --frozen --poses close,stand \
  --stages fresh,charred,full --luma \
  docs/dev-notes/2026-09-18-burning-feedback/skeleton/baseline
```

`--luma` shoots a fire-off twin (`capture(0, char)`) of every stage as
`<pose>-<stage>-off.png`. The measurement:

- **mask** = pixels whose luma moved > 8 between `fresh-off` (char 0, burn 0,
  unburnt) and the stage's `off` frame. Char changes the whole body; the dark
  room and the unburnt mesh kit do not move, so this is the body silhouette.
- **off** = the pure surface frame (no flame emission, no fire light); **on** =
  the normal burning frame over the same mask.
- **boneFrac** = fraction of body pixels brighter than 2x the masked median
  (the gate's "bones visible" number).

Baseline (current dark/scorched bone), whole body = both lab bodies:

| pose | stage | char | body px | off.mean | off.median | off.boneFrac | on.mean | on.boneFrac |
|---|---|---|---|---|---|---|---|---|
| close | charred | 0.6 | 166611 | 67.58 | 57.03 | 0.1281 | 116.75 | 0.1017 |
| close | full | 1.0 | 168776 | **60.04** | 45.26 | 0.1803 | 104.46 | 0.2421 |
| stand | charred | 0.6 | 26893 | 66.71 | 59.03 | 0.0861 | 119.46 | 0.0684 |
| stand | full | 1.0 | 27021 | **59.64** | 49.42 | 0.1289 | 108.08 | 0.2030 |

(0..255 luma. `mean`/`median` are over the body silhouette.)

## Step 2 — what the old bone shading did

Inside `if (burnAmt > 0.0 || charAmt > 0.0)` in the march burn block:

```
let skelK = charAmt * burnSkeleton;
...
let boneProbe = applyBones(1e9, p, ...);              // isolated bone field
let nearBoneLin = 1.0 - smoothstep(0.0, revealDepth, max(boneProbe, 0.0));
let nearBone = nearBoneLin * nearBoneLin;
let showBone = clamp(nearBone * skelK, 0.0, 1.0);
if (showBone > 0.0) {
  ... n = mix(n, boneN, nearBone * 0.95)              // bone normal, shaped
  let scorchedBone = vec3<f32>(0.16, 0.13, 0.11);     // dark grey-brown
  let boneShade = mix(boneColor, scorchedBone, charAmt) * mix(0.8, 1.0, nearBone);
  boneMat = clamp(nearBone * 3.5, 0.0, 1.0) * skelK;  // cap = skeletonShow (0.7)
  albedo = mix(albedo, boneShade, boneMat);
  gloss = mix(gloss, 0.3, boneMat);
}
```

So the bone-fix build revealed the correct geometry (bone normal, capped mix)
but painted it `scorchedBone` at char 1 with a `0.8..1.0` depth multiplier.
Net: revealed bone ~1.4x the surrounding char, matte, no ivory anywhere. The
`bone-sweep/full` captures confirm the arm reads as one dark glossy tube, not a
bone (see `skeleton/baseline/cards-close-full-off.png`).

## Step 3 — shading bone as bone

All of this stays inside the existing burn `if`, so `burnAmt == 0 && charAmt ==
0` compiles to the same result (non-burning bodies unchanged):

```
let sootNoise = clamp(0.5 - 0.5 * fireN, 0.0, 1.0);   // signed fbm -> soot side
...
let charGate = smoothstep(0.55, 0.62, charAmt);       // reveal only past 0.55
let sootGate = smoothstep(0.35, 0.80, sootMask);      // ...and soot-high patches
let revealGate = charGate * sootGate;
let showBone = clamp(nearBone * skelK * revealGate, 0.0, 1.0);
...
let boneIvory = vec3<f32>(0.72, 0.66, 0.55);
let sootStreak = mix(1.0, 0.25, sootNoise);           // same fbm, soot side
let cavity = mix(0.12, 1.0, nearBone);                // gap -> dark, surface -> bright
let boneShade = boneIvory * sootStreak * cavity;
boneMat = clamp(nearBone * 2.2, 0.0, 1.0) * skelK * revealGate;
albedo = mix(albedo, boneShade, boneMat);
gloss = mix(gloss, 0.25, boneMat);                    // low, non-zero
metal = mix(metal, 0.0, boneMat);                     // no metal
```

The fbm is **signed** (`noise3` returns `-1..1`), so `fireN < 0` is where the
flesh chars. `sootNoise` remaps that to `1` at the soot end and `0` at the
flame end; a first cut used `1.0 - fireN` raw, which clamps to ~1 over half the
surface and left the bone almost black (measured, discarded).

The `2.2` gain and `0.12` cavity floor (down from the fix pass's `3.5`/no
cavity) are the tuning that satisfies the +15% mean gate while keeping the
ivory core bright. The first attempt (`3.5` gain, `0.35` cavity floor, raw
sootNoise) measured 1.25x baseline — over gate — because ivory over a wide mix
lifts the body mean. Narrower, higher-contrast bone keeps the mean down.

**No new tuning scalar.** Ivory, streak endpoint and cavity floor are constants;
`skeletonShow` is still the hard cap and `skeletonDepth` the falloff.

## Step 4 — recapture and gate

Same command into `skeleton/after/` (ports 5382/9382). Whole body = both lab
bodies:

| pose | stage | char | body px | off.mean | off.median | off.boneFrac | on.mean | on.boneFrac |
|---|---|---|---|---|---|---|---|---|
| close | charred | 0.6 | 156543 | 56.17 | 43.92 | 0.1616 | 108.62 | 0.1632 |
| close | full | 1.0 | 156138 | **63.28** | 50.78 | 0.1597 | 106.95 | 0.1867 |
| stand | charred | 0.6 | 26542 | 56.93 | 47.96 | 0.1247 | 112.90 | 0.1240 |
| stand | full | 1.0 | 26643 | **63.02** | 54.53 | 0.1132 | 111.05 | 0.1588 |

**Gate — full char, mean luminance (limit = baseline x 1.15):**

| pose | frame | baseline | after | ratio | verdict |
|---|---|---|---|---|---|
| close | off (surface) | 60.04 | 63.28 | **1.054** | pass |
| stand | off (surface) | 59.64 | 63.02 | **1.057** | pass |
| close | on (burning) | 104.46 | 106.95 | 1.024 | pass |
| stand | on (burning) | 108.08 | 111.05 | 1.027 | pass |

The surface (`off`) frame is the one the bone albedo can move, so it is the
binding gate; the burning frame is reported because flames mask the surface.

**Gate — bones visible: fraction of body pixels > 2x the charred-flesh median**

| pose | baseline | after | in (0, 0.25)? |
|---|---|---|---|
| close full | 0.1803 | **0.1597** | yes |
| stand full | 0.1289 | **0.1132** | yes |

The fraction is *not* higher than baseline even though the bone is clearly
brighter: the ivory core lifts the median (45.3 -> 50.8 close; 49.4 -> 54.5
stand), so the 2x bar rises with it. The metric is a sanity bound, not the
evidence of improvement — the visual and the mean are.

**Run-to-run variance.** Three after-runs measured `close full off.mean`
63.28 / 63.28 / 64.55 and `stand full off.mean` 63.02 / 63.02 / 72.52 — the
last was the discarded over-bright tuning. With the final tuning the two
comparable runs differ by <0.1; frame decode and the atlas animation still move
`bodyPx` by ~1%, so treat the ratios as +/-2%.

**Look at the images** (`skeleton/before-after.png`: top row char 0.6, bottom
row char 1.0; left baseline, right after; zombie crop):

- **char 1.0 (bottom-right):** the extended forearm reads as a distinct
  lighter ivory-tan tube inside the dark charred flesh, and the skull cap and
  upper-arm mass are lighter — a skeleton under burnt flesh. Baseline
  (bottom-left) is one uniform dark glossy tube.
- **char 0.6 (top-right):** a fainter bone stripe along the forearm and a
  lighter skull cap; baseline (top-left) is flat dark. The reveal is
  deliberately weaker at 0.6 (the `char > 0.55` gate is right at this stage).
- The shoulder/elbow ball joints stay dark (bone deep there), which is the
  "burnt-through patches, not whole limbs" read.

## Step 5 — tests and typecheck

```
npm test -- zombie-gpu-burn march burn-profiles flame-lab-main   # see commit log
npx tsc --noEmit
```

`march.wgsl.test.ts`'s "shades revealed bone as ivory with soot streaks, gated
to burnt-through patches" replaces the old "scorches the revealed bone..."
tripwire and asserts each new line.

## Still not right / not done

- **Ribs still do not read** — unchanged from flame-polish task 4: the chest
  flesh is deeper than `skeletonDepth` 0.08 and pushing the depth out pales a
  whole limb. Skull cap, forearm/upper-arm and shin tubes are what read.
- The bone fraction is measured over **both** lab bodies (the mask is a char
  diff of the whole frame), not one body; a single-body crop would be tighter.
- The soldier's mesh kit is still unburnt green (out of scope; the tongues
  envelop it).
- The `--luma` report adds a fire-off frame per stage to `--luma` runs only;
  canonical runs are byte-identical to before this script change.
