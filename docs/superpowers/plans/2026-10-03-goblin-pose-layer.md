# Goblin pose layer Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An engine layer that makes a rig hold an authored pose (bone angles) or play a short keyed clip of them, with the first goblin poses (type, recoil, sit/stand blends) checked in the lab.

**Spec:** `docs/superpowers/specs/2026-10-03-goblin-pose-layer-design.md` — read it first.

**Architecture:** A pure `pose.ts` resolves a pose (per-bone absolute pitch/tilt overrides) through the existing `resolveBones` into world joint positions in rig-point order, interpolates keys in angle space, and ground-locks. `stepMotion` takes `cfg.pose` (a ready array of joint positions), writes it to `restPose` and pins every point. The lab samples a clip per frame and feeds it in.

**Tech Stack:** TypeScript, Vitest, the lab turntable (`npm run blob:shot`, `BLOB_POSE=pose:<name>`).

## Rules for every task

- Work ONLY in this worktree. Never `git stash`. `node_modules` is in place.
- **Targeted tests** (`npx vitest run pose motion goblin`) plus `npx tsc --noEmit` (only the pre-existing `pack-golden` error is acceptable); the full `src/lab/sdf-zombie/` suite runs once, in Task 6.
- **Headless capture only.** `BLOB_PROBE` takes an async JS expression; env vars do NOT persist between Bash calls (set them in the same command).
- **Pure logic in `pose.ts`** (no `three`, plain data in and out); the wiring only reads its output.
- **Every number has a source** in its comment: the look-dev notes, a measurement, or "eyeballed in the lab, frame N".
- One change per render. The owner reviews visual changes step by step.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lab/sdf-zombie/pose.ts` (create) | `PoseKey`, `PoseClip`, `makePoseRig`, `poseJoints`, `sampleClip`, ground-lock |
| `src/lab/sdf-zombie/pose.test.ts` (create) | pure tests on the goblin's skeleton |
| `src/lab/sdf-zombie/motion.ts` (modify) | `MotionConfig.pose`; write `restPose`, pin all points |
| `src/lab/sdf-zombie/characters/goblin-poses.ts` (create) | the goblin's poses and clips (data) |
| `src/lab/sdf-zombie/webgpu/lab-main.ts` (modify) | `holdAuthoredPose(clip, t)` on `__sdfLab` |
| `scripts/blob-turntable.mjs` (modify) | `BLOB_POSE=pose:<name>`, `BLOB_POSE_T` |
| `docs/dev-notes/2026-10-03-goblin-poses/` (create) | frames and notes |

---

## Task 1: The pure pose module

**Files:** create `pose.ts`, `pose.test.ts`.

- [ ] **Step 1: Failing tests** (`pose.test.ts`), using `goblin.blob`:
  - `rest key reproduces the compiled skeleton`: a key with no overrides gives joint positions equal to `joints.base` (within 1e-9) in rig-point order.
  - `bone lengths are preserved` at the type key, the recoil key and a 50% blend: for every bone, |tail - head| equals the rest length.
  - `over-90-degree pitches resolve`: recoil's `upperarm.l` tail is ABOVE its head (dir.y > 0) and `forearm` more so; `hand` too.
  - `thigh 86 puts the knee in front of the hip` (knee.z - hip.z > 0.25 m for the 0.29 m thigh).
  - `blending interpolates angles, not positions`: at t = 0.5 between rest and a 90-degree `upperarm` swing the arm length is still the rest length (position lerp would give 0.707 of it).
  - `ground-lock`: with `groundLock` the lower of footL/footR sits at `base` ground height; without it the root is untouched.
  - `clip sampling`: before the first key the first key holds, after the last the last holds, an eased key interpolates by its ease.
- [ ] **Step 2: Implement `pose.ts`.** API:

```ts
export interface BoneAngle { pitch?: number; tilt?: number }          // degrees, absolute, like .blob bone lines
export interface PoseKey {
  t: number;                                                          // seconds
  bones: Record<string, BoneAngle>;                                   // BASE bone names (mirrored bones take both sides)
  root?: { x?: number; z?: number };                                  // metres added to the pelvis, rest frame
  groundLock?: boolean;                                               // default true
  ease?: 'linear' | 'smooth';                                         // easing INTO this key from the previous one
}
export interface PoseClip { name: string; keys: PoseKey[] }
export interface PoseRig { /* opaque: def, doc, jointMap, names, base */ }
export function makePoseRig(doc: BlobDoc, names: readonly GaitJointName[], base: readonly Vec3[]): PoseRig;
export function poseJoints(rig: PoseRig, clip: PoseClip, t: number): Vec3[];   // rig-point order, rest-world frame
```

  Internals: `compileBlob(doc)` once for the `BodyDef`; per frame replace each overridden bone's `dir` with `dirVector(word, pitch, tilt)` (the doc bone's word, pitchDeg and tiltDeg are the defaults), `expandMirror({ ...def, bones, prims: [] })`, `resolveBones(expanded.bones, expanded.root)` with `root` shifted by `key.root`, then each joint's position is the head or tail of the bone end that `jointForBoneEnd` names (match by name and by rest position within 1e-4, as `jointNamesForBody` dedups). Interpolate per bone: effective pitch/tilt at each of the two bracketing keys (override or the doc value), lerp with the eased fraction. Ground-lock: after resolving, translate every joint in y so `min(footL.y, footR.y)` equals `min(base footL.y, base footR.y)`, unless the interpolated key says otherwise.
- [ ] **Step 3: Run** `npx vitest run pose`. Expected: PASS. `npx tsc --noEmit`.
- [ ] **Step 4: Commit** `feat(pose): pure pose and clip module (bone-angle FK, angle-space blending, ground-lock)`.

## Task 2: The seam in stepMotion

**Files:** modify `motion.ts`; test in `motion.test.ts` (or a new `pose-motion.test.ts`).

- [ ] **Step 1: Failing test:** build the goblin's `MotionJoints` and rig the way `gait.test.ts` does (`bindRig`, `makeMotionJoints`), call `stepMotion` with `cfg.pose = poseJoints(rig, typeClip, 0)` for 30 frames, and assert `frame.restPose[i]` equals the pose (after the yaw/shift transform, zero here) and `frame.posePins` has every index.
- [ ] **Step 2: Implement.** Add `pose?: readonly Vec3[]` to `MotionConfig` (documented: joint positions in rig-point order in the REST world frame, from `poseJoints`). Just before `nextState` is assembled: if `cfg.pose` is set and the body is not collapsed, replace `targets[i]` with `pivot + shift + rotateYaw(pose[i] - pivotXZ) ` keeping y absolute (same transform as the rest targets), and make the frame's `posePins` list every index. The gait, carry, aim and plants still run (they are cheap and their state stays warm) but their targets are overwritten.
- [ ] **Step 3: Tests pass; run the existing motion and rig tests** (`npx vitest run motion rig`): no change to any other character.
- [ ] **Step 4: Commit** `feat(motion): cfg.pose writes the rig targets and pins every point`.

## Task 3: Lab access and the first look

**Files:** modify `lab-main.ts`, `blob-turntable.mjs`; create `goblin-poses.ts` with `type` only.

- [ ] **Step 1:** `goblin-poses.ts` exports `GOBLIN_POSES: Record<string, PoseClip>` with `type` from the look-dev numbers (single key).
- [ ] **Step 2:** `__sdfLab.holdAuthoredPose(name, t = 0, frames = 30)`: builds the `PoseRig` once for the lab's current character (the lab has the doc: `CHARACTERS[name].src` via `parseBlob`), steps the motion `frames` times with `cfg.pose = poseJoints(rig, clip, t)`, then freezes like `holdPose` (`poseHeld = true`). Returns `{ pose, t }`.
- [ ] **Step 3:** `blob-turntable.mjs`: `BLOB_POSE=pose:<name>` calls it, `BLOB_POSE_T` sets t.
- [ ] **Step 4: Shoot** `pose:type` (front, side, back, three-quarter). Look at the frames and say what is wrong: spine, neck, arms, thighs, kit following, armour against head.
- [ ] **Step 5: Commit** `feat(goblin): the type pose in the lab`.

## Task 4: Recoil, tune, and the kit

- [ ] Add `recoil`. Shoot it. The arms at 150-175 degrees are where the rigid kit pieces break: check the pauldrons, lames, yoke and collar and say what clips.
- [ ] Tune the numbers by eye, one pose at a time, one render each; each number's comment names the look-dev value and what the lab frame changed.
- [ ] **Commit** `feat(goblin): recoil pose and tuning`.

## Task 5: Clips (sit, stand, type to recoil)

- [ ] Two-key clips: `sit` (rest -> type, 0.8 s, smooth), `stand` (type -> rest, 0.8 s, smooth), `jolt` (type -> recoil, 0.25 s, linear then settle). Shoot t = 0, 0.25, 0.5, 0.75, 1 of each as a contact sheet and check no limb shortens (the angle-space blend) and the feet do not leave the floor.
- [ ] **Commit** `feat(goblin): sit, stand and jolt clips`.

## Task 6: Gates and board

- [ ] `npm run blob:render-check -- goblin`, `npx tsc --noEmit`, `npx vitest run src/lab/sdf-zombie/` (all pass).
- [ ] Update `docs/tasks/characters.md` (phase 4b slice 1 built), `TASKS.md`, the Flat spec's open item ("the held pose seam"), and the dev-notes; dualmem checkpoint.
- [ ] Commit `docs(goblin): pose layer frames, notes and board`. The owner's look is the gate.

## Self-review

Spec coverage: pose = bone angles -> Task 1; angle-space blend -> Task 1 test; clip = timed keys -> Tasks 1 and 5; targets + pins -> Task 2; ground-lock -> Task 1; first poses -> Tasks 3-5; kit and >90 degrees -> Tasks 1 and 4; gate -> Task 6. Known limits: poses are judged on the ARMOURED goblin (the vest and shorts are a separate slice); entry from a moving gait pops (documented); no hand-on-prop contact; no chair, so a seated pose floats on nothing in the lab (the lab's reference cube is the nearest stand-in).
