# Zombie Swing Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one flat, swimmer-looking swing with two real ones — an elbow-high hook and an overhead chop — chosen at random per swing.

**Architecture:** `attack.ts` splits the BODY's signed drive (unchanged) from the ARM's arc, which becomes a per-variant interpolation between explicit wind-up and strike angles — the thing the single signed scalar could not express. `brain.ts` picks a variant at swing start from an injected roll; `motion.ts` threads it through in two lines. The reach-pivot maths built in the predecessor is untouched.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess: true`), vitest. Test: `npx vitest run <path>`; typecheck: `npx tsc --noEmit`.

**Spec:** [docs/superpowers/specs/2026-09-05-zombie-swing-variants-design.md](../specs/2026-09-05-zombie-swing-variants-design.md)

---

## Correction to the spec, read this first

The spec says "**`motion.ts` is not touched**". That is wrong and the plan
corrects it. What is untouched is `AttackPose.reach`'s SHAPE and the reach
pivot's maths — the world-up sweep carries both variants as-is. But
`motion.ts` owns the `attackPose(...)` call and the `MotionConfig.attack`
type, so both must learn the third argument. It is a two-line change (Task 2)
and the lab bit-identity pin is unaffected.

The spec also gives `armArc` as returning `{ pitch, yaw }`. It returns
`{ pitch, yaw, active }` here: the off arm's raised guard needs a "how far
into the swing are we" scalar that does NOT dip to zero mid-strike the way
`attackDrive` does (it crosses zero between the wind-up and the strike), so
the arc emits a trapezoid envelope alongside the angles.

## House rules for every task

* `noUncheckedIndexedAccess` is ON. Write `arr[i]!` after a bounds check, and never `arr[i]! -= x`; write `arr[i] = arr[i]! - x`.
* `attack.ts` and `brain.ts` are PURE — no `three`, no DOM, no `Date.now`, no `Math.random`.
* **`motion.ts`'s bit-identity contract is not negotiable.** `cfg.attack === undefined` must take the identical code path it takes today. The 30-frame exact-pose test in `motion.test.ts` stays as written and must keep passing. Never replace a branch with an add — `x + 0` turns `-0` into `+0`.
* Commit after every task with the trailer:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File structure

| File | Status | Responsibility |
|------|--------|----------------|
| `src/lab/sdf-zombie/attack.ts` | modify | Adds `SwingVariant`, `SWING_ARCS`, `armArc`; `attackPose` takes a variant; the off arm holds a guard instead of counter-swinging. |
| `src/lab/sdf-zombie/attack.test.ts` | modify | Its tests, including the flat-arc regression guard. |
| `src/lab/sdf-zombie/motion.ts` | modify | Two lines: the config type and the `attackPose` call. |
| `src/lab/sdf-zombie/motion.test.ts` | modify | Existing attack-seam tests updated for the third argument. |
| `src/lab/sdf-zombie/brain.ts` | modify | `Brain.side` → `Brain.swing: {side, variant}`; `BrainInput.roll`. |
| `src/lab/sdf-zombie/brain.test.ts` | modify | Variant-selection tests. |
| `src/lab/sdf-zombie/webgpu/game-actor.ts` | modify | Supplies `roll` from its own RNG; reports the variant through `debug()`. |
| `src/lab/sdf-zombie/webgpu/game-actor.test.ts` | modify | Wiring test. |
| `scripts/sdf-swing-strip.mjs` | create | The side-by-side arc capture. |
| `scripts/sdf-game-crowd-gate.mjs` | modify | One assertion: both variants are observed. |
| `docs/dev-notes/2026-09-05-swing-variants/notes.md` | create | Frames + what they show. |
| `TASKS.md` | modify | The status row. |

---

### Task 1: `attack.ts` — the arm gets its own arc

**Files:**
- Modify: `src/lab/sdf-zombie/attack.ts`
- Modify: `src/lab/sdf-zombie/attack.test.ts`

Read first: the current `attackPose` in `src/lab/sdf-zombie/attack.ts`. Every arm
angle there is `attackDrive(phase) × magnitude`, and `attackDrive` runs
0 → −1 → +1 → 0. That forces pitch NEGATIVE at the wind-up and POSITIVE at the
strike — the arm must travel from behind the body to in front of it. A hook
needs the arm raised at BOTH ends, which is why this task exists.

`attackDrive` itself is unchanged and keeps driving the BODY (root lunge,
wind-back, chest lean, head carry, shoulder twist). Do not touch it.

- [ ] **Step 1: Write the failing test**

Replace the whole `describe('attackPose', ...)` block in
`src/lab/sdf-zombie/attack.test.ts` with the following, and keep the existing
`describe('attackDrive', ...)` block exactly as it is. Update the import line to:

```ts
import {
  ATTACK_TUNING, SWING_ARCS, armArc, attackDrive, attackPose,
  type SwingVariant,
} from './attack';
```

```ts
const VARIANTS: SwingVariant[] = ['hook', 'overhead'];
const STRIKE = (ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2;
const WINDUP = ATTACK_TUNING.windupEnd;

describe('armArc', () => {
  it('is exactly zero at phase 0 and phase 1, both variants', () => {
    for (const v of VARIANTS) {
      expect(armArc(0, v)).toEqual({ pitch: 0, yaw: 0, active: 0 });
      expect(armArc(1, v)).toEqual({ pitch: 0, yaw: 0, active: 0 });
    }
  });

  it('reaches the variant angles at the wind-up and strike peaks', () => {
    for (const v of VARIANTS) {
      const a = SWING_ARCS[v];
      expect(armArc(WINDUP, v).pitch).toBeCloseTo(a.windupPitch, 6);
      expect(armArc(WINDUP, v).yaw).toBeCloseTo(a.windupYaw, 6);
      expect(armArc(STRIKE, v).pitch).toBeCloseTo(a.strikePitch, 6);
      expect(armArc(STRIKE, v).yaw).toBeCloseTo(a.strikeYaw, 6);
    }
  });

  it('THE SWIMMER GUARD: the hook climbs, it does not sweep flat', () => {
    // The shipped swing had pitch FALL from 0.85 to 0.55 while yaw swept 1.15
    // across — an almost horizontal arc, which the owner read as a swimmer's
    // stroke (2026-09-05). A hook's pitch travel must be a real fraction of
    // its yaw travel, and it must travel UPWARD into the strike.
    const a = SWING_ARCS.hook;
    const pitchTravel = Math.abs(a.strikePitch - a.windupPitch);
    const yawTravel = Math.abs(a.strikeYaw - a.windupYaw);
    expect(pitchTravel).toBeGreaterThan(yawTravel * ATTACK_TUNING.flatArcRatio);
    expect(a.strikePitch).toBeGreaterThan(a.windupPitch);   // climbing, not falling
    expect(a.windupPitch).toBeGreaterThan(0);               // elbow up at BOTH ends
    expect(a.strikePitch).toBeGreaterThan(0);
  });

  it('the overhead is a chop: big vertical traverse, almost no yaw', () => {
    const a = SWING_ARCS.overhead;
    expect(Math.abs(a.strikePitch - a.windupPitch)).toBeGreaterThan(2);
    expect(a.strikePitch).toBeLessThan(0);        // driven down past the body
    for (let p = 0; p <= 1; p += 0.01) {
      expect(Math.abs(armArc(p, 'overhead').yaw)).toBeLessThan(0.25);
    }
  });

  it('active is a trapezoid: 0 at rest, 1 across the swing core', () => {
    for (const v of VARIANTS) {
      expect(armArc(0, v).active).toBe(0);
      expect(armArc(WINDUP, v).active).toBeCloseTo(1, 6);
      expect(armArc(STRIKE, v).active).toBeCloseTo(1, 6);
      expect(armArc(1, v).active).toBe(0);
      // It must NOT dip mid-strike the way attackDrive crosses zero.
      const mid = (ATTACK_TUNING.windupEnd + ATTACK_TUNING.strikeEnd) / 2;
      expect(armArc(mid, v).active).toBeCloseTo(1, 6);
    }
  });

  it('is finite across a swept phase, including out of range', () => {
    for (const v of VARIANTS) {
      for (let p = -0.5; p <= 1.5; p += 0.01) {
        const a = armArc(p, v);
        expect(Number.isFinite(a.pitch) && Number.isFinite(a.yaw)
          && Number.isFinite(a.active)).toBe(true);
      }
    }
  });
});

describe('attackPose', () => {
  it('is exactly zero at phase 0 and phase 1, every side and variant', () => {
    for (const v of VARIANTS) {
      for (const side of ['L', 'R'] as const) {
        for (const p of [0, 1]) {
          const pose = attackPose(p, side, v);
          expect(pose.rootOffset).toEqual([0, 0, 0]);
          expect(pose.reach).toEqual({ pitchL: 0, pitchR: 0, yawL: 0, yawR: 0 });
          for (const o of Object.values(pose.offsets)) expect(o).toEqual([0, 0, 0]);
        }
      }
    }
  });

  it('swings the named arm, not the other one', () => {
    for (const v of VARIANTS) {
      const r = attackPose(STRIKE, 'R', v).reach;
      expect(Math.abs(r.pitchR)).toBeGreaterThan(Math.abs(r.pitchL));
      const l = attackPose(STRIKE, 'L', v).reach;
      expect(Math.abs(l.pitchL)).toBeGreaterThan(Math.abs(l.pitchR));
    }
  });

  it('L and R mirror in yaw', () => {
    for (const v of VARIANTS) {
      const r = attackPose(STRIKE, 'R', v);
      const l = attackPose(STRIKE, 'L', v);
      expect(l.reach.yawL).toBeCloseTo(-r.reach.yawR, 9);
      expect(l.reach.pitchL).toBeCloseTo(r.reach.pitchR, 9);
    }
  });

  it('the off arm holds a guard, it does NOT counter-swing', () => {
    // Two arms moving in opposition through a near-horizontal plane IS the
    // swimming motion. The off arm's pitch is a raised guard (positive,
    // constant through the swing core), not the swinging arm's negated.
    const p = attackPose(STRIKE, 'R', 'hook');
    expect(p.reach.pitchL).toBeCloseTo(ATTACK_TUNING.offGuardPitch, 6);
    expect(p.reach.pitchL).toBeGreaterThan(0);
    // And its yaw share is small.
    expect(Math.abs(p.reach.yawL)).toBeLessThan(Math.abs(p.reach.yawR) * 0.2);
  });

  it('the off arm never out-swings the swinging arm, at any phase', () => {
    for (const v of VARIANTS) {
      for (let p = 0; p <= 1; p += 0.01) {
        const a = attackPose(p, 'R', v).reach;
        expect(Math.abs(a.yawL)).toBeLessThanOrEqual(Math.abs(a.yawR) + 1e-9);
      }
    }
  });

  it('still drives the body off attackDrive — the weight shift is unchanged', () => {
    const peak = attackPose(STRIKE, 'R', 'hook');
    expect(peak.rootOffset[2]).toBeCloseTo(ATTACK_TUNING.lunge, 6);
    expect(attackPose(WINDUP, 'R', 'hook').rootOffset[2])
      .toBeCloseTo(-ATTACK_TUNING.windback, 6);
    // The body drive is variant-independent: only the ARM differs.
    expect(attackPose(STRIKE, 'R', 'overhead').rootOffset)
      .toEqual(peak.rootOffset);
  });

  it('is finite across a full sweep, every side and variant', () => {
    for (const v of VARIANTS) {
      for (const side of ['L', 'R'] as const) {
        for (let p = -0.5; p <= 1.5; p += 0.01) {
          const pose = attackPose(p, side, v);
          for (const o of [pose.rootOffset, ...Object.values(pose.offsets)]) {
            expect(o!.every(Number.isFinite)).toBe(true);
          }
          for (const a of Object.values(pose.reach)) {
            expect(Number.isFinite(a)).toBe(true);
          }
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/attack.test.ts`
Expected: FAIL — `armArc` and `SWING_ARCS` are not exported.

- [ ] **Step 3: Add the variant table and the new tuning**

In `src/lab/sdf-zombie/attack.ts`, ADD after the `ATTACK_TUNING` object:

```ts
export type SwingVariant = 'hook' | 'overhead';

/** Per-variant arm angles (rad). Pitch keeps the reach convention (positive =
 *  forward/raised); yaw is written for the RIGHT arm, where positive is cocked
 *  OUT away from the body's centre line and negative is swept ACROSS it — the
 *  left arm negates it, which is what makes the two sides exact mirrors.
 *
 *  THE HOOK'S PITCH IS POSITIVE AT BOTH ENDS AND RISES INTO THE STRIKE. That
 *  is the whole fix: the shipped swing fell from 0.85 to 0.55 while yaw swept
 *  1.15, an almost horizontal arc the owner read as a swimmer's stroke. A
 *  single signed drive scalar could not express "raised at both ends", which
 *  is why armArc exists.
 *
 *  THE OVERHEAD IS ALMOST PURE PITCH: 2.1 rad of vertical traverse, through
 *  zero and out the other side, with yaw near zero. That is a chop. */
export const SWING_ARCS: Record<SwingVariant, {
  windupPitch: number;
  strikePitch: number;
  windupYaw: number;
  strikeYaw: number;
}> = {
  hook: { windupPitch: 0.35, strikePitch: 0.95, windupYaw: 0.85, strikeYaw: -0.90 },
  overhead: { windupPitch: 1.35, strikePitch: -0.75, windupYaw: 0.15, strikeYaw: -0.10 },
};
```

In `ATTACK_TUNING`, REPLACE the `offArmShare` member and the four now-unused
angle members (`pitchWindup`, `pitchStrike`, `yawWindup`, `yawStrike` — the
per-variant table above supersedes them) with:

```ts
  /** The off arm's share of the swinging arm's YAW, opposite in sign. Dropped
   *  from 0.28: two arms moving in opposition through a near-horizontal plane
   *  IS the swimming motion the owner flagged. */
  offArmShare: 0.12,
  /** The off arm's raised guard (rad) — a constant positive pitch scaled by
   *  the swing's envelope, rather than the swinging arm's pitch negated. */
  offGuardPitch: 0.30,
  /** Regression guard for the flat arc: a swing's pitch travel must exceed
   *  this fraction of its yaw travel. Pinned by a test, not read at runtime —
   *  it lives here so the number and the reason sit together. */
  flatArcRatio: 0.6,
```

- [ ] **Step 4: Add armArc**

Add after `attackDrive`:

```ts
/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The swinging arm's angles at `phase`, plus a trapezoid envelope.
 *
 * Unlike `attackDrive` this does NOT multiply one magnitude by a signed
 * scalar. It interpolates between the variant's explicit rest, wind-up and
 * strike angles, which is the whole point: an angle can be positive at BOTH
 * ends, so a hook keeps its elbow up instead of swinging from behind the body
 * to in front of it.
 *
 * `active` is a separate trapezoid (0 at rest, 1 across the wind-up peak
 * through the end of the contact hold, 0 again by the end of recovery). The
 * off arm's guard needs it because `attackDrive` CROSSES ZERO between the
 * wind-up and the strike — a guard scaled by |drive| would drop the arm at
 * exactly the moment the swing is fastest.
 *
 * Phases outside [0, 1] return the rest pose, never an extrapolated one.
 */
export function armArc(
  phase: number, variant: SwingVariant, tuning: AttackTuning = ATTACK_TUNING,
): { pitch: number; yaw: number; active: number } {
  const T = tuning;
  const a = SWING_ARCS[variant];
  if (!(phase > 0) || phase >= 1) return { pitch: 0, yaw: 0, active: 0 };
  if (phase < T.windupEnd) {
    const t = smooth(phase / T.windupEnd);
    return { pitch: lerp(0, a.windupPitch, t), yaw: lerp(0, a.windupYaw, t), active: t };
  }
  if (phase < T.strikeEnd) {
    const t = smooth((phase - T.windupEnd) / (T.strikeEnd - T.windupEnd));
    return {
      pitch: lerp(a.windupPitch, a.strikePitch, t),
      yaw: lerp(a.windupYaw, a.strikeYaw, t),
      active: 1,
    };
  }
  if (phase < T.holdEnd) {
    return { pitch: a.strikePitch, yaw: a.strikeYaw, active: 1 };
  }
  const t = smooth((phase - T.holdEnd) / (1 - T.holdEnd));
  return {
    pitch: lerp(a.strikePitch, 0, t),
    yaw: lerp(a.strikeYaw, 0, t),
    active: 1 - t,
  };
}
```

- [ ] **Step 5: Rewrite attackPose's arm half**

Replace the whole `attackPose` function with:

```ts
/**
 * The swing pose at `phase`, thrown by `side`'s arm as `variant`.
 *
 * The BODY (root lunge, wind-back, chest lean, head carry, shoulder twist)
 * still rides `attackDrive`'s signed scalar — the back-then-forward weight
 * shift is right for both variants and is deliberately variant-independent.
 * The ARM rides `armArc`, which is what makes a hook a hook.
 *
 * Sign convention: body-local +x is the body's right, and a positive rotation
 * about world up carries the arm toward +x. SWING_ARCS is written for the
 * right arm; `sgn` negates it for the left, so the two sides are exact
 * mirrors by construction rather than by two hand-written branches.
 */
export function attackPose(
  phase: number,
  side: 'L' | 'R',
  variant: SwingVariant,
  tuning: AttackTuning = ATTACK_TUNING,
): AttackPose {
  const T = tuning;
  const d = attackDrive(phase, T);
  const arc = armArc(phase, variant, T);
  if (d === 0 && arc.active === 0) {
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

  const pitchSwing = arc.pitch;
  const yawSwing = sgn * arc.yaw;
  // The off arm HOLDS A GUARD. It does not mirror the swinging arm negated:
  // two arms in opposition through a near-horizontal plane is a front crawl.
  const pitchOff = arc.active * T.offGuardPitch;
  const yawOff = -yawSwing * T.offArmShare;

  const rootZ = fwd ? d * T.lunge : d * T.windback;
  const chestZ = fwd ? d * T.chestDrive : d * T.chestRear;
  const headZ = chestZ * T.headShare;
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

Replace the header paragraph beginning `// FOUR BEATS ON ONE SCALAR, ONE ARM AT A TIME.` with:

```ts
// TWO SWINGS: an elbow-high HOOK and an OVERHEAD chop, one arm at a time.
//
// THE BODY AND THE ARM ARE DRIVEN SEPARATELY, and that split is the point.
// The body still rides `attackDrive`'s signed scalar (0 -> -1 wind-up -> +1
// strike -> 0): its back-then-forward weight shift is right for both variants.
// But every ARM angle used to be `drive x magnitude` too, which FORCES pitch
// negative at the wind-up and positive at the strike -- the arm must travel
// from behind the body to in front of it. A hook needs the arm raised at BOTH
// ends. It cannot be expressed that way, which is why `armArc` interpolates
// between explicit per-variant angles instead (SWING_ARCS).
//
// That single-scalar constraint, plus yaw dominating pitch and an off arm
// counter-swinging in opposition, is what the owner saw: "the current
// animation resembles a swimmer's motion tbh" (2026-09-05). The off arm now
// holds a raised guard rather than mirroring the swing negated.
//
// The caller alternates `side` between swings and rolls `variant` per swing,
// so a stalled pack shows four silhouettes instead of one metronome.
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/attack.test.ts`
Expected: PASS, 19 tests (5 `attackDrive` + 6 `armArc` + 8 `attackPose`).

- [ ] **Step 8: Typecheck — expect a downstream failure**

Run: `npx tsc --noEmit`
Expected: FAIL in `src/lab/sdf-zombie/motion.ts` — `attackPose` now needs three
arguments. **That is correct here**; Task 2 fixes it. Do not patch `motion.ts`
in this task.

- [ ] **Step 9: Commit**

```bash
git add src/lab/sdf-zombie/attack.ts src/lab/sdf-zombie/attack.test.ts
git commit -m "attack: the arm gets its own arc, and a second swing

Every arm angle was a signed drive scalar times a magnitude, which forces
pitch negative at the wind-up and positive at the strike -- the arm must
travel from behind the body to in front of it. A hook needs it raised at both
ends, so armArc interpolates between explicit per-variant angles instead. The
body keeps the signed drive; its weight shift was never the problem.

hook: pitch 0.35 -> 0.95 (climbing, elbow high), yaw +0.85 -> -0.90.
overhead: pitch 1.35 -> -0.75 through 2.1 rad, yaw near zero -- a chop.
The off arm holds a raised guard instead of counter-swinging: two arms in
opposition through a near-horizontal plane is a front crawl.

The flat-arc regression guard is a test, not a comment: the shipped swing
fails it.

motion.ts does not compile against this yet -- the next commit threads the
variant through.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `motion.ts` — thread the variant through

**Files:**
- Modify: `src/lab/sdf-zombie/motion.ts`
- Modify: `src/lab/sdf-zombie/motion.test.ts`

Two lines of source. **Read the house rule about bit-identity before you
start** — the reach pivot's maths and the `undefined` branch are untouched, and
the 30-frame exact-pose pin must keep passing.

- [ ] **Step 1: Update the config type**

In `src/lab/sdf-zombie/motion.ts`, replace the `attack?: { phase: number; side: 'L' | 'R' };`
member of `MotionConfig` with:

```ts
  attack?: { phase: number; side: 'L' | 'R'; variant: SwingVariant };
```

and add `SwingVariant` to the existing import from `./attack`:

```ts
import { attackPose, type AttackPose, type SwingVariant } from './attack';
```

- [ ] **Step 2: Pass the variant to attackPose**

Replace:

```ts
      ? attackPose(cfg.attack.phase, cfg.attack.side)
```

with:

```ts
      ? attackPose(cfg.attack.phase, cfg.attack.side, cfg.attack.variant)
```

- [ ] **Step 3: Update the attack-seam tests**

In `src/lab/sdf-zombie/motion.test.ts`, every `attack: { phase: X, side: 'Y' }`
literal in the `describe('stepMotion — the attack seam', ...)` block needs
`variant: 'hook'` added. Add `variant: 'hook'` to each, and add
`attackPose(STRIKE, 'R', 'hook')` where the file calls `attackPose(STRIKE, 'R')`.

Then add this test to the same block — it pins that the variant actually
reaches the pose through the config, which a type change alone would not prove:

```ts
  it('the two variants produce different poses through the same seam', () => {
    const hook = poses(
      { enabled: true, wander: false, attack: { phase: STRIKE, side: 'R', variant: 'hook' } }, 1,
    );
    const over = poses(
      { enabled: true, wander: false, attack: { phase: STRIKE, side: 'R', variant: 'overhead' } }, 1,
    );
    expect(over).not.toEqual(hook);
  });

  it('the overhead lifts the hand higher than the hook does', () => {
    const body = buildBody(makeZombie());
    const bound = bindRig(body);
    const joints = makeMotionJoints(body, bound.rig.restPose)!;
    const i = joints.index.handR;
    const yAt = (variant: 'hook' | 'overhead', phase: number) => poses(
      { enabled: true, wander: false, attack: { phase, side: 'R', variant } }, 1,
    )[0]![i]![1];
    // At the wind-up peak the overhead's arm is up past the head (pitch 1.35)
    // while the hook is only cocked (0.35).
    expect(yAt('overhead', ATTACK_TUNING.windupEnd))
      .toBeGreaterThan(yAt('hook', ATTACK_TUNING.windupEnd));
  });
```

- [ ] **Step 4: Run the motion suite**

Run: `npx vitest run src/lab/sdf-zombie/motion.test.ts`
Expected: PASS, including the bit-identity pin and the two new tests.

- [ ] **Step 5: Typecheck — expect a downstream failure**

Run: `npx tsc --noEmit`
Expected: FAIL only in `src/lab/sdf-zombie/brain.ts` / `webgpu/game-actor.ts`
(they build `attack: { phase, side }` without a variant). Task 3 fixes it.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/motion.ts src/lab/sdf-zombie/motion.test.ts
git commit -m "motion: thread the swing variant through the attack seam

Two lines. AttackPose's shape and the reach pivot's world-up sweep are
untouched, so the lab bit-identity pin is unaffected and still passes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `brain.ts` + `game-actor.ts` — roll a variant per swing

**Files:**
- Modify: `src/lab/sdf-zombie/brain.ts`
- Modify: `src/lab/sdf-zombie/brain.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.test.ts`

`brain.ts` stays RNG-free: the actor supplies a `roll`, which the brain consumes
only on the frame a swing begins.

- [ ] **Step 1: Write the failing brain test**

In `src/lab/sdf-zombie/brain.test.ts`, add `roll: 0` to the object returned by
the `input()` helper, and append this block to the end of the file:

```ts
describe('stepBrain — swing variants', () => {
  const close = {
    player: { x: 0, z: BRAIN_TUNING.meleeRadius - 0.05, room: 3 },
    hasToken: true,
  };
  /** Alert, in the player's room. */
  const seed = () => stepBrain(makeBrain(), input()).brain;

  it('picks the hook on a low roll and the overhead on a high one', () => {
    expect(stepBrain(seed(), input({ ...close, roll: 0.1 })).attack!.variant).toBe('hook');
    expect(stepBrain(seed(), input({ ...close, roll: 0.9 })).attack!.variant).toBe('overhead');
  });

  it('holds the variant for the whole swing even as the roll changes', () => {
    let out = stepBrain(seed(), input({ ...close, roll: 0.1 }));
    expect(out.attack!.variant).toBe('hook');
    let b = out.brain;
    for (let i = 0; i < 10; i++) {
      // A fresh roll every frame — the swing must ignore it.
      out = stepBrain(b, input({ ...close, roll: 0.99 }));
      b = out.brain;
      if (out.attack) expect(out.attack.variant).toBe('hook');
    }
  });

  it('rolls again on the NEXT swing', () => {
    const DT = 1 / 60;
    let out = stepBrain(seed(), input({ ...close, roll: 0.1 }));
    let b = out.brain;
    // Run the swing out and through the cooldown, feeding a high roll.
    const frames = Math.ceil((BRAIN_TUNING.swingSec + BRAIN_TUNING.cooldownSec) / DT) + 4;
    let sawOverhead = false;
    for (let i = 0; i < frames; i++) {
      out = stepBrain(b, input({ ...close, roll: 0.9 }));
      b = out.brain;
      if (out.attack && out.attack.variant === 'overhead') sawOverhead = true;
    }
    expect(sawOverhead).toBe(true);
  });

  it('still alternates the arm underneath the variant', () => {
    const DT = 1 / 60;
    let out = stepBrain(seed(), input({ ...close, roll: 0.1 }));
    const first = out.attack!.side;
    let b = out.brain;
    const frames = Math.ceil(BRAIN_TUNING.swingSec / DT) + 2;
    for (let i = 0; i < frames; i++) { out = stepBrain(b, input(close)); b = out.brain; }
    expect(b.swing.side).not.toBe(first);
  });
});
```

Also update every existing assertion in that file that reads `brain.side` or
`attack.side` to read `brain.swing.side` / `attack.side` respectively — the
`Brain.side` field is being replaced by `Brain.swing`. There are two:
`expect(b.side).not.toBe(firstSide)` becomes `expect(b.swing.side).not.toBe(firstSide)`,
and `expect(out.attack).toEqual({ phase: 0, side: out.brain.side })` becomes
`expect(out.attack).toEqual({ phase: 0, side: out.brain.swing.side, variant: out.attack!.variant })`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/brain.test.ts`
Expected: FAIL — `roll` is not a known property of `BrainInput`.

- [ ] **Step 3: Change the brain's state and input**

In `src/lab/sdf-zombie/brain.ts`:

Import the variant type:

```ts
import type { SwingVariant } from './attack';
```

In `interface Brain`, replace the `side` member with:

```ts
  /** The swing the NEXT attack throws. The arm alternates every swing so a
   *  stalled pack does not metronome; the variant is rolled at swing start. */
  swing: { side: 'L' | 'R'; variant: SwingVariant };
```

In `interface BrainInput`, add:

```ts
  /** A fresh 0..1 value each frame from the actor's own RNG. Consumed ONLY on
   *  the frame a swing starts, to roll its variant. It lives in the input
   *  rather than as an injected generator so this module stays a pure
   *  function of its arguments — the same reason wander.ts takes an Rng. */
  roll: number;
```

In `interface BrainOutput`, replace the `attack` member with:

```ts
  /** The swing to compose, or null. */
  attack: { phase: number; side: 'L' | 'R'; variant: SwingVariant } | null;
```

In `makeBrain`, replace `side: 'R',` with `swing: { side: 'R', variant: 'hook' },`.

- [ ] **Step 4: Use it in stepBrain**

In `stepBrain`, replace the destructuring line:

```ts
  let { state, alert, lostFor, swingT, cooldown, holdSecs, side } = brain;
```

with:

```ts
  let { state, alert, lostFor, swingT, cooldown, holdSecs, swing } = brain;
```

Then replace EVERY `side` in the returned `brain:` object literals with `swing`
(there are ten of them — `{ state: 'idle', alert, lostFor, swingT: 0, cooldown, holdSecs, side }`
becomes `{ state: 'idle', alert, lostFor, swingT: 0, cooldown, holdSecs, swing }`,
and so on for each).

Replace the in-flight swing's return:

```ts
        attack: { phase: swingT, side },
```

with:

```ts
        attack: { phase: swingT, side: swing.side, variant: swing.variant },
```

Replace the arm alternation:

```ts
    side = side === 'R' ? 'L' : 'R';           // alternate
```

with:

```ts
    // Alternate the arm for the next swing; its variant is rolled when that
    // swing actually starts, not here.
    swing = { side: swing.side === 'R' ? 'L' : 'R', variant: swing.variant };
```

Replace the swing-start return:

```ts
  if (dist <= tuning.meleeRadius && cooldown <= 0) {
    return {
      brain: { state: 'attack', alert, lostFor, swingT: 0, cooldown, holdSecs, swing },
      target: playerPoint, halt: true,
      attack: { phase: 0, side },
      engaged: true, committed: true,
    };
  }
```

with:

```ts
  if (dist <= tuning.meleeRadius && cooldown <= 0) {
    // Roll the variant HERE, at the one frame the swing begins, and store it
    // so the rest of the swing reads a fixed value — the caller's roll keeps
    // changing every frame and must not re-decide mid-swing.
    const started = {
      side: swing.side,
      variant: (input.roll < 0.5 ? 'hook' : 'overhead') as SwingVariant,
    };
    return {
      brain: { state: 'attack', alert, lostFor, swingT: 0, cooldown, holdSecs, swing: started },
      target: playerPoint, halt: true,
      attack: { phase: 0, side: started.side, variant: started.variant },
      engaged: true, committed: true,
    };
  }
```

- [ ] **Step 5: Run the brain tests**

Run: `npx vitest run src/lab/sdf-zombie/brain.test.ts`
Expected: PASS, 26 tests.

- [ ] **Step 6: Write the failing actor test**

In `src/lab/sdf-zombie/webgpu/game-actor.test.ts`, append to the
`describe('createZombieActor — the ring wiring', ...)` block:

```ts
  it('reports the swing variant through debug()', () => {
    const a = makeTestActor({ start: [0, 0, 0], room: 3 });
    for (let i = 0; i < 8; i++) {
      a.setBrainInput({ x: 0, z: 0.6, room: 3 }, true);
      a.setRingInput(true, 0);
      a.step(1 / 60);
    }
    expect(a.debug().state).toBe('attack');
    expect(['hook', 'overhead']).toContain(a.debug().variant);
  });

  it('two actors with different seeds do not throw the same swing forever', () => {
    const variants = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const a = makeTestActor({ start: [0, 0, 0], room: 3, seed });
      for (let i = 0; i < 400; i++) {
        a.setBrainInput({ x: 0, z: 0.6, room: 3 }, true);
        a.setRingInput(true, 0);
        a.step(1 / 60);
        if (a.debug().state === 'attack') variants.add(a.debug().variant);
      }
    }
    // Over eight bodies and several swings each, BOTH must appear. A variant
    // that never fires is a selection bug every unit test above would pass.
    expect([...variants].sort()).toEqual(['hook', 'overhead']);
  });
```

- [ ] **Step 7: Wire the roll in the actor**

In `src/lab/sdf-zombie/webgpu/game-actor.ts`, next to the existing
`const rng: Rng = makeRng(opts.seed);`, add:

```ts
  /** A SECOND, independent RNG for swing-variant rolls. It must not share the
   *  wander/motion generator: drawing an extra value per frame from that one
   *  would shift every subsequent wander decision and change trajectories
   *  that existing tests and captures pin. */
  const swingRng: Rng = makeRng((opts.seed ^ 0x5eed5eed) >>> 0);
```

In the `stepBrain` call inside `step()`, add to the input object:

```ts
        roll: swingRng(),
```

In the `debug()` return type on `interface ZombieActor`, replace
`side: 'L' | 'R';` with:

```ts
    side: 'L' | 'R';
    variant: string;
```

and in both the `lastDebug` assignment and the `debug()` fallback object,
replace `side: brain.side,` with:

```ts
      side: brain.swing.side, variant: brain.swing.variant,
```

- [ ] **Step 8: Run the actor tests and typecheck**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-actor.test.ts`
Expected: PASS, 26 tests.

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 9: Fix game-main's brains() seam**

`Brain.side` no longer exists, and `game-main.ts:2984` reads it. In the
`brains()` seam, replace:

```ts
        swingT: b.swingT, side: b.side, hasToken: a.debug().hasToken,
```

with:

```ts
        swingT: b.swingT, side: b.swing.side, variant: b.swing.variant,
        hasToken: a.debug().hasToken,
```

(The `variant` field is what Task 4's gate assertion reads.)

- [ ] **Step 10: Run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck clean, suite green, no regressions.

- [ ] **Step 11: Commit**

```bash
git add src/lab/sdf-zombie/brain.ts src/lab/sdf-zombie/brain.test.ts \
  src/lab/sdf-zombie/webgpu/game-actor.ts src/lab/sdf-zombie/webgpu/game-actor.test.ts \
  src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "brain: roll a swing variant at swing start

Brain.side becomes Brain.swing {side, variant}. The variant is rolled on the
one frame a swing begins and held for its duration -- the roll keeps changing
every frame and must not re-decide mid-swing. brain.ts stays RNG-free: the
actor supplies the roll from a SECOND generator, because drawing from the
wander/motion one would shift every subsequent wander decision and move
trajectories that existing tests and captures pin.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: see the two arcs

**Files:**
- Create: `scripts/sdf-swing-strip.mjs`
- Modify: `scripts/sdf-game-crowd-gate.mjs`
- Create: `docs/dev-notes/2026-09-05-swing-variants/notes.md`
- Modify: `TASKS.md`

The numbers in Task 1 were reasoned about, not observed. This task makes them
look at.

- [ ] **Step 1: Write the strip capture**

Create `scripts/sdf-swing-strip.mjs`. Copy the CDP plumbing verbatim from
`scripts/sdf-game-crowd-gate.mjs` lines 15-101 (the tab open, `send`,
`evaluate`, `withTimeout`, `shot`, `Page.enable`/`Runtime.enable`, the device
metrics override, the navigate, and the `__sdfGame` boot poll) — that file owns
this plumbing and it must not fork. Set `OUT` to
`docs/dev-notes/2026-09-05-swing-variants`. Then append:

```js
// Ten frames: each variant at five phases, from ONE fixed camera placed at
// the swinging body, so the two arcs can be compared directly by eye.
await evaluate('typeof __sdfGame.woundPanel === "function" ? (__sdfGame.woundPanel(false), 1) : 0');
await evaluate('typeof __sdfGame.gooPanel === "function" ? (__sdfGame.gooPanel(false), 1) : 0');
await evaluate('__sdfGame.setLoopRunning(false)');

// Walk into room 4 and wake the room, so a body comes to melee range.
await evaluate('__sdfGame.setPose(-4.8, 2.0, 0, 0, 0)');
await evaluate('__sdfGame.fire(1)');

// Find a body that reaches melee, and park the camera 1.6 m from it looking
// at it. Everything below is captured from that ONE pose, so the only thing
// changing between frames is the swing.
let subject = null;
for (let i = 0; i < 60 && !subject; i++) {
  await evaluate('__sdfGame.step(10, 1 / 60)');
  const bs = await evaluate('__sdfGame.brains()');
  subject = bs.find((b) => b.state === 'attack' || b.state === 'recover') ?? null;
}
if (!subject) fail('no body reached melee range — nothing to photograph');
const zs = await evaluate('__sdfGame.zombies()');
const me = zs.find((z) => z.id === subject.id);
if (!me) fail(`zombie ${subject.id} vanished between reads`);
const cx = me.pos[0] - 1.6;
const cz = me.pos[2] - 1.6;
const yaw = Math.atan2(me.pos[0] - cx, -(me.pos[2] - cz));
const CAM = `__sdfGame.setPose(${cx}, ${cz}, ${yaw}, -0.10, 0)`;
await evaluate(CAM);

// The phases, named for the beat each one sits on.
const TUNING = await evaluate('__sdfGame.attackTuning()');
const PHASES = [
  ['rest', 0.02],
  ['windup', TUNING.windupEnd],
  ['midstrike', (TUNING.windupEnd + TUNING.strikeEnd) / 2],
  ['contact', (TUNING.strikeEnd + TUNING.holdEnd) / 2],
  ['recovery', (TUNING.holdEnd + 1) / 2],
];

for (const variant of ['hook', 'overhead']) {
  for (const [name, phase] of PHASES) {
    await evaluate(`__sdfGame.poseSwing(${subject.id}, ${phase}, 'R', '${variant}')`);
    await evaluate(CAM);
    await evaluate('__sdfGame.step(1, 1 / 60)');
    await shot(`${variant}-${name}`);
  }
}
await evaluate('__sdfGame.setLoopRunning(true)');
console.log(`[swing-strip] OK — ${shotCount} frames in ${OUT}`);
process.exit(0);
```

- [ ] **Step 2: Add the two seams the strip needs**

In `src/lab/sdf-zombie/webgpu/game-main.ts`, add to the `__sdfGame` object
literal:

```ts
    /** attack.ts's beat boundaries, so a capture driver derives its phases
     *  from the real numbers instead of duplicating them. */
    attackTuning: () => ({ ...ATTACK_TUNING }),
    /** CAPTURE SEAM: force one actor into a specific swing pose and step it,
     *  so a strip can photograph the same body at chosen phases. Not a
     *  simulation input — it drives the actor's motion config directly for
     *  one frame and the brain overwrites it on the next step. */
    poseSwing: (id: number, phase: number, side: 'L' | 'R', variant: string) => {
      actors.find(a => a.id === id)?.forceSwing(phase, side, variant as SwingVariant);
    },
```

and add the import:

```ts
import { ATTACK_TUNING, type SwingVariant } from '../attack';
```

In `src/lab/sdf-zombie/webgpu/game-actor.ts`, add to `interface ZombieActor`:

```ts
  /** CAPTURE SEAM: pin the next step()'s swing pose. Overwritten by the brain
   *  on the following step; null clears it. Never used by the game itself. */
  forceSwing(phase: number, side: 'L' | 'R', variant: SwingVariant): void;
```

Add the state next to the other brain state:

```ts
  let forcedSwing: { phase: number; side: 'L' | 'R'; variant: SwingVariant } | null = null;
```

In the `stepMotion` config argument, replace the attack spread with:

```ts
          ...(forcedSwing !== null
            ? { attack: forcedSwing }
            : think.attack !== null ? { attack: think.attack } : {}),
```

and add to the returned object:

```ts
    forceSwing: (phase: number, side: 'L' | 'R', variant: SwingVariant) => {
      forcedSwing = { phase, side, variant };
    },
```

Import the type in `game-actor.ts`:

```ts
import type { SwingVariant } from '../attack';
```

- [ ] **Step 3: Run the strip**

```bash
cat > /tmp/run-swing-strip.sh <<'SH'
#!/usr/bin/env bash
set -e
export LAB_VITE_PORT=5297 LAB_CDP_PORT=9297
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-swing-strip.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
SH
chmod +x /tmp/run-swing-strip.sh && bash /tmp/run-swing-strip.sh
```

Expected: `[swing-strip] OK — 10 frames`, and ten PNGs in
`docs/dev-notes/2026-09-05-swing-variants/`.

**Then LOOK at them.** Read `hook-windup.png`, `hook-contact.png`,
`overhead-windup.png` and `overhead-contact.png` and say in your report what
you actually see. The hook's arm should be raised and cocked out at the
wind-up and high and across at contact; the overhead's should be up past the
head at the wind-up and driven down at contact. If either does not read that
way, say so plainly with the frame name — the angle table is tuning, and
reporting that it looks wrong is more useful than reporting that the gate
passed.

- [ ] **Step 4: Add the gate assertion**

In `scripts/sdf-game-crowd-gate.mjs`, inside the melee-ring sampling loop
(the `for (let i = 0; i < 60; i++)` block), add after the `everAttacked` line:

```js
  for (const b of bs) if (b.state === 'attack') seenVariants.add(b.variant);
```

Declare it next to `everAttacked`:

```js
const seenVariants = new Set();
```

And after the `everAttacked` guard, add:

```js
// BOTH VARIANTS MUST FIRE. A variant that never appears is a selection bug
// that every unit test passes: the roll is consumed at swing start, so a
// broken threshold or a stuck stored value shows up only over many swings.
if (seenVariants.size < 2) {
  fail(`only ${[...seenVariants].join(', ') || 'no'} swing variant(s) fired across the ` +
       'melee window; the per-swing roll is not reaching the brain');
}
console.log(`ring: both swing variants fired (${[...seenVariants].sort().join(', ')})`);
```

`brains()` already reports `variant` — Task 3 Step 9 added it.

- [ ] **Step 5: Run the gate**

```bash
cat > /tmp/run-crowd-gate.sh <<'SH'
#!/usr/bin/env bash
set -e
export LAB_VITE_PORT=5298 LAB_CDP_PORT=9298
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
GAME_OUT=docs/dev-notes/2026-09-05-zombie-choreography \
  node scripts/sdf-game-crowd-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
SH
chmod +x /tmp/run-crowd-gate.sh && bash /tmp/run-crowd-gate.sh
```

Expected: `[crowd] OK`, with a line reporting both variants fired.

If only one fires, the melee window may simply be too short to see several
swings — check how many swings actually occurred before concluding the roll is
broken, and say which it was.

- [ ] **Step 6: Write the notes**

Create `docs/dev-notes/2026-09-05-swing-variants/notes.md`:

```markdown
# Zombie swing variants — 2026-09-05

Spec: `docs/superpowers/specs/2026-09-05-zombie-swing-variants-design.md`
Plan: `docs/superpowers/plans/2026-09-05-zombie-swing-variants.md`

Owner, on the choreography build: "the current one sweeps from front to side
… the current animation resembles a swimmer's motion tbh."

## The cause was structural

Every arm angle was `attackDrive(phase) × magnitude`, and `attackDrive` runs
0 → −1 → +1 → 0. That FORCES pitch negative at the wind-up and positive at the
strike: the arm must travel from behind the body to in front of it. A hook
needs the arm raised at both ends, which that cannot express. Add pitch
falling into the strike (0.85 → 0.55) while yaw swept 1.15 across, plus an off
arm counter-swinging in opposition, and it is a front crawl.

The body still rides `attackDrive` — its weight shift was never the problem.
The arm now rides `armArc`, interpolating between explicit per-variant angles.

| | wind-up pitch | strike pitch | wind-up yaw | strike yaw |
|---|---|---|---|---|
| hook | +0.35 | +0.95 (climbing) | +0.85 | −0.90 |
| overhead | +1.35 | −0.75 | +0.15 | −0.10 |

## Frames

`scripts/sdf-swing-strip.mjs` — both variants at five beats from ONE fixed
camera, so the arcs compare directly.

| file | what it shows |
|------|---------------|
| `hook-{rest,windup,midstrike,contact,recovery}.png` | The hook: cocked out and raised, then high and across. |
| `overhead-{rest,windup,midstrike,contact,recovery}.png` | The overhead: up past the head, then driven down. |

**What they actually show:** <replace this with what you SAW in the frames —
not what the table says they should show. If an arc reads wrong, say so and
name the frame.>

## The regression guard

`ATTACK_TUNING.flatArcRatio` (0.6): a swing's pitch travel must exceed that
fraction of its yaw travel, pinned by a test in `attack.test.ts`. The shipped
flat swing fails it. That is what stops this quietly reverting to a swimmer.

The crowd gate additionally asserts BOTH variants fire across the melee
window — a variant that never appears is a selection bug every unit test
passes, because the roll is consumed on one frame per swing.

## Known limits

* **No weighting knob.** Variant selection is a fair coin. If one should be
  rarer, `ATTACK_TUNING` is where that would go.
* **No damage.** Still choreography — no player health, no HUD, no death.
```

Replace the `<replace this…>` line with what you actually saw. It must not
survive the commit.

- [ ] **Step 7: Update TASKS.md**

Add to the "Current focus" section of `TASKS.md`, immediately above the
`**ZOMBIE COMBAT CHOREOGRAPHY — LANDED (2026-09-05)` row:

```markdown
**SWING VARIANTS — LANDED (2026-09-05), awaiting owner look.** The owner read
the one-arm hook as "a swimmer's motion", correctly: every arm angle was
`attackDrive × magnitude`, and that scalar runs 0 → −1 → +1 → 0, so pitch is
FORCED negative at the wind-up and positive at the strike — the arm must travel
from behind the body to in front of it, and a hook needs it raised at both
ends. The body keeps the signed drive (its weight shift was never wrong); the
arm now rides `armArc`, interpolating between explicit per-variant angles.
Two swings: a hook whose pitch CLIMBS 0.35 → 0.95 while yaw sweeps across, and
an overhead that is 2.1 rad of near-pure pitch. The off arm holds a raised
guard instead of counter-swinging — two arms in opposition through a
near-horizontal plane is the crawl. Variant is rolled at swing start from a
SECOND per-body RNG (sharing the wander generator would shift every subsequent
wander decision); the arm keeps alternating underneath, so a pack shows four
silhouettes. Guard: `flatArcRatio` 0.6, pinned by a test the shipped swing
fails, plus a gate assertion that both variants actually fire. Frames:
[docs/dev-notes/2026-09-05-swing-variants/](docs/dev-notes/2026-09-05-swing-variants/notes.md).
[spec](docs/superpowers/specs/2026-09-05-zombie-swing-variants-design.md) ·
[plan](docs/superpowers/plans/2026-09-05-zombie-swing-variants.md)
```

- [ ] **Step 8: Final verification**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: typecheck clean, full suite green. Report the actual test count.

- [ ] **Step 9: Commit**

```bash
git add scripts/sdf-swing-strip.mjs scripts/sdf-game-crowd-gate.mjs \
  src/lab/sdf-zombie/webgpu/game-main.ts src/lab/sdf-zombie/webgpu/game-actor.ts \
  docs/dev-notes/2026-09-05-swing-variants TASKS.md
git commit -m "swing strip: photograph both arcs, and gate that both fire

Ten frames, two variants at five beats, from one fixed camera so the arcs
compare directly. The gate additionally asserts both variants fire across the
melee window -- the roll is consumed on one frame per swing, so a broken
threshold shows up only over many swings and every unit test would pass.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
