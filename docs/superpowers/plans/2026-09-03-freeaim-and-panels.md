# Free-Aim and Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the weapon point where the reticle is, fire from its own barrel, and stop the tuning panels covering the frame.

**Architecture:** Four independent tasks. Two are pure-function changes in `free-aim.ts` with unit tests; one rewires `muzzleWorld()` to read the GLB's own muzzle locators with a tested headless fallback; one extracts a shared collapsible panel shell that both tuning panels build on. Nothing here touches the breech mechanism — this pass lands **first**, so the breech work can be judged on a gun that aims properly.

**Tech Stack:** TypeScript + Three.js; Vitest with happy-dom for the DOM tests; a headless CDP gate (`scripts/sdf-game-shorty-gate.mjs`).

**Spec:** [`docs/superpowers/specs/2026-09-03-freeaim-and-panels-design.md`](../specs/2026-09-03-freeaim-and-panels-design.md)

---

## Orientation

**Camera space** (what `aimRig`, `GUN_REST.pos` and `MUZZLE_VIEW` live in): `x` right, `y` up, **`z` back** — so the gun sits at *negative* z and the muzzle (`z = −0.600`) is further from the eye than the grip (`z = −0.300`).

**World space**: `player.yaw` gives `forward = [sin(yaw)·cos(pitch), sin(pitch), −cos(yaw)·cos(pitch)]` and `right = [cos(yaw), 0, sin(yaw)]`. `right` is `cross(forward, up)` — verified, not assumed.

**The measured facts this plan acts on**, so no task has to re-derive them:

| | value |
| --- | --- |
| reticle at `x = ±1`, at 790×555 and 75° vertical FOV | **47.5°** off-axis |
| current `FREE_AIM.weaponYawDeg` | **15°** |
| `muzzleWorld()` offset from the eye, in camera basis | **forward −0.500**, right +0.200, up −0.120 |
| visible muzzle (`MUZZLE_VIEW.z`) | camera-space `−0.600`, i.e. **forward +0.600** |
| muzzle screen-x at 47.5°, pivoting at the **eye** | **1.54 — off screen** |
| muzzle screen-x at 47.5°, pivoting at the **grip** | **0.66 — in frame** |

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/lab/sdf-zombie/webgpu/free-aim.ts` | pure aim/bob maths | modify — frustum-aware angles, pivot offset |
| `src/lab/sdf-zombie/webgpu/free-aim.test.ts` | its tests | modify |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | runtime | modify — grip pivot, real muzzle, panel defaults |
| `src/lab/sdf-zombie/webgpu/panel-chrome.ts` | **new** — shared collapsible panel shell | create |
| `src/lab/sdf-zombie/webgpu/panel-chrome.test.ts` | **new** | create |
| `src/lab/sdf-zombie/webgpu/goo-panel.ts` | goo sliders | modify — build on the shell |
| `src/lab/sdf-zombie/webgpu/wound-panel.ts` | wound sliders | modify — build on the shell |

`panel-chrome.ts` is the one new file. It exists because `goo-panel.ts` and `wound-panel.ts` currently carry byte-identical CSS, title-bar and close-button code, and both need the same new collapse state — duplicating it a third time is how the two drift apart.

---

## Task 1: Point the weapon at the reticle, not near it

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/free-aim.ts:29-33` (the knobs), `:80-86` (`weaponAngles`)
- Modify: `src/lab/sdf-zombie/webgpu/free-aim.test.ts:67-80`

- [ ] **Step 1: Write the failing tests**

Replace the whole `describe('weaponAngles', ...)` block at `free-aim.test.ts:67-80` with:

```ts
describe('weaponAngles', () => {
  // 790x555 canvas at a 75 deg VERTICAL fov -- the capture in fpvbugs.mov.
  const F = { tanV: Math.tan(75 * Math.PI / 360), tanH: Math.tan(75 * Math.PI / 360) * (790 / 555) };

  it('leans away from the reticle side, so the gun swings toward it', () => {
    expect(weaponAngles({ x: 1, y: 0 }, F).yawDeg).toBeLessThan(0);
    expect(weaponAngles({ x: -1, y: 0 }, F).yawDeg).toBeGreaterThan(0);
    expect(weaponAngles({ x: 0, y: 1 }, F).pitchDeg).toBeGreaterThan(0);
  });
  it('is level with the reticle centred', () => {
    const w = weaponAngles({ x: 0, y: 0 }, F);
    expect(w.yawDeg).toBeCloseTo(0, 9);
    expect(w.pitchDeg).toBeCloseTo(0, 9);
  });
  it('POINTS AT the reticle at the edge -- 47.5 deg, not the old 15 deg cap', () => {
    const yaw = Math.abs(weaponAngles({ x: 1, y: 0 }, F).yawDeg);
    expect(yaw).toBeCloseTo(Math.atan(F.tanH) * 180 / Math.PI, 4);
    expect(yaw).toBeGreaterThan(45);
  });
  it('tracks the reticle exactly at every position, not just the edge', () => {
    for (const x of [0.2, 0.5, 0.8, 1.0]) {
      const want = Math.atan(x * F.tanH) * 180 / Math.PI;
      expect(Math.abs(weaponAngles({ x, y: 0 }, F).yawDeg)).toBeCloseTo(want, 6);
    }
  });
  it('scales by the tuning fraction, which cannot exceed pointing exactly', () => {
    const full = Math.abs(weaponAngles({ x: 1, y: 0 }, F).yawDeg);
    FREE_AIM.weaponYawFrac = 0.5;
    expect(Math.abs(weaponAngles({ x: 1, y: 0 }, F).yawDeg)).toBeCloseTo(full * 0.5, 6);
    FREE_AIM.weaponYawFrac = 1.0;
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/free-aim.test.ts -t "weaponAngles"`
Expected: FAIL — `weaponAngles` ignores its second argument and returns the 15° cap.

- [ ] **Step 3: Replace the knobs**

Replace `free-aim.ts:29-33` (the `weaponYawDeg` / `weaponPitchDeg` block, comment included) with:

```ts
  /** How much of the reticle's TRUE angle the weapon takes up, 0..1. 1 = the
   *  barrel points exactly at the reticle.
   *
   *  These were absolute degree caps (15 and 10). A cap cannot track a reticle
   *  whose own excursion depends on the aspect ratio: at 790x555 the reticle
   *  reaches 47.5 deg off-axis, so the gun was pointing 32.5 deg away from
   *  where the player was aiming, worst exactly at the edges. As a FRACTION
   *  the knob still tunes the feel but can no longer reintroduce a mismatch --
   *  1.0 is "aimed", and there is nothing above it. */
  weaponYawFrac: 1.0,
  weaponPitchFrac: 1.0,
```

- [ ] **Step 4: Make `weaponAngles` frustum-aware**

Replace `free-aim.ts:80-86` (the `weaponAngles` function and its doc comment) with:

```ts
/** Half-angle tangents of the live camera frustum. tanV = tan(fovY/2),
 *  tanH = tanV * aspect. The caller owns the camera, so it passes these in
 *  rather than this module importing Three.js. */
export interface Frustum { tanH: number; tanV: number; }

/**
 * Where the weapon must point to be aimed AT the reticle, degrees.
 *
 * The reticle is a SCREEN position, so its angle off the view axis is
 * atan(normalised * tan(halfFov)) -- not a linear fraction of some fixed
 * maximum. That distinction is the whole bug: a linear 15 deg cap and a
 * genuinely 47.5 deg reticle disagree most exactly where the player is
 * looking hardest.
 */
export function weaponAngles(aim: AimPoint, f: Frustum): { yawDeg: number; pitchDeg: number } {
  const deg = 180 / Math.PI;
  return {
    yawDeg: -Math.atan(aim.x * f.tanH) * deg * FREE_AIM.weaponYawFrac,
    pitchDeg: Math.atan(aim.y * f.tanV) * deg * FREE_AIM.weaponPitchFrac,
  };
}
```

- [ ] **Step 5: Run the suite**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/free-aim.test.ts`
Expected: PASS.

- [ ] **Step 6: Update the one call site so the page compiles**

In `game-main.ts`, replace the `weaponAngles(aim)` call at `:2161`:

```ts
      const tanV = Math.tan((camera.fov * Math.PI) / 360);
      const w = freeAimOn
        ? weaponAngles(aim, { tanV, tanH: tanV * camera.aspect })
        : { yawDeg: 0, pitchDeg: 0 };
```

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/free-aim.ts src/lab/sdf-zombie/webgpu/free-aim.test.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "free aim: the gun points AT the reticle, not 32 degrees beside it"
```

---

## Task 2: Pivot at the grip so the model stays in frame

Task 1 alone makes the gun swing off screen — `aimRig` rotates about the eye, and 47.5° there puts the muzzle at screen-x 1.54. This is the other half, and the two are only correct together.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/free-aim.ts` — append after `approachAngle`
- Modify: `src/lab/sdf-zombie/webgpu/free-aim.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:2174-2182`

- [ ] **Step 1: Write the failing test**

Append to `free-aim.test.ts` (adding `pivotOffset` to the import at `:3-4`):

```ts
describe('pivotOffset', () => {
  const GRIP = { x: 0.038, y: -0.115, z: -0.300 };

  it('is nothing when the weapon is level', () => {
    const o = pivotOffset(GRIP, 0, 0);
    expect(o.x).toBeCloseTo(0, 9);
    expect(o.y).toBeCloseTo(0, 9);
    expect(o.z).toBeCloseTo(0, 9);
  });
  it('holds the pivot point still under yaw — that is its entire job', () => {
    const yaw = 47.5 * Math.PI / 180;
    const o = pivotOffset(GRIP, yaw, 0);
    // Rotate the grip about the origin, then add the offset: back where it was.
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const rx = GRIP.x * c + GRIP.z * s;
    const rz = -GRIP.x * s + GRIP.z * c;
    expect(rx + o.x).toBeCloseTo(GRIP.x, 9);
    expect(rz + o.z).toBeCloseTo(GRIP.z, 9);
  });
  it('holds it still under pitch too', () => {
    const pitch = 20 * Math.PI / 180;
    const o = pivotOffset(GRIP, 0, pitch);
    const c = Math.cos(pitch), s = Math.sin(pitch);
    const ry = GRIP.y * c - GRIP.z * s;
    const rz = GRIP.y * s + GRIP.z * c;
    expect(ry + o.y).toBeCloseTo(GRIP.y, 9);
    expect(rz + o.z).toBeCloseTo(GRIP.z, 9);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/free-aim.test.ts -t "pivotOffset"`
Expected: FAIL — `pivotOffset is not a function`.

- [ ] **Step 3: Implement `pivotOffset`**

Append to `free-aim.ts` immediately after `approachAngle`:

```ts
export interface V3 { x: number; y: number; z: number; }

/**
 * Translation that turns a rotation-about-the-origin into a
 * rotation-about-`pivot`: `pivot - R * pivot`.
 *
 * The view-model rig's origin is the EYE, so rotating it swings the whole
 * weapon around the player's head -- at the reticle's true 47.5 deg that puts
 * the muzzle at screen-x 1.54, clean off the viewport, which is why the angle
 * used to be capped at 15 instead. Pivoting at the GRIP puts it at 0.66 with
 * the grip itself barely moving (0.12). An arm swings the barrel about the
 * hands, not about the eyeball.
 *
 * Rotation order matches Three.js's default 'XYZ' Euler as applied by
 * Object3D.rotation, i.e. R = Rx(pitch) then Ry(yaw) reading right-to-left.
 */
export function pivotOffset(pivot: V3, yawRad: number, pitchRad: number): V3 {
  const cy = Math.cos(yawRad), sy = Math.sin(yawRad);
  const cp = Math.cos(pitchRad), sp = Math.sin(pitchRad);
  // Rx(pitch) applied to the pivot...
  const px = pivot.x;
  const py = pivot.y * cp - pivot.z * sp;
  const pz = pivot.y * sp + pivot.z * cp;
  // ...then Ry(yaw).
  const rx = px * cy + pz * sy;
  const ry = py;
  const rz = -px * sy + pz * cy;
  return { x: pivot.x - rx, y: pivot.y - ry, z: pivot.z - rz };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/free-aim.test.ts -t "pivotOffset"`
Expected: PASS.

If the yaw test passes but the pitch one fails, the Euler order assumption is wrong — check `aimRig.rotation`'s order in `game-main.ts` and match it here rather than "fixing" the test.

- [ ] **Step 5: Wire it into the rig**

Replace `game-main.ts:2174-2182` (the `if (aimRig) { ... }` block) with:

```ts
    if (aimRig) {
      const b = bobPose(bobDistance, bobAmount);
      const yaw = THREE.MathUtils.degToRad(weaponYawDeg);
      const pitch = THREE.MathUtils.degToRad(weaponPitchDeg);
      // ROTATE ABOUT THE GRIP, not about the eye. Without this offset the rig
      // pivots on the player's head and the weapon leaves the frame the moment
      // it points anywhere near the edge of the viewport.
      const o = pivotOffset(GUN_REST.pos, yaw, pitch);
      aimRig.position.set(b.x + o.x, b.y + o.y, o.z);
      aimRig.rotation.set(pitch, yaw, THREE.MathUtils.degToRad(b.rollDeg));
    }
```

Add `pivotOffset` to the `free-aim` import in `game-main.ts`.

- [ ] **Step 6: Typecheck and run the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; vitest green.

- [ ] **Step 7: Confirm in-game that the barrel tracks the reticle**

Load `sdf-game.html`, ensure free aim is on (the HUD says `FREE-AIM (G)`), and push the reticle to the far left, then the far right.

Expected: the barrel visibly swings to follow, the grip stays roughly put, and the gun never leaves the frame. This is the exact complaint from `fpvbugs.mov`; compare against the frames there.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/free-aim.ts src/lab/sdf-zombie/webgpu/free-aim.test.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "free aim: swing the barrel about the hands, not about the eyeball"
```

---

## Task 3: Fire from the barrel, not from behind the player's head

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:1398-1409` (`muzzleWorld`)

- [ ] **Step 1: Import the existing tested helper**

`src/game/weapons/muzzle-pos.ts` already solves this and has tests asserting that `+forward` moves toward the muzzle. Add to the imports at the top of `game-main.ts`:

```ts
import { muzzleWorldPosition } from '../../../game/weapons/muzzle-pos';
```

Verify the relative path resolves from `src/lab/sdf-zombie/webgpu/` — adjust the number of `../` if `tsc` disagrees.

- [ ] **Step 2: Replace `muzzleWorld`**

Replace lines `1398-1409` (the doc comment and the whole function) with:

```ts
  /** Scratch, so the per-shot path allocates nothing. */
  const _muzA = new THREE.Vector3(), _muzB = new THREE.Vector3();
  /**
   * World-space muzzle. Reads the GLB's OWN Muzzle_L/R locators when the gun is
   * loaded, so it follows the weapon's real heading -- including the free-aim
   * swing -- instead of being a second description of where the gun is that can
   * drift from the first. It did drift: the previous inline version put the
   * spawn point at forward -0.500 from the eye while the visible muzzle sits at
   * forward +0.600, so every projectile was born 1.1 m BEHIND the barrel and
   * flew through the player's head.
   *
   * The fallback keeps the headless contract: predictSlugHitNow() and the CDP
   * gates fire with no GLB loaded, which is why an eye-relative formula exists
   * at all. It now goes through muzzle-pos.ts's tested helper rather than
   * re-deriving the basis by hand with the sign wrong.
   */
  function muzzleWorld(): Vec3 {
    const eye = eyeOf(player);
    if (gunReady && muzzleNodes.length === 2) {
      muzzleNodes[0]!.getWorldPosition(_muzA);
      muzzleNodes[1]!.getWorldPosition(_muzB);
      _muzA.add(_muzB).multiplyScalar(0.5);
      return [_muzA.x, _muzA.y, _muzA.z];
    }
    const cp = Math.cos(player.pitch);
    const fwd = { x: Math.sin(player.yaw) * cp, y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * cp };
    const right = { x: Math.cos(player.yaw), y: 0, z: Math.sin(player.yaw) };
    const up = {
      x: right.y * fwd.z - right.z * fwd.y,
      y: right.z * fwd.x - right.x * fwd.z,
      z: right.x * fwd.y - right.y * fwd.x,
    };
    const m = muzzleWorldPosition(
      { x: eye[0], y: eye[1], z: eye[2] }, { right, up, forward: fwd },
      0.2, -0.12, 0.5,
    );
    return [m.x, m.y, m.z];
  }
```

- [ ] **Step 3: Hold the muzzle locators**

`Muzzle_L` / `Muzzle_R` are already read once at load into `MUZZLE_VIEW`; they now need to be kept. Immediately after the `let hingePivot: THREE.Group | null = null;` declaration (`:1088`), add:

```ts
  /** The GLB's own muzzle locators, kept so muzzleWorld() can read their LIVE
   *  world position each shot rather than a position sampled once at load. */
  let muzzleNodes: THREE.Object3D[] = [];
```

and inside the loader, in the block that already resolves `Muzzle_L`/`Muzzle_R` (`:1222-1226`), add after the `MUZZLE_VIEW.copy(...)` line:

```ts
        const nL = gltf.scene.getObjectByName('Muzzle_L');
        const nR = gltf.scene.getObjectByName('Muzzle_R');
        if (nL && nR) muzzleNodes = [nL, nR];
```

- [ ] **Step 4: Add the regression test that names the bug**

Append to `src/game/weapons/muzzle-pos.test.ts`:

```ts
  it('puts the muzzle IN FRONT of the eye — the sdf-game sign regression', () => {
    // game-main's inline version used -forward*0.5, which spawned every
    // projectile half a metre BEHIND the player's head while the visible
    // muzzle sat 0.6 m in front of it.
    const fwd = { x: 0, y: 0, z: -1 };
    const m = muzzleWorldPosition(
      { x: 0, y: 1.6, z: 0 },
      { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, forward: fwd },
      0.2, -0.12, 0.5,
    );
    const along = (m.x - 0) * fwd.x + (m.y - 1.6) * fwd.y + (m.z - 0) * fwd.z;
    expect(along).toBeGreaterThan(0);
    expect(along).toBeCloseTo(0.5, 6);
  });
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; vitest green, including the new sign test.

- [ ] **Step 6: Confirm the placement gate still agrees**

Run: `LAB_VITE_PORT=5281 LAB_CDP_PORT=9281 node scripts/sdf-game-shorty-gate.mjs`
Expected: all gates pass.

`predictSlugHitNow()` uses `muzzleWorld()`, so if impacts now land somewhere new, that is this change working — the previous origin was 1.1 m off. What must still hold is that shots land **on the reticle**, which `convergedDir()` guarantees and the gate checks.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts src/game/weapons/muzzle-pos.test.ts
git commit -m "shots: leave the barrel, not the back of the player's head"
```

---

## Task 4: Collapse the tuning panels by default

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/panel-chrome.ts`, `panel-chrome.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/goo-panel.ts:60-97`, `:193-205`
- Modify: `src/lab/sdf-zombie/webgpu/wound-panel.ts:95-137`, `:217-229`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` — `__sdfGame` panel seams at `:2898-2905`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/panel-chrome.test.ts`:

```ts
// src/lab/sdf-zombie/webgpu/panel-chrome.test.ts
import { describe, expect, it } from 'vitest';
import { createPanelShell } from './panel-chrome';

describe('createPanelShell', () => {
  it('SHIPS COLLAPSED — the body is what covers the frame', () => {
    const p = createPanelShell('TEST TUNING');
    expect(p.collapsed).toBe(true);
    expect(p.body.style.display).toBe('none');
    p.dispose();
  });
  it('still shows its title bar when collapsed, so it stays findable', () => {
    const p = createPanelShell('TEST TUNING');
    p.setVisible(true);
    expect(p.el.style.display).toBe('block');
    expect(p.el.textContent).toContain('TEST TUNING');
    p.dispose();
  });
  it('expands and re-collapses', () => {
    const p = createPanelShell('TEST TUNING');
    p.setCollapsed(false);
    expect(p.body.style.display).toBe('block');
    p.setCollapsed(true);
    expect(p.body.style.display).toBe('none');
    p.dispose();
  });
  it('keeps visibility and collapse independent', () => {
    const p = createPanelShell('TEST TUNING');
    p.setCollapsed(false);
    p.setVisible(false);
    expect(p.el.style.display).toBe('none');
    expect(p.collapsed).toBe(false);   // still expanded, just not shown
    p.dispose();
  });
  it('toggles collapse when the caret is clicked', () => {
    const p = createPanelShell('TEST TUNING');
    const caret = p.el.querySelector('button');
    (caret as HTMLButtonElement).click();
    expect(p.collapsed).toBe(false);
    p.dispose();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/panel-chrome.test.ts`
Expected: FAIL — cannot resolve `./panel-chrome`.

- [ ] **Step 3: Create the shared shell**

Create `src/lab/sdf-zombie/webgpu/panel-chrome.ts`:

```ts
// src/lab/sdf-zombie/webgpu/panel-chrome.ts
//
// The shell both tuning panels sit in: fixed frame, title bar, collapse caret,
// close button, and a body the caller fills with rows.
//
// It exists because goo-panel.ts and wound-panel.ts carried byte-identical CSS
// and title-bar code, and both needed the same new collapse state. A third copy
// is how the two drift apart.
//
// SHIPS COLLAPSED. The panels ship VISIBLE on purpose -- the owner asked twice,
// "the sliders could not be found" and "it should be default on tbh" -- but
// between them they cover most of the viewport, which made every visual capture
// useless (see c6bffc7: ten shots that "all passed their booleans and all
// showed the owner nothing"). Collapsing keeps the title bar on screen, so the
// panels stay findable, and closes only the part that occludes.
//
// The collapse state is deliberately NOT persisted. A remembered state is
// exactly the sort of per-profile variation that makes a capture reproduce
// differently on two machines.

const PANEL_CSS = `
  position:fixed; top:8px; right:8px; width:250px; z-index:40;
  background:rgba(20,16,15,0.93); color:#e8ddd8; border:1px solid #3a2f2d;
  border-radius:3px; padding:9px 10px 10px;
  font:11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  max-height:calc(100vh - 16px); overflow-y:auto;
`;

export interface PanelShell {
  readonly el: HTMLElement;
  /** Append rows here. Hidden while collapsed. */
  readonly body: HTMLElement;
  readonly visible: boolean;
  readonly collapsed: boolean;
  setVisible(on: boolean): void;
  setCollapsed(on: boolean): void;
  /** Called whenever the panel becomes visible AND expanded. */
  onReveal(fn: () => void): void;
  dispose(): void;
}

export function createPanelShell(titleLabel: string): PanelShell {
  const el = document.createElement('div');
  el.setAttribute('style', PANEL_CSS);
  el.style.display = 'none';

  const title = document.createElement('div');
  title.setAttribute('style',
    'display:flex; align-items:center; justify-content:space-between; gap:8px;'
    + ' font-size:10px; letter-spacing:.12em; color:#9a8b86;');

  const caret = document.createElement('button');
  caret.setAttribute('style',
    'background:none; border:0; color:#9a8b86; cursor:pointer; font-size:10px;'
    + ' line-height:1; padding:0 4px 0 0; flex:none;');

  const titleText = document.createElement('span');
  titleText.textContent = titleLabel;
  titleText.setAttribute('style', 'flex:1; cursor:pointer;');

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.title = 'hide (H toggles both panels)';
  closeBtn.setAttribute('style',
    'background:none; border:0; color:#9a8b86; cursor:pointer; font-size:12px;'
    + ' line-height:1; padding:0 2px;');

  title.append(caret, titleText, closeBtn);
  el.appendChild(title);

  const body = document.createElement('div');
  body.setAttribute('style', 'margin-top:7px;');
  el.appendChild(body);

  document.body.appendChild(el);

  let visible = false;
  let collapsed = true;
  const revealFns: (() => void)[] = [];

  function paint(): void {
    el.style.display = visible ? 'block' : 'none';
    body.style.display = collapsed ? 'none' : 'block';
    caret.textContent = collapsed ? '▸' : '▾';
    caret.title = collapsed ? 'expand' : 'collapse';
    title.style.marginBottom = collapsed ? '0' : '0';
    if (visible && !collapsed) for (const fn of revealFns) fn();
  }
  const toggle = (): void => { collapsed = !collapsed; paint(); };
  caret.addEventListener('click', toggle);
  titleText.addEventListener('click', toggle);
  closeBtn.addEventListener('click', () => { visible = false; paint(); });
  paint();

  return {
    el,
    body,
    get visible() { return visible; },
    get collapsed() { return collapsed; },
    setVisible(on) { visible = on; paint(); },
    setCollapsed(on) { collapsed = on; paint(); },
    onReveal(fn) { revealFns.push(fn); },
    dispose() { el.remove(); },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/panel-chrome.test.ts`
Expected: PASS, all five.

- [ ] **Step 5: Build `goo-panel.ts` on the shell**

In `goo-panel.ts`: delete the `PANEL_CSS` const (`:59-65`) and replace the shell construction at `:67-97` — from `const el = document.createElement('div');` through `el.appendChild(title);` — with:

```ts
  const shell = createPanelShell('GOO TUNING');
  const el = shell.body;
```

Add at the top: `import { createPanelShell } from './panel-chrome';`

Every subsequent `el.appendChild(...)` then fills the shell's body unchanged. Replace the `document.body.appendChild(el);` and return block at `:190-205` with:

```ts
  shell.onReveal(refresh);
  return {
    el: shell.el,
    get visible() { return shell.visible; },
    get collapsed() { return shell.collapsed; },
    setVisible(on) { shell.setVisible(on); },
    setCollapsed(on) { shell.setCollapsed(on); },
    refresh,
    dispose() { shell.dispose(); },
  };
```

Add `collapsed` and `setCollapsed` to the exported `GooPanel` interface.

- [ ] **Step 6: Build `wound-panel.ts` on the shell — the same way**

Identical treatment: delete its `PANEL_CSS`, replace `:115-137` (shell construction through `el.appendChild(title);`) with

```ts
  const shell = createPanelShell('WOUND TUNING');
  const el = shell.body;
```

add the same import, and replace its `document.body.appendChild(el);` and return block at `:215-229` with the same delegating object (swapping `GooPanel` for `WoundPanel`). Add `collapsed` and `setCollapsed` to the `WoundPanel` interface.

- [ ] **Step 7: Surface the collapse seam for capture scripts**

In `game-main.ts`, replace the `gooPanel(on)` / `woundPanel(on)` entries at `:2898-2905` with versions that also expose collapse:

```ts
    gooPanel(on: boolean) {
      gooPanel?.setVisible(on);
      return gooPanel?.visible ?? false;
    },
    /** Expand or re-collapse the GOO panel. Panels ship COLLAPSED so they stop
     *  covering the frame; a capture script that actually wants to photograph
     *  the sliders opens it with this. */
    gooPanelCollapsed(on: boolean) {
      gooPanel?.setCollapsed(on);
      return gooPanel?.collapsed ?? true;
    },
    woundPanel(on: boolean) {
      woundPanel?.setVisible(on);
      return woundPanel?.visible ?? false;
    },
    woundPanelCollapsed(on: boolean) {
      woundPanel?.setCollapsed(on);
      return woundPanel?.collapsed ?? true;
    },
```

- [ ] **Step 8: Run everything**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; vitest green, including the existing `goo-panel` and `wound-panel` tests.

If an existing panel test asserts against `panel.el` containing slider rows directly, it still holds — `shell.el` contains the body, which contains the rows.

- [ ] **Step 9: Confirm the frame is clear**

Load `sdf-game.html`. Expected: two small title bars top-right reading `▸ GOO TUNING` and `▸ WOUND TUNING`, no slider walls, the weapon unobstructed. Clicking either title expands it; `H` still hides both entirely.

- [ ] **Step 10: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/panel-chrome.ts src/lab/sdf-zombie/webgpu/panel-chrome.test.ts src/lab/sdf-zombie/webgpu/goo-panel.ts src/lab/sdf-zombie/webgpu/wound-panel.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "panels: collapsed by default, so the frame belongs to the game"
```

---

## Self-review notes

**Spec coverage.** Defect 1 → Task 3. Defect 2 → Tasks 1 **and** 2 (they are only correct together; Task 1 alone swings the gun off screen, which is called out at the top of Task 2). Defect 3 → Task 4. Verification §1 → the unit tests in each task. §2 → Task 3 Step 4. §3 → Task 3 Step 6. §4 → Task 2 Step 7 and Task 4 Step 9.

**Type consistency.** `Frustum` is defined in Task 1 and consumed by the `weaponAngles` call site in Task 1 Step 6. `V3` and `pivotOffset` are defined in Task 2 Step 3 and used in Step 5. `PanelShell`, `createPanelShell`, `setCollapsed` and `onReveal` are defined in Task 4 Step 3 and used in Steps 5–7. `muzzleNodes` is declared in Task 3 Step 3 and read in Step 2 — **note the ordering**: Step 2 writes the function that reads it, Step 3 declares it, so the file does not typecheck until Step 3 is done. That is deliberate (the function is the interesting part) but the implementer should not panic at a red editor between them.

**Ordering.** Tasks 1 and 2 must land together or the weapon leaves the frame; do not stop between them and playtest. Tasks 3 and 4 are independent of each other and of 1–2.
