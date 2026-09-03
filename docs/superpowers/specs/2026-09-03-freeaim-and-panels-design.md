# Free-aim: point the gun, fire from the barrel, and get the panels out of the way

**Date:** 2026-09-03
**Status:** approved in principle, spec under review
**Scope:** a small pass BEFORE the breech mechanism rework
(`2026-09-03-shorty-breech-mechanism-design.md`)
**Touches:** `src/lab/sdf-zombie/webgpu/game-main.ts`,
`src/lab/sdf-zombie/webgpu/free-aim.ts`, `src/lab/sdf-zombie/webgpu/goo-panel.ts`,
`src/lab/sdf-zombie/webgpu/wound-panel.ts`

## The report

> "with freelook mode, the fpv model doesn't point in the direction and the
> bullets don't come out from the gun ... the discrepancy is mostly noticeable
> at the extreme horizontal axis positions"

> "we should turn off the debug menus visibility by default (eg make the
> minimized view) as it blocks the view when agents are trying to work visually"

Reference capture: `fpvbugs.mov` (2026-09-03), 9.7 s at 60 fps.

## Defect 1 — projectiles spawn 0.5 m behind the eye

`game-main.ts:1400` builds the spawn point as:

```ts
const right: Vec3 = [cy, 0, sy];
return [ eye[0] + right[0]*0.2 - sy*0.5,
         eye[1] - 0.12,
         eye[2] + right[2]*0.2 + cy*0.5 ];
```

`forward` is `[sin(yaw)·cp, sin(pitch), −cos(yaw)·cp]`, so `(−sy, +cy)` is
`−forward`. Decomposed in the camera's own basis, at every yaw:

| forward | right | up |
| --- | --- | --- |
| **−0.500** | +0.200 | −0.120 |

The visible muzzle is at camera-space `z = −0.600`, i.e. **forward +0.600**. The
spawn point is therefore **1.1 m behind the barrel**, on the wrong side of the
player's head.

This is a plain sign error, and the strongest evidence is that a correct,
unit-tested helper for exactly this already exists and is not used here:
`src/game/weapons/muzzle-pos.ts`'s `muzzleWorldPosition()`, whose contract
states `forward` is "+ forward, toward the gun muzzle". The sdf-game page
reimplemented it inline and flipped the sign.

**Not free-aim-specific.** This has been wrong in both aim modes since it was
written. It surfaced now only because slug mode draws a projectile large and
slow enough to see.

## Defect 2 — the weapon leans 15° when the reticle is 47.5° away

`FREE_AIM.weaponYawDeg` is `15`. At the capture's aspect ratio (790×555 canvas,
75° vertical FOV) a reticle at `x = ±1` sits `atan(tanV · aspect)` = **47.5°**
off-axis. A **32.5° gap** at the horizontal extremes — precisely where the
report says it shows.

The cap is deliberate; the existing comment reads *"the gun leans toward the
target, it does not literally point at it, or the model leaves the frame."* The
concern is real but the wrong lever was pulled. `aimRig` rotates about its own
origin, which sits at `viewModelAnchor` — effectively **the eye**:

| pivot | yaw | muzzle screen-x | grip screen-x | |
| --- | --- | --- | --- | --- |
| eye | 15° | 0.46 | 0.37 | in frame |
| **eye** | **47.5°** | **1.54** | **1.29** | **off screen** |
| grip | 15° | 0.32 | 0.12 | in frame |
| **grip** | **47.5°** | **0.66** | **0.12** | **in frame** |

(screen-x: 0 = centre, ±1 = viewport edge.)

Rotating about the **grip** lets the weapon point the full 47.5° while the grip
moves almost not at all and the muzzle lands at 0.66 — comfortably inside the
frame. It is also what an arm does: the barrel swings about the hands, not
about the eyeball.

**Pitch comes free.** Same rotation, and full pitch (37.5°) at the grip pivot
puts the muzzle at screen-y 0.44. The owner rated the Y axis less important;
it costs nothing, so it is included rather than special-cased.

## Defect 3 — the tuning panels cover the frame

`WOUND TUNING` and `GOO TUNING` both ship visible (`game-main.ts:1791`,
`:1838`) and between them occupy most of the right half of the viewport. Commit
`c6bffc7` already documents the cost: a ten-shot dispatch run "all passed their
booleans and all showed the owner nothing".

Both were made visible **on purpose**, for a good reason — the commit comments
record *"the sliders could not be found"* and *"it should be default on tbh"*.
So hiding them outright would re-break what those changes fixed.

**Collapsed-by-default resolves both.** The title bar stays on screen, so the
panels remain discoverable; the body — the part that actually occludes — is
closed until clicked.

## Design

### A. `free-aim.ts` — point, don't lean

Replace the fixed `weaponYawDeg` / `weaponPitchDeg` caps with the reticle's
**true angular position inside the frustum**, which requires the projection the
caller already owns:

```ts
/** Half-angles of the frustum, radians, from the live camera. */
export interface Frustum { tanH: number; tanV: number; }

/** Where the weapon must point to be aimed AT the reticle, degrees. */
export function weaponAngles(aim: AimPoint, f: Frustum): { yawDeg: number; pitchDeg: number };
```

`FREE_AIM.weaponYawDeg` / `weaponPitchDeg` become **0..1 fractions** of the true
angle (both default `1.0` = point exactly at the reticle) rather than absolute
degree caps, so the knob survives for tuning without being able to reintroduce
the mismatch by construction.

### B. `game-main.ts` — pivot at the grip

`aimRig.rotation` currently rotates about the eye. Keep the rotation, then
translate so the grip is a fixed point:

```
aimRig.position = bob + (GRIP − R · GRIP)
```

where `R` is the rig's rotation and `GRIP` is `GUN_REST.pos`. Expressed as a
pure function in `free-aim.ts` so the pivot maths is testable without a
renderer:

```ts
export function pivotOffset(pivot: V3, yawRad: number, pitchRad: number): V3;
```

### C. `game-main.ts` — fire from the actual muzzle

`muzzleWorld()` becomes:

1. **Gun loaded:** the world position of the GLB's `Muzzle_L`/`Muzzle_R`
   locators, averaged. They hang off `aimRig`, so once B lands they follow the
   weapon's true heading with no second thing to keep in sync.
2. **Headless / gun failed to load:** `muzzleWorldPosition()` from
   `src/game/weapons/muzzle-pos.ts` with `forward: +0.5` — the existing tested
   helper, with the sign right.

The fallback matters: `predictSlugHitNow()` and the CDP gates fire without a
GLB, and the current inline version exists precisely so shots work headless.
That property is preserved; only the sign and the duplication go.

`convergedDir()` is unchanged — shots still converge on the reticle ray at 8 m,
so impacts keep landing on the crosshair.

### D. Panel chrome — collapse, don't hide

`goo-panel.ts` and `wound-panel.ts` carry near-identical title-bar and CSS code,
and both need the same new state. Extract the shared piece:

- **New:** `src/lab/sdf-zombie/webgpu/panel-chrome.ts` — the panel shell: fixed
  CSS, a title bar with a **collapse caret** and the existing close button, and
  a body element the caller fills.
- Both panels build on it. Each ships **collapsed**: title bar visible, body
  `display:none`.
- `setVisible()` keeps its exact current meaning (whole panel on/off), so every
  capture script and the `H` key keep working untouched.
- New `setCollapsed(on)` on both, surfaced as `__sdfGame.gooPanel`/`woundPanel`
  gaining a `.collapsed` setter, so a capture script can open a panel if it
  actually wants to photograph the sliders.

**No persistence.** The collapse state resets to collapsed on every load. A
remembered state is exactly the kind of hidden per-profile variation that makes
a capture reproduce differently on two machines, and determinism is worth more
here than the convenience.

## Verification

1. `npm test` — new unit tests for `weaponAngles`, `pivotOffset` and the panel
   chrome's collapse state.
2. **The numeric check that names the bug:** assert `muzzleWorld()`'s offset
   from the eye has a **positive** forward component, and that it lands within a
   few cm of the `Muzzle_L/R` midpoint when the gun is loaded.
3. `node scripts/sdf-game-shorty-gate.mjs` — still green, and its captures now
   frame the weapon without needing to dismiss anything first.
4. In-game: push the reticle to the far left and far right and confirm the
   barrel visibly tracks it, and that a slug leaves the muzzle rather than the
   side of your head.

## Out of scope

- The breech mechanism. Separate spec, runs after this.
- The dead zone, turn rates and sensitivity — the feel knobs are unchanged;
  this pass only fixes where the gun points and where shots start.
- Removing the `H` key or the close buttons.
