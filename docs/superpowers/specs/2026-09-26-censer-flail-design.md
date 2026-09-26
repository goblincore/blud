# The censer flail (first player melee weapon) — Design

**Date:** 2026-09-26 · **Status:** decisions approved (owner, 2026-09-26)
**Resolves:** the Wake's open starting-weapon question
([design §3](../../game/levels/00-the-wake/design.md)) and task W-B4 (melee prototype), with a
weapon none of the listed candidates were: a **funeral censer (thurible) on a chain, knotted to a
broken brass altar candlestick**. Brainstorm screens: `.superpowers/brainstorm/` (gitignored).

## 1. What it is

The player's melee weapon is a brass thurible, still burning, swung as a flail. Its head is a
sphere, and every wound in the game is a sphere, so a hit maps straight onto the existing wound
pipeline: **a crater that drags into a furrow along the swing** (the "carve"). Where the weapon
sits in the free-aim dead zone picks the stroke direction; holding the button spins the censer
overhead to charge a heavy slam.

**What it does to a body that nothing else does** (the vision doc's test): a directional gouge
that shows which way you swung. The shotgun makes round craters, dynamite blasts and gibs, and the
chainsaw (mid-episode) will make a continuous cut. A blunt, momentum-driven furrow is none of those.

## 2. Decisions (owner)

1. **Weapon: the censer flail** (chosen over the axe, shovel and pickaxe). It fits the crater
   wound system directly.
2. **Control: hybrid.** Authored handle strokes; a physically simulated head; tap = quick stroke,
   hold = overhead spin that charges, release = heavy stroke. Stroke direction comes from the
   weapon's position in the dead zone.
3. **Head simulation: a single rope pendulum** (one point mass on an inextensible rope that can go
   slack). The chain is drawn, not simulated. A full link chain can replace it later behind the
   same interface.
4. **Wound: crater + gouge (option B) first; embers on charged strikes (option C) when time
   allows.**
5. **Look: the censer on a broken altar candlestick** (brass haft, brass head, one-handed).

## 3. Controls and swing feel

All numbers are starting defaults, tuned in play.

### 3.1 Stroke direction

Let `d` be the weapon's offset inside the dead zone, normalised so the dead-zone edge is 1
(from `ctx.weapon.aim` and `FREE_AIM` in `free-aim.ts`). The stroke runs **from the weapon's side
toward the opposite side**:

| Weapon position | Stroke |
| --- | --- |
| high | overhead slam (top → down) |
| low | uppercut (bottom → up) |
| right / left | hook back across |
| diagonals | diagonal strokes |
| centred (`|d| < 0.25`) | the default forehand diagonal (upper right → lower left) |

Directions blend continuously: one canonical stroke arc, rotated by `atan2(d.y, d.x)`, with the
centred default taking over smoothly inside the 0.25 radius. The direction is read **at release**
(for a tap too, which is under 0.18 s after the press), so during a charged spin the player can drift
the weapon to aim the slam.

### 3.2 States and timing

`idle → (press) → pending → tap stroke` if released before 0.18 s; otherwise
`pending → windup (spin) → (release) → heavy stroke → recover → idle`.

| Phase | Duration |
| --- | --- |
| Tap stroke | 0.22 s |
| Tap recover | 0.35 s (≈0.57 s full cycle) |
| Hold threshold | 0.18 s |
| Spin charge 0 → 1 | 1.0 s (the spin can be held at full charge indefinitely) |
| Heavy stroke | 0.28 s |
| Heavy recover | 0.50 s |

**Revised 2026-09-26 (swing power).** The first cut (a 0.64 m smoothstepped sweep, a 10 cm spin
circle) measured tap 2.9 and heavy 2.5 m/s in the pure model; a flail's speed comes from rotation.
Now (`CENSER_SWING` in `censer-swing.ts`):

- **Stroke:** the handle swings on an arc about a shoulder pivot (level with the eye plane, 20 cm
  under the eye, off the right shoulder; radius 0.57 m) in the plane of the stroke direction and
  forward — a tap sweeps 146° (−61° → +85°), ramps up fast, cruises, and brakes over its last 12% so
  the head whips past the stopped hand. The chain stays reeled in while the hand gets the head
  moving and pays out through the cruise (paying out first leaves it slack and costs ~2 m/s). The
  hand holds its follow-through for half the recover so the whip plays out in front.
- **Spin:** the hand first chokes up on the chain, then whirls a 23 cm circle **in the stroke
  plane** (a windmill, same sense as the stroke; the plane follows the aim at ≤ 5 rad/s) at
  1.2 → 2.9 Hz, paying the chain out so the head flies onto a wide orbit (10+ m/s by full charge).
  A small hand circle alone never gets there: driven above the pendulum's natural frequency the head
  settles into a small anti-phase wobble.
- **Heavy:** an 85° arc with the wind-up circle carried on under it and fading out, so a release at
  any spin phase keeps the orbit's speed; partial charges blend the tap's arc into the heavy's.
- The handle never exceeds the 3.5 cm-per-240 Hz-step pop bound (≈ 8.4 m/s); the extra speed is
  the chain's. Pure-model peaks: tap 13, half 17, full 21 m/s (14–21 over the release phase,
  sampled finely), fastest 1.1–1.4 m in front of the eye.
- **Revised 2026-09-26 (Task 9, in-game).** Two fixes so the game matches the model: the swing's
  excursion is un-squeezed from the view model's FOV-compensation rig (it had shrunk the arc ~26%:
  tap 8.6 in game vs 13), and **the hand holds the chain**: it grips (damps the head relative to
  the hand) from the press through the choke-up, and during the wind-up a wrist floor holds the
  head's speed round the knot, in the stroke plane, to ≥ 2 → 9 m/s by charge. Without them a wind-up
  pressed while the head still swung from the last stroke could miss its orbit (full charge at
  2–5 m/s: 4 of 13 in game). In game now: tap 13–14, full charge 13–20 m/s by release phase.

### 3.3 Impact

| | Tap | Charged (full) |
| --- | --- | --- |
| Head speed at contact (target) | ~9 m/s | ~16 m/s |
| Crater radius | 0.06 m | 0.11 m |
| Gouge | ≤ 3 spheres | ≤ 6 spheres |
| Hits to sever a limb / the neck | ~3 | 1 |
| Hit-stop + camera kick | 30 ms, small | 70 ms, heavy |
| Zombie reaction | flinch | stagger + shove ≈ 1 m |

Partial charge interpolates between the two columns. Reach: rope 0.55 m plus the arm, ≈ 1.6 m from
the eye (just outside a zombie's bite).

### 3.4 Rules

- The player can walk while swinging and spinning; no stamina.
- Camera turning past the dead zone keeps working during the spin.
- Switching weapons mid-spin cancels the charge; dying cancels everything.

## 4. Architecture

Logic lives in pure, renderer-free modules (per the [plan template](../plan-template.md)); the game
side only wires them in.

### 4.1 Pure modules (`src/lab/sdf-zombie/webgpu/`, beside `free-aim.ts` and `game-weapon-slots.ts`)

| Module | Owns | In → out |
| --- | --- | --- |
| `censer-swing.ts` | The state machine (§3.2), stroke direction (§3.1), the handle keyframe tables, charge | button edges, `dt`, dead-zone offset → phase, charge, handle pose (position + rotation in view space) |
| `censer-head.ts` | The rope pendulum | handle anchor position (world), `dt` → head position, velocity, rope taut/slack. Fixed timestep with substeps; gravity; light damping; energy loss on contact via `absorb(impulse)` |
| `censer-hit.ts` | Turning head motion into wound spheres | head segment per substep, per-actor SDF query → hit events (crater, gouge spheres, contact normal, speed into the surface) |

**`censer-hit.ts` in detail.** Each substep, the head's previous → current segment is swept
against each nearby actor with the existing `traceProjectile(from, to, q => sdBody(q, posed))`
(`game-weapon.ts`), behind the torso-sphere broad phase the pellet loop uses.
- **First contact** with an actor this stroke: a crater sphere at the hit point. Radius and depth
  scale with the head's speed along the surface normal (§3.3 table).
- **While the head stays inside** (`sdBody < 0`): stamp a gouge sphere every 3 cm of travel, each
  ×0.8 the previous radius, up to the per-stroke cap (3 tap / 6 charged). The gouge ends when the
  speed into the surface falls below a threshold or the head exits.
- **Energy loss:** each stamp calls `censer-head.absorb`, so the head slows and bounces out rather
  than passing through.
- **Once per stroke per actor:** a second actor in the same stroke is hit with the remaining speed.
- **The hit window is the stroke and its recover** (same stroke id): the head lags the handle, so
  its fastest moment often comes after the handle has stopped.

### 4.2 Wounds

- **No new wound type** (revised 2026-09-26, planning). Craters and gouge spheres are ordinary
  `'blast'`-type sphere wounds (the blast profile's tamed rim suits a blunt crater), resolved with
  `worldHitToWound` against the actor's posed body and carrying `severRadius`. They go in through
  the actor's existing **`blast(effect)`** path, which already credits the collapse meter with a
  direct `meterCredit` (so the meter's by-type weighting is sidestepped; gouge spheres credit a
  quarter of their crater) and already runs the sever checks: a crater plus gouge across a joint
  covers its cross-section and `runSeverChecks` cuts it. A new `WoundType` would have touched the
  shader's type ids; this touches nothing on the GPU.
- `ActorBlastEffect` gains an optional **`reaction: 'blast' | 'flinch' | 'none'`** (default
  `'blast'`, today's behaviour): a tap sends `'flinch'` (a pellet-class signal, no knock), a charged
  strike `'blast'` (stagger + knock), and gouge-only batches `'none'`.
- **Wound budget:** a gouge uses up to 7 slots per hit. `MAX_WOUNDS` **stays 16** for v1; gouge
  spheres closer than half the smaller radius to the previous one are **merged** (skipped). Raising
  the cap is a feel/perf decision for after play (owner, 2026-09-26: tune performance by how it
  feels); `scripts/sdf-game-melee-bench.sh` measures it when it comes up.

### 4.3 Game wiring (`src/lab/sdf-zombie/webgpu/`)

- **Slot:** a new `'censer'` `WeaponSlot` in `game-weapon-slots.ts`, bound to **key 1**; shotgun,
  dynamite and flare move to 2, 3 and 4. The existing `'melee'` pickup grants it (`pickups.ts`,
  `ownsSlot()`); the Night Train loadout starts with it. The holster uses `slotLowerAmount()` like
  the other slots.
- **Leaf:** a `game-censer.ts` modelled on `game-flare.ts` (the minimal slot template: mouse edges,
  cooldown, per-frame update). It runs `censer-swing`, feeds the handle's world anchor into
  `censer-head`, runs `censer-hit` against actors, and applies results.
- **View-model:** the haft is parented to the existing `aimRig`, so bob, slide and the dead-zone
  pivot apply as for the shotgun; the swing's handle pose is added on top. The head and chain are
  **world-space** (they must swing through the world, not stick to the camera), drawn in the
  view-model pass so they are not clipped by near geometry. The right goblin arm follows the haft
  with `aimArms`; the left arm drops out of view.
- **Feedback:** hit-stop freezes the simulation clock for 30–70 ms; a camera kick via the existing
  recoil spring; actor flinch/stagger/shove via the signals `applyProjectileHit` already sends,
  scaled by head speed.
- **The world:** the head also sweeps against level collision and stops at walls and the floor
  (no world wounds in v1).
- **Seams for testing:** `__sdfGame.censer = { press, release, setDeadzone(x, y), state() }`.

### 4.4 The model

A Blender Python script, `scripts/model_censer.py` (like `model_grapeshot_shorty.py`), writes
`public/assets/lab/censer.glb` with named nodes:

| Node | Use |
| --- | --- |
| `Haft` | the snapped brass candlestick (the grip, parented to `aimRig`) |
| `ChainAnchor` | the knot at the top of the haft; the pendulum's pivot |
| `Head` | the thurible: domed, pierced lid over a bowl, three short chains to a ring |
| `ChainLink` | one link, instanced ≈ 12 times along the chain curve |
| `CoalGlow` | an emissive core that shows through the lid's piercings |

**The chain** is drawn as links placed along a quadratic curve from `ChainAnchor` to the head's
ring. The curve sags by the rope's slack (rope length minus anchor–head distance) and goes straight
when taut. **Smoke:** a thin incense trail of a few camera-facing puffs behind the head, stretched
into a ring during the spin. The coal glow is emissive only in v1.

## 5. Scope

**v1 (this spec):** §3 in full; the three pure modules; the actor `reaction` option; crater + gouge with
gouge merging (cap stays 16); hit-stop, camera kick and actor reactions; the slot, pickup and key
binding; `censer.glb` with the chain, coal glow and smoke trail.

**Later, in order of value:**
1. **Embers (option C).** A charged strike bursts 2–4 `burn` wounds scattered near the crater, with
   an ember particle burst. Setting the zombie fully alight (the fire system exists) after that.
2. **The censer as a light.** A flickering point light in the head, once the
   [dynamic-light work](2026-09-26-night-train-dynamic-light-design.md) lands; the censer lights
   the crypt.
3. **The spin as a fend zone.** The spinning head damages anything that walks into it.
4. **Severed limbs as physical debris you can knock about** (owner likes it; its own TASKS item).
5. **A simulated link chain** that wraps around arms, behind the `censer-head` interface.
6. **World dents** where the head strikes walls.

## 6. Edge cases

- **Fast strokes and thin limbs:** fixed-step substeps (≥ 240 Hz) and swept segments per substep,
  so a 16 m/s head cannot skip a forearm.
- **Several zombies in one stroke:** each is hit at most once per stroke, with the speed left after
  the previous hit.
- **Head inside a body at stroke start** (the zombie is hugging the player): no hit until the head
  has left the body once, so a resting head does not stamp wounds.
- **Frozen/paused game:** the pendulum uses the simulation clock, so freeze, hit-stop and pause stop
  it too.
- **Dead or collapsed zombies** take hits like live ones (carving a corpse is part of the fun); the
  collapse meter already clamps.

## 7. Testing

**Unit tests (vitest), one file per pure module:**
- `censer-swing`: tap vs hold at the 0.18 s threshold; the charge ramp and cap; direction read at
  release; each dead-zone region maps to the stroke in §3.1, and the centre blend is continuous;
  weapon switch cancels.
- `censer-head`: the rope never exceeds its length; it goes slack when the anchor moves toward the
  head; with damping and no input, energy decreases; `absorb` reduces speed; results are the same
  for different frame `dt` splits (fixed step).
- `censer-hit`: against an analytic sphere/capsule field: a crater at first contact scaled by
  normal speed; gouge spheres follow the direction of travel and shrink by ×0.8; the cap holds;
  the gouge ends below the speed threshold; once per stroke per actor; merging works; no hit when
  the stroke starts inside the body.

**In-game gate, `scripts/censer-gate.mjs`** (the `bride-melee-gate.mjs` pattern), with a zombie
frozen in a set pose via `__sdfGame.freeze/setPose`:
- a tap from each of the 4 main dead-zone positions lands a wound, and the gouge points along the
  expected stroke direction;
- one charged overhead slam to the neck severs the head;
- three taps to the upper arm sever the arm;
- negative control: a stroke that misses leaves no new wounds.

**Photo strips** of each stroke direction and of a tap vs a charged gouge, for the owner to judge
the look. The feel (timing, weight, hit-stop) is judged in play, not claimed from tests.

## 8. Open (for the plan)

- The head and chain draw in the main scene (world space, like any prop); the gate's photos show
  whether they read correctly against flesh while gouging.
- Final tuning of rope length, stroke keyframes and gouge thresholds (in play).
