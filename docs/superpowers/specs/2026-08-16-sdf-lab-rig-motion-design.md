# SDF lab rig motion pass — design (Spec B)

**Date:** 2026-08-16
**Status:** approved (brainstormed with project owner)
**Scope:** SDF zombie lab only, **WebGPU path only** (WebGL frozen). No game-side changes.
**Depends on:** gobs & goo (X1.21) + the X1.19.2 chain-cut union fix landing first —
the wiring touches `webgpu/lab-main.ts`, which those own until they merge.
**Sequencing:** BEFORE the skeleton reveal (X1.20) — motion multiplies every gore
feature's impact, and bones don't care about gait.

## Why

The lab body is a statue: it stands still, soaks hits with only a joint shove,
and floats when its legs are gone. Owner wants: shamble/walk animation, a sense
of impact — "weight of flesh" — when shots land, staggering, and (from the
earlier playtest) a body that actually goes DOWN. Everything **procedural** —
no animation assets — and **inverse kinematics** explicitly wanted.

Decisions from brainstorm:

- One spec for **shamble + hit-stagger + collapse** (three faces of one
  machine: the verlet rig driven by target poses and impulses).
- Locomotion: **wander the arena** (toggleable, default on).
- Collapse: **both legs severed ⇒ down; one leg ⇒ hop-limp; accumulated
  damage meter ⇒ death collapse** under sustained fire; `K` forces it.
- **IK via FABRIK** — verlet-style position iteration, the same math the rig
  already runs.
- Hand-rolled solver first; **box3d** (github.com/erincatto/box3d, v0.1.0,
  MIT, WASM-buildable) is the solver-stability reference and the documented
  fallback if hand-rolled crumpling misbehaves.
- This chain is the candidate testbed for the owner's kimi/deepseek model
  experiment (pure TS modules, heavily unit-testable) — pending API keys.

## 1. Gait driver (`gait.ts`, pure)

- Phase-clocked oscillators drive rest-pose TARGET offsets: hip sway, shoulder
  counter-rotation, root bob, alternating leg swing. The verlet rig's existing
  rest-pull integrates toward them — the rig stays the single motion authority.
- **Claymation tuning bias**: heavy damping, low frequency, slight asymmetry
  jitter so it reads hand-posed, not sinusoidal.
- **State-aware from day one**: severed/wounded limbs skew the gait — missing
  arm ⇒ asymmetric counter-sway; wounded leg ⇒ limp (stance shortened on that
  side); one leg ⇒ hop-limp state; damage meter high ⇒ heavier stumble, lower
  bob, dragging feet. This coupling is where "weight of flesh" lives.
- Deterministic under an injected clock/seed; all frequencies/amplitudes are
  exported tuning constants.

## 2. IK (`ik.ts`, pure FABRIK)

- **Foot planting**: during stance phase the foot LOCKS to its floor contact
  point; a 2-bone FABRIK chain (hip→knee→ankle) solves the leg to keep it
  there while the root translates — the difference between a shamble and a
  floaty sway. Swing phase releases and the gait oscillator carries the foot
  to the next plant.
- **Head look-at**: 1-2 segment aim toward the wander target (or the camera,
  toggle) with clamped angles and damped tracking.
- **Wound clutch** (the flourish): a fresh big torso wound makes the nearest
  surviving arm reach and press against it for a beat (FABRIK arm chain,
  target = `woundWorldPos`), then release back into the gait. Gated to
  blast-sized wounds; one clutch at a time; interrupted by stagger.
- FABRIK is iterative position adjustment — implement over the rig's particle
  chains directly; no rotations, no quaternion IK needed.

## 3. Wander controller (`wander.ts`, pure)

- Picks random points in the arena, turns with a heavy damped lean, shambles
  between them; pauses idle beats. Toggleable (default on), speed a constant.
- Panel toggle + `__sdfLab.setWander(on)`.

## 4. Hit-stagger (`stagger.ts`, pure)

- Escalates `impulseAt` into a whole-body reaction scaled by the wound
  profile: **pellet ⇒ flinch** (shoulder/torso twitch, one beat);
  **blast ⇒ directional lurch** — root displaced along the shot direction, a
  recovery step (IK foot re-plant), gait phase knocked out of sync and
  recovering over ~1s. Burns ⇒ a shudder.
- Stagger composes with locomotion (lurch mid-stride reads as stumbling) and
  interrupts wound-clutch.
- Displacement magnitudes, recovery times exported as tuning constants.

## 5. Collapse (`collapse.ts`, pure)

- **Triggers**: both legs severed (instant); accumulated **damage meter**
  (wounds weighted by profile radius; severed limbs weigh heavily) crossing a
  threshold; `K` key (testing). One leg severed ⇒ the hop-limp gait state,
  not collapse.
- **The fall**: rest-pose pull releases; gravity takes the rig particles;
  floor contact + the rig's existing distance constraints (plus a few added
  joint-limit constraints) keep the crumple body-shaped. Reuse the chunk
  stepper's restitution/friction constants for ground feel. Settled corpse
  keeps wounds/gore and can still be shot, severed, and gibbed (all existing
  systems read the posed prims — they keep working on a body that happens to
  be horizontal).
- Hand-rolled first (~20 particles + constraints we already have). If
  stability fights back: box3d's soft-step solver notes are the reference,
  and embedding its WASM build is the recorded fallback — decide by evidence,
  not preference.

## 6. Testing

- Pure-module units: gait phase math and state skews; FABRIK convergence on
  2-bone chains (target reachable/unreachable/clamped); foot-plant lock during
  stance; stagger decay curves and profile scaling; wander turn damping;
  meter accumulation and thresholds; collapse trigger matrix (legs/meter/K);
  hop-limp state transitions. All seeded/deterministic.
- Visual (WebGPU lab): shamble reads claymation-heavy; feet plant without
  skating; blasts stagger directionally; sustained fire kills; legless bodies
  fall and the corpse remains fully gib-able; wound-clutch fires on chest
  blasts.

## Out of scope

- Game-side AI/locomotion hookup (the game drives real pathing later).
- Skeleton reveal (X1.20, next after this), cloth, sound.
- Any HP/game-balance semantics beyond the lab's damage meter.
