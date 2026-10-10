# Goblin gait Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give the goblin its own quick, stooped "scamper" walk and run, built on the soldier's clip-derived stride curves and retimed and re-posed for 0.56 m legs, replacing the zombie shamble it still walks on.

**Spec:** `docs/superpowers/specs/2026-10-02-goblin-gait-design.md` — read it first.

**Architecture:** Two `GaitProfile`s in `gait.ts` (`GOBLIN_WALK`, `GOBLIN_RUN`) in CURVE MODE: leg angles and hip bob come from `SOLDIER_WALK`/`SOLDIER_RUN` (normalised by leg length, so they transfer), and the goblin's character is the profile's other fields. `GOBLIN_PROFILE` in `motion-profile.ts` points at them with speeds measured from the curves. Pure data, no renderer.

**Tech Stack:** TypeScript, Vitest, the lab turntable (`npm run blob:shot`, `BLOB_POSE=walk|run`).

## Rules for every task

- Work ONLY in this worktree. Never `git stash`. `node_modules` is in place.
- **Targeted tests** (`npx vitest run goblin gait motion-profile`) plus `npx tsc --noEmit`; the full `src/lab/sdf-zombie/` suite runs once, in Task 5.
- **Headless capture only:** `LAB_TMP=<scratch> BLOB_DIST=1.3 BLOB_TARGET_Y=0.7 BLOB_POSE=walk npm run blob:shot -- goblin`. Look at the frames yourself and say what is wrong. `BLOB_POSE_FRAMES` changes the phase held.
- **Every number has a source** in its comment: a derivation from measured data, or "eyeballed in the turntable, frame N".
- **In curve mode** `strideLen`, `footLift`, `kneeBend`, `kneeLift`, `kneeTrack`, `footPush`, `stanceDuty` and `bobAmp` are UNUSED for the legs and root (gait.ts, "CURVE MODE"): the curves own them. Do not tune those; tune `strideFreq`, `torsoLean`, `swayAmp`, `shoulderSway`, `armSwing`, `headBob`, `rockAmp`.
- One change per render; the owner reviews visual changes step by step.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lab/sdf-zombie/gait.ts` (modify) | `GOBLIN_WALK`, `GOBLIN_RUN` |
| `src/lab/sdf-zombie/motion-profile.ts` (modify) | `GOBLIN_PROFILE` uses them; cruise/runBand from measured speed |
| `src/lab/sdf-zombie/goblin-gait.test.ts` (create) | pins the relationships (cruise < runBand.from, implied speeds, carry arms) |
| `src/lab/sdf-zombie/goblin-held-gun.test.ts` (modify) | gait-name expectations |
| `docs/dev-notes/2026-10-02-goblin-gait/` (create) | baseline and final frames, measurements, notes |
| `docs/tasks/characters.md`, `TASKS.md` (modify) | status |

---

## Task 1: Baseline and the foot-stretch measurement

**Files:** create `docs/dev-notes/2026-10-02-goblin-gait/notes.md` and frames.

- [ ] **Step 1: Baseline frames.** Shoot `BLOB_POSE=walk` and `run` (three `BLOB_POSE_FRAMES` values each: 40, 55, 70) with the current profile. Save front and side frames as `before-*.png`. Say in the notes what the zombie shamble looks like on this body: stride vs leg, bob, whether the boots slide.
- [ ] **Step 2: Measure the foot stretch** the audit logged. `BLOB_PROBE` prints a JSON expression after boot. Compare each goblin prim's length at rest (`__sdfLab.current`'s prims `a`/`b`) with its posed length (`__sdfLab.heroPosed().prims`) in the held walk pose, and print every prim whose length changed by more than 10 mm, with its `.blob` line. Expected: the foot prims are gone, so the +8-10 cm entries should be gone too; if any prim still stretches, name it.
- [ ] **Step 3: Check the boot against the leg in the walk.** In the frames, are the boots attached to the shins at every phase, and do they leave the floor and plant? Record it.
- [ ] **Step 4: Commit** `docs(goblin): gait baseline and foot-stretch measurement`.

## Task 2: Walk and run profiles

**Files:** modify `gait.ts`, `motion-profile.ts`; create `goblin-gait.test.ts`; modify `goblin-held-gun.test.ts`.

- [ ] **Step 1: Failing test** `src/lab/sdf-zombie/goblin-gait.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { motionProfileFor } from './motion-profile';
import { GOBLIN_WALK, GOBLIN_RUN } from './gait';
import { SOLDIER_WALK } from './gait-curves/soldier-walk';
import { SOLDIER_RUN } from './gait-curves/soldier-run';

const LEG = 0.29 + 0.27; // goblin.blob thigh + shin, metres
const implied = (c: typeof SOLDIER_WALK, freq: number) => {
  const duty = c.L.stance.filter(Boolean).length / c.n;
  return (c.travel * LEG * freq) / duty;
};

describe('goblin gait', () => {
  const p = motionProfileFor('goblin');

  it('walks and runs on its own clip-derived gaits, with carry arms for the shotgun', () => {
    expect(p.gait.walk).toBe(GOBLIN_WALK);
    expect(p.gait.run).toBe(GOBLIN_RUN);
    expect(GOBLIN_WALK.curves).toBe(SOLDIER_WALK);
    expect(GOBLIN_RUN.curves).toBe(SOLDIER_RUN);
    expect(GOBLIN_WALK.armStyle).toBe('carry');
    expect(GOBLIN_RUN.armStyle).toBe('carry');
  });

  it('steps quicker than the soldier (short legs) but is not a blur', () => {
    expect(GOBLIN_WALK.strideFreq).toBeGreaterThan(SOLDIER_WALK.freq);
    expect(GOBLIN_WALK.strideFreq).toBeLessThan(2.2);
    expect(GOBLIN_RUN.strideFreq).toBeGreaterThan(GOBLIN_WALK.strideFreq);
  });

  it('cruises at the walk gait\'s own implied speed and below the run blend', () => {
    const walkSpeed = implied(SOLDIER_WALK, GOBLIN_WALK.strideFreq);
    expect(p.cruise).toBeCloseTo(walkSpeed, 1);
    expect(p.cruise).toBeLessThan(p.runBand.from); // marches, never drifts toward the run (soldier overshoot lesson)
    expect(p.runBand.to).toBeCloseTo(implied(SOLDIER_RUN, GOBLIN_RUN.strideFreq), 1);
    expect(p.runBand.to).toBeGreaterThan(p.runBand.from);
  });

  it('stoops forward, more when running', () => {
    expect(GOBLIN_WALK.torsoLean).toBeGreaterThan(0);
    expect(GOBLIN_RUN.torsoLean).toBeGreaterThan(GOBLIN_WALK.torsoLean);
  });
});
```

Run `npx vitest run goblin-gait`. Expected: FAIL (no `GOBLIN_WALK`).
- [ ] **Step 2: Profiles** in `gait.ts` after `SHAMBLE_CARRY` (keep `SHAMBLE_CARRY` exported; it is still the fallback and the existing test pins it until Step 4):

```ts
/** The goblin's SCAMPER (owner, 2026-10-02: "scheming scamper"): quick short light steps on a stooped body. CURVE MODE
 *  on the soldier's sampled walk, whose stride shape is normalised by leg length so the goblin's 0.56 m legs (thigh 0.29
 *  + shin 0.27, against the soldier's 0.84) just work. strideLen, footLift, kneeBend, kneeLift, kneeTrack, footPush,
 *  stanceDuty and bobAmp are unused in curve mode; the character is cadence, lean, sway and arms. */
export const GOBLIN_WALK: GaitProfile = {
  ...SHAMBLE,
  name: 'goblin-walk',
  // 1.5 Hz: the soldier's 0.9375 x 1.6. A pendulum's period goes with sqrt(length), so 0.56/0.84 alone gives x1.22; the
  // scamper adds the rest. At the curves' travel 0.888 leg-lengths and duty 0.63 that implies 0.888 x 0.56 x 1.5 / 0.63
  // = 1.18 m/s. Eyeballed starting point: tune in the turntable.
  strideFreq: 1.5,
  curves: SOLDIER_WALK,
  // The stoop. The .blob already hunches at rest, so this is only commitment toward the heading.
  torsoLean: 8,
  swayAmp: 0.025,
  shoulderSway: 0.45,
  // The carry table owns the arms (the shotgun); this only rides the shoulders.
  armSwing: 0.03,
  asymJitter: 0.08,
  armStyle: 'carry',
};

/** The goblin's run: the soldier's run curves at a higher cadence and a deeper lean. Eyeballed starting values. */
export const GOBLIN_RUN: GaitProfile = {
  ...GOBLIN_WALK,
  name: 'goblin-run',
  strideFreq: 2.1,
  curves: SOLDIER_RUN,
  torsoLean: 14,
  swayAmp: 0.025,
  shoulderSway: 0.5,
  armSwing: 0.04,
};
```

Import `SOLDIER_WALK`/`SOLDIER_RUN` are already imported in `gait.ts`.
- [ ] **Step 3: Profile.** In `motion-profile.ts` import `GOBLIN_WALK, GOBLIN_RUN` and change `GOBLIN_PROFILE` to `gait: { walk: GOBLIN_WALK, run: GOBLIN_RUN }`, with `cruise` and `runBand` from the same arithmetic as the test (`walkSpeed` = 1.18 m/s -> `cruise: 1.18`, `runBand: { from: 1.30, to: <implied run speed, 3 significant figures> }` ), each with a comment giving the derivation. Compute the run speed by running the test's `implied` helper once and writing the number down.
- [ ] **Step 4: Update `goblin-held-gun.test.ts`:** its "carry-style arms from the gait" test checks `armStyle` only, which still holds; change nothing unless it fails.
- [ ] **Step 5: Run** `npx vitest run goblin gait motion-profile character-registry`. Expected: PASS. `npx tsc --noEmit` (only the pre-existing `pack-golden` error).
- [ ] **Step 6: Commit** `feat(goblin): own walk and run gaits (scamper), on the soldier's stride curves`.

## Task 3: Look at it and tune

**Files:** modify `gait.ts` (numbers and comments only), notes.

- [ ] **Step 1:** Shoot walk and run at the three phases and compare with the Task 1 baseline. Judge: feet plant (no skating), knees bend forward, the stoop reads, the gun and arms stay in the carry, nothing clips (pads/yoke/collar against head, shades, gun), boots stay on.
- [ ] **Step 2:** Tune `strideFreq` first (the scamper's tempo), then `torsoLean`, then `swayAmp`/`shoulderSway`, then arms, one at a time, one render each, writing the number and the reason in the comment. If the head bob is too weak (curve mode takes it from the clip x leg length), say so and propose `headBob`/`rockAmp` before touching anything else.
- [ ] **Step 3:** Re-run the Task 2 tests after each retune that moves `strideFreq` (they derive `cruise`); update `cruise`/`runBand` and the comment with the new arithmetic.
- [ ] **Step 4: Commit** `tune(goblin): scamper gait after the turntable`.

## Task 4: The foot stretch, only if Task 1 found one

- [ ] If Task 1 Step 2 listed any prim whose posed length changed by more than 10 mm: find its owner (the table in `authoring-sdf-characters` says which line), fix it at the source (a `.blob` bind or the rig), and add a pin. If it listed nothing, write that in the notes and skip this task.

## Task 5: Gates and board

- [ ] `npm run blob:render-check -- goblin` (exit 0), `npx tsc --noEmit`, `npx vitest run src/lab/sdf-zombie/` (all pass; the soldier `sheet` warning is pre-existing).
- [ ] Final walk and run frames into `docs/dev-notes/2026-10-02-goblin-gait/`; update `docs/tasks/characters.md` (phase 4a built, awaiting the owner; 4b = the Flat's clips) and `TASKS.md`; dualmem checkpoint.
- [ ] Commit `docs(goblin): gait frames, notes and board`. The owner's look is the gate; do not mark phase 4a done before it.

## Self-review

Spec coverage: scamper feel -> Tasks 2-3; clip-derived curves, swappable -> Task 2; carry arms -> Task 2 test; measured speeds -> Task 2 test and Step 3; foot stretch -> Tasks 1 and 4; boots and armour in motion -> Tasks 1 and 3; gate -> Task 5. Known limit: the head bob is the clip's hip bob scaled by leg length, so it may come out weak; Task 3 Step 2 says what to do. Unverified: that a retimed soldier walk reads as a scamper rather than a hurried soldier; the lab frames are the test of that.
