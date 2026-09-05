# Soldier Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The soldier walks, runs, carries the shorty double shotgun and hip-fires it in the lab, with his polygon kit and the gun riding the rig — and the same machinery makes every future non-zombie character animatable.

**Architecture:** The verlet rig stays the single motion authority. Three additions: (1) the gait learns every bone name a `.blob` can use (the goblin and soldier currently get NO motion at all — `makeMotionJoints` returns null because their rigs have more points than the gait can name); (2) `GAIT_TUNING` becomes a named profile, blended walk↔run by speed, with a `carry` arm style that authors the right arm as shoulder rotations and IK-solves the left hand onto the gun's fore-end; (3) a pure `rig-frames.ts` derives one rigid transform per bone from the posed rig, which poses the skinned kit glTF and the held prop every frame.

**Tech Stack:** TypeScript, vitest, three.js (WebGPU build) for the kit/prop views only. Every module under `src/lab/sdf-zombie/*.ts` (not `webgpu/`) is pure and THREE-free.

**Spec:** [docs/superpowers/specs/2026-09-05-soldier-animation-design.md](../specs/2026-09-05-soldier-animation-design.md)

**Spec amendments discovered while planning (fold into the spec in Task 1):**
- The goblin and soldier get no motion today at all, not just no arm motion. `bindRig` makes a rig point for every bone head and tail, but `jointNamesForBody` only names the zombie's; the count mismatch makes `makeMotionJoints` return null. So the joint schema GROWS by eight secondary names (`spineA`, `spineB`, `clavicleL/R`, `handTipL/R`, `toeL/R`) and `jointNamesForBody` dedups by POSITION (as `bindRig` does), preferring primary names.
- The gun rides the right **forearm** frame (elbow→hand, a 24 cm lever), not the 9.5 cm hand bone whose tip is a free verlet point.
- The left hand is IK-solved (FABRIK, lengths preserved exactly) onto the gun's `Fore_Hand` locator. This is a rotation-preserving solve, not an additive hand displacement, so it obeys the spec's "never hand displacements" rule while making the carry-pose gate satisfiable by construction.
- `K` already forces a collapse in the lab; the spec's `X` key is dropped.

**Conventions you must know:**
- Body-local axes: +x = the body's right, +y up, +z forward. `rotateYaw(v, yaw)` takes body-local → world.
- Quaternions are `[x, y, z, w]` (`vec.ts`). `qMul(a, b)` applies **b first**.
- Every rotation of a bone segment composes as `qMul(qFromTo(rotateYaw(restDir, bodyYaw), dir), qYaw)` — the body yaw first, then the residual (see `headTransform` in `rig-bind.ts` for why: a near-vertical segment's shortest-arc loses azimuth).
- Run tests with `npx vitest run <file>`; typecheck with `npx tsc --noEmit`. Full suite: `npx vitest run` (≈2500 tests, ~1 min).
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- The shorty glb (`public/assets/lab/shorty-double.glb`) is authored gun-local **+z = muzzle**, −y down. Locators (world at rest): `Grip_Hand (0, −0.074, −0.074)`, `Fore_Hand (0, −0.045, 0.155)`, `Muzzle_L/R (±0.0234, 0, 0.318)`. Scene root node is `GunRoot`.
- The soldier kit glTF (`public/assets/lab/soldier-kit.gltf`) is SKINNED: bone nodes named exactly like the blob bones (`pelvis, hips, spine1, chest, spine2, neck, skull, clavicle.l/r, upperarm.l/r, forearm.l/r, hand.l/r, thigh.l/r, shin.l/r, foot.l/r`), each node sitting at its bone's HEAD with no rotation; `hips` is an extra zero-offset child of `pelvis` with no blob bone.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lab/sdf-zombie/gait-pins.test.ts` (new) | Bit-exact checksums of the ZOMBIE's gait and motion output, recorded BEFORE any refactor. Every later task must keep them green. |
| `src/lab/sdf-zombie/gait.ts` (modify) | Joint schema growth, position-dedup naming, aliases; `GaitProfile` + `SHAMBLE/MARCH/RUN` + `blendProfiles`; torso lean in the pose. |
| `src/lab/sdf-zombie/rig-bind.ts` (modify) | Lowercase arm bone names get arm frames and elbow bends; the three duplicated yaw-first compositions call `segmentQuat` from rig-frames. |
| `src/lab/sdf-zombie/collapse.ts` (modify) | Rope anchors for offset clavicle heads. |
| `src/lab/sdf-zombie/rig-frames.ts` (new, pure) | `segmentQuat`, `boneFrames(body, bound, bodyYaw)`. |
| `src/lab/sdf-zombie/carry.ts` (new, pure) | Carry table, gun grip spec, `gunPoseFromArm`, `armPivot` rotations, `lookQuat`. |
| `src/lab/sdf-zombie/motion-profile.ts` (new, pure) | Per-character `MotionProfile` (gait pair, speed bands, cruise, carries, prop url). |
| `src/lab/sdf-zombie/wander.ts` (modify) | `stepWander` takes a cruise speed. |
| `src/lab/sdf-zombie/motion.ts` (modify) | Profile blend, lean, carry arms + left-hand IK, `fire` signal, `kicks` output, `forceSpeed`/`carryOverride` config, tip/toe follow. |
| `src/lab/sdf-zombie/actor.ts` (modify) | Passes profile/config through; applies frame kicks with `impulseAt`. |
| `src/lab/sdf-zombie/prop-drop.ts` (new, pure) | Ballistic tumble + floor rest for a released prop. |
| `src/lab/sdf-zombie/webgpu/kit-overlay.ts` (modify) | `pose(frames)` writes bone world matrices. |
| `src/lab/sdf-zombie/webgpu/held-prop.ts` (new) | Loads the gun, poses it from the arm, releases and drops it, exposes `muzzle()`. |
| `src/lab/sdf-zombie/webgpu/lab-main.ts` (modify) | Profile by character, kit/prop posed per frame, keys `1`/`2`/`F`, handle exports, panel text. |
| `scripts/blob-turntable.mjs` (modify) | `BLOB_POSE=walk|run|hip` steps the motion deterministically before capture. |
| `TASKS.md`, spec | Status + amendments. |

---

### Task 1: Pin the zombie's current output, amend the spec

**Files:**
- Create: `src/lab/sdf-zombie/gait-pins.test.ts`
- Modify: `docs/superpowers/specs/2026-09-05-soldier-animation-design.md`

- [ ] **Step 1: Write the pin test with a placeholder expectation so it prints the real checksums**

```ts
// src/lab/sdf-zombie/gait-pins.test.ts
//
// BIT-EXACT PINS of the zombie's gait and motion output, recorded before the
// soldier-animation refactor (profiles, joint schema growth, carries). Every
// later change must leave the zombie's numbers untouched: the shamble was
// approved by eye and nothing in this plan is allowed to move it. If a pin
// fails, the refactor changed arithmetic — fix the refactor, never the pin.
import { describe, it, expect } from 'vitest';
import { makeGaitState, stepGait, type GaitSkew } from './gait';
import {
  makeMotionJoints, makeMotionState, stepMotion,
  type MotionConfig, type MotionSignals,
} from './motion';
import { buildBody } from './build-body';
import { makeZombie } from './body';
import { DEFAULT_FACE } from './face';
import { bindRig } from './rig-bind';
import { makeRng, type WanderBounds } from './wander';
import type { RigPoint } from './rig';
import type { Vec3 } from './types';

const DT = 1 / 60;
const NONE: GaitSkew = { damageMeter: 0, missing: {}, wounded: {} };
const BOUNDS: WanderBounds = { minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 };

/** Order-sensitive float checksum: two accumulators so a swap of two values
 *  cannot cancel. Returned as a fixed-precision string so the pin is exact. */
function checksum(values: number[]): string {
  let a = 0, b = 0;
  for (let i = 0; i < values.length; i++) {
    a += values[i]! * (1 + (i % 97));
    b += values[i]! * values[i]! * (1 + (i % 89));
  }
  return `${a.toFixed(9)}|${b.toFixed(9)}`;
}

/** The 16 non-pelvis joints the zombie has today, in GaitPose.offsets order. */
const ZOMBIE_JOINTS = [
  'hips', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR',
  'handL', 'handR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR',
] as const;

describe('zombie output pins (pre-refactor)', () => {
  it('stepGait, swing and reach, 600 frames', () => {
    const out: number[] = [];
    for (const style of ['swing', 'reach'] as const) {
      let st = makeGaitState(7);
      for (let i = 0; i < 600; i++) {
        const step = stepGait(st, NONE, DT, style);
        st = step.state;
        out.push(...step.pose.rootOffset);
        for (const j of ZOMBIE_JOINTS) out.push(...step.pose.offsets[j]);
        if (step.pose.reach) {
          out.push(step.pose.reach.pitchL, step.pose.reach.pitchR, step.pose.reach.drop, ...step.pose.reach.shift);
        }
        out.push(step.pose.phase);
      }
    }
    expect(checksum(out)).toBe('GAIT_PIN');
  });

  it('stepMotion on the stock zombie, wandering, 300 frames', () => {
    const body = buildBody(makeZombie({ ...DEFAULT_FACE }), undefined!, undefined!);
    const bound = bindRig(body);
    const joints = makeMotionJoints(body, bound.rig.restPose);
    if (!joints) throw new Error('stock zombie has no motion joints');
    const cfg: MotionConfig = { enabled: true, wander: true };
    const sig = (): MotionSignals => ({
      dt: DT, shot: null,
      wounded: { armL: false, armR: false, legL: false, legR: false },
      severed: [], missing: { legL: false, legR: false, armL: false, armR: false },
      headAlive: true, forcedCollapse: false, freshWounds: [],
    });
    let state = makeMotionState(11, [0, 0, 0]);
    let points: RigPoint[] = joints.base.map(p => ({ pos: [...p] as Vec3, prev: [...p] as Vec3, pinned: false }));
    const rng = makeRng(42);
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const step = stepMotion(state, joints, cfg, sig(), points, BOUNDS, rng);
      state = step.state;
      points = step.frame.restPose.map(p => ({ pos: [...p] as Vec3, prev: [...p] as Vec3, pinned: false }));
      for (const p of step.frame.restPose) out.push(...p);
      out.push(step.frame.bodyYaw, step.frame.blend);
    }
    expect(checksum(out)).toBe('MOTION_PIN');
  });
});
```

- [ ] **Step 2: Run it, read the two real checksums off the failure output**

Run: `npx vitest run src/lab/sdf-zombie/gait-pins.test.ts`
Expected: 2 FAIL, each showing `Expected: "GAIT_PIN"` / `Received: "<digits>|<digits>"`.

- [ ] **Step 3: Paste the received strings over `'GAIT_PIN'` and `'MOTION_PIN'`, rerun**

Run: `npx vitest run src/lab/sdf-zombie/gait-pins.test.ts`
Expected: 2 PASS. Run it twice more to prove the values are stable (they are pure functions of seeds).

- [ ] **Step 4: Amend the spec** — under `## Decisions` append this table row and a new subsection:

```markdown
| Joint schema | Grows by eight SECONDARY names (spineA, spineB, clavicleL/R, handTipL/R, toeL/R). Discovered in planning: the goblin and soldier get NO motion today — bindRig makes a rig point for every bone end, jointNamesForBody could not name them all, and makeMotionJoints returned null on the count mismatch. |
| Gun frame | The gun rides the right FOREARM frame (elbow→hand), not the hand bone: a 24 cm lever is steadier than a 9.5 cm bone whose tip is a free verlet point. |
| Left hand | IK-solved (FABRIK, segment lengths preserved) onto the gun's Fore_Hand locator. Lengths are exact, so this is not an additive displacement. |
| Lab keys | `1` walk band, `2` run band, `F` fire. Collapse stays on the existing `K`. |
```

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/gait-pins.test.ts docs/superpowers/specs/2026-09-05-soldier-animation-design.md
git commit -m "soldier anim: pin the zombie's gait+motion output before the refactor; spec amendments

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Grow the gait joint schema; name every rig point of the soldier and goblin

**Files:**
- Modify: `src/lab/sdf-zombie/gait.ts` (types at ~36-52, `JOINT_AT`/`jointForBoneEnd`/`jointNamesForBody` at ~475-523, `offsets` assembly at ~445-465)
- Modify: `src/lab/sdf-zombie/motion.ts` (`LEAN_SHARE` ~377)
- Test: `src/lab/sdf-zombie/gait.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append to `gait.test.ts`; add the three blob imports at the top of the file)

```ts
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { makeMotionJoints } from './motion';
import soldierSrc from './characters/soldier.blob?raw';
import goblinSrc from './characters/goblin.blob?raw';
import zombieSrc from './characters/zombie.blob?raw';

describe('joint naming — every rig point of every character gets a name', () => {
  const load = (src: string) => {
    const body = buildBody(compileBlob(parseBlob(src)));
    return { body, bound: bindRig(body), names: jointNamesForBody(body) };
  };
  it('zombie: the 17 primary names in the historical order', () => {
    const { names } = load(zombieSrc);
    expect(names).toEqual([
      'pelvis', 'hips', 'chest', 'neck', 'head',
      'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR',
      'hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR',
    ]);
  });
  it.each([['soldier', soldierSrc], ['goblin', goblinSrc]])('%s: names == rig points, makeMotionJoints is live', (_n, src) => {
    const { bound, names, body } = load(src);
    expect(names.length).toBe(bound.rig.points.length);
    expect(new Set(names).size).toBe(names.length);
    expect(makeMotionJoints(body, bound.rig.restPose)).not.toBeNull();
    for (const j of ['shoulderL', 'elbowL', 'handL', 'hipL', 'kneeL', 'footL', 'chest', 'neck', 'head'])
      expect(names, j).toContain(j);
  });
  it('soldier: the secondary names land on the right points', () => {
    const { body, bound, names } = load(soldierSrc);
    const at = (n: string) => bound.rig.points[names.indexOf(n as never)]!.pos;
    expect(at('spineA')).toEqual(body.bones.get('spine1')!.tail);
    expect(at('spineB')).toEqual(body.bones.get('chest')!.tail);
    expect(at('chest')).toEqual(body.bones.get('neck')!.head);
    expect(at('clavicleL')).toEqual(body.bones.get('clavicle.l')!.head);
    expect(at('handTipR')).toEqual(body.bones.get('hand.r')!.tail);
    expect(at('toeL')).toEqual(body.bones.get('foot.l')!.tail);
  });
  it('goblin: chest.tail and neck.head coincide and the PRIMARY name wins', () => {
    const { names } = load(goblinSrc);
    expect(names).toContain('chest');
    expect(names).not.toContain('spineB');
  });
  it('jointForBoneEnd aliases', () => {
    expect(jointForBoneEnd('upperarm.l', 'head')).toBe('shoulderL');
    expect(jointForBoneEnd('forearm.r', 'tail')).toBe('handR');
    expect(jointForBoneEnd('hand.r', 'tail')).toBe('handTipR');
    expect(jointForBoneEnd('foot.l', 'tail')).toBe('toeL');
    expect(jointForBoneEnd('clavicle.l', 'head')).toBe('clavicleL');
    expect(jointForBoneEnd('spine2', 'tail')).toBe('chest');
  });
  it('the pose carries every secondary joint, rigid with its parent', () => {
    const p = stepGait(makeGaitState(3), NONE, 0.2, 'swing').pose;
    expect(p.offsets.handTipL).toEqual(p.offsets.handL);
    expect(p.offsets.toeR).toEqual(p.offsets.footR);
    expect(p.offsets.clavicleL).toEqual(p.offsets.chest);
    expect(p.offsets.spineA[1]).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/gait.test.ts -t "joint naming"`
Expected: FAIL (type errors on the new names and `names.length` mismatches).

- [ ] **Step 3: Grow the schema in `gait.ts`**

Replace the `GaitJointName` type and `GAIT_JOINTS`:

```ts
/** One name per rig point. The first 17 are the PRIMARY joints (the zombie's
 *  authored bones). The rest are SECONDARY: extra rig points that richer
 *  skeletons have (a two- or three-bone spine, clavicles that start off the
 *  spine, hand and foot bones with free tips). A secondary joint carries a
 *  derived offset (rigid with its parent) — nothing in the gait is authored
 *  against it, so a body without one loses nothing. */
export type GaitJointName =
  | 'pelvis' | 'hips' | 'chest' | 'neck' | 'head'
  | 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR' | 'handL' | 'handR'
  | 'hipL' | 'hipR' | 'kneeL' | 'kneeR' | 'footL' | 'footR'
  | 'spineA' | 'spineB' | 'clavicleL' | 'clavicleR'
  | 'handTipL' | 'handTipR' | 'toeL' | 'toeR';

/** Every joint, primary first — the ORDER is the naming priority when two
 *  bone ends share a position (jointNamesForBody). */
export const GAIT_JOINTS: readonly GaitJointName[] = [
  'pelvis', 'hips', 'chest', 'neck', 'head',
  'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR',
  'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR',
  'spineA', 'spineB', 'clavicleL', 'clavicleR', 'handTipL', 'handTipR', 'toeL', 'toeR',
];
```

Replace `JOINT_AT`, `SIDED`, `jointForBoneEnd`, `jointNamesForBody`:

```ts
// Bone-name → joint-name table. Mirrored bones (suffix `.l`/`.r`) map to the
// sided names. The zombie's names (spine, upperArm, foreArm) and the newer
// `.blob` names (spine1/chest/spine2, upperarm/forearm/hand, foot) both
// resolve. A bone end absent here is a wiring error (makeMotionJoints nulls).
const JOINT_AT: Record<string, { head: string; tail: string }> = {
  pelvis:   { head: 'pelvis',   tail: 'hips' },
  spine:    { head: 'hips',     tail: 'chest' },
  spine1:   { head: 'hips',     tail: 'spineA' },
  chest:    { head: 'spineA',   tail: 'spineB' },
  spine2:   { head: 'spineB',   tail: 'chest' },
  neck:     { head: 'chest',    tail: 'neck' },
  skull:    { head: 'neck',     tail: 'head' },
  clavicle: { head: 'clavicle', tail: 'shoulder' },
  upperArm: { head: 'shoulder', tail: 'elbow' },
  upperarm: { head: 'shoulder', tail: 'elbow' },
  foreArm:  { head: 'elbow',    tail: 'hand' },
  forearm:  { head: 'elbow',    tail: 'hand' },
  hand:     { head: 'hand',     tail: 'handTip' },
  thigh:    { head: 'hip',      tail: 'knee' },
  shin:     { head: 'knee',     tail: 'foot' },
  foot:     { head: 'foot',     tail: 'toe' },
};

/** The joint names that carry a per-side suffix (centerline joints never do). */
const SIDED: ReadonlySet<string> = new Set([
  'clavicle', 'shoulder', 'elbow', 'hand', 'handTip', 'hip', 'knee', 'foot', 'toe',
]);

/** Joint name for a resolved bone's head/tail, or null for unknown bones.
 *  e.g. jointForBoneEnd('thigh.l', 'tail') === 'kneeL'. */
export function jointForBoneEnd(bone: string, end: 'head' | 'tail'): GaitJointName | null {
  const dot = bone.lastIndexOf('.');
  const base = dot >= 0 ? bone.slice(0, dot) : bone;
  const side = dot >= 0 ? bone.slice(dot + 1) : '';
  const at = JOINT_AT[base]?.[end];
  if (!at) return null;
  if (side && SIDED.has(at)) return (at + side.toUpperCase()) as GaitJointName;
  return at as GaitJointName;
}

/** Same tolerance bindRig dedups rig points with. */
const KEY_EPS = 1e-4;

/** Joint names in rig-point order for a built body — the exact zip key for
 *  the wiring: `pose.offsets[names[i]]` applies to `rig.points[i]`'s target.
 *
 *  Dedup is by POSITION, exactly as bindRig does it: a bone's tail and its
 *  child's head are one rig point and get ONE name. When several bone ends
 *  share a position (the zombie's spine.tail, neck.head, clavicle.l.head and
 *  clavicle.r.head are all `chest`), the name earliest in GAIT_JOINTS wins —
 *  so `chest` beats `spineB` on the goblin, whose chest bone runs straight
 *  into the neck. A name is never used twice; a candidate already taken
 *  falls through to the next, and a point left nameless shows up as a
 *  count mismatch in makeMotionJoints (null), never as a scrambled pose. */
export function jointNamesForBody(body: BuildResult): GaitJointName[] {
  const positions: Vec3[] = [];
  const candidates: GaitJointName[][] = [];
  const indexOf = (p: Vec3): number => {
    for (let i = 0; i < positions.length; i++) {
      const q = positions[i]!;
      if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < KEY_EPS) return i;
    }
    positions.push(p);
    candidates.push([]);
    return positions.length - 1;
  };
  for (const [boneName, bone] of body.bones.entries()) {
    for (const end of ['head', 'tail'] as const) {
      const i = indexOf(bone[end]);
      const name = jointForBoneEnd(boneName, end);
      if (name && !candidates[i]!.includes(name)) candidates[i]!.push(name);
    }
  }
  const rank = (n: GaitJointName) => GAIT_JOINTS.indexOf(n);
  const used = new Set<GaitJointName>();
  const names: GaitJointName[] = [];
  for (const cands of candidates) {
    const pick = cands.slice().sort((a, b) => rank(a) - rank(b)).find(n => !used.has(n));
    if (!pick) continue;
    used.add(pick);
    names.push(pick);
  }
  return names;
}
```

Note the zombie's historical order is preserved because `bindRig` and this function both index positions in `body.bones` iteration order; the test in Step 1 pins it.

- [ ] **Step 4: Emit the secondary offsets in the pose** — in `stepGait`'s `offsets` literal add, after `footR`:

```ts
    // Secondary joints — rigid with their parents. Nothing is authored
    // against them; they exist so richer skeletons have a target per point.
    spineA: [sway * 0.75, bob * 0.75, 0],
    spineB: [sway * 0.65, bob * 0.65, 0],
    clavicleL: [sway * 0.6, bob * 0.6, 0],
    clavicleR: [sway * 0.6, bob * 0.6, 0],
    handTipL: armA.hand,
    handTipR: armB.hand,
    toeL: legA.foot,
    toeR: legB.foot,
```

- [ ] **Step 5: Lean shares for the new joints** — in `motion.ts` `LEAN_SHARE` add:

```ts
  spineA: 0.55, spineB: 0.7, clavicleL: 0.85, clavicleR: 0.85, handTipL: 0.5, handTipR: 0.5,
```

- [ ] **Step 6: Run the new tests, the pins, tsc**

Run: `npx vitest run src/lab/sdf-zombie/gait.test.ts src/lab/sdf-zombie/gait-pins.test.ts src/lab/sdf-zombie/motion.test.ts && npx tsc --noEmit`
Expected: all PASS, tsc clean. (`Record<Exclude<GaitJointName,'pelvis'>, Vec3>` now requires the eight new keys — any other literal of that type in tests must be extended; grep `offsets:` in `*.test.ts` and add the keys with `[0,0,0]`.)

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/gait.ts src/lab/sdf-zombie/gait.test.ts src/lab/sdf-zombie/motion.ts
git commit -m "gait: name every rig point — secondary joints, position dedup, .blob bone aliases (soldier and goblin get motion)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: rig-bind knows the lowercase arm bones; rope anchors for offset clavicles

**Files:**
- Modify: `src/lab/sdf-zombie/rig-bind.ts` (~137-160 elbow bends, ~233-236 `bindPrim` arm frame)
- Modify: `src/lab/sdf-zombie/collapse.ts` (`ROPE_SPEC` ~247)
- Test: `src/lab/sdf-zombie/rig-bind.test.ts` (append)

- [ ] **Step 1: Failing tests** (append; add imports for `compileBlob`, `parseBlob`, `soldierSrc` as in Task 2, plus `makeMotionJoints` from `./motion` and `collapseRopes` from `./collapse`)

```ts
describe('rig-bind on .blob bone names (soldier)', () => {
  const body = buildBody(compileBlob(parseBlob(soldierSrc)));
  const bound = bindRig(body);
  it('both elbows get a bend constraint', () => {
    expect(bound.rig.bends?.length).toBe(2);
  });
  it('upperarm/forearm prims carry an arm frame', () => {
    const armPrims = body.prims.map((p, i) => [p, i] as const).filter(([p]) => /^(upperarm|forearm)\.[lr]$/.test(p.bone ?? ''));
    expect(armPrims.length).toBeGreaterThan(0);
    for (const [, i] of armPrims) expect(bound.binding[i]!.armFrame, `prim ${i}`).toBeDefined();
  });
  it('collapse ropes anchor the offset clavicle heads to the chest', () => {
    const names = jointNamesForBody(body);
    const ropes = collapseRopes(names, bound.rig.restPose);
    const iC = names.indexOf('chest'), iL = names.indexOf('clavicleL'), iR = names.indexOf('clavicleR');
    expect(ropes.some(r => (r.a === iL && r.b === iC) || (r.a === iC && r.b === iL))).toBe(true);
    expect(ropes.some(r => (r.a === iR && r.b === iC) || (r.a === iC && r.b === iR))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**: `npx vitest run src/lab/sdf-zombie/rig-bind.test.ts -t "blob bone names"` → FAIL (`bends.length` 0, no armFrame, no rope).

- [ ] **Step 3: Generalise the two name lookups in `rig-bind.ts`**

Add near the top (after imports):

```ts
/** The upper-arm / forearm bone for a side, under either naming convention:
 *  the zombie's `upperArm`/`foreArm` or the `.blob` idiom `upperarm`/`forearm`. */
function armBoneName(body: BuildResult, part: 'upper' | 'fore', side: 'l' | 'r'): string | null {
  for (const n of part === 'upper' ? ['upperArm', 'upperarm'] : ['foreArm', 'forearm']) {
    if (body.bones.has(`${n}.${side}`)) return `${n}.${side}`;
  }
  return null;
}
const ARM_BONE_RE = /^(upperArm|upperarm|foreArm|forearm)\.[lr]$/;
```

In the elbow-bend block replace the hardcoded names:

```ts
  const leftShoulder = armBoneName(body, 'upper', 'l') ? body.bones.get(armBoneName(body, 'upper', 'l')!)?.head : undefined;
  const rightShoulder = armBoneName(body, 'upper', 'r') ? body.bones.get(armBoneName(body, 'upper', 'r')!)?.head : undefined;
  ...
  for (const side of ['l', 'r'] as const) {
    const upperName = armBoneName(body, 'upper', side), foreName = armBoneName(body, 'fore', side);
    if (!upperName || !foreName) continue;
    ... (rest unchanged; `live(upperName)` etc. now take the resolved names)
```

In `bindPrim` replace the regex test with `ARM_BONE_RE.test(p.bone)`.

- [ ] **Step 4: Rope anchors** — in `collapse.ts` `ROPE_SPEC`, after the two hip anchors:

```ts
  // Clavicle anchors — a clavicle that starts OFF the spine (side= offset,
  // the goblin and soldier) has no rig constraint to the chest; the rest
  // pull held it there while standing, and collapse releases the rest pull.
  // collapseRopes skips names a body lacks, so the zombie is untouched.
  { a: 'clavicleL', b: 'chest', factor: COLLAPSE_TUNING.anchorSlack },
  { a: 'clavicleR', b: 'chest', factor: COLLAPSE_TUNING.anchorSlack },
```

- [ ] **Step 5: Run**: `npx vitest run src/lab/sdf-zombie/rig-bind.test.ts src/lab/sdf-zombie/rig-bind-bones.test.ts src/lab/sdf-zombie/collapse.test.ts src/lab/sdf-zombie/gait-pins.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/rig-bind.ts src/lab/sdf-zombie/rig-bind.test.ts src/lab/sdf-zombie/collapse.ts
git commit -m "rig-bind: arm frames and elbow bends for .blob arm names; clavicle rope anchors

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: rig-frames.ts — one rigid transform per bone from the posed rig

**Files:**
- Create: `src/lab/sdf-zombie/rig-frames.ts`, `src/lab/sdf-zombie/rig-frames.test.ts`
- Modify: `src/lab/sdf-zombie/rig-bind.ts` (three `qMul(qFromTo(rest, dir), qYaw)` sites: `applyRig` poseEnds ~331, boneFrames branch ~355, `headTransform` ~430, `headQuatOf` ~465)

- [ ] **Step 1: Failing tests**

```ts
// src/lab/sdf-zombie/rig-frames.test.ts
import { describe, it, expect } from 'vitest';
import { boneFrames, segmentQuat } from './rig-frames';
import { buildBody } from './build-body';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { bindRig } from './rig-bind';
import { qRotate, qFromAxisAngle, normalize, sub, len, add } from './vec';
import type { Vec3 } from './types';
import soldierSrc from './characters/soldier.blob?raw';

const near = (a: Vec3, b: Vec3, eps = 1e-6) => len(sub(a, b)) < eps;

describe('rig-frames', () => {
  const body = buildBody(compileBlob(parseBlob(soldierSrc)));
  const bound = bindRig(body);

  it('at rest every bone frame is bind: head position, identity rotation', () => {
    const frames = boneFrames(body, bound, 0);
    expect(frames.size).toBe(body.bones.size);
    for (const [name, bone] of body.bones) {
      const f = frames.get(name)!;
      expect(near(f.pos, bone.head), name).toBe(true);
      expect(f.quat, name).toEqual([0, 0, 0, 1]);
    }
  });

  it('a yawed rest rig yields exactly the yaw quaternion on every bone', () => {
    const yaw = 1.1;
    const qYaw = qFromAxisAngle([0, 1, 0], yaw);
    const pivot = body.bones.get('pelvis')!.head;
    const points = bound.rig.points.map(p => {
      const rel = sub(p.pos, [pivot[0], 0, pivot[2]]);
      const r = qRotate(qYaw, rel);
      const pos: Vec3 = [r[0] + pivot[0], r[1], r[2] + pivot[2]];
      return { ...p, pos };
    });
    const frames = boneFrames(body, { ...bound, rig: { ...bound.rig, points } }, yaw);
    for (const [name, f] of frames) {
      for (let k = 0; k < 4; k++) expect(f.quat[k], `${name}[${k}]`).toBeCloseTo(qYaw[k]!, 6);
    }
  });

  it('a raised forearm rotates its frame so bind tail lands on the posed tail', () => {
    const fore = body.bones.get('forearm.r')!;
    const rest = bound.rig.restPose;
    const iH = rest.findIndex(p => near(p, fore.head, 1e-4));
    const iT = rest.findIndex(p => near(p, fore.tail, 1e-4));
    const newTail = add(fore.head, [0, 0, len(sub(fore.tail, fore.head))]); // forearm points +z
    const points = bound.rig.points.map((p, i) => i === iT ? { ...p, pos: newTail } : p);
    const f = boneFrames(body, { ...bound, rig: { ...bound.rig, points } }, 0).get('forearm.r')!;
    expect(near(add(f.pos, qRotate(f.quat, sub(fore.tail, fore.head))), newTail, 1e-6)).toBe(true);
    void iH;
  });

  it('segmentQuat composes yaw first, then the residual', () => {
    const rest: Vec3 = [0, 1, 0];
    const q = segmentQuat(rest, normalize([0, 1, 1]), Math.PI / 2);
    // rest yawed by 90° is still +y; the residual tilts it toward +z.
    expect(near(qRotate(q, rest), normalize([0, 1, 1]), 1e-9)).toBe(true);
  });
});
```

- [ ] **Step 2: Run**: `npx vitest run src/lab/sdf-zombie/rig-frames.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/rig-frames.ts
//
// One RIGID transform per blob bone, derived from the posed verlet rig.
//
// This is what lets anything that is not raymarched flesh ride the rig: the
// skinned kit glTF (kit-overlay.ts poses its bone nodes from these), a held
// prop (held-prop.ts), and — through segmentQuat — the rigid head and torso
// bone passes in rig-bind.ts, which computed the same composition three
// times before this module existed.
//
// A two-point bone has no roll of its own. The rotation is therefore
// composed as the KNOWN body yaw first, then the shortest arc from the
// turned rest direction to the posed direction: the same rule headTransform
// established (a near-vertical segment's bare shortest-arc loses azimuth).
//
// Pure. No THREE. Rig points are world space, so frames are world space.
import type { BuildResult } from './build-body';
import type { BoundRig } from './rig-bind';
import type { Vec3 } from './types';
import { rotateYaw } from './gait';
import {
  len, normalize, qFromAxisAngle, qFromTo, qIdentity, qMul, sub, type Quat,
} from './vec';

export interface BoneFrame3 {
  /** The bone's head, world. */
  pos: Vec3;
  /** Bind → posed rotation (world), [x, y, z, w]. */
  quat: Quat;
}

/**
 * Yaw-first segment rotation: qMul(qFromTo(rotateYaw(restDir, yaw), dir), qYaw).
 * At rest (dir == restDir, yaw 0) this is the exact identity.
 */
export function segmentQuat(restDir: Vec3, dir: Vec3, bodyYaw: number): Quat {
  const rest = bodyYaw === 0 ? restDir : rotateYaw(restDir, bodyYaw);
  const qYaw = bodyYaw === 0 ? qIdentity() : qFromAxisAngle([0, 1, 0], bodyYaw);
  return qMul(qFromTo(rest, dir), qYaw);
}

const KEY_EPS = 1e-4;

/**
 * Frames for every bone in `body.bones`, keyed by bone name. Each bone's
 * head and tail are looked up in the rig's REST pose (bindRig dedups rig
 * points by position, so a bone end is found by position, not index) and
 * the same indices read the CURRENT points.
 */
export function boneFrames(body: BuildResult, bound: BoundRig, bodyYaw: number): Map<string, BoneFrame3> {
  const rest = bound.rig.restPose;
  const pts = bound.rig.points;
  const indexAt = (p: Vec3): number => {
    for (let i = 0; i < rest.length; i++) if (len(sub(rest[i]!, p)) < KEY_EPS) return i;
    return -1;
  };
  const out = new Map<string, BoneFrame3>();
  for (const [name, bone] of body.bones) {
    const iH = indexAt(bone.head), iT = indexAt(bone.tail);
    if (iH < 0 || iT < 0 || iH === iT) continue;
    const head = pts[iH]!.pos, tail = pts[iT]!.pos;
    const restDir = normalize(sub(bone.tail, bone.head));
    const dir = normalize(sub(tail, head));
    out.set(name, { pos: [head[0], head[1], head[2]], quat: segmentQuat(restDir, dir, bodyYaw) });
  }
  return out;
}
```

`indexAt` compares against `restPose`, which `bindRig` sets to the bind positions. This test file's first case exercises that; the rig-bind `restPose` field is the authored pose.

- [ ] **Step 4: Make rig-bind the caller** — in `rig-bind.ts` import `segmentQuat` from `./rig-frames` and replace the three compositions:

```ts
// applyRig poseEnds:
      const q = segmentQuat(frame.restDir, dir, bodyYaw);
// applyRig boneFrames branch:
      const q = segmentQuat(frame.restDir, dir, bodyYaw);
// headTransform: keep the clamp, then
  const q = segmentQuat(h.restDir, clamped, bodyYaw);
// headQuatOf:
  return segmentQuat(h.restDir, clamped, bodyYaw);
```

Delete the now-unused `rest`/`qYaw` locals at each site (keep `rest` where `clampDir` needs it — compute it once, as before). rig-frames imports the `BoundRig` TYPE only from rig-bind, so there is no runtime cycle.

- [ ] **Step 5: Run everything that poses**: `npx vitest run src/lab/sdf-zombie/rig-frames.test.ts src/lab/sdf-zombie/rig-bind.test.ts src/lab/sdf-zombie/rig-bind-bones.test.ts src/lab/sdf-zombie/facing-chain.test.ts src/lab/sdf-zombie/gait-pins.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/rig-frames.ts src/lab/sdf-zombie/rig-frames.test.ts src/lab/sdf-zombie/rig-bind.ts
git commit -m "rig-frames: one rigid transform per bone from the posed rig; rig-bind's three yaw-first compositions call it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Gait profiles (shamble / march / run), blend, torso lean

**Files:**
- Modify: `src/lab/sdf-zombie/gait.ts` (`GAIT_TUNING` ~54-160, `stepGait` signature ~290, pose type ~210)
- Test: `src/lab/sdf-zombie/gait.test.ts` (append)

- [ ] **Step 1: Failing tests**

```ts
describe('gait profiles', () => {
  it('SHAMBLE is GAIT_TUNING by identity and the default', () => {
    expect(SHAMBLE).toBe(GAIT_TUNING);
    const a = stepGait(makeGaitState(1), NONE, 0.1, 'swing').pose;
    const b = stepGait(makeGaitState(1), NONE, 0.1, 'swing', SHAMBLE).pose;
    expect(b).toEqual(a);
  });
  it('run lifts the foot higher and strides longer than march', () => {
    const lift = (p: GaitProfile) => {
      let st = makeGaitState(5); let best = 0; let reach = 0;
      for (let i = 0; i < 240; i++) {
        const s = stepGait(st, NONE, 1 / 240, 'swing', p); st = s.state;
        best = Math.max(best, s.pose.offsets.footL[1]); reach = Math.max(reach, s.pose.offsets.footL[2]);
      }
      return { best, reach };
    };
    expect(lift(RUN).best).toBeGreaterThan(lift(MARCH).best);
    expect(lift(RUN).reach).toBeGreaterThan(lift(MARCH).reach);
  });
  it('blendProfiles lerps scalars and snaps armStyle at 0.5', () => {
    const half = blendProfiles(MARCH, RUN, 0.5);
    expect(half.strideLen).toBeCloseTo((MARCH.strideLen + RUN.strideLen) / 2, 9);
    expect(blendProfiles(MARCH, RUN, 0.49).armStyle).toBe(MARCH.armStyle);
    expect(blendProfiles(MARCH, RUN, 0.5).armStyle).toBe(RUN.armStyle);
    expect(blendProfiles(MARCH, RUN, 0).torsoLean).toBe(0);
    expect(blendProfiles(MARCH, RUN, 1).torsoLean).toBe(RUN.torsoLean);
  });
  it('the pose reports the profile lean; shamble reports 0', () => {
    expect(stepGait(makeGaitState(1), NONE, 0.1, 'swing').pose.lean).toBe(0);
    expect(stepGait(makeGaitState(1), NONE, 0.1, 'swing', RUN).pose.lean).toBeCloseTo(RUN.torsoLean * Math.PI / 180, 9);
  });
});
```

Add `SHAMBLE, MARCH, RUN, blendProfiles, type GaitProfile` to the `./gait` import at the top of the test.

- [ ] **Step 2: Run** `npx vitest run src/lab/sdf-zombie/gait.test.ts -t "gait profiles"` → FAIL.

- [ ] **Step 3: Implement** in `gait.ts`.

Change the `GAIT_TUNING` declaration so it has a name and one new knob (add `torsoLean` after `armStyle`; keep every existing value verbatim):

```ts
/** A GAIT PROFILE — every knob of one way of walking. The zombie's numbers
 *  are `SHAMBLE` (=== GAIT_TUNING, the historical name, kept for every
 *  caller and test that reads it). Other characters get their own. */
export const GAIT_TUNING = {
  /** Profile name, for readouts. */
  name: 'shamble',
  ... every existing knob, unchanged ...
  armStyle: 'reach' as ArmStyle,
  /** Forward pitch of the whole upper body about the hips (degrees). The
   *  motion layer rotates every joint above the hips by this — a rotation
   *  of targets, never a displacement (the reach-pose lesson). */
  torsoLean: 0,
  ... rest unchanged ...
} as const;

export type GaitProfile = {
  -readonly [K in keyof typeof GAIT_TUNING]: (typeof GAIT_TUNING)[K] extends number ? number
    : (typeof GAIT_TUNING)[K] extends string ? string : (typeof GAIT_TUNING)[K];
} & { armStyle: ArmStyle };

export const SHAMBLE: GaitProfile = GAIT_TUNING as unknown as GaitProfile;

/** An upright patrol walk: gun carried low, short quiet steps. */
export const MARCH: GaitProfile = {
  ...SHAMBLE,
  name: 'march',
  strideFreq: 1.6,
  strideLen: 0.45,
  footLift: 0.10,
  footPush: 0.06,
  stanceDuty: 0.58,
  bobAmp: 0.02,
  rockAmp: 0.01,
  swayAmp: 0.03,
  shoulderSway: 0.35,
  armSwing: 0.06,
  asymJitter: 0.08,
  armStyle: 'carry',
  torsoLean: 0,
};

/** A run: long stride, real foot lift, a flight phase in the bob, a lean. */
export const RUN: GaitProfile = {
  ...SHAMBLE,
  name: 'run',
  strideFreq: 2.4,
  strideLen: 0.75,
  footLift: 0.22,
  footPush: 0.10,
  stanceDuty: 0.45,
  kneeBend: 0.12,
  bobAmp: 0.04,
  rockAmp: 0.02,
  swayAmp: 0.03,
  shoulderSway: 0.5,
  armSwing: 0.10,
  asymJitter: 0.06,
  armStyle: 'carry',
  torsoLean: 12,
};

/** Lerp every numeric knob; strings (name, armStyle) snap at w = 0.5 so the
 *  hands never hover between two grips. */
export function blendProfiles(a: GaitProfile, b: GaitProfile, w: number): GaitProfile {
  const t = w < 0 ? 0 : w > 1 ? 1 : w;
  if (t === 0) return a;
  if (t === 1) return b;
  const out = { ...(t < 0.5 ? a : b) } as Record<string, unknown>;
  for (const k of Object.keys(a) as (keyof GaitProfile)[]) {
    const av = a[k], bv = b[k];
    if (typeof av === 'number' && typeof bv === 'number') out[k] = av + (bv - av) * t;
  }
  return out as GaitProfile;
}
```

Add `'carry'` to `ArmStyle`: `export type ArmStyle = 'swing' | 'reach' | 'carry';`

`stepGait` gains a fifth parameter and uses it as `T`:

```ts
export function stepGait(
  state: GaitState, skew: GaitSkew, dt: number,
  armStyle: ArmStyle = GAIT_TUNING.armStyle,
  profile: GaitProfile = SHAMBLE,
): GaitStep {
  const time = state.time + Math.max(dt, 0);
  const s = state.seed;
  const T = profile;
```

Because `SHAMBLE === GAIT_TUNING`, every existing arithmetic reads the same numbers: the pins stay green.

In the `arm` closure, the `'carry'` style behaves like `'reach'` (no offsets — the motion layer owns the arm): change `if (armStyle === 'reach') return { elbow: Z, hand: Z };` to `if (armStyle !== 'swing') return { elbow: Z, hand: Z };`. In `shoulder`, `reachLift` stays reach-only.

Add to `GaitPose`: `/** Upper-body forward lean (rad), from the profile's torsoLean. */ lean: number;` and set `lean: T.torsoLean * Math.PI / 180` in the returned pose.

- [ ] **Step 4: Run** `npx vitest run src/lab/sdf-zombie/gait.test.ts src/lab/sdf-zombie/gait-pins.test.ts && npx tsc --noEmit` → PASS. (The pin test does not read `pose.lean`, so adding the field is pin-safe.)

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/gait.ts src/lab/sdf-zombie/gait.test.ts
git commit -m "gait: profiles — SHAMBLE (the zombie, unchanged), MARCH, RUN, blendProfiles, torsoLean, carry arm style

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: carry.ts — the carry table, gun grip spec, arm pivot and gun pose maths

**Files:**
- Create: `src/lab/sdf-zombie/carry.ts`, `src/lab/sdf-zombie/carry.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// src/lab/sdf-zombie/carry.test.ts
import { describe, it, expect } from 'vitest';
import {
  CARRIES, GUN_GRIP, armPivot, gunPoseFromArm, lookQuat, gunPoint,
} from './carry';
import { add, len, normalize, qRotate, sub } from './vec';
import type { Vec3 } from './types';

const near = (a: Vec3, b: Vec3, eps = 1e-6) => len(sub(a, b)) < eps;

describe('carry maths', () => {
  it('lookQuat maps +z onto fwd and keeps +x near the requested right', () => {
    const fwd = normalize([0, 0.3, 1]);
    const q = lookQuat(fwd, [0, 1, 0]);
    expect(near(qRotate(q, [0, 0, 1]), fwd, 1e-9)).toBe(true);
    const x = qRotate(q, [1, 0, 0]);
    expect(x[1]).toBeCloseTo(0, 9); // no roll: gun-right stays level
    expect(x[0]).toBeGreaterThan(0.99);
  });

  it('gunPoseFromArm seats Grip_Hand exactly on the hand point', () => {
    const elbow: Vec3 = [-0.2, 1.1, 0], hand: Vec3 = [-0.2, 1.1, 0.24];
    const pose = gunPoseFromArm(elbow, hand, [1, 0, 0], 0);
    expect(near(gunPoint(pose, GUN_GRIP.gripHand), hand, 1e-9)).toBe(true);
    // gunPitch 0: the muzzle points along the forearm
    const m = gunPoint(pose, GUN_GRIP.muzzle);
    expect(near(normalize(sub(m, gunPoint(pose, [0, 0, 0]))), [0, 0, 1], 1e-9)).toBe(true);
  });

  it('positive gunPitch raises the muzzle', () => {
    const elbow: Vec3 = [-0.2, 1.1, 0], hand: Vec3 = [-0.2, 1.1, 0.24];
    const up = gunPoseFromArm(elbow, hand, [1, 0, 0], 0.4);
    expect(gunPoint(up, GUN_GRIP.muzzle)[1]).toBeGreaterThan(gunPoint(up, [0, 0, 0])[1] + 0.1);
  });

  it('armPivot keeps both segment lengths and folds the forearm forward', () => {
    const shoulder: Vec3 = [-0.14, 1.36, 0];
    const s1: Vec3 = [-0.02, -0.26, 0.01], s2: Vec3 = [0, -0.24, 0.03];
    const r = armPivot(shoulder, s1, s2, CARRIES.hip.right, [1, 0, 0], 1, 0);
    expect(len(sub(r.elbow, shoulder))).toBeCloseTo(len(s1), 9);
    expect(len(sub(r.hand, r.elbow))).toBeCloseTo(len(s2), 9);
    expect(r.hand[2]).toBeGreaterThan(r.elbow[2]); // forearm points forward
  });

  it('every carry has a reachable fore-end for a 0.5 m arm from the soldier shoulders', () => {
    const shoulderR: Vec3 = [-0.14, 1.36, 0], shoulderL: Vec3 = [0.14, 1.36, 0];
    const s1: Vec3 = [-0.02, -0.26, 0.01], s2: Vec3 = [0, -0.24, 0.03];
    for (const name of ['low', 'chest', 'hip'] as const) {
      const c = CARRIES[name];
      const r = armPivot(shoulderR, s1, s2, c.right, [1, 0, 0], 1, 0);
      const pose = gunPoseFromArm(r.elbow, r.hand, [1, 0, 0], c.gunPitch);
      const fore = gunPoint(pose, GUN_GRIP.foreHand);
      expect(len(sub(fore, shoulderL)), name).toBeLessThan(0.48);
      expect(len(sub(fore, shoulderL)), name).toBeGreaterThan(0.15);
    }
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lab/sdf-zombie/carry.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/carry.ts
//
// ARM CARRIES — how a character holds a long gun, and where the gun is.
//
// A carry is authored as ROTATIONS of the right arm about its shoulder (a
// shoulder pitch/yaw and an elbow fold), never as hand displacements: both
// segments keep their exact rest lengths, so the verlet constraints are
// satisfiable without dragging the shoulder out of the torso (the reach-pose
// lesson in gait.ts / motion.ts). The gun then rides the right FOREARM
// (elbow→hand) — a 24 cm lever is a steadier frame than the 9.5 cm hand bone
// whose tip is a free verlet point — with its Grip_Hand locator seated on
// the hand point and its muzzle pitched off the forearm by `gunPitch`.
//
// The LEFT hand is not authored at all: the motion layer FABRIK-solves it
// onto the gun's Fore_Hand locator (ik.ts solveChain, lengths preserved
// exactly), with an outward pole so the elbow never folds through the body.
// That is what makes "both hands on the gun" true by construction in every
// carry, and it is what a fourth, shouldered carry will reuse.
//
// Pure. Body-local axes: +x right, +y up, +z forward.
import type { Vec3 } from './types';
import {
  add, cross, dot, normalize, qFromAxisAngle, qMul, qRotate, sub, scale, type Quat,
} from './vec';

export type CarryName = 'low' | 'chest' | 'hip';

/** Right-arm rotations, radians. pitch: forward raise about the body's
 *  right axis (0 = the authored hang). yaw: about +y, positive swings the
 *  hand INWARD toward the midline. fold: extra forward pitch of the
 *  forearm only (the elbow bend). */
export interface CarryArm { pitch: number; yaw: number; fold: number }

export interface CarrySpec {
  right: CarryArm;
  /** Muzzle pitch off the forearm direction (rad, positive = up). */
  gunPitch: number;
  /** Body-local pole for the left elbow's IK (outward and down). */
  leftPole: Vec3;
}

/** Starting numbers for the owner's look, not contracts. */
export const CARRIES: Record<CarryName, CarrySpec> = {
  // Gun hangs at the right hip, muzzle forward-down; the left hand rests
  // loosely on the fore-end.
  low:   { right: { pitch: 0.18, yaw: 0.10, fold: 0.70 }, gunPitch: -0.30, leftPole: [0.5, -0.3, 0.2] },
  // Diagonal across the chest, both hands on it — the run.
  chest: { right: { pitch: 0.60, yaw: 0.40, fold: 1.55 }, gunPitch: 0.55,  leftPole: [0.6, 0.1, 0.1] },
  // Level at the waist along body forward, elbows tucked — the shot.
  hip:   { right: { pitch: 0.32, yaw: 0.05, fold: 1.30 }, gunPitch: -0.05, leftPole: [0.5, -0.3, 0.3] },
};

/** shorty-double.glb locators, gun-local metres, +z = muzzle. Measured from
 *  the glb's node tree (Grip_Hand/Fore_Hand under Frame, Muzzle_L/R under
 *  Barrels, all rotation-free, GunRoot at the origin). */
export const GUN_GRIP = {
  gripHand: [0, -0.074, -0.074] as Vec3,
  foreHand: [0, -0.045, 0.155] as Vec3,
  /** Midpoint of Muzzle_L / Muzzle_R. */
  muzzle: [0, 0, 0.318] as Vec3,
} as const;

export interface GunPose { root: Vec3; quat: Quat }

/**
 * Rotation taking gun-local +z onto `fwd` with gun-local +x kept as close
 * as possible to `cross(up, fwd)` — i.e. no roll about the barrel.
 */
export function lookQuat(fwd: Vec3, up: Vec3): Quat {
  const f = normalize(fwd);
  const qArc = ((): Quat => {
    // shortest arc +z → f (inline qFromTo to avoid a circular-feeling import)
    const d = Math.max(-1, Math.min(1, f[2]));
    if (d >= 1 - 1e-9) return [0, 0, 0, 1];
    if (d <= -1 + 1e-9) return qFromAxisAngle([0, 1, 0], Math.PI);
    return qFromAxisAngle(normalize(cross([0, 0, 1], f)), Math.acos(d));
  })();
  const x0 = qRotate(qArc, [1, 0, 0]);
  let xd = cross(up, f);
  if (dot(xd, xd) < 1e-12) return qArc; // looking straight up/down: any roll
  xd = normalize(xd);
  const ang = Math.atan2(dot(cross(x0, xd), f), dot(x0, xd));
  return qMul(qFromAxisAngle(f, ang), qArc);
}

/** The gun's world pose from the right forearm: Grip_Hand on `hand`, muzzle
 *  along elbow→hand pitched by `gunPitch` about `bodyRight`. */
export function gunPoseFromArm(elbow: Vec3, hand: Vec3, bodyRight: Vec3, gunPitch: number): GunPose {
  const fwd0 = normalize(sub(hand, elbow));
  const fwd = gunPitch === 0 ? fwd0 : qRotate(qFromAxisAngle(bodyRight, -gunPitch), fwd0);
  const quat = lookQuat(fwd, [0, 1, 0]);
  const root = sub(hand, qRotate(quat, GUN_GRIP.gripHand));
  return { root, quat };
}

/** A gun-local point in world. */
export function gunPoint(pose: GunPose, local: Vec3): Vec3 {
  return add(pose.root, qRotate(pose.quat, local));
}

/**
 * Pivots one arm about its shoulder. `s1`/`s2` are the REST segment vectors
 * (shoulder→elbow, elbow→hand) already rotated into world by the body yaw;
 * `bodyRight` is the body's world right axis; `inward` is +1 or −1 — the
 * sign that turns "toward the midline" into a rotation about +y for this
 * side (the caller derives it from the shoulder's x relative to the pelvis).
 * `presence` scales every angle (the gait blend floor).
 */
export function armPivot(
  shoulder: Vec3, s1: Vec3, s2: Vec3, arm: CarryArm, bodyRight: Vec3, inward: number, presence: number,
): { elbow: Vec3; hand: Vec3 } {
  const p = arm.pitch * presence, y = arm.yaw * presence * inward, f = arm.fold * presence;
  // Positive pitch = forward: about +right the hang swings BACK, so negate
  // (same convention as the reach pivot in motion.ts).
  const qYaw = qFromAxisAngle([0, 1, 0], y);
  const qUpper = qMul(qYaw, qFromAxisAngle(bodyRight, -p));
  const qFore = qMul(qYaw, qFromAxisAngle(bodyRight, -(p + f)));
  const elbow = add(shoulder, qRotate(qUpper, s1));
  const hand = add(elbow, qRotate(qFore, s2));
  return { elbow, hand };
}

/** Muzzle-rise after a shot: an extra gun pitch (rad) decaying from the
 *  fire instant. Pure in `age` so the prop can pose without state. */
export const MUZZLE_RISE = { peak: 0.35, decay: 0.12 } as const;
export function muzzleRise(age: number): number {
  if (age < 0) return 0;
  return MUZZLE_RISE.peak * Math.exp(-age / MUZZLE_RISE.decay);
}

export { scale as _scaleReexportForTests };
```

Remove the last export line before committing (it exists only to keep the unused-import lint quiet while you iterate; delete `scale` from the import instead).

- [ ] **Step 4: Run** `npx vitest run src/lab/sdf-zombie/carry.test.ts && npx tsc --noEmit` → PASS. If the reachability test fails for a carry, adjust that carry's `right` angles (not the test bounds) until the fore-end sits 0.15–0.48 m from the left shoulder.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/carry.ts src/lab/sdf-zombie/carry.test.ts
git commit -m "carry: the carry table, shorty grip spec, arm pivot and gun pose maths

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: motion-profile.ts and a per-character wander cruise

**Files:**
- Create: `src/lab/sdf-zombie/motion-profile.ts`, `src/lab/sdf-zombie/motion-profile.test.ts`
- Modify: `src/lab/sdf-zombie/wander.ts` (`stepWander` ~113)
- Test: `src/lab/sdf-zombie/wander.test.ts` (append)

- [ ] **Step 1: Failing tests**

```ts
// src/lab/sdf-zombie/motion-profile.test.ts
import { describe, it, expect } from 'vitest';
import { motionProfileFor, ZOMBIE_PROFILE, SOLDIER_PROFILE, runWeight } from './motion-profile';
import { SHAMBLE, MARCH, RUN } from './gait';
import { WANDER_TUNING } from './wander';

describe('motion profiles', () => {
  it('unknown characters and the zombie get the zombie profile (shamble, reach, stock cruise)', () => {
    expect(motionProfileFor('zombie')).toBe(ZOMBIE_PROFILE);
    expect(motionProfileFor('clown')).toBe(ZOMBIE_PROFILE);
    expect(ZOMBIE_PROFILE.gait.walk).toBe(SHAMBLE);
    expect(ZOMBIE_PROFILE.gait.run).toBe(SHAMBLE);
    expect(ZOMBIE_PROFILE.cruise).toBe(WANDER_TUNING.speed);
    expect(ZOMBIE_PROFILE.carries).toBeUndefined();
  });
  it('soldier: march/run, carries, a prop, a faster cruise', () => {
    const p = motionProfileFor('soldier');
    expect(p).toBe(SOLDIER_PROFILE);
    expect(p.gait.walk).toBe(MARCH);
    expect(p.gait.run).toBe(RUN);
    expect(p.carries).toEqual({ walk: 'low', run: 'chest', fire: 'hip' });
    expect(p.prop?.url).toBe('/assets/lab/shorty-double.glb');
    expect(p.cruise).toBeGreaterThan(WANDER_TUNING.speed);
  });
  it('runWeight: 0 below the band, 1 above, linear between', () => {
    const b = SOLDIER_PROFILE.runBand;
    expect(runWeight(SOLDIER_PROFILE, b.from - 0.1)).toBe(0);
    expect(runWeight(SOLDIER_PROFILE, b.to + 0.1)).toBe(1);
    expect(runWeight(SOLDIER_PROFILE, (b.from + b.to) / 2)).toBeCloseTo(0.5, 9);
    expect(runWeight(ZOMBIE_PROFILE, 99)).toBe(0);
  });
});
```

Append to `wander.test.ts`:

```ts
describe('stepWander cruise override', () => {
  it('a higher cruise reaches a higher speed on a long leg', () => {
    const bounds = { minX: -8, maxX: 8, minZ: -8, maxZ: 8 };
    const go = (cruise?: number) => {
      let st = { pos: [-7, 0, -7] as Vec3, heading: 0, speed: 0, target: [7, 0, 7] as Vec3, idle: 0 };
      let top = 0;
      for (let i = 0; i < 120; i++) { st = stepWander(st, makeRng(1), 1 / 60, bounds, cruise); top = Math.max(top, st.speed); }
      return top;
    };
    expect(go()).toBeCloseTo(go(WANDER_TUNING.speed), 12);
    expect(go(3.4)).toBeGreaterThan(go() * 2);
  });
});
```

(Check the file's existing imports include `stepWander`, `makeRng`, `WANDER_TUNING`, `Vec3`; add any missing.)

- [ ] **Step 2: Run** both → FAIL.

- [ ] **Step 3: Implement**

`wander.ts`: add the parameter and use it for cruise:

```ts
export function stepWander(
  state: WanderState,
  rng: Rng,
  dt: number,
  bounds: WanderBounds,
  /** Cruise speed (m/s). Defaults to WANDER_TUNING.speed — the zombie. */
  cruiseSpeed: number = WANDER_TUNING.speed,
): WanderState {
  ...
  const cruise = cruiseSpeed * Math.min(1, dist / T.brakeDist);
```

`motion-profile.ts`:

```ts
// src/lab/sdf-zombie/motion-profile.ts
//
// Per-character MOTION PROFILE: which gait(s) a body walks with, how fast it
// wanders, how it carries a weapon. Selected by character name by the lab
// (and, later, by the game's spawn table). Pure data; THREE-free — the prop
// is a URL and a grip spec, the view loads it.
import { SHAMBLE, MARCH, RUN, type ArmStyle, type GaitProfile } from './gait';
import type { CarryName } from './carry';
import { WANDER_TUNING } from './wander';

export interface MotionProfile {
  name: string;
  /** walk and run gaits. A single-gait character passes the same profile
   *  twice and runWeight is 0 everywhere. */
  gait: { walk: GaitProfile; run: GaitProfile };
  /** Wander speed band (m/s) over which walk blends to run. */
  runBand: { from: number; to: number };
  /** Wander cruise speed (m/s). */
  cruise: number;
  /** Arm style when the gait profile does not say 'carry'. */
  armStyle: ArmStyle;
  /** Which carry each locomotion state uses; absent = no held weapon. */
  carries?: { walk: CarryName; run: CarryName; fire: CarryName };
  /** The held prop, if any. */
  prop?: { url: string };
}

export const ZOMBIE_PROFILE: MotionProfile = {
  name: 'zombie',
  gait: { walk: SHAMBLE, run: SHAMBLE },
  runBand: { from: Infinity, to: Infinity },
  cruise: WANDER_TUNING.speed,
  armStyle: 'reach',
};

export const SOLDIER_PROFILE: MotionProfile = {
  name: 'soldier',
  gait: { walk: MARCH, run: RUN },
  runBand: { from: 1.6, to: 3.0 },
  cruise: 3.4,
  armStyle: 'carry',
  carries: { walk: 'low', run: 'chest', fire: 'hip' },
  prop: { url: '/assets/lab/shorty-double.glb' },
};

const BY_NAME: Record<string, MotionProfile> = {
  zombie: ZOMBIE_PROFILE,
  soldier: SOLDIER_PROFILE,
};

/** The profile for a character name; anything unlisted moves like the zombie. */
export function motionProfileFor(character: string): MotionProfile {
  return BY_NAME[character] ?? ZOMBIE_PROFILE;
}

/** walk→run blend weight in [0,1] for a wander speed. */
export function runWeight(p: MotionProfile, speed: number): number {
  const { from, to } = p.runBand;
  if (!(speed > from)) return 0;
  if (speed >= to) return 1;
  return (speed - from) / (to - from);
}
```

- [ ] **Step 4: Run** `npx vitest run src/lab/sdf-zombie/motion-profile.test.ts src/lab/sdf-zombie/wander.test.ts src/lab/sdf-zombie/gait-pins.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/motion-profile.ts src/lab/sdf-zombie/motion-profile.test.ts src/lab/sdf-zombie/wander.ts src/lab/sdf-zombie/wander.test.ts
git commit -m "motion-profile: per-character gait pair, run band, cruise, carries, prop; stepWander takes a cruise

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: motion.ts — profile blend, lean, carry arms with left-hand IK, tip/toe follow

**Files:**
- Modify: `src/lab/sdf-zombie/motion.ts` (`MotionConfig` ~301, `stepMotion` ~410-700)
- Test: `src/lab/sdf-zombie/motion.test.ts` (append)

- [ ] **Step 1: Failing tests** (append to `motion.test.ts`; add imports: `compileBlob`, `parseBlob`, `soldierSrc`, `SOLDIER_PROFILE` from `./motion-profile`, `CARRIES, GUN_GRIP, gunPoseFromArm, gunPoint` from `./carry`, `RUN` from `./gait`, `add`, `normalize`, `rotateYaw` from `./gait`)

```ts
function soldierJoints(): MotionJoints {
  const body = buildBody(compileBlob(parseBlob(soldierSrc)));
  const bound = bindRig(body);
  const j = makeMotionJoints(body, bound.rig.restPose);
  if (!j) throw new Error('soldier has no motion joints');
  return j;
}

describe('soldier motion — profile, lean, carry', () => {
  const CFG: MotionConfig = { enabled: true, wander: false, profile: SOLDIER_PROFILE, forceSpeed: 3.4 };

  it('forceSpeed drives the blend and the run weight without wander', () => {
    const j = soldierJoints();
    const { frame, state } = run(j, makeMotionState(3, [0, 0, 0]), CFG, 120);
    expect(frame.blend).toBeCloseTo(1, 3);
    expect(state.runWeight).toBe(1);
    expect(frame.gaitName).toBe('run');
    const walk = run(j, makeMotionState(3, [0, 0, 0]), { ...CFG, forceSpeed: 1.0 }, 120);
    expect(walk.state.runWeight).toBe(0);
    expect(walk.frame.gaitName).toBe('march');
  });

  it('the run lean pitches the head forward of the hips by ~sin(12°)·height', () => {
    const j = soldierJoints();
    const { frame } = run(j, makeMotionState(3, [0, 0, 0]), CFG, 90);
    const hips = frame.restPose[j.index.hips]!, head = frame.restPose[j.index.head]!;
    const dz = head[2] - hips[2];
    const rise = head[1] - hips[1];
    const expected = Math.sin(RUN.torsoLean * Math.PI / 180) * Math.hypot(rise, dz);
    expect(dz).toBeGreaterThan(expected * 0.6);
    expect(dz).toBeLessThan(expected * 1.6);
  });

  it('carry: the left hand lands on the gun fore-end; no arm segment stretches', () => {
    const j = soldierJoints();
    const cfg: MotionConfig = { enabled: true, wander: false, profile: SOLDIER_PROFILE, forceSpeed: 0, carryOverride: 'hip' };
    const { frame } = run(j, makeMotionState(3, [0, 0, 0]), cfg, 30);
    const P = frame.restPose;
    const right = rotateYaw([1, 0, 0], frame.bodyYaw);
    const gun = gunPoseFromArm(P[j.index.elbowR]!, P[j.index.handR]!, right, CARRIES.hip.gunPitch);
    const fore = gunPoint(gun, GUN_GRIP.foreHand);
    expect(len(sub(P[j.index.handL]!, fore))).toBeLessThan(0.02);
    for (const [s, e, h, lens] of [
      ['shoulderL', 'elbowL', 'handL', j.arm.L], ['shoulderR', 'elbowR', 'handR', j.arm.R],
    ] as const) {
      expect(len(sub(P[j.index[e]]!, P[j.index[s]]!))).toBeLessThan(lens[0] * 1.01);
      expect(len(sub(P[j.index[h]]!, P[j.index[e]]!))).toBeLessThan(lens[1] * 1.01);
    }
    expect(frame.gun).not.toBeNull();
    expect(len(sub(frame.gun!.root, gun.root))).toBeLessThan(1e-9);
  });

  it('hand tips and toes follow their parents', () => {
    const j = soldierJoints();
    const { frame } = run(j, makeMotionState(3, [0, 0, 0]), CFG, 45);
    const P = frame.restPose;
    const restTip = sub(j.base[j.index.handTipR]!, j.base[j.index.handR]!);
    expect(len(sub(P[j.index.handTipR]!, P[j.index.handR]!))).toBeCloseTo(len(restTip), 6);
    const restToe = sub(j.base[j.index.toeL]!, j.base[j.index.footL]!);
    expect(len(sub(P[j.index.toeL]!, P[j.index.footL]!))).toBeCloseTo(len(restToe), 6);
  });

  it('the zombie with no profile is unchanged (pins cover the numbers; this covers the fields)', () => {
    const j = realJoints();
    const { frame, state } = run(j, makeMotionState(3, [0, 0, 0]), CFG_ON, 10);
    expect(frame.gun).toBeNull();
    expect(frame.gaitName).toBe('shamble');
    expect(state.runWeight).toBe(0);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lab/sdf-zombie/motion.test.ts -t "soldier motion"` → FAIL.

- [ ] **Step 3: Implement in `motion.ts`**

Imports to add:

```ts
import { blendProfiles, SHAMBLE, type GaitProfile } from './gait';
import { motionProfileFor, runWeight, ZOMBIE_PROFILE, type MotionProfile } from './motion-profile';
import { armPivot, CARRIES, GUN_GRIP, gunPoseFromArm, gunPoint, type CarryName, type GunPose } from './carry';
import { solveChain, poleReflect } from './ik';
```

`MotionConfig` additions:

```ts
  /** Per-character profile. Absent = the zombie's (shamble/reach, stock cruise). */
  profile?: MotionProfile;
  /** Treadmill: use this speed (m/s) for the gait blend and run weight
   *  instead of the wander speed, with the body standing still. For the
   *  lab's pose captures. */
  forceSpeed?: number;
  /** Hold this carry regardless of gait/fire state (lab captures). */
  carryOverride?: CarryName;
```

`MotionState` additions (and in `makeMotionState`):

```ts
  /** walk→run blend weight last frame (diagnostic + hysteresis-free). */
  runWeight: number;
  /** Fire hold: seconds left holding the fire carry; 0 = none. */
  fireHold: number;
  /** Seconds since the last shot (Infinity before the first). */
  sinceFire: number;
```
Initialise: `runWeight: 0, fireHold: 0, sinceFire: Infinity`.

`MotionFrame` additions:

```ts
  /** The active gait profile's name ('shamble' | 'march' | 'run'). */
  gaitName: string;
  /** The held gun's pose this frame, world; null when the profile has no carries. */
  gun: GunPose | null;
  /** World-space point shoves for the wiring to apply with impulseAt this frame. */
  kicks: { joint: GaitJointName; delta: Vec3 }[];
```

In `stepMotion`, after `const dt = ...`:

```ts
  const profile = cfg.profile ?? ZOMBIE_PROFILE;
```

Replace the wander step so it passes the cruise:

```ts
  if (!collapsed && cfg.wander) wander = stepWander(wander, rng, dt, bounds, profile.cruise);
```

Replace the blend computation:

```ts
  const speedForBlend = cfg.forceSpeed !== undefined ? cfg.forceSpeed : (cfg.wander ? wander.speed : 0);
  const wantBlend = !collapsed && (cfg.wander || cfg.forceSpeed !== undefined)
    ? clamp(speedForBlend / (profile.cruise * MOTION_TUNING.fullStrideAt), 0, 1)
    : 0;
  const blend = clamp(
    state.blend + clamp(wantBlend - state.blend, -MOTION_TUNING.blendRate * dt, MOTION_TUNING.blendRate * dt),
    0, 1,
  );
  const rw = collapsed ? 0 : runWeight(profile, speedForBlend);
  const gaitProfile = profile.gait.walk === profile.gait.run
    ? profile.gait.walk : blendProfiles(profile.gait.walk, profile.gait.run, rw);
```

Note: for the zombie `profile.cruise === WANDER_TUNING.speed`, `forceSpeed` is undefined and `gaitProfile === SHAMBLE`, so the arithmetic is unchanged (pins).

Replace the gait call:

```ts
  const armStyle = cfg.armStyle ?? (gaitProfile.armStyle === 'carry' ? 'carry' : profile.armStyle === 'carry' ? gaitProfile.armStyle : (cfg.profile ? profile.armStyle : GAIT_TUNING.armStyle));
```

That expression is unreadable; write it as a helper above `stepMotion` and call it:

```ts
/** Arm style for this frame: an explicit config wins; else the blended gait
 *  profile's style; else (no profile at all) the historical default. */
function pickArmStyle(cfg: MotionConfig, gaitProfile: GaitProfile): ArmStyle {
  if (cfg.armStyle) return cfg.armStyle;
  if (cfg.profile) return gaitProfile.armStyle;
  return GAIT_TUNING.armStyle;
}
...
  const armStyle = pickArmStyle(cfg, gaitProfile);
  const gait = stepGait(
    { time: state.gait.time + stagger.phaseKnock, seed: state.gait.seed },
    skew, dt, armStyle, gaitProfile,
  );
```

`armPresence`: `'carry'` keeps the reach floor too (a standing soldier keeps holding his gun):

```ts
  const armPresence = armStyle === 'reach' || armStyle === 'carry'
    ? Math.max(blend, MOTION_TUNING.reachMinPresence)
    : blend;
```

**Torso lean** — insert right after the `targets` array is built and BEFORE the reach block:

```ts
  // --- torso lean (profiles) ------------------------------------------------
  // The whole upper body pitches forward about the hips joint: a ROTATION of
  // targets, so no segment length changes. Zero for the shamble — the branch
  // is skipped entirely so the zombie's arithmetic is untouched.
  if (gait.pose.lean !== 0 && !collapsed && idx.hips !== undefined) {
    const pivotP = targets[idx.hips]!;
    const right = rotateYaw([1, 0, 0], bodyYaw);
    const qLean = qFromAxisAngle(right, -gait.pose.lean * blend);
    const hipsY = joints.base[idx.hips]![1];
    joints.names.forEach((name, i) => {
      if (name === 'pelvis' || name === 'hips') return;
      if (joints.base[i]![1] <= hipsY) return; // legs stay under the body
      targets[i] = add(pivotP, qRotate(qLean, sub(targets[i]!, pivotP)));
    });
  }
```

**Record pre-override hand/foot targets** (right before the reach block):

```ts
  const before = {
    handL: idx.handL !== undefined ? targets[idx.handL]! : null,
    handR: idx.handR !== undefined ? targets[idx.handR]! : null,
    footL: idx.footL !== undefined ? targets[idx.footL]! : null,
    footR: idx.footR !== undefined ? targets[idx.footR]! : null,
  };
```

**Carry block** — after the reach block (leave the reach block byte-for-byte as it is):

```ts
  // --- carry-style arms: the right arm authored, the left hand IK'd -------
  let gun: GunPose | null = null;
  const carries = profile.carries;
  if (armStyle === 'carry' && carries && !collapsed) {
    const carryName: CarryName = cfg.carryOverride
      ?? (state.fireHold > 0 ? carries.fire : (rw >= 0.5 ? carries.run : carries.walk));
    const carry = CARRIES[carryName];
    const right = rotateYaw([1, 0, 0], bodyYaw);
    const pelvisX = joints.base[idx.pelvis!]![0];
    const restSeg = (a: GaitJointName, b: GaitJointName) =>
      rotateYaw(sub(joints.base[idx[b]!]!, joints.base[idx[a]!]!), bodyYaw);
    // Right arm: rotations about the shoulder target (sway/stagger/lean ride it).
    if (!sig.missing.armR) {
      const iS = idx.shoulderR!, iE = idx.elbowR!, iH = idx.handR!;
      const inward = joints.base[iS]![0] < pelvisX ? 1 : -1;
      const r = armPivot(targets[iS]!, restSeg('shoulderR', 'elbowR'), restSeg('elbowR', 'handR'),
        carry.right, right, inward, armPresence);
      targets[iE] = add(r.elbow, rotateYaw(stagger.offsets.elbowR ?? Z, bodyYaw));
      targets[iH] = add(r.hand, rotateYaw(stagger.offsets.handR ?? Z, bodyYaw));
      gun = gunPoseFromArm(targets[iE]!, targets[iH]!, right, carry.gunPitch);
    }
    // Left arm: FABRIK onto the fore-end, elbow poled outward.
    if (gun && !sig.missing.armL) {
      const iS = idx.shoulderL!, iE = idx.elbowL!, iH = idx.handL!;
      const target = gunPoint(gun, GUN_GRIP.foreHand);
      const chain = solveChain([targets[iS]!, targets[iE]!, targets[iH]!], joints.arm.L, target, SOLVE);
      const pole = rotateYaw(carry.leftPole, bodyYaw);
      const elbow = poleReflect(chain[0]!, chain[1]!, chain[2]!, pole);
      targets[iE] = add(elbow, rotateYaw(stagger.offsets.elbowL ?? Z, bodyYaw));
      targets[iH] = add(chain[2]!, rotateYaw(stagger.offsets.handL ?? Z, bodyYaw));
    }
  }
```

**Tip/toe follow** — after the plant IK block (feet) and after the carry block (hands), add one generic pass placed right before the head-aim block:

```ts
  // --- secondary points follow their parents --------------------------------
  // Hand tips and toes are rigid with the hand/foot: whatever the arm and
  // plant overrides did to the parent, the child moves by the same delta.
  const follow = (child: GaitJointName, parent: GaitJointName, was: Vec3 | null) => {
    const ic = idx[child], ip = idx[parent];
    if (ic === undefined || ip === undefined || !was) return;
    targets[ic] = add(targets[ic]!, sub(targets[ip]!, was));
  };
  follow('handTipL', 'handL', before.handL);
  follow('handTipR', 'handR', before.handR);
  follow('toeL', 'footL', before.footL);
  follow('toeR', 'footR', before.footR);
```

Zombie safety: `idx.handTipL` etc. are undefined → early return → no arithmetic.

`nextState` gains `runWeight: rw, fireHold: state.fireHold, sinceFire: state.sinceFire` (Task 9 makes them move). The returned frame gains `gaitName: gaitProfile.name, gun, kicks: []`.

- [ ] **Step 4: Run** `npx vitest run src/lab/sdf-zombie/motion.test.ts src/lab/sdf-zombie/gait-pins.test.ts src/lab/sdf-zombie/actor.test.ts && npx tsc --noEmit` → PASS. The `run()` helper in the test file steps stub points that follow the previous targets, so the IK is evaluated against converged targets after 30 frames.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/motion.ts src/lab/sdf-zombie/motion.test.ts
git commit -m "motion: per-character profile blend, torso lean, carry arms with left-hand IK, gun pose, tip/toe follow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The fire signal — hip carry hold, stride cut, kicks; actor applies kicks

**Files:**
- Modify: `src/lab/sdf-zombie/motion.ts` (`MotionSignals`, the carry block, `nextState`)
- Modify: `src/lab/sdf-zombie/actor.ts` (`ActorSignals`, `ActorStepInput`, `stepActorMotion`)
- Test: `src/lab/sdf-zombie/motion.test.ts`, `src/lab/sdf-zombie/actor.test.ts` (append)

- [ ] **Step 1: Failing tests**

`motion.test.ts`:

```ts
describe('fire signal', () => {
  const CFG: MotionConfig = { enabled: true, wander: false, profile: SOLDIER_PROFILE, forceSpeed: 3.4 };
  const fireAt = (n: number) => (i: number): MotionSignals => ({ ...NO_SIGNALS(), fire: i === n });

  it('switches to the hip carry for fireHoldSec, then releases to the run carry', () => {
    const j = soldierJoints();
    let state = makeMotionState(3, [0, 0, 0]);
    let points = stubPoints(j);
    const carries: string[] = [];
    for (let i = 0; i < 90; i++) {
      const s = stepMotion(state, j, CFG, fireAt(10)(i), points, BOUNDS, makeRng(1));
      state = s.state; points = s.frame.restPose.map(p => ({ pos: [...p] as Vec3, prev: [...p] as Vec3, pinned: false }));
      carries.push(s.frame.carry ?? '-');
    }
    expect(carries[9]).toBe('chest');
    expect(carries[10]).toBe('hip');
    expect(carries[10 + Math.round(FIRE.holdSec * 60) - 2]).toBe('hip');
    expect(carries[10 + Math.round(FIRE.holdSec * 60) + 2]).toBe('chest');
  });

  it('emits hand and shoulder kicks backward along body forward on the fire frame only', () => {
    const j = soldierJoints();
    const { frame } = run(j, makeMotionState(3, [0, 0, 0]), CFG, 20, fireAt(19));
    const fwd = headingDir(frame.bodyYaw);
    expect(frame.kicks.map(k => k.joint).sort()).toEqual(['handL', 'handR', 'shoulderR']);
    for (const k of frame.kicks) expect(dot(k.delta, fwd)).toBeLessThan(0);
    const calm = run(j, makeMotionState(3, [0, 0, 0]), CFG, 20, fireAt(5));
    expect(calm.frame.kicks).toEqual([]);
  });

  it('cuts the stride while holding', () => {
    const j = soldierJoints();
    const lift = (fire: boolean) => {
      let best = 0;
      let state = makeMotionState(3, [0, 0, 0]); let points = stubPoints(j);
      for (let i = 0; i < 60; i++) {
        const s = stepMotion(state, j, CFG, { ...NO_SIGNALS(), fire: fire && i === 0 }, points, BOUNDS, makeRng(1));
        state = s.state; points = s.frame.restPose.map(p => ({ pos: [...p] as Vec3, prev: [...p] as Vec3, pinned: false }));
        if (i > 30) best = Math.max(best, s.frame.restPose[j.index.footL]![1] - j.groundY);
      }
      return best;
    };
    expect(lift(true)).toBeLessThan(lift(false) * 0.6);
  });
});
```

Add `FIRE` to the `./motion` import and `headingDir` from `./wander`, and `fire: false` to `NO_SIGNALS()`.

`actor.test.ts` (append; check its existing imports for `makeActorMotion`, `stepActorMotion`, `emptyActorSignals`, `buildBody`, and add `compileBlob`/`parseBlob`/`soldierSrc`/`SOLDIER_PROFILE`/`makeRng`):

```ts
describe('actor: fire kicks reach the rig', () => {
  it('the hand points move backward on the fire frame', () => {
    const body = buildBody(compileBlob(parseBlob(soldierSrc)));
    const m = makeActorMotion(body, { seed: 5 });
    const input = () => ({
      current: body, dt: 1 / 60, wander: false, armStyle: 'carry' as const,
      headingFollow: 1, gazeFollow: 1, bounds: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
      rng: makeRng(5), signals: emptyActorSignals(), profile: SOLDIER_PROFILE, forceSpeed: 0,
    });
    for (let i = 0; i < 60; i++) stepActorMotion(m, input());
    const iH = m.motionJoints!.index.handR;
    const before = m.bound.rig.points[iH]!.pos[2];
    const sig = emptyActorSignals(); sig.fire = true;
    const f = stepActorMotion(m, { ...input(), signals: sig });
    expect(f!.kicks.length).toBe(3);
    expect(sig.fire).toBe(false); // drained
    expect(m.bound.rig.points[iH]!.pos[2]).toBeLessThan(before);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`motion.ts`:

```ts
/** Hip-fire knobs. */
export const FIRE = {
  /** How long the fire carry holds after the last shot (s). */
  holdSec: 0.6,
  /** Stride amplitude while holding (a burst on the move shortens the step). */
  strideScale: 0.4,
  /** Point shoves (m) backward along body forward on the fire frame. */
  handKick: 0.06,
  shoulderKick: 0.025,
} as const;
```

`MotionSignals`: `/** The body fired its weapon this frame (drained by the wiring). */ fire: boolean;`

`MotionFrame`: `/** The carry in effect, or null. */ carry: CarryName | null;`

In `stepMotion`, before the gait targets are assembled (after `blend`):

```ts
  // --- fire hold ------------------------------------------------------------
  const firedNow = !!sig.fire && !collapsed && !!profile.carries;
  const fireHold = firedNow ? FIRE.holdSec : Math.max(0, state.fireHold - dt);
  const sinceFire = firedNow ? 0 : state.sinceFire + dt;
  const strideScale = fireHold > 0 ? FIRE.strideScale : 1;
```

In the targets map, cut the stride: `const s = ARM_JOINTS.has(name) ? armPresence : blend * strideScale;` (for the zombie `strideScale === 1`, so `blend * 1` — multiply by exactly 1 is bit-exact in IEEE, the pins stay green).

In the carry block, use `fireHold` (this frame's) instead of `state.fireHold`, and record `carryName` into a `let carryUsed: CarryName | null = null` declared above the block. After the carry block:

```ts
  const kicks: MotionFrame['kicks'] = [];
  if (firedNow && armStyle === 'carry') {
    const back = scale(headingDir(bodyYaw), -1);
    if (!sig.missing.armL) kicks.push({ joint: 'handL', delta: scale(back, FIRE.handKick) });
    if (!sig.missing.armR) {
      kicks.push({ joint: 'handR', delta: scale(back, FIRE.handKick) });
      kicks.push({ joint: 'shoulderR', delta: scale(back, FIRE.shoulderKick) });
    }
  }
```

`nextState`: `fireHold, sinceFire`; frame: `carry: carryUsed, kicks`.

`actor.ts`: `ActorSignals` gains `fire: boolean` (`emptyActorSignals` returns `fire: false`); `ActorStepInput` gains `profile?: MotionProfile; forceSpeed?: number; carryOverride?: CarryName;` passed into the config; the signals object passes `fire: signals.fire`; the drain sets `signals.fire = false`. After `stepRig` … `constrainRigBends` for a sub-step, apply the kicks:

```ts
    for (const k of f.kicks) {
      const i = m.motionJoints.index[k.joint];
      if (i === undefined) continue;
      m.bound = impulseAt(m.bound, m.bound.rig.points[i]!.pos, k.delta);
    }
```

(`impulseAt` picks the nearest unpinned point to the given world position; passing the point's own position selects it. Import `impulseAt` from `./rig-bind`.) Kicks are emitted only on the first sub-step's frame because `fire` is drained after it.

- [ ] **Step 4: Run** `npx vitest run src/lab/sdf-zombie/motion.test.ts src/lab/sdf-zombie/actor.test.ts src/lab/sdf-zombie/gait-pins.test.ts && npx tsc --noEmit` → PASS. Any other `MotionSignals` literal in tests/lab code needs `fire: false` — tsc will list them (`game-actor.ts` CALM, `lab-main.ts` heroSignals).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/motion.ts src/lab/sdf-zombie/motion.test.ts src/lab/sdf-zombie/actor.ts src/lab/sdf-zombie/actor.test.ts src/lab/sdf-zombie/webgpu/game-actor.ts
git commit -m "motion: fire signal — hip-carry hold, stride cut, hand/shoulder kicks applied through impulseAt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: prop-drop.ts — a released prop's tumble and floor rest (pure)

**Files:**
- Create: `src/lab/sdf-zombie/prop-drop.ts`, `src/lab/sdf-zombie/prop-drop.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// src/lab/sdf-zombie/prop-drop.test.ts
import { describe, it, expect } from 'vitest';
import { releaseProp, stepDrop, DROP } from './prop-drop';

describe('prop drop', () => {
  it('falls under gravity, lands on the floor pad, and stops', () => {
    let s = releaseProp([0, 1.0, 0], [0, 0, 0, 1], [0.5, 1.0, 0], 3);
    for (let i = 0; i < 240; i++) s = stepDrop(s, 1 / 60, 0);
    expect(s.pos[1]).toBeCloseTo(DROP.floorPad, 6);
    expect(s.resting).toBe(true);
    expect(s.pos[0]).toBeGreaterThan(0.05); // it travelled
  });
  it('tumbles while airborne and stops spinning at rest', () => {
    let s = releaseProp([0, 1.0, 0], [0, 0, 0, 1], [0, 1, 0], 3);
    const q0 = s.quat;
    s = stepDrop(s, 1 / 60, 0);
    expect(s.quat).not.toEqual(q0);
    for (let i = 0; i < 300; i++) s = stepDrop(s, 1 / 60, 0);
    const qRest = s.quat;
    expect(stepDrop(s, 1 / 60, 0).quat).toEqual(qRest);
  });
  it('is deterministic in the seed', () => {
    const a = releaseProp([0, 1, 0], [0, 0, 0, 1], [0, 1, 0], 9);
    const b = releaseProp([0, 1, 0], [0, 0, 0, 1], [0, 1, 0], 9);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/prop-drop.ts
//
// A released held prop: ballistic flight with an end-over-end tumble, then
// a floor rest. Same shape as the FPV's ejected-shell arc (game-viewmodel.ts
// ejectedShell) — exaggerated gravity, seeded spin — but as a stepped state
// rather than a closed form, because a dropped gun has to LAND and stay.
// Pure: no wall clock, seed in, same numbers out.
import type { Vec3 } from './types';
import { add, normalize, qFromAxisAngle, qMul, qNormalize, scale, type Quat } from './vec';

export const DROP = {
  /** Exaggerated, to match the pellet/shell gravity. */
  gravity: -6.2,
  /** The prop rests this high off the floor (half its thickness). */
  floorPad: 0.03,
  /** Bounce restitution on landing. */
  restitution: 0.25,
  /** Horizontal speed bleed per landing. */
  friction: 0.5,
  /** Below this |vy| after a bounce the prop settles. */
  restCutoff: 0.35,
  /** Spin rate (rad/s) at release, jittered by the seed. */
  spin: 9,
} as const;

export interface DropState {
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
  /** Unit spin axis and rate; rate 0 once resting. */
  spinAxis: Vec3;
  spinRate: number;
  resting: boolean;
}

function jitter(seed: number, n: number): number {
  const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Start a drop from the prop's current pose with the hand's velocity. */
export function releaseProp(pos: Vec3, quat: Quat, handVel: Vec3, seed: number): DropState {
  const j = (n: number) => jitter(seed, n);
  return {
    pos: [pos[0], pos[1], pos[2]],
    quat: [quat[0], quat[1], quat[2], quat[3]],
    vel: add(handVel, [0.4 * j(0), 0.6 + 0.3 * j(1), 0.4 * j(2)]),
    spinAxis: normalize([1, 0.2 * j(3), 0.3 * j(4)]),
    spinRate: DROP.spin * (1 + 0.25 * j(5)),
    resting: false,
  };
}

/** One integration step. `floorY` is the floor plane. */
export function stepDrop(s: DropState, dt: number, floorY: number): DropState {
  if (s.resting) return s;
  const vel: Vec3 = [s.vel[0], s.vel[1] + DROP.gravity * dt, s.vel[2]];
  let pos = add(s.pos, scale(vel, dt));
  let quat = qNormalize(qMul(qFromAxisAngle(s.spinAxis, s.spinRate * dt), s.quat));
  let spinRate = s.spinRate;
  let resting = false;
  const rest = floorY + DROP.floorPad;
  if (pos[1] <= rest) {
    pos = [pos[0], rest, pos[2]];
    if (Math.abs(vel[1]) < DROP.restCutoff) {
      resting = true;
      spinRate = 0;
      // Lie flat: keep the yaw, drop the pitch/roll.
      const yaw = Math.atan2(2 * (quat[3] * quat[1] + quat[0] * quat[2]), 1 - 2 * (quat[1] * quat[1] + quat[2] * quat[2]));
      quat = qFromAxisAngle([0, 1, 0], yaw);
      return { pos, quat, vel: [0, 0, 0], spinAxis: s.spinAxis, spinRate, resting };
    }
    vel[1] = -vel[1] * DROP.restitution;
    vel[0] *= DROP.friction; vel[2] *= DROP.friction;
    spinRate *= 0.6;
  }
  return { pos, quat, vel, spinAxis: s.spinAxis, spinRate, resting };
}
```

- [ ] **Step 4: Run** `npx vitest run src/lab/sdf-zombie/prop-drop.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/prop-drop.ts src/lab/sdf-zombie/prop-drop.test.ts
git commit -m "prop-drop: released-prop tumble and floor rest (pure)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: kit-overlay.pose — the skinned kit follows the rig; rest-identity gate

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/kit-overlay.ts` (`KitOverlay` ~155, `loadKit` ~178-250)
- Test: `src/lab/sdf-zombie/characters/soldier-kit.test.ts` (append — the file already decodes the glTF JSON)

- [ ] **Step 1: Failing test** — append to `soldier-kit.test.ts`. It needs the node hierarchy, so extend the local `Gltf` interface's `nodes` entry with `children?: number[]`, and add `import { boneFrames } from '../rig-frames'; import { bindRig } from '../rig-bind';`.

```ts
describe('the kit skeleton transcribes the blob skeleton (rest identity)', () => {
  const body = buildBody(compileBlob(parseBlob(blobSrc)));
  const bound = bindRig(body);
  // World position of every glTF node by walking translations root→leaf.
  const parent = new Map<number, number>();
  gltf.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parent.set(c, i)));
  const worldOf = (i: number): Vec3 => {
    const p: Vec3 = [0, 0, 0];
    for (let k: number | undefined = i; k !== undefined; k = parent.get(k)) {
      const t = gltf.nodes[k]!.translation ?? [0, 0, 0];
      p[0] += t[0]!; p[1] += t[1]!; p[2] += t[2]!;
    }
    return p;
  };
  it('every named kit bone sits at its blob bone head, within 1 mm', () => {
    const frames = boneFrames(body, bound, 0);
    let checked = 0;
    gltf.nodes.forEach((n, i) => {
      const f = n.name ? frames.get(n.name) : undefined;
      if (!f) return;
      const w = worldOf(i);
      for (let k = 0; k < 3; k++) expect(Math.abs(w[k]! - f.pos[k]!), `${n.name}[${k}]`).toBeLessThan(1e-3);
      checked++;
    });
    expect(checked).toBe(body.bones.size);
  });
  it('rest frames are the identity rotation', () => {
    for (const [name, f] of boneFrames(body, bound, 0)) expect(f.quat, name).toEqual([0, 0, 0, 1]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lab/sdf-zombie/characters/soldier-kit.test.ts` → the new describe FAILS only if the transcription drifted; it may already PASS. Either way it is now the gate. (If `checked !== body.bones.size`, list which bone names differ between the .wam and the .blob and fix the .wam transcription — do not loosen the test.)

- [ ] **Step 3: Implement `pose` in `kit-overlay.ts`**

Extend the interface:

```ts
export interface KitOverlay {
  object: THREE.Object3D;
  bones: Map<string, THREE.Bone>;
  /**
   * Pose the skinned kit from the rig's bone frames (rig-frames.ts). A
   * frame is WORLD position + rotation for a blob bone; the matching bone
   * node's matrixWorld is written directly. Bone nodes with no frame (the
   * .wam's extra `hips` under `pelvis`, and anything a kit adds) take their
   * parent's world matrix composed with their own bind-local matrix.
   *
   * At rest every frame is (bind head, identity) and the result is exactly
   * the static placement this overlay had before it could move.
   */
  pose(frames: ReadonlyMap<string, { pos: Vec3; quat: readonly number[] }>): void;
  dispose(): void;
}
```

In `loadKit`, after the `bones` map is filled:

```ts
  // Bones are driven by absolute world matrices, so three's own hierarchy
  // update must not overwrite them. Capture each bone's BIND-local matrix
  // first (translation only in a WAM export) for the no-frame fallback.
  const bindLocal = new Map<THREE.Bone, THREE.Matrix4>();
  const ordered: THREE.Bone[] = [];
  gltf.scene.traverse(o => {
    if (!(o as THREE.Bone).isBone) return;
    const b = o as THREE.Bone;
    b.updateMatrix();
    bindLocal.set(b, b.matrix.clone());
    b.matrixAutoUpdate = false;
    b.matrixWorldAutoUpdate = false;
    ordered.push(b); // traverse is parent-before-child
  });
  object.updateMatrixWorld(true);

  const tmpPos = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const pose: KitOverlay['pose'] = (frames) => {
    for (const b of ordered) {
      const f = frames.get(b.name);
      if (f) {
        tmpPos.set(f.pos[0], f.pos[1], f.pos[2]);
        tmpQ.set(f.quat[0]!, f.quat[1]!, f.quat[2]!, f.quat[3]!);
        b.matrixWorld.compose(tmpPos, tmpQ, one);
      } else {
        const parentWorld = (b.parent as THREE.Object3D | null)?.matrixWorld;
        if (parentWorld) b.matrixWorld.multiplyMatrices(parentWorld, bindLocal.get(b)!);
      }
    }
  };
```

Return `pose` in the object literal. The skinned mesh reads `bone.matrixWorld` in `Skeleton.update()` each render, so nothing else is needed. Note `object.position` must stay at the origin once `pose` is in use: frames are world.

- [ ] **Step 4: Typecheck and run the kit tests**: `npx tsc --noEmit && npx vitest run src/lab/sdf-zombie/characters/` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/kit-overlay.ts src/lab/sdf-zombie/characters/soldier-kit.test.ts
git commit -m "kit-overlay: pose(frames) drives the skinned kit from rig bone frames; rest-identity gate on the soldier kit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: held-prop.ts — the gun in the lab scene

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/held-prop.ts`

No unit test: every piece of maths it uses is tested in `carry.ts` / `prop-drop.ts`; this file is THREE glue. The lab gate in Task 14 is its test.

- [ ] **Step 1: Implement**

```ts
// src/lab/sdf-zombie/webgpu/held-prop.ts
//
// A held polygon prop (the soldier's shorty) on the DEFAULT layer, posed
// every frame from the motion frame's gun pose (carry.ts gunPoseFromArm, the
// right forearm) with the post-shot muzzle rise on top; released on collapse
// or gib into prop-drop.ts's tumble, where it lands and stays.
//
// Same depth story as the kit (kit-overlay.ts header): the SDF composite
// already depth-tests against the polygonal pass, so the gun interleaves
// with flesh with nothing added here.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Vec3 } from '../types';
import { GUN_GRIP, gunPoint, muzzleRise, type GunPose } from '../carry';
import { releaseProp, stepDrop, type DropState } from '../prop-drop';
import { qFromAxisAngle, qMul, qRotate, sub, scale, type Quat } from '../vec';

export interface HeldProp {
  object: THREE.Object3D;
  /** Pose from this frame's gun pose. `sinceFire` (s) adds the muzzle rise;
   *  `bodyRight` is the axis the rise pitches about. */
  pose(gun: GunPose, sinceFire: number, bodyRight: Vec3): void;
  /** Let go: the prop tumbles from where it is with the hand's velocity. */
  release(handVel: Vec3, seed: number): void;
  /** Advance a released prop. No-op while held or resting. */
  step(dt: number, floorY: number): void;
  /** World muzzle (midpoint of the two bores) for the last posed frame. */
  muzzle(): Vec3;
  /** True once released. */
  readonly released: boolean;
  dispose(): void;
}

export async function loadHeldProp(url: string): Promise<HeldProp> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const object = new THREE.Group();
  object.add(gltf.scene);
  object.matrixAutoUpdate = false;
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  let last: GunPose = { root: [0, 0, 0], quat: [0, 0, 0, 1] };
  let drop: DropState | null = null;

  const write = (root: Vec3, quat: Quat) => {
    pos.set(root[0], root[1], root[2]);
    q.set(quat[0], quat[1], quat[2], quat[3]);
    object.matrix.compose(pos, q, one);
    object.matrixWorld.copy(object.matrix);
  };

  return {
    object,
    get released() { return drop !== null; },
    pose(gun, sinceFire, bodyRight) {
      if (drop) return;
      const rise = muzzleRise(sinceFire);
      const quat: Quat = rise === 0 ? gun.quat : qMul(qFromAxisAngle(bodyRight, -rise), gun.quat);
      // Rise pivots about the grip, not the root: keep Grip_Hand where it is.
      const grip = gunPoint(gun, GUN_GRIP.gripHand);
      const root = sub(grip, qRotate(quat, GUN_GRIP.gripHand));
      last = { root, quat };
      write(root, quat);
    },
    release(handVel, seed) {
      if (drop) return;
      drop = releaseProp(last.root, last.quat, scale(handVel, 1), seed);
    },
    step(dt, floorY) {
      if (!drop || drop.resting) return;
      drop = stepDrop(drop, dt, floorY);
      last = { root: drop.pos, quat: drop.quat };
      write(drop.pos, drop.quat);
    },
    muzzle() { return gunPoint(last, GUN_GRIP.muzzle); },
    dispose() {
      object.traverse(o => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const m = mesh.material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.dispose();
      });
    },
  };
}
```

- [ ] **Step 2: Typecheck**: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/held-prop.ts
git commit -m "held-prop: the gun rides the motion frame's gun pose, kicks with muzzle rise, drops on release

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Lab wiring — profile by character, kit and gun posed per frame, keys, handle

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`:
  - imports (~30-160)
  - kit load block (~593-598)
  - motion state block (~1084-1110)
  - `resetMotion` (~1333)
  - `gibEverything` (~1857-1888)
  - key handler (~2423-2432)
  - hero frame loop after `stepActorMotion` (~2670-2700) and after `applyRig` (~2710)
  - crowd step (~2806)
  - motion panel (~3512-3525)
  - `__sdfLab` handle (~3828, ~4354)

- [ ] **Step 1: Imports**

```ts
import { loadKit, type KitOverlay } from './kit-overlay';
import { loadHeldProp, type HeldProp } from './held-prop';
import { boneFrames } from '../rig-frames';
import { motionProfileFor, type MotionProfile } from '../motion-profile';
import type { CarryName } from '../carry';
```

- [ ] **Step 2: Profile + speed band state** — next to `let armStyle`:

```ts
  /** This character's motion profile — gaits, cruise, carries, prop. */
  const motionProfile: MotionProfile = motionProfileFor(activeCharacterName());
  /** Lab speed band: which cruise the wanderer uses. '1' walk, '2' run. */
  let speedBand: 'walk' | 'run' = 'walk';
  /** Treadmill speed for pose captures (holdPose); undefined = wander speed. */
  let forceSpeed: number | undefined;
  /** Carry pin for pose captures. */
  let carryOverride: CarryName | undefined;
  let pendingFire = false;
  /** Seconds since the hero last fired; feeds the prop's muzzle rise. */
  let sinceFire = Infinity;
  const cruiseFor = (band: 'walk' | 'run') =>
    band === 'run' ? motionProfile.cruise : Math.min(motionProfile.cruise, motionProfile.runBand.from * 0.75);
```

The default `armStyle` must come from the profile: change `let armStyle: ArmStyle = GAIT_TUNING.armStyle;` to `let armStyle: ArmStyle | undefined = undefined;` and pass `armStyle` through as-is (undefined lets `pickArmStyle` use the profile). The `arms:` panel button cycles `undefined → 'swing' → 'reach' → undefined` and labels `undefined` as `profile`.

- [ ] **Step 3: Kit and prop load** — replace the fire-and-forget kit block:

```ts
  let kit: KitOverlay | null = null;
  let heldProp: HeldProp | null = null;
  const kitUrl = KITS[activeCharacterName()];
  if (kitUrl) {
    loadKit(kitUrl, handle.renderer, [0, 0, 0])
      .then(k => { kit = k; scene.add(k.object); })
      .catch(e => console.error(`[kit] ${kitUrl} failed to load; rendering the body undressed`, e));
  }
  if (motionProfile.prop) {
    loadHeldProp(motionProfile.prop.url)
      .then(p => { heldProp = p; scene.add(p.object); })
      .catch(e => console.error(`[prop] ${motionProfile.prop!.url} failed to load; rendering unarmed`, e));
  }
```

- [ ] **Step 4: Per-frame pose** — in the hero loop, `stepActorMotion` call gains `profile: motionProfile, forceSpeed, carryOverride` and a `cruise`: the cruise comes through the profile, so pass a profile copy when the band is walk:

```ts
      heroSignals.fire = pendingFire;
      const f = stepActorMotion(heroMotion, {
        current, dt,
        wander: wanderOn, armStyle, headingFollow, gazeFollow,
        bounds: WANDER_BOUNDS, rng: motionRng, signals: heroSignals,
        profile: { ...motionProfile, cruise: cruiseFor(speedBand) },
        forceSpeed, carryOverride,
      });
      pendingFire = heroSignals.fire;
      sinceFire = f ? (f.kicks.length ? 0 : sinceFire + dt) : sinceFire;
```

Right after `const posed = applyRig(current, heroMotion.bound, heroMotion.lastBodyYaw);` add:

```ts
    // Polygon halves ride the rig: the kit from per-bone frames, the gun from
    // the motion frame's gun pose (right forearm). Collapse and gib release
    // the gun; the kit simply keeps following the (fallen) rig.
    if (kit || heldProp) {
      const frames = boneFrames(current, heroMotion.bound, heroMotion.lastBodyYaw);
      kit?.pose(frames);
      if (heldProp) {
        const lastFrame = heroMotion.motionState ? lastMotionFrame : null;
        if (lastFrame?.gun && !heldProp.released) {
          heldProp.pose(lastFrame.gun, sinceFire, rotateYaw([1, 0, 0], heroMotion.lastBodyYaw));
        }
        if (lastFrame?.collapsed && !heldProp.released) heldProp.release([0, 0, 0], MOTION_SEED);
        heldProp.step(Math.min(dt, 1 / 30), 0);
      }
    }
```

Keep the latest motion frame in a `let lastMotionFrame: MotionFrame | null = null;` declared beside `lastPosed` and assigned `lastMotionFrame = f;` right after the `stepActorMotion` call (and `null` in the statue branch). Import `rotateYaw` from `../gait` and `type MotionFrame` from `../motion` if not already imported.

- [ ] **Step 5: Gib hides the kit and drops the gun** — in `gibEverything`, before `resetMotion()`:

```ts
    if (kit) kit.object.visible = false;
    heldProp?.release([0, 2.5, 0], MOTION_SEED);
```

And in `resetMotion`, after the state reset: `if (kit) kit.object.visible = true;` (a fresh body gets its armour back; the released gun stays on the floor — that is the expected debris).

- [ ] **Step 6: Keys** — in the keydown handler beside `k`:

```ts
    if (ev.key === '1') { speedBand = 'walk'; return; }
    if (ev.key === '2') { speedBand = 'run'; return; }
    if (ev.key === 'f' || ev.key === 'F') { if (motionProfile.carries) pendingFire = true; return; }
```

Check `SEVER_KEYS` does not already claim `1`, `2` or `f` (`grep -n "SEVER_KEYS" lab-main.ts`); if it does, move those severs to `shift+digit` — no, simpler: pick `,`/`.` for walk/run instead and say so in the panel text. Record what you chose in TASKS.md.

- [ ] **Step 7: Panel** — in the motion section after the `force collapse` button:

```ts
  if (motionProfile.carries) {
    const bandBtn = addButton(motionBox, `speed: ${speedBand} (1/2)`, () => {
      speedBand = speedBand === 'walk' ? 'run' : 'walk';
      bandBtn.textContent = `speed: ${speedBand} (1/2)`;
    });
    addButton(motionBox, 'fire (F)', () => { pendingFire = true; });
  }
```

And extend the `motionReadEl` line to append `` · ${f.gaitName}${f.carry ? ' · ' + f.carry : ''} ``.

- [ ] **Step 8: Handle exports** — in the `__sdfLab` object next to `forceCollapse`:

```ts
    /** Soldier-class controls (no-ops for characters without carries). */
    setSpeedBand(b: 'walk' | 'run') { speedBand = b; },
    fire() { if (motionProfile.carries) pendingFire = true; },
    get motionProfile() { return motionProfile.name; },
    /**
     * Deterministic pose for captures: treadmill at `speed` m/s (0 = stand),
     * optionally pinned to a carry, stepped `frames` times at 1/60 with the
     * body standing still, then motion is frozen so the rig holds it.
     * 'walk' | 'run' | 'hip' are the turntable's presets.
     */
    holdPose(preset: 'walk' | 'run' | 'hip' | 'rest', frames = 90) {
      setWander(false);
      setMotionEnabled(true);
      forceSpeed = preset === 'walk' ? cruiseFor('walk') : preset === 'run' ? cruiseFor('run') : 0;
      carryOverride = preset === 'hip' ? 'hip' : undefined;
      if (preset === 'hip') pendingFire = true;
      const sig = heroSignals;
      for (let i = 0; i < frames; i++) {
        sig.fire = pendingFire; pendingFire = false;
        const f = stepActorMotion(heroMotion, {
          current, dt: 1 / 60, wander: false, armStyle, headingFollow, gazeFollow,
          bounds: WANDER_BOUNDS, rng: motionRng, signals: sig,
          profile: motionProfile, forceSpeed, carryOverride,
        });
        lastMotionFrame = f;
        if (f) sinceFire = f.kicks.length ? 0 : sinceFire + 1 / 60;
      }
      sinceFire = Infinity; // a held pose is judged without the muzzle rise
      setMotionEnabled(false);
      return lastMotionFrame ? { gait: lastMotionFrame.gaitName, carry: lastMotionFrame.carry } : null;
    },
```

`heroSignals` is declared before the frame loop (it is the `ActorSignals` record the loop fills); confirm its name with `grep -n "heroSignals" lab-main.ts` and that it exists before the handle is built (it does — the handle is built after the loop closures). If `setWander`/`setMotionEnabled` are declared after the handle literal, they are function declarations and hoist.

- [ ] **Step 9: Crowd** — the crowd's `stepActorMotion` call gains `profile: motionProfile` so crowd soldiers march too (no prop: crowd bodies don't get kits or guns in this phase).

- [ ] **Step 10: Typecheck, then run the lab**

```bash
npx tsc --noEmit
```

Then start the lab (dev server via `scripts/lab-servers.sh` conventions, or the running one) and open `sdf-lab-webgpu.html?character=soldier`. Confirm in the browser console: no errors, `__sdfLab.motionProfile === 'soldier'`. Watch: he marches with the gun low; press `2` — he runs with the gun across the chest; `F` — hip-fire kick; `K` — he collapses, armour follows, gun drops and lands. Then `?character=zombie`: unchanged shamble, `__sdfLab.motionProfile === 'zombie'`. Then `?character=goblin`: he now walks (shamble) with his kit following.

- [ ] **Step 11: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/lab-main.ts
git commit -m "lab: soldier moves — profile by character, kit and gun posed per frame, 1/2 speed bands, F fires, holdPose for captures

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Turntable poses, capture strips, TASKS.md, memory

**Files:**
- Modify: `scripts/blob-turntable.mjs` (the freeze block ~190-200)
- Modify: `TASKS.md` (Current focus)
- Create: `docs/dev-notes/2026-09-05-soldier-animation/notes.md` + captures

- [ ] **Step 1: `BLOB_POSE` in the turntable** — replace the freeze block:

```js
// Pose. Default: freeze the rig at its authored rest (the historical
// turntable). BLOB_POSE=walk|run|hip steps the motion deterministically on a
// treadmill (lab-main's holdPose: fixed 1/60 steps, wander off, then motion
// frozen) so a capture shows a mid-stride or a carry from every yaw, and the
// same document still yields the same frames.
const POSE = process.env.BLOB_POSE ?? 'rest';
const POSE_FRAMES = Number(process.env.BLOB_POSE_FRAMES ?? 90);
await evaluate(`(() => {
  if (window.__sdfLab.setAdaptive) window.__sdfLab.setAdaptive(false);
  window.__sdfLab.focusBody();
  if (${JSON.stringify(POSE)} === 'rest' || !window.__sdfLab.holdPose) {
    window.__sdfLab.setMotionEnabled(false);
    window.__sdfLab.setWander(false);
    return 'rest';
  }
  return JSON.stringify(window.__sdfLab.holdPose(${JSON.stringify(POSE)}, ${POSE_FRAMES}));
})()`).then(r => console.log('pose:', r));
await sleep(4000);
```

Update the usage comment at the top of the file: `BLOB_POSE=walk|run|hip` (and `BLOB_POSE_FRAMES`) beside `BLOB_CHARACTER`.

- [ ] **Step 2: Shoot the strips**

```bash
mkdir -p docs/dev-notes/2026-09-05-soldier-animation
for pose in rest walk run hip; do
  BLOB_POSE=$pose npm run blob:shot -- soldier docs/dev-notes/2026-09-05-soldier-animation/$pose 8
done
BLOB_POSE=walk npm run blob:shot -- goblin docs/dev-notes/2026-09-05-soldier-animation/goblin-walk 4
npm run blob:shot -- zombie docs/dev-notes/2026-09-05-soldier-animation/zombie-rest 4
```

Read the frames (the Read tool renders PNGs). Judge: kit on the body in every pose (no plate floating off a limb), both hands on the gun in `hip`, left hand on the fore-end in `chest`/`low`, no arm through the torso, feet not through the floor. If the left elbow folds through the body, flip the sign of that carry's `leftPole` x in `carry.ts`. If a carry reads wrong, adjust its angles in `CARRIES` — those numbers are the owner's to tune; leave a note of what you changed and why.

- [ ] **Step 3: Notes** — `docs/dev-notes/2026-09-05-soldier-animation/notes.md`: what was built, the four strips with one line each on what to look at, the carry numbers as shipped, anything you tuned in Step 2, and the goblin-now-walks side effect.

- [ ] **Step 4: TASKS.md** — add a Current-focus entry at the top:

```markdown
**SOLDIER ANIMATION — BUILT, AWAITING OWNER LOOK (2026-09-05).** The soldier
marches, runs, carries the shorty and hip-fires it in the lab; the skinned
kit and the gun ride the rig (`rig-frames.ts` → `KitOverlay.pose`,
`held-prop.ts`). Gait is now a PROFILE (`SHAMBLE` = the zombie verbatim,
pinned bit-exact in `gait-pins.test.ts`; `MARCH`/`RUN` blended by speed);
arms have a third style, `carry` (right arm authored rotations, left hand
FABRIK'd onto the fore-end — `carry.ts`). Found and fixed on the way: the
goblin and soldier had NO motion at all (rig points the gait could not
name → `makeMotionJoints` null); the joint schema grew eight secondary
names and dedups by position. Lab: `1`/`2` speed band, `F` fire, `K`
collapse; `__sdfLab.holdPose('walk'|'run'|'hip')` for captures;
`BLOB_POSE=` on the turntable. Phase 2 (shoot-back AI in sdf-game) and
phase 3 (shouldered aim) are separate specs.
[spec](docs/superpowers/specs/2026-09-05-soldier-animation-design.md) ·
[plan](docs/superpowers/plans/2026-09-05-soldier-animation.md) ·
[strips](docs/dev-notes/2026-09-05-soldier-animation/notes.md)
```

- [ ] **Step 5: Full suite, then commit**

```bash
npx vitest run && npx tsc --noEmit
git add scripts/blob-turntable.mjs TASKS.md docs/dev-notes/2026-09-05-soldier-animation
git commit -m "soldier anim: turntable poses, capture strips, TASKS

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Memory** (from the worktree root; `source ~/.claude/hooks/dualmem-env.sh` first)

```bash
~/go/bin/dualmem add --type warning --salience 0.85 --files "src/lab/sdf-zombie/gait.ts,src/lab/sdf-zombie/motion.ts" --text "Blud gait joint naming: jointNamesForBody dedups rig points by POSITION and names each with the earliest GAIT_JOINTS entry among its candidates (primary beats secondary). Any new bone name must be in JOINT_AT or makeMotionJoints returns null and the body silently gets NO motion (the goblin/soldier bug, 2026-09-05). gait-pins.test.ts pins the zombie's output bit-exact; never edit the pin, fix the refactor."
~/go/bin/dualmem add --type architecture --salience 0.8 --files "src/lab/sdf-zombie/rig-frames.ts,src/lab/sdf-zombie/carry.ts,src/lab/sdf-zombie/motion-profile.ts,src/lab/sdf-zombie/webgpu/kit-overlay.ts,src/lab/sdf-zombie/webgpu/held-prop.ts" --text "Soldier animation stack: motion-profile.ts picks gait pair/cruise/carries per character → motion.ts blends MARCH/RUN by runWeight, applies torso lean as a rotation about hips, carry arms (right authored via armPivot, left FABRIK to the gun's Fore_Hand), emits frame.gun (GunPose from the right forearm) and frame.kicks on fire → actor.ts applies kicks with impulseAt → lab poses kit via boneFrames→KitOverlay.pose and the gun via HeldProp.pose; collapse/gib release the prop into prop-drop.ts."
```

---

## Self-review

**Spec coverage:** §1 bone frames → Tasks 4, 11, 12; rest-identity gate → Task 11. §2 aliases → Task 2 (extended per amendment); profiles/blend/lean → Tasks 5, 7, 8; determinism → Task 1 pins. §3 carries → Tasks 6, 8; firing (hold, stride cut, impulses, muzzle rise) → Tasks 9, 12; muzzle seam → Task 12. §4 lab wiring/keys/turntable → Tasks 13, 14; death inheritance + kit hide + prop drop → Tasks 10, 13; gates: determinism (T1), rest identity (T11), alias coverage (T2), carry pose (T8), recoil settle — the kick is an `impulseAt` shove that the rig's damping settles; T9's actor test proves the shove lands, and the hold-release test proves the carry returns. Out-of-scope items untouched (`game-main.ts` gets only the `fire: false` field on its CALM signals).

**Placeholder scan:** Task 1's `'GAIT_PIN'`/`'MOTION_PIN'` are deliberate: the values are produced by running the test and pasted in the same task. Task 6's trailing `export { scale ... }` line is explicitly deleted in the same step.

**Type consistency:** `GaitProfile` (T5) is what `MotionProfile.gait` (T7) and `blendProfiles` (T8) use; `CarryName`/`CARRIES`/`GUN_GRIP`/`gunPoseFromArm`/`gunPoint`/`armPivot`/`muzzleRise` (T6) are what T8/T12 import; `MotionFrame.gun/kicks/carry/gaitName` (T8/T9) are what T13 reads; `ActorStepInput.profile/forceSpeed/carryOverride` and `ActorSignals.fire` (T9) are what T13 passes; `KitOverlay.pose(frames)` (T11) takes `boneFrames` output (T4); `HeldProp.pose(gun, sinceFire, bodyRight)` (T12) matches T13's call.
