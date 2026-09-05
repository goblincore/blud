# Zombie Combat Choreography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop zombie arms passing through each other when several surround the player, replace the two-arm slam with an alternating one-arm hook, and rebuild `brain.ts` as a named state machine.

**Architecture:** One new pure module (`melee-ring.ts`, crowd-level token arbitration on bearings), two rewritten pure modules (`brain.ts` → a 7-state machine that also absorbs the blast hold; `attack.ts` → per-side hook), one real `motion.ts` change (the reach pivot gains a yaw axis), and wiring in `game-actor.ts` / `game-main.ts`. No new dependencies.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess: true`), vitest, three.js/WebGPU only at the wiring edge. Test: `npx vitest run <path>`; typecheck: `npx tsc --noEmit`.

**Spec:** [docs/superpowers/specs/2026-09-05-zombie-combat-choreography-design.md](../specs/2026-09-05-zombie-combat-choreography-design.md)

---

## House rules for every task

* `noUncheckedIndexedAccess` is ON. Every `arr[i]` read is `T | undefined` — write `arr[i]!` after a bounds check, and never `arr[i]! -= x` (assigning to a non-null assertion is a TS error); write `arr[i] = arr[i]! - x`.
* Pure modules import nothing from `three`, the DOM, `Date.now` or `Math.random`. `melee-ring.ts`, `brain.ts` and `attack.ts` must hold that line.
* Every file opens with a `// src/...` path comment and a paragraph saying what the module is FOR, matching `wander.ts` / `stagger.ts` beside them.
* **`motion.ts`'s bit-identity contract is not negotiable.** `cfg.attack === undefined` must take the identical code path it takes today; the lab's wiring never sets it. The existing 30-frame exact-pose test in `motion.test.ts` stays as written and must keep passing. Do not "simplify" a branch into an add — `x + 0` turns `-0` into `+0` and breaks it.
* Commit after every task with the trailer:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File structure

| File | Status | Responsibility |
|------|--------|----------------|
| `src/lab/sdf-zombie/melee-ring.ts` | create | Who may swing this frame, and which way the waiters shuffle. Crowd-level, stateless. |
| `src/lab/sdf-zombie/melee-ring.test.ts` | create | Its tests. |
| `src/lab/sdf-zombie/attack.ts` | rewrite | The alternating one-arm hook: per-side pitch + yaw. |
| `src/lab/sdf-zombie/attack.test.ts` | rewrite | Its tests. |
| `src/lab/sdf-zombie/motion.ts` | modify | `MotionConfig.attack` becomes `{phase, side}`; the reach pivot gains a world-up rotation. |
| `src/lab/sdf-zombie/motion.test.ts` | modify | Bit-identity pin kept; per-side assertions added. |
| `src/lab/sdf-zombie/brain.ts` | rewrite | The 7-state machine. Owns the blast hold. |
| `src/lab/sdf-zombie/brain.test.ts` | rewrite | Its tests. |
| `src/lab/sdf-zombie/webgpu/game-actor.ts` | modify | Feeds the ring verdict and the blast into the brain; reports `engaged`/`committed`. |
| `src/lab/sdf-zombie/webgpu/game-actor.test.ts` | modify | Wiring tests. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | modify | Per-frame arbitration, engaged separation radius, `minHandGap()`. |
| `scripts/sdf-game-crowd-gate.mjs` | modify | Three new checks. |
| `docs/dev-notes/2026-09-05-zombie-choreography/notes.md` | create | Captures + numbers. |
| `TASKS.md` | modify | The status row. |

---

### Task 1: `melee-ring.ts` — token arbitration on bearings

**Files:**
- Create: `src/lab/sdf-zombie/melee-ring.ts`
- Test: `src/lab/sdf-zombie/melee-ring.test.ts`

Read first: `src/lab/sdf-zombie/wander.ts` lines 70-80 — the heading convention (`0 = facing +z`, positive clockwise from above) and `wrapPi`. A bearing from the player to a body is `Math.atan2(x - px, z - pz)`, NOT the usual `atan2(dz, dx)`.

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/melee-ring.test.ts`:

```ts
// src/lab/sdf-zombie/melee-ring.test.ts
import { describe, it, expect } from 'vitest';
import { RING_TUNING, arbitrate, bearingTo, type RingClaimant } from './melee-ring';

const P = { x: 0, z: 0 };

/** A claimant at `deg` around the player (0 = +z), `d` metres out. */
function at(id: number, deg: number, d = 1, over: Partial<RingClaimant> = {}): RingClaimant {
  const r = (deg * Math.PI) / 180;
  return { id, x: Math.sin(r) * d, z: Math.cos(r) * d, committed: false, incumbent: false, ...over };
}

describe('bearingTo', () => {
  it('uses the wander heading convention: 0 = +z, positive clockwise', () => {
    expect(bearingTo(P, { x: 0, z: 1 })).toBeCloseTo(0, 9);
    expect(bearingTo(P, { x: 1, z: 0 })).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('arbitrate', () => {
  it('handles the degenerate inputs', () => {
    expect(arbitrate(P, []).holders.size).toBe(0);
    const one = arbitrate(P, [at(1, 0)]);
    expect([...one.holders]).toEqual([1]);
    expect(one.drift.get(1)).toBe(0);
  });

  it('never grants more than `tokens`', () => {
    const many = [at(1, 0), at(2, 90), at(3, 180), at(4, 270)];
    expect(arbitrate(P, many).holders.size).toBe(RING_TUNING.tokens);
  });

  it('refuses a second token closer than minSlotAngle to a holder', () => {
    // 0 deg and 30 deg: well inside the 90 deg minimum.
    const v = arbitrate(P, [at(1, 0, 1), at(2, 30, 1.2)]);
    expect([...v.holders]).toEqual([1]);
  });

  it('grants a second token at exactly minSlotAngle', () => {
    const deg = (RING_TUNING.minSlotAngle * 180) / Math.PI;
    const v = arbitrate(P, [at(1, 0, 1), at(2, deg, 1.2)]);
    expect(v.holders.has(1)).toBe(true);
    expect(v.holders.has(2)).toBe(true);
  });

  it('grants nearest-first among equally legal claimants', () => {
    // Both clear of each other; 2 is nearer, so it is granted first, but both
    // fit inside the cap here — assert the ORDER by starving the cap.
    const v = arbitrate(P, [at(1, 0, 5), at(2, 10, 1), at(3, 180, 4)]);
    // 2 (nearest) takes one; 1 is only 10 deg from it and is refused;
    // 3 is 180 deg away and takes the second.
    expect([...v.holders].sort()).toEqual([2, 3]);
  });

  it('a committed claimant keeps its token even when a nearer body wants one', () => {
    const v = arbitrate(P, [at(1, 0, 3, { committed: true }), at(2, 5, 1)]);
    expect(v.holders.has(1)).toBe(true);
    expect(v.holders.has(2)).toBe(false);
  });

  it('an incumbent beats an equally placed newcomer', () => {
    const v = arbitrate(P, [at(1, 0, 1, { incumbent: true }), at(2, 10, 1)]);
    expect(v.holders.has(1)).toBe(true);
    expect(v.holders.has(2)).toBe(false);
  });

  it('is deterministic: identical input, identical verdict', () => {
    const set = () => [at(1, 0, 1), at(2, 1, 1), at(3, 181, 1)];
    const a = arbitrate(P, set());
    const b = arbitrate(P, set());
    expect([...a.holders].sort()).toEqual([...b.holders].sort());
    expect([...a.drift.entries()].sort()).toEqual([...b.drift.entries()].sort());
  });

  it('drift is 0 for a holder and for a waiter already in a clear bearing', () => {
    // 1 and 3 hold (0 and 180); 2 sits at 90, clear of both.
    const v = arbitrate(P, [at(1, 0, 1), at(3, 180, 1), at(2, 90, 2)]);
    expect(v.drift.get(1)).toBe(0);
    expect(v.drift.get(3)).toBe(0);
    expect(v.drift.get(2)).toBe(0);
  });

  it('drift points a crowded waiter toward the nearer clear bearing', () => {
    // 1 holds at 0. 2 sits at 30 — crowded. The nearest clear bearings are
    // -90 and +90; +90 is nearer to 30, so it drifts positive.
    const v = arbitrate(P, [at(1, 0, 1), at(2, 30, 2), at(3, 200, 1)]);
    expect(v.drift.get(2)).toBe(1);
  });

  it('drift is signed the other way when the other side is nearer', () => {
    const v = arbitrate(P, [at(1, 0, 1), at(2, -30, 2), at(3, 200, 1)]);
    expect(v.drift.get(2)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/melee-ring.test.ts`
Expected: FAIL — `Failed to resolve import "./melee-ring"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/melee-ring.ts`:

```ts
// src/lab/sdf-zombie/melee-ring.ts
//
// Who may swing at the player this frame, and which way the ones who may not
// should shuffle. Crowd-level and stateless: the whole claimant set goes in,
// a verdict comes out, and the per-body state machine (brain.ts) consumes it.
//
// WHY THIS EXISTS. Separation (crowd.ts) treats a body as a 0.35 m circle, so
// two engaged zombies settle 0.70 m apart and separation reports itself
// satisfied — but an arm reaches ~0.6 m, so at 0.70 m two facing bodies have
// half a metre of mutual arm overlap. The circles never touch; the arms
// always do (owner's screenshot, 2026-09-04). Widening the circle would fix
// it and destroy the crowding that makes the encounter work. Not everyone
// attacks at once, and the ones who do are angularly spaced.
//
// ANGLES ARE BEARINGS, NOT SLOTS. The obvious design — fixed slots at 0/90
// degrees around the player — rotates the whole ring when the player turns,
// so bodies would orbit as he looks around. Here a claimant's angle is simply
// its CURRENT bearing from him: nobody walks to a slot, they attack from
// where they already are, and this module only decides who may.
//
// Pure: no RNG, no clock, no THREE. Ties break on ascending id, so the same
// input always yields the same verdict.
import { wrapPi } from './wander';

export interface RingPoint { x: number; z: number }

export interface RingClaimant {
  id: number;
  x: number;
  z: number;
  /** Mid-swing: the ring may NOT revoke this body's token. */
  committed: boolean;
  /** Held a token on the previous frame. */
  incumbent: boolean;
}

export interface RingVerdict {
  /** Bodies granted a token this frame. */
  holders: Set<number>;
  /** Tangential shuffle direction per body: -1, 0 or +1. Holders get 0. */
  drift: Map<number, -1 | 0 | 1>;
}

export const RING_TUNING = {
  /** How many bodies may be swinging at once. Owner's call: with no player
   *  health yet, more attackers add noise, not danger. */
  tokens: 2,
  /** Minimum angular separation between two token holders (rad). At 90 deg
   *  and a 1.0 m melee radius two holders are 1.41 m apart — clear of two
   *  0.6 m arm reaches with 0.2 m of margin. 75 deg gives 1.22 m, which
   *  clears by 2 cm, which is not clearing. */
  minSlotAngle: Math.PI / 2,
} as const;

export type RingTuning = typeof RING_TUNING;

/** Bearing from `from` to `to`, in the wander heading convention (0 = +z,
 *  positive clockwise seen from above). */
export function bearingTo(from: RingPoint, to: RingPoint): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function arbitrate(
  player: RingPoint,
  claimants: readonly RingClaimant[],
  tuning: RingTuning = RING_TUNING,
): RingVerdict {
  const holders = new Set<number>();
  const drift = new Map<number, -1 | 0 | 1>();
  if (claimants.length === 0) return { holders, drift };

  const rows = claimants.map(c => ({
    c,
    b: bearingTo(player, c),
    d: Math.hypot(c.x - player.x, c.z - player.z),
  }));

  const held: number[] = [];
  const clears = (b: number) =>
    held.every(h => Math.abs(wrapPi(b - h)) >= tuning.minSlotAngle - 1e-9);
  const grant = (row: { c: RingClaimant; b: number }) => {
    holders.add(row.c.id);
    held.push(row.b);
  };
  const nearestFirst = (
    a: { c: RingClaimant; d: number }, z: { c: RingClaimant; d: number },
  ) => a.d - z.d || a.c.id - z.c.id;

  // 1. Committed bodies keep their token unconditionally. This cannot
  //    overflow the cap: they are a subset of last frame's holders, which was
  //    itself at most `tokens`.
  for (const r of rows.filter(r => r.c.committed).sort((a, z) => a.c.id - z.c.id)) {
    grant(r);
  }
  // 2. Then incumbents, nearest first. INCUMBENCY IS LOAD-BEARING:
  //    re-arbitrating from scratch every frame makes tokens flicker between
  //    bodies at nearly equal distance, and that start-stop is far uglier
  //    than the clipping this module exists to fix.
  for (const r of rows.filter(r => !r.c.committed && r.c.incumbent).sort(nearestFirst)) {
    if (holders.size >= tuning.tokens) break;
    if (clears(r.b)) grant(r);
  }
  // 3. Then everyone else, nearest first.
  for (const r of rows.filter(r => !r.c.committed && !r.c.incumbent).sort(nearestFirst)) {
    if (holders.size >= tuning.tokens) break;
    if (clears(r.b)) grant(r);
  }

  // Drift: the tangential direction toward the nearest bearing that clears
  // EVERY holder. Candidates are each holder's bearing +/- minSlotAngle —
  // the boundaries of the forbidden arcs, which is where the nearest legal
  // bearing always lies.
  for (const r of rows) {
    if (holders.has(r.c.id) || clears(r.b)) {
      drift.set(r.c.id, 0);
      continue;
    }
    let best: number | null = null;
    for (const h of held) {
      for (const cand of [h + tuning.minSlotAngle, h - tuning.minSlotAngle]) {
        if (!clears(cand)) continue;
        const delta = wrapPi(cand - r.b);
        if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
      }
    }
    drift.set(r.c.id, best === null ? 1 : best >= 0 ? 1 : -1);
  }

  return { holders, drift };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/melee-ring.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/melee-ring.ts src/lab/sdf-zombie/melee-ring.test.ts
git commit -m "melee-ring: token arbitration on bearings

Separation's 0.35 m circles touch at 0.70 m while an arm reaches 0.6 m, so the
circles are satisfied and the arms always overlap. Fixed structurally: at most
two bodies swing at once, and a second token needs 90 degrees of clearance
from the first. Angles are the claimants' CURRENT bearings, not fixed slots,
which would orbit the ring as the player turns. Incumbency stops tokens
flickering between bodies at equal distance.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `attack.ts` — the alternating one-arm hook

**Files:**
- Rewrite: `src/lab/sdf-zombie/attack.ts`
- Rewrite: `src/lab/sdf-zombie/attack.test.ts`

Owner's verdict on the current pose: "both arms raising and slamming down is merely… okay. Maybe just one arm, a slap/hit/punch." The replacement is a hook: the swinging arm cocks back and out, then sweeps forward AND across the body. The across part is a yaw, which is why `motion.ts` needs a second rotation axis (Task 3).

`attackDrive` is unchanged — keep it exactly as it is. Only `ATTACK_TUNING`, `AttackPose` and `attackPose` change.

- [ ] **Step 1: Write the failing test**

Replace the `describe('attackPose', ...)` block in `src/lab/sdf-zombie/attack.test.ts` with this (keep the existing `describe('attackDrive', ...)` block exactly as it is):

```ts
describe('attackPose', () => {
  const STRIKE = (ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2;
  const WINDUP = ATTACK_TUNING.windupEnd;

  it('is exactly zero at phase 0 and phase 1, both sides', () => {
    for (const side of ['L', 'R'] as const) {
      for (const p of [0, 1]) {
        const pose = attackPose(p, side);
        expect(pose.rootOffset).toEqual([0, 0, 0]);
        expect(pose.reach).toEqual({ pitchL: 0, pitchR: 0, yawL: 0, yawR: 0 });
        for (const v of Object.values(pose.offsets)) expect(v).toEqual([0, 0, 0]);
      }
    }
  });

  it('swings the named arm, not the other one', () => {
    const r = attackPose(STRIKE, 'R').reach;
    expect(Math.abs(r.yawR)).toBeGreaterThan(Math.abs(r.yawL));
    expect(Math.abs(r.pitchR)).toBeGreaterThan(Math.abs(r.pitchL));
    const l = attackPose(STRIKE, 'L').reach;
    expect(Math.abs(l.yawL)).toBeGreaterThan(Math.abs(l.yawR));
    expect(Math.abs(l.pitchL)).toBeGreaterThan(Math.abs(l.pitchR));
  });

  it('L and R are mirror images', () => {
    const r = attackPose(STRIKE, 'R');
    const l = attackPose(STRIKE, 'L');
    expect(l.reach.yawL).toBeCloseTo(-r.reach.yawR, 9);
    expect(l.reach.yawR).toBeCloseTo(-r.reach.yawL, 9);
    expect(l.reach.pitchL).toBeCloseTo(r.reach.pitchR, 9);
    // The shoulder drive mirrors: R drives the right shoulder forward.
    expect(l.offsets.shoulderL![2]).toBeCloseTo(r.offsets.shoulderR![2], 9);
  });

  it('cocks out on the wind-up and sweeps across on the strike', () => {
    const wind = attackPose(WINDUP, 'R').reach;
    const hit = attackPose(STRIKE, 'R').reach;
    // Opposite signs: out, then across.
    expect(Math.sign(wind.yawR)).toBe(-Math.sign(hit.yawR));
    expect(Math.abs(hit.yawR)).toBeCloseTo(ATTACK_TUNING.yawStrike, 6);
    expect(Math.abs(wind.yawR)).toBeCloseTo(ATTACK_TUNING.yawWindup, 6);
  });

  it('the off arm counter-swings at a fraction of the swinging arm', () => {
    const r = attackPose(STRIKE, 'R').reach;
    expect(r.yawL).toBeCloseTo(-r.yawR * ATTACK_TUNING.offArmShare, 9);
    expect(r.pitchL).toBeCloseTo(-r.pitchR * ATTACK_TUNING.offArmShare, 9);
  });

  it('twists the torso: the swinging shoulder forward, the other back', () => {
    const p = attackPose(STRIKE, 'R');
    expect(p.offsets.shoulderR![2]).toBeGreaterThan(0);
    expect(p.offsets.shoulderL![2]).toBeCloseTo(-p.offsets.shoulderR![2], 9);
  });

  it('lunges less than the old two-arm slam did — the rotation carries it', () => {
    expect(ATTACK_TUNING.lunge).toBeLessThan(0.2);
    expect(attackPose(STRIKE, 'R').rootOffset[2]).toBeCloseTo(ATTACK_TUNING.lunge, 6);
  });

  it('drops only the swinging hand, and only on the forward half', () => {
    expect(attackPose(WINDUP, 'R').offsets.handR![1]).toBe(0);
    expect(attackPose(STRIKE, 'R').offsets.handR![1])
      .toBeCloseTo(-ATTACK_TUNING.handDrop, 6);
    expect(attackPose(STRIKE, 'R').offsets.handL![1]).toBe(0);
  });

  it('is finite across a full sweep, both sides', () => {
    for (const side of ['L', 'R'] as const) {
      for (let p = -0.5; p <= 1.5; p += 0.01) {
        const pose = attackPose(p, side);
        for (const v of [pose.rootOffset, ...Object.values(pose.offsets)]) {
          expect(v!.every(Number.isFinite)).toBe(true);
        }
        for (const a of Object.values(pose.reach)) expect(Number.isFinite(a)).toBe(true);
      }
    }
  });
});
```

Update the file's import line to `import { ATTACK_TUNING, attackDrive, attackPose } from './attack';` (unchanged) — no new imports are needed.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/attack.test.ts`
Expected: FAIL — `attackPose` takes one argument, and `pose.reach` is undefined.

- [ ] **Step 3: Replace ATTACK_TUNING**

In `src/lab/sdf-zombie/attack.ts`, replace the whole `ATTACK_TUNING` object with:

```ts
export const ATTACK_TUNING = {
  /** Beat boundaries as fractions of the swing. */
  windupEnd: 0.25,
  strikeEnd: 0.5,
  holdEnd: 0.6,
  /** Root drive forward at the strike peak (m). LOWER than the two-arm slam's
   *  0.22: the torso rotation now carries the weight, and the old lunge on
   *  top of a hook reads as a stumble rather than a punch. */
  lunge: 0.14,
  /** Root pull-back at the wind-up peak (m, magnitude). */
  windback: 0.07,
  /** Chest drive forward at the strike peak (m). */
  chestDrive: 0.10,
  /** Chest lean back at the wind-up peak (m, magnitude). */
  chestRear: 0.05,
  /** Neck/head carry this share of the chest offset. */
  headShare: 0.7,
  /** Swinging arm: shoulder pitch at the wind-up peak (rad, magnitude — the
   *  arm cocks BACK; the sign comes from the drive scalar). */
  pitchWindup: 0.85,
  /** Swinging arm: shoulder pitch at the strike peak (rad, forward). */
  pitchStrike: 0.55,
  /** Swinging arm: yaw cocked OUT, away from the body, at the wind-up (rad). */
  yawWindup: 0.55,
  /** Swinging arm: yaw swept ACROSS the body at the strike (rad). This is the
   *  whole difference between a hook and a chop. */
  yawStrike: 1.15,
  /** The off arm counter-swings at this share of the swinging arm's angles,
   *  opposite in sign. */
  offArmShare: 0.28,
  /** Forward drive of the swinging shoulder at the strike (m); the other
   *  shoulder takes the negative. Two opposite z offsets ARE the torso twist
   *  about the vertical — cheaper and more legible than a real rotation. */
  shoulderDrive: 0.06,
  /** Swinging hand's extra drop on the forward half (m). */
  handDrop: 0.10,
} as const;
```

- [ ] **Step 4: Replace the AttackPose interface**

Replace the `AttackPose` interface with:

```ts
export interface AttackPose {
  /** Body-local per-joint offsets — ADD to gait's offsets; missing = zero. */
  offsets: Partial<Record<GaitJointName, Vec3>>;
  /** Body-local pelvis offset — ADD to gait's rootOffset. */
  rootOffset: Vec3;
  /** Per-side reach-pivot deltas. `pitch` is about the body's right axis (as
   *  the reach pose already is); `yaw` is about world up and is new — it is
   *  the hook's horizontal sweep. Both ADD to the gait's reach pitch. */
  reach: { pitchL: number; pitchR: number; yawL: number; yawR: number };
}
```

- [ ] **Step 5: Replace attackPose**

Replace the whole `attackPose` function with:

```ts
/**
 * The swing pose at `phase`, swung by `side`'s arm. See the header for the
 * contract. Sign convention: body-local +x is the body's right, so the RIGHT
 * arm sweeping across the body is a NEGATIVE yaw and the left arm's is
 * positive — which is what `sgn` below carries, making L and R exact mirrors
 * by construction rather than by two hand-written branches.
 */
export function attackPose(
  phase: number, side: 'L' | 'R', tuning: AttackTuning = ATTACK_TUNING,
): AttackPose {
  const T = tuning;
  const d = attackDrive(phase, T);
  if (d === 0) {
    return {
      offsets: {
        chest: ZERO, neck: ZERO, head: ZERO,
        shoulderL: ZERO, shoulderR: ZERO, handL: ZERO, handR: ZERO,
      },
      rootOffset: ZERO,
      reach: { pitchL: 0, pitchR: 0, yawL: 0, yawR: 0 },
    };
  }
  const sgn = side === 'R' ? 1 : -1;
  const fwd = d >= 0;

  // The swinging arm. Pitch keeps the existing convention (positive = forward
  // reach), so a negative drive cocks it back. Yaw is cocked OUT on the
  // wind-up and swept ACROSS on the strike — opposite signs, which is what
  // makes it read as a hook rather than a shove.
  const pitchSwing = fwd ? d * T.pitchStrike : d * T.pitchWindup;
  const yawSwing = fwd ? -sgn * d * T.yawStrike : sgn * -d * T.yawWindup;
  const pitchOff = -pitchSwing * T.offArmShare;
  const yawOff = -yawSwing * T.offArmShare;

  const rootZ = fwd ? d * T.lunge : d * T.windback;
  const chestZ = fwd ? d * T.chestDrive : d * T.chestRear;
  const headZ = chestZ * T.headShare;
  // The twist scales with the drive, so the shoulders lead the wind-up too.
  const drive = d * T.shoulderDrive;
  const handY = fwd ? -d * T.handDrop : 0;

  const swingShoulder: Vec3 = [0, 0, drive];
  const offShoulder: Vec3 = [0, 0, -drive];
  const swingHand: Vec3 = [0, handY, 0];

  return {
    offsets: {
      chest: [0, 0, chestZ],
      neck: [0, 0, headZ],
      head: [0, 0, headZ],
      shoulderL: side === 'L' ? swingShoulder : offShoulder,
      shoulderR: side === 'R' ? swingShoulder : offShoulder,
      handL: side === 'L' ? swingHand : ZERO,
      handR: side === 'R' ? swingHand : ZERO,
    },
    rootOffset: [0, 0, rootZ],
    reach: {
      pitchL: side === 'L' ? pitchSwing : pitchOff,
      pitchR: side === 'R' ? pitchSwing : pitchOff,
      yawL: side === 'L' ? yawSwing : yawOff,
      yawR: side === 'R' ? yawSwing : yawOff,
    },
  };
}
```

- [ ] **Step 6: Update the file header**

Replace the header paragraph beginning `// FOUR BEATS ON ONE SCALAR.` with:

```ts
// FOUR BEATS ON ONE SCALAR, ONE ARM AT A TIME. Wind-up (the swinging arm
// cocks back and out, weight back), strike (the arm sweeps forward AND across
// the body while the torso twists into it), a short hold at contact, then
// recovery to zero. Every offset is that one signed `drive` scalar times a
// magnitude, which is what keeps the beats in step: there is no way for the
// arm to peak on a different frame from the lunge.
//
// The ACROSS part is a yaw about world up, and it is the whole difference
// between a hook and the two-arm chop this replaced (owner, 2026-09-04: "both
// arms raising and slamming them down is merely... okay"). motion.ts composes
// it as a second rotation on the reach pivot.
//
// The caller alternates `side` between swings — a stalled pack swinging the
// same arm every time reads as a metronome.
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/attack.test.ts`
Expected: PASS, 14 tests (5 `attackDrive` + 9 `attackPose`).

- [ ] **Step 8: Typecheck — expect failures in motion.ts**

Run: `npx tsc --noEmit`
Expected: FAIL in `src/lab/sdf-zombie/motion.ts` — `attackPose` now needs two arguments and `attack.reachPitch` no longer exists. **That is correct at this point**; Task 3 fixes it. Do not patch `motion.ts` here.

- [ ] **Step 9: Commit**

```bash
git add src/lab/sdf-zombie/attack.ts src/lab/sdf-zombie/attack.test.ts
git commit -m "attack: alternating one-arm hook replaces the two-arm slam

The swinging arm cocks back and out, then sweeps forward AND across the body
while the torso twists into it; the off arm counter-swings; the lunge drops
from 0.22 to 0.14 because the rotation now carries the weight. L and R are
exact mirrors by construction (one sign carried through) rather than two
hand-written branches.

motion.ts does not compile against this yet -- the reach pivot needs its
second axis, which is the next commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `motion.ts` — the reach pivot gains a world-up axis

**Files:**
- Modify: `src/lab/sdf-zombie/motion.ts`
- Modify: `src/lab/sdf-zombie/motion.test.ts`

**Read the house rule about bit-identity before you start.** The existing test that runs 30 frames with `cfg.attack` absent and compares rest poses exactly must keep passing, and the way it keeps passing is that the `undefined` path branches around every new line rather than adding a zero.

- [ ] **Step 1: Change the config field type**

In `src/lab/sdf-zombie/motion.ts`, replace the `attack?: number;` member of `MotionConfig` (and keep the comment above it, updating the first line) with:

```ts
  /** Melee swing: phase 0..1 plus which arm swings (brain.ts drives both
   *  through game-actor). UNDEFINED IS NOT "phase 0": undefined skips the
   *  composition branches entirely, so the lab's wiring — which never sets
   *  this — produces bit-identical motion. attack.ts's pose is exactly zero
   *  at phase 0 and 1, so setting either is also a no-op, just a slower one. */
  attack?: { phase: number; side: 'L' | 'R' };
```

- [ ] **Step 2: Update the pose evaluation**

Replace:

```ts
  const attack: AttackPose | null =
    cfg.attack !== undefined && !collapsed ? attackPose(cfg.attack) : null;
```

with:

```ts
  const attack: AttackPose | null =
    cfg.attack !== undefined && !collapsed
      ? attackPose(cfg.attack.phase, cfg.attack.side)
      : null;
```

- [ ] **Step 3: Update the arm pitch and add the yaw**

In the `if (armStyle === 'reach' && gait.pose.reach) {` block, inside `applyArm`, replace:

```ts
      const basePitch = (side === 'L' ? r.pitchL : r.pitchR) * armPresence;
      const pitch = attack ? basePitch + attack.reachPitch : basePitch;
      const qUp = qFromAxisAngle(right, -pitch);
      const qFore = qFromAxisAngle(right, -(pitch - r.drop * armPresence));
```

with:

```ts
      const basePitch = (side === 'L' ? r.pitchL : r.pitchR) * armPresence;
      const pitch = attack
        ? basePitch + (side === 'L' ? attack.reach.pitchL : attack.reach.pitchR)
        : basePitch;
      const qUp = qFromAxisAngle(right, -pitch);
      const qFore = qFromAxisAngle(right, -(pitch - r.drop * armPresence));
      // THE HOOK'S SWEEP. A pitch about the body's right axis can only raise
      // and lower an arm; carrying it ACROSS the body is a rotation about
      // world up, composed onto the same segments AFTER the pitch so the arm
      // sweeps from wherever the raise left it. Null when there is no attack
      // — a q of angle 0 would still be a multiply, and the lab's
      // bit-identity pin is not worth spending on tidiness.
      const attackYaw = attack ? (side === 'L' ? attack.reach.yawL : attack.reach.yawR) : 0;
      const qSweep = attackYaw !== 0 ? qFromAxisAngle([0, 1, 0], attackYaw) : null;
      const swept = (v: Vec3): Vec3 => (qSweep ? qRotate(qSweep, v) : v);
```

- [ ] **Step 4: Route the segments through the sweep**

A few lines below, replace:

```ts
      const eGeom = add(targets[iS]!, qRotate(qUp, s1));
```

with:

```ts
      const eGeom = add(targets[iS]!, swept(qRotate(qUp, s1)));
```

and replace:

```ts
      targets[iH] = add(
        add(add(eGeom, qRotate(qFore, s2)), shiftW),
```

with:

```ts
      targets[iH] = add(
        add(add(eGeom, swept(qRotate(qFore, s2))), shiftW),
```

- [ ] **Step 5: Update the existing attack-seam tests**

In `src/lab/sdf-zombie/motion.test.ts`, the `describe('stepMotion — the attack seam', ...)` block passes `attack: 0.55` and `attack: 0` as numbers. Update every one of those to the object form, and add the per-side assertions. Replace the whole `describe('stepMotion — the attack seam', ...)` block with:

```ts
describe('stepMotion — the attack seam', () => {
  /** Runs a fixed seed for `frames` and returns every rest pose. */
  function poses(cfg: MotionConfig, frames: number) {
    const body = buildBody(makeZombie());
    const bound = bindRig(body);
    const joints = makeMotionJoints(body, bound.rig.restPose)!;
    let state = makeMotionState(4242, [0, 0, 0]);
    const rng = makeRng(4242);
    const bounds = { minX: -4, maxX: 4, minZ: -4, maxZ: 4 };
    const out: Vec3[][] = [];
    for (let i = 0; i < frames; i++) {
      const r = stepMotion(state, joints, cfg, CALM_SIGNALS, bound.rig.points, bounds, rng);
      state = r.state;
      out.push(r.frame.restPose.map(p => [...p] as Vec3));
    }
    return out;
  }

  const STRIKE = (ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2;

  it('is bit-identical to today when cfg.attack is absent', () => {
    // The lab's wiring never sets `attack`. An object that merely CARRIES the
    // key as undefined must be indistinguishable from one that does not.
    const a = poses({ enabled: true, wander: true }, 30);
    const b = poses({ enabled: true, wander: true, attack: undefined }, 30);
    expect(b).toEqual(a);
  });

  it('moves the pose once cfg.attack is set', () => {
    const calm = poses({ enabled: true, wander: true }, 1);
    const swung = poses({ enabled: true, wander: true, attack: { phase: STRIKE, side: 'R' } }, 1);
    expect(swung).not.toEqual(calm);
  });

  it('phase 0 leaves the pose exactly where no attack leaves it', () => {
    const calm = poses({ enabled: true, wander: true }, 5);
    const zero = poses({ enabled: true, wander: true, attack: { phase: 0, side: 'R' } }, 5);
    expect(zero).toEqual(calm);
  });

  it('drives the pelvis forward at the strike peak', () => {
    const calm = poses({ enabled: true, wander: false }, 1)[0]!;
    const swung = poses(
      { enabled: true, wander: false, attack: { phase: STRIKE, side: 'R' } }, 1,
    )[0]!;
    const body = buildBody(makeZombie());
    const bound = bindRig(body);
    const joints = makeMotionJoints(body, bound.rig.restPose)!;
    const iPelvis = joints.index.pelvis;
    const moved = Math.hypot(
      swung[iPelvis]![0] - calm[iPelvis]![0],
      swung[iPelvis]![2] - calm[iPelvis]![2],
    );
    expect(moved).toBeCloseTo(attackPose(STRIKE, 'R').rootOffset[2], 6);
  });

  it('a right-side swing moves the right hand further than the left', () => {
    const body = buildBody(makeZombie());
    const bound = bindRig(body);
    const joints = makeMotionJoints(body, bound.rig.restPose)!;
    const calm = poses({ enabled: true, wander: false }, 1)[0]!;
    const dist = (side: 'L' | 'R', j: 'handL' | 'handR') => {
      const swung = poses(
        { enabled: true, wander: false, attack: { phase: STRIKE, side } }, 1,
      )[0]!;
      const i = joints.index[j];
      return Math.hypot(
        swung[i]![0] - calm[i]![0], swung[i]![1] - calm[i]![1], swung[i]![2] - calm[i]![2],
      );
    };
    expect(dist('R', 'handR')).toBeGreaterThan(dist('R', 'handL'));
    expect(dist('L', 'handL')).toBeGreaterThan(dist('L', 'handR'));
  });

  it('the sweep moves the hand SIDEWAYS, not only forward — it is a hook', () => {
    const body = buildBody(makeZombie());
    const bound = bindRig(body);
    const joints = makeMotionJoints(body, bound.rig.restPose)!;
    const calm = poses({ enabled: true, wander: false }, 1)[0]!;
    const swung = poses(
      { enabled: true, wander: false, attack: { phase: STRIKE, side: 'R' } }, 1,
    )[0]!;
    const i = joints.index.handR;
    // Body yaw is ~0 in this fixture, so body-local x is world x.
    expect(Math.abs(swung[i]![0] - calm[i]![0])).toBeGreaterThan(0.05);
  });
});
```

Add `ATTACK_TUNING` and `attackPose` to the file's import from `./attack` if they are not already there.

- [ ] **Step 6: Run the motion suite**

Run: `npx vitest run src/lab/sdf-zombie/motion.test.ts`
Expected: PASS, including the bit-identity pin.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL only in `src/lab/sdf-zombie/webgpu/game-actor.ts` (it still passes a number to `cfg.attack`). Task 5 fixes it. `motion.ts` and `attack.ts` themselves must be clean.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/motion.ts src/lab/sdf-zombie/motion.test.ts
git commit -m "motion: the reach pivot gains a world-up sweep for the hook

A pitch about the body's right axis can only raise and lower an arm; carrying
it across the body needs a rotation about world up, composed after the pitch.
cfg.attack becomes {phase, side}. The undefined path still branches around
every new line -- a zero-angle quaternion would still be a multiply, and the
lab's bit-identity pin is not worth spending on tidiness. That pin is
unchanged and still passes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `brain.ts` — the seven-state machine

**Files:**
- Rewrite: `src/lab/sdf-zombie/brain.ts`
- Rewrite: `src/lab/sdf-zombie/brain.test.ts`

The owner asked for "a more defined set of behaviors, maybe like a state machine". The current file has three modes and three ad-hoc overrides doing the same job three different ways: the `engaged` hysteresis latch, the "a committed swing always finishes" early return, and the blast hold — which is not even in this file, it is a `holdSecs` timer in `game-actor.ts` gating `cfg.wander` from outside. All three become states.

- [ ] **Step 1: Write the failing test**

Replace the whole contents of `src/lab/sdf-zombie/brain.test.ts` with:

```ts
// src/lab/sdf-zombie/brain.test.ts
import { describe, it, expect } from 'vitest';
import {
  BRAIN_TUNING, makeBrain, stepBrain,
  type Brain, type BrainInput,
} from './brain';

const DT = 1 / 60;

function input(over: Partial<BrainInput> = {}): BrainInput {
  return {
    dt: DT,
    self: { x: 0, z: 0, yaw: 0, room: 3 },   // facing +z
    player: { x: 0, z: 4, room: 3 },          // straight ahead, 4 m
    alerted: false,
    hasToken: false,
    drift: 0,
    blasted: false,
    ...over,
  };
}

/** Runs the brain for `seconds` and returns the last output. */
function run(brain: Brain, over: Partial<BrainInput>, seconds: number) {
  let b = brain;
  let out = stepBrain(b, input(over));
  b = out.brain;
  for (let t = DT; t < seconds; t += DT) {
    out = stepBrain(b, input(over));
    b = out.brain;
  }
  return out;
}

/** Alert, in the player's room, at `d` metres directly ahead. */
function alertAt(d: number, over: Partial<BrainInput> = {}) {
  const seed = stepBrain(makeBrain(), input()).brain;
  return { brain: seed, over: { player: { x: 0, z: d, room: 3 }, ...over } };
}

describe('stepBrain — aggro (carried over from the predecessor spec)', () => {
  it('notices a player in front, in the same room, in range', () => {
    const out = stepBrain(makeBrain(), input());
    expect(out.brain.alert).toBe(true);
    expect(out.brain.state).toBe('pursue');
  });

  it('does not notice a player behind it', () => {
    const out = stepBrain(makeBrain(), input({ player: { x: 0, z: -4, room: 3 } }));
    expect(out.brain.alert).toBe(false);
    expect(out.brain.state).toBe('idle');
    expect(out.target).toBeNull();
  });

  it('does not notice a player in another room', () => {
    expect(stepBrain(makeBrain(), input({ player: { x: 0, z: 4, room: 2 } })).brain.alert)
      .toBe(false);
  });

  it('does not notice a player past noticeRange', () => {
    const far = BRAIN_TUNING.noticeRange + 1;
    expect(stepBrain(makeBrain(), input({ player: { x: 0, z: far, room: 3 } })).brain.alert)
      .toBe(false);
  });

  it('a shot in the room turns heads regardless of the cone', () => {
    const out = stepBrain(
      makeBrain(), input({ player: { x: 0, z: -4, room: 3 }, alerted: true }),
    );
    expect(out.brain.alert).toBe(true);
  });

  it('keeps the lock while the player is briefly out of the room', () => {
    const seed = stepBrain(makeBrain(), input()).brain;
    const out = run(seed, { player: { x: 0, z: 4, room: 9 } }, BRAIN_TUNING.loseGrace - 0.5);
    expect(out.brain.alert).toBe(true);
  });

  it('gives up past the grace, and goes idle', () => {
    const seed = stepBrain(makeBrain(), input()).brain;
    const out = run(seed, { player: { x: 0, z: 4, room: 9 } }, BRAIN_TUNING.loseGrace + 0.5);
    expect(out.brain.alert).toBe(false);
    expect(out.brain.state).toBe('idle');
    expect(out.target).toBeNull();
  });
});

describe('stepBrain — the ring states', () => {
  it('pursues while further out than engageRange', () => {
    const { brain, over } = alertAt(BRAIN_TUNING.engageRange + 1);
    const out = stepBrain(brain, input(over));
    expect(out.brain.state).toBe('pursue');
    expect(out.halt).toBe(false);
    expect(out.engaged).toBe(false);
  });

  it('encircles inside engageRange without a token', () => {
    const { brain, over } = alertAt(2.0);
    const out = stepBrain(brain, input({ ...over, hasToken: false }));
    expect(out.brain.state).toBe('encircle');
    expect(out.engaged).toBe(false);
    expect(out.target).not.toBeNull();
  });

  it('engages inside engageRange with a token', () => {
    const { brain, over } = alertAt(2.0);
    const out = stepBrain(brain, input({ ...over, hasToken: true }));
    expect(out.brain.state).toBe('engage');
    expect(out.engaged).toBe(true);
  });

  it('an encircler holds outerRadius, not the player', () => {
    const { brain, over } = alertAt(2.0);
    const out = stepBrain(brain, input({ ...over, hasToken: false }));
    const t = out.target!;
    expect(Math.hypot(t[0] - 0, t[2] - 4)).toBeCloseTo(BRAIN_TUNING.outerRadius, 6);
  });

  it('an engager walks at the PLAYER, not at a standoff point', () => {
    // The predecessor's bug: a target at meleeRadius plus stepWander's 0.4 m
    // arrive band parks the body outside meleeRadius, so it never engages.
    const { brain, over } = alertAt(2.0);
    const out = stepBrain(brain, input({ ...over, hasToken: true }));
    expect(out.target).toEqual([0, 0, 2.0]);
  });

  it('drift rotates the encircle target tangentially', () => {
    const { brain, over } = alertAt(2.0);
    const still = stepBrain(brain, input({ ...over, hasToken: false, drift: 0 })).target!;
    const moved = stepBrain(brain, input({ ...over, hasToken: false, drift: 1 })).target!;
    expect(moved).not.toEqual(still);
    // Same radius, different bearing: it slides around the ring.
    expect(Math.hypot(moved[0] - 0, moved[2] - 4))
      .toBeCloseTo(Math.hypot(still[0] - 0, still[2] - 4), 6);
  });

  it('falls back to pursue past releaseRange (hysteresis)', () => {
    const { brain, over } = alertAt(2.0);
    const engaged = stepBrain(brain, input({ ...over, hasToken: true })).brain;
    const mid = (BRAIN_TUNING.engageRange + BRAIN_TUNING.releaseRange) / 2;
    const held = stepBrain(engaged, input({
      player: { x: 0, z: mid, room: 3 }, hasToken: true,
    }));
    expect(held.brain.state).toBe('engage');
    const gone = stepBrain(held.brain, input({
      player: { x: 0, z: BRAIN_TUNING.releaseRange + 0.5, room: 3 }, hasToken: true,
    }));
    expect(gone.brain.state).toBe('pursue');
  });
});

describe('stepBrain — the swing', () => {
  const close = { player: { x: 0, z: BRAIN_TUNING.meleeRadius - 0.05, room: 3 }, hasToken: true };

  it('attacks at meleeRadius with a token and no cooldown', () => {
    const { brain } = alertAt(2.0);
    const out = stepBrain(brain, input(close));
    expect(out.brain.state).toBe('attack');
    expect(out.halt).toBe(true);
    expect(out.committed).toBe(true);
    expect(out.attack).toEqual({ phase: 0, side: out.brain.side });
  });

  it('runs the swing over swingSec, then recovers and flips the arm', () => {
    const { brain } = alertAt(2.0);
    let out = stepBrain(brain, input(close));
    const firstSide = out.attack!.side;
    let b = out.brain;
    for (let i = 0; i < Math.ceil(BRAIN_TUNING.swingSec / DT) + 2; i++) {
      out = stepBrain(b, input(close));
      b = out.brain;
    }
    expect(b.state).toBe('recover');
    expect(b.cooldown).toBeGreaterThan(0);
    expect(b.side).not.toBe(firstSide);
  });

  it('a committed swing reports committed and finishes after the token is gone', () => {
    const { brain } = alertAt(2.0);
    const swinging = stepBrain(brain, input(close)).brain;
    const out = stepBrain(swinging, input({ ...close, hasToken: false }));
    expect(out.brain.state).toBe('attack');
    expect(out.committed).toBe(true);
  });

  it('recover holds position rather than shuffling in', () => {
    const { brain } = alertAt(2.0);
    let out = stepBrain(brain, input(close));
    let b = out.brain;
    for (let i = 0; i < Math.ceil(BRAIN_TUNING.swingSec / DT) + 2; i++) {
      out = stepBrain(b, input(close)); b = out.brain;
    }
    expect(b.state).toBe('recover');
    expect(out.halt).toBe(true);
    expect(out.engaged).toBe(true);
  });

  it('a revoked token drops a recovering body back to encircle', () => {
    const { brain } = alertAt(2.0);
    let out = stepBrain(brain, input(close));
    let b = out.brain;
    for (let i = 0; i < Math.ceil(BRAIN_TUNING.swingSec / DT) + 2; i++) {
      out = stepBrain(b, input(close)); b = out.brain;
    }
    expect(b.state).toBe('recover');
    const dropped = stepBrain(b, input({ ...close, hasToken: false }));
    expect(dropped.brain.state).toBe('encircle');
  });
});

describe('stepBrain — stagger', () => {
  it('a blast forces stagger from every other state', () => {
    const states: Brain['state'][] = [];
    const seeds: Brain[] = [];
    // idle
    seeds.push(makeBrain());
    // pursue
    seeds.push(stepBrain(makeBrain(), input()).brain);
    // encircle / engage / attack / recover
    const { brain } = alertAt(2.0);
    seeds.push(stepBrain(brain, input({ player: { x: 0, z: 2, room: 3 } })).brain);
    seeds.push(stepBrain(brain, input({ player: { x: 0, z: 2, room: 3 }, hasToken: true })).brain);
    const close = { player: { x: 0, z: 0.9, room: 3 }, hasToken: true };
    const swinging = stepBrain(brain, input(close)).brain;
    seeds.push(swinging);
    let b = swinging;
    let out = stepBrain(b, input(close));
    for (let i = 0; i < Math.ceil(BRAIN_TUNING.swingSec / DT) + 2; i++) {
      out = stepBrain(b, input(close)); b = out.brain;
    }
    seeds.push(b);
    for (const s of seeds) {
      const hit = stepBrain(s, input({ blasted: true }));
      states.push(hit.brain.state);
      expect(hit.halt).toBe(true);
      // A staggering body must not keep a melee slot it cannot use.
      expect(hit.committed).toBe(false);
      expect(hit.engaged).toBe(false);
    }
    expect(states.every(s => s === 'stagger')).toBe(true);
  });

  it('holds for blastHoldSec then resumes the chase', () => {
    const seed = stepBrain(makeBrain(), input()).brain;
    const hit = stepBrain(seed, input({ blasted: true })).brain;
    const out = run(hit, {}, BRAIN_TUNING.blastHoldSec + 0.1);
    expect(out.brain.state).not.toBe('stagger');
    expect(out.brain.alert).toBe(true);
  });

  it('a blast cancels a swing in flight — the lurch outranks the hook', () => {
    const { brain } = alertAt(2.0);
    const swinging = stepBrain(
      brain, input({ player: { x: 0, z: 0.9, room: 3 }, hasToken: true }),
    ).brain;
    expect(swinging.state).toBe('attack');
    const hit = stepBrain(swinging, input({ blasted: true }));
    expect(hit.brain.state).toBe('stagger');
    expect(hit.attack).toBeNull();
    expect(hit.brain.swingT).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/brain.test.ts`
Expected: FAIL — `makeBrain` is not exported.

- [ ] **Step 3: Rewrite the module**

Replace the whole contents of `src/lab/sdf-zombie/brain.ts` with:

```ts
// src/lab/sdf-zombie/brain.ts
//
// One zombie's decision layer, as a named state machine. Pure — no clock, no
// RNG, no THREE — so every transition is unit-testable against hand-worked
// geometry.
//
// WHY IT IS A MACHINE NOW. The first version had three modes and three
// ad-hoc overrides doing the same job three different ways: a hysteresis
// latch for "close enough to swing", an early return for "a committed swing
// always finishes", and a blast hold that was not even in this file — it was
// a holdSecs timer in game-actor.ts gating cfg.wander from outside. All three
// are states here, which is the whole point: the transitions are a table you
// can read in one place instead of conditionals across two files.
//
// IT DOES NOT DRIVE LOCOMOTION. There is exactly one walker (wander.ts,
// through motion.ts) and a second would mean two sets of turn rates drifting
// apart. The machine emits a TARGET and a HALT flag; the actor writes them
// into the wander.
//
// IT DOES NOT DECIDE WHO SWINGS. That is crowd-level and lives in
// melee-ring.ts; `hasToken` and `drift` arrive as input. This file only says
// what one body does with the answer.
//
// HEADING CONVENTION (wander.ts): yaw 0 faces +z, positive is clockwise seen
// from above. The bearing to a point is atan2(dx, dz).
//
// ROOM-BOUND, DELIBERATELY. stepWander clamps every body to its own room's
// bounds, so a chaser stops at the doorway. Cross-room pursuit needs
// navigation and is a separate spec.
import type { Vec3 } from './types';
import { wrapPi } from './wander';

export type BrainState =
  | 'idle' | 'pursue' | 'encircle' | 'engage' | 'attack' | 'recover' | 'stagger';

export interface Brain {
  state: BrainState;
  /** Has noticed the player and not yet forgotten him. */
  alert: boolean;
  /** Seconds the player has been out of this brain's room (0 while in it). */
  lostFor: number;
  /** Swing progress 0..1 while state === 'attack', else 0. */
  swingT: number;
  /** Seconds until another swing may start. */
  cooldown: number;
  /** Seconds of blast hold remaining. */
  holdSecs: number;
  /** Which arm the NEXT swing uses. Alternates, so a stalled pack swinging
   *  the same arm every time does not read as a metronome. */
  side: 'L' | 'R';
}

export interface BrainSelf { x: number; z: number; yaw: number; room: number }
export interface BrainPlayer { x: number; z: number; room: number }

export interface BrainInput {
  dt: number;
  self: BrainSelf;
  /** null when the player is somewhere with no room id (a tunnel, the void). */
  player: BrainPlayer | null;
  /** A shot was fired in this brain's room since the last step. */
  alerted: boolean;
  /** This body holds a melee token this frame (melee-ring.ts). */
  hasToken: boolean;
  /** Tangential shuffle direction while waiting (melee-ring.ts). */
  drift: -1 | 0 | 1;
  /** A blast-profile hit landed this frame. Outranks every other transition. */
  blasted: boolean;
}

export interface BrainOutput {
  brain: Brain;
  /** Wander-target override (world ground point); null = leave it alone. */
  target: Vec3 | null;
  /** True = locomotion off this frame (the actor's cfg.wander gate). */
  halt: boolean;
  /** The swing to compose, or null. */
  attack: { phase: number; side: 'L' | 'R' } | null;
  /** True while this body should be separated at the wider engaged radius —
   *  belt-and-braces for the moment of arrival, before the ring has settled. */
  engaged: boolean;
  /** True while the ring may NOT revoke this body's token. */
  committed: boolean;
}

export const BRAIN_TUNING = {
  /** Beyond this the player goes unnoticed (m). */
  noticeRange: 9,
  /** Half-angle of the notice cone (rad). */
  noticeCone: (70 * Math.PI) / 180,
  /** Alert survives this long after the player leaves the room (s). */
  loseGrace: 4,
  /** Where a token holder stands (m). */
  meleeRadius: 1.0,
  /** Where a waiter holds (m). */
  outerRadius: 1.8,
  /** pursue -> the ring states (m). */
  engageRange: 2.6,
  /** Back to pursue — hysteresis against engageRange (m). */
  releaseRange: 3.2,
  /** Tangential step applied to an encircling body's target (rad). */
  driftStep: 0.6,
  /** One swing, wind-up through recovery (s). */
  swingSec: 0.7,
  /** Gap before the next swing may start (s). */
  cooldownSec: 1.1,
  /** Blast hold — moved here from game-actor.ts's BLAST_HOLD_SEC (s). */
  blastHoldSec: 0.55,
} as const;

export type BrainTuning = typeof BRAIN_TUNING;

export function makeBrain(): Brain {
  return {
    state: 'idle', alert: false, lostFor: 0,
    swingT: 0, cooldown: 0, holdSecs: 0, side: 'R',
  };
}

/** A point `radius` from the player, on `bearing`. */
function ringPoint(player: BrainPlayer, bearing: number, radius: number): Vec3 {
  return [player.x + Math.sin(bearing) * radius, 0, player.z + Math.cos(bearing) * radius];
}

export function stepBrain(
  brain: Brain,
  input: BrainInput,
  tuning: BrainTuning = BRAIN_TUNING,
): BrainOutput {
  const dt = Math.max(0, input.dt);
  const { self, player } = input;

  let { state, alert, lostFor, swingT, cooldown, holdSecs, side } = brain;
  cooldown = Math.max(0, cooldown - dt);
  holdSecs = Math.max(0, holdSecs - dt);

  const sameRoom = player !== null && player.room === self.room;
  lostFor = sameRoom ? 0 : lostFor + dt;

  const dx = player ? player.x - self.x : 0;
  const dz = player ? player.z - self.z : 0;
  const dist = player ? Math.hypot(dx, dz) : Infinity;

  // --- notice, then lock ---------------------------------------------------
  if (!alert && sameRoom) {
    if (input.alerted) {
      alert = true;                              // a gunshot bypasses the cone
    } else if (dist <= tuning.noticeRange) {
      const bearing = Math.atan2(dx, dz);
      if (Math.abs(wrapPi(bearing - self.yaw)) <= tuning.noticeCone) alert = true;
    }
  }
  if (alert && lostFor > tuning.loseGrace) alert = false;

  const idle = (): BrainOutput => ({
    brain: { state: 'idle', alert, lostFor, swingT: 0, cooldown, holdSecs, side },
    target: null, halt: false, attack: null, engaged: false, committed: false,
  });

  // --- stagger outranks everything ----------------------------------------
  // A blast-profile hit forces it from any state and DROPS the token: a
  // staggering body must not hold a melee slot it cannot use. The swing is
  // cancelled outright — the lurch is the bigger read.
  if (input.blasted) {
    return {
      brain: { state: 'stagger', alert, lostFor, swingT: 0, cooldown, holdSecs: tuning.blastHoldSec, side },
      target: null, halt: true, attack: null, engaged: false, committed: false,
    };
  }
  if (state === 'stagger') {
    if (holdSecs > 0) {
      return {
        brain: { state, alert, lostFor, swingT: 0, cooldown, holdSecs, side },
        target: null, halt: true, attack: null, engaged: false, committed: false,
      };
    }
    state = alert && player ? 'pursue' : 'idle';
  }

  if (!alert || !player) return idle();

  const bearing = Math.atan2(self.x - player.x, self.z - player.z);
  const playerPoint: Vec3 = [player.x, 0, player.z];

  // --- a committed swing runs to the end ----------------------------------
  if (state === 'attack') {
    swingT = tuning.swingSec > 0 ? Math.min(1, swingT + dt / tuning.swingSec) : 1;
    if (swingT < 1) {
      return {
        brain: { state, alert, lostFor, swingT, cooldown, holdSecs, side },
        target: playerPoint, halt: true,
        attack: { phase: swingT, side },
        engaged: true, committed: true,
      };
    }
    swingT = 0;
    cooldown = tuning.cooldownSec;
    side = side === 'R' ? 'L' : 'R';           // alternate
    state = 'recover';
  }

  // --- pursue <-> ring, with hysteresis ------------------------------------
  const inRing = state === 'encircle' || state === 'engage' || state === 'recover';
  if (inRing && dist > tuning.releaseRange) state = 'pursue';
  else if (!inRing && dist <= tuning.engageRange) state = input.hasToken ? 'engage' : 'encircle';

  if (state === 'pursue') {
    return {
      brain: { state, alert, lostFor, swingT: 0, cooldown, holdSecs, side },
      // The PLAYER, not a standoff point: stepWander's 0.4 m arrive band on a
      // target at meleeRadius parks the body outside meleeRadius, so it could
      // never engage (the predecessor's defect, found by the crowd gate).
      target: playerPoint, halt: false, attack: null,
      engaged: false, committed: false,
    };
  }

  // Inside the ring. The token decides which side of it this body is on.
  if (!input.hasToken) {
    return {
      brain: { state: 'encircle', alert, lostFor, swingT: 0, cooldown, holdSecs, side },
      target: ringPoint(player, bearing + input.drift * tuning.driftStep, tuning.outerRadius),
      halt: false, attack: null, engaged: false, committed: false,
    };
  }

  if (state === 'recover' && cooldown > 0) {
    return {
      brain: { state: 'recover', alert, lostFor, swingT: 0, cooldown, holdSecs, side },
      target: playerPoint, halt: true, attack: null,
      engaged: true, committed: false,
    };
  }

  if (dist <= tuning.meleeRadius && cooldown <= 0) {
    return {
      brain: { state: 'attack', alert, lostFor, swingT: 0, cooldown, holdSecs, side },
      target: playerPoint, halt: true,
      attack: { phase: 0, side },
      engaged: true, committed: true,
    };
  }

  return {
    brain: { state: 'engage', alert, lostFor, swingT: 0, cooldown, holdSecs, side },
    target: playerPoint, halt: false, attack: null,
    engaged: true, committed: false,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/brain.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL only in `src/lab/sdf-zombie/webgpu/game-actor.ts` (it imports `makeBrainState` / `BrainState`-as-a-struct and passes a number to `cfg.attack`). Task 5 fixes it.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/brain.ts src/lab/sdf-zombie/brain.test.ts
git commit -m "brain: seven named states replace three modes and three overrides

idle / pursue / encircle / engage / attack / recover / stagger. The three
things that used to be special cases are now states: the melee hysteresis
latch, the committed-swing early return, and the blast hold -- which was not
even in this file, it was a holdSecs timer in game-actor gating cfg.wander
from outside. Stagger outranks everything and drops the token, because a
staggering body must not hold a melee slot it cannot use.

Also fixes the predecessor's standoff defect properly: an engager walks at the
PLAYER, and the state flip halts it at meleeRadius, rather than aiming at a
point stepWander's arrive band would stop it short of.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `game-actor.ts` — feed the ring and the blast into the brain

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/lab/sdf-zombie/webgpu/game-actor.test.ts`, replace the `describe('createZombieActor — the brain and the crowd', ...)` block's brain-related tests by appending this new block at the end of the file (leave the existing `nudge` and `chase routing helpers` tests exactly as they are):

```ts
describe('createZombieActor — the ring wiring', () => {
  const near = { x: 0, z: 1.5, room: 3 };

  it('reports its brain state and takes a ring verdict', () => {
    const a = makeTestActor({ start: [0, 0, 0], room: 3 });
    a.setBrainInput(near, false);
    a.setRingInput(true, 0);
    a.step(1 / 60);
    expect(a.brain().alert).toBe(true);
    expect(['engage', 'attack']).toContain(a.brain().state);
    expect(a.engagedForCrowd()).toBe(true);
  });

  it('encircles when the ring gives it no token', () => {
    const a = makeTestActor({ start: [0, 0, 0], room: 3 });
    a.setBrainInput(near, false);
    a.setRingInput(false, 1);
    a.step(1 / 60);
    expect(a.brain().state).toBe('encircle');
    expect(a.engagedForCrowd()).toBe(false);
  });

  it('a slug hit staggers it through the brain, not a private timer', () => {
    const a = makeTestActor({ start: [0, 0, 0], room: 3 });
    a.setBrainInput(near, false);
    a.setRingInput(true, 0);
    a.step(1 / 60);
    a.hitSlug([0, 1.1, 0.2], [0, 0, 1]);
    a.setBrainInput(near, false);
    a.setRingInput(true, 0);
    a.step(1 / 60);
    expect(a.brain().state).toBe('stagger');
    expect(a.committed()).toBe(false);
  });

  it('debug() carries the state, token and swing for the capture driver', () => {
    const a = makeTestActor({ start: [0, 0, 0], room: 3 });
    for (let i = 0; i < 8; i++) {
      a.setBrainInput({ x: 0, z: 0.6, room: 3 }, true);
      a.setRingInput(true, 0);
      a.step(1 / 60);
    }
    expect(a.debug().state).toBe('attack');
    expect(a.debug().swingT).toBeGreaterThan(0);
    expect(['L', 'R']).toContain(a.debug().side);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-actor.test.ts -t "ring wiring"`
Expected: FAIL — `a.setRingInput is not a function`.

- [ ] **Step 3: Update the imports and state**

In `src/lab/sdf-zombie/webgpu/game-actor.ts`, replace the brain import with:

```ts
import {
  makeBrain, stepBrain, type Brain, type BrainPlayer,
} from '../brain';
```

Replace the brain state block with:

```ts
  let brain: Brain = makeBrain();
  let brainPlayer: BrainPlayer | null = null;
  let brainAlerted = false;
  let ringToken = false;
  let ringDrift: -1 | 0 | 1 = 0;
  /** A blast-profile hit landed since the last step — one-shot into the brain. */
  let pendingBlast = false;
  let lastEngaged = false;
  let lastCommitted = false;
```

- [ ] **Step 4: Delete the private blast timer**

Delete the `const BLAST_HOLD_SEC = 0.55;` declaration and its comment block near the top of the file, and delete the `let holdSecs = 0;` declaration. Then:

* Delete the line `holdSecs = Math.max(0, holdSecs - sdt);` inside the sub-step loop.
* In `applyProjectileHit`, replace `holdSecs = BLAST_HOLD_SEC;` with `pendingBlast = true;`.
* In the `debug()` fallback object and the `lastDebug` assignment, replace `holdSecs,` with `holdSecs: brain.holdSecs,`.
* In the `ZombieActor` interface's `debug()` return type, `holdSecs: number;` stays — it now reads the brain's.

The knockback (`knockV`, `knockDir`, `BLAST_KNOCK_MPS`, `BLAST_KNOCK_DECAY`) is NOT part of this and stays exactly as it is: it moves the root, which is a different thing from gating locomotion.

- [ ] **Step 5: Update the brain call inside step()**

Replace the `const think = stepBrain(brain, { ... });` call and the two lines after it with:

```ts
      const think = stepBrain(brain, {
        dt: sdt,
        self: {
          x: state.wander.pos[0], z: state.wander.pos[2],
          yaw: bodyYaw, room: opts.room,
        },
        player: brainPlayer,
        alerted: brainAlerted,
        hasToken: ringToken,
        drift: ringDrift,
        blasted: pendingBlast,
      });
      brain = think.brain;
      brainAlerted = false;   // one-shot: the first sub-step consumes it
      pendingBlast = false;   // likewise
      lastEngaged = think.engaged;
      lastCommitted = think.committed;
```

- [ ] **Step 6: Route toward the brain's own target**

In the chase-routing block, replace:

```ts
        const goal: Vec3 = brainPlayer
          ? [brainPlayer.x, 0, brainPlayer.z]
          : think.target;
```

with:

```ts
        // The brain now emits the point it actually wants walked to — the
        // player for pursue/engage, a ring point for encircle — so the
        // router must NOT substitute the player, or an encircling body would
        // be routed straight into the melee it is waiting outside of.
        const goal: Vec3 = think.target;
```

- [ ] **Step 7: Update the motion config**

Replace the `stepMotion` config argument with:

```ts
        {
          enabled: true,
          wander: !think.halt,
          // Spread, not `attack: think.attack ?? undefined`: motion.ts's
          // bit-identity contract is about the key being ABSENT.
          ...(think.attack !== null ? { attack: think.attack } : {}),
        },
```

- [ ] **Step 8: Add the new members**

In `export interface ZombieActor`, replace the `brain(): BrainState;` member with:

```ts
  /** Live brain state — the debug seam and the capture driver's oracle. */
  brain(): Brain;
  /** This frame's melee-ring verdict for this body (melee-ring.ts). Set
   *  BEFORE step(), like setBrainInput. */
  setRingInput(hasToken: boolean, drift: -1 | 0 | 1): void;
  /** True while game-main should submit this body to crowd separation at the
   *  wider engaged radius. */
  engagedForCrowd(): boolean;
  /** True while the ring may not revoke this body's token (mid-swing). */
  committed(): boolean;
```

and extend the `debug()` return type: replace `mode: string;` with:

```ts
    state: string;
    side: 'L' | 'R';
    hasToken: boolean;
```

In the returned object literal, replace `brain: () => brain,` with:

```ts
    brain: () => brain,
    setRingInput: (hasToken: boolean, drift: -1 | 0 | 1) => {
      ringToken = hasToken;
      ringDrift = drift;
    },
    engagedForCrowd: () => lastEngaged,
    committed: () => lastCommitted,
```

In both the `lastDebug` assignment inside `step()` and the `debug()` fallback object, replace `mode: brain.mode, alert: brain.alert, swingT: brain.swingT,` with:

```ts
      state: brain.state, alert: brain.alert, swingT: brain.swingT,
      side: brain.side, hasToken: ringToken,
```

- [ ] **Step 9: Run the actor tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-actor.test.ts`
Expected: PASS, including the four new tests and every pre-existing one.

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL only in `src/lab/sdf-zombie/webgpu/game-main.ts` (it reads `a.brain().mode`). Task 6 fixes it.

- [ ] **Step 11: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-actor.ts src/lab/sdf-zombie/webgpu/game-actor.test.ts
git commit -m "game-actor: ring verdict and blast go through the brain

The private BLAST_HOLD_SEC timer is gone -- a blast now sets a one-shot flag
the brain turns into its stagger state, so locomotion is gated in exactly one
place. The router no longer substitutes the player for the brain's target:
the brain emits the point it wants walked to, and substituting would route an
encircling body straight into the melee it is waiting outside of.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `game-main.ts` — arbitrate, widen, and measure

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

No test file — the tests live in the pure modules this wires. Make the edits surgical and typecheck after.

- [ ] **Step 1: Add the imports**

Next to the existing `import { separate, minPairDistance, type CrowdAgent } from '../crowd';`, add:

```ts
import { arbitrate, RING_TUNING, type RingClaimant } from '../melee-ring';
```

- [ ] **Step 2: Add the engaged radius constant**

Next to the existing `const ZOMBIE_RADIUS = 0.35;`, add:

```ts
  /** Separation radius for a body in engage/attack/recover. Wider than the
   *  0.35 m walking circle because an arm reaches ~0.6 m: the melee ring's
   *  angular rule is the structural fix for arm clipping, and this catches
   *  the transient while a body is still arriving. */
  const ENGAGED_RADIUS = 0.55;
```

- [ ] **Step 3: Arbitrate before separation**

In the frame tick, inside the `if (!wanderFrozen) {` block, immediately AFTER the `for (const a of actors) a.setBrainInput(pInfo, a.room === alertRoom);` line, insert:

```ts
      // --- melee ring: who may swing this frame ---------------------------
      // Claimants are the alert bodies that are actually in the encounter; an
      // idle wanderer must not take a token it cannot use and starve a body
      // that is closing. Runs BEFORE the actors step, so a body's brain sees
      // this frame's verdict rather than last frame's.
      if (pInfo) {
        const claimants: RingClaimant[] = actors
          .filter(a => a.brain().alert && a.brain().state !== 'idle')
          .map(a => {
            const p = a.pose().pos;
            return {
              id: a.id, x: p[0], z: p[2],
              committed: a.committed(),
              incumbent: a.debug().hasToken,
            };
          });
        const verdict = arbitrate({ x: pInfo.x, z: pInfo.z }, claimants);
        for (const a of actors) {
          a.setRingInput(verdict.holders.has(a.id), verdict.drift.get(a.id) ?? 0);
        }
      } else {
        for (const a of actors) a.setRingInput(false, 0);
      }
```

- [ ] **Step 4: Widen the engaged bodies' separation radius**

Replace:

```ts
      const agents: CrowdAgent[] = actors.map(a => {
        const p = a.pose().pos;
        return { x: p[0], z: p[2], r: ZOMBIE_RADIUS, mobile: true };
      });
```

with:

```ts
      const agents: CrowdAgent[] = actors.map(a => {
        const p = a.pose().pos;
        return {
          x: p[0], z: p[2],
          r: a.engagedForCrowd() ? ENGAGED_RADIUS : ZOMBIE_RADIUS,
          mobile: true,
        };
      });
```

- [ ] **Step 5: Update the brains() seam**

Replace the `brains: () => actors.map(...)` seam with:

```ts
    /** Per-actor brain readout — the crowd/AI capture driver's oracle. */
    brains: () => actors.map(a => {
      const b = a.brain();
      const p = a.pose().pos;
      return {
        id: a.id, room: a.room, state: b.state, alert: b.alert,
        swingT: b.swingT, side: b.side, hasToken: a.debug().hasToken,
        dist: Math.hypot(p[0] - player.pos[0], p[2] - player.pos[2]),
        bearing: Math.atan2(p[0] - player.pos[0], p[2] - player.pos[2]),
      };
    }),
    /** Ring tuning, so a capture driver asserts against the real numbers
     *  rather than duplicating them. */
    ringTuning: () => ({ ...RING_TUNING }),
```

- [ ] **Step 6: Add the minHandGap seam**

Immediately after the `crowdMinDist` seam, add:

```ts
    /** Closest surface gap (m) between arm primitives belonging to DIFFERENT
     *  bodies. Negative means interpenetration — which is exactly the defect
     *  the owner photographed on 2026-09-04, so it is a number now rather
     *  than something we look at. Endpoint-to-endpoint minus the two radii:
     *  a conservative under-estimate of the true capsule gap, which is the
     *  right direction for a gate (it can cry wolf, it cannot miss a clip).
     *  O(n^2 k^2) over ten bodies — only the capture driver calls it. */
    minHandGap: () => {
      const arms = actors.map(a => {
        const posed = a.posed();
        const pts: { p: Vec3; r: number }[] = [];
        for (const prim of posed.prims) {
          if (prim.limb !== 'armL' && prim.limb !== 'armR') continue;
          pts.push({ p: prim.a, r: prim.radius }, { p: prim.b, r: prim.radius });
        }
        return pts;
      });
      let best = Infinity;
      for (let i = 0; i < arms.length; i++) {
        for (let j = i + 1; j < arms.length; j++) {
          for (const u of arms[i]!) {
            for (const v of arms[j]!) {
              const g = Math.hypot(u.p[0] - v.p[0], u.p[1] - v.p[1], u.p[2] - v.p[2])
                - u.r - v.r;
              if (g < best) best = g;
            }
          }
        }
      }
      return best;
    },
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 9: Boot the page by hand**

```bash
npx vite --port 5292 --strictPort > /tmp/blud-vite-5292.log 2>&1 &
sleep 5 && curl -sf -o /dev/null -w "%{http_code}\n" http://localhost:5292/sdf-game.html
```

Open it, walk into room 4, and check the console has no errors and `__sdfGame.brains()` returns ten rows carrying `state` and `hasToken`. Kill the server when done. (Task 7's gate automates this; do it once by hand so a wiring mistake is caught before the gate is written.)

- [ ] **Step 10: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game-main: arbitrate the melee ring, widen engaged bodies, measure arm gaps

Arbitration runs before the actors step so a brain sees this frame's verdict.
Only alert, non-idle bodies claim: a wanderer must not take a token it cannot
use and starve one that is closing. minHandGap() turns the owner's screenshot
into a number -- closest surface gap between arm prims on different bodies,
computed conservatively so it can cry wolf but cannot miss a clip.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: gate the three new claims

**Files:**
- Modify: `scripts/sdf-game-crowd-gate.mjs`

Read the whole existing script first. It already owns the CDP plumbing, the room-4 convergence, the swing-in-flight capture with its "fail if the swing already ended" guard, the separation probe, and the negative control. You are ADDING to it, not rewriting it.

**Do not exceed the task's time budget on this.** If you have finished the three checks and proven the mutation, stop — Task 8 writes the notes.

- [ ] **Step 1: Add the three checks**

Immediately before the final `console.log(`[crowd] OK ...`)` line, insert:

```js
// --- 5. THE MELEE RING. Three claims, one per line of the 2026-09-05 spec.
//     Walk back into room 4 and let the pack settle into the ring.
await evaluate(FPV);
// WAKE THE WHOLE ROOM FIRST. Only 2 of room 4's 4 bodies notice the player on
// their own (the other two are outside the facing cone when he walks in), and
// a ring check that only ever sees two claimants cannot exercise the token
// cap -- it would pass trivially. A shot bypasses the cone for every body in
// the room, which is what puts four claimants on a two-token ring.
await evaluate('__sdfGame.fire(1)');
await evaluate('__sdfGame.step(240, 1 / 60)');
const awake = (await evaluate('__sdfGame.brains()')).filter((b) => b.room === 4 && b.alert);
if (awake.length < 3) {
  fail(`only ${awake.length} room-4 bodies woke after a shot in the room; the ring ` +
       'check needs at least 3 claimants to mean anything');
}
const ring = await evaluate('__sdfGame.ringTuning()');
const ATTACK_STATES = ['engage', 'attack', 'recover'];

let worstGap = Infinity;
let maxSwinging = 0;
let worstSpread = Math.PI;
for (let i = 0; i < 30; i++) {
  await evaluate('__sdfGame.step(6, 1 / 60)');
  const bs = await evaluate('__sdfGame.brains()');
  const gap = await evaluate('__sdfGame.minHandGap()');
  if (typeof gap === 'number' && Number.isFinite(gap) && gap < worstGap) worstGap = gap;

  const swinging = bs.filter((b) => ATTACK_STATES.includes(b.state));
  if (swinging.length > maxSwinging) maxSwinging = swinging.length;

  // Every pair of token holders must clear minSlotAngle.
  const holders = bs.filter((b) => b.hasToken);
  for (let a = 0; a < holders.length; a++) {
    for (let c = a + 1; c < holders.length; c++) {
      let d = holders[a].bearing - holders[c].bearing;
      while (d <= -Math.PI) d += 2 * Math.PI;
      while (d > Math.PI) d -= 2 * Math.PI;
      if (Math.abs(d) < worstSpread) worstSpread = Math.abs(d);
    }
  }
}
await shot('melee-ring');
console.log(
  `ring: worst arm gap ${worstGap.toFixed(3)} m · most engaged at once ${maxSwinging}` +
  ` · tightest holder spread ${((worstSpread * 180) / Math.PI).toFixed(1)} deg`,
);

// 5a. THE OWNER'S DEFECT, AS A NUMBER. Arms on different bodies must not
//     interpenetrate. The measure is conservative (endpoint-to-endpoint minus
//     both radii, an under-estimate of the true capsule gap), so a pass here
//     is a real pass; a small negative could in principle be a false alarm,
//     which is why the floor is 0 and not a padded value.
if (!(worstGap > 0)) {
  fail(`arms interpenetrating: closest arm-prim gap between two bodies was ` +
       `${worstGap.toFixed(3)} m. Ring arbitration is not limiting who engages, ` +
       'or minSlotAngle is too small for the arm reach.');
}
// 5b. The token cap.
if (maxSwinging > ring.tokens) {
  fail(`${maxSwinging} bodies were in an attack state at once, cap is ${ring.tokens}`);
}
// 5c. Angular spacing between holders.
if (worstSpread < ring.minSlotAngle - 1e-3) {
  fail(`two token holders were only ${((worstSpread * 180) / Math.PI).toFixed(1)} deg apart, ` +
       `minimum is ${((ring.minSlotAngle * 180) / Math.PI).toFixed(1)} deg`);
}
console.log('ring: cap and spacing hold, no arm interpenetration');
```

- [ ] **Step 2: Run the gate**

```bash
cat > /tmp/run-crowd-gate.sh <<'SH'
#!/usr/bin/env bash
set -e
export LAB_VITE_PORT=5293 LAB_CDP_PORT=9293
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
GAME_OUT=docs/dev-notes/2026-09-05-zombie-choreography \
  node scripts/sdf-game-crowd-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
SH
chmod +x /tmp/run-crowd-gate.sh && bash /tmp/run-crowd-gate.sh
```

Expected: `[crowd] OK`, with the ring line printing a POSITIVE worst arm gap, `most engaged at once` ≤ 2, and a tightest holder spread ≥ 90°.

If the arm gap comes out negative, do not raise the floor. Either `minSlotAngle` is genuinely too small for this body's arm reach — in which case say so with the measured number, and raise `RING_TUNING.minSlotAngle` — or arbitration is not reaching the actors.

- [ ] **Step 3: Prove the ring check can fail**

Temporarily force every body to hold a token: in `game-main.ts`, change
`a.setRingInput(verdict.holders.has(a.id), ...)` to `a.setRingInput(true, ...)`.
Re-run the gate.

Expected: FAIL on 5a, 5b or 5c — record which, and the measured numbers. Restore the line (`git diff` must be empty for `game-main.ts`) and re-run; expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/sdf-game-crowd-gate.mjs
git commit -m "crowd gate: three checks for the melee ring

The owner's screenshot becomes a number: the closest arm-prim surface gap
between two bodies must stay positive. Plus the token cap and the 90-degree
holder spacing. Proven to fail with every body forced to hold a token.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: notes, status row, final verification

**Files:**
- Create: `docs/dev-notes/2026-09-05-zombie-choreography/notes.md`
- Modify: `TASKS.md`

- [ ] **Step 1: Write the notes**

Create `docs/dev-notes/2026-09-05-zombie-choreography/notes.md`:

```markdown
# Zombie combat choreography — 2026-09-05

Spec: `docs/superpowers/specs/2026-09-05-zombie-combat-choreography-design.md`
Plan: `docs/superpowers/plans/2026-09-05-zombie-combat-choreography.md`

Owner's play-test of the 2026-09-04 build: arms clip when several zombies
surround you, and the two-arm slam is "merely… okay".

## What landed

* `melee-ring.ts` — at most two bodies may swing at once, and a second token
  needs 90° of clearance from the first. Angles are the claimants' CURRENT
  bearings, not fixed slots, which would orbit the ring as the player turns.
* `brain.ts` — seven named states (idle / pursue / encircle / engage / attack /
  recover / stagger) replacing three modes and three ad-hoc overrides. The
  blast hold moved in from `game-actor.ts`, so locomotion is gated in one place.
* `attack.ts` — the alternating one-arm hook. The swinging arm cocks back and
  out, then sweeps forward AND across; the off arm counter-swings; the lunge
  dropped 0.22 → 0.14 because the rotation carries the weight now.
* `motion.ts` — the reach pivot gained a world-up rotation, because a pitch
  about the body's right axis can only raise and lower an arm. The lab's
  bit-identity pin is unchanged and still passes.

## The arm-clipping arithmetic

Separation treats a body as a 0.35 m circle, so two engaged zombies settle
0.70 m apart and separation reports itself satisfied — but an arm reaches
~0.6 m, so at 0.70 m two facing bodies have half a metre of mutual arm
overlap. The circles never touch; the arms always do.

Two holders 90° apart at the 1.0 m melee radius are **1.41 m** apart, clear of
two 0.6 m reaches with 0.2 m to spare. At 75° it would be 1.22 m — clearing by
2 cm, which is not clearing. That is why `minSlotAngle` is 90° and not smaller,
and it is the knob to move if the pack ends up feeling too spread out.

## Frames

| file | what it shows |
|------|---------------|
| `melee-ring.png` | Four bodies around the player: two engaged at spaced bearings, two holding the outer ring. |
| `fpv-swing.png` | A one-arm hook mid-strike, captured in flight. |
| `room4-topdown-before.png` / `room4-topdown-after.png` | The convergence from a raised camera. |
| `room4-converged.png`, `room4-enter.png`, `room4-melee-ring.png` | Carried over from the 2026-09-04 gate. |

## The gate

`scripts/sdf-game-crowd-gate.mjs`, now nine checks. The three new ones:

* **`minHandGap()` > 0** — closest surface gap between arm prims on different
  bodies. This is the owner's screenshot as a number.
* **Token cap** — never more than `RING_TUNING.tokens` bodies in an attack state.
* **Holder spacing** — any two token holders' bearings differ by ≥ `minSlotAngle`.

Measured on this machine:

| | worst arm gap | most engaged | tightest spread |
|---|---|---|---|
| ring wired | **<fill in>** m | **<fill in>** | **<fill in>°** |
| every body forced to hold a token | **<fill in>** m | **<fill in>** | **<fill in>°** → gate FAILS |

Fill both rows from the real runs — a gate never shown to fail is not a gate.

## Known limits, deliberate

* **Navigation is untouched.** The owner also reported getting stuck on
  furniture; that needs a nav grid over `levelColliders()` + `FURNITURE`, A*
  and path following, and is its own spec. The committed-sidestep router in
  `game-actor.ts` is exactly as it was.
* **No player damage.** Still choreography — no health, no HUD, no death.
* **Chasers stop at their room's doorway**, because `stepWander` clamps to room
  bounds. Cross-room pursuit falls out of the navigation work, not this.
* **A body does not re-aim mid-swing**: `halt` gates `stepWander`, so heading
  stops updating for the 0.7 s a swing lasts.
```

Fill in the six measured numbers from Task 7's two runs — the placeholders must not survive the commit.

- [ ] **Step 2: Update TASKS.md**

Add to the "Current focus" section of `TASKS.md`, immediately above the
`**ZOMBIE CROWD + BRAIN — LANDED (2026-09-04)` row:

```markdown
**ZOMBIE COMBAT CHOREOGRAPHY — LANDED (2026-09-05), awaiting owner look.**
The owner's play-test of the crowd/brain build: arms clip when several
surround you, and the two-arm slam is "merely… okay". `melee-ring.ts` caps the
swingers at two and requires 90° of bearing separation between them — angles
are the claimants' CURRENT bearings, NOT fixed slots, which would orbit the
ring as the player turns. The arithmetic: separation's 0.35 m circles touch at
0.70 m while an arm reaches 0.6 m, so the circles are satisfied and the arms
always overlap; two holders 90° apart at 1.0 m are 1.41 m apart, clear with
0.2 m to spare (75° gives 1.22 m, which clears by 2 cm — not clearing).
`brain.ts` is now seven named states and absorbed the blast hold that used to
be a private timer in `game-actor.ts`. `attack.ts` is an alternating one-arm
hook; `motion.ts`'s reach pivot gained a world-up sweep to carry it, with the
lab's bit-identity pin untouched. Gate: `minHandGap()` — the owner's
screenshot as a number — plus the token cap and the spacing, all proven to
fail. Notes + frames:
[docs/dev-notes/2026-09-05-zombie-choreography/](docs/dev-notes/2026-09-05-zombie-choreography/notes.md).
**Still open:** getting stuck on furniture — navigation is its own spec and is
NOT in this change.
[spec](docs/superpowers/specs/2026-09-05-zombie-combat-choreography-design.md) ·
[plan](docs/superpowers/plans/2026-09-05-zombie-combat-choreography.md)
```

- [ ] **Step 3: Final verification**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: typecheck clean, full suite green. Report the actual test count.

- [ ] **Step 4: Commit**

```bash
git add docs/dev-notes/2026-09-05-zombie-choreography TASKS.md
git commit -m "notes + TASKS row for the combat choreography work

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
