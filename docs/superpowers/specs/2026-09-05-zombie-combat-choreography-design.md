# Zombie combat choreography — state machine, melee ring, one-arm hook

**Date:** 2026-09-05
**Status:** approved, awaiting implementation plan
**Page:** `sdf-game.html`
**Predecessor:** [2026-09-04-zombie-crowd-and-brain-design.md](2026-09-04-zombie-crowd-and-brain-design.md)

## Why

The owner played the 2026-09-04 build and reported three things. Two are in
scope here; one is not.

1. **"Multiple zombies surrounding you, their arms clip through each other."**
   With a screenshot. This is the headline defect.
2. **"The current attack animation, both arms raising and slamming down, is
   merely… okay. Maybe just one arm, a slap/hit/punch."**
3. **"They had a lot of trouble navigating and got stuck on the furniture."**
   Real, and NOT fixed here — see *Out of scope*.

The owner also asked for "a more defined set of behaviors, maybe like a state
machine". That is the frame this spec is built on.

## The arm-clipping diagnosis

Separation (`crowd.ts`) treats every body as a 0.35 m ground circle, so two
engaged zombies settle 0.70 m apart — the circles touch and separation reports
itself satisfied. But an arm reaches roughly 0.6 m from the body centre, so at
0.70 m of separation two facing bodies have 0.5 m of mutual arm overlap. The
circles never touch; the arms always do.

Widening the circle would fix it and is the wrong fix: it spreads the pack into
a uniform halo and removes the crowding that makes the encounter work. The
right fix is that not everyone attacks at once, and the ones who do are
angularly spaced. That is a behaviour rule, not a separation tuning — which is
why it belongs in the state machine the owner asked for.

## Out of scope, deliberately

* **Navigation.** Getting stuck on furniture needs a nav grid over
  `levelColliders()` + `FURNITURE`, A*, and path following; cross-room pursuit
  falls out of the same work. It is a separate spec (**A — Navigation**), to be
  built after this one at the owner's direction. The committed-sidestep router
  in `game-actor.ts` stays exactly as it is here; nothing in this spec touches
  it.
* **Player damage.** Still no health, no HUD, no death — unchanged from the
  predecessor spec. The swing remains choreography.

## Architecture

One rewritten pure module, one new pure module, one rewritten pure module, and
the corresponding wiring.

```
game-main tick
  ├─ playerRoomId() + setBrainInput per actor           (unchanged)
  ├─ meleeRing.arbitrate(player, claimants)  ← NEW, crowd-level
  │     └─ per-actor: token? assigned angle? ring radius?
  ├─ crowd.separate(...) → actor.nudge(...)             (unchanged mechanism)
  └─ actor.step(dt)
        └─ stepBrain(...)   ← now a 7-state machine, consuming the ring verdict
              └─ cfg.attack = { phase, side }  → attackPose → motion.ts
```

### 1. `brain.ts` — a named state machine

Replaces `BrainMode = 'wander' | 'chase' | 'attack'` and its three ad-hoc
overrides. The overrides are the reason for the rewrite: the `engaged`
hysteresis latch, the "a committed swing always finishes" early return, and the
blast hold — which today lives *outside* the brain entirely, as `holdSecs` in
`game-actor.ts` gating `cfg.wander` — are three different mechanisms doing the
same job badly. As states they are one mechanism.

```ts
export type BrainState =
  | 'idle' | 'pursue' | 'encircle' | 'engage' | 'attack' | 'recover' | 'stagger';
```

| state | behaviour | leaves when |
|---|---|---|
| `idle` | wanders; `target` null | notices the player → `pursue` |
| `pursue` | walks at the player | within `engageRange` → `engage` if it holds a token, else `encircle` |
| `encircle` | holds `outerRadius`, drifts tangentially toward the nearest angular gap | granted a token → `engage`; player lost → `idle` |
| `engage` | closes to `meleeRadius` | at `meleeRadius` and `cooldown ≤ 0` → `attack`; token revoked → `encircle` |
| `attack` | swinging; locomotion halted | `swingT ≥ 1` → `recover` |
| `recover` | holds position, cooldown running | `cooldown ≤ 0` → `engage`; token revoked → `encircle` |
| `stagger` | blast hold: locomotion off, lurch plays | `holdSecs ≤ 0` → `pursue` (or `idle` if not alert) |

`stagger` outranks everything: a blast hit forces it from any state, and it
drops the token on entry (a staggering body must not keep a melee slot it
cannot use). `attack` is the only other state that cannot be interrupted by
arbitration — a committed swing finishes, which is now expressed as "the ring
may not revoke a token from a body in `attack`", not as an early return.

Aggro (same room, 70° cone, gunshot bypass, 4 s lose-grace) is unchanged and
keeps its own `alert` / `lostFor` fields. `BLAST_HOLD_SEC` moves from
`game-actor.ts` into `BRAIN_TUNING`; `game-actor` reports the hit to the brain
through the input struct instead of holding its own timer.

New tuning:

| knob | value | meaning |
|---|---|---|
| `meleeRadius` | 1.0 m | where a token holder stands (== the old `attackRange`) |
| `outerRadius` | 1.8 m | where a waiter holds |
| `engageRange` | 2.6 m | `pursue` → ring states |
| `releaseRange` | 3.2 m | back to `pursue` (hysteresis) |
| `blastHoldSec` | 0.55 s | moved from `game-actor.ts` |

### 2. `melee-ring.ts` — token arbitration (new, pure, crowd-level)

```ts
export interface RingClaimant {
  id: number;
  x: number; z: number;
  /** True while this body may not have its token revoked (state === 'attack'). */
  committed: boolean;
  /** True if it held a token on the previous frame — incumbency. */
  incumbent: boolean;
}
export interface RingVerdict {
  /** ids granted a token this frame. */
  holders: Set<number>;
  /** Per non-holder: the tangential direction to drift, -1 or +1, toward the
   *  nearest angular gap; 0 when it is already in a gap. */
  drift: Map<number, -1 | 0 | 1>;
}
export function arbitrate(
  player: { x: number; z: number },
  claimants: readonly RingClaimant[],
  tuning?: RingTuning,
): RingVerdict;
```

**Angles are bearings, not slots.** The obvious design — fixed slots at 0°/90°
around the player — rotates the whole ring when the player turns, so zombies
would orbit as the owner looks around. Instead each claimant's angle is simply
`atan2(x - px, z - pz)`, its *current* bearing. Nobody walks to a slot; bodies
attack from where they already are, and arbitration only decides who may.

Rules, applied in this order (deterministic; ties broken by ascending `id` so
the same input always yields the same verdict):

1. Every `committed` claimant keeps its token unconditionally.
2. Then `incumbent` claimants, nearest first, while a token remains and their
   bearing is `≥ minSlotAngle` from every already-granted holder.
3. Then everyone else, nearest first, under the same angular test.
4. Non-holders get a `drift` of -1/+1 toward the nearer edge of the nearest
   angular gap wide enough to hold a token (`≥ 2 × minSlotAngle` from a
   holder), or 0 if they already stand in one.

| knob | value | why |
|---|---|---|
| `tokens` | 2 | owner's call. With no player health, more attackers add noise, not danger |
| `minSlotAngle` | 90° | two holders 90° apart at `meleeRadius` 1.0 m are **1.41 m** apart — clear of two 0.6 m arm reaches with 0.2 m of margin. 75° would give 1.22 m, which only just clears |

**Incumbency is load-bearing.** Re-arbitrating from scratch every frame makes
tokens flicker between bodies at nearly equal distance, and the resulting
start-stop is far uglier than the clipping this fixes.

### 3. Engaged separation radius

Belt-and-braces for the moment of arrival, before arbitration has settled:
`crowd.ts` is unchanged, but `game-main` submits a body in `engage`/`attack`/
`recover` with `r = 0.55` instead of `0.35`. The angular rule is the structural
fix; this catches the transient.

### 4. `attack.ts` — the alternating one-arm hook

The current pose raises both arms and slams them down, driven by one signed
scalar and a single `reachPitch` applied to both arms. The replacement:

* The **swinging arm** takes a pitch (raise on the wind-up) *and* a yaw (sweep
  across the body on the strike) — the yaw is what makes it a hook rather than
  a chop.
* The **off arm** counter-swings low and slightly back.
* **Torso twist** is faked by offsetting the two shoulders in opposite `x`
  directions, with the chest leading.
* The **root lunge** stays but drops from 0.22 m to ~0.14 m: the rotation now
  carries the weight, and the old lunge on top of a hook reads as a stumble.
* `side` **alternates** per swing, so a stalled pack does not metronome.

```ts
export interface AttackPose {
  offsets: Partial<Record<GaitJointName, Vec3>>;
  rootOffset: Vec3;
  /** Per-side reach-pivot deltas: pitch about the body's right axis (as
   *  today), yaw about world up (new — the hook's horizontal sweep). */
  reach: { pitchL: number; pitchR: number; yawL: number; yawR: number };
}
export function attackPose(phase: number, side: 'L' | 'R', tuning?): AttackPose;
```

`attackPose(0, side)` and `attackPose(1, side)` stay exactly zero, so the pose
still enters and leaves the gait without a discontinuity.

### 5. `motion.ts` — the reach pivot gains a second axis

`MotionConfig.attack` changes from `number` to
`{ phase: number; side: 'L' | 'R' }`. Inside the reach-style arm pivot, the
attack's per-side pitch is added as today, and a **second quaternion about
world up** by the per-side yaw is composed onto the same segments.

**The bit-identity contract is unchanged and still pinned.** `cfg.attack`
`undefined` takes the identical branch it takes today; the lab's wiring never
sets it. The existing 30-frame exact-pose test stays as written.

## Testing

* **melee-ring** — never grants more than `tokens`; a second grant closer than
  `minSlotAngle` to a holder is refused; a `committed` claimant keeps its token
  even when a nearer body wants one; an `incumbent` beats an equally-placed
  newcomer; drift points toward the nearer edge of the nearest usable gap and
  is 0 for a body already in one; identical input yields an identical verdict
  twice; zero claimants and one claimant are handled.
* **brain** — every transition in the table above, driven one at a time; a
  blast forces `stagger` from each of the other six states and drops the token;
  a body in `attack` is not moved by a revoked token; aggro (cone, gunshot
  bypass, lose-grace) still behaves exactly as the predecessor spec's tests
  assert — those tests are carried over, not rewritten.
* **attack** — zero at phase 0 and 1 for both sides; `side: 'L'` and
  `side: 'R'` are mirror images in `x` and yaw; the yaw peaks on the strike and
  the pitch on the wind-up; finite across a swept phase; the off arm's
  magnitude is below the swinging arm's throughout.
* **motion** — the existing bit-identity pin, unchanged; plus: a `side: 'R'`
  swing moves the right hand further than the left, and vice versa.

## Verification

The existing `scripts/sdf-game-crowd-gate.mjs` grows three checks, all of which
must be shown to fail with arbitration disabled:

1. **`minHandGap`** — a new `__sdfGame.minHandGap()` seam returning the closest
   distance between hand/forearm prims belonging to *different* bodies, sampled
   across the melee window. This gates the owner's actual complaint: arm
   clipping stops being something we look at and becomes a number. Floor:
   greater than 0 (no interpenetration) with margin.
2. **Token cap** — never more than `tokens` bodies in `attack`-family states.
3. **Angular spacing** — any two token holders' bearings differ by at least
   `minSlotAngle`.

Plus captures for the owner's eye: a raised view of four bodies ringed around
the player with two engaged and two waiting, and an FPV frame of a hook at
`swingT` mid-strike — captured in flight, with the same
"fail if the swing already ended" guard the current gate has.

Frames and notes land in `docs/dev-notes/2026-09-05-zombie-choreography/`, and
`TASKS.md` gets the row.
