# The melee head damage model (zombie, flail) — Design

**Date:** 2026-09-28 · **Status:** approved, not built · plan `docs/superpowers/plans/2026-09-28-melee-head-damage.md`
**Follows:** [the spike flail](2026-09-26-spike-flail-design.md) §12.6. Branch `claude/melee-weapon-design-7d1423`
(PR goblincore/blud#22).

## 1. What it is

A flail hit to a zombie's head does more than add a crater:
- The head **squashes and wobbles like jelly** on every hit.
- It **keeps dents** where it was hit.
- It goes through four comic, gory stages: **an eye pops out** on a stalk, **the face caves in**, **the scalp
  tears** to show the skull, then **the skull smashes and the brain flies out**.

The fourth head hit kills the zombie. The flail still never takes the head off.

## 2. Decisions (owner, 2026-09-28)

1. **The ladder:** eye → cave → skull → brain. The brain coming out is the head kill, on the 4th head hit.
2. **The eye dangles, then snaps.** It springs out and hangs by its stalk. The next head hit snaps the
   stalk and flings the eye off as a gib.
3. **The head wobbles like jelly and keeps lasting dents.**
4. **Hybrid placement.** The head hit count picks the stage. The hit picks the details: which eye pops, and
   where the dent goes. The scalp tear and the brain always come out of the **crown**, wherever the hit
   lands. That is the fudge that makes the crown reachable.
5. **The cultist's inflate-and-pop is not reused as a look.** Only its mechanism is reused: reshaping the
   posed head each frame.

## 3. What exists (explored 2026-09-28)

- **Per-frame posing.** `game-actor.ts` poses the body every frame (`posed = applyRig(current, bound,
  bodyYaw)`), and `view.update` re-packs and uploads every prim every frame (`zombie-gpu.ts upload`).
  - Reshaping the posed head prims each frame costs only the JS map.
  - The face projection (`headShape(drawnBody())`) and the wounds (`woundWorldPos(posed.prims, …)`) follow
    the reshaped prims.
  - The cultist's `head-pop.ts inflateHead` hooks in at exactly this point, between `applyRig` and
    `view.update`.
- **The zombie's eyes are texture,** not prims. `face.ts` emits only the head, jaw, brow and nose prims. The
  red glow is the face sheet's luma cutoff, `faceGlow` in `march/body/face.wgsl.ts`, tinted by
  `faceGlowColor` (1.9, 0.012, 0.005).
- **The skull:** hidden bone prims, the cranium and the jaw (`zombie.blob` `bones`), revealed by head wounds.
  The shipped skeleton is `skeleton=mesh`: segment meshes revealed through `segMeshRenderer.setWounds`.
- **Gore pieces:**
  - `GorePiece` is a list of world-space prims plus velocity and angular velocity, dispatched through
    `ctx.boot.onGoreDispatch(a, pieces)` → `spawnChunkPiece` (floor bounce, spin).
  - `head-pop.ts headPopDebris` already builds 2.5× eyeballs: a white, a glowing iris, a pupil, and a bent
    optic-nerve capsule. It also builds brain lumps (`GORE_COLORS.brain`).
  - `headPopShowcase` shows a gore dispatch works without a pop.
- **Wounds:** a flat ring of `MAX_WOUNDS` 16 per actor, oldest evicted first (`damage.ts pushWound`).
- **No per-prim spring or jiggle** exists for heads today.

## 4. The ladder

The ladder is driven by the flail's existing per-actor `headHits`. A head-region hit is one on a head prim,
within 0.25 m of the head centre, or within 0.2 m of the neck root (flail spec §12.3).

| Head hit | Stage | What happens |
| --- | --- | --- |
| 1 | **EYE** | The eye on the hit's side pops (§6). Its socket gets a small deep crater, which reads as an empty socket and erases that eye's painted glow. |
| 2 | **CAVE** | A lasting dent at the hit point (§5) and a 0.06 m face crater there. The dangling eye's stalk **snaps**, and the eye flies off as a gib. |
| 3 | **SCALP** | A ragged tear across the crown: two overlapping craters on the crown, deep enough to expose the cranium bone. |
| 4 | **BRAIN** | The crown bursts. A whole-brain gib, brain lumps, skull chips and blood fly up and out along the blow. The crown crater deepens into an open cavity. The zombie **dies**: its collapse is forced (`collapse.ts` `sig.forced`). |

- Hits past 4 on a dead or collapsing zombie get only the wobble and a face crater.
- Every head hit also gets the jelly wobble (§5).
- Every head hit keeps the flail's collapse credit, so body and head hits mix: 3 body hits then 4 head hits
  still kills on the 4th head hit.

## 5. Wobble and dents (`head-deform.ts`, pure)

The head's deformation state per actor:
- `wobble`: a damped spring. Its value `s(t)` is a signed squash amount along a unit axis `n`, the blow's
  direction in the head's frame.
- `dents`: up to **3** lasting dents, each `{ at: head-local point, dir: head-local inward unit, depth }`.

**On a head hit:**
- The spring is kicked: `s = +squash0` (**0.25**).
- The axis `n` is set to the blow's direction.
- If the stage adds a dent (stage CAVE, or any hit after 4), push `{ at, dir, depth: 0.018 m }`.
- A dent within **0.05 m** of an earlier dent deepens it by 0.012 m instead, capped at **0.04 m**.

**Each frame:**
- The spring decays: an underdamped oscillator at **8 Hz**, damping ratio **0.25**, so it settles in about
  0.5 s.
- The live head prims are mapped (limb `head`, not `sub`/`dead`/bone/organ):
  - **Squash:** scale each prim's `a`, `b` and radii about the head centre by `1 − s` along `n` and
    `1 + s/2` across it. Volume-preserving in feel, clamped `s ∈ [−0.3, 0.3]`.
  - **Dents:** move each prim endpoint within `falloff` (**0.07 m**) of a dent's `at` along the dent's `dir`
    by `depth · (1 − d/falloff)²`. A prim whose centre is within `falloff` also shrinks its radius by the
    same amount times 0.5, so the dent reads as pushed-in flesh, not a bent capsule.
- The mapping is a pure function `deformHead(posed, state, headFrame) → posed`, like `inflateHead`. It runs
  in the actor's step between `applyRig` and `view.update`, only for actors with a deformation state.

## 6. The eye pop (`head-eye.ts` pure, drawn by `game-head-damage.ts`)

- **Eye positions.** The zombie's face-sheet eye centres, in head-local coordinates, are a per-character
  constant, `HEAD_EYES.zombie = { L, R }`. It is measured once from the face projection: the eye texels'
  centroid, projected onto the head surface. The measurement is recorded in NOTES.
- **Which eye.** The eye whose world position is nearer the hit point.
- **The socket.** A crater of radius **0.028 m**, typed `'blast'`, at that eye's surface point, with a deep
  carve. It uses the head crater slots (§8).
- **The dangling eye:**
  - **The eyeball:** 2.5× life size (`EYEBALL_R` 0.030 from `head-pop.ts`). A shiny white, a glowing red iris
    (`faceGlowColor`'s hue) and a dark pupil. It is drawn as a small SDF gore piece that we pose ourselves
    each frame; it is not a free chunk.
  - **The stalk:** a pink, glossy optic-nerve rope of **6 nodes, 0.14 m** long. It is simulated with the
    flail's chain solver (`flail-chain.ts`), in world space at 120 Hz. Node 0 is pinned to the socket, which
    moves with the head: posed and wobbling. The last node is the eyeball. It has gravity, damping, and a
    spring-out kick on the pop (the eye leaves the socket along the blow's reflected direction at about
    2.5 m/s, then swings).
  - **Drawing:** the stalk is 6–10 short tapered capsules (pink: a new `GORE_COLORS.nerve`,
    `#e89aa6`) and the eyeball prims. They are drawn through the same path the gore chunks use.
    Choosing between a new per-actor "attachment" view and chunk views posed by hand is a planning question.
    The constraint: the look must match `head-pop.ts`'s eyeball, and it must cost at most **1 extra draw per
    dangling eye**.
- **The snap (head hit 2, or the zombie's death).** The eyeball and the stalk's free half become one
  `GorePiece` with the eyeball's current velocity plus a kick. It is dispatched through `onGoreDispatch`,
  bounces and settles like other gibs, and the dangling attachment is removed.

## 7. Skull and brain (`head-crown.ts` pure)

- **The crown.** The head-local point at the top of the head (the head cluster's centre plus the head's up
  axis times its measured half-height), and its outward normal.
- **SCALP (hit 3).** Two craters on the crown, each **0.05 m**, 0.035 m apart across the head's left–right
  axis, deep enough to reach the cranium. The skull must show on the shipped `skeleton=mesh` path
  (`segMeshRenderer.setWounds`) **and** on the procedural bone path. The gate photographs both.
- **BRAIN (hit 4):**
  - The crown craters grow into one **0.08 m** open cavity.
  - Gore dispatched up and along the blow:
    - one **whole brain**: a new `brainPiece()` of about 8 prims, two hemispheres of wrinkled lobes built as
      bent capsules in `GORE_COLORS.brain`, with a darker fissure and a stem. It launches at about 3.5 m/s
      with a spin, the "whole brain flies out" beat;
    - 3–4 brain lumps (the existing kind);
    - 3 skull chips: small bone-coloured flat ellipsoids;
    - a blood burst from the existing blood sim.
  - Then the forced collapse (§4).

## 8. Head crater slots

- The head's craters (the socket, CAVE's crater, the two scalp craters, the brain cavity, and later face
  craters) must not evict body wounds.
- The head keeps at most **5** craters of its own:
  - SCALP's two craters merge into BRAIN's cavity;
  - later face craters replace the oldest face crater.
- A plain wound ring cannot express that. The plan decides the mechanism, with this constraint: an actor
  with 5 head craters and 11 body wounds keeps all 16 visible, and a 6th head crater evicts only a head
  crater. The two options are a head-owned slot range inside the 16, or a per-region eviction rule in
  `pushWound`.

## 9. Architecture

Logic lives in pure, renderer-free modules with tests (the plan-template rule). The game leaves only read
their output.

| File | Job |
| --- | --- |
| `src/lab/sdf-zombie/head-damage.ts` (pure) | The ladder. `HeadDamageState` per actor: `{ hits, stage, eye: 'L' \| 'R' \| null, eyeState: 'socket' \| 'dangling' \| 'gone', dents, crownOpen }`. `headHit(state, hit: { pointLocal, dirLocal }) → { state, events }`, where events are `eye-pop(side)`, `eye-snap`, `dent(at, dir)`, `scalp`, `brain`, `kill`. |
| `src/lab/sdf-zombie/head-deform.ts` (pure) | The spring and dents (§5): `kickWobble`, `stepWobble`, `addDent`, `deformHead(posed, state, frame)`. |
| `src/lab/sdf-zombie/head-eye.ts` (pure) | Eye positions, which eye, the socket crater spec, and the stalk's rope config and pose → prims (`eyePrims(nodes, eyeball)`). |
| `src/lab/sdf-zombie/head-crown.ts` (pure) | The crown point, the scalp crater specs, the brain cavity spec, `brainPiece()`, `skullChips()`. |
| `src/lab/sdf-zombie/webgpu/game-head-damage.ts` | The leaf. Per actor it owns the damage state, the deform hook, the dangling eye (chain sim, drawing) and the dispatches (wounds via `blast()`, gore via `onGoreDispatch`, the forced collapse). `game-flail.ts strike()` calls it for head-region hits instead of stamping a face crater itself. |
| `game-actor.ts` | One hook: an optional `headDeform?: (posed) => posed` applied after `applyRig` in step (the `inflateHead` spot), plus a way to force the collapse (reuse the existing `sig.forced` path). |
| `game-seams-head.ts` | `__sdfGame.head.{ state(id), hit(id, pointWorld, dirWorld) }` for gates, the second to drive stages without swinging. |

## 10. Scope

- **Zombie only; flail only.** The shotgun's head damage is unchanged, as is the cultist's head pop.
- The pure modules take a per-character config (`HEAD_EYES`, crown height), so other characters can opt in
  later.
- **Not in scope:** jaw loss, a second eye, teeth flying, decapitation (the flail never decapitates),
  anything for the shotgun.

## 11. Testing

**Unit (vitest):**
- `head-damage`: the ladder order; the events per hit; the eye side from the hit point; the snap on hit 2 and
  on death; hits past 4.
- `head-deform`:
  - the spring kicks to `squash0`, oscillates at 8 Hz and settles below 1% within 0.8 s;
  - `deformHead` leaves non-head prims identical, moves prims inside a dent's falloff, and leaves ones
    outside it alone;
  - dents merge and cap;
  - a squash along `n` shortens the head along `n` and widens it across `n`.
- `head-eye`: the eye choice; the stalk pin stays exactly on the socket; links hold their length; the eye
  hangs below the socket at rest.
- `head-crown`: the crown point sits on the head's top surface (within 1 cm, on a test head); the brain piece
  is a valid `GorePiece`, and every one of its prims is inside a 0.12 m sphere.
- The crater-slot rule (§8): body wounds are never evicted by head craters.

**Gate (`scripts/head-damage-gate.mjs`, headless, a frozen zombie, crosshair on the head from 0.9 m):**
- hit 1: an eye dangles (its attachment is present; the eyeball is below the socket after 30 frames); the
  socket has a crater; the wobble's peak head squash in frames 1–10 is 15% or more, and it is under 2%
  after 0.8 s;
- hit 2: the eye flew off (its gore piece is dispatched; the attachment is gone); a dent is present (the head
  surface pushed in by 1 cm or more at the dent, sampled by `sdBody` before and after);
- hit 3: the crown craters are present, and the cranium is exposed. A bone-coloured pixel share in the crown
  crop rises on both skeleton paths;
- hit 4: the brain piece is dispatched; the zombie collapses; the head is still on;
- body wounds made before the head hits are all still present;
- zero console errors; frame time with a dangling eye is within 0.5 ms of the same scene without it.

**Photos** for the owner: each stage (`head-1-eye.png` … `head-4-brain.png`) and a strip of the dangling
eye swinging.

## 12. Open for the plan

- Drawing the dangling eye: a new attachment view, or chunk views posed by hand (§6).
- The crater-slot mechanism (§8).
- Measuring the zombie's face-sheet eye centres (§6).

## 13. Plan decisions (2026-09-28, recorded in the plan)

- **Dents (§5).** The zombie's head is a few large ellipsoid prims, so a point dent cannot be expressed by
  moving prim endpoints: it would slide the whole head. A dent **flattens the side that was hit**, along the
  head axis nearest the blow. That side's surface moves in by the depth and the opposite side stays put.
  Dents accumulate per side (x±, y±, z±), capped at 0.04 m. The wobble squashes along the same axes.
- **The stalk (§6)** is its own small verlet rope (`head-eye.ts`), not `flail-chain.ts`, whose node count and
  link lengths are fixed to the flail.
- **Its colour** is a new `GORE_COLORS.stalk` pink. `GORE_COLORS.nerve` already exists as a dark red.
- **The dangling eye** is one hand-posed chunk view, made outside `liveChunks` by `ctx.boot.attachPiece` and
  bent each frame with a new `ChunkGpuView.morph`.
- **Head crater slots (§8).** `Wound.headSlot: 'keep' | 'face'` and `MAX_HEAD_WOUNDS` 5 in
  `damage.ts pushWound`:
  - the socket, scalp and brain craters are `'keep'`;
  - the dent crater and later face craters are `'face'`;
  - the total cap never evicts a `'keep'` crater while another wound remains.

  The scalp craters are not merged into the brain cavity; the counts fit (1 + 1 + 2 + 1 = 5).
- **The eye positions** are measured from `zombie-face.png` through the planar face projection:
  image-left `hs = (−0.498, 0.096)`, image-right `hs = (0.451, 0.179)`.
