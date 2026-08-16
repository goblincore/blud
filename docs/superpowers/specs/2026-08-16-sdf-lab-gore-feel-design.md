# SDF lab gore-feel pass — design

**Date:** 2026-08-16
**Status:** approved (brainstormed with project owner; decisions recorded below)
**Scope:** SDF zombie lab only (`src/lab/sdf-zombie/`), both renderer paths. No game-side changes.

## Why

Playtest feedback on the lab's gibbing (after the X1.16/X1.17 fixes landed):

1. Gibbing should feel like the game's playtested ChunkSystem — **lots of small
   chunks with blood trails** — instead of six big limb pieces.
2. Chunks land and **stand straight up**, which reads wrong. Root cause is
   structural: chunk orientation is yaw-only (`angle` around y), and no yaw can
   tip a vertical limb over.
3. Carving an arm off with wounds **doesn't detach it** — severing is only on
   the keyboard. (Owner demonstrated a full visual amputation that stayed
   attached.)
4. Bug: with default rim settings, big everted rims **add material in empty
   space and weld limbs to the torso** (arm merged into body), which is also
   what makes wound-amputation impossible at defaults.
5. Blood should read **specular and gooey**, matching the `henenlotter-latex`
   flesh preset's glossy practical-effects look — the lab's blood is part of
   the same rubber-horror creature, not a flat sprite.

Decisions made in brainstorm:

- Small chunks = **split limbs into per-primitive raymarched pieces + billboard
  blood spray** (keeps the SDF lab's damage-reflecting gibs).
- Physics = **hand-rolled deterministic 3D stepper**, no Rapier in the lab; the
  game's Rapier constants become the hand-tuned targets. Handcrafted feel, every
  constant a knob.
- Detachment = **connectivity check** (visually cut ⇒ actually cut), not an HP
  threshold.
- Skeleton reveal (mesh bones under the flesh) is **deliberately out of scope**
  — it gets its own spec after this lands. It supersedes the old "skeleton as a
  second SDF field" follow-up: the owner wants traditional mesh bones.
- Execution: implementation plan runs via **dispatch-ui** headless agents
  (kimi-k3 / glm-5.3) to save tokens, per the project's usual pattern.

## 1. Chunk anatomy — what spawns

- **Sever** (keys 1/3–6 and the new wound-driven detach): a **whole-limb
  chunk**, as today. An amputated arm is one piece.
- **Gib-everything (G)**: every live non-head cluster splits into
  **per-primitive chunks** — arm → its 2–3 prims, leg → 3, torso → 4 — so a
  full-body gib yields ~15 small raymarched pieces instead of 6 big ones. The
  **head stays whole**: its face carves and skull sphere don't survive
  splitting, and the intact bouncing head is a Blood signature anyway.
- Every piece gets a torn-end wound at each **cut point** (up to 2 — a
  mid-limb piece is torn at both ends), radius from `tornEndRadius()` (girth at
  the cut, never extent — X1.16). The chunk view's single `tornAt` becomes a
  short list.
- Carve prims (`op: 'sub'`) belong to the head only today; the splitter asserts
  that a non-head cluster carries no carves rather than trying to distribute
  them.

## 2. Chunk physics — hand-rolled 3D stepper

`gib-chunks.ts` grows from `{angle, spin}` (yaw-only) to full 3D:

- **State**: quaternion orientation + 3-axis angular velocity. Spawn tumble
  ±18 rad/s per axis (the game ChunkSystem's Rapier `angvel`), scaled by launch
  speed as today.
- **Integration**: gravity, air drag, and floor contact with **restitution
  0.55, friction 0.35** (game values; lab had 0.42/0.72). dt stays clamped at
  1/30 (hidden-tab guard, already landed).
- **Topple**: once a chunk is grounded below a speed threshold, its long axis
  (from its prims' principal direction) eases toward horizontal over ~0.4 s —
  slerp toward the nearest lying-flat orientation, then damp to rest. This is
  the handcrafted fix for "chunks stand straight up": deterministic, tunable,
  no collision mesh needed.
- **Squash** stays, applied after rotation in world axes as today.
- The rotate-then-squash endpoint transform moves into **one shared pure
  helper** (in `gib-chunks.ts`) consumed by both `createChunkView` (WebGL) and
  `createChunkGpuView` (WebGPU) `apply()`s, so the two paths cannot drift. Both
  currently hand-roll the yaw math separately.
- Determinism: the stepper is pure state-in/state-out as today. Spawn-time
  randomness may keep `Math.random` (lab-cosmetic), but flows through a single
  injectable `rng` so a seeded run is possible in tests.

## 3. Blood spray, trails, and splats

A pure `blood-sim.ts` module in the lab (plain data + seeded RNG, no `three`
import) drives all droplet motion; each renderer path adds a thin instanced
billboard view (`three` vs `three/webgpu` — the two-copies-of-three trap
forbids sharing the view).

- **Constants imported from the game**: `BLOOD_TRAIL`, `GIB_BURST`, and
  `BLOOD_SPLAT` from `src/game/gibs/tuning.ts` (pure data, no three import).
  One source of truth — this starts the lab/game gib convergence the X1
  follow-up calls for. The lab does not redefine these numbers.
- **Gib-moment burst**: FX_13-style radial spray per gib — `GIB_BURST` count,
  3–8 m/s, 4 s life.
- **Per-chunk trails**: every flying chunk emits droplets at `BLOOD_TRAIL`'s
  20 Hz with 1/256 velocity inheritance, 4 s droplet life, gravity 5.0 — the
  playtested game trail, exactly.
- **Splats**: a droplet that hits the floor or expires stamps a dark floor
  quad at a `BLOOD_SPLAT.spreadM` offset, with the raised `secondChance`
  second pool. FIFO cap (~256 quads); the lab has no DecalPool and doesn't
  need one.
- **Gooey specular look** (lab-specific, deliberately richer than the game's
  flat sprite): droplets render as **velocity-stretched blobs with a specular
  glint and darkened rim**, shaded to sit with the `henenlotter-latex` preset —
  high-gloss, wet, rubber-horror. One small shader per renderer path; the
  droplet's stretch axis and magnitude come from `blood-sim` state so both
  paths read identically.

## 4. Wound-driven limb detachment

After each wound is stamped, a connectivity check runs for every live
non-torso limb:

- Sample K points along the limb's **attachment bone segment** (the rig
  already knows limb-root bones; no field evaluation needed).
- A sample is **cut** when a blast or pellet wound's carve sphere fully engulfs
  the local cross-section: `dist(sample, woundCentre) + localGirth(sample) <
  woundDepth`. Pure sphere math, deterministic, conservative (a wound that
  merely nicks the neck never fires).
- Overlapping wounds compose naturally: any single fully-cut sample means the
  neck is disconnected ⇒ the limb **auto-severs through the existing sever
  path** (stump wound, whole-limb chunk with torn end, rig rebind) — no new
  detach machinery.
- **Burns never detach** (they char and contract; matches the wound pipeline's
  existing burn semantics).

## 5. Rim containment (the limb-welding bug)

`applyWounds`' everted rim currently subtracts its Gaussian bulge from the
field **anywhere in the shell**, including empty space — with default splay it
bridges the gap between arm and torso. Fix, in both `march.wgsl.ts` and
`march.glsl.ts`:

- Multiply the rim term by a **surface-locality falloff** on the pre-wound
  field value: full strength where `dIn ≈ 0` (the surface), zero a few
  centimetres out (`exp(-(dIn/w)²)`, `w` tied to the wound radius).
- The lip is unchanged (it lives at the surface); creating disconnected or
  bridging material becomes impossible by construction.
- With containment in place, the default rim settings must allow the
  wound-amputation flow of §4 — that is the acceptance test the owner
  demonstrated by hand.

## 6. Testing

- **Stepper**: topple converges to a lying-flat orientation from any start;
  restitution/friction/tumble stay within game-constant bounds; dt-clamp
  preserved; determinism under a fixed seed.
- **Splitter**: per-prim chunks exactly partition each non-head cluster's
  prims; head cluster stays whole; every piece's torn ends carry
  girth-derived radii.
- **Connectivity**: synthetic arm + engulfing wound ⇒ cut; partial wound ⇒ no
  cut; burn wound ⇒ never; composed overlapping wounds ⇒ cut.
- **Blood-sim**: emission rate, lifetimes, splat events reproducible under a
  seeded RNG; constants verifiably imported from game tuning (no local copies).
- **Shaders**: text tripwires for the rim-locality factor in both shader
  sources (same style as the existing WGSL lint tests).
- **Visual**: both labs verified by hand/browser — gib produces small tumbling
  pieces with trails that topple and lie flat; wound amputation detaches at
  defaults; no limb-welding at default rim settings.

## Out of scope

- **Skeleton reveal** — rigged mesh bone cores under the flesh; next spec.
- **X1.18 wound-fluid emitters** — continuous gushing from live wounds; this
  spec's spray is gib/sever-moment only. `blood-sim.ts` should be built so
  X1.18 can add wound-anchored emitters later without rework.
- Any change under `src/game/` or `src/sim/`. The tuning import is read-only.
