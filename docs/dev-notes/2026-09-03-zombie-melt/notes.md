# Zombie melt — task 7: organs, freeze, and the tuning pass

**Date:** 2026-09-03 · **Branch:** dispatch/melt-task-7 · **Plan task:** 7 of
[the melt plan](../../superpowers/plans/2026-09-03-zombie-melt.md) ·
[Spec](../../superpowers/specs/2026-09-03-zombie-melt-design.md)

This note is the task-7 deliverable: organs melting at half rate, freeze
verified at the geometry level, and the tuning pass against captured frames —
the final numbers, and why each moved.

---

## Organs melt at half rate

The four `organ` prims ride `BuiltBody.bonePrims` (the split key is "inside
the flesh", not "bone specifically"). Tasks 5–6 filtered them OUT of the
upload during a melt, because an un-melted organ hangs in the air where the
torso was. Task 7 melts them instead.

`applyMeltOrgans(prims, state, rateScale = 0.5)` in `melt.ts`:

- The organ state is the flesh state with progress remapped through
  **t′ = t · (rate + (1 − rate) · t)**. The melt front rises at half the
  flesh rate at the start and catches up smoothly, so both finish TOGETHER
  at t = 1. A flat half-rate clock would leave organs stranded half-melted
  over the finished puddle forever; this schedule makes them briefly
  distinct and then takes them.
- Organ endpoint heights are normalised against the FLESH body's span and
  floor — which is why `MeltState` grew `span` and `floorY` fields. The
  front must reach an organ when it reaches the torso around it; normalising
  organs by their own span would melt them on their own clock.
- The transform itself is `applyMelt`, unchanged. The lag is the ONLY
  difference (asserted: `rateScale = 1` produces byte-identical output to
  `applyMelt` on the same geometry).

In `lab-main.ts` the melt branch now maps organs through `applyMeltOrgans`
in place (one prim at a time, bonePrims order preserved) instead of dropping
them. Released bone groups are still filtered out exactly as before.

## Freeze — asserted at the geometry level, honest about the render loop

Two new tests pin the freeze where it matters:

- `applyMelt` is a **fixed point** past t = 1: stepping a frozen melt and
  re-transforming returns the identical geometry, not just the identical
  `state.t`. Same for `applyMeltOrgans`.
- `stepMelt` past 1.0 remains a no-op (task 1's test).

**Honest note on uploads:** the render loop calls `view.update(…)`
UNCONDITIONALLY every frame, so a frozen puddle's (identical) prim rows are
still re-uploaded per frame, and the released bone chunks are still stepped
by the chunk stepper. What is frozen is the STATE and the GEOMETRY — no
number the melt owns moves after t = 1, which the tests assert. Per the
plan, the render loop was not restructured to force upload elision; if a
bake/elision step is ever wanted it belongs to the arena-shipping work the
spec already names out of scope.

## The tuning pass — what the first capture showed

First capture of the task (the `before-*.png` frames), tasks 1–6 tuning
(`frontLead 1.55`, `softness 0.45`, `MELT_BONE_RELEASE_U 0.6`):

| t | silhouette h (px) | what the frame actually showed |
|---|---|---|
| 0.00 | 237 | pink zombie, standing |
| 0.30 | 274 | reddened, still standing — colour leads ✓ |
| 0.50 | 272 | legs gone, torso sagging into a mound ✓ |
| 0.70 | **277** | **TOTEM** — a stack of discrete red meatballs on the puddle, skull intact on top |
| 0.85 | 227 | **FLOATING SKULL** — pale skull + neck hovering ~1.2 m over the puddle |
| 1.00 | 50 | wide glossy puddle with pale bones ✓ |

The end state passed both gates while the middle of the ramp was wrong —
which is exactly why this task tunes against frames, not just ratios. Two
defects, two causes:

1. **The totem.** `softness 0.45` makes the transition band barely one prim
   tall. The band sweeps up the body like a scan line: below it fully pooled,
   above it untouched, and the boundary region a stack of still-distinct
   blob prims. Worse, the crown (h = 1.0) does not begin to move until
   front = 1.0, i.e. t ≈ 0.65 — so the head sat intact on top of a
   dissolving body. A candle's top descends because its support is gone;
   ours just stood there.
2. **The floating skull.** Bone groups hold their rest pose until release,
   then FREE-FALL. At `RELEASE_U 0.6` the skull let go at t ≈ 0.75; its
   fall from ~1.4 m needs ~0.5 s of settle, so at t = 0.85 it had dropped
   ~0.1 m and hung in the air over a nearly-finished puddle. (Task 6's
   `meltSettle` made the capture deterministic; it cannot make the fall
   faster than gravity.)

### What moved, and why

| Knob | Before | After | Why |
|---|---|---|---|
| `MELT_TUNING.softness` | 0.45 | **0.65** | Band now covers ~2 prim heights: neighbours flow together instead of unstacking into meatballs, and the crown starts descending at t ≈ 0.57 instead of 0.65 — the silhouette shortens like a candle. |
| `MELT_TUNING.frontLead` | 1.55 | **1.75** | Structural: frontLead must be ≥ 1 + softness or the crown never reaches full melt (task 1's test enforces this). 1.75 = 1 + 0.65 + 0.1 margin, so the last 5% of the ramp is not a head-only crawl. |
| `MELT_BONE_RELEASE_U` | 0.6 | **0.4** | Groups let go while their supporting flesh is only half gone. The skull now releases at t ≈ 0.65 and lands in the puddle before the ramp ends; still late enough that bones do not punch through flesh that has barely sagged. |
| `MELT_TUNING.rate` | 0.625 | 0.625 (unchanged) | 1.6 s total vs the reference's ~1.3 s — the spec's deliberate choice for FP readability; nothing in the frames argued against it. |
| `MELT_TUNING_BODY.*` | — | unchanged | poolHeight 0.09 / crush 0.25 / spread 0.16 / fuseK 0.035 were set by tasks 3–6 against earlier captures; the end-state ratios were already mid-band and the frames showed no puddle defect. |

### After (the `after-*.png` frames, same fixed camera)

| t | h (px) | frame |
|---|---|---|
| 0.00 | 237 | standing |
| 0.15 | 242 | standing, first reddening |
| 0.30 | 274 | deep red, feet spreading into goo, foot bones showing |
| 0.50 | 271 | legs gone, upright torso draining into a glossy mound |
| 0.70 | 202 | skull descending through the emerging spine/rib bones — no totem |
| 0.85 | **68** | nearly flat — skull LANDED (was 227 with it hovering) |
| 1.00 | 48 | wide glossy puddle, pale bones in it |

**Gate B (pixels, fixed camera):** height **0.20x** (≤ 0.40 PASS) · width
**2.32x** (1.50–3.00 PASS) · centroid **0.18x** (≤ 0.25 PASS).
**Gate A (field AABB, real zombie.blob):** height **0.10x** · width
**1.60x** · centroid **0.08x** · bone settle **10/11** groups at rest inside
the puddle (one upper arm clatters just past the pool radius — acceptable;
bones scatter).

Both gates passed BEFORE the tuning as well (0.21x / 2.38x / 0.19x). The
ratios barely moved; the frames are what changed. That is the lesson of
`c52b05b` running in reverse: the numbers are a floor, the frames are the
verdict.

### Known segmentation artefact (not geometry)

Pixel height GROWS 237 → 274 between t = 0 and t = 0.3 while Gate A's
"never grows taller" passes on every frame of the ramp. Two benign causes:
at t = 0 the pink zombie is low-contrast against the dark red backdrop so
the mask undercounts, and the feet melt DOWNWARD/outward (radius grows by
1/√yScale, so the pooled bottoms extend below the rest silhouette). No
endpoint ever rises — asserted by test.

### What the sequence now reads as

Reddens while standing → sinks straight down with the legs going first and
capsules stretching → skull and spine emerge and DESCEND with the melt →
wide glossy dark-red puddle with pale bones lying in it. **It never
topples** — every frame's mass stays centred over the pool, and the only
horizontal motion is the outward spread and the bones' clatter.

Residual nits, stated plainly: at t = 0.5 a dark gap opens in the lower
torso where flesh has receded around not-yet-released, dark-shaded bone —
transient and readable as "skeleton emerging", but the bone tubes are dark
enough that it can read as a hole at a glance. And the melt branch still
re-uploads frozen rows (above). Neither blocks the lab feature.

## Verification

- `npx vitest run` — **2970 tests / 182 files green** (baseline 2929/180;
  +41 from melt tasks: melt.test.ts 28, melt-bones 14, melt-gate 3, minus
  none).
- `npx tsc --noEmit` — clean.
- `npm run melt:shot` — gate table above; frames in this directory.

---

# Task 8 addendum — the melting face (2026-09-03, branch dispatch/melt-task-8)

## The anchoring bug (Step 1) was real and is fixed

`headShape(posed)` and `uploadWounds(posed.prims)` both ran on the UNMELTED
body: during a melt the face projection and every wound stayed pinned to
where the standing zombie was. Same class of mistake as Task 4 Step 0's
stale clusters. The frame now computes the melted prims ONCE into
`frameBody` and feeds it to `view.update`, `headShape` and `uploadWounds`
(`lab-main.ts`). Proof it is live: the capture camera re-aims at the
uniform-read-back head centre each progress value, and it now descends
1.617 → 0.090 across the ramp (before the fix it would have stayed at
~1.6).

Level one fell out as predicted: the projection normalises by `headAxes`,
so the crushed head stretches the face over the flatter shape with no
shader change (`face-step1only-080.png` — the eye glow already spread wide
across the flattened skull).

## The drip (Steps 2–3), and a sign correction to the plan

The plan's formula subtracted the sag from `uv.y`. In THIS shader the
sheet's v increases UP the face (rows are flipped at upload — lab-main.ts
"the flip lives here"), so subtracting slides features UP the skull. The
shipped term adds:

```
uv.y = uv0.y + meltSag * FACE_MELT_SAG - (uv0.y - faceProj.w) * meltSag * FACE_MELT_STRETCH;
```

The stretch sign is also deliberate: NARROWING the sampled window
(k = 1 − t·0.6) makes each feature cover MORE surface — that is the
elongation. Widening the window (the literal reading of "stretch the UV")
compresses features toward the centre line instead. Constants are
`FACE_MELT_SAG = 0.25`, `FACE_MELT_STRETCH = 0.6`,
`FACE_MELT_FADE_LO = 0.05` in `march.wgsl.ts`.

Judgement from the close-up frames (`face-drip-*.png`, camera re-aimed at
the live head centre per t): at t = 0.65 the eyes have visibly dragged
down onto the lower half of the descending head and drawn out, vs
step-1-only where they still sat mid-head; at t = 0.80 the features ride
low on the flattened skull as it sinks into the puddle. It reads as
dripping, not as a sliding sticker. **No smear around the back** at
FACE_MELT_FADE_LO = 0.05 — the widened fade keeps the face on the front of
the sagging mass, and the face survives onto the sagging surface instead of
vanishing early. By t = 0.9 the head is fully pooled and the skull lump
emerges through the goo, face gone — the intended end state.

## Gates did not move

Gate B re-run after Steps 2–3: height 0.22x, width 2.63x, centroid 0.21x —
all PASS, within the documented boot-to-boot statue noise of the Step-1 run
(0.24x / 2.35x / 0.23x). The face is shading; the silhouette numbers not
moving is the expected outcome, not a lucky one. Suite: 2973 tests / 182
files green (the 3 new face-drip shader tests included), `tsc --noEmit`
clean.

Tooling note: `melt-capture.mjs`'s camera yaw is now `BLOB_YAW`
(default 0.5, the gate framing is unchanged) so close-up judgement runs can
face the zombie (the zombie's face is on the far side at the gate yaw;
BLOB_YAW ≈ 3.55 faces it).
