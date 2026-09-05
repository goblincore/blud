---
title: M5-A — Shotgun cultist (first non-zombie enemy)
date: 2026-04-25
status: queued for dispatch
parent: docs/superpowers/specs/2026-04-20-blud-design.md
---

# Goal

Add the **shotgun cultist** as Blud's second enemy type. Until now the only
enemy is `AxeZombie` — fun for melee chaos but every encounter feels the
same. The cultist introduces a **ranged threat that forces movement**,
making both the flare gun and dynamite feel meaningfully different to use.

This is one of two follow-ups dispatched in parallel today:
- **A (this spec):** the shotgun cultist enemy — graphics + minimal AI
- **B (sibling):** real weapon-switching — fix the awkward Shift+F UX so
  left-click fires whichever weapon is held

# Source-of-truth (NotBlood `aicult.cpp` + `dude.cpp` + `common_game.h`)

| Field             | Value                                              |
| ----------------- | -------------------------------------------------- |
| `kDudeCultistShotgun` | 202 (entry index 2 in `dudeInfo[]`)            |
| seqStartId        | 11520                                              |
| HP                | 40 (compare zombie 60 — cultist is squishier)      |
| Front speed       | 34952 BU/tic ≈ **2.3 m/s** (slower than zombie's 3.0) |
| Hear / see dist   | 10240 / 51200 BU                                   |
| AI states (we use): `cultistChase` (offset 9), `cultistSFire` (offset 6, 60 tic delay), `cultistRecoil` (offset 5), `cultistIdle` (offset 0) |
| Death (gibbed if dmg ≥ 160; normal otherwise) — uses GIB_THRESHOLD already in tuning.ts |

**Out of scope** (NotBlood's full cultist has all of these — we ship none):
- Dodge / strafe (`cultistDodge`, `aiMoveDodge`)
- Prone variants
- Search-after-lose-sight states
- Tesla / TNT / spray variants
- Swim states
- Drop ammo on death
- Spoken voice lines (just SFX placeholders)

# Pre-task setup (already committed — do NOT redo)

The dispatch starts with these assets in place on `main`:

- `scripts/extract_seq.py` extended with cultist seqStartId=11520 IDs
- `public/assets/animations/characters/cultist-shotgun-{idle,chase,fire,recoil,death-normal,death-gib}.json` — 6 SEQ manifests
- `public/assets/blood-tiles/2583-2890.png` — 306 sprite frames covering all six anims with their angle stride sets

The dispatch's only manifest-side action is **adding the six entries to
`public/assets/animations/index.json` under `characters:`** so the loader
picks them up.

# Architecture — mirror `AxeZombie`

The dispatch should follow the existing axe-zombie pattern as closely as
possible. The interesting bits live in three new files plus light edits to
six existing ones.

## Tuning (extend `src/game/gibs/tuning.ts`)

Add a new constant block alongside `AXE_ZOMBIE`:

```ts
// source: NotBlood dude.cpp dudeInfo[2] (kDudeCultistShotgun=202),
// aicult.cpp cultistSFire (60 tic delay = 0.5s), weapon.cpp shotgun fire dmg
export const SHOTGUN_CULTIST = {
  hp: 40,
  walkSpeedMps: 2.3,           // BU/tic 34952 → m/s
  aggroRadiusM: 18,            // half of see-dist (cultist sees better than zombie)
  fireRangeM: 12,              // stops moving and fires when within
  fireWindupSec: 0.5,          // 60 tics @ 120 TPS — how long Aim phase lasts
  fireCooldownSec: 1.5,        // delay after Recoil before next Fire
  recoilDurationSec: 0.4,      // how long Recoil phase lasts
} as const;

// Pellet-projectile shotgun blast
export const SHOTGUN_BLAST = {
  pelletCount: 7,              // canonical Blood shotgun pellet count
  pelletSpeedMps: 55,
  pelletMaxRangeM: 25,
  pelletDamage: 12,            // per pellet — 7 × 12 = 84 max if all hit
  spreadConeDeg: 14,           // half-angle of the pellet cone
} as const;
```

Reuse `ZOMBIE_GIB_PROFILE` for cultist gibs in this milestone — the cultist's
own gib tile palette is an F2 follow-up.

## Brain (new — `src/game/enemy/cultist-ai.ts`)

The cultist gets its own brain rather than extending `ZombieBrain` — the
state machine is different enough (Aim/Fire/Recoil) that a sibling class is
cleaner than a flag-laden `ZombieBrain`.

```ts
export enum CultistState {
  Idle = 'idle',
  Chase = 'chase',
  Aim = 'aim',          // saw player; winding up; not yet firing
  Fire = 'fire',        // discharge frame: spawn pellets, transition immediately
  Recoil = 'recoil',    // post-fire animation
  Dead = 'dead',
}
```

Transitions (driven by `update(dt, self, player, hasLineOfSight)`):

- `Idle` → `Chase` when `dist(self, player) < aggroRadiusM`
- `Chase` → `Aim` when `dist < fireRangeM` AND `hasLineOfSight`
- `Chase` → `Idle` when `dist > aggroRadiusM` (lose interest — no search state)
- `Aim` → `Fire` after `fireWindupSec` elapsed (one-frame state)
- `Fire` → `Recoil` immediately after the spawn-pellets hook fires
- `Recoil` → `Chase` after `recoilDurationSec`
- `*` → `Recoil` on `applyDamage` (interrupts Aim/Fire/Chase) — short stagger
- `*` → `Dead` when `hp <= 0`

`desiredVelocity()` returns chase-toward-player when `Chase`, zero in all
other live states (cultist plants feet to fire — no kiting in MVP).

`Aim` should be the only state where the cultist is "exposed" — give the
player a clear visual tell. The Aim → Fire transition is instant; the
"fire" anim is one frame held during Recoil.

**Pure-math fns** (TDD'd, mirroring `ai.ts`'s `nextStateGivenBurningContext`):
- `pelletSpread(angleIdx: number, total: number, coneDeg: number): number` —
  even angular distribution across the cone
- `withinFireRange(self: Vec3, player: Vec3, range: number): boolean`
- `pelletEndPos(spawn: Vec3, dir: Vec3, t: number, speed: number): Vec3` —
  straight-line projectile (no gravity)

`BrainHooks` (mirror `ai.ts`):
```ts
interface CultistHooks {
  onAggroTransition?: () => void;
  onAimStart?: () => void;     // play "aim" SFX or grunt
  onFire?: (origin: Vec3, dir: Vec3) => void;  // spawn pellets
  onRecoil?: () => void;       // play recoil SFX
  onIdleGroan?: () => void;
  onDeath?: () => void;
}
```

## Pellet projectile (new — `src/game/enemy/shotgun-pellet.ts`)

Lightweight per-tick swept-raycast projectile against the world + player
body. Mirrors `flare.ts`'s `advanceProjectile` pattern. Pure-math fns at
module scope:

- `pelletPosition(spawn: Vec3, dir: Vec3, t: number, speed: number): Vec3`
- `pelletDirInCone(forward: Vec3, angleIdx: number, total: number, coneDeg: number): Vec3`

`Pellet` class:
- `constructor(spawn, dir, speed, spawnTime, damage)`
- `update(now, raycastFn, applyDamageToPlayer): boolean` — returns false
  when expired (out of range or hit). Does a sweep raycast from previous
  position to current position. On hit:
  - if hit body is the player rigid body: `applyDamageToPlayer(damage, impulseFromDir)`
  - either way: extinguish

The cultist owns no per-pellet trail — a tiny tracer line drawn each frame
in `main.ts`'s render hook is fine for now (placeholder), or skip rendering
entirely in this milestone (you hear the SFX + see the recoil + take HP
damage — that's enough feel for a first pass).

## Concrete cultist (new — `src/game/enemy/shotgun-cultist.ts`)

Mirror `axe-zombie.ts` structure:
- Implements `GibbableDude`
- Spawns a RAPIER capsule body + collider (same dims as zombie — reuse the
  existing `ZOMBIE_BODY_SIZE` if exposed; otherwise hardcode 1.7m tall, 0.4m radius)
- Owns a `CultistBrain` instance (the new ai class above) wired to the same
  `BillboardAnimator` pattern using the new `cultist-shotgun-*` SEQ keys
- Handles death + gibbing exactly like zombie (reuse `ZOMBIE_GIB_PROFILE`)
- `onHit(amount, impulse, source)` decrements HP and triggers brain Recoil

The animator key mapping:

| State           | Anim key (already extracted)        |
| --------------- | ----------------------------------- |
| Idle            | `cultist-shotgun-idle`              |
| Chase           | `cultist-shotgun-chase`             |
| Aim / Fire      | `cultist-shotgun-fire`              |
| Recoil          | `cultist-shotgun-recoil`            |
| Dead (normal)   | `cultist-shotgun-death-normal`      |
| Dead (gibbed)   | `cultist-shotgun-death-gib`         |

## Cluster + spawn integration

`src/game/encounter/encounters.ts`:
- Extend `EnemyKind` union: `'zombie' | 'zombie-tough' | 'cultist-shotgun'`
- Add a sample wave preset that mixes types (or leave existing
  `WARMUP_ROUND` zombie-only — and expose the cultist via a new
  `MIXED_ROUND` encounter for now; plus a separate Shift+R bind to start it)

`src/game/arena.ts` `ZombieCluster.spawnOne`:
- Branch on `kind`: `'cultist-shotgun'` constructs `ShotgunCultist`,
  everything else still constructs `AxeZombie`
- The cluster's internal array should hold a union — either widen the type
  to `AxeZombie | ShotgunCultist` (both implement `GibbableDude`) or rename
  the cluster to `EnemyCluster` (spec doesn't require the rename — pick
  whichever is less churn)

`src/main.ts`:
- Wire pellet-spawn callback: `cultistHooks.onFire = (origin, dir) => spawnPellets(origin, dir)`
- Tick all live pellets each fixed step (similar to `stuckFlareRegistry` tick)
- Pellet damage to player: call `weaponPlayer.takeDamage(damage, impulse)`
- Add a temporary key — **press `T` to spawn one cultist at a perimeter point** for solo testing

# Acceptance

1. Press `T` → a shotgun cultist spawns. They walk toward you, stop at ~12m,
   "aim" anim plays for ~0.5s, then a pellet blast in a 14° cone.
2. Pellets hit the player and apply HP damage if line-of-sight.
3. Player can shoot the cultist with dynamite or flare — HP reaches zero,
   they ragdoll-die using the existing gib pipeline.
4. ≥ 160 single-hit damage gibs them straight to chunks (existing
   `GIB_THRESHOLD` path).
5. `npm run build` green, `npx tsc --noEmit` green, `npm test` — all
   pre-existing tests pass + the new `cultist-ai.test.ts` and
   `shotgun-pellet.test.ts` cover the pure-math fns.

# Out of scope (F2 follow-ups)

- Cultist-specific gib palette / blood color
- Dodge / strafe behavior
- Search after losing line-of-sight
- Voice lines (real SFX content — placeholder filenames only)
- Mixed wave runner pacing
- Cultist drop pickups
