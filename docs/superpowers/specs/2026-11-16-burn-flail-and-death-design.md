# Burning bodies: the panic flail and the burn death

Date: 2026-11-16. Status: design, not built, nothing measured. A companion spec will cover the fire's
rendering cost; this one is behaviour and animation only.

## Why

A body set alight today barely reacts and never dies:

- **The flail is a stand-in.** `motion.ts` has no arm-pose channel for it, so `game-actor.ts` re-fires the
  2 cm burn shudder every 0.35 s (`BURN_BEHAVIOUR.flailPeriodSec`, `burnFlailShot`). It reads as a tremor.
- **A burning zombie keeps attacking**, 1.25 times faster on a jittering heading (`stepBurnPanic`).
- **Soldier panic is off** (`BURN_BEHAVIOUR.soldierPanic`): its flee re-picked a target every 1 to 2 s and
  stumbled through the stagger system, which the owner found jerky (2026-09-18).
- **Fire kills nothing.** The game has no health. A burner leaves only by being gibbed, so the burn-down
  (`killBurning`: fire fades, char completes, bone shows) is reached only that way.

The owner's calls (2026-11-16): a burning body panics and runs, then drops; how long it lasts and whether
fire kills it at all is set per character; the death is a seeded mix so a burning crowd does not repeat.

## The sequence

One clock per burning body, started on ignite, with a duration rolled once from the body's seed.

| phase | when | what the body does |
| --- | --- | --- |
| panic | 0 to 75 % | No attacks, no gunfire. Runs on a smoothly wandering heading, arms thrashing. |
| falter | 75 to 100 % | Speed and flail ease down, the trunk pitches forward, the heading wanders wider. |
| death | at 100 % | The body is killed and plays one of three burn falls. `killBurning` starts the burn-down. |
| corpse | after | The existing fade over `corpseBurnSec`: a charred, cold body. |

A body that is put out before its clock ends returns to its mind and keeps its char. A body killed by
something else while burning takes that death, and the burn-down runs as it does today. A body whose tier
does not die (below) panics for its duration and then goes back to its mind, still alight.

## Pieces

### 1. The burn clock: `burn-behaviour.ts`

`stepBurnPanic` stays the single pure seeded step and grows the clock. Changes:

- `createBurnPanic(seed, tier)` rolls `durationSec` in the tier's range.
- The output gains `phase: 'panic' | 'falter' | 'done'`, `u` (0..1 through the whole clock), `flail`
  (0..1 amplitude: 1 through panic, easing to 0.35 across falter) and `die` (true on the one step the
  clock ends, when the tier dies).
- **One heading rule for every kind.** The target is a point `fleeDistM` away along a heading that is
  the away-from-player direction turned by a continuous two-sine wobble (the zombie's existing `wob`).
  The soldier's re-picked swing (`nextRepick`, `swing`, `repickMinSec`, `repickMaxSec`) is removed: it
  is what read as jerky. With no player known, the heading is the body's own forward, wobbled.
- `cruiseScale` comes from the tier and eases to 0.45 of itself across falter.
- `stumble` is removed from the output, along with `stumbleMinSec`, `stumbleMaxSec`, `stumbleGain`,
  `flailPeriodSec`, `soldierFlailPeriodSec` and `flailGain`. The flail overlay carries the motion; the
  stagger system is no longer used for burning, which also removes the soldier's stagger-restart trap.
- `soldierPanic` is removed: the soldier family panics like everyone else.
- `setBurnBehaviourEnabled` (the cost-study switch) keeps working: off means no panic, no flail and no
  burn death, so a fire-on and fire-off replay still share their motion.

### 2. The tiers: `motion-profile.ts`

```ts
export interface BurnTier {
  /** Seconds of panic + falter before the burn death, rolled per body. */
  panicSec: readonly [number, number];
  /** Cruise speed multiplier while panicking. */
  speed: number;
  /** Flail amplitude scale (0 = no arm flail). */
  flail: number;
  /** Fire kills this body when its clock ends. False: it panics, then carries on, alight. */
  dies: boolean;
}
export const BURN_TIER_DEFAULT: BurnTier = { panicSec: [3, 6], speed: 1.3, flail: 1, dies: true };
```

`MotionProfile.burn?: Partial<BurnTier>`; absent fields take the default. First values, all to be tuned
in the arena:

| profile | panicSec | speed | flail | dies |
| --- | --- | --- | --- | --- |
| zombie and the bodies on its profile | 3 to 6 | 1.3 | 1 | yes |
| soldier, cultist, deadeye | 2.5 to 4.5 | 1.4 | 1 | yes |
| ogre, juggernaut, warbull, butcher, tallow | 5 to 8 | 1.1 | 0.6 | no |
| gorehound, gutcrawler | 2.5 to 4 | 1.4 | 0 | yes |
| everything else | default | | | |

This is the hook the deferred flammability idea (cloth against bare flesh, `docs/tasks/characters.md`)
would later extend. Nothing here implements that.

### 3. The flail: new `burn-flail.ts`

Pure, no clock, no randomness beyond its seed:

```ts
export interface BurnFlailPose {
  /** Hand targets relative to the shoulder, body-local (+Z forward, +X left), metres at unit arm length. */
  handL: Vec3; handR: Vec3;
  /** Trunk pitch (rad, + forward) and side sway (rad). */
  pitch: number; sway: number;
  /** Head toss (rad) about the side axis. */
  headToss: number;
}
export function burnFlailPose(t: number, seed: number, amp: number, fold: number): BurnFlailPose;
```

- `t` is seconds since ignite, `amp` the clock's `flail` times the tier's, `fold` 0..1 across falter.
- Each arm is the sum of two sines per axis at incommensurate rates (about 2.3 and 3.7 Hz), phased from
  the seed and offset between the arms, around a raised centre: hands above and in front of the head
  through panic. One arm's centre drops to beat at the chest for a seeded stretch every few seconds.
- `fold` brings both centres down and in to the chest and adds forward pitch, so falter reads as the
  body giving out and hands the death fall a pose it can blend from.
- No discontinuities: the output is continuous in `t`, and scales to rest at `amp` 0.

**In `motion.ts`:** a new `MotionConfig.burnFlail?: { t: number; seed: number; amp: number; fold: number }`.
When present and the body is standing, the arm targets are placed with the existing `armPivot` solve from
each shoulder to the pose's hand target scaled by that side's arm length (so the arm cannot stretch), and
the pitch, sway and head toss are added to the trunk and head targets the lean already moves. It is applied
after the carry and attack arm placement and overrides them; a missing arm is skipped (`sig.missing`).
A soldier's gun stays in his hand and follows it. A collapsed body ignores the overlay.

Bodies without the humanoid arm joints (`shoulderL/R`, `elbowL/R`, `handL/R`), or with tier `flail` 0,
get no overlay: they panic-run only.

### 4. The burn deaths: `death-fall.ts`

Three new `DeathFallKind`s with their own `FallSpec`s, authored in the existing key format:

| kind | read |
| --- | --- |
| `burnKneel` | Drops to the knees, arms clawing up, pitches forward onto the face, then the arms and legs draw in to a curl (the pugilist posture). About 2.2 s. |
| `burnTopple` | Goes rigid, arms locked half-raised, and falls like a board, forward or to the seeded side. About 1.1 s. |
| `burnHeap` | Knees and hips fold together and the body sits down into itself, trunk slumping over the legs. About 1.6 s. |

None has travel or an airborne arc. All three topple relative to the body's own facing, not a shot:
the choice carries `impact` set to the body's forward. They are kept out of `DEATH_FALL_KINDS`' ordinary
pick, so no gun death ever plays one; a separate exported `BURN_FALL_KINDS` lists them.

**The pick:** `pickBurnFall(seed)` in `death-fall.ts` returns a `DeathFallChoice` with the kind by seed
(weights 0.4 kneel, 0.3 topple, 0.3 heap), `side` by seed, `strength` 1.

### 5. The wiring: `game-actor.ts` and `game-burning.ts`

- `setBurning(true)` builds the panic with the profile's resolved tier; the soldier early-out goes.
- Each step while panicking: the mind's verdict is overridden as today (target, `cruiseScale`,
  `fire = false`), attacks are suppressed, and `burnFlail` is handed to `stepMotion`.
- `queueBurnFlail`'s stand-in (`burnFlailShot`, `burnStumbleShot`, `burnFlailT`) is deleted.
  `burnStumbles()` on the actor is replaced by `burnPhase()` for the capture trace.
- On `die`: the actor is killed through the same path a fatal volley uses (the forced collapse with
  `fatal`), with a burn death plan so `cfg.deathFall` returns `pickBurnFall`. This applies **even when
  the profile is `physicsDeath`** (the zombie): a burn death is always authored when `canDeathFall`
  passes. A body that fails `canDeathFall` (gorehound, gutcrawler) or is `soft` takes its normal death.
- The actor reports the death to `game-burning.ts`, which calls `burning.kill(a)` to start the
  burn-down but does **not** release the body: today's `retire` both kills and releases because its only
  caller is a gib. A new `burnedDown(a)` path keeps the state stepping until `dying` clears.
- Flame cards already settle to the floor through `settle` while `dying`; the fire volume follows the
  posed capsules, so both ride the fall with no change.

## What is not in this spec

- Rendering cost (the companion spec).
- Fire spreading between bodies, flammability by clothing, a real flare gun, burn damage numbers.
- Sound.
- New behaviour for the non-dying tier beyond panic then resume.

## Testing

Pure modules get tests beside them:

- `burn-behaviour.test.ts`: the duration lands in the tier's range; phases arrive in order; `die` fires
  exactly once and never for a non-dying tier; the heading's turn rate is bounded (no re-pick jumps);
  the same seed gives the same run; the disabled switch gives no panic.
- `burn-flail.test.ts`: continuity (bounded change per 1/60 s); hand targets stay within reach; `amp` 0
  is the rest pose; `fold` 1 puts both hands at the chest; two seeds differ.
- `death-fall.test.ts`: each burn kind ends grounded with no joint under the floor; `pickBurnFall` covers
  all three kinds across seeds and never returns an ordinary kind; the ordinary pick never returns a
  burn kind.
- `game-actor.test.ts`: an ignited zombie stops attacking, hands `burnFlail` to motion, dies when its
  clock ends and plays a burn kind despite `physicsDeath`; a soldier does not fire while burning; a
  non-dying tier resumes; a gorehound panics and takes its normal death.

`npm run typecheck` and `npm run test:changed`. The look is judged in the arena
(`npm run dev:arena`, `?spawn=<character>`, the ignite seam in `game-seams-fire.ts`) for the zombie, the
soldier, one heavy and the gorehound, and with `igniteAll()` on a crowd for repetition.

## Risks

- **The overlay against the gun carry.** The soldier's arm placement is the most involved code in
  `motion.ts`. If overriding it after the fact fights the two-handed grip, the fallback is to drop the
  carry to one-handed for the length of the panic.
- **Entering the fall from a run.** The death falls blend from the pose at death; the falter phase
  exists to slow the body first. If a fall still snaps, the falter's floor speed drops further.
- **Port.** All new logic is pure TypeScript with no renderer dependency, per the plan template; there
  is no new WGSL.
