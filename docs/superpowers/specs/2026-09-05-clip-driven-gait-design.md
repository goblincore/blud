# Clip-driven gait curves — a real stride shape, still procedural

> Date: 2026-09-05
> Status: approved in dialogue (owner: "lgtm, zombie biped run is fine")
> Follows: `2026-09-05-soldier-animation-design.md` (phase 1)

## Why

The owner's look at the soldier's run (2026-09-05): "spazzed out... walk is
okay but stiff, run cycle looks weird and also stiff." The gait
(`gait.ts`) is four sinusoids per leg with hand-picked amplitudes. A real
stride is not sinusoidal: the knee flexes sharply through swing, the foot
hangs and then snaps down, the hips drop at contact. Knob-tuning cannot turn
sine waves into that shape, and the run falls apart once the amplitudes are
big enough to read.

## What

**Sample a reference clip once into per-phase curves; drive the legs and the
root from those curves.** Everything downstream is untouched: the verlet rig,
foot-plant IK, stagger, carries, gibs, kit and gun still consume the same
rest-target offsets `stepGait` emits today. The zombie keeps its sinusoid
shamble, bit-pinned.

### References (same Meshy biped rig family, identical joint names)

| clip | file | use |
| --- | --- | --- |
| walk | `docs/dev-notes/refs/soldier-mesh/soldier.glb` — `Walking`, 32 frames, 1.07 s | `MARCH` |
| run | `docs/dev-notes/refs/soldier-mesh/zombie-biped-running.glb` — `Armature\|running\|baselayer`, 20 frames, 0.67 s | `RUN` |

Each clip is exactly one stride cycle. Units are centimetres; the sampler
normalises by leg length so units and proportions cancel.

### The curve table (`GaitCurves`)

Sampled at `N = 32` evenly spaced phases over one cycle, phase 0 = LEFT heel
strike (the sample where the left thigh is pitched furthest forward).
Angles are in the sagittal plane (radians), lengths as fractions of the
reference leg length (thigh + shin):

- `hipsY[i]` — hips height minus its cycle mean, / leg length;
- per side `L`/`R`: `thigh[i]` — thigh pitch forward from straight down;
  `knee[i]` — knee flexion (0 = straight, positive = bent); `stance[i]` —
  foot within 3 % of leg length of its lowest height that cycle. (No foot
  pitch: the toe follows the ankle rigidly in this rig, so it would be
  sampled and never read.)
- `freq` — 1 / clip duration (Hz); `travel` — the stance foot's fore-aft
  travel relative to the hips per cycle, / leg length (what cruise should
  be, times leg length times freq, to avoid skating).

Emitted as TypeScript constants by `scripts/gait-from-clip.ts` so the
runtime never reads a glb.

### Retargeting

Angles are proportion-free. `stepGait` gains an optional `limbs` argument —
the body's REST segment vectors per leg, body-local (thigh, shin) — and, in
curve mode, rebuilds knee and foot positions from the curve angles with the
body's own segment lengths, then emits `position − rest position` as the
offset. The knee bow is no longer a knob: it is whatever the clip's knee
did. Root bob comes from `hipsY × legLength`. Sway, rock, shoulder
counter-sway and the arm styles stay as they are (the soldier's arms are
carry-driven anyway).

### Blend and skews

- `blendProfiles` lerps curves sample-wise when both profiles carry curves
  (same N, both aligned to left heel strike). A profile without curves keeps
  the sinusoid path.
- Missing leg → zero offsets (unchanged). Wounded leg → angles scaled by
  `woundedSwingScale`. Hop-limp → sinusoid path (the curves describe a
  two-legged stride).
- `stance` from the curve feeds the plant IK exactly as the sinusoid duty did.

### Profiles

`MARCH.curves = SOLDIER_WALK`, `RUN.curves = SOLDIER_RUN`; `strideFreq`
comes from the curves. `SOLDIER_PROFILE.cruise` and `runBand` derive from
`travel × legLength × freq` of each clip (printed by the sampler) so the
feet do not skate.

### Gates

- zombie pins unchanged (`gait-pins.test.ts`);
- sampler on the walk clip: 32 samples, peak knee flexion 0.6–1.4 rad,
  stance duty 0.55–0.70, `travel > 0`; on the run clip: peak knee flexion
  above the walk's, stance duty below 0.55;
- curve-mode gait on the soldier: knee point leaves the hip→ankle line by
  > 8 cm at peak swing, both feet never in the air at once for the walk,
  a flight phase exists for the run;
- turntable strips `walk/` and `run/` for the owner.

### Out of scope

Arm curves (carries own the soldier's arms), upper-body curves, the
zombie, any change to the rig/IK/stagger.
