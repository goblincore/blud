# Zombie melt — flesh sags into goo, the skeleton falls out of it

**Date:** 2026-09-03
**Status:** approved, ready for planning
**Scope:** LAB ONLY — no game wiring, no weapon gate, no `deathStyle` plumbing
**Touches:** `src/lab/sdf-zombie/melt.ts` (new), `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`,
`src/lab/sdf-zombie/webgpu/march.wgsl.ts`, `src/lab/sdf-zombie/webgpu/lab-main.ts`,
`scripts/melt-capture.mjs`
**Supersedes the mechanism in:** `X5.melt` / `c52b05b` (see "What replaces the previous attempt")

## The brief

> "previously we had started to work on a melting death effect for the zombie.
> basically the idea is inspired by fallout 2 energy weapon death where the
> character collapses and essentially melts into a gooey slime puddle which is
> what i want the zombie to do. basically the whole flesh would distort and fall
> away like stretchy gooey dough and the bones fall out onto the ground in a
> fleshy puddle"

## What the reference actually does

Read frame by frame off the owner's `melting.mov` (135 frames @ 60fps, the melt
occupying ~1.3s of it):

| Stage | Frames | What happens |
|---|---|---|
| Redden | ~0.0–0.3s | Body reddens/skins **in place, still standing, still upright** |
| Sag | ~0.3–0.7s | Sinks *straight down* like a candle — silhouette narrows and shortens, legs go first |
| Strip | ~0.7–0.9s | Skull and a few pale bone bits briefly visible as flesh strips off |
| Pool | ~0.9–1.3s | Flattens into a **wide** glossy dark-red puddle with pale bone fragments in it |

Two properties matter more than the rest:

1. **It never falls over.** The body descends in place. It is a candle, not a
   ragdoll.
2. **The signature is vertical sag plus lateral spread**, not surface wobble.
   The puddle is wide *because* the body was tall.

The reference is an isometric sprite at ~40px tall. Blud is first person and the
player stands over this, so the skeleton is far more visible here than in the
source material — hence the full-skeleton decision below.

## Decisions taken (owner, this session)

| Question | Decision |
|---|---|
| Universal death, weapon-gated, or overkill-gated? | Weapon-gated — but **lab only for now**, so no trigger is built |
| Melt standing, or collapse first? | **Melt standing.** `collapse.ts` is bypassed entirely; melting *is* the death |
| How much skeleton survives? | **Full authored skeleton** — every bone tube renders and comes down |
| What is the puddle made of? | **The same SDF field.** `smin` union *is* metaball blending; the prims already are the goo system |
| Puddle lifetime? | **Permanent but frozen** — stays forever, stops simulating, no longer reacts |
| Rest space | **Dragged with the melt**, so surface detail flows with the goo |
| Shader work | Welcome — geometry needs none, the material does |

## Mechanism: animate the prim table, not the shader field

Flesh prims are unioned with a per-prim `blendK` `smin`; bones are folded in
afterward with a hard `min` from their own contiguous rows; every prim carries a
rest endpoint (`march.wgsl.ts` rows 1, 9–10, and `APPLY_BONES` at :1041). The
whole prim table is uploaded per frame, and `zombie-gpu.ts:1524–1636` already
runs a per-frame local-prims → world-space → `writeRow` path for severed-limb
chunks.

So the melt is **CPU-side prim animation**. No field warp, no displacement term,
no Lipschitz cost, and bones are separately addressable for free.

### New module: `src/lab/sdf-zombie/melt.ts`

Pure, in the shape of `collapse.ts` — no `Date.now`, no `Math.random`;
`(state, dt) → state` is deterministic, because the capture script steps it frame
by frame and must get identical frames.

```
meltInit(body) → MeltState              // captures rest prims + per-endpoint melt order
stepMelt(state, dt) → MeltState         // advances progress, returns per-endpoint transforms
applyMelt(prims, state) → Primitive[]   // rest flesh prims in, melted flesh prims out
```

`applyMelt` is kept separate from `stepMelt` so the state machine is testable on
numbers alone, with no prim table present.

Two prim populations, treated differently:

- **Flesh** (~23 prims) — melted: sagged, spread, fused.
- **Bone** (~45 prims after `both` mirroring, plus the limb bones auto-derived at
  ratio 0.38) — **never touched by `applyMelt`**. Driven by the chunk stepper.

## The melt curve

### Sag is per-endpoint, not per-prim

This is the load-bearing choice. Every prim is a capsule with two endpoints. If
each endpoint sags on its own schedule, capsules **stretch** as the lower end
drops away from the upper — arms elongate into strands, the torso draws out as
the pelvis liquefies first. That is the "stretchy gooey dough" read, and it comes
free from moving points rather than moving prims.

Sagging whole prims gives a body sliding downward rigidly, which is a different
and much worse effect.

### Descent is paced by the melted material below the endpoint

Not by a fixed per-limb delay. An endpoint's floor is the accumulated height of
everything already pooled beneath it, so the feet go first and the torso and head
descend only as their support turns to liquid. This is what makes it a candle
rather than a lift, and it is also what drives bone release (below) without a
scripted sequence.

### Volume goes sideways, not away

As an endpoint approaches the floor its Y scale crushes toward ~0.25 and its
radius grows by roughly `1/sqrt(yScale)` — approximately volume-conserving. Flesh
that merely shrinks reads as evaporating; flesh that spreads reads as melting.
The puddle must end up **wider than the body was**.

### Fuse ramps with depth, not globally

`blendK` goes from the authored 0.007–0.02 up past ~0.1 as a prim nears the
floor, so the puddle is one continuous surface while the still-upright upper body
is still recognisably a body. A global fuse ramp turns the standing torso into a
featureless lump inside the first 200 ms.

### Bone exposure needs no code

Bones fold in with a hard `min` **after** flesh. When a flesh prim sags or thins
past a bone tube, the bone wins the min and becomes visible. The skull emerging
as the head liquefies is a consequence of the existing field, not a scripted
stage.

### Timing

~1.6s total, against the reference's ~1.3s. **Every number below is a starting
guess to be tuned against captures, not a claim.**

| Window | What is happening |
|---|---|
| 0–0.2s | Goes soft — slight height loss, fuse begins, albedo already reddening |
| 0.2–0.7s | Legs liquefy, body descends, capsules stretch |
| 0.5–1.0s | Skeleton emerges through thinning flesh; bone groups begin releasing |
| 0.8–1.6s | Pooling and spread; bones settle into the goo; freeze |

## Bones and organs

**Bones never melt. They are revealed, then released.**

### Released as rigid groups, not as ~45 loose tubes

A ribcage does not disassemble into individual ribs when the flesh goes.

| Group | Contents |
|---|---|
| Skull | the 2 head blobs |
| Cage | ribs, sternum, clavicles, spine bars — one rigid body |
| Pelvis | the 7-piece pelvic assembly |
| Limbs | upperArm, foreArm, thigh, shin ×2 = 8 separate bones |

~11 rigid bodies instead of ~45: anatomically right *and* four times cheaper. It
still satisfies "full skeleton" — every authored tube renders, they simply move
in the groups they are actually attached in.

### Release is driven by the same number as the sag

A group drops when the flesh supporting it has liquefied past it. Leg bones go
first and clatter outward, the cage settles as the torso drains, the skull comes
last and rolls off the top of the pile. No scripted sequence — it falls out of
the support model.

### Physics is existing code

The chunk stepper (restitution 0.55, friction 0.72 — mirrored with provenance in
`COLLAPSE_TUNING`) and the chunk render path that already carries bone prims;
severed limbs do exactly this today.

### Landing looks right for free

Puddle flesh is fused with a large `blendK`; bones fold with a hard `min`. A bone
half-sunk in goo therefore **creases** where it enters the surface instead of
blending — precisely the pale-bits-in-red-puddle read from the reference.

### Organs

The `.blob` carries four `organ` prims (intestines plus a blob cluster). They
melt **with the flesh but at roughly half the sag rate**, so they slop out of the
collapsing torso and are briefly visible as distinct shapes before the goo takes
them. The alternative — treating them as ordinary flesh — means they are never
seen at all.

## The look

Geometry needs no shader change. **The material does.** Melting flesh that keeps
standing-zombie albedo reads as a body doing yoga, not as goo.

- A `meltCfg` uniform carrying progress. Reuse the name from `c52b05b` — that
  half of the old branch is still good.
- In the flesh shading branch, lerp albedo toward a dark saturated red and raise
  wetness/gloss with it. The machinery exists: the shader's own comment notes wet
  skin reflects while bone stays matte, which is exactly the contrast that sells
  pale bones sitting in wet goo.
- **The reddening leads the sagging.** In the reference the body goes red while
  still standing, before it visibly sinks — that is what tells the player "melt"
  instead of "fall". The albedo ramp runs roughly twice as fast as the sag ramp
  and is near-complete before real height is lost.

## Freeze

At progress 1.0 the state machine stops, prim rows stop being rewritten, bones
stop simulating. From that frame the puddle is an ordinary static prim set — same
cost as any other body, no ongoing physics, no ongoing uploads.

**Known cost, deliberately not solved here:** a frozen melted zombie still holds
its ~23 flesh + ~45 bone prims against `MAX_PRIMS 128`. Per-body, so it does not
compound in the lab. If this ever ships into the arena with many melted corpses
it will want a bake step. Out of scope.

## Lab wiring

**Do not cherry-pick `c52b05b` wholesale.** Take `scripts/melt-capture.mjs` and
the lab key/console seams; leave the shader half behind. Its `mapBody` change
widens `noiseAmp: f32` → `noiseCfg: vec4`, and the body-sheet work on that same
branch builds on that signature — dragging it in creates a merge collision for a
term this spec has decided not to use.

Seams:

- `m` starts the melt, `M` resets
- `__sdfLab.melt() / meltOff() / setMeltTuning({...}) / meltState()`
- `meltDirect(t)` jumps straight to a progress value — this is what makes capture
  deterministic and tuning fast

## Verification

Capture at fixed progress values (0, 0.15, 0.3, 0.5, 0.7, 0.85, 1.0) from a fixed
camera, driven by `meltDirect` rather than elapsed time, so frames are
reproducible.

The script emits per-frame silhouette numbers alongside the PNGs — height, max
width, filled area, centroid height — and a task **FAILS** unless, at progress
1.0:

- silhouette height ≤ 40% of progress 0
- max width ≥ 150% of progress 0
- centroid height ≤ 25% of progress 0

These three numbers are the mechanical statement of "it sank and it spread".

**Why this gate exists:** the previous attempt (`c52b05b`) shipped tested,
green, correct-looking plumbing that produced *literally zero* visual change at
amplitudes far past sane, and no test caught it — the finding came from a human
looking at frames. Any one of the three numbers above would have failed it on its
first capture. The implementing agent also reads the frames and gives a visual
verdict; the numbers are what make "it didn't work" impossible to miss.

## Tests

On `melt.ts` as pure functions:

- no endpoint ever rises
- volume conserved within tolerance across the ramp
- `blendK` monotonically increasing
- bone groups release in order: legs → cage → skull
- `stepMelt` past 1.0 is a no-op (freeze is idempotent)
- `applyMelt` provably never touches a bone row
- determinism: identical `(state, dt)` sequences produce identical output

## TRAP — read before "fixing" a validation error

`validate.ts`'s `checkBoneContainment` enforces a 4 mm flesh-over-bone margin.
**Melt deliberately violates it — bones breaching flesh IS the effect.** That
check must not run on melted prims. An agent that "fixes" the containment errors
will have deleted the feature. This will look like a bug. It is not.

## What replaces the previous attempt

`X5.melt` / `c52b05b` implemented melt as a **ridged-noise displacement** inside
`mapBody`, and it was never visible at any amplitude. That same commit's own
finding explains why the path was wrong in principle as well as in practice: the
main march calls `mapBody` at noise amplitude zero on purpose and marches a
smooth field, so a displacement written there warps the normal and never moves
the surface; only the shell block touches geometry, and it is off by default in
the lab.

Beyond the plumbing bug, the mechanism could not have produced this effect even
working perfectly: noise displacement makes a surface *wobble*. It cannot make a
body shorter or wider, which is the entire signature of the reference. This spec
therefore changes the mechanism rather than continuing the debug.

Salvaged from that branch: `scripts/melt-capture.mjs`, the lab key/console seams,
and the `meltCfg` uniform name. Discarded: the `noiseCfg` widening and the ridged
displacement term at both sites.
