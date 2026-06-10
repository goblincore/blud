# NotBlood-Faithful Explosion Outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port NotBlood's three-tier explosion outcome model — survivors launched airborne alive, sub-threshold kills become flung intact corpses that persist and re-gib, full gibs spawn the head alongside (not instead of) the body-chunk burst.

**Architecture:** `GibSystem.spawnExplosion` computes damage and a concussion launch velocity separately (decoupled, like NotBlood's `ConcussSprite`), then branches: corpse → instant re-gib; damage ≥ 160 → full gib; else → `takeDamage` with the launch velocity. Enemies handle launches themselves: a shared pure ballistic integrator moves the kinematic body (alive or dead), and each brain FSM gains a `Launched` state. The old `LaunchedCorpseManager` is deleted.

**Tech Stack:** TypeScript, Three.js, Rapier3D (`@dimforge/rapier3d-compat`), vitest. Spec: `docs/superpowers/specs/2026-06-10-explosion-outcomes-design.md`.

**Verification commands** (used throughout):
- `npx tsc --noEmit` — type check
- `npx vitest run` — full test suite
- `npm run build` — production build

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/game/gibs/tuning.ts` | Modify | Add `EXPLOSION_LAUNCH` + `CORPSE` constant blocks; bump `ZOMBIE_GIB_PROFILE.bodyPartCount` to `{min:4, max:7}` |
| `src/game/gibs/index.ts` | Modify | `concussionVelocity` pure fn; three-tier outcome selector; `popHead`; remove launched-corpse branch + `onLaunchedCorpse` field; `isCorpse` on `GibbableDude` |
| `src/game/gibs/explosion-math.test.ts` | Modify | Tests for `concussionVelocity` |
| `src/game/enemy/ballistic.ts` | Create | Pure kinematic ballistic integrator shared by zombie + cultist |
| `src/game/enemy/ballistic.test.ts` | Create | Tests for the integrator |
| `src/game/enemy/ai.ts` | Modify | `ZombieState.Launched` + `launch()`/`land()` |
| `src/game/enemy/ai.test.ts` | Modify | Launched-state transition tests |
| `src/game/enemy/cultist-ai.ts` | Modify | `CultistState.Launched` + `launch()`/`land()` |
| `src/game/enemy/cultist-ai.test.ts` | Modify | Launched-state transition tests |
| `src/game/gibs/chunks.ts` | Modify | Head-launch override param; public `spawnHeadChunk`; impulse→velocity unit rescale |
| `src/game/enemy/axe-zombie.ts` | Modify | Replace fling hack with ballistic mode; corpse persistence; head-pop roll |
| `src/game/enemy/shotgun-cultist.ts` | Modify | Same as zombie (no head-pop — profile gates it) |
| `src/game/arena.ts` | Modify | Corpse cap reaping; head-pop wiring |
| `src/main.ts` | Modify | Remove `LaunchedCorpseManager` wiring |
| `src/game/gibs/launched-corpse.ts` | **Delete** | Superseded |
| `src/game/gibs/launched-corpse.test.ts` | **Delete** | Superseded |

---

### Task 1: Tuning constants + `concussionVelocity` pure function

NotBlood's `ConcussSprite` (actor.cpp:2677) adds velocity to every movable sprite in radius, with a vertical component. We model it as: radial unit vector from blast to dude, with an upward bias added before re-normalizing, scaled to m/s.

**Files:**
- Modify: `src/game/gibs/tuning.ts`
- Modify: `src/game/gibs/index.ts`
- Test: `src/game/gibs/explosion-math.test.ts`

- [ ] **Step 1: Add constants to `src/game/gibs/tuning.ts`**

Append after the `GIB_THRESHOLD` export (line ~45):

```ts
// ——— Concussion launch (explosion physics on dudes) ————————————
// source: NotBlood actor.cpp:2677 ConcussSprite — adds velocity (incl. vertical)
// to every kPhysMove sprite in explosion proximity, alive or dead, decoupled
// from damage. Magnitude scales with size/mass/dist²; we collapse the
// mass/size term (all current dudes are human-sized) into velocityScale.
export const EXPLOSION_LAUNCH = {
  velocityScale: 0.012,     // impulse(≤900) × falloff → m/s; point-blank ≈ 10.8 m/s
  upwardBias: 0.5,          // added to normalized radial dir y before re-normalize
                            // (ConcussSprite z-term: ground blast kicks dudes upward)
  minLaunchSpeedMps: 2.0,   // below this no ballistic launch — just normal stagger
  gravityMps2: 18,          // heavier than real — Blood bodies arc fast, land hard
  headSpawnHeightM: 1.4,    // head gib spawns at sprite top (NotBlood GetSpriteExtents top)
  headVelInherit: 0.5,      // head inherits half body velocity (NotBlood xvel>>1)
  headUpKickMps: 5.0,       // NotBlood zvel -0xccccc up-kick equivalent (explosion gib)
  headPopChance: 0.25,      // Chance(0x4000) — normal-death head-pop signature
  headPopUpKickMps: 3.5,    // gentler up-kick for the normal-death head-pop
} as const;

// ——— Corpse persistence ————————————————————————————————
// source: NotBlood actor.cpp:7887 DudeToGibCallback1 — dead dude becomes a
// kThingBloodChunks THING with health 8 (thingInfo[26]) and full gib
// vulnerability (data4=319). It persists and re-gibs on any later explosion.
export const CORPSE = {
  hp: 8,                    // documented for fidelity; Blud re-gibs corpses unconditionally
  maxCorpses: 12,           // cluster cap — oldest corpse force-reaped beyond this
  reapAfterSec: 30,         // corpse lifetime before reap
} as const;
```

- [ ] **Step 2: Bump `ZOMBIE_GIB_PROFILE.bodyPartCount` in `src/game/gibs/tuning.ts`**

NotBlood `gibHuman` spawns 7 body chunks (gib.cpp:188, GIBTYPE_15). Change:

```ts
export const ZOMBIE_GIB_PROFILE: GibProfile = {
  fleshPicnums: [...HUMANOID_FLESH_PICNUMS],
  bonePicnums: BONE_PICNUMS,
  boneWeight: 0.2,
  bodyPartCount: { min: 4, max: 7 },   // NotBlood gibHuman = 7 chunks (gib.cpp:188)
  chunkCount: { min: 8, max: 14 },
  spawnsKickableHead: true, // Blood signature — kickable zombie head
};
```

Leave `CULTIST_GIB_PROFILE` at `{min: 2, max: 4}` (cultists use a different gib table in the source).

- [ ] **Step 3: Write failing tests for `concussionVelocity`**

Append to `src/game/gibs/explosion-math.test.ts`:

```ts
import { concussionVelocity } from './index';
import { EXPLOSION_LAUNCH } from './tuning';

describe('concussionVelocity', () => {
  const origin = { x: 0, y: 0, z: 0 };

  it('returns straight-up velocity at zero distance (degenerate direction)', () => {
    const v = concussionVelocity(origin, { x: 0, y: 0, z: 0 }, 900);
    expect(v.x).toBe(0);
    expect(v.z).toBe(0);
    expect(v.y).toBeCloseTo(900 * EXPLOSION_LAUNCH.velocityScale, 5);
  });

  it('magnitude equals impulse × velocityScale', () => {
    const v = concussionVelocity(origin, { x: 3, y: 0, z: 4 }, 900);
    const mag = Math.hypot(v.x, v.y, v.z);
    expect(mag).toBeCloseTo(900 * EXPLOSION_LAUNCH.velocityScale, 5);
  });

  it('always has a positive upward component (ground blast kicks up)', () => {
    const v = concussionVelocity(origin, { x: 5, y: 0, z: 0 }, 450);
    expect(v.y).toBeGreaterThan(0);
  });

  it('points away from the blast in XZ', () => {
    const v = concussionVelocity(origin, { x: -2, y: 0, z: 7 }, 450);
    expect(v.x).toBeLessThan(0);
    expect(v.z).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/game/gibs/explosion-math.test.ts`
Expected: FAIL — `concussionVelocity` is not exported from `./index`.

- [ ] **Step 5: Implement `concussionVelocity` in `src/game/gibs/index.ts`**

Add to the "Pure falloff math" section (after `radialImpulseVector`), and add `EXPLOSION_LAUNCH` to the existing `./tuning` import:

```ts
/**
 * Concussion launch velocity for a dude in explosion range — NotBlood
 * ConcussSprite (actor.cpp:2677): radial direction with an upward bias
 * (ground blast kicks dudes up), magnitude in m/s. Applied to alive dudes
 * AND corpses — physics is decoupled from damage.
 */
export function concussionVelocity(origin: Vec3, target: Vec3, impulseMag: number): Vec3 {
  const speed = impulseMag * EXPLOSION_LAUNCH.velocityScale;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return { x: 0, y: speed, z: 0 };
  const ux = dx / len;
  const uy = dy / len + EXPLOSION_LAUNCH.upwardBias;
  const uz = dz / len;
  const ulen = Math.sqrt(ux * ux + uy * uy + uz * uz);
  return { x: (ux / ulen) * speed, y: (uy / ulen) * speed, z: (uz / ulen) * speed };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/game/gibs/explosion-math.test.ts`
Expected: PASS (all, including pre-existing falloff tests).

- [ ] **Step 7: Commit**

```bash
git add src/game/gibs/tuning.ts src/game/gibs/index.ts src/game/gibs/explosion-math.test.ts
git commit -m "feat(gibs): concussion launch velocity + EXPLOSION_LAUNCH/CORPSE tuning"
```

---

### Task 2: Shared ballistic integrator

Pure module both enemies use to fly their kinematic bodies (alive launches and flung corpses).

**Files:**
- Create: `src/game/enemy/ballistic.ts`
- Test: `src/game/enemy/ballistic.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/game/enemy/ballistic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stepBallistic, type BallisticMotion } from './ballistic';

const G = 18;

describe('stepBallistic', () => {
  it('moves along velocity and applies gravity', () => {
    const m: BallisticMotion = { vel: { x: 4, y: 6, z: 0 }, groundY: 0 };
    const r = stepBallistic({ x: 0, y: 0, z: 0 }, m, 0.1, G);
    expect(r.landed).toBe(false);
    expect(r.pos.x).toBeCloseTo(0.4, 5);
    expect(r.vel.y).toBeCloseTo(6 - G * 0.1, 5);   // gravity applied
    expect(r.pos.y).toBeCloseTo((6 - G * 0.1) * 0.1, 5);
  });

  it('does not land while ascending from ground level', () => {
    const m: BallisticMotion = { vel: { x: 0, y: 5, z: 0 }, groundY: 0 };
    const r = stepBallistic({ x: 0, y: 0, z: 0 }, m, 0.016, G);
    expect(r.landed).toBe(false);
    expect(r.pos.y).toBeGreaterThan(0);
  });

  it('lands clamped to groundY when falling through it', () => {
    const m: BallisticMotion = { vel: { x: 2, y: -10, z: 0 }, groundY: 1.0 };
    const r = stepBallistic({ x: 0, y: 1.05, z: 0 }, m, 0.1, G);
    expect(r.landed).toBe(true);
    expect(r.pos.y).toBe(1.0);
    expect(r.vel).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('full flight eventually lands at groundY', () => {
    let pos = { x: 0, y: 0, z: 0 };
    const m: BallisticMotion = { vel: { x: 3, y: 8, z: 1 }, groundY: 0 };
    let landed = false;
    for (let i = 0; i < 600 && !landed; i++) {
      const r = stepBallistic(pos, m, 1 / 60, G);
      pos = r.pos;
      m.vel = r.vel;
      landed = r.landed;
    }
    expect(landed).toBe(true);
    expect(pos.y).toBe(0);
    expect(pos.x).toBeGreaterThan(1);   // travelled horizontally
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/game/enemy/ballistic.test.ts`
Expected: FAIL — module `./ballistic` not found.

- [ ] **Step 3: Implement `src/game/enemy/ballistic.ts`**

```ts
import type { Vec3 } from '../gibs/particles';

/**
 * Kinematic ballistic flight for launched enemies — both alive (NotBlood
 * ConcussSprite throws survivors airborne) and dead (sub-160 explosion kills
 * keep their concussion velocity → intact tumbling corpse). The enemy's
 * kinematic body is moved by integrating this motion in update().
 */
export interface BallisticMotion {
  vel: Vec3;
  /** Y to land at — captured from the body's translation at launch time. */
  groundY: number;
}

export interface BallisticStep {
  pos: Vec3;
  vel: Vec3;
  landed: boolean;
}

/** One integration step. Pure — caller stores the returned vel back into motion. */
export function stepBallistic(
  pos: Vec3,
  motion: BallisticMotion,
  dt: number,
  gravityMps2: number,
): BallisticStep {
  const vy = motion.vel.y - gravityMps2 * dt;
  const next = {
    x: pos.x + motion.vel.x * dt,
    y: pos.y + vy * dt,
    z: pos.z + motion.vel.z * dt,
  };
  if (vy <= 0 && next.y <= motion.groundY) {
    return {
      pos: { x: next.x, y: motion.groundY, z: next.z },
      vel: { x: 0, y: 0, z: 0 },
      landed: true,
    };
  }
  return { pos: next, vel: { x: motion.vel.x, y: vy, z: motion.vel.z }, landed: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/game/enemy/ballistic.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/enemy/ballistic.ts src/game/enemy/ballistic.test.ts
git commit -m "feat(enemy): shared kinematic ballistic integrator"
```

---

### Task 3: `ZombieBrain` Launched state

**Files:**
- Modify: `src/game/enemy/ai.ts`
- Test: `src/game/enemy/ai.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/game/enemy/ai.test.ts` (inside the top-level `describe('ZombieBrain')` or as a new describe — match file conventions):

```ts
describe('ZombieBrain Launched state', () => {
  it('launch() moves an alive brain into Launched', () => {
    const b = new ZombieBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }); // → Chase
    b.launch();
    expect(b.state).toBe(ZombieState.Launched);
  });

  it('launch() is a no-op when Dead', () => {
    const b = new ZombieBrain(INIT);
    b.applyDamage(9999);
    b.launch();
    expect(b.state).toBe(ZombieState.Dead);
  });

  it('AI is suspended while Launched (update does not change state)', () => {
    const b = new ZombieBrain(INIT);
    b.launch();
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }); // melee range
    expect(b.state).toBe(ZombieState.Launched);
  });

  it('desiredVelocity is zero while Launched', () => {
    const b = new ZombieBrain(INIT);
    b.launch();
    const v = b.desiredVelocity({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });
    expect(v).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('land() transitions Launched → Stagger, then recovers to Chase', () => {
    const b = new ZombieBrain(INIT);
    b.launch();
    b.land();
    expect(b.state).toBe(ZombieState.Stagger);
    // stagger expires after staggerSec
    b.update(1.0, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(b.state).toBe(ZombieState.Chase);
  });

  it('land() is a no-op when not Launched', () => {
    const b = new ZombieBrain(INIT);
    b.land();
    expect(b.state).toBe(ZombieState.Idle);
  });

  it('non-fatal damage while Launched stays Launched (no stagger interrupt)', () => {
    const b = new ZombieBrain(INIT);
    b.launch();
    b.applyDamage(5);
    expect(b.state).toBe(ZombieState.Launched);
  });

  it('fatal damage while Launched → Dead', () => {
    const b = new ZombieBrain(INIT);
    b.launch();
    b.applyDamage(9999);
    expect(b.state).toBe(ZombieState.Dead);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/game/enemy/ai.test.ts`
Expected: FAIL — `ZombieState.Launched` / `launch` do not exist.

- [ ] **Step 3: Implement in `src/game/enemy/ai.ts`**

3a. Add to the enum:

```ts
export enum ZombieState {
  Idle = 'idle',
  Chase = 'chase',
  Attack = 'attack',
  Stagger = 'stagger',
  Dead = 'dead',
  Burning = 'burning',
  /** Airborne from explosion concussion — AI suspended until landing. */
  Launched = 'launched',
}
```

3b. In `update()`, directly after the `if (this.hp <= 0) {...}` block (line ~84), add:

```ts
    // Airborne — AI suspended; the entity integrates ballistic motion and
    // calls land() when the body reaches the ground.
    if (this.state === ZombieState.Launched) return;
```

3c. In `desiredVelocity()`, extend the first early-return:

```ts
    if (
      this.state === ZombieState.Dead ||
      this.state === ZombieState.Attack ||
      this.state === ZombieState.Launched
    ) return { x: 0, y: 0, z: 0 };
```

3d. In `applyDamage()`, guard the stagger transition (currently `else if (this.state !== ZombieState.Burning)`):

```ts
    } else if (this.state !== ZombieState.Burning && this.state !== ZombieState.Launched) {
      // Don't stagger out of Burning (panic-thrash IS the stagger) or
      // Launched (mid-air — landing handles recovery)
      this.state = ZombieState.Stagger;
      this.staggerSec = 0.25;
    }
```

3e. Add the two methods (after `setStuckFlareCount`):

```ts
  /** Explosion concussion threw this zombie airborne (alive). No-op if Dead. */
  launch(): void {
    if (this.state === ZombieState.Dead) return;
    this.state = ZombieState.Launched;
  }

  /** Ballistic flight ended — recover through a brief stagger. */
  land(): void {
    if (this.state !== ZombieState.Launched) return;
    this.state = ZombieState.Stagger;
    this.staggerSec = 0.3;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/game/enemy/ai.test.ts`
Expected: PASS (all new + all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/game/enemy/ai.ts src/game/enemy/ai.test.ts
git commit -m "feat(ai): ZombieBrain Launched state for explosion concussion"
```

---

### Task 4: `CultistBrain` Launched state

**Files:**
- Modify: `src/game/enemy/cultist-ai.ts`
- Test: `src/game/enemy/cultist-ai.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/game/enemy/cultist-ai.test.ts` (the file constructs brains as `new CultistBrain({ hp, speed }, hooks?, getNow?)` — match existing helper conventions in that file):

```ts
describe('CultistBrain Launched state', () => {
  const INIT = { hp: 40, speed: 2.3 };

  it('launch() moves an alive brain into Launched', () => {
    const b = new CultistBrain(INIT);
    b.launch();
    expect(b.state).toBe(CultistState.Launched);
  });

  it('launch() is a no-op when Dead', () => {
    const b = new CultistBrain(INIT);
    b.applyDamage(9999);
    b.launch();
    expect(b.state).toBe(CultistState.Dead);
  });

  it('AI is suspended while Launched', () => {
    const b = new CultistBrain(INIT);
    b.launch();
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);
    expect(b.state).toBe(CultistState.Launched);
  });

  it('desiredVelocity is zero while Launched', () => {
    const b = new CultistBrain(INIT);
    b.launch();
    expect(b.desiredVelocity({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }))
      .toEqual({ x: 0, y: 0, z: 0 });
  });

  it('land() transitions Launched → Recoil', () => {
    let now = 0;
    const b = new CultistBrain(INIT, undefined, () => now);
    b.launch();
    b.land();
    expect(b.state).toBe(CultistState.Recoil);
    // recoil expires → Chase
    now = 1.0;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);
    expect(b.state).toBe(CultistState.Chase);
  });

  it('non-fatal damage while Launched stays Launched', () => {
    const b = new CultistBrain(INIT);
    b.launch();
    b.applyDamage(5);
    expect(b.state).toBe(CultistState.Launched);
  });

  it('fatal damage while Launched → Dead', () => {
    const b = new CultistBrain(INIT);
    b.launch();
    b.applyDamage(9999);
    expect(b.state).toBe(CultistState.Dead);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/game/enemy/cultist-ai.test.ts`
Expected: FAIL — `CultistState.Launched` / `launch` do not exist.

- [ ] **Step 3: Implement in `src/game/enemy/cultist-ai.ts`**

3a. Add to the enum:

```ts
export enum CultistState {
  Idle = 'idle',
  Chase = 'chase',
  Aim = 'aim',
  Fire = 'fire',
  Recoil = 'recoil',
  Dead = 'dead',
  Burning = 'burning',
  /** Airborne from explosion concussion — AI suspended until landing. */
  Launched = 'launched',
}
```

3b. In `update()`, directly after the `if (this.hp <= 0) {...}` block (line ~174), add:

```ts
    // Airborne — AI suspended; the entity integrates ballistic motion and
    // calls land() when the body reaches the ground.
    if (this.state === CultistState.Launched) return;
```

(The hp check stays above this so flare DoT can still kill mid-air.)

3c. `desiredVelocity()` needs no change — it already returns zero for any state that isn't `Chase`/`Burning`, and `Launched` is neither.

3d. In `applyDamage()`, before the Recoil transition (after the Burning early-return), add:

```ts
    // Mid-air: no Recoil interrupt — landing handles recovery
    if (this.state === CultistState.Launched) return;
```

3e. Add the two methods (after `setIsFlareIgnited`):

```ts
  /** Explosion concussion threw this cultist airborne (alive). No-op if Dead. */
  launch(): void {
    if (this.state === CultistState.Dead) return;
    this.state = CultistState.Launched;
  }

  /** Ballistic flight ended — recover through Recoil. */
  land(): void {
    if (this.state !== CultistState.Launched) return;
    this.state = CultistState.Recoil;
    this.recoilEnteredAt = this.getNowSec();
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/game/enemy/cultist-ai.test.ts`
Expected: PASS (all new + all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/game/enemy/cultist-ai.ts src/game/enemy/cultist-ai.test.ts
git commit -m "feat(ai): CultistBrain Launched state for explosion concussion"
```

---

### Task 5: ChunkSystem — head launch override + velocity units

Two changes: (1) the head gib can launch from an explicit origin/velocity (NotBlood spawns it at the sprite **top** with `(xvel/2, yvel/2, -0xccccc)`); (2) `spawnChunks`' `impulse` parameter changes meaning from raw Blood impulse (≤900-scale, multiplied by 0.025) to **launch velocity in m/s** (≤~11, multiplied by an inherit factor). No unit tests exist for ChunkSystem (Rapier-coupled); verify by type-check + the GibSystem caller updated in Task 6.

**Files:**
- Modify: `src/game/gibs/chunks.ts`

- [ ] **Step 1: Add the `HeadLaunch` type and update `spawnChunks`**

In `src/game/gibs/chunks.ts`, add above the class:

```ts
/** Explicit spawn origin + velocity for the head gib — NotBlood launches the
 *  head from the sprite TOP at half the body's velocity plus an up-kick
 *  (actor.cpp:3196: GetSpriteExtents top, vel (xvel/2, yvel/2, -0xccccc)). */
export interface HeadLaunch {
  origin: Vec3;
  vel: Vec3;
}
```

Replace `spawnChunks` signature and head call:

```ts
  /**
   * Spawn body-chunks at `origin`, launched radially + augmented by `launchVel`
   * (the explosion's concussion velocity for this dude, in m/s).
   */
  spawnChunks(
    origin: Vec3,
    launchVel: Vec3,
    profile: GibProfile,
    now: number,
    rng: () => number = Math.random,
    headLaunch?: HeadLaunch,
  ): void {
    const count = rollChunkCount(profile.bodyPartCount, rng);
    for (let i = 0; i < count; i++) {
      const picnum = pickChunkPicnum(profile, rng);
      this.spawnOne(origin, launchVel, picnum, i, count, now);
    }
    // Bouncing head — the one you can kick around. Larger sphere collider, higher
    // restitution, no settle-despawn (age-despawn only, longer lifetime).
    // Gated on profile.spawnsKickableHead — only zombies drop the iconic head.
    if (profile.spawnsKickableHead) {
      const h = headLaunch ?? {
        origin: { x: origin.x, y: origin.y + 0.3, z: origin.z },
        vel: {
          x: launchVel.x * 0.5 + (Math.random() - 0.5) * 2,
          y: 4.0 + Math.random() * 2.0,
          z: launchVel.z * 0.5 + (Math.random() - 0.5) * 2,
        },
      };
      this.spawnHeadChunk(h.origin, h.vel, now);
    }

    // FIFO-evict if over capacity
    while (this.chunks.length > this.capacity) {
      this.despawn(this.chunks[0]!);
      this.chunks.shift();
    }
  }
```

- [ ] **Step 2: Refactor `spawnHead` → public `spawnHeadChunk(origin, vel, now)`**

Replace the private `spawnHead(origin, impulse, now)` method with a public method that takes an explicit velocity (the body-desc/collider/billboard/trail code stays identical — only the position/velocity lines change):

```ts
  /** Spawn the iconic kickable zombie head at an explicit origin + velocity.
   *  Public: also used for the 25% normal-death head-pop (GibSystem.popHead). */
  spawnHeadChunk(origin: Vec3, vel: Vec3, now: number): void {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(origin.x, origin.y, origin.z)
      .setLinearDamping(0.4) // more drag so it settles into rolling, not sliding forever
      .setAngularDamping(0.3);
    const body = this.world.createRigidBody(bodyDesc);

    // Ball collider — rolls when kicked, pronouncedly bouncy
    const colliderDesc = RAPIER.ColliderDesc.ball(0.18)
      .setRestitution(0.65)
      .setFriction(0.7)
      .setDensity(0.4);
    this.world.createCollider(colliderDesc, body);

    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    body.setAngvel(
      { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 },
      true,
    );
    // ... (billboard mesh, trail, chunks.push with isHead: true — UNCHANGED from
    //      the old spawnHead body, lines 104-144)
  }
```

Keep everything from `// Larger billboard than regular chunks` down identical.

- [ ] **Step 3: Rescale chunk velocity inherit in `spawnOne`**

The `impulse` param is now a velocity in m/s. Rename the parameter to `launchVel` and replace the `0.025` factor:

```ts
    const radialSpeed = 5.0 + Math.random() * 4.0;   // 5-9 m/s (was 2.5-4.5)
    body.setLinvel(
      {
        // chunks inherit 60% of the dude's concussion velocity atop the radial burst
        x: radial.x * radialSpeed + launchVel.x * 0.6,
        y: radial.y * radialSpeed + launchVel.y * 0.6,
        z: radial.z * radialSpeed + launchVel.z * 0.6,
      },
      true,
    );
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/game/gibs/index.ts` (still passing old-unit impulse — fixed in Task 6). If other files error, fix them now.

- [ ] **Step 5: Commit**

```bash
git add src/game/gibs/chunks.ts
git commit -m "feat(chunks): head-launch override + m/s velocity units for spawnChunks"
```

---

### Task 6: GibSystem three-tier outcome selector + delete LaunchedCorpseManager

The core rewire. Must land as one commit to keep `tsc` green (GibSystem field removal breaks `main.ts` otherwise).

**Files:**
- Modify: `src/game/gibs/index.ts`
- Modify: `src/main.ts`
- Delete: `src/game/gibs/launched-corpse.ts`, `src/game/gibs/launched-corpse.test.ts`

- [ ] **Step 1: Update `GibbableDude` and remove launched-corpse import in `src/game/gibs/index.ts`**

Remove the line `import { LAUNCHED_CORPSE } from './launched-corpse';`. Add `isCorpse` to the interface:

```ts
export interface GibbableDude {
  pos: Vec3;
  hp: number;
  id: string;                         // stable identity
  takeDamage(amount: number, impulse: Vec3): void;
  /** Called by the gib system when this dude is gibbed (damage ≥ GIB_THRESHOLD).
   *  Implementations should hide the body's sprite immediately — chunks replace it. */
  onGibbed?(): void;
  /** True when dead-but-not-gibbed — a persistent corpse. Corpses re-gib
   *  unconditionally on any explosion contact (NotBlood: kThingBloodChunks
   *  thing with health 8, actor.cpp:7887). */
  readonly isCorpse?: boolean;
  kind: 'player' | 'axe-zombie' | 'cultist-shotgun';
  /** M3: per-enemy gib customization. Required on all dudes. */
  gibProfile: GibProfile;
}
```

- [ ] **Step 2: Remove the `onLaunchedCorpse` constructor field**

Delete from the `GibSystem` constructor:

```ts
    /** Called when a launched-corpse outcome triggers (impulse above threshold). */
    public onLaunchedCorpse?: (pos: Vec3, impulse: Vec3, now: number) => void,
```

- [ ] **Step 3: Rewrite the per-dude branch in `spawnExplosion`**

Replace the whole `for (const dude of [...this.dudes])` loop body from the damage computation down:

```ts
      // Damage scaled by Blood's tick-stack equivalent (see DAMAGE_TICK_STACK)
      const linearFall = 1 - dist / radiusM;
      const damage = (info.damage + info.damageRange) * DAMAGE_TICK_STACK * linearFall;
      // NotBlood ConcussSprite: physics decoupled from damage — every dude in
      // range gets launch velocity, alive or dead (m/s, with upward bias).
      const launchVel = concussionVelocity(pos, dude.pos, info.impulse * linearFall);

      console.log(`[gibs]   ${dude.kind} ${dude.id} at dist=${dist.toFixed(2)}m → damage=${damage.toFixed(0)} (gib@${GIB_THRESHOLD})${dude.isCorpse ? ' [corpse]' : ''}`);

      if (dude.isCorpse) {
        // Corpse re-gib: NotBlood corpses are kThingBloodChunks things (hp 8) —
        // any explosion contact bursts them, no 160 threshold.
        this.triggerGib(dude.pos, launchVel, dude.gibProfile, now);
        dude.onGibbed?.();
        this.unregisterDude(dude.id);
      } else if (damage >= GIB_THRESHOLD) {
        this.triggerGib(dude.pos, launchVel, dude.gibProfile, now);
        dude.onGibbed?.();
        if (dude.kind === 'player') this.onPlayerGibbed();
        else this.unregisterDude(dude.id);
      } else {
        // Sub-threshold: dude takes damage + the concussion velocity. If it
        // dies, the entity flings the corpse ballistically (NotBlood sub-160
        // kDamageFall conversion) and STAYS registered as a re-gibbable corpse.
        dude.takeDamage(damage, launchVel);
      }
```

- [ ] **Step 4: Launch the head from head height in `triggerGib`, add `popHead`**

Replace `triggerGib` and add `popHead` after it. Add `EXPLOSION_LAUNCH` to the `./tuning` import (done in Task 1) and import `HeadLaunch` is not needed (object literal):

```ts
  triggerGib(pos: Vec3, launchVel: Vec3, profile: GibProfile, now: number): void {
    console.log(`[gibs] GIB! at (${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)})`);
    // NotBlood actor.cpp:3196 — head gib spawns at the sprite TOP with
    // (xvel/2, yvel/2, -0xccccc up-kick), alongside the body-chunk burst.
    const headLaunch = profile.spawnsKickableHead
      ? {
          origin: { x: pos.x, y: pos.y + EXPLOSION_LAUNCH.headSpawnHeightM, z: pos.z },
          vel: {
            x: launchVel.x * EXPLOSION_LAUNCH.headVelInherit,
            y: EXPLOSION_LAUNCH.headUpKickMps,
            z: launchVel.z * EXPLOSION_LAUNCH.headVelInherit,
          },
        }
      : undefined;
    this.chunks.spawnChunks(pos, launchVel, profile, now, Math.random, headLaunch);
    const burstCount = profile.chunkCount.max * 2;
    this.particles.emitBurst(pos, {
      tile: GIB_BURST.tile,
      count: burstCount,
      speedMin: GIB_BURST.speedMin,
      speedMax: GIB_BURST.speedMax,
      gravity: 9.8,
      airdrag: 0.3,
      lifetimeSec: 2.0,
      size: 0.5,
    });
  }

  /** Blood signature: 25% of normal zombie deaths pop the head off with a
   *  blood burst (NotBlood actor.cpp:3205, Chance(0x4000) + GIBTYPE_27). */
  popHead(pos: Vec3, now: number): void {
    this.chunks.spawnHeadChunk(
      { x: pos.x, y: pos.y + EXPLOSION_LAUNCH.headSpawnHeightM, z: pos.z },
      {
        x: (Math.random() - 0.5) * 1.5,
        y: EXPLOSION_LAUNCH.headPopUpKickMps,
        z: (Math.random() - 0.5) * 1.5,
      },
      now,
    );
    this.particles.emitBurst(pos, {
      tile: GIB_BURST.tile,
      count: 6,
      speedMin: 1.5,
      speedMax: 4.0,
      gravity: 9.8,
      airdrag: 0.3,
      lifetimeSec: 1.5,
      size: 0.4,
    });
  }
```

- [ ] **Step 5: Remove LaunchedCorpseManager wiring from `src/main.ts`**

Remove these (line numbers from current main):
- line 23: `import { LaunchedCorpseManager, type LaunchedCorpseDeps } from './game/gibs/launched-corpse';`
- line ~262: `const launchedCorpses = new LaunchedCorpseManager();`
- lines ~266-272: the whole `gibs.onLaunchedCorpse = (pos, impulse, now) => {...}` block
- line ~283 and ~499: `launchedCorpses.clear({ world: physics.world, scene, getTileTexture });`
- line ~671: `launchedCorpses.update(now, camera, { world: physics.world, scene, getTileTexture });`

If `getTileTexture` is now unused in those scopes, remove its dangling references only if unused everywhere in the file (check with grep first — it's likely used by other systems).

- [ ] **Step 6: Delete the launched-corpse files**

```bash
git rm src/game/gibs/launched-corpse.ts src/game/gibs/launched-corpse.test.ts
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean. Tests pass — EXCEPT possibly stale assertions referencing the launched-corpse path; if any test references `onLaunchedCorpse`/`LAUNCHED_CORPSE`, delete those test cases (the mechanic is gone by design).

- [ ] **Step 8: Commit**

```bash
git add -A src/game/gibs src/main.ts
git commit -m "feat(gibs): three-tier explosion outcomes; delete LaunchedCorpseManager

NotBlood-faithful: corpse re-gib (no threshold), gib >=160 with head from
head height alongside full chunk burst, sub-160 takes damage + concussion
velocity. Spec: docs/superpowers/specs/2026-06-10-explosion-outcomes-design.md"
```

---

### Task 7: AxeZombie — ballistic launches, corpse persistence, head-pop

**Files:**
- Modify: `src/game/enemy/axe-zombie.ts`

- [ ] **Step 1: Replace fling state with ballistic state**

In `src/game/enemy/axe-zombie.ts`:

1a. Delete the `FLING_DURATION_SEC` and `FLING_IMPULSE_SCALE` constants (lines ~39-44) and their doc comment.

1b. Update imports:

```ts
import { AXE_ZOMBIE, ZOMBIE_GIB_PROFILE, EXPLOSION_LAUNCH, CORPSE } from '../gibs/tuning';
import { stepBallistic, type BallisticMotion } from './ballistic';
```

1c. Replace the fields:

```ts
  /** Non-zero while the zombie is flying from an explosion that killed but didn't gib it. */
  private flingVel: Vec3 | null = null;
  private flingTimer = 0;
```

with:

```ts
  /** Airborne ballistic motion from explosion concussion (alive or dead). */
  private ballistic: BallisticMotion | null = null;
```

1d. Add the head-pop callback field next to `onBurnDeath`:

```ts
  /** Called on the 25% normal-death head-pop (Blood signature). Wired by the cluster. */
  onHeadPop?: (pos: Vec3) => void;
```

1e. Add to `STATE_ANIM_MAP`:

```ts
  [ZombieState.Launched]: 'zombie-recoil',
```

- [ ] **Step 2: Rewrite the movement section of `update()`**

Replace the `if (this.flingVel && this.flingTimer > 0) {...} else {...}` block (lines ~195-213) with:

```ts
    const t = this.body.translation();
    if (this.ballistic) {
      // Airborne — integrate ballistic motion (NotBlood ConcussSprite throws
      // dudes alive or dead; the death anim plays on the flying body).
      const step = stepBallistic(
        { x: t.x, y: t.y, z: t.z },
        this.ballistic,
        dt,
        EXPLOSION_LAUNCH.gravityMps2,
      );
      this.body.setNextKinematicTranslation(step.pos);
      this.ballistic.vel = step.vel;
      if (step.landed) {
        this.ballistic = null;
        this.brain.land(); // no-op if Dead — corpse just rests where it fell
        // land() runs AFTER this frame's prev/state anim diff — trigger explicitly
        // (same state-change-invisible-to-diff trap as the M5-D onBurnDeath bug)
        if (this.brain.state === ZombieState.Stagger) {
          this.anim.play('zombie-recoil', now);
        }
      }
    } else {
      // Kinematic move driven by AI
      const v = this.brain.desiredVelocity(this.pos, playerPos);
      this.body.setNextKinematicTranslation({ x: t.x + v.x * dt, y: t.y, z: t.z + v.z * dt });
      // Update facing direction from velocity (skip when dead)
      if (this.brain.state !== ZombieState.Dead && Math.hypot(v.x, v.z) > 0.01) {
        this.setFacing({ x: v.x, z: v.z });
      }
    }
```

- [ ] **Step 3: Rewrite `takeDamage`**

Replace the whole method:

```ts
  takeDamage(amount: number, vel: Vec3): void {
    const wasAlive = this.brain.state !== ZombieState.Dead;
    this.brain.applyDamage(amount);
    this.hp = this.brain.hp;
    const died = wasAlive && this.brain.state === ZombieState.Dead;
    if (died) this.deathTime = performance.now() / 1000;

    // Concussion launch — NotBlood ConcussSprite applies velocity to dudes
    // alive or dead, decoupled from damage outcome.
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    if (speed >= EXPLOSION_LAUNCH.minLaunchSpeedMps) {
      const ty = this.body.translation().y;
      this.ballistic = { vel: { x: vel.x, y: vel.y, z: vel.z }, groundY: ty };
      if (died) {
        // Sub-160 explosion kill: NotBlood converts to kDamageFall — death anim
        // plays on the flying body, which lands and persists as a corpse.
        this.anim.play('zombie-death-explode', performance.now() / 1000);
        this._sfx?.play(SfxEvent.ZOMBIE_DEATH, this.pos);
      } else if (this.brain.state !== ZombieState.Dead) {
        this.brain.launch();
        // launch() happens between frames — the update() prev/state diff never
        // sees it, so trigger the airborne anim explicitly
        this.anim.play('zombie-recoil', performance.now() / 1000);
      }
    } else if (died) {
      // Normal (non-explosion) death
      this._sfx?.play(SfxEvent.ZOMBIE_DEATH, this.pos);
      // Blood signature: 25% of normal zombie deaths pop the head off
      // (NotBlood actor.cpp:3205, Chance(0x4000))
      if (this.gibProfile.spawnsKickableHead && Math.random() < EXPLOSION_LAUNCH.headPopChance) {
        this.onHeadPop?.(this.pos);
      }
    }
  }
```

- [ ] **Step 4: Corpse persistence — `isCorpse`, `getDeathTime`, new `shouldReap`**

Add after `onGibbed()`:

```ts
  /** Dead-but-not-gibbed — a persistent, re-gibbable corpse. */
  get isCorpse(): boolean {
    return this.brain.state === ZombieState.Dead && !this.gibbed;
  }

  /** Wallclock seconds when this zombie died (-1 if alive). Used by the corpse cap. */
  getDeathTime(): number { return this.deathTime; }
```

Replace `shouldReap`:

```ts
  /** Ready to be reaped: gibbed immediately (chunks replace the body), or a
   *  corpse past its lifetime (corpses persist as re-gibbable props — NotBlood
   *  kThingBloodChunks; CORPSE.maxCorpses cap is enforced by the cluster). */
  shouldReap(): boolean {
    if (this.gibbed) return true;
    if (this.brain.state !== ZombieState.Dead || this.deathTime < 0) return false;
    if (this.ballistic) return false; // still flying
    return performance.now() / 1000 - this.deathTime > CORPSE.reapAfterSec;
  }
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean / all pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/enemy/axe-zombie.ts
git commit -m "feat(zombie): ballistic concussion launches, persistent corpses, head-pop"
```

---

### Task 8: ShotgunCultist — same treatment

**Files:**
- Modify: `src/game/enemy/shotgun-cultist.ts`

Mirror Task 7 exactly, with these differences:

- [ ] **Step 1: Replace fling state with ballistic state**

Same as Task 7 Step 1: delete `FLING_DURATION_SEC`/`FLING_IMPULSE_SCALE` (lines ~57-58), import `EXPLOSION_LAUNCH, CORPSE` from `'../gibs/tuning'` and `stepBallistic, type BallisticMotion` from `'./ballistic'`, replace `flingVel`/`flingTimer` fields with `private ballistic: BallisticMotion | null = null;`. **No `onHeadPop` field** — cultists don't drop heads (`spawnsKickableHead: false`).

Add to `STATE_ANIM_MAP`:

```ts
  [CultistState.Launched]: 'cultist-shotgun-recoil',
```

- [ ] **Step 2: Rewrite the movement section of `update()`**

The cultist's fling block is at lines ~206-224 (it also gates a dead-fling check at ~206). Replace the whole fling/move block with the same structure as Task 7 Step 2, using `CultistState` and the cultist's brain:

```ts
    const t = this.body.translation();
    if (this.ballistic) {
      const step = stepBallistic(
        { x: t.x, y: t.y, z: t.z },
        this.ballistic,
        dt,
        EXPLOSION_LAUNCH.gravityMps2,
      );
      this.body.setNextKinematicTranslation(step.pos);
      this.ballistic.vel = step.vel;
      if (step.landed) {
        this.ballistic = null;
        this.brain.land(); // no-op if Dead
        // land() runs AFTER this frame's prev/state anim diff — trigger explicitly
        if (this.brain.state === CultistState.Recoil) {
          this.anim.play('cultist-shotgun-recoil', now);
        }
      }
    } else {
      const v = this.brain.desiredVelocity(this.pos, playerPos);
      this.body.setNextKinematicTranslation({ x: t.x + v.x * dt, y: t.y, z: t.z + v.z * dt });
      if (this.brain.state !== CultistState.Dead && Math.hypot(v.x, v.z) > 0.01) {
        this.setFacing({ x: v.x, z: v.z });
      }
    }
```

(Keep whatever facing logic the cultist currently has — adapt names, don't transplant zombie code blindly.)

- [ ] **Step 3: Rewrite `takeDamage`**

Replace the whole method (current version at line ~255 uses the fling hack). The flung-death anim is `'cultist-shotgun-death-gib'` (already registered in `public/assets/animations/index.json:22` and used by the old fling path). Death SFX is hook-driven for cultists (`CultistBrain` fires `onDeath` inside `applyDamage`), so no SFX call here. No head-pop — cultists don't drop heads:

```ts
  takeDamage(amount: number, vel: Vec3): void {
    const wasAlive = this.brain.state !== CultistState.Dead;
    this.brain.applyDamage(amount);
    this.hp = this.brain.hp;
    const died = wasAlive && this.brain.state === CultistState.Dead;
    if (died) this.deathTime = performance.now() / 1000;

    // Concussion launch — NotBlood ConcussSprite applies velocity to dudes
    // alive or dead, decoupled from damage outcome.
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    if (speed >= EXPLOSION_LAUNCH.minLaunchSpeedMps) {
      const ty = this.body.translation().y;
      this.ballistic = { vel: { x: vel.x, y: vel.y, z: vel.z }, groundY: ty };
      if (died) {
        // Sub-160 explosion kill: death anim plays on the flying body
        this.anim.play('cultist-shotgun-death-gib', performance.now() / 1000);
      } else if (this.brain.state !== CultistState.Dead) {
        this.brain.launch();
        // launch() happens between frames — the update() prev/state diff never
        // sees it, so trigger the airborne anim explicitly
        this.anim.play('cultist-shotgun-recoil', performance.now() / 1000);
      }
    }
  }
```

- [ ] **Step 4: Corpse persistence**

Same as Task 7 Step 4: `isCorpse` getter, `getDeathTime()`, `shouldReap` using `CORPSE.reapAfterSec` and the `ballistic` guard.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean / all pass.

- [ ] **Step 6: Commit**

```bash
git add src/game/enemy/shotgun-cultist.ts
git commit -m "feat(cultist): ballistic concussion launches + persistent corpses"
```

---

### Task 9: Cluster corpse cap + head-pop wiring

**Files:**
- Modify: `src/game/arena.ts`

- [ ] **Step 1: Wire `onHeadPop` at zombie spawn**

In `ZombieCluster.spawnAt` (the `AxeZombie.spawn` branch, line ~266), after `this.deps.gibs.registerDude(z);` add:

```ts
    z.onHeadPop = (pos) => this.deps.gibs.popHead(pos, performance.now() / 1000);
```

Import nothing new — `deps.gibs` is already the `GibSystem`.

- [ ] **Step 2: Enforce the corpse cap in `update()`**

Import `CORPSE` from `'./gibs/tuning'` (adjust relative path to match the file's existing tuning import). After the existing `this.zombies = this.zombies.filter(...)` reap block, add:

```ts
    // Corpse cap — corpses persist as re-gibbable props (NotBlood feel), but
    // force-reap the oldest beyond the cap so the arena doesn't fill up.
    const corpses = this.zombies.filter((z) => z.isCorpse);
    if (corpses.length > CORPSE.maxCorpses) {
      corpses.sort((a, b) => a.getDeathTime() - b.getDeathTime());
      const excess = corpses.slice(0, corpses.length - CORPSE.maxCorpses);
      for (const z of excess) {
        this.deps.gibs.unregisterDude(z.id);
        z.despawn();
        const idx = this.zombies.indexOf(z);
        if (idx !== -1) this.zombies.splice(idx, 1);
      }
    }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add src/game/arena.ts
git commit -m "feat(arena): corpse cap reaping + head-pop wiring"
```

---

### Task 10: Full verification + docs

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Full check**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: everything green. Also: `grep -rn "launched-corpse\|LaunchedCorpse\|onLaunchedCorpse\|LAUNCHED_CORPSE\|flingVel" src/` → no hits.

- [ ] **Step 2: Manual playtest (`npm run dev`)**

Acceptance checklist (from the spec):
1. Dynamite point-blank → full gib: head pops up out of a 4-7 chunk burst (not a lone head).
2. Dynamite mid-range kill → zombie's body flies through the air with death anim, tumbles, lands, stays as a corpse.
3. Dynamite far-edge hit on healthy zombie → zombie launched airborne ALIVE, lands, staggers, resumes chasing.
4. Second dynamite stick into a landed corpse → corpse bursts into full chunks.
5. ~1 in 4 melee/pellet zombie kills pops the head off with a blood burst.
6. Launched zombie carrying stuck flares: no Rapier crash when it dies or gibs mid-flight.
7. Cultists launch/fling the same way but never drop a zombie head.

- [ ] **Step 3: Update `TASKS.md`**

In the **Feel / physics tuning** section, add under `F1.gibs`:

```
- `F1.explosion-outcomes` [x] NotBlood three-tier explosion outcomes (launched-alive, flung corpse, re-gib) — spec docs/superpowers/specs/2026-06-10-explosion-outcomes-design.md
```

Update the **Current focus** blurb if stale.

- [ ] **Step 4: Commit**

```bash
git add TASKS.md
git commit -m "chore(tasks): explosion-outcomes pass landed"
```

---

## Self-review notes

- **Spec coverage:** §A selector → Task 6; §B launch velocity → Task 1; §C ballistic + Launched (both brains) → Tasks 2-4, 7-8; §D corpse persistence/re-gib → Tasks 6 (selector), 7-8 (isCorpse/shouldReap), 9 (cap); §E head height/velocity + bodyPartCount + head-pop → Tasks 1, 5, 6, 7; §F delete LaunchedCorpseManager → Task 6; §G tests per task + Task 10 playtest gate.
- **Units change** (`spawnChunks` impulse → m/s velocity) is intentionally split: chunks (Task 5) then the only caller, GibSystem (Task 6). tsc is briefly red in between — acceptable, flagged in Task 5 Step 4.
- **Known caveat:** ballistic flight ignores wall collisions (same as the old fling hack) — open arena makes this acceptable; revisit in M6 when level geometry lands.
