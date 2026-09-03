# Shorty breech mechanism — hollow chambers, shells in the tubes, a real eject

**Date:** 2026-09-03
**Status:** approved, ready for planning
**Touches:** `scripts/model_grapeshot_shorty.py`, `src/lab/sdf-zombie/webgpu/game-viewmodel.ts`,
`src/lab/sdf-zombie/webgpu/game-main.ts`, `ATTRIBUTIONS.md`

## The report

> "when the shotgun splits to eject the shell casings, the tube is solid, not
> hollow so it looks weird. Also the ejected shells don't come out of the right
> location since they should come from the split shotgun tubes."

## What is actually wrong

Rendered evidence, not inference: importing the shipped `shorty-double.glb`,
rotating `Barrels` 45° about `Hinge` and rendering from the FPV camera shows
**two solid domed steel knobs** where the chamber mouths should be.

Three defects, all in the same place.

### 1. The chambers are solid

`scripts/model_grapeshot_shorty.py` builds each chamber as

```python
put(cyl(RO*1.07, 0.034), f'chamber{i}', 'Steel', loc=(x, -0.048, 0), rot=(RY,0,0), ...)
```

`cyl()` is capped at both ends. There is no hole. The thin dark `mouth{i}`
annulus glued nearby is a painted-on fake, and it does not survive being looked
at from the open breech.

### 2. The breech-face detail is on the wrong end of the part

Measured in Blender space (grip origin, muzzles down −Y, Z up, **+y rearward**):

| feature | y span |
| --- | --- |
| barrel tube | −0.318 … −0.060 |
| chamber sleeve | −0.065 … −0.031 |
| **the breech face is therefore** | **y = −0.031** |
| but `mouth{i}` sits at | y = −0.0655 |
| and `extractor` sits at | y = −0.066 |

The mouths and the extractor are placed at the chamber's **front**, 35 mm from
the breech face, buried inside the frame beside the hinge pin. They are never
visible. This was not in the original report but it is the same bug.

### 3. The eject origin is a stale constant

`game-main.ts:2254`:

```ts
const breech = new THREE.Vector3(0.105, -0.075, -0.360);
```

Two failures. `x = 0.105` predates commit `1e99b54`, which centred the gun; the
real chambers are now at x ≈ 0.015 and 0.061. And the vector is **static**, so
it does not follow the barrels through their 35° swing. Cases are thrown from a
fixed point in mid-air near where the breech used to be.

## The reference

`docs/dev-notes/refs/sawnoffs_animated.glb` — *"sawnoffs Animated"* by
**DJMaesen (bumstrum)**, **CC-BY-4.0**. Used as a mechanism-and-timing
reference. Its animation channels, decoded:

| t (abs) | node | event |
| --- | --- | --- |
| 1.000 | `release` | top lever yaws 40° about Y — **before anything else moves** |
| 1.167 | `front` | barrels start down, 11° |
| 1.267 | `slug1`/`slug2` | shells begin a **pure axial slide** straight back out of the bore |
| 1.333 | `front` | fully open, **45°** |
| 1.333 | `slug*`, `unloader` | shells clear; the extractor slides back with them and **holds out** |
| 1.467 | `slug*` | rotation channels engage — the cases break into a free tumble |
| 1.933 | `slug*`, `unloader` | fresh shells seated, extractor retracts |
| 2.167 → 2.300 | `front` | snaps shut in 0.13 s |

Two structural facts drive this whole design:

1. **`slug1`/`slug2` are children of `front`.** They inherit the break rotation
   for free, so they leave along the true bore axis without anyone computing a
   rotated basis.
2. **The eject is two-stage** — a short axial extraction *inside* the barrel's
   frame, then a hand-off to a free ballistic tumble.

### Explicitly not taken from the reference

Its **dimensions**. The reference is a dimensionally accurate 12-gauge (20.8 mm
shells, 50 mm across the barrel pair at our gun's length); ours is ~1.8× fatter
throughout. That is a deliberate stylistic choice for a fantasy setting and
**stays as it is**. Nothing in this spec changes `RO`, `RI`, `XSEP` or `HW`.

## Design

### A. Model — `scripts/model_grapeshot_shorty.py`

New constants:

```python
RCH  = RI * 1.10      # 0.01826 — chamber bore, wider than the barrel bore
CY1  = -0.031         # the breech face
CY0  = CY1 - 0.070    # -0.101, chamber floor: 70 mm deep to hold a 70 mm shell
```

The 70 mm depth is dictated by **our own shell length**, not by realism: a 70 mm
shell in the current 34 mm sleeve would stand 36 mm proud of the breech.

| part | change |
| --- | --- |
| `chamber{i}` | solid `cyl` → `tube(RO*1.07, RCH, 0.070)` spanning `CY0…CY1`. A real hollow sleeve. |
| `barrel{i}` | shortened to start at `CY0` (`y −0.318 … −0.101`) so the chamber bore and the barrel bore meet exactly once |
| forcing cone | **new** — tapered tube, inner radius `RCH` at its rear face and `RI` at its front, occupying the barrel's first 8 mm at `y −0.109 … −0.101`, `Bore` material. The step that makes the chamber read as a chamber. |
| `mouth{i}` | **moved to `CY1`** and re-materialled `Bore` → `Steel`: a machined rim. The darkness now comes from the real hole behind it. |
| `bore{i}` | dark plug extended rearward to `y = −0.109` — i.e. right up to the front of the forcing cone — so looking into the open breech reads as depth rather than a lit tube wall |
| `Shell_L` / `Shell_R` | **new** — brass head + red hull, sized to `RCH`, seated rim-flush at `CY1`, parented **under `Barrels`** |
| `Breech_L` / `Breech_R` | **new locators** under `Barrels` at `(±XSEP, CY1, 0)` |
| `Extractor` | existing box moved to `CY1` and put on a named node the runtime slides |
| `TopLever` | existing `toplever` box put on a named pivot at its root so it can yaw 40° |

`Shell_*`, `Breech_*` and `Extractor` join the `swing` tuple so they parent under
`BARREL_NODE`. `TopLever` stays on the frame.

### B. Timing — `src/lab/sdf-zombie/webgpu/game-viewmodel.ts`

Retimed to the reference. Total **1.30 s** (was 1.05 s); the present beat is
folded into the lever throw so the extra length is all mechanism, not preamble.

```
0.00        present begins; top lever throws to 40°
0.18        lever home; barrels start down
0.45        shells begin their axial slide out of the bore
0.51        barrels at 45°; shells clear → hand off to the tumble
0.65        cases tumbling clear
0.74–1.11   support hand carries two fresh cases up and seats them
1.16–1.30   snap shut
```

`openRad`: 0.61 → **0.785** (35° → 45°). Open takes 0.33 s, shut takes 0.14 s —
the reference's exact asymmetry, and a harder clack than the current 0.18/0.14.

New exported functions, all pure and unit-testable with no renderer:

- `topLeverAngle(t): number` — radians, 0 → 40° → 0.
- `extractStage(t): number | null` — normalised 0..1 axial travel of a seated
  shell, `null` before the extract beat and once the shell has been handed off
  to the tumble. The runtime scales it by the chamber depth (0.070 m) so that
  `1` means the shell has exactly cleared the mouth.
- `extractorOffset(t): number` — extractor throw in **metres**, 0 at rest.
- `ejectedShell(t, i)` — retimed against the new beat sheet; unchanged in shape.
- `loadShellTravel(t)`, `supportHandPose(t)` — keyframes restretched to 1.30 s.

### C. Runtime — `src/lab/sdf-zombie/webgpu/game-main.ts`

The eject becomes two-stage, which is the actual fix.

**Stage 1 — extract.** `Shell_L/R` are children of `Barrels`, already carrying
the 45° tilt. The runtime writes their **local** position along the bore axis.
They come straight out of the tubes because they are *in* the tubes; no rotated
basis is computed anywhere.

**Stage 2 — tumble.** At the clear beat, the existing free-flying
`ejectedShells` are spawned at `Breech_L/R`'s **current world position**
(converted into aim-rig space) and take over the ballistic arc. `Shell_L/R` hide.

Also:

- `const breech = ...` is **deleted**. Both the eject origin and the load
  destination read `Breech_L/R` every frame, so they track the hinge.
- `Extractor.position` driven from `extractorOffset(t)`.
- `TopLever.rotation` driven from `topLeverAngle(t)`.
- On seat, the flying load shells hide and `Shell_L/R` reappear in the chambers —
  so a loaded gun broken open shows two shell heads at the breech.
- The GLB node lookup throws loudly on a missing node, matching the existing
  `Barrels`/`Hinge` contract. A silent null here would present as a reload that
  animates nothing.

### D. Tests

`game-viewmodel.test.ts`:

- the lever leads the break — `topLeverAngle` is at full throw while
  `hingeOpenFraction` is still 0
- `extractStage` is monotonic over its window and `null` after the clear beat
- shells clear the chamber strictly before the tumble's first sample
- shut is faster than open (asymmetry is the "clack", so it is pinned)
- every beat boundary is ordered and `totalSec` is 1.30

Model gate in `model_grapeshot_shorty.py`:

- required-node set gains `Shell_L`, `Shell_R`, `Breech_L`, `Breech_R`,
  `Extractor`, `TopLever`
- **hollowness raycast** — cast a ray from just behind the breech face down each
  bore axis and assert it does not hit a cap within the chamber depth. This is
  the check that would have caught the solid cylinder, and it is cheap to keep.

### E. Attribution

`ATTRIBUTIONS.md` gains a CC-BY-4.0 section for *"sawnoffs Animated"* by
DJMaesen, in the existing per-work format, recording that it is used as a
mechanism and timing reference, that its beat sheet informed
`game-viewmodel.ts`, and that **no geometry, texture or dimension of it is
copied or redistributed**.

## Verification

Not "it compiles". The failure was visual, so the check is visual:

1. `blender -b -P scripts/model_grapeshot_shorty.py` — gate passes, including
   the new raycast.
2. Re-render the diagnostic at 45° open. The breech must show **two open holes
   with shells seated in them**, not two domed knobs. Compare against
   `docs/dev-notes/2026-09-03-shorty-breech/before-open45.png`.
3. `npm test` green.
4. In-game capture of a full reload, confirming the cases leave the *tilted*
   chamber mouths rather than a fixed point in space.

## Out of scope

- Gun proportions. Settled: the fantasy silhouette stays.
- The support hand's journey, which already reads well and which the reference
  does worse (it hides the load entirely).
- Dual wield. The reference is a two-gun set; ours is one gun, two hands.
