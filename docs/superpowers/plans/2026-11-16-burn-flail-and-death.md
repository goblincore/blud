# Burn Flail and Burn Death Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A body set alight panic-runs with thrashing arms, falters, then dies on one of three authored burn falls and chars down; duration and lethality are per character.

**Spec:** `docs/superpowers/specs/2026-11-16-burn-flail-and-death-design.md` — read it first.

**Architecture:** Four pure modules hold the logic: `motion-profile.ts` (the per-character `BurnTier`), `burn-behaviour.ts` (the seeded burn clock and flee heading), `burn-flail.ts` (new: the arm/trunk pose and a two-bone elbow solve) and `death-fall.ts` (three new fall kinds and their pick). `motion.ts` applies the flail to its rest targets and gains a per-body authored-death override; `webgpu/game-actor.ts` and `webgpu/game-burning.ts` wire the clock, the kill and the burn-down. No WGSL changes.

**Tech Stack:** TypeScript, Vitest. All paths below are relative to the repo root; source lives in `src/lab/sdf-zombie/`.

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port):** game logic goes in a pure, renderer-free
  module with its own tests (no `three` import; plain data in, plain data out). State lives inside the
  feature module or the actor closure, never as new `main()` bindings. Keep the simulation deterministic
  (seeded RNG, sim-time clocks, no wall-clock in logic).
- Work ONLY in this worktree. Never `git stash`. `node_modules` is symlinked: do not reinstall.
- **Targeted tests only** (`npx vitest run <path>`, or `npm run test:changed`) plus `npm run typecheck`.
  Never the full suite locally.
- `motion.ts`'s zombie path is pinned bit-identical on config keys being ABSENT, not `undefined`: new
  config is always spread in conditionally (`...(x ? { key: x } : {})`).
- Extracted Blood assets are dev placeholders: never commit them.
- Commit messages end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Deviations from the spec, decided while planning

- The spec says the flail places arms "with the existing `armPivot` solve". `armPivot` takes authored
  angles, not a hand target, so the flail carries its own two-bone solve (`solveElbow`, Task 3).
- The flail's hand targets are in **out / up / forward** shoulder coordinates (out = away from the
  midline) rather than +X-left, because `motion.ts` and `death-fall.ts` disagree in their comments about
  which side +X is. `motion.ts` derives each side's outward sign from the rest pose.
- `pickBurnFall(seed, forward)` takes the body's forward so it can set `impact` itself; half the
  `burnTopple` picks turn it 90 degrees to the seeded side.
- `stepBurnPanic` also returns `fold` (0..1 across falter); the spec named it only as a flail input.

## File map

| file | change |
| --- | --- |
| `src/lab/sdf-zombie/motion-profile.ts` | `BurnTier`, `BURN_TIER_DEFAULT`, `resolveBurnTier`, `MotionProfile.burn`, tier values |
| `src/lab/sdf-zombie/burn-tier.test.ts` | new |
| `src/lab/sdf-zombie/burn-behaviour.ts` | rewritten clock + heading |
| `src/lab/sdf-zombie/burn-behaviour.test.ts` | rewritten |
| `src/lab/sdf-zombie/burn-flail.ts` | new: `burnFlailPose`, `solveElbow` |
| `src/lab/sdf-zombie/burn-flail.test.ts` | new |
| `src/lab/sdf-zombie/death-fall.ts` | three kinds, `BURN_FALL_KINDS`, `pickBurnFall` |
| `src/lab/sdf-zombie/death-fall.test.ts` | new cases |
| `src/lab/sdf-zombie/motion.ts` | `MotionConfig.burnFlail`, `MotionConfig.authoredDeath`, the overlay |
| `src/lab/sdf-zombie/motion.test.ts` | new cases |
| `src/lab/sdf-zombie/webgpu/game-actor.ts` | panic wiring, kill, `burnPhase()` |
| `src/lab/sdf-zombie/webgpu/game-burning.ts` | start the burn-down on a burn death |
| `src/lab/sdf-zombie/webgpu/game-seams-fire.ts`, `scripts/burn-behaviour-trace.mjs` | `stumbles` becomes `burnPhase` |
| `src/lab/sdf-zombie/webgpu/game-actor.test.ts`, `game-actor-soldier.test.ts`, `game-actor-bride.test.ts` | updated burn cases |

---

## Task 1: The burn tier

**Files:**
- Modify: `src/lab/sdf-zombie/motion-profile.ts`
- Create: `src/lab/sdf-zombie/burn-tier.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/burn-tier.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BURN_TIER_DEFAULT, resolveBurnTier, ZOMBIE_PROFILE, SOLDIER_PROFILE, OGRE_PROFILE, GOREHOUND_PROFILE,
} from './motion-profile';

describe('resolveBurnTier', () => {
  it('no profile and an untiered profile take the default', () => {
    expect(resolveBurnTier(undefined)).toEqual(BURN_TIER_DEFAULT);
    expect(resolveBurnTier({})).toEqual(BURN_TIER_DEFAULT);
  });
  it('a partial tier fills the rest from the default', () => {
    expect(resolveBurnTier({ burn: { dies: false } })).toEqual({ ...BURN_TIER_DEFAULT, dies: false });
  });
  it('the zombie burns for 3 to 6 s and dies', () => {
    const t = resolveBurnTier(ZOMBIE_PROFILE);
    expect(t.panicSec).toEqual([3, 6]);
    expect(t.dies).toBe(true);
  });
  it('the soldier burns shorter and faster', () => {
    const t = resolveBurnTier(SOLDIER_PROFILE);
    expect(t.panicSec).toEqual([2.5, 4.5]);
    expect(t.speed).toBe(1.4);
  });
  it('a heavy panics but fire does not kill it', () => {
    const t = resolveBurnTier(OGRE_PROFILE);
    expect(t.dies).toBe(false);
    expect(t.flail).toBe(0.6);
  });
  it('the gorehound has no arm flail', () => {
    expect(resolveBurnTier(GOREHOUND_PROFILE).flail).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/lab/sdf-zombie/burn-tier.test.ts`
Expected: FAIL, `resolveBurnTier` is not exported.

- [ ] **Step 3: Implement**

In `src/lab/sdf-zombie/motion-profile.ts`, add to `interface MotionProfile` directly after the `physicsDeath?: boolean;` member:

```ts
  /** HOW THIS BODY BURNS (burn-behaviour.ts): absent fields take BURN_TIER_DEFAULT. */
  burn?: Partial<BurnTier>;
```

Add after the `isGoreBody` function:

```ts
/** How a character burns: how long it panics, how fast, how hard it flails, and whether fire kills it. */
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
export const BURN_TIER_DEFAULT: BurnTier = Object.freeze({ panicSec: [3, 6] as const, speed: 1.3, flail: 1, dies: true });

export function resolveBurnTier(profile: Pick<MotionProfile, 'burn'> | null | undefined): BurnTier {
  return { ...BURN_TIER_DEFAULT, ...(profile?.burn ?? {}) };
}

const BURN_SOLDIER: Partial<BurnTier> = { panicSec: [2.5, 4.5], speed: 1.4 };
const BURN_HEAVY: Partial<BurnTier> = { panicSec: [5, 8], speed: 1.1, flail: 0.6, dies: false };
const BURN_BEAST: Partial<BurnTier> = { panicSec: [2.5, 4], speed: 1.4, flail: 0 };
```

`BURN_SOLDIER`, `BURN_HEAVY` and `BURN_BEAST` are used by profile literals declared ABOVE this point in the
file, and `const` is not hoisted: move these three constants, the `BurnTier` interface and
`BURN_TIER_DEFAULT` to just above `export const ZOMBIE_PROFILE` instead, leaving `resolveBurnTier` after
`isGoreBody`.

Then add one member to each of these profile literals (the zombie takes the default and needs none):

| profile const | add |
| --- | --- |
| `SOLDIER_PROFILE`, `CULTIST_PROFILE`, `DEADEYE_PROFILE` | `burn: BURN_SOLDIER,` |
| `OGRE_PROFILE`, `JUGGERNAUT_PROFILE`, `WARBULL_PROFILE`, `BUTCHER_PROFILE`, `TALLOW_PROFILE` | `burn: BURN_HEAVY,` |
| `GOREHOUND_PROFILE`, `GUTCRAWLER_PROFILE` | `burn: BURN_BEAST,` |

If a profile is built by spreading another (`{ ...SOLDIER_PROFILE, ... }`) it already inherits the member;
do not add it twice.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lab/sdf-zombie/burn-tier.test.ts src/lab/sdf-zombie/motion-profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/motion-profile.ts src/lab/sdf-zombie/burn-tier.test.ts
git commit -m "feat(burn): per-character burn tier on the motion profile"
```

---

## Task 2: The burn clock

**Files:**
- Modify (rewrite): `src/lab/sdf-zombie/burn-behaviour.ts`
- Modify (rewrite): `src/lab/sdf-zombie/burn-behaviour.test.ts`

This task breaks `webgpu/game-actor.ts` until Task 6. Do not run typecheck between Tasks 2 and 6; run the
named test files only.

- [ ] **Step 1: Write the failing tests**

Replace `src/lab/sdf-zombie/burn-behaviour.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { BURN_BEHAVIOUR, createBurnPanic, stepBurnPanic, setBurnBehaviourEnabled, burnBehaviourEnabled } from './burn-behaviour';
import { BURN_TIER_DEFAULT, type BurnTier } from './motion-profile';

const DT = 1 / 30;
const run = (secs: number, seed = 7, tier: BurnTier = BURN_TIER_DEFAULT) => {
  const s = createBurnPanic(seed, tier);
  const outs = [];
  for (let t = 0; t < secs; t += DT) {
    outs.push(stepBurnPanic(s, { self: [0, 0, 0], player: [5, 0, 0], forward: [0, 0, 1] }, DT));
  }
  return { s, outs };
};

describe('stepBurnPanic', () => {
  it('rolls a duration inside the tier range, different per seed', () => {
    const ds = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => createBurnPanic(seed, BURN_TIER_DEFAULT).durationSec);
    for (const d of ds) { expect(d).toBeGreaterThanOrEqual(3); expect(d).toBeLessThanOrEqual(6); }
    expect(new Set(ds.map(d => d.toFixed(3))).size).toBeGreaterThan(4);
  });
  it('runs AWAY from the player and never fires', () => {
    const { outs } = run(2);
    for (const o of outs) {
      expect(o.fire).toBe(false);
      expect(o.target[0]).toBeLessThan(0);   // the player is at +x
    }
  });
  it('with no player known it runs along its own forward', () => {
    const s = createBurnPanic(3, BURN_TIER_DEFAULT);
    const o = stepBurnPanic(s, { self: [0, 0, 0], player: null, forward: [0, 0, 1] }, DT);
    expect(o.target[2]).toBeGreaterThan(0);
  });
  it('goes panic, then falter, then done, and dies exactly once', () => {
    const { s, outs } = run(8);
    const phases = outs.map(o => o.phase);
    const firstFalter = phases.indexOf('falter'), firstDone = phases.indexOf('done');
    expect(phases[0]).toBe('panic');
    expect(firstFalter).toBeGreaterThan(0);
    expect(firstDone).toBeGreaterThan(firstFalter);
    expect(firstFalter * DT).toBeCloseTo(s.durationSec * BURN_BEHAVIOUR.falterAt, 0);
    expect(outs.filter(o => o.die).length).toBe(1);
    expect(outs[firstDone]!.die).toBe(true);
  });
  it('a tier that does not die never dies', () => {
    const { outs } = run(12, 7, { ...BURN_TIER_DEFAULT, dies: false });
    expect(outs.some(o => o.phase === 'done')).toBe(true);
    expect(outs.some(o => o.die)).toBe(false);
  });
  it('speed and flail hold through panic and ease down across falter', () => {
    const { outs } = run(8);
    const panic = outs.filter(o => o.phase === 'panic'), falter = outs.filter(o => o.phase === 'falter');
    for (const o of panic) { expect(o.cruiseScale).toBeCloseTo(BURN_TIER_DEFAULT.speed); expect(o.flail).toBe(1); expect(o.fold).toBe(0); }
    const last = falter[falter.length - 1]!;
    expect(last.cruiseScale).toBeLessThan(BURN_TIER_DEFAULT.speed * 0.6);
    expect(last.flail).toBeLessThan(0.5);
    expect(last.fold).toBeGreaterThan(0.8);
    for (let i = 1; i < falter.length; i++) expect(falter[i]!.cruiseScale).toBeLessThanOrEqual(falter[i - 1]!.cruiseScale + 1e-9);
  });
  it('the heading turns smoothly: no jump between steps', () => {
    const { outs } = run(8);
    const ang = outs.map(o => Math.atan2(o.target[2], o.target[0]));
    for (let i = 1; i < ang.length; i++) {
      let d = Math.abs(ang[i]! - ang[i - 1]!);
      if (d > Math.PI) d = 2 * Math.PI - d;
      expect(d).toBeLessThan(0.25);   // rad per 1/30 s
    }
  });
  it('is deterministic for a seed', () => {
    expect(run(5, 11).outs).toEqual(run(5, 11).outs);
  });
  it('keeps the cost-study switch', () => {
    setBurnBehaviourEnabled(false);
    expect(burnBehaviourEnabled()).toBe(false);
    setBurnBehaviourEnabled(true);
    expect(burnBehaviourEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/lab/sdf-zombie/burn-behaviour.test.ts`
Expected: FAIL (the `forward` input and `phase` output do not exist).

- [ ] **Step 3: Implement**

Replace `src/lab/sdf-zombie/burn-behaviour.ts` with:

```ts
// src/lab/sdf-zombie/burn-behaviour.ts
//
// WHAT A BURNING BODY DOES, as a pure seeded step (spec 2026-11-16-burn-flail-and-death-design.md).
// One clock per burning body, its length rolled from the body's tier (motion-profile.ts BurnTier):
//   panic   it runs from the player on a smoothly wandering heading, flailing (burn-flail.ts);
//   falter  the last stretch: speed and flail ease down, the heading wanders wider, the arms fold;
//   done    the clock is out. `die` is true on that one step when the tier dies.
// The actor applies this as an override of its mind's verdict (the `doomed` pattern), so no brain
// learns a burn state.
import type { Vec3 } from './types';
import { BURN_TIER_DEFAULT, type BurnTier } from './motion-profile';

export const BURN_BEHAVIOUR = Object.freeze({
  /** Flee target: this far from self along the wobbled heading. */
  fleeDistM: 4,
  /** Max heading swing off the away direction (rad) and the wobble's base rate (Hz). */
  wobbleRad: 0.9,
  wobbleHz: 0.45,
  /** The wobble's amplitude scale by the end of falter. */
  falterWobble: 1.5,
  /** Fraction of the clock at which falter begins. */
  falterAt: 0.75,
  /** Speed (as a fraction of the tier's) and flail amplitude at the end of falter. */
  falterSpeed: 0.45,
  falterFlail: 0.35,
});

/** STUDY SWITCH (2026-09-22, fire-cost study): false = bodies burn VISUALLY but keep behaving as
 *  unburnt (no panic, no flail, no burn death), so the fire's render cost can be compared against the
 *  same motion without fire. Ship: true. */
let burnBehaviourOn = true;
export const setBurnBehaviourEnabled = (on: boolean) => { burnBehaviourOn = on; };
export const burnBehaviourEnabled = () => burnBehaviourOn;

export type BurnPhase = 'panic' | 'falter' | 'done';

export interface BurnPanicState {
  rng: number; t: number; phase: number;
  /** Seconds of panic + falter, rolled once. */
  durationSec: number;
  speed: number; dies: boolean;
  /** `die` has been reported. */
  died: boolean;
}

function next(s: BurnPanicState): number {          // mulberry32
  let x = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
const smooth = (u: number) => { const k = Math.min(1, Math.max(0, u)); return k * k * (3 - 2 * k); };

export function createBurnPanic(seed: number, tier: BurnTier = BURN_TIER_DEFAULT): BurnPanicState {
  const s: BurnPanicState = { rng: seed | 0, t: 0, phase: 0, durationSec: 0, speed: tier.speed, dies: tier.dies, died: false };
  s.phase = next(s) * Math.PI * 2;
  const [lo, hi] = tier.panicSec;
  s.durationSec = Math.max(0.1, lo + (hi - lo) * next(s));
  return s;
}

export interface BurnPanicInput {
  self: Vec3;
  /** Last known player position; null = never seen. */
  player: Vec3 | null;
  /** The body's own forward (unit, ground plane): the heading when no player is known. */
  forward: Vec3;
}
export interface BurnPanicOut {
  target: Vec3;
  cruiseScale: number;
  fire: false;
  phase: BurnPhase;
  /** 0..1 through the whole clock. */
  u: number;
  /** Flail amplitude 0..1 (before the tier's own scale). */
  flail: number;
  /** 0..1 across falter: how far the arms have folded to the chest. */
  fold: number;
  /** True on the one step the clock ends, when the tier dies. */
  die: boolean;
}

export function stepBurnPanic(s: BurnPanicState, i: BurnPanicInput, dt: number): BurnPanicOut {
  const B = BURN_BEHAVIOUR;
  s.t += Math.max(0, dt);
  const u = Math.min(1, s.t / s.durationSec);
  const f = smooth((u - B.falterAt) / (1 - B.falterAt));
  const phase: BurnPhase = u >= 1 ? 'done' : u >= B.falterAt ? 'falter' : 'panic';
  let dx = i.forward[0], dz = i.forward[2];
  if (i.player) { dx = i.self[0] - i.player[0]; dz = i.self[2] - i.player[2]; }
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) { dx = 0; dz = 1; } else { dx /= len; dz /= len; }
  const w = 2 * Math.PI * B.wobbleHz * s.t;
  const wob = (Math.sin(w + s.phase) + 0.5 * Math.sin(w * 2.3 + s.phase * 1.7)) / 1.5;
  const a = wob * B.wobbleRad * (1 + (B.falterWobble - 1) * f);
  const c = Math.cos(a), sn = Math.sin(a);
  const hx = dx * c - dz * sn, hz = dx * sn + dz * c;
  const die = phase === 'done' && s.dies && !s.died;
  if (die) s.died = true;
  return {
    target: [i.self[0] + hx * B.fleeDistM, i.self[1], i.self[2] + hz * B.fleeDistM],
    cruiseScale: s.speed * (1 + (B.falterSpeed - 1) * f),
    fire: false, phase, u,
    flail: 1 + (B.falterFlail - 1) * f,
    fold: f,
    die,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lab/sdf-zombie/burn-behaviour.test.ts`
Expected: PASS. If the smooth-heading case fails, the wobble is too fast: lower `wobbleHz`, not the test bound.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/burn-behaviour.ts src/lab/sdf-zombie/burn-behaviour.test.ts
git commit -m "feat(burn): one seeded burn clock with panic, falter and death (actor wiring follows)"
```

---

## Task 3: The flail pose

**Files:**
- Create: `src/lab/sdf-zombie/burn-flail.ts`
- Create: `src/lab/sdf-zombie/burn-flail.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lab/sdf-zombie/burn-flail.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { burnFlailPose, solveElbow, FLAIL_REST } from './burn-flail';
import type { Vec3 } from './types';

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const dist = (a: Vec3, b: Vec3) => len([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);

describe('burnFlailPose', () => {
  it('amp 0 is the hanging rest pose with no trunk motion', () => {
    const p = burnFlailPose(1.234, 5, 0, 0);
    expect(p.handL).toEqual(FLAIL_REST);
    expect(p.handR).toEqual(FLAIL_REST);
    expect(p.pitch).toBe(0); expect(p.sway).toBe(0); expect(p.headToss).toBe(0);
  });
  it('at full amplitude the hands are up and in front, within reach', () => {
    let up = 0, n = 0;
    for (let t = 0; t < 6; t += 1 / 60) {
      const p = burnFlailPose(t, 5, 1, 0);
      for (const h of [p.handL, p.handR]) {
        expect(len(h)).toBeLessThanOrEqual(0.97 + 1e-9);
        expect(h[2]).toBeGreaterThan(-0.2);          // never far behind the shoulder
        if (h[1] > 0) up++;
        n++;
      }
    }
    expect(up / n).toBeGreaterThan(0.6);              // mostly above the shoulder
  });
  it('is continuous: a bounded change per 1/60 s', () => {
    let prev = burnFlailPose(0, 9, 1, 0);
    for (let t = 1 / 60; t < 6; t += 1 / 60) {
      const p = burnFlailPose(t, 9, 1, 0);
      expect(dist(p.handL, prev.handL)).toBeLessThan(0.15);
      expect(dist(p.handR, prev.handR)).toBeLessThan(0.15);
      expect(Math.abs(p.pitch - prev.pitch)).toBeLessThan(0.05);
      prev = p;
    }
  });
  it('fold 1 brings both hands down to the chest and pitches the trunk forward', () => {
    for (let t = 0; t < 3; t += 0.1) {
      const p = burnFlailPose(t, 5, 1, 1);
      for (const h of [p.handL, p.handR]) {
        expect(h[1]).toBeLessThan(0.15);
        expect(h[2]).toBeGreaterThan(0.2);
      }
      expect(p.pitch).toBeGreaterThan(0.3);
    }
  });
  it('the two arms differ, and two seeds differ', () => {
    const a = burnFlailPose(1, 5, 1, 0), b = burnFlailPose(1, 6, 1, 0);
    expect(dist(a.handL, a.handR)).toBeGreaterThan(0.02);
    expect(dist(a.handL, b.handL)).toBeGreaterThan(0.02);
  });
  it('is deterministic', () => {
    expect(burnFlailPose(2.5, 4, 0.7, 0.3)).toEqual(burnFlailPose(2.5, 4, 0.7, 0.3));
  });
});

describe('solveElbow', () => {
  const S: Vec3 = [0, 1.4, 0];
  it('keeps both segment lengths and reaches the target', () => {
    const r = solveElbow(S, [0.2, 1.6, 0.3], 0.3, 0.28, [1, -1, 0]);
    expect(dist(S, r.elbow)).toBeCloseTo(0.3, 6);
    expect(dist(r.elbow, r.hand)).toBeCloseTo(0.28, 6);
    expect(dist(r.hand, [0.2, 1.6, 0.3])).toBeLessThan(1e-6);
  });
  it('clamps a target out of reach without stretching', () => {
    const r = solveElbow(S, [0, 1.4, 5], 0.3, 0.28, [1, -1, 0]);
    expect(dist(S, r.elbow)).toBeCloseTo(0.3, 6);
    expect(dist(r.elbow, r.hand)).toBeCloseTo(0.28, 6);
    expect(dist(S, r.hand)).toBeLessThanOrEqual(0.58);
  });
  it('bends toward the pole', () => {
    const r = solveElbow(S, [0, 1.4, 0.4], 0.3, 0.28, [1, 0, 0]);
    expect(r.elbow[0]).toBeGreaterThan(0.05);
  });
  it('survives a hand on the shoulder and a pole along the arm', () => {
    const r = solveElbow(S, S, 0.3, 0.28, [0, 0, 1]);
    for (const v of [...r.elbow, ...r.hand]) expect(Number.isFinite(v)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/lab/sdf-zombie/burn-flail.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/lab/sdf-zombie/burn-flail.ts`:

```ts
// src/lab/sdf-zombie/burn-flail.ts
//
// THE BURNING FLAIL, as a pure pose (spec 2026-11-16-burn-flail-and-death-design.md). A body on fire
// throws its arms overhead and beats at itself. This returns where each hand wants to be and how the
// trunk moves; motion.ts places the arms with solveElbow so no segment stretches.
//
// Hand targets are in SHOULDER coordinates, in units of the arm's full length:
//   [out, up, forward]   out = away from the body's midline (the same sign for both arms).
// Pure: no clock, no randomness beyond the seed.
import type { Vec3 } from './types';

export interface BurnFlailPose {
  handL: Vec3; handR: Vec3;
  /** Trunk pitch (rad, + forward) and side sway (rad, + toward the body's +X). */
  pitch: number; sway: number;
  /** Head toss (rad, + forward) about the neck. */
  headToss: number;
}

/** The hanging arm: slightly out, straight down. */
export const FLAIL_REST: Vec3 = [0.1, -0.95, 0];
/** Hands thrown up, in front of and above the head. */
const RAISED: Vec3 = [0.3, 0.72, 0.38];
/** One hand beating at the chest. */
const BEAT: Vec3 = [-0.05, -0.1, 0.5];
/** Both hands drawn in as the body gives out. */
const FOLDED: Vec3 = [-0.08, -0.28, 0.45];
const SWING: Vec3 = [0.4, 0.3, 0.28];
const REACH = 0.97;
const TAU = Math.PI * 2;

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);
const mix = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
/** A stable 0..1 from a seed and a lane. */
function hash01(seed: number, lane: number): number {
  let x = (Math.imul(seed | 0, 0x9e3779b1) + Math.imul(lane + 1, 0x85ebca6b)) | 0;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
/** Two sines at incommensurate rates: -1..1, never periodic over a burn's length. */
const wave = (t: number, r1: number, r2: number, p: number) => 0.6 * Math.sin(t * r1 * TAU + p) + 0.4 * Math.sin(t * r2 * TAU + p * 1.7);

function hand(t: number, seed: number, lane: number, beat: number, a: number, f: number): Vec3 {
  const p = (k: number) => hash01(seed, lane * 8 + k) * TAU;
  const centre = mix(mix(RAISED, BEAT, beat), FOLDED, f);
  const live = 1 - 0.6 * f;
  const full: Vec3 = [
    centre[0] + SWING[0] * wave(t, 2.3, 3.7, p(0)) * live,
    centre[1] + SWING[1] * wave(t, 2.9, 4.3, p(1)) * live,
    centre[2] + SWING[2] * wave(t, 2.1, 3.3, p(2)) * live,
  ];
  if (f > 0) full[1] = Math.min(full[1], 0.72 - 0.62 * f);   // folded hands stay below the shoulder line
  const h = mix(FLAIL_REST, full, a);
  const l = Math.hypot(h[0], h[1], h[2]);
  return l > REACH ? [h[0] * REACH / l, h[1] * REACH / l, h[2] * REACH / l] : h;
}

/**
 * @param t    seconds since the body caught fire
 * @param seed the body's seed
 * @param amp  0..1 flail amplitude (the clock's `flail` times the tier's)
 * @param fold 0..1 across falter: the arms come down to the chest and the trunk pitches forward
 */
export function burnFlailPose(t: number, seed: number, amp: number, fold: number): BurnFlailPose {
  const a = clamp01(amp), f = clamp01(fold);
  if (a === 0) return { handL: FLAIL_REST, handR: FLAIL_REST, pitch: 0, sway: 0, headToss: 0 };
  // A slow alternation: for a stretch one hand drops to beat at the chest, then the other.
  const s = Math.sin(t * 0.31 * TAU + hash01(seed, 99) * TAU);
  const beatL = Math.max(0, s) ** 2 * (1 - f), beatR = Math.max(0, -s) ** 2 * (1 - f);
  const pp = hash01(seed, 97) * TAU;
  return {
    handL: hand(t, seed, 0, beatL, a, f),
    handR: hand(t, seed, 1, beatR, a, f),
    pitch: a * (0.1 + 0.08 * wave(t, 1.3, 2.1, pp)) + f * 0.45,
    sway: a * 0.12 * wave(t, 1.1, 1.9, pp + 1.3) * (1 - 0.5 * f),
    headToss: a * 0.25 * wave(t, 1.7, 2.7, pp + 2.1) * (1 - f),
  };
}

/**
 * Two-bone solve: the elbow and hand for a shoulder, a wanted hand point and the two segment lengths.
 * The hand is pulled in to what the arm can reach; the elbow bends toward `pole` (any length).
 */
export function solveElbow(shoulder: Vec3, target: Vec3, l1: number, l2: number, pole: Vec3): { elbow: Vec3; hand: Vec3 } {
  let dx = target[0] - shoulder[0], dy = target[1] - shoulder[1], dz = target[2] - shoulder[2];
  let d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) { dx = 0; dy = -1; dz = 0; d = 1e-6; }
  const ux = dx / d, uy = dy / d, uz = dz / d;
  const dc = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, d));
  const along = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  // The pole, made perpendicular to the arm line; a pole along the arm falls back to another axis.
  const perp = (p: Vec3): Vec3 | null => {
    const k = p[0] * ux + p[1] * uy + p[2] * uz;
    const v: Vec3 = [p[0] - ux * k, p[1] - uy * k, p[2] - uz * k];
    const l = Math.hypot(v[0], v[1], v[2]);
    return l < 1e-6 ? null : [v[0] / l, v[1] / l, v[2] / l];
  };
  const n = perp(pole) ?? perp([0, -1, 0]) ?? perp([1, 0, 0])!;
  return {
    elbow: [shoulder[0] + ux * along + n[0] * h, shoulder[1] + uy * along + n[1] * h, shoulder[2] + uz * along + n[2] * h],
    hand: [shoulder[0] + ux * dc, shoulder[1] + uy * dc, shoulder[2] + uz * dc],
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lab/sdf-zombie/burn-flail.test.ts`
Expected: PASS. The `up / n > 0.6` and continuity bounds are the look's contract: if one fails, change the
constants (`RAISED`, `SWING`, the rates), not the test.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/burn-flail.ts src/lab/sdf-zombie/burn-flail.test.ts
git commit -m "feat(burn): the flail pose and a two-bone elbow solve"
```

---

## Task 4: The burn falls

**Files:**
- Modify: `src/lab/sdf-zombie/death-fall.ts`
- Modify: `src/lab/sdf-zombie/death-fall.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/lab/sdf-zombie/death-fall.test.ts`, add `BURN_FALL_KINDS, pickBurnFall` to the import from
`./death-fall`, and append:

```ts
describe('the burn falls', () => {
  // The body faces +Z and a burn fall topples along its own forward.
  const burnEnd = (kind: DeathFallKind) => deathFallPose({ kind, strength: 1, side: 1 }, frame([0, 0, 1]), fallLength(kind) + 0.5);

  it.each(BURN_FALL_KINDS)('%s ends on the floor with nothing under it', kind => {
    const p = burnEnd(kind);
    for (const q of p) expect(q[1]).toBeGreaterThan(-0.02);
    expect(at('head', p)[1]).toBeLessThan(kind === 'burnHeap' ? 0.85 : 0.35);
  });
  it('kneel and topple go down face first, along the body forward', () => {
    for (const kind of ['burnKneel', 'burnTopple'] as const) {
      const p = burnEnd(kind);
      expect(at('chest', p)[1]).toBeLessThan(0.3);
      expect(at('head', p)[2]).toBeGreaterThan(at('pelvis', p)[2]);
    }
  });
  it('the heap stays put: it sits down into itself', () => {
    const p = burnEnd('burnHeap');
    expect(Math.hypot(at('pelvis', p)[0], at('pelvis', p)[2] - j.pelvis[2])).toBeLessThan(0.45);
    expect(at('pelvis', p)[1]).toBeLessThan(0.4);
  });
  it('the kneel curls: the knees end drawn up toward the chest', () => {
    const p = burnEnd('burnKneel');
    const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(gap(at('kneeL', p), at('chest', p))).toBeLessThan(gap(at('kneeL', j.base), at('chest', j.base)));
  });
  it('no burn fall travels or leaves the floor', () => {
    for (const kind of BURN_FALL_KINDS) { expect(FALLS[kind].travel).toBe(0); expect(FALLS[kind].air).toBe(0); }
  });
});

describe('pickBurnFall', () => {
  it('covers all three burn kinds and only those', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) seen.add(pickBurnFall(seed, [0, 0, 1]).kind);
    expect([...seen].sort()).toEqual([...BURN_FALL_KINDS].sort());
  });
  it('is deterministic and carries a unit ground-plane impact', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const c = pickBurnFall(seed, [0, 0, 1]);
      expect(c).toEqual(pickBurnFall(seed, [0, 0, 1]));
      expect(Math.hypot(c.impact![0], c.impact![2])).toBeCloseTo(1, 6);
      expect(c.impact![1]).toBe(0);
      expect(c.strength).toBe(1);
    }
  });
  it('kneel and heap always fall along the forward; a topple sometimes goes to the side', () => {
    let side = 0, topples = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const c = pickBurnFall(seed, [0, 0, 1]);
      if (c.kind !== 'burnTopple') { expect(c.impact![2]).toBeCloseTo(1, 6); continue; }
      topples++;
      if (Math.abs(c.impact![0]) > 0.9) side++;
    }
    expect(side).toBeGreaterThan(0);
    expect(side).toBeLessThan(topples);
  });
  it('an ordinary death never plays a burn fall', () => {
    const rand = makeRng(5);
    for (let i = 0; i < 300; i++) {
      const c = pickDeathFall({ blown: null, struck: (['legs', 'head', 'body'] as const)[i % 3]! }, rand);
      expect(BURN_FALL_KINDS).not.toContain(c.kind);
    }
    expect(DEATH_FALL_KINDS).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/lab/sdf-zombie/death-fall.test.ts`
Expected: FAIL, `BURN_FALL_KINDS` is not exported.

- [ ] **Step 3: Implement**

In `src/lab/sdf-zombie/death-fall.ts`:

Replace the two kind lines with:

```ts
export type DeathFallKind = 'blown' | 'backward' | 'crumple' | 'spin' | 'sit' | 'burnKneel' | 'burnTopple' | 'burnHeap';
/** The falls a gun or blast death picks from. The burn falls are NOT here: only pickBurnFall returns them. */
export const DEATH_FALL_KINDS: readonly DeathFallKind[] = ['blown', 'backward', 'crumple', 'spin', 'sit'];
/** The falls a body that burned to death plays (spec 2026-11-16-burn-flail-and-death-design.md). */
export const BURN_FALL_KINDS: readonly DeathFallKind[] = ['burnKneel', 'burnTopple', 'burnHeap'];
```

Add these three entries to the `FALLS` record, after `sit`. A burn fall's `impact` is the body's own
forward, so heading 0 is face first:

```ts
  // BURNED: drops to the knees with the arms clawing up, pitches onto the face, then the arms and legs
  // draw in to a curl (the pugilist posture a burnt body takes).
  burnKneel: {
    keys: [
      k({ at: 0.45, topple: 0.1, legNear: [-0.15, 1.5, 1.5], legFar: [-0.2, 1.45, 1.45], armNear: [-2.4, -2.9, -2.9], armFar: [-2.1, -2.7, -2.7], armSplay: 0.5, legSplay: 0.15 }),
      k({ at: 1.0, topple: 0.5, legNear: [-0.4, 1.4, 1.4], legFar: [-0.45, 1.35, 1.4], armNear: [-1.6, -2.4, -2.4], armFar: [-1.4, -2.2, -2.2], armSplay: 0.35, legSplay: 0.15 }),
      k({ at: 1.5, topple: 1.48, legNear: [0.1, 0.35, 0.6], legFar: [0, 0.2, 0.5], armNear: [-0.9, -2.2, -2.2], armFar: [-0.8, -2.1, -2.1], armSplay: 0.3, legSplay: 0.15 }),
      k({ at: 2.2, topple: 1.48, legNear: [-0.9, 0.9, 0.9], legFar: [-0.7, 0.8, 0.8], armNear: [-0.8, -2.5, -2.5], armFar: [-0.7, -2.4, -2.4], armSplay: 0.2, legSplay: 0.2 }),
    ],
    travel: 0, travelSec: 1, air: 0, airSec: 1,
  },
  // BURNED: goes rigid, arms locked half raised, and falls like a board.
  burnTopple: {
    keys: [
      k({ at: 0.25, topple: 0.12, armNear: [-1.2, -1.9, -1.9], armFar: [-1.0, -1.7, -1.7], armSplay: 0.6, legSplay: 0.1 }),
      k({ at: 1.1, topple: 1.5, armNear: [-1.3, -2.0, -2.0], armFar: [-1.1, -1.8, -1.8], armSplay: 0.6, legSplay: 0.1 }),
    ],
    travel: 0, travelSec: 1, air: 0, airSec: 1,
  },
  // BURNED: the knees and hips fold together and it sits down into itself, the trunk slumping over the legs.
  burnHeap: {
    keys: [
      k({ at: 0.5, topple: 0.2, legNear: [-1.3, 0.2, 0.3], legFar: [-1.2, 0.3, 0.3], armNear: [0.2, -0.3, -0.3], armFar: [0.2, -0.3, -0.3], armSplay: 0.3, legSplay: 0.3 }),
      k({ at: 1.0, topple: 0.45, legNear: [-1.5, 0.1, 0.2], legFar: [-1.4, 0.2, 0.2], armNear: [-0.2, -0.6, -0.6], armFar: [-0.1, -0.5, -0.5], armSplay: 0.3, legSplay: 0.3 }),
      k({ at: 1.6, topple: 0.95, legNear: [-1.55, 0, 0.2], legFar: [-1.45, 0.1, 0.2], armNear: [-0.5, -0.9, -0.9], armFar: [-0.4, -0.8, -0.8], armSplay: 0.4, legSplay: 0.35 }),
    ],
    travel: 0, travelSec: 1, air: 0, airSec: 1,
  },
```

Add after `pickDeathFall`:

```ts
/** Weights of the burn falls. */
export const BURN_FALL_WEIGHTS: Readonly<Record<'burnKneel' | 'burnTopple' | 'burnHeap', number>> =
  { burnKneel: 0.4, burnTopple: 0.3, burnHeap: 0.3 };

/**
 * The fall a body that burned to death plays, from its seed. `forward` is the body's own forward on the
 * ground plane: a burn fall topples along it (face first), not along a shot. Half the board topples go
 * over to the seeded side instead.
 */
export function pickBurnFall(seed: number, forward: Vec3): DeathFallChoice {
  let s = seed | 0;
  const next = (): number => {          // mulberry32
    let x = (s = (s + 0x6d2b79f5) | 0);
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const r = next();
  const side: 1 | -1 = next() < 0.5 ? 1 : -1;
  const sideways = next() < 0.5;
  const W = BURN_FALL_WEIGHTS;
  const kind: DeathFallKind = r < W.burnKneel ? 'burnKneel' : r < W.burnKneel + W.burnTopple ? 'burnTopple' : 'burnHeap';
  const l = Math.hypot(forward[0], forward[2]);
  const f: Vec3 = l > 1e-6 ? [forward[0] / l, 0, forward[2] / l] : [0, 0, 1];
  const impact: Vec3 = kind === 'burnTopple' && sideways ? [f[2] * side, 0, -f[0] * side] : f;
  return { kind, strength: 1, side, impact };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lab/sdf-zombie/death-fall.test.ts`
Expected: PASS, including the file's existing "no key bends a knee or an elbow backwards" case, which
walks every entry of `FALLS`.

The key angles above are first values. If a burn case fails:
- a joint under the floor in the last `burnKneel` key: move its `legNear`/`legFar` thigh angles toward 0
  in steps of 0.2 (the curl is tighter than the drape can ground);
- `burnHeap`'s pelvis above 0.4: raise the last key's `topple` toward 1.2;
- a backwards-bend failure: within a chain the shin angle must be at least the thigh's, and the
  forearm's at most the upper arm's.

Change the keys, not the test bounds.

- [ ] **Step 5: Typecheck this module's users compile**

Run: `npx vitest run src/lab/sdf-zombie/death-fall.test.ts src/lab/sdf-zombie/motion.test.ts`
Expected: PASS (`FALL_WEIGHTS` is `Partial`, so the wider kind type needs no other change).

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/death-fall.ts src/lab/sdf-zombie/death-fall.test.ts
git commit -m "feat(burn): three authored burn falls and their seeded pick"
```

---

## Task 5: The flail and the authored-death override in motion.ts

**Files:**
- Modify: `src/lab/sdf-zombie/motion.ts`
- Modify: `src/lab/sdf-zombie/motion.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lab/sdf-zombie/motion.test.ts`. It uses the file's existing helpers `realJoints`,
`stubPoints`, `cruising`, `CFG_ON`, `NO_SIGNALS`, `BOUNDS`, `makeRng` (all already defined or imported at
the top of that file; confirm with `grep -n "realJoints\|CFG_ON\|NO_SIGNALS\|stubPoints" src/lab/sdf-zombie/motion.test.ts`):

```ts
describe('the burning flail overlay', () => {
  const stepOnce = (cfg: MotionConfig, state = cruising(9)) => {
    const j = realJoints();
    return { j, ...stepMotion(state, j, cfg, NO_SIGNALS(), stubPoints(j), BOUNDS, makeRng(9)) };
  };
  const d = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  it('absent, the frame is exactly the unburnt frame', () => {
    const a = stepOnce(CFG_ON).frame.restPose, b = stepOnce({ ...CFG_ON }).frame.restPose;
    expect(a).toEqual(b);
  });
  it('raises both hands above the shoulders without stretching either arm', () => {
    const base = stepOnce(CFG_ON);
    let above = 0, n = 0;
    for (let t = 0; t < 4; t += 0.1) {
      const { j, frame } = stepOnce({ ...CFG_ON, burnFlail: { t, seed: 5, amp: 1, fold: 0 } });
      for (const side of ['L', 'R'] as const) {
        const S = frame.restPose[j.index[`shoulder${side}`]!]!, E = frame.restPose[j.index[`elbow${side}`]!]!, H = frame.restPose[j.index[`hand${side}`]!]!;
        const bS = j.base[j.index[`shoulder${side}`]!]!, bE = j.base[j.index[`elbow${side}`]!]!, bH = j.base[j.index[`hand${side}`]!]!;
        expect(d(S, E)).toBeCloseTo(d(bS, bE), 4);
        expect(d(E, H)).toBeCloseTo(d(bE, bH), 4);
        if (H[1] > S[1]) above++;
        n++;
      }
    }
    expect(above / n).toBeGreaterThan(0.6);
    // And it actually moved the hands off the unburnt frame.
    const { j, frame } = stepOnce({ ...CFG_ON, burnFlail: { t: 1, seed: 5, amp: 1, fold: 0 } });
    expect(d(frame.restPose[j.index.handL!]!, base.frame.restPose[j.index.handL!]!)).toBeGreaterThan(0.2);
  });
  it('amp 0 leaves the arms where the gait put them', () => {
    const base = stepOnce(CFG_ON);
    const { j, frame } = stepOnce({ ...CFG_ON, burnFlail: { t: 1, seed: 5, amp: 0, fold: 0 } });
    expect(d(frame.restPose[j.index.handL!]!, base.frame.restPose[j.index.handL!]!)).toBeLessThan(1e-6);
  });
  it('skips a missing arm', () => {
    const j = realJoints();
    const sig = { ...NO_SIGNALS(), missing: { ...NO_SIGNALS().missing, armL: true } };
    const cfgB = { ...CFG_ON, burnFlail: { t: 1, seed: 5, amp: 1, fold: 0 } };
    const a = stepMotion(cruising(9), j, CFG_ON, sig, stubPoints(j), BOUNDS, makeRng(9)).frame.restPose;
    const b = stepMotion(cruising(9), j, cfgB, sig, stubPoints(j), BOUNDS, makeRng(9)).frame.restPose;
    expect(d(a[j.index.handL!]!, b[j.index.handL!]!)).toBeLessThan(1e-6);
    expect(d(a[j.index.handR!]!, b[j.index.handR!]!)).toBeGreaterThan(0.2);
  });
});

describe('authoredDeath overrides a physics-death profile', () => {
  it('a forced collapse on the zombie plays the fall deathFall returns', () => {
    const j = realJoints();
    let state = cruising(9), points = stubPoints(j), asked = 0;
    const cfg: MotionConfig = {
      ...CFG_ON, authoredDeath: true,
      deathFall: () => { asked++; return { kind: 'burnKneel', strength: 1, side: 1, impact: [0, 0, 1] }; },
    };
    const sig = () => ({ ...NO_SIGNALS(), forcedCollapse: true });
    for (let i = 0; i < 30; i++) {
      const r = stepMotion(state, j, cfg, sig(), points, BOUNDS, makeRng(9));
      state = r.state;
      points = r.frame.restPose.map(p => ({ pos: [p[0], p[1], p[2]] as Vec3, prev: p, pinned: false }));
    }
    expect(asked).toBe(1);
    expect(state.fallKind?.kind).toBe('burnKneel');
  });
  it('without it the zombie keeps the free ragdoll', () => {
    const j = realJoints();
    let state = cruising(9), points = stubPoints(j), asked = 0;
    const cfg: MotionConfig = { ...CFG_ON, deathFall: () => { asked++; return { kind: 'burnKneel', strength: 1, side: 1 }; } };
    for (let i = 0; i < 30; i++) {
      const r = stepMotion(state, j, cfg, { ...NO_SIGNALS(), forcedCollapse: true }, points, BOUNDS, makeRng(9));
      state = r.state;
      points = r.frame.restPose.map(p => ({ pos: [p[0], p[1], p[2]] as Vec3, prev: p, pinned: false }));
    }
    expect(asked).toBe(0);
  });
});
```

If `MotionConfig` or `Vec3` is not yet imported as a type in that test file, add it to the existing
imports from `./motion` and `./types`.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/lab/sdf-zombie/motion.test.ts -t "burning flail|authoredDeath"`
Expected: FAIL (`burnFlail` and `authoredDeath` are not in `MotionConfig`).

- [ ] **Step 3: Add the config**

In `src/lab/sdf-zombie/motion.ts`, add the import beside the other local imports:

```ts
import { burnFlailPose, solveElbow } from './burn-flail';
```

In `interface MotionConfig`, directly after the `releaseFall?: boolean;` member, add:

```ts
  /** THE BURNING FLAIL (burn-flail.ts): while present and the body stands, both arms are placed on the
   *  flail's hand targets (over the carry, the reach and any attack) and the trunk pitches and sways with
   *  it. `t` is seconds since ignite, `amp` 0..1, `fold` 0..1 across the falter. ABSENT on every unburnt
   *  frame: the zombie path is pinned on the key being absent. */
  burnFlail?: { t: number; seed: number; amp: number; fold: number };
  /** This death is AUTHORED whatever the profile says: a physics-death body (the zombie) plays the fall
   *  `deathFall` returns. Set for a burn death. Soft targets and bodies that fail canDeathFall ignore it. */
  authoredDeath?: boolean;
```

- [ ] **Step 4: Add the trunk motion**

Find the torso lean block (`// --- torso lean (profiles) ---`). Replace the `const torsoLean = ...` line
and the `if (torsoLean !== 0 && ...` line's opening with:

```ts
  const burnPose = cfg.burnFlail && cfg.burnFlail.amp > 0 && !collapsed
    ? burnFlailPose(cfg.burnFlail.t, cfg.burnFlail.seed, cfg.burnFlail.amp, cfg.burnFlail.fold) : null;
  const torsoLeanBase = gait.pose.lean * blend * (1 - walkPosture) + .24 * walkPosture + .30 * crouchPosture;
  const torsoLean = burnPose ? torsoLeanBase + burnPose.pitch : torsoLeanBase;
  if (torsoLean !== 0 && !collapsed && idx.hips !== undefined) {
```

Inside that block, replace the line `const qLean = qFromAxisAngle(right, torsoLean);` with:

```ts
    const qPitch = qFromAxisAngle(right, torsoLean);
    // The flail's side sway is a roll about the body's forward axis, applied after the pitch.
    const qLean = burnPose && burnPose.sway !== 0
      ? qMul(qFromAxisAngle(rotateYaw([0, 0, 1], bodyYaw), burnPose.sway), qPitch) : qPitch;
```

`qMul` must be imported from `./vec` in this file: check with `grep -n "qMul" src/lab/sdf-zombie/motion.ts`
and add it to the existing `./vec` import if absent.

- [ ] **Step 5: Add the arm overlay**

Find the comment `// AUTHORED DEATHS (death-fall.ts): every humanoid but a soft target` and insert this block
immediately ABOVE it (after every other arm writer and the recoil kick):

```ts
  // --- the burning flail (burn-flail.ts) -------------------------------------
  // Last word on the arms while a body burns: each hand goes to the flail's target by a two-bone solve
  // from the FINAL shoulder target, so both segments keep their rest lengths. The hand tip (and so a
  // carried gun) rides the hand's move.
  if (burnPose) {
    const midX = joints.base[idx.pelvis!]![0];
    for (const side of ['L', 'R'] as const) {
      if (side === 'L' ? sig.missing.armL : sig.missing.armR) continue;
      const iS = idx[`shoulder${side}`], iE = idx[`elbow${side}`], iH = idx[`hand${side}`];
      if (iS === undefined || iE === undefined || iH === undefined) continue;
      const l1 = len(sub(joints.base[iE]!, joints.base[iS]!)), l2 = len(sub(joints.base[iH]!, joints.base[iE]!));
      const out = joints.base[iS]![0] >= midX ? 1 : -1;
      const h = side === 'L' ? burnPose.handL : burnPose.handR;
      const S = targets[iS]!;
      const want = add(S, scale(rotateYaw([h[0] * out, h[1], h[2]], bodyYaw), l1 + l2));
      // Elbows out and down, a little behind: the bend a raised human arm takes.
      const r = solveElbow(S, want, l1, l2, rotateYaw([out, -0.6, -0.3], bodyYaw));
      const moved = sub(r.hand, targets[iH]!);
      targets[iE] = r.elbow;
      targets[iH] = r.hand;
      const iT = idx[`handTip${side}`];
      if (iT !== undefined) targets[iT] = add(targets[iT]!, moved);
    }
    if (burnPose.headToss !== 0 && idx.head !== undefined && idx.neck !== undefined) {
      const q = qFromAxisAngle(rotateYaw([1, 0, 0], bodyYaw), burnPose.headToss);
      targets[idx.head] = add(targets[idx.neck]!, qRotate(q, sub(targets[idx.head]!, targets[idx.neck]!)));
    }
  }
```

`len`, `sub`, `add`, `scale`, `qRotate`, `qFromAxisAngle` and `rotateYaw` are already used in this file. If
`len` is not imported (`grep -n "\blen(" src/lab/sdf-zombie/motion.ts | head -3`), add it to the `./vec`
import.

- [ ] **Step 6: Add the authored-death override**

Replace:

```ts
  const animatedDeath = !isSoldierFamily(profile) && DEATH_FALL.on && !profile.soft && !profile.physicsDeath
    && canDeathFall(joints.names);
```

with:

```ts
  const animatedDeath = !isSoldierFamily(profile) && DEATH_FALL.on && !profile.soft
    && (!profile.physicsDeath || !!cfg.authoredDeath) && canDeathFall(joints.names);
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/lab/sdf-zombie/motion.test.ts src/lab/sdf-zombie/motion-floor.test.ts`
Expected: PASS, including every pre-existing case (the unburnt path computes the same numbers: `burnPose`
is null, so `torsoLean` and `qLean` are the old expressions).

If "raises both hands above the shoulders" fails on segment length, the shoulder socket clamp or a stagger
offset is moving a joint after the overlay: move the overlay block further down, to just above
`// AUTHORED DEATHS`, never earlier.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/motion.ts src/lab/sdf-zombie/motion.test.ts
git commit -m "feat(burn): motion applies the flail overlay; authoredDeath overrides a physics death"
```

---

## Task 6: The actor

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.test.ts`, `game-actor-soldier.test.ts`, `game-actor-bride.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-seams-fire.ts`, `scripts/burn-behaviour-trace.mjs`

Line numbers below are from commit `61b76d977`; find each site by the quoted text.

- [ ] **Step 1: Rewrite the actor's burn tests**

In `src/lab/sdf-zombie/webgpu/game-actor.test.ts`, replace the whole
`describe('createZombieActor — burning panic override', ...)` block with:

```ts
describe('createZombieActor — burning panic and burn death', () => {
  const burnFor = (a: ReturnType<typeof makeTestActor>, secs: number) => { for (let i = 0; i < secs * 60; i++) a.step(1 / 60); };

  it('a burning zombie runs AWAY from the player', () => {
    const a = makeTestActor({ start: [0, 0, 0] });
    a.setBrainInput({ x: 6, z: 0, room: 1 }, true);
    burnFor(a, 0.5);
    const d0 = Math.hypot(a.pose().pos[0] - 6, a.pose().pos[2]);
    a.setBurning(true);
    expect(a.burnPhase()).toBe('panic');
    burnFor(a, 1.5);
    const d1 = Math.hypot(a.pose().pos[0] - 6, a.pose().pos[2]);
    expect(d1).toBeGreaterThan(d0);
  });

  it('setBurning is edge-triggered (a repeat call keeps the same clock)', () => {
    const a = makeTestActor({ start: [0, 0, 0] });
    a.setBurning(true);
    burnFor(a, 7);                       // past any zombie duration (3..6 s)
    expect(a.burnPhase()).toBe('dead');
    a.setBurning(true);                  // must NOT restart the panic
    expect(a.burnPhase()).toBe('dead');
  });

  it('falters, then dies on a burn fall even though the zombie is a physics-death body', () => {
    const a = makeTestActor({ start: [0, 0, 0] });
    a.setBurning(true);
    const seen = new Set<string>();
    for (let i = 0; i < 8 * 60; i++) { a.step(1 / 60); seen.add(a.burnPhase()); }
    expect([...seen]).toEqual(expect.arrayContaining(['panic', 'falter', 'dead']));
    expect(['burnKneel', 'burnTopple', 'burnHeap']).toContain(a.debug().fallKind);
    expect(a.pose().pos[1]).toBeLessThan(0.6);
  });

  it('put out before the clock ends, it goes back to its mind', () => {
    const a = makeTestActor({ start: [0, 0, 0] });
    a.setBurning(true);
    burnFor(a, 1);
    a.setBurning(false);
    expect(a.burnPhase()).toBe('none');
    burnFor(a, 8);
    expect(a.burnPhase()).toBe('none');
    expect(a.debug().fallKind).toBeNull();
  });
});
```

`a.debug()` exists on the actor (`game-seams-fire.ts` reads `d.speed`, `d.staggerKind`, `d.target` from it).
Step 4 adds `fallKind` to it.

In `src/lab/sdf-zombie/webgpu/game-actor-soldier.test.ts`, find the burning cases near
`expect(BURN_BEHAVIOUR.soldierPanic).toBe(false);`. Delete the case that asserts the soldier does NOT
panic (the one containing that line and `burnStumbles()`), and change
`it.skipIf(!BURN_BEHAVIOUR.soldierPanic)(` on the next case to plain `it(`. Remove the now-unused
`BURN_BEHAVIOUR` import if nothing else in the file uses it.

In `src/lab/sdf-zombie/webgpu/game-actor-bride.test.ts` line 88, replace
`Math.max(BURN_BEHAVIOUR.zombieSpeed, 1)` with `Math.max(BURN_TIER_DEFAULT.speed, 1)`, and swap the
import: `import { BURN_TIER_DEFAULT } from '../motion-profile';` in place of the `BURN_BEHAVIOUR` import.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-actor.test.ts -t "burning panic and burn death"`
Expected: FAIL (compile errors in `game-actor.ts` from Task 2's removed symbols, and no `burnPhase`).

- [ ] **Step 3: Imports and state**

In `src/lab/sdf-zombie/webgpu/game-actor.ts`:

Replace the burn-behaviour import with:

```ts
import { createBurnPanic, stepBurnPanic, type BurnPanicState } from '../burn-behaviour';
```

Add `pickBurnFall` to the existing import from `'../death-fall'`, and `resolveBurnTier` to the existing
import from `'../motion-profile'`.

In the `ZombieActor` interface, replace the `burnStumbles(): number;` member and its doc comment with:

```ts
  /** Where this body is in its burn (burn-behaviour.ts): 'none' = not panicking; 'resumed' = its tier
   *  does not die and its panic is over; 'dead' = it burned to death. The capture trace's oracle, and
   *  what game-burning.ts polls to start the burn-down. */
  burnPhase(): 'none' | 'panic' | 'falter' | 'resumed' | 'dead';
```

Replace the state block that begins `let burnPanic: BurnPanicState | null = null;` through
`let burnStumbles = 0;` with:

```ts
  let burnPanic: BurnPanicState | null = null;
  let burnCruiseScale = 1;
  /** setBurning(true) has been called and not yet undone (the edge guard). */
  let burningOn = false;
  /** This frame's flail for stepMotion; null = none. */
  let burnFlail: { t: number; seed: number; amp: number; fold: number } | null = null;
  let burnPhaseNow: 'none' | 'panic' | 'falter' | 'resumed' | 'dead' = 'none';
  /** The body burned to death: the collapse is forced and the fall is a burn fall. */
  let burnDied = false;
  const burnTier = resolveBurnTier(opts.profile);
  const burnSeed = opts.id * 7919 + 1;
```

- [ ] **Step 4: The panic block**

Replace the whole block from `if (burnPanic && !doomed) {` to its matching `} else { burnCruiseScale = 1; }`
(the one under the `// A BURNING BODY PANICS.` comment) with:

```ts
      burnFlail = null;
      if (burnPanic && !doomed && !burnDied) {
        // The encounter director (not setBrainInput) feeds the game's minds, so read the player from
        // the order when present and remember the last seen point for when sight is lost.
        const playerNow = encounterOrder?.player ?? brainPlayer;
        // BrainPlayer has no height: the flee point is ground-plane, on this body's floor.
        if (playerNow) lastPlayerPos = [playerNow.x, state.floorY, playerNow.z];
        const bp = stepBurnPanic(burnPanic, { self: state.wander.pos, player: lastPlayerPos, forward: burnForward() }, sdt);
        if (bp.phase === 'done') {
          burnPanic = null;
          burnCruiseScale = 1;
          if (bp.die) {
            burnDied = true;
            burnPhaseNow = 'dead';
            if (soldierDamage) soldierFatal = true;
          } else {
            burnPhaseNow = 'resumed';
          }
        } else {
          burnPhaseNow = bp.phase;
          think = { ...think, target: bp.target, halt: false, fire: false, weaponUp: false, attack: null, faceHeading: null };
          burnCruiseScale = bp.cruiseScale;
          const amp = bp.flail * burnTier.flail;
          if (amp > 0) burnFlail = { t: burnPanic.t, seed: burnSeed, amp, fold: bp.fold };
        }
      } else {
        burnCruiseScale = 1;
      }
      // Burned to death: no agenda, and the collapse is forced every frame until it is down.
      if (burnDied) {
        think = { ...think, target: null, halt: true, attack: null, fire: false, contact: false };
        signals.forcedCollapse = true;
      }
```

The `think` literal for `burnDied` matches the one the file already uses for `softKilled`; if the
`MindOutput` type has no `contact` member, copy that `softKilled` line's fields exactly instead.

Further down, the line `if (burnPanic && !doomed) signals.fire = false;` becomes:

```ts
      if ((burnPanic && !doomed) || burnDied) signals.fire = false;
```

- [ ] **Step 5: The death fall and the motion config**

In the `deathFall` closure (`const deathFall = (): DeathFallChoice => {`), add as its first line:

```ts
    if (burnDied) return pickBurnFall(burnSeed + 2, burnForward());
```

`burnForward` is a `const` arrow declared later in the closure (`const burnForward = (): Vec3 => headingDir(bodyYaw);`).
`deathFall` only runs inside `step`, after the whole closure has initialised, so the later declaration is
fine; if TypeScript reports use-before-define, move the `burnForward` line up beside the burn state from
Step 3.

In the `stepMotion(` config object, replace:

```ts
          ...(DEATH_FALL.on && !softTarget && !physicsDeath ? { deathFall } : {}),
```

with:

```ts
          ...(DEATH_FALL.on && !softTarget && (!physicsDeath || burnDied) ? { deathFall } : {}),
          ...(burnDied && !softTarget ? { authoredDeath: true } : {}),
          ...(burnFlail ? { burnFlail } : {}),
```

- [ ] **Step 6: Delete the stand-in and rewrite setBurning**

Delete the two functions `burnStumbleShot` and `burnFlailShot` with their doc comments (under
`// ---- burning panic motion signals (Task 2) ---`). Keep `burnForward`.

Replace the `setBurning: (on: boolean) => { ... },` member and the `burnStumbles: () => burnStumbles,`
member with:

```ts
    setBurning: (on: boolean) => {
      // Edge-triggered: a repeated call must not restart the clock, and a body that has already
      // burned to death or resumed stays that way until it is put out.
      if (on === burningOn) return;
      burningOn = on;
      if (on) {
        // The id seed keeps two bodies lit on the same frame out of phase.
        burnPanic = createBurnPanic(burnSeed, burnTier);
        burnPhaseNow = 'panic';
      } else {
        burnPanic = null;
        burnCruiseScale = 1;
        burnFlail = null;
        if (!burnDied) burnPhaseNow = 'none';
      }
    },
    burnPhase: () => burnPhaseNow,
```

The actor's `debug()` returns `lastDebug`, an object built in two places
(`grep -n "staggerKind" src/lab/sdf-zombie/webgpu/game-actor.ts` shows three hits: the type, the
`lastDebug = {` literal, and the fallback literal in `debug: () => lastDebug ?? {`). Add to the type,
beside `staggerKind: string | null;`:

```ts
    /** The authored fall this body is playing (death-fall.ts), or null. */
    fallKind: string | null;
```

and add this field to BOTH literals:

```ts
        fallKind: state.fallKind?.kind ?? null,
```

Find the reset path that clears death state for a respawn (the line containing
`tear = null; tearPlan = null; tearPrimRegion = null; doomed = false;`) and append to it:

```ts
      burnDied = false; burnPanic = null; burningOn = false; burnPhaseNow = 'none'; burnFlail = null; burnCruiseScale = 1;
```

- [ ] **Step 7: Update the seam and the trace script**

In `src/lab/sdf-zombie/webgpu/game-seams-fire.ts`, replace `stumbles: a.burnStumbles(),` with
`burnPhase: a.burnPhase(),` and update that function's declared return type if it names `stumbles`.

In `scripts/burn-behaviour-trace.mjs`, run `grep -n "stumbles" scripts/burn-behaviour-trace.mjs`. Every
read of `.stumbles` is the stumble oracle the spec retires: delete the stumble-count assertions and the
doc comment at line 288 describing them, and replace them with one assertion that a burning zombie's
samples contain `burnPhase === 'panic'` followed later by `burnPhase === 'dead'`. Do not run the script
here (it needs a GPU); it is exercised in Task 8.

- [ ] **Step 8: Typecheck and run the actor tests**

Run: `npm run typecheck`
Expected: clean. Any remaining error naming `BURN_BEHAVIOUR.<removed field>`, `burnStumbles` or
`burnFlailT` is a leftover reference: delete it.

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-actor.test.ts src/lab/sdf-zombie/webgpu/game-actor-soldier.test.ts src/lab/sdf-zombie/webgpu/game-actor-bride.test.ts`
Expected: PASS, except the failures the 2026-09-19 handoff lists as already failing on `main`
(`game-actor-torso-slug`). Confirm any other failure against `main` before touching it:
`git stash` is forbidden, so use `git worktree add /tmp/blud-main main` only if you must compare, and
remove it after.

If "falters, then dies on a burn fall" fails with `fallKind` null: the collapse did not go structural.
Check that `signals.forcedCollapse = true` runs on every step after `burnDied` (it must sit outside the
`if (burnPanic ...)` branch, as written above).

- [ ] **Step 9: Add the soldier and tier cases**

Append to the `describe` from Step 1 in `game-actor.test.ts`:

```ts
  it('a tier that does not die panics, then resumes', () => {
    const a = makeTestActor({ start: [0, 0, 0], profile: { ...ZOMBIE_PROFILE, burn: { panicSec: [1, 1], dies: false } } });
    a.setBurning(true);
    burnFor(a, 2);
    expect(a.burnPhase()).toBe('resumed');
    expect(a.debug().fallKind).toBeNull();
  });

  it('a tier with no flail still panics and dies', () => {
    const a = makeTestActor({ start: [0, 0, 0], profile: { ...ZOMBIE_PROFILE, burn: { panicSec: [1, 1], flail: 0 } } });
    a.setBurning(true);
    burnFor(a, 3);
    expect(a.burnPhase()).toBe('dead');
  });
```

Import `ZOMBIE_PROFILE` from `'../motion-profile'` in that test file if it is not already imported.

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-actor.test.ts -t "burning panic and burn death"`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-actor.ts src/lab/sdf-zombie/webgpu/game-actor.test.ts src/lab/sdf-zombie/webgpu/game-actor-soldier.test.ts src/lab/sdf-zombie/webgpu/game-actor-bride.test.ts src/lab/sdf-zombie/webgpu/game-seams-fire.ts scripts/burn-behaviour-trace.mjs
git commit -m "feat(burn): the actor panics, flails, and burns to death on an authored fall"
```

---

## Task 7: The burn-down on a burn death

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-burning.ts`
- Modify: `src/lab/sdf-zombie/webgpu/burn-registry.test.ts`

- [ ] **Step 1: Read the registry**

Run: `cat src/lab/sdf-zombie/webgpu/burn-registry.ts`
Confirm `kill(key)` calls `killBurning` on the state WITHOUT removing it, and that `step` keeps stepping a
`dying` state. If `kill` removes the entry, stop and report: the spec assumes it does not.

- [ ] **Step 2: Write the failing test**

Append to `src/lab/sdf-zombie/webgpu/burn-registry.test.ts` (reuse the file's existing imports; it
already imports `createBurnRegistry`):

```ts
describe('a body that burns to death keeps burning down', () => {
  const RATES = { igniteSec: 0.5, extinguishSec: 1, charRate: 0.1, corpseBurnSec: 4 };
  it('kill starts the burn-down and leaves the state in the registry until it is cold', () => {
    const reg = createBurnRegistry<object>();
    const body = {};
    reg.ignite(body);
    for (let i = 0; i < 60; i++) reg.step(1 / 30, RATES);
    reg.kill(body);
    expect(reg.get(body)!.dying).toBe(true);
    for (let i = 0; i < 60; i++) reg.step(1 / 30, RATES);
    expect(reg.has(body)).toBe(true);
    expect(reg.get(body)!.burn).toBeGreaterThan(0);
    for (let i = 0; i < 90; i++) reg.step(1 / 30, RATES);
    expect(reg.get(body)!.burn).toBe(0);
    expect(reg.get(body)!.char).toBe(1);
    expect(reg.get(body)!.dying).toBe(false);
  });
});
```

Run: `npx vitest run src/lab/sdf-zombie/webgpu/burn-registry.test.ts`
Expected: PASS already if Step 1's reading held (this pins the behaviour Task 7 depends on). If it fails,
fix `burn-registry.ts` so `kill` keeps the entry and `step` steps `dying` states, then re-run.

- [ ] **Step 3: Start the burn-down from the actor's death**

In `src/lab/sdf-zombie/webgpu/game-burning.ts`, inside `step(dt)`, directly after the line
`const swap = burnPrev; burnPrev = burnCur; burnCur = swap;`, add:

```ts
      // BURNED TO DEATH (spec 2026-11-16): the actor's clock ran out and it is falling. Start the
      // burn-down once; the state stays registered so the fire fades and the char completes on the
      // corpse (retire(), the gib path, is what releases a body).
      burning.forEachActive((a, s) => {
        if (!s.dying && s.alight && a.burnPhase() === 'dead') burning.kill(a);
      });
```

`forEachActive` must visit a state that is `alight`; it does today (the loop above it reads `s.burn` for
every active body).

- [ ] **Step 4: Typecheck and run the burn tests**

Run: `npm run typecheck`
Expected: clean.

Run: `npx vitest run src/lab/sdf-zombie/webgpu/burn-registry.test.ts src/lab/sdf-zombie/burn-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-burning.ts src/lab/sdf-zombie/webgpu/burn-registry.test.ts
git commit -m "feat(burn): a body that burns to death burns down on its corpse"
```

---

## Task 8: See it, tune it, record it

**Files:**
- Create: `docs/dev-notes/2026-11-16-burn-flail/NOTES.md`
- Modify: `docs/tasks/combat-and-gore.md`, `TASKS.md`
- Modify (tuning only): `burn-flail.ts`, `death-fall.ts`, `burn-behaviour.ts`, `motion-profile.ts`

- [ ] **Step 1: Run the changed tests and the typecheck**

Run: `npm run typecheck && npm run test:changed`
Expected: clean and PASS (bar the known `main` failures named in Task 6 Step 8).

- [ ] **Step 2: Look at it in the arena**

Start the arena with the project's launch config (never a bare shell server): `npm run dev:arena` opens
`/sdf-game.html?level=arena&spawn=zombie`. Ignite the spawned enemy from the console:

```js
__sdfGame.igniteAll()
```

For each of `?spawn=zombie`, `?spawn=soldier`, `?spawn=ogre`, `?spawn=gorehound`, watch one full burn
(`` ` `` respawns) and check, writing down what you see:

| check | pass when |
| --- | --- |
| panic | the body turns from the player and runs, heading wandering without snapping |
| flail | both arms thrash mostly above the shoulders; neither arm stretches or pops out of the socket |
| soldier gun | the gun stays in the hand and does not fire; if the two-handed grip fights the flail (the left hand snapping back to the fore-end), apply the spec's fallback: force the one-handed carry while `burnFlail` is set |
| falter | it visibly slows and the arms come down before it falls |
| death | zombie and soldier drop on a burn fall, without a snap from the run pose; respawn until all three kinds have played |
| burn-down | the flames die on the corpse over `corpseBurnSec` and the body ends charred |
| ogre | it panics and flails less, then goes back to attacking, still alight |
| gorehound | it runs with no arm flail and dies its normal death |

Then spawn a crowd (bare `/sdf-game.html`, the ring testbed), run `__sdfGame.igniteAll()`, and check the
deaths do not read as one repeated animation.

- [ ] **Step 3: Tune**

Change only constants, re-running the module's test after each change:

| reads wrong | change |
| --- | --- |
| flail too wild or too small | `SWING`, `RAISED` in `burn-flail.ts` |
| flail too fast | the rate pairs passed to `wave` in `burn-flail.ts` |
| run too twitchy | `wobbleHz`, `wobbleRad` in `burn-behaviour.ts` |
| fall snaps from the run | lower `falterSpeed` in `burn-behaviour.ts` |
| a fall's shape | that kind's keys in `death-fall.ts` |
| durations | the tier constants in `motion-profile.ts` |

- [ ] **Step 4: Write the notes**

Create `docs/dev-notes/2026-11-16-burn-flail/NOTES.md` with: what was built (one paragraph and the file
list), the table from Step 2 filled in with what was actually seen for each character, every constant
changed in Step 3 with its before and after, and anything that does not work yet. State plainly that the
look was judged by eye in the arena and that no capture script or GPU gate was run, unless one was.

- [ ] **Step 5: Update the task board**

In `docs/tasks/combat-and-gore.md`, add under the burning entries:

```markdown
- [~] **Burn flail and burn death** (2026-11-16): a lit body panic-runs with an authored arm flail, falters, and dies on one of three burn falls (kneel and curl, topple, heap), then chars down; duration and lethality per character (`MotionProfile.burn`). [spec](../superpowers/specs/2026-11-16-burn-flail-and-death-design.md) · [plan](../superpowers/plans/2026-11-16-burn-flail-and-death.md) · [notes](../dev-notes/2026-11-16-burn-flail/NOTES.md). Owner look pending. Open: the fire's render cost (separate spec).
```

Add a one-line pointer under "in flight" on `TASKS.md`'s front page, keeping it short.

- [ ] **Step 6: Commit**

```bash
git add docs/dev-notes/2026-11-16-burn-flail/NOTES.md docs/tasks/combat-and-gore.md TASKS.md src/lab/sdf-zombie
git commit -m "feat(burn): tune the flail and burn falls in the arena; notes and task board"
```

---

## Spec coverage

| spec section | task |
| --- | --- |
| The sequence (panic, falter, death, corpse; put out early; non-dying tier) | 2, 6, 7 |
| 1. The burn clock | 2 |
| 2. The tiers | 1 |
| 3. The flail and its motion overlay | 3, 5 |
| 4. The burn deaths and the pick | 4 |
| 5. The wiring, including the `physicsDeath` override and the burn-down | 5 (override), 6, 7 |
| Testing | each task's tests; 8 for the arena |
| Risks (gun carry, entering the fall) | 8, steps 2 and 3 |
