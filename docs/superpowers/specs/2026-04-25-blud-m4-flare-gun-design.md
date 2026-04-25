# M4 — Flare Gun + Wave System Design

**Date:** 2026-04-25
**Milestone:** M4 (first weapon — Flare Gun) + bonus wave-runner scaffold
**Status:** approved, pending implementation

## Goal

Add the flare gun as the first M4 weapon, with full enemy interaction (stuck-flare, burn DoT, panicking burning enemies, procedural smoke), plus a small "press R to start a 5-wave round" wave runner so the player has something to playtest against. This is a proof-of-pattern for the M4 weapon model and the first step toward a vertical-slice playable demo.

## Non-Goals

- Cultist enemy (M5 territory; the local-model cultist work stays in `docs/dev-notes/model-benchmarks/` as reference, not ported to `src/`)
- Other M4 weapons (Double-Wide, Cursed Phone, etc — separate tasks once the flare establishes the pattern)
- Real Blender-authored level chunks (M6; the wave runner spawns inside the existing arena)
- Procedurally-generated levels / themed rooms (separate spec after this lands)
- Charred-corpse death sprite (acceptable F2 follow-up — burn-killed enemies use the normal death anim until art lands)
- Real `FLARE_BURN_LOOP` SFX file (placeholder filename + missing-asset graceful skip is fine)
- Weapon-switcher UI / hotbar — flare bound to dev key `Shift+F` only; dynamite stays the player's "real" weapon

## Architecture

### New files

```
src/game/weapons/flare.ts              — Weapon class (5-state FSM + projectile spawn)
src/game/weapons/flare.test.ts         — pure-math + FSM unit tests
src/game/weapons/stuck-flare.ts        — stuck-flare entity (lights enemy, ticks DoT)
src/game/weapons/stuck-flare.test.ts   — DoT timing tests
src/game/encounter/wave-runner.ts      — wave/encounter scripting state machine
src/game/encounter/wave-runner.test.ts — wave timing + spawn-trigger tests
src/game/encounter/encounters.ts       — data: WARMUP_ROUND encounter (5 waves)
src/vfx/smoke-particles.ts             — procedural smoke (uses existing ParticlePool)
src/vfx/smoke-particles.test.ts        — emission/lifetime tests
```

### Edits to existing files

- `src/game/enemy/ai.ts` — add `Burning` to `ZombieState` enum; add `BrainHooks.onBurningStart()` / `onBurningEnd()`; extend brain transitions; add panic-thrash velocity calculation
- `src/game/enemy/axe-zombie.ts` — track `stuckFlares: StuckFlare[]`, react to burning state (anim swap + velocity from brain), apply per-frame DoT damage from stuck flares, emit smoke column from each stuck flare
- `src/game/gibs/tuning.ts` — add `FLARE_GUN`, `BURN`, `WAVE_PRESETS` constants
- `src/main.ts` — bind `Shift+F` (fire flare from player position); bind `R` (start wave round); construct + tick wave runner each frame
- `src/audio/events.ts` — add `FLARE_SHOOT`, `FLARE_IMPACT`, `FLARE_BURN_LOOP` SFX events (placeholder filenames)
- `TASKS.md` — flip M3 to in-flight-pending-playtest, add row for M4.flare

## Components

### Flare weapon FSM

5 states mirroring `dynamite.ts`'s pattern:

```
idle ─press→ raising ─300ms→ firing ─instant→ projectile ─collision→ (spawns StuckFlare) → idle
```

- Press from `idle` enters `raising` (300ms windup, no release-cancel — flare commits once raised)
- After raising → `firing` immediate; spawns projectile at muzzle position with camera-forward velocity ~25 m/s under gravity
- Projectile travels until first collision (wall, floor, or enemy `RAPIER.RigidBody`) → spawns a `StuckFlare` entity at impact position, attached to the hit body if it was an enemy → weapon returns to `idle`

Pure-math fns (TDD targets): `flareArcPosition(spawnPos, vel, t)`, `isProjectileActive(phase)`, `raisingComplete(elapsedMs)`.

### Stuck-flare entity

Lifecycle: `spawn → burning (6s) → extinguished → removed`

- Owns `pos: Vec3` and optional `attachedBody: RAPIER.RigidBody | null`. When `attachedBody !== null`, position follows the body each frame so flares stick to moving zombies.
- Tracks `remainingSec` (counts down from `BURN.durationSec = 6`).
- `damageThisTick(dt)` returns DoT damage for the frame; **caller** (the enemy update loop) applies it. Flat rate `BURN.dpsPerFlare = 8` HP/s; max accumulated damage per flare = 48 HP.
- Multiple flares on the same enemy stack additively.
- On extinguish: emits one final smoke burst, then removes itself from the world registry.

Pure-math fns: `burnRemainingSec(spawnTime, now, duration)`, `dotDamageThisFrame(dt, dps)`, `isExpired(spawnTime, now, duration)`.

### Burning brain state

New 6th state in `ZombieState`. Transition rules:

| From | Event | To |
|------|-------|----|
| Idle / Chase / Attack / Stagger | `stuckFlares.length > 0` | `Burning` (save `prevState`) |
| Burning | All flares expired AND `hp > 0` | `prevState` |
| Burning | `hp <= 0` | `Dead` (with `onCharredDeath` hook so renderer can pick a different death anim if available — fall back to normal death sprite if not) |

While in `Burning`:
- Velocity is **panicked** — random thrash. Brain owns a `panicTarget: Vec3` re-rolled every ~0.4s within a 3m radius of the zombie. Each frame, velocity = normalized direction toward panicTarget × `BURN.panicSpeedMultiplier × baseSpeed`.
- DoT damage is still applied externally per frame from each stuck flare.
- `onBurningStart` / `onBurningEnd` brain hooks fire so the concrete enemy can swap animation + start/stop SFX loop.

Pure-fn for state transition: `nextStateGivenBurningContext(state, hp, stuckFlareCount, prevState)`.

### Smoke particles

Two emission patterns reusing `ParticlePool`:

1. **Steady column** from each stuck flare. Adds new `ParticleKind = 'smoke'` to particles.ts. Particles spawn at flare position, rise at ~0.3 m/s with ±0.1 m/s lateral jitter, fade alpha to 0 over ~1.5s, spawn rate ~12/sec. Color: warm grey `#888880`, slightly orange near base.
2. **Burst on extinguish** — single 8-particle puff when a flare expires or when a burning enemy dies. Same sprite, larger initial size, faster initial velocity, longer fade.

API:
```typescript
export function startSmokeColumn(source: () => Vec3): TrailHandle;
export function emitSmokeBurst(pos: Vec3, count?: number): void;
```

Pure-fn extracts: `smokeRiseVelocity(elapsed, baseSpeed, jitterAmplitude, randomFn)`, `smokeAlphaCurve(elapsed, totalLifetime)`.

### Wave runner

```
Idle ─R pressed→ ActiveWave(N) ─aliveCount==0→ ActiveWave(N+1) ─last cleared→ Victory
                              ↓ playerAlive==false →                ↓
                                                                 Defeat
```

- `WaveRunner` owns: `state`, `currentWave`, `aliveEnemyCount`, refs to `spawnEnemyFn(kind, pos)` callback, encounter data, arena bounds.
- `update(dt, playerAlive, aliveEnemyCount)` advances state. On wave start, calls `spawnEnemyFn(...)` for each enemy in the wave, staggered by `wave.spawnDelayMs`.
- Spawn positions selected from a small set of perimeter "spawn anchors" (4 points around the arena, random pick per spawn).
- 1.5s breather between waves once the previous is cleared.

### Encounters data

Single hardcoded encounter for now:

```typescript
export const WARMUP_ROUND: Encounter = {
  id: 'warmup',
  waves: [
    { spawnDelayMs: 400, enemies: ['zombie', 'zombie'] },                              // 2
    { spawnDelayMs: 400, enemies: ['zombie', 'zombie', 'zombie'] },                    // 3
    { spawnDelayMs: 350, enemies: ['zombie', 'zombie', 'zombie', 'zombie'] },          // 4 + tighter
    { spawnDelayMs: 400, enemies: ['zombie-tough', 'zombie', 'zombie'] },              // tank intro
    { spawnDelayMs: 300, enemies: ['zombie', 'zombie', 'zombie', 'zombie', 'zombie'] },// 5 final
  ],
};
```

`zombie-tough` = an axe-zombie config variant with 2× HP. Same enemy class, different config; not a new enemy.

## Data flow

```
player input (Shift+F)
  → main.ts → flare.onPress(ctx)
    → flare FSM: idle → raising → (300ms) → firing → spawn projectile
      → projectile.update each tick → arc position → collision check
        → on hit: spawn StuckFlare(pos, attachedBody?)
          → flare FSM → idle
          → enemy update each tick:
            → for each stuck flare attached: apply damageThisTick → reduce hp
            → if stuckFlares.length > 0 → brain transitions Burning
              → brain.update returns panicVelocity
              → onBurningStart hook → emit smoke column from each flare position
            → on hp <= 0 → Dead (onCharredDeath hook)

player input (R)
  → main.ts → waveRunner.start(WARMUP_ROUND)
    → waveRunner.update each tick: track aliveEnemyCount
      → on wave start: spawn enemies via spawnEnemyFn callback
      → on aliveEnemyCount==0: 1.5s breather → next wave
      → on last wave cleared: Victory
      → on player death: Defeat
```

## Error handling

- **Flare projectile leaves world bounds** → silently extinguish (treat as collision with "void"); log dev-warn.
- **Stuck-flare's attached body is removed mid-burn** (e.g. enemy gibbed by separate dynamite hit) → flare detaches, falls to ground via gravity for remaining lifetime.
- **Wave runner called with empty encounter** → no-op + dev-warn; state stays `Idle`.
- **Multiple flares on a single enemy** → stack additively (no cap; design choice — if it gets cheesy in playtest we can cap to 3 in a follow-up).
- **Missing audio file for `FLARE_*` events** → existing `asset-loader.ts` skip-on-empty pattern handles this. Add SfxEvent enum value with placeholder filename; if file doesn't exist, sound just doesn't play.

## Testing strategy

All new tests are unit (no DOM, no three.js, no Rapier world):

- **`flare.test.ts`** — arc position correctness for known v/t inputs, FSM transitions through full lifecycle, raising-cancel rejection, projectile-collision triggers StuckFlare spawn (mock callback)
- **`stuck-flare.test.ts`** — DoT damage per frame given dt, burn duration countdown, attached-body position follow (mock body), expiry triggers detachment + final smoke burst
- **`smoke-particles.test.ts`** — emission rate (X particles in T seconds), alpha curve (start at 1.0, end at 0.0), rise velocity (matches base + jitter envelope)
- **`wave-runner.test.ts`** — `start(encounter)` enters wave 0, wave clear triggers next wave after breather, last wave clear triggers Victory, player death triggers Defeat regardless of wave state, spawn-stagger calls callback at correct intervals
- **`ai.test.ts`** (extended) — Burning state transition rules: enters when stuckFlares > 0, exits when stuckFlares = 0 returning to prevState, panic-target re-roll cadence

No integration tests (Three.js + Rapier behavior is verified manually). Manual playtest is the final accept gate (#10 in the M3 pattern).

## Acceptance criteria

Done when **all** of the following are true:

1. `npx vitest run` is fully green (existing 184 tests + new flare / stuck-flare / smoke / wave / ai tests)
2. `npx tsc --noEmit` clean
3. `npm run build` clean
4. Manual playtest passes (donny's call):
   - Press `Shift+F` from idle → flare visibly arcs out, sticks where it lands (wall, floor, or enemy)
   - Stuck flare emits visible procedural smoke for ~6 seconds
   - Hitting a zombie with a flare → zombie visibly panics + takes damage over time + emits smoke + dies if HP depletes
   - Press `R` → 5-wave round runs to completion (or until player dies), 1.5s intermission between waves feels snappy not draggy

## Stretch / F2 follow-ups (acceptable to defer)

- `F2.flare.charred-death` — charred-corpse death sprite for burn-killed enemies (placeholder = tint the normal death sprite)
- `F2.flare.sfx` — replace `FLARE_BURN_LOOP` placeholder with a real looping crackle sample
- `F2.flare.cap` — cap max concurrent flares per enemy if playtest finds the stack-everything-on-one-zombie tactic too cheesy

## Risks

- **Particle count under load** — 5 zombies × 2 flares each × 12 particles/sec = 120 particles/s for 6s = ~720 live smoke particles + existing gib + dynamite particles. `ParticlePool` should handle this but worth monitoring frame time during playtest.
- **Rapier body-attached position follow latency** — if the attached enemy moves fast, the stuck-flare position-update may visibly lag the body by 1 frame. Acceptable (sub-perceptual); call out if it ends up looking wrong.
- **Brain state-machine regression** — adding `Burning` to `ZombieState` is a breaking enum extension. Existing tests in `ai.test.ts` may need updates if any switch-statements assume exhaustiveness. Verify on first test run.

## Dispatch plan structure

Single dispatch task (no sub-task chain). Frontmatter:

```yaml
harness: pi
model: deepseek-v4-pro
project: /Users/donny/Projects/blud
allowed_tools: Read, Edit, Write, Bash, Grep, Glob
ns: claude:blud
```

Body = a "Read these files first → implement in this order → run these checks → commit" step list, with the design above as the spec reference.
