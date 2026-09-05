# Soldier animation — phase 1 look (2026-09-05)

Spec: `docs/superpowers/specs/2026-09-05-soldier-animation-design.md` ·
plan: `docs/superpowers/plans/2026-09-05-soldier-animation.md` (14 tasks,
dispatched on kimi/k3:high; tasks 1–13 landed, task 14 ran for 7 s and did
nothing, so the turntable flag, these strips and TASKS were done by hand).

## Strips (8 yaws each, `BLOB_POSE=` on the turntable)

| strip | what to look at |
| --- | --- |
| `rest/` | the historical rest turntable; kit and gun at bind |
| `walk/` | `march` gait, `low` carry — gun level at the waist, left hand on the fore-end |
| `run/` | `run` gait, `chest` carry — long stride, 12° lean, gun across the chest |
| `hip/` | `hip` carry held after a fire signal — both hands on the gun, elbows tucked |
| `goblin-walk/` | the goblin now walks (it had no motion at all before this work) |

## Carry numbers as shipped (`carry.ts` CARRIES) — owner's to tune

| carry | right pitch / yaw / fold | gunPitch |
| --- | --- | --- |
| low | 0.18 / 0.10 / 0.70 | −0.30 |
| chest | 0.60 / 0.40 / 1.55 | +0.55 |
| hip | 0.32 / 0.05 / 1.30 | −0.05 |

First impressions from the frames: `hip` reads a touch high (the gun sits at
the lower chest, not the waist) and `chest` reads as port-arms with the right
elbow high. Both are pitch/fold numbers, not code.

## Two dispatch misses, fixed by hand after the chain

1. three's GLTFLoader strips `. [ ] : /` from node names, so `clavicle.l`
   arrives as `claviclel` and every mirrored kit bone missed its frame (the
   pauldrons stayed on the torso while the arms moved). `kitBoneKey()` in
   `rig-frames.ts` is the sanitiser; `KitOverlay.pose` matches through it.
2. `setMotionEnabled(false)` is not a freeze: it rewrites the rest pose to
   the authored base, so the first held-pose strips showed an A-pose with the
   gun a metre away. `holdPose` now freezes with a `poseHeld` flag that stops
   every step and touches nothing.

Pre-existing, not from this work: a WebGPU "Binding size for Buffer is zero"
validation error on lab boot, present on the zombie page too.
