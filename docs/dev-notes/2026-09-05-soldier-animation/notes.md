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

## Round 2 (owner's first look, 2026-09-05)

Owner: firing and aiming look good; the run "doesn't bend his knees, his
legs just stretch out"; the chest armour clips through the body ("make it
bigger and more like a vest"); feet clip through the boots ("make the boots
bigger, cartoonishly").

- **Run knees.** `RUN.strideLen` 0.75 → 0.42 on 0.84 m legs (the reach was
  nearly the whole leg, so the swing leg had to straighten to get there),
  `footLift` 0.22 → 0.28, `kneeBend` 0.12 → 0.26, `kneeLift` 0.14,
  `kneeTrack` 0.35. `MARCH.strideLen` 0.45 → 0.34 for the same reason.
- **Vest.** Cuirass rings ~25 mm off the flesh (was 10), runs down to the
  belt line (ring 0.30), keeps its width at the top. Front plate moved 20 mm
  forward to stay proud of it.
- **Boots.** The boot's foot shell moved from the SHIN bone to the FOOT bone
  (the flesh foot rides the foot frame, which stays level; a shell on the
  shin tilted with every stride). Rings ~1.45x wider, 25 mm taller, sole
  still on y=0; the shaft flares into the boot instead of narrowing.
- Strips re-shot: `rest/`, `walk/`, `run/`. Kit fit test still green.

## Round 3 — clip-driven curves

Spec: `docs/superpowers/specs/2026-09-05-clip-driven-gait-design.md` · plan:
`docs/superpowers/plans/2026-09-05-clip-driven-gait.md`. The march and run no
longer draw their stride shape from hand-tuned sinusoids: each gait carries
`GaitCurves` — per-phase sagittal angles (thigh pitch, knee flexion, hip bob,
duty) sampled at 32 phases from a reference clip by
`scripts/gait-from-clip.ts` and shipped as constants in `gait-curves/`.
`stepGait` rebuilds knee and foot offsets from those angles with the body's
own segment lengths; the zombie has no curves and stays bit-identical
(`gait-pins.test.ts` still green).

Reference clips:

- **March** — `soldier.glb` clip `Walking` (32 keys, 1.07 s).
- **Run** — `zombie-biped-running.glb` clip `Armature|running|baselayer`
  (20 keys, 0.67 s, Meshy zombie biped).

Implied speeds (from the sampled tables, for the soldier's 0.84 m leg):
walk 0.937 Hz / duty 0.63 → **1.12 m/s**; run 1.500 Hz / duty 0.31 →
**3.22 m/s**. Profile numbers chosen from those: `runBand` 1.32 → 3.02 m/s
(the walk→run blend brackets the two clips' speeds), `cruise` 3.2 m/s (the
run clip's implied speed rounded to 0.1).

Strips re-shot (`walk/`, `run/`, 8 yaws each). Viewed the PNGs this round:
the walk side-on frames show a split stride with the swing knee visibly
bent and feet on the ground plane; the run frames show the swing leg
folded up behind (deep knee flexion off the running clip) with the stance
foot planted. No feet through the floor; the kit (vest, pauldrons, boots)
and gun stay on the body through the stride in both strips.
