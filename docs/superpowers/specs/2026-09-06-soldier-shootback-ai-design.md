# Soldier shoot-back AI — a ranged state machine, and the game's second enemy

> Date: 2026-09-06
> Status: approved design, awaiting plan
> Scope: phase 2 of 3. Phase 1 (animation) shipped 2026-09-05.
> Phase 3 = shouldered aim + soldier-specific death.
> Predecessor: [soldier animation](2026-09-05-soldier-animation-design.md)

## Why

The soldier walks, runs, carries the shorty and hip-fires it — in the lab,
driven by keypresses. Nothing decides when he does any of it, and the game
page has never seen him. Two gaps, and the second is the larger one:

1. **There is no ranged brain.** `brain.ts` is the zombie's decision layer and
   its whole geometry is *collapse the distance*: pursue, encircle, engage,
   swing. A rifleman's geometry is the opposite — hold a distance, and back
   off when it closes. No state in that machine wants what this one wants.
2. **The game only knows one kind of enemy.** `game-main.ts` imports exactly
   `zombie.blob`; `spawnAll` loops rooms calling `spawnZombie`; the face sheet
   is a module constant (`ZOMBIE_FLAT`) applied to every body; `game-actor.ts`
   never sets `MotionConfig.profile`, so `stepMotion` falls through to
   `ZOMBIE_PROFILE` for every actor in the game. The kit overlay and held prop
   are wired only by `lab-main`.

Most of this milestone is (2). The state machine is a small pure file; the
work is teaching the game that enemies come in kinds. The soldier is the
payload that proves it.

## Decisions (owner, 2026-09-06)

| Question | Answer |
| --- | --- |
| Damage | **Behavior only.** Bullets do not hurt the player. There is no player health in the SDF game and this spec does not add one. |
| Repertoire | Standoff, aim, fire, reposition. No line-of-sight test, no cover-seeking, no suppression reactions. |
| Test bed | **One soldier, one room.** Zombies elsewhere untouched. No ranged crowd arbiter. |
| Weapon | The shorty as carried, hip-fired. Short standoff (~5 m). No new prop, no new pose. |
| Point blank | Back-pedal to reopen the gap. No melee — he has no melee animation. Owner: "we should add melee animation at some point." |
| Architecture | Separate `soldier-brain.ts`; `brain.ts` untouched. |
| Reference | Doom's shotgun guy — but keeping the standoff band, which Doom does not have. |

### On the architecture choice

Three options were weighed:

- **A. Separate brain, parameterized actor.** Chosen.
- **B. One brain with a ranged mode.** Rejected: `brain.ts`'s own header
  documents that it was rewritten specifically to escape mode-branching
  ("three ad-hoc overrides doing the same job three different ways"). Adding a
  mode flag walks that back, and puts a pinned contract at risk inside a
  soldier task.
- **C. Extract a shared `perception.ts` first, then build on it.** Rejected
  *for now*, not on merit — it is the cleanest end state. It refactors the
  working, pinned zombie brain as a prerequisite to a soldier feature.

A costs roughly thirty duplicated lines of notice/alert/lose-grace/stagger
preamble. That is the price of learning what is *actually* common from two
real brains instead of guessing from one. When a third enemy arrives, extract
C from evidence.

### On the Doom reference

The Doom shotgun guy wakes on sight or noise, runs `A_Chase` toward the player
in one of eight directions with a random chance to change direction each move,
and periodically rolls to stop and attack. `A_PosAttack` faces the player,
holds one distinct telegraph frame, then fires a hitscan spread. Pain-flinch
interrupts everything. That is the entire behaviour, and its simplicity is
load-bearing.

Three properties are imported deliberately:

1. **Irregular refire.** Doom monsters roll for the attack rather than running
   a timer. A fixed cooldown metronomes, and metronoming is the fastest way to
   make an enemy read as a machine. See `refireRoll` below.
2. **A hard telegraph.** Doom's separate pre-fire frame is why a sergeant is
   dodgeable at all. The `aim` state is this, and `aimSec` must stay long
   enough to read.
3. **Committed, coarse movement.** Doom picks a direction and walks it rather
   than re-solving every tic. `repositionSec` is this.

Where this design departs: **Doom's shotgunner has no standoff and no
retreat.** The band is ours. The owner chose to keep it knowing that, and it
is the design's largest feel risk — a band is the thing most likely to read as
passive, an enemy politely holding range while you line up. If the playtest
says passive, the band is the first thing to collapse.

## 1. `soldier-brain.ts`

A sibling of `brain.ts`, holding to the same contract: **pure — no clock, no
RNG, no THREE**, so every transition is unit-testable against hand-worked
geometry. It emits a target and flags; it does not drive locomotion, and it
does not own a second walker.

Heading convention is `wander.ts`'s, unchanged: yaw 0 faces +z, positive
clockwise from above, bearing to a point is `atan2(dx, dz)`.

Room-bound, deliberately, exactly as the zombie is: `stepWander` clamps every
body to its own room's bounds. Cross-room pursuit needs navigation and stays a
separate spec.

### States

| State | Meaning | Locomotion |
| --- | --- | --- |
| `idle` | Not alert | Free wander |
| `advance` | Alert, farther than the band | Walk at the player |
| `retreat` | Alert, closer than the band | Back off toward the band's far edge |
| `standoff` | In the band, cooling down | Tangential strafe |
| `aim` | Halted, tracking, telegraphing | Halted, turning |
| `fire` | The shot goes off | Halted, turning |
| `recover` | Recoil hold, cooldown ticking | Halted, turning |
| `stagger` | Shot — outranks everything | Halted |

### Perception

The zombie's rule verbatim: notice cone plus range; a gunshot in this brain's
room sets `alert` and bypasses the cone; `alert` survives `loseGrace` seconds
after the player leaves the room. Duplicated rather than shared — see the
architecture note.

### The band

The whole geometry of this brain. `standoffNear` / `standoffFar` bracket a
preferred range; outside it he closes or backs off, inside it he runs the
firing cycle.

**The hysteresis runs inward, not outward.** He starts advancing at
`dist > standoffFar` but does not stop until `dist <= standoffFar - hys`; he
starts retreating at `dist < standoffNear` but does not stop until
`dist >= standoffNear + hys`. Putting the exit threshold *inside* the band is
what kills the chatter — an exit threshold outside it would make the two
states overlap and oscillate, which is the opposite of the intent. At the
starting values he settles somewhere in 4.1–5.4 m.

Retreat targets a point away from the player along the bearing from player to
self, at `standoffFar`.

**Cornering is emergent, not coded.** `stepWander` already clamps to room
bounds, so a soldier backed into a wall simply stops retreating and keeps
firing from where he stands. No extra state, no bounds query in the brain.

### The firing cycle

`standoff → aim (aimSec) → fire (one frame) → recover (recoverSec) → standoff`

**Once `aim` starts, the cycle runs to completion** even if the player leaves
the band. This is the direct analogue of the zombie's "a committed swing runs
to the end," and it is what makes the telegraph readable: without it, strafing
at the band edge makes him flicker in and out of aiming and never commit.

`fire` is true on **exactly one frame** per cycle.

### The decision tick

**Rolling for the shot every frame would defeat the point.** At 60 Hz a
`refireRoll` of 0.5 fires on the first eligible frame every single time, which
is a fixed cooldown wearing a costume. Doom rolls when a monster *finishes a
move*, not every tic, and that cadence is the whole source of the irregular
rhythm.

So the brain has one **decision tick**, every `repositionSec`. On that tick,
and only on that tick, it (a) re-rolls the strafe sign and (b) if it is in
`standoff` with `cooldown` expired, rolls `refireRoll` to enter `aim`.

This needs **two independent 0..1 inputs**, `roll` and `rollDrift`. One value
cannot serve both without correlating them — with a single `roll`, "fires" and
"strafes left" would become the same event. Both arrive as inputs rather than
from an injected generator, so the module stays a pure function of its
arguments, exactly as `brain.ts` does for swing variants. Both are consumed
only on a decision tick.

### Reposition

In `standoff` he strafes tangentially: the target is his own current bearing
from the player, offset by `drift * strafeStep`, at his current radius clamped
into the band. The sign comes from the decision tick above.

### Output

```ts
interface SoldierBrainOutput {
  brain: SoldierBrain;
  /** Wander-target override (world ground point); null = leave it alone. */
  target: Vec3 | null;
  /** True = locomotion off this frame. */
  halt: boolean;
  /** True on exactly the frame the shot goes off. */
  fire: boolean;
  /** Bearing to hold while halted; null = leave the heading alone. See §2. */
  faceHeading: number | null;
  /** 0..1 telegraph progress while aiming, else 0. */
  aimT: number;
}
```

No `engaged` / `committed`: those are melee-ring vocabulary and there is no
ring here.

`aimT` drives no geometry in this phase. It is exposed for the debug HUD (so
the telegraph can be watched while tuning `aimSec`) and is the seam a visible
tell — a lean, a shoulder rise — hangs off in phase 3. It is in the output
rather than dug out of `brain.state` later because the alternative is a
consumer reconstructing cycle progress from a timer it does not own.

### Tuning

All constants live in one `SOLDIER_TUNING` table beside the machine, mirroring
`BRAIN_TUNING`. Starting values — the playtest owns the final ones, but the
plan should not have to invent them:

| Constant | Start | Note |
| --- | --- | --- |
| `noticeRange` | 9 m | The zombie's value; the band sits well inside it. |
| `noticeCone` | 70° | The zombie's value. |
| `loseGrace` | 4 s | The zombie's value. |
| `standoffNear` | 3.5 m | Closer than this, retreat. |
| `standoffFar` | 6.0 m | Farther than this, advance. Holds ~5 m. |
| `bandHysteresis` | 0.6 m | See below — the exit threshold sits *inside* the band. |
| `aimSec` | 0.5 s | The telegraph. Must stay readable. |
| `recoverSec` | 0.4 s | Recoil hold. Sits under `FIRE.holdSec` (0.85 s). |
| `minCooldownSec` | 1.0 s | Floor between shots. |
| `refireRoll` | 0.5 | Chance to take an eligible firing opportunity. |
| `repositionSec` | 1.5 s | The decision tick — see below. |
| `strafeStep` | 0.5 rad | Tangential offset applied to the strafe target. |
| `blastHoldSec` | 0.55 s | The zombie's value, for stagger parity. |

### Stagger

The soldier gets his own `staggerSoldierNow(brain, tuning)` — the direct
analogue of `brain.ts`'s `staggerNow`, and synchronous for the same reason
documented there: **a body lurches on the frame it is shot**, not one frame
later. It forces `stagger`, clears any in-flight aim, and must leave no
stranded `fire` pulse behind.

It is a separate function because `staggerNow` is typed to `Brain`. This is
part of the thirty duplicated lines the architecture note accounts for.

## 2. The actor seam

### `EnemyMind`

A small interface — `step(input) → { target, halt, faceHeading, attack?, fire?, engaged, committed }` —
with two implementations: `zombieMind` wrapping `stepBrain`, `soldierMind`
wrapping `stepSoldierBrain`.

`createZombieActor` takes an optional `mind` in `opts` and **defaults to
`zombieMind`**, so every existing call site, test pin and the crowd-gate
script is untouched by construction. The ~800 lines below the seam — body,
view, hit/sever/wound, crowd nudge, furniture routing, hit batching — are
shared unchanged.

### The debug seam

`ZombieActor.debug()` returns melee vocabulary — `side`, `variant`, `swingT`,
`hasToken` — which is meaningless under a soldier mind, and it is consumed by
the capture driver and the tuning HUD. Rather than widen it into a union that
every caller must narrow, the mind supplies its own **`debug` block** that the
actor merges in: the zombie's keeps today's fields verbatim (so the capture
driver's oracle is unchanged), and the soldier's carries `state`, `aimT`,
`cooldown` and `faceHeading`. Shared fields — `state`, `alert`, `phase`,
`meter`, `blend`, `speed`, `target` — stay where they are, owned by the actor.

### The facing fix

`bodyYaw` chases `wander.heading` through a damped, rate-limited follow, and
`stepWander` — the only thing that writes `heading` — is skipped when
`cfg.wander` is false. **A halted body therefore keeps its last heading and
cannot turn.** That is invisible for a zombie, which was already facing the
player when it swung, but fatal for a soldier who must track while aiming.

The fix is to write `faceHeading` straight into `state.wander.heading` in the
actor. The existing damped follow then turns him at the turn rate that is
already tuned — no new constant, and no second turn implementation. This holds
the line `brain.ts` draws in its header: one walker, one set of turn rates.

### The profile passthrough

`stepMotion` already reads `cfg.profile ?? ZOMBIE_PROFILE`. `game-actor` never
sets it, which is why every actor in the game is a zombie. The actor takes a
`MotionProfile` in `opts` and passes it through. `SOLDIER_PROFILE` already
exists in `motion-profile.ts`, complete with the carry table and the shorty
prop URL — nothing new to author.

## 3. `game-main.ts` — the game learns about kinds

1. **Spawn table.** Import `soldier.blob`. `spawnAll` currently loops rooms ×
   `spawnPoints` calling `spawnZombie`; it becomes `spawnEnemy(kind, …)` with
   one room designated the soldier's.
2. **Per-character face sheet.** `ZOMBIE_FLAT` is a module constant applied to
   every body, because `zombie.blob` has no `sheet` block. `soldier.blob`
   *does* have one — his own owner-tuned bake. Use the blob's own sheet when
   present; fall back to `ZOMBIE_FLAT` when absent.
   **This is a known trap:** one invalid key in the soldier's sheet block cost
   an hour on 2026-09-04 and made him lose his face. Treat sheet wiring as a
   place to verify, not assume.
3. **Kit and prop.** Load and per-frame pose the `KitOverlay` (armour) and
   `HeldProp` (shorty). Both modules already live in `webgpu/` beside
   `game-main.ts` and are merely lab-*wired*, not lab-*bound*. This is wiring,
   not new code. On collapse or gib the prop releases and drops, as in the lab.
4. **The fire pulse.** Route the brain's `fire` into `MotionSignals.fire`. The
   field exists and already drives `FIRE.holdSec`, the carry swap to the fire
   pose, and the muzzle-rise kicks. Recoil is free.

## 4. The shot

Behavior-only, so the shot's whole job is legibility: it must be visible that
he fired, from where, and roughly where it went.

- **Muzzle** — `HeldProp.muzzle()` returns the world midpoint of the two bores
  for the last posed frame. Built in phase 1 for exactly this.
- **Flash** — `flashPixels` / `smokePixels` from `flash-sprite.ts`, as a
  world-space sprite at the muzzle for a few frames.
- **Pellets** — `spawnPellets` + `GRAPESHOT` + `expired` from
  `game-weapon.ts`, fired from the muzzle along the aim direction.

**Firm rule: soldier pellets live in a separate list from the player's, and
that list is never raycast against actors.** Two reasons, both deliberate. The
player's pellet path is tuned, pinned, and carries the hit-batching work from
2026-09-05; a soldier feature must not perturb it. And an un-raycast list
cannot accidentally friendly-fire zombies — whether soldiers hurt zombies is a
real encounter-design decision, not one to make by accident.

Soldier pellets are visual: they fly and expire on time or distance.

## 5. Testing and gates

### Unit — the real coverage

`soldier-brain.test.ts`, hand-worked geometry, in `brain.test.ts`'s style:

- notice cone and range; a gunshot bypassing the cone; `loseGrace` expiry
- each band edge with its hysteresis, in both directions
- the cycle emits exactly one `fire` pulse
- **the committed-cycle property**: enter `aim`, move the player out of the
  band, assert the cycle still completes
- the refire roll gates entry to `aim`, **and is consumed only on a decision
  tick** — the regression test is that a soldier standing in the band with
  `roll = 0` (always fire) does not fire on frame one, and fires at most once
  per `repositionSec`
- `staggerSoldierNow` cancels an in-flight aim and leaves no stuck `fire`
- `faceHeading` tracks a moving player

**Not unit-testable, and deliberately so:** cornering. The brain always emits a
retreat point at `standoffFar`; the stop comes from `stepWander`'s bounds
clamp, which lives outside this module. It is checked in the playtest, not the
suite — asserting it here would mean giving the brain a bounds query it should
not have.

### Hard gate — the zombie does not move

`brain.test.ts` and the crowd-gate script must pass **unchanged**. That is the
evidence the `zombieMind` default is genuinely a no-op for the zombie, rather
than a hope. Any diff in those is a failure of this design, not a test to
update.

### Owner gate — the game

Per the standing preference on FPV and animation work, the verdict is the
running game, not the suite. The question: does a soldier who holds a band,
telegraphs, and backs off when rushed read as an enemy fighting back, or as a
machine?

Two named failure modes, with their knobs:

- **Metronomic rhythm** → `refireRoll`, `minCooldownSec`
- **Unreadable telegraph** → `aimSec`
- **Passive at range** → the band itself; see the Doom note

## 6. Out of scope

Recorded as follow-on work, deliberately excluded here:

- **Player damage / player health.** `RING_TUNING` still notes "with no player
  health yet, more attackers add noise, not danger" — that stays true.
- **Melee animation** for the soldier (owner: "we should add melee animation at
  some point"). Until it exists, point blank is a back-pedal.
- **Shouldered aim** and soldier-specific death — phase 3.
- **Multiple soldiers and a ranged crowd arbiter** (the firing-line analogue of
  `melee-ring.ts`).
- **Line of sight and cover-seeking.** He will shoot through pillars. Accepted
  for one soldier in one room; it is the first thing a second soldier makes
  intolerable.
- **Friendly fire.**
