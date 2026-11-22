# Limb Toughness and Corpse Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arms and legs come off at the elbow or knee rather than the shoulder or hip, and a dying body keeps its shape
to a tweakable degree.

**Architecture:** Spec: [`2026-11-02-limb-toughness-corpse-integrity-design.md`](../specs/2026-11-02-limb-toughness-corpse-integrity-design.md).

- **Part 1:** connectivity scales each wound's sever radius by a per-joint factor. Joints are classified by bone name.
- **Part 2:** collapse builds two-sided distance braces. The two rig loops (`actor.ts`, `game-actor.ts`) relax the
  braces after the ropes, against a live integrity value. Floor contact takes a per-point lift from flesh girth. The
  fall starts with a topple kick, and the skull blends from its look clamp to following the rig.

**Tech Stack:** TypeScript, vitest. All logic is pure and renderer-free.

**Commands:** `npx vitest run <file>`, `npm run typecheck`, `npm run test:changed`. Never the full suite.

---

### Task 1: Joint classes and toughness in connectivity

**Files:**
- Modify: `src/lab/sdf-zombie/connectivity.ts`
- Test: `src/lab/sdf-zombie/connectivity-toughness.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** Zombie harness, as in the spec's §2 probe: jittered hits at fractions along
  each arm and leg, sever radii pellet 0.10 and slug 0.13, counting shots until the first cut and which joint it hits.
  Assertions:
  - The joint classes along `armL` are `[root, mid, other]`.
  - The shoulder and hip take no pellet cut within 12 hits, and no slug cut on the first hit.
  - The elbow and knee are cut within 2 pellets and 1 slug.
  - A mid-upper-arm hit reaches the elbow within 6 pellets.
  - A big blast (radius 0.16) at the root still cuts.
  - `setJointToughness({ root: 1, mid: 1 })` reproduces the old cut on a shoulder hit.
  - `severRadius: 0` never cuts.
- [ ] **Step 2:** Run `npx vitest run src/lab/sdf-zombie/connectivity-toughness.test.ts`. Expect a FAIL because
  `jointClass` is missing.
- [ ] **Step 3: Implement.**

```ts
export type JointClass = 'root' | 'mid' | 'other';
/** Sever-radius factor per joint class (spec 2026-11-02 §3). */
export const JOINT_TOUGHNESS: { root: number; mid: number } = { root: 0.7, mid: 1.4 };
export function setJointToughness(k: Partial<typeof JOINT_TOUGHNESS>): void { Object.assign(JOINT_TOUGHNESS, k); }
const ROOT_BONES = new Set(['clavicle', 'upperArm', 'upperarm', 'thigh', 'femur']);
const MID_BONES = new Set(['foreArm', 'forearm', 'shin', 'tibia']);
const boneBase = (b: string | undefined): string => (b ?? '').replace(/\.[lr]$/, '');
export function jointClass(limb: LimbId, prox: Primitive, distal: Primitive): JointClass { ... }
function toughness(c: JointClass): number { return c === 'root' ? JOINT_TOUGHNESS.root : c === 'mid' ? JOINT_TOUGHNESS.mid : 1; }
```

  - `sectionCut` gains a `scale` argument and multiplies every sphere radius by it.
  - `cutLimbs` passes the root factor for arms and legs, and 1 for everything else.
  - `cutChains` passes `toughness(jointClass(limb, prox, distal))`.
- [ ] **Step 4:** Run the new test, `connectivity.test.ts`, `sever.test.ts` and `explosion-aoe.test.ts`. Expect a PASS.
  If an old pin breaks because of the new rule, update it and record the reason in the test.
- [ ] **Step 5:** Commit with the message `feat(gore): elbow and knee cut easily, shoulder and hip resist`.

### Task 2: Classification listing across the cast

**Files:** Test: `src/lab/sdf-zombie/connectivity-toughness.test.ts`

- [ ] For every character in `CHARACTERS`, compile the blob and build the body, list the arm and leg chain joint
  classes, and log them. Expect every arm and leg limb to have exactly one `mid` joint, except an explicit
  `NO_MID_JOINT` exception list. Write that list from the first run, with a reason for each entry.
- [ ] Run the test, then commit.

### Task 3: A lost hand counts as a missing arm

**Files:** Modify: `src/lab/sdf-zombie/webgpu/game-actor.ts` (`missingLimbs`, around line 965)

- [ ] Replace `armL: gone('armL'), armR: gone('armR')` with the `legGone`-style check, so any dead add prim counts. Rename
  `legGone` to `limbGone` and update the comment.
- [ ] Add a test in the game-actor test that sits beside the existing distal-sever tests: after a debug distal sever on
  `armR` (`debugSever('armR', chainIdx)`), the motion signal's `missing.armR` is true.
- [ ] Run it, then commit.

### Task 4: Corpse braces (pure)

**Files:** Modify: `src/lab/sdf-zombie/collapse.ts`. Test: `src/lab/sdf-zombie/collapse-braces.test.ts` (new).

- [ ] **Tests:**
  - `collapseBraces` on the zombie gives trunk and head braces with rest distances.
  - At integrity 0, `relaxBraces` returns its input unchanged.
  - At integrity 1, a folded pose (head on pelvis) is pushed back to within tolerance after 4 iterations.
  - Pinned points never move.
- [ ] **Implement:**

```ts
export interface BraceLimit { a: number; b: number; rest: number; group: 'trunk' | 'head' }
export const CORPSE_INTEGRITY = { value: 0.7, iterations: 4 };
export function setCorpseIntegrity(v: number): void { CORPSE_INTEGRITY.value = Math.min(1, Math.max(0, v)); }
const BRACE_TOL = { trunk: { loose: 0.6, tight: 0.04 }, head: { loose: 0.75, tight: 0.15 } };
export function braceTolerance(group, integrity): number  // lerp(loose, tight, integrity)
export function collapseBraces(names, restPose): BraceLimit[]
export function relaxBraces(points, braces, integrity, iterations): RigPoint[]  // integrity <= 0 → same array back
```

- [ ] Run the tests, then commit.

### Task 5: Wire braces, floor girth, topple and skull follow through motion

**Files:**
- Modify: `motion.ts` (`MotionJoints.braces`, `MotionJoints.floorLift`, frame `braces`, `integrity`, `floorLift`,
  `headFollow`, the topple kick at fall start), `actor.ts`, `webgpu/game-actor.ts` (both rig loops),
  `rig.ts` (`headFollow?: number`), `rig-bind.ts` (`headPose`, `headTransform` and the face clamp at line ~991 blend
  `clampDir` toward the rig direction by `headFollow`), `motion-profile.ts` (`corpseIntegrity?: number`).
- Test: `src/lab/sdf-zombie/corpse-integrity.test.ts` (new). Run `makeActorMotion` and `stepActorMotion` with a forced
  collapse over seeds 1 to 4, at integrity 0.7. Assert:
  - Settled head-to-pelvis distance is at least 0.7 × rest, and chest-to-pelvis at least 0.8 × rest.
  - The chest's y is below 0.5.
  - Every point is at or above `floorY + floorLift[i] - 1e-6`.
  - The maximum point speed over the last 30 frames is below 2 mm per frame.
  - At integrity 0, joint positions equal a run with braces stripped (bit-identical to today).
  - One quadruped (gorehound) settles, with its numbers logged.
- [ ] Write the test, run it (expect a FAIL), implement, run it (expect a PASS), then commit.

### Task 6: Debug panel and seams

**Files:** `webgpu/wound-panel.ts` (keys `shoulderToughness`, `elbowToughness`, `corpseIntegrity`),
`webgpu/game-wound-tuning.ts` (route those keys to `setJointToughness` and `setCorpseIntegrity`), plus the existing
panel test.

- [ ] Add the keys, run `npx vitest run src/lab/sdf-zombie/webgpu/wound-panel.test.ts`, then commit.

### Task 7: Verify

- [ ] Run `npm run typecheck` and `npm run test:changed`.
- [ ] Run `npm run dev:arena`, shoot the arms and legs of the zombie and one other character, and capture the results.
- [ ] Capture forced kills (`K`) at integrity 0, 0.7 and 1, from the side.
- [ ] Update `docs/tasks/combat-and-gore.md` and `TASKS.md` if the in-flight list changes.
