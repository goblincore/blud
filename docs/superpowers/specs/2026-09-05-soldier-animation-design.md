# Soldier animation — rig-driven kit, gait profiles, arm carries, hip fire

> Date: 2026-09-05
> Status: approved design, awaiting plan
> Scope: phase 1 of 3 (this doc). Phase 2 = shoot-back AI in sdf-game.
> Phase 3 = shouldered aim + soldier-specific death.

## Why

The soldier (`characters/soldier.blob` + `soldier-kit.wam`) is the first
non-zombie character headed for the game, and the template for every enemy
that shoots back. Nothing in the motion system knows how to move him:

1. **The gait does not know his bones.** `gait.ts`'s `JOINT_AT` maps only
   the zombie's names (`spine`, `upperArm`, `foreArm`). The soldier and the
   goblin use `spine1/chest/spine2`, `upperarm/forearm/hand`, `foot`. Today
   their legs stride and their arms and spine receive nothing.
2. **The kit does not move.** `kit-overlay.ts` places the compiled glTF once
   at the root. The rig walks, the flesh leaves its armour behind. A held
   weapon has the same problem.
3. **There is no fire pose.** The zombie's arm styles are `swing` and
   `reach`. Neither holds a gun.

Death is out of scope: collapse and gib are inherited as-is.

## Decisions (owner, 2026-09-05)

| Question | Answer |
| --- | --- |
| Scope | Animation and re-rigging only, judged in the lab. No AI, no game-page spawn. |
| Procedural vs baked | Procedural. Every hit reaction (stagger, sever, collapse, gib) already works by shoving the rig's rest targets; a baked clip would layer under all of it. The reference mesh carries one clip (a walk) and nothing else. |
| Locomotion | Two distinct gaits — `march` and `run` — blended by speed. |
| Shot | Hip fire first. The carry table is shaped so shouldered aim is a fourth row later. |
| Death | Inherit collapse and gib unchanged. Kit follows the rig down; the gun drops. |
| Weapon | `public/assets/lab/shorty-double.glb`, the FPV double shotgun, as a placeholder. |
| Joint schema | Grows by eight SECONDARY names (spineA, spineB, clavicleL/R, handTipL/R, toeL/R). Discovered in planning: the goblin and soldier get NO motion today — bindRig makes a rig point for every bone end, jointNamesForBody could not name them all, and makeMotionJoints returned null on the count mismatch. |
| Gun frame | The gun rides the right FOREARM frame (elbow→hand), not the hand bone: a 24 cm lever is steadier than a 9.5 cm bone whose tip is a free verlet point. |
| Left hand | IK-solved (FABRIK, segment lengths preserved) onto the gun's Fore_Hand locator. Lengths are exact, so this is not an additive displacement. |
| Lab keys | `1` walk band, `2` run band, `F` fire. Collapse stays on the existing `K`. |

## 1. Bone frames drive the kit and the prop

The compiled kit is already a **skinned** glTF whose bone nodes carry the
blob's bone names (`pelvis … hand.r … foot.l`), and `KitOverlay.bones`
exposes them as "the seam a future rig bind will drive". The kit needs a
bone-pose feed, not a re-parenting scheme.

### rig-frames.ts (new, pure)

`boneFrames(body, bound, bodyYaw): Map<string, { pos: Vec3; quat: Quat }>`

One rigid transform per blob bone from the posed rig:

- position = the bone's head rig point;
- rotation = bind head→tail direction rotated onto the posed direction;
- roll carried from the parent bone's frame so a limb never spins about
  its own axis (a two-point bone has no roll of its own);
- bones whose tail is not a rig point (`hand`, `foot`, `spine2`) take the
  parent's frame composed with their bind offset.

`HeadRigid` and `BoneFrame` in `rig-bind.ts` already derive rigid
transforms from two rig points for the head and the axial torso segments.
They become callers of `boneFrames` rather than a second implementation.
No THREE in this module; output is deterministic.

### KitOverlay.pose (new method)

`pose(frames, bodyYaw, rootShift)` writes each frame into the matching
`THREE.Bone` (world position + quaternion, then the skinned mesh does the
rest). Bones the kit has but the rig does not fall back to parent + bind
offset (rule above). Called every frame after `applyRig`.

### held-prop.ts (new)

```ts
interface HeldProp {
  object: THREE.Object3D;        // loaded glTF
  bone: string;                  // 'hand.r'
  grip: { pos: Vec3; quat: Quat }; // offset in the owning bone's frame
  muzzle(): Vec3;                // world muzzle locator, for phase 2
  release(vel: Vec3): void;      // drop: ballistic tumble to the floor
}
```

The grip offset for the shorty is a constants table entry, authored once
against the `hip` carry (§3). Each frame the prop takes the `hand.r` frame,
applies the grip, adds the per-shot muzzle-rise nudge (§3). On collapse
or gib the prop unbinds and drops with the ejected-shell tumble math from
the FPV reload, then stays as a floor prop. The shorty glTF already has
Muzzle/Breech locator nodes; `muzzle()` reads Muzzle.

### Gate: rest identity

With the rig at rest, every kit bone frame equals bind (within 1e-6), so
the posed kit renders identically to today's static placement. Pinned by
a test; the turntable is the visual check.

## 2. Gait profiles and bone aliases

### Aliases (gait.ts JOINT_AT)

| bone | head | tail |
| --- | --- | --- |
| spine1 | hips | — |
| chest | — | — |
| spine2 | — | — |
| upperarm | shoulder | elbow |
| forearm | elbow | hand |
| hand | hand | — |
| foot | foot | — |

The `chest` joint stays the neck bone's head (as today). With a spine2
bone present, the chest bone's tail and the neck's head are different
points, so `chest` and `spine2` contribute no joints of their own and the
spine chain is pinned at hips and chest only — the rig's length
constraints carry the intermediate points. The 17-joint `GaitJointName`
schema is unchanged. Test: binding the
soldier and the goblin yields every arm and leg joint name.

### Profiles

`GAIT_TUNING` becomes a `GaitProfile` type. The zombie's numbers are the
`shamble` profile verbatim, so zombie output is bit-identical after the
refactor (determinism test, 600 frames).

| knob | shamble (zombie) | march | run |
| --- | --- | --- | --- |
| strideFreq (Hz) | 1.05 | 1.6 | 2.4 |
| strideLen (m) | 0.32 | 0.45 | 0.75 |
| footLift (m) | 0.16 | 0.10 | 0.22 |
| stanceDuty | 0.62 | 0.58 | 0.45 |
| bobAmp (m) | 0.035 | 0.02 | 0.04 |
| swayAmp (m) | 0.05 | 0.03 | 0.03 |
| torsoLean (deg, new) | 0 | 0 | 12 |
| armStyle | reach | carry:low | carry:chest |

Numbers are starting points for the owner's look, not contracts.

`stepGait` takes a profile pair and a blend weight from speed: 0 below
1.6 m/s, 1 above 3.0 m/s, linear between. Every scalar knob lerps; the
arm carry snaps at weight 0.5 so hands never hover between grips. The
soldier's wander max speed rises to a per-character value so he reaches
the run band in the lab.

**Torso lean** is a new pose term: a pitch of the chest, neck and head
rest targets about the hips joint. A rotation of targets, never a
displacement (the reach-pose lesson: displaced targets shorten segments,
the length constraints win, the shoulder leaves the torso).

All pure functions of (state, seed, dt).

## 3. Arm carries and the hip-fire shot

### carry.ts (new)

A third `ArmStyle`, `carry`, authored as **shoulder rotations plus an
elbow fold per arm** — never hand displacements. Table:

| carry | read | used by |
| --- | --- | --- |
| low | gun hangs at the right hip, muzzle forward-down, left hand loose on the fore-end | march |
| chest | gun diagonal across the chest, both hands on it | run |
| hip | gun level at the waist along body forward, both hands gripping, elbows tucked | fire |
| (shoulder) | phase 3: butt to right shoulder, head tilt term | — |

The gun's grip offset (§1) is authored against `hip`. `low` and `chest`
put the hands where the gun would be, so one grip offset serves every
carry.

### Firing (motion.ts)

A `fire` signal enters `MotionSignals` beside `shot`. On the frame it
arrives:

1. `carryOverride = 'hip'`, held for `fireHoldSec` (default 0.6) after
   the last shot, then released to the gait's carry;
2. stride amplitude scales to 0.4 while the override holds (burst while
   moving = reduced stride, then back to the run);
3. `impulseAt` on both hand rig points backward along body forward, a
   smaller one on the right shoulder. The rig's damping and rest pull
   settle the arms in ~0.3 s. No separate recoil animation;
4. the prop's grip gets a rotation nudge (muzzle rise) decaying on the
   same clock.

`HeldProp.muzzle()` is the phase-2 seam for pellet spawn.

## 4. Lab wiring, gates, out of scope

### motion-profile.ts (new)

Per-character `MotionProfile` — gait pair, carry set, wander speed
bands — keyed by character name. Zombie = shamble + reach (unchanged).
Goblin = aliases + shamble. Soldier = march/run + carries + shorty prop.

### lab-main.ts on `?character=soldier`

- Kit and shorty load; both posed every frame from `boneFrames`. Motion
  no longer has to be frozen to judge the kit.
- Keys: `1` walk speed, `2` run speed, `F` fire, `X` force collapse. Added
  to the key table and the panel's help text.
- Turntable (`scripts/blob-turntable.mjs`): `--pose walk|run|hip` steps
  motion a fixed frame count before capture.

### Death

Nothing new. Collapse and gib inherited. The gib hide-body hook also
hides the kit; the prop releases on both paths.

### Gates

| gate | assertion |
| --- | --- |
| determinism | zombie gait output bit-identical before/after the profile refactor, 600 frames |
| rest identity | soldier kit frames at rest == bind, 1e-6 |
| alias coverage | soldier and goblin bind every arm and leg joint |
| carry pose | under `hip`, both hand rig points within 2 cm of the gun's grip points; no arm segment stretched > 1 % |
| recoil settles | after `fire`, hand targets back within 1 cm of the carry inside 0.5 s |
| visual | turntable strip per carry + a walk-to-run capture for the owner |

### Out of scope

No AI, no soldier pellets, no player damage, no game-page spawn, no
shouldered aim, no knee-buckle death. `game-main.ts` untouched.

## Files

New: `rig-frames.ts`, `held-prop.ts`, `carry.ts`, `motion-profile.ts`
(+ tests). Modified: `gait.ts` (aliases, profiles, lean), `motion.ts`
(fire signal, carry override), `rig-bind.ts` (head/torso via rig-frames),
`webgpu/kit-overlay.ts` (`pose`), `webgpu/lab-main.ts`,
`scripts/blob-turntable.mjs`.
