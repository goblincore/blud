# Zombie crowd separation + chase/attack brain — design

**Date:** 2026-09-04
**Status:** approved, awaiting implementation plan
**Page:** `sdf-game.html` (`src/lab/sdf-zombie/webgpu/game-main.ts`)

## The problem

Two owner reports, one session:

1. **Zombies intersect and overlap constantly.** Nothing separates one
   wanderer from another. `stepWander` clamps each body to its room bounds and
   the actor rejects positions inside furniture, but no code has ever looked at
   where the *other* zombies are. Room 4 holds four bodies in an 8×8 m
   interior, so the clumping is not incidental — it is the expected outcome of
   four independent random walks in one small box. A previously-logged gore
   glitch (a wound flipping rapidly between positions) is suspected to be two
   clipped bodies.
2. **Zombies have no behaviour toward the player.** They shamble to random
   points and ignore him entirely.

## Scope decisions (owner, this session)

* The attack is **visual only** this round: no player health, no HUD, no
  damage, no death. Approach-and-swing rhythm first; what a hit costs is a
  later decision.
* Aggro is **same room + facing cone, then locked** — not always-on, not
  global.
* Separation is **soft push-apart**. Brief shallow overlap during a shove is
  accepted deliberately; it is what avoids the shuddering and corner deadlock
  a hard non-overlap constraint produces.

## Architecture

Three new pure modules and three wiring seams. Nothing here touches THREE, the
DOM, `Date.now` or `Math.random`, so all three modules are unit-testable
exactly like `wander.ts` / `gait.ts` / `stagger.ts` beside them.

```
game-main tick
  ├─ set brain input on each actor (player x/z, player room, alerted flag)
  ├─ actor.step(dt)          ← brain runs INSIDE, overriding the wander target
  └─ crowd.separate(...)     ← then actor.nudge(dx, dz) per actor
```

### 1. `src/lab/sdf-zombie/crowd.ts` — separation

```ts
export interface CrowdAgent { x: number; z: number; r: number; mobile: boolean }
export const CROWD_TUNING = {
  iterations: 2,
  /** Fraction of each pair's overlap removed per iteration. */
  stiffness: 0.5,
  /** Largest correction one agent may take in one frame (m). */
  maxPush: 0.25,
} as const;
export function separate(
  agents: readonly CrowdAgent[], tuning?: typeof CROWD_TUNING,
): [number, number][];
```

Ground-plane circles only — the bodies are upright and the floor is flat, so
the third axis carries no information. Per iteration, every pair closer than
`r1 + r2` is pushed apart along its centre line by `stiffness × overlap`,
**split between the two agents**; an agent with `mobile: false` absorbs none of
its share, so its partner takes the whole correction. The player is fed in as
the single immobile agent, which is what makes zombies slide off him rather
than shove him around (the player's own capsule already resolves against the
per-frame zombie AABBs in `stepPlayer`, and that path is unchanged).

Exactly-coincident agents (`dist < 1e-6`) get a deterministic escape direction
derived from the pair's indices, not from an RNG — two zombies spawned on the
same point must not divide by zero, and the resolution must be reproducible.

`maxPush` bounds one frame's correction so a pathological configuration
(a spawn overlap, a body knocked into a pile) unwinds over several frames
instead of teleporting.

Cost: O(n²) over 10 zombies = 45 pairs per iteration. Not worth a spatial hash.

### 2. `src/lab/sdf-zombie/brain.ts` — chase / attack decision

```ts
export type BrainMode = 'wander' | 'chase' | 'attack';
export interface BrainState {
  mode: BrainMode;
  /** Seconds the player has been out of this brain's room (0 while in it). */
  lostFor: number;
  alert: boolean;
  /** Swing progress 0..1 while mode === 'attack', else 0. */
  swingT: number;
  /** Seconds until the next swing may start. */
  cooldown: number;
}
export interface BrainInput {
  dt: number;
  self: { x: number; z: number; yaw: number; room: number };
  /** null when the player's position is unknown/irrelevant. */
  player: { x: number; z: number; room: number } | null;
  /** A shot was fired in this brain's room since the last step. */
  alerted: boolean;
}
export interface BrainOutput {
  state: BrainState;
  /** Wander-target override, world ground point; null = leave the wander alone. */
  target: Vec3 | null;
  /** True = halt locomotion this frame (cfg.wander = false). */
  halt: boolean;
  /** Attack phase 0..1, or null when not swinging. */
  attack: number | null;
}
export function stepBrain(state: BrainState, input: BrainInput, tuning?): BrainOutput;
```

Tuning:

| knob | value | meaning |
|------|-------|---------|
| `noticeRange` | 9 m | beyond this the player is not noticed |
| `noticeCone` | 70° half-angle | the player must be roughly in front |
| `loseGrace` | 4 s | alert survives this long after the player leaves the room |
| `attackRange` | 1.0 m | halt-and-swing distance |
| `releaseRange` | 1.6 m | leave attack for chase past this (hysteresis) |
| `swingSec` | 0.7 s | one swing, wind-up through recovery |
| `cooldownSec` | 1.1 s | gap before the next swing may start |

Rules:

* **Notice** requires `player.room === self.room` **and** `dist ≤ noticeRange`
  **and** the bearing to the player within `noticeCone` of `self.yaw` — *or*
  `alerted`, which bypasses the cone (a gunshot in the room turns heads).
* **Lock**: once `alert`, the cone and range stop mattering. `lostFor`
  accumulates whenever the player is not in this brain's room and resets to 0
  when he is; `alert` drops at `lostFor > loseGrace`. Stepping into a tunnel
  therefore does not reset the pack.
* **Chase** emits a *standoff target*: the point `attackRange` metres from the
  player along the player→zombie direction. This is the whole reason there is
  no second locomotion path — the existing turn-rate damping, acceleration,
  arrival braking and gait amplitude blend all still apply, so a chasing zombie
  is the same shamble, aimed. Degenerate case (zombie exactly on the player):
  fall back to the zombie's own facing.
* **Attack** on `dist ≤ attackRange` with `cooldown ≤ 0`: `halt = true`,
  `swingT` runs 0→1 over `swingSec`, then `cooldown = cooldownSec` and the mode
  returns to `chase`. A swing already in flight **finishes** even if the player
  backs out of range — an attack that can be cancelled mid-frame reads
  weightless, the same reasoning behind the existing `BLAST_HOLD_SEC`.
  `releaseRange > attackRange` gives the chase/attack boundary hysteresis so a
  body hovering at exactly 1.0 m does not flicker between modes.

**Accepted limitation, deliberate.** `stepWander` clamps every zombie to its
own room's `wanderBounds`, so a chasing zombie stops at its room's edge and
will not follow the player through a tunnel. Removing that clamp without
navigation would walk bodies into walls and through arch mouths. Cross-room
pursuit is out of scope; if the owner wants it, it is a pathfinding task, not a
tuning change.

### 3. `src/lab/sdf-zombie/attack.ts` — the swing pose

```ts
export interface AttackPose {
  /** Body-local per-joint offsets, same convention as StaggerState.offsets. */
  offsets: Partial<Record<GaitJointName, Vec3>>;
  rootOffset: Vec3;
  /** Added to the reach-style arm pitch (rad) before the shoulder pivot. */
  reachPitch: number;
}
export function attackPose(phase: number, tuning?): AttackPose;
```

Four beats over `phase` 0..1: wind-up (arms back, weight onto the back foot),
lunge (root drives forward, both arms swing down and across), contact, and
recovery back to zero. `attackPose(0)` and `attackPose(1)` both return exactly
zero offsets so the pose enters and leaves the gait cleanly.

### 4. `motion.ts` — one optional seam

`MotionConfig` gains `attack?: number` (the phase). The pose composes exactly
where `stagger.offsets` already composes: added body-local into `local` before
the `bodyYaw` rotation, and `reachPitch` added to the reach-style arm pitch
before `qFromAxisAngle`.

**When `cfg.attack` is `undefined`, not one instruction changes.** The lab's
wiring (`webgpu/lab-main.ts`) never sets it, so lab motion stays bit-identical.
This is pinned by a test that runs a fixed seed through N frames with and
without the field absent and compares rest poses exactly — an assertion, not a
claim in a comment.

### 5. `game-actor.ts` — wiring

`ZombieActor` gains three members:

* `setBrainInput(player: {x, z, room} | null, alerted: boolean): void` — stored
  for the next `step()`. Called by `game-main` before the step loop.
* `nudge(dx, dz): void` — moves `state.wander.pos` on the ground plane, then
  re-applies the room-bounds clamp and the existing furniture rejection, so
  separation cannot push a body into a crate or through a wall.
* `brain(): BrainState` — read-only, for the debug seam.

Inside `step()`, per sub-step: `stepBrain` runs first, its `target` overrides
`state.wander.target` (and forces `wander.idle = 0`, so a chasing zombie never
pauses mid-pursuit), its `halt` ORs into the existing `holdSecs <= 0` gate that
already feeds `cfg.wander`, and its `attack` passes through as `cfg.attack`.
Blast hold and knockback keep priority: a zombie taking a slug still stops and
stumbles, then resumes the chase.

The actor's existing `debug()` return grows `mode`, `alert` and `swingT`.

### 6. `game-main.ts` — wiring

* Before the actor step loop: resolve the player's room id from
  `enclosureKeyAt(player.pos[0], player.pos[2])` (a tunnel or `'void'` yields
  no room), and call `setBrainInput` on every actor. `alerted` is true for one
  frame for every actor whose `room` equals the player's room when the weapon
  fires.
* After the actor step loop: build the `CrowdAgent` list (each actor's
  `pose().pos` with `r = 0.35, mobile: true`, plus the player at
  `r = PLAYER.radius, mobile: false`), call `separate`, and apply each actor's
  correction through `nudge`.
* New debug seam `__sdfGame.brains()` returning per-actor
  `{ id, room, mode, alert, swingT, dist }` for the capture driver.

## Testing

Unit tests (vitest), one file per module:

* **crowd** — a resolved pair actually ends non-overlapping after the declared
  iterations; corrections are equal-and-opposite for two mobile agents; an
  immobile agent receives exactly `[0, 0]` and its partner takes the whole
  correction; coincident agents separate deterministically (same input, same
  output, twice); no pair beyond `r1 + r2` moves at all; `maxPush` caps a deep
  overlap.
* **brain** — the cone rejects a player behind the zombie and accepts one in
  front; `alerted` bypasses the cone; the lock survives the player leaving the
  room for less than `loseGrace` and drops after it; the standoff target sits
  exactly `attackRange` from the player on the zombie's side; a swing started
  in range completes after the player retreats; `cooldownSec` actually gates
  the second swing; the chase/attack hysteresis does not flicker at 1.0 m.
* **attack** — `attackPose(0)` and `attackPose(1)` are exactly zero; the lunge
  peak lands where the beat sheet says; every offset is finite across a swept
  phase.
* **motion** — the bit-identity pin described in §4.

## Verification

Unit tests are not evidence that zombies stopped overlapping on screen. A
headless capture through the existing `__sdfGame` seams
(`setLoopRunning(false)` + `step`, the pattern
`scripts/sdf-game-shorty-gate.mjs` already uses):

* A **top-down strip** of room 4 (four bodies, the worst case) as the player
  walks in — the pack converges, and the capture asserts a minimum pairwise
  centre distance across every sampled frame, proven to FAIL with separation
  disabled.
* An **FPV strip** of the approach and one swing, for the owner's eye.

Both land under `docs/dev-notes/2026-09-04-zombie-crowd/` with notes, and
`TASKS.md` gets the row.
