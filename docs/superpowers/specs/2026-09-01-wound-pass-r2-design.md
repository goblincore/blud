# Wound pass round 2 — bone through deep wounds + tissue-depth shading

**Date:** 2026-09-01 · **Status:** approved (brainstormed with owner)
**Scope:** `src/lab/sdf-zombie/` — `.blob` format, `blob-compile.ts`,
`validate.ts`, `webgpu/march.wgsl.ts`, a new wound tuning panel. WebGPU only;
the GLSL twin stays frozen.
**Owner intent:** deep wounds should show bone, and wound interiors need
colour and texture beyond the single flat lerp they have today.

## Where this came from

The dungeon relight (L2, merged at `b771ab8`) made the flashlight the only
reason you see anything, and gave wounds a highlight shoulder so they can read
*darker* than lit skin under a direct beam. That created the room for a wound
pass but did not fill it.

Today the entire wound interior is one lerp in `march.wgsl.ts`:

```wgsl
var albedo = mix(baseColor, deepColor, wm);
```

driven by `woundMask` — distance from the wound *centre*. Two consequences:

1. **No depth.** The shading has no idea how far beneath the original skin a
   pixel sits, so a crater is a red smudge rather than opened flesh. There is
   no subcutaneous band, no clot, and nothing under the meat.
2. **Concentric with the impact point, not the wound wall.** An oblique hit
   and a pair of overlapping craters both band wrong, because the colour rings
   the entry point instead of following the surface that was actually opened.

The gore `fbm` mottle that would give torn meat its fibre already exists but is
dead on standing bodies — `goreStrength` (`lodCfg.w`) is 0 there, so it only
ever runs on chunks.

### The halo history, and why this design is shaped around it

The comment above `WOUND_MASK` records two days spent chasing a halo caused by
splitting the radial mask three ways (colouring at 1.25×, fresnel fade at
1.3×/2×, AO at a third radius). Each split mask has an edge somewhere on
healthy skin, and wherever two edges disagree there is an annulus — grey ring
or white crescent — that sweeps with the camera because fresnel is
view-dependent. The unified 1.6× mask was the owner's decision after an A/B
bisect against every variant.

**Nothing in this design touches that mask.** The new signals are orthogonal to
it and compose so that they cannot introduce an edge on healthy skin. That
constraint is load-bearing, not decorative, and it is restated at each point
where it applies.

## Design decisions (owner-selected)

| Fork | Choice |
|---|---|
| Where bone appears | **Anatomically** — only where a crater reaches a rig bone |
| Bone realisation | **Geometry** — unioned into the SDF; it *stops the carve* |
| Bone sourcing | **Auto-derived by default, authored override where it matters** |
| Interior shading | **Tissue-depth ramp + torn-fibre texture** |

## §1 — Bone as a field layer

### Material code

`primScale.w` currently means `0 add, 1 carve, 2 dead, 3 groove`. Bone becomes
**`4`**. That one change buys placement, mirroring, rig binding, per-frame
posing, cluster culling and the data-texture upload for free — bone rides every
pipeline flesh already rides.

### Cluster membership

Bone prims live in the **same cluster as the flesh around them**. Severing,
collapse and gibbing all operate on cluster alive-flags and prim ranges
(`sever.ts` clears `cluster.alive` and never repacks the array), so they need no
changes: sever an arm and its bone leaves with it, and a gibbed chunk carries
its bone.

### The fold

`foldGroup` and `applyCarves` skip material 4. Bone folds in a third pass,
after `applyWounds` returns:

```wgsl
d = min(dmg, dBone);   // hard union — NOT smin
```

A hard seam where meat meets bone is correct. They are different materials, not
a blend, and a smooth-min here would produce a fillet of half-bone half-meat
that reads as neither.

### The gate is an identity, not a tolerance

Because bone is authored strictly inside flesh, `min(flesh, bone) ≡ flesh`
everywhere the flesh is intact. The bone pass therefore runs **only where
`applyWounds` already reports `nearWound`**, widened by the wound `blendK` so
the smax fillet is covered.

Undamaged bodies pay nothing, and — this is the part that matters — the gate is
exact rather than approximate. A spatially gated field term that is *not* an
identity is precisely what produced the black crack seams inside wound cavities
and the crater depth-banding this file has already been burned by twice. The
containment validator in §3 is what keeps this an identity.

### Two free signals, no new returns

`mapBody` returns `vec4` and both new signals fit without adding one:

- **`.w` carries `carved`** — the pre-wound field value, i.e. depth beneath the
  original skin. Already computed at `march.wgsl.ts:953` and discarded today.
- **Bone-ness rides `bestIdx`** — when a bone prim wins the `min` it becomes the
  dominant prim, and shading reads its `primScale.w == 4`. `restPoint`'s
  rest-space noise anchor keeps working, because a bone prim is a real
  rig-bound prim with rest rows.

The march loop at `march.wgsl.ts:1509` already keeps the whole `vec4` from its
last sample, which sits within `hitEps` of the surface — accurate enough for
both uses.

**Open verification (risk, see §4):** the hit path retracts and re-steps at
omega 1 (`march.wgsl.ts:1560`). `bestIdx` from the *accepted* sample must be
the one shading sees, not a stale pre-retract value. If it is stale, bone-ness
needs a different carrier and the "free" claim weakens to one extra field
evaluation at wound-adjacent hit pixels.

### Sourcing

**Auto-derive** emits a twin of every additive limb prim, on the same bone, at
`r × ratio` (default `0.38`), with the same `at`/`capTo`, offset and
orientation, and uniform rather than shaped radii. Skipped: carves, grooves,
face prims, and any prim whose radius is below `0.5 × the largest additive
radius on the same bone` — so a thigh capsule grows a femur but the nose,
ear and fingertip blobs riding a skull or forearm do not grow bones of their
own. The rule is relative rather than absolute so it holds for a mouse and an
ogre alike.

**Authored override** replaces the auto set for the clusters it covers (§3), so
authoring a skull dome does not cost you auto-derived limbs.

The limb auto-derivation is genuinely correct rather than a fallback: a femur
*is* a thinner capsule inside the thigh capsule on the same bone. The torso and
skull are the two places players actually shoot, and both want a real authored
shape — a ribcage plate and a cranium dome, not a scaled blob.

### The stump payoff

Severing removes a limb's bone with it, but the **parent** bone survives, and
the stump wound carves the flesh around it. A torn-off forearm therefore leaves
the upper-arm bone protruding into the stump crater with no new machinery. If
it reads as too much, the stump wound's existing cap depth (`ROW_WOUND_CAP.w`)
is already the limiter.

### Budget

`MAX_PRIMS` is **128**. The worst character today is `mouse` at ~61 prims;
auto-derive adds roughly 8–14 per humanoid, so the ceiling is comfortable.
`MAX_CLUSTERS` (6) is unchanged because bone joins existing clusters. The
per-cluster fold loop caps at 64 and needs a check that the fattest cluster
stays under it.

Incidental fix: the comment at `march.wgsl.ts:62` claims `MAX_PRIMS` is 48. It
has been 128 since the raise recorded in `validate.ts:41`. Correct it in
passing.

### CPU mirror

`validate.sdBody` backs click-to-shoot raycasting; drift means shots land where
nothing is drawn. It must skip material 4 in its additive pass exactly as it
skips carves. Since `sdBody` mirrors `mapBody + applyCarves` and does **not**
apply wounds, and bone is strictly inside flesh, the CPU field is unchanged —
which is a testable claim, not an assumption (§4 gate 4).

## §2 — Wound interior: tissue depth + fibre

### The depth signal

`carved` is the pre-wound field, so at any point inside the original body it is
negative and its magnitude is the distance to the nearest *uncarved* flesh
surface:

```wgsl
let tissueDepth = max(0.0, -carved);   // metres
```

On a thin forearm the nearest uncarved surface may be on the far side, so depth
saturates at the limb's half-thickness. You physically cannot get "deep" in a
thin limb, and that falls out for free rather than needing a clamp.

### The ramp

| depth | tissue | colour |
|---|---|---|
| 0 – ~3 mm | dermis / cut lip | `mix(baseColor, deepColor, 0.5)` — derived, not a new knob |
| ~3 – ~12 mm | subcutaneous fat | pale yellow-cream (`fatColor`) |
| ~12 mm + | muscle | `deepColor` — already owner-tuned, unchanged |
| deepest | clot | `deepColor × 0.45` — the existing chunk `clot` value |

The **fat band is the load-bearing stop**. It is the single cue that makes a
crater read as *opened* rather than *stained*, and it is exactly what a
one-lerp shading model has no way to express.

Knees default scaled by the model's `height` — an ogre's fat layer is not a
mouse's — with absolute per-character overrides available.

### Composition — this is what protects the existing tuning

The radial `wm` stays exactly as it is and remains the **sole authority on
whether a pixel is wounded**. The depth ramp only chooses *which colour the
wounded end of that lerp reaches for*:

```wgsl
let tissue = tissueRamp(tissueDepth);   // pale → red → dark
albedo = mix(baseColor, tissue, wm);    // wm untouched
```

At `wm = 0` nothing changes regardless of depth, so the ramp cannot put an edge
on healthy skin. On healthy skin `tissueDepth` is 0 anyway, so it is safe
twice over. The unified 1.6× mask and its tuning survive intact.

This is the structural difference from the 2026-08-23 crater pass that caused
the halo: that split one mask into three masks with three radii, all of them
authorities on wounded-ness. This adds one signal that is not an authority on
wounded-ness at all.

### Fibre texture

The gore mottle `fbm(anchor * 6.0)` already exists and is dead on standing
bodies. It enters **multiplied by `wm`**, confined to the wound interior,
reusing the same call and the same rest-space anchor so chunks and wounds
agree. Switching `goreStrength` on globally is explicitly *not* the mechanism —
that would repaint whole standing bodies as torn meat.

Stretch, as a tuning knob rather than core: stretch the anchor along the
dominant prim's bone axis so muscle streaks along the limb instead of reading
as blotches. This either sells it immediately or looks like corduroy; it should
be judged on screen, not committed to in advance.

### Wet

The existing `wet` line maxes against `wm`, wetting the whole crater uniformly.
The ramp gives a better hook: peak wetness at the fat/muscle boundary and
falling off into the dry deep, so the lip glistens and the floor does not.

### Bone material

Per-character `boneColor`, default a desaturated bone-white ≈ `[0.86, 0.82,
0.70]`, high roughness and low wet — but **blood-stained at its junction with
flesh**, mixed toward `deepColor` by `dmg - dBone`, which the `min` has already
computed. Without the stain a clean white plate pops out of red meat like a
decal.

### Amplitude guard

`woundDepthAmp 0` shades bit-for-bit as today, matching the house pattern of
`mottleAmp` and `surfaceNoiseAmp`. That gives a free A/B toggle for the owner's
judgement pass and a free perf floor. Ships at 1.

## §3 — Authoring surface and tuning

### `.blob` syntax

A `bones` block mirroring the `body` block:

```
bones
  ratio 0.38                                                       # auto-derive for uncovered clusters
  blob bone on skull at=0.55 r=0.078 wide=0.86 tall=0.95           # cranium dome
  bar  bone on spine from=0.15 to=0.95 r=0.055 wide=1.35 deep=0.55 # ribcage plate
end
```

The block is optional and the default `ratio` applies without one, so **all
seven existing characters get bone with zero edits**. An authored line replaces
auto-derivation for the cluster it lands on only.

### Material knobs

`boneColor`, `fatColor`, `woundDepthAmp`, `woundFibreAmp`, and the two ramp
knees `fatDepth` / `muscleDepth`.

### Containment validation — write this first

The entire `nearWound` gate rests on `min(flesh, bone) ≡ flesh` outside wounds.
If an authored bone protrudes through the skin anywhere, that identity breaks
*only outside the gate*, and the fragment pops in and out as the gate flips —
the same discontinuity class as the black crack seams and the crater depth
bands.

`validate.ts` gains a check that samples each bone prim's surface and asserts
the flesh field is inside by a margin at every sample, failing the build
otherwise. Auto-derived bones satisfy it by construction; authored ones need
the guard.

### Tuning panel

Modelled on `goo-panel.ts`: sliders for the ramp knees, `boneColor`,
`fatColor`, fibre amplitude and bone ratio, plus presets and a COPY button.

**Hard requirement: COPY must emit from the same key table the setter
consumes.** Panel/setter key drift has bitten this project at least twice — the
panel emitting `setBeam` keys the setter ignored, and the goo panel before it.
Generating both sides from one table makes the drift impossible rather than
merely unlikely.

### Seams

`__sdfGame.setWoundTuning({...})` and `__sdfGame.setBone({...})`, matching the
shape of `setGooTuning` / `setBeam`.

### Repro loop

Reuse the existing harness rather than inventing one:

```bash
BLOB_PROBE='(window.__sdfLab.stampWounds(5),1)' npm run blob:shot -- zombie /tmp/wound-r2
```

plus `scripts/dungeon-look.sh` for the in-game read. The beam is now the only
reason you see anything, so a wound that reads in the lab's flat light may
vanish in the dungeon — both views are required, not interchangeable.

## §4 — Cost and gates

### Where the cost lands

- **Depth ramp:** free. `.w` is already computed; the ramp is a few `mix`es at
  hit pixels.
- **Fibre:** one `fbm`, amplitude-guarded, at wound-interior hit pixels only.
- **Bone fold:** the real cost. A ~10-prim loop per march step, inside
  near-wound zones only. Those zones already step conservatively at 0.6, so
  they are the expensive pixels to begin with, and `calcNormal` calls `mapBody`
  four times — so wound-adjacent normals pay the bone loop 4×.

This needs measuring, not estimating. Mitigation if it bites: bone prims are
per-cluster, so the existing cluster bounds-sphere cull can skip clusters with
no live wounds.

### Gates, in run order

1. **Re-establish the bench baseline.** `scripts/dungeon-bench.sh` has not been
   re-run since shadow-hull spanning took instances from 30 to 51 per body. The
   only reading since is a one-off HUD number of 54.4 ms against 21–27 ms
   earlier, never reproduced or trusted. Until that is resolved any regression
   measured afterwards is unattributable. **Prerequisite, not a loose end.**
2. **Off-state parity.** `woundDepthAmp 0` with no bone prims renders
   bit-identical to main. This is the gate `X1.blood-viscosity`'s Task 7 never
   ran, which is why goo ships ON with its per-frame cost unmeasured. Not
   repeating that.
3. **Bone containment validator** (§3), with a test per character.
4. **CPU/GPU agreement.** `sdBody` with bone prims equals `sdBody` without, and
   click-to-shoot still lands.
5. **Undamaged-body pixel diff.** An unwounded character is pixel-identical to
   main — the empirical proof of the gate identity, separate from the algebraic
   argument.
6. **Halo regression check.** Turntable at 5 stamped wounds against main,
   looking specifically for annuli at mask edges and crescents that sweep with
   the camera. This file has produced that failure twice; it gets its own check
   rather than riding on general judgement.
7. **Bench with bone**, three conditions: no wounds / wounds without bone /
   wounds with bone.

### Risks on the record

- **`bestIdx` through the retract path** (§1). If the accepted sample's
  `bestIdx` is not what shading sees, bone-ness needs a different carrier.
- **Bone stops being special.** If the auto ratio puts bone within a pellet's
  carve depth on a skinny limb, every scratch shows bone. The conservative
  default and the ramp knees give tuning room, but this is an on-screen owner
  judgement, not something the design can settle.
- **The stump protrusion may read as a bug** before it reads as a feature.
  Cheap to cap via the stump wound's existing cap depth if so.

### Sequence

Bench baseline → containment validator + CPU mirror → bone field layer with
parity gate → depth ramp → fibre → panel → author skull and ribcage for zombie
and goblin → owner judgement pass.

## Explicitly out of scope

- **The GLSL twin.** `march.glsl.ts` is frozen per the owner decision recorded
  at `march.wgsl.ts:56`. No port.
- **Bone fracture, chipping or deformation.** Bone is rigid; a hit either
  reaches it or does not.
- **Bone in the goo/blood sim.** Bone shards as gib particles are a separate
  idea and are not part of this pass.
- **Retuning the radial `woundMask`.** It stays exactly as the owner bisected
  it. If the overlap ridge or the halo returns as a complaint, it is
  re-derived against this baseline, one change at a time, with the owner
  judging.
