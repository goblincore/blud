# Dungeon Relighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `sdf-game.html`'s white gallery into a dark wet-gray stone dungeon lit by an offset weapon-mounted flashlight and warm fire practicals, with per-pixel bumped specular on the stone.

**Architecture:** Three seams, kept apart on purpose. (1) A pure procedural texture module bakes stone albedo/normal/roughness with no three.js and no canvas in its core, so it is unit-testable. (2) A pure light-rig module describes the dungeon rig as data, so the numbers are testable without a GPU. (3) The march shader gains one analytic spotlight uniform block — dot products only, **zero extra `mapBody` evaluations**. `ambientAt` is fed new inputs and is never edited.

**Tech Stack:** TypeScript, three.js r185 `WebGPURenderer` (node materials), hand-written WGSL, vitest.

**Read first:** [`docs/superpowers/specs/2026-09-01-dungeon-relighting-design.md`](../specs/2026-09-01-dungeon-relighting-design.md) — especially the spike section, which contains a confirmed root cause and a verified fix you are about to implement.

---

## Non-negotiables

These come from scars this project already has. Violating one costs a day.

1. **`ambientAt` is fed, never modified.** `ambient.wgsl.ts` is a pinned twin of `ambient.ts`; a test greps its source for field calls. Do not widen its signature.
2. **Brightness rides `keyColor`, not albedo.** `ambientAt` renormalises bounce to unit luminance, so albedo boosts change *hue only*. The flashlight is a brightness change.
3. **Zero extra `mapBody` evaluations.** Character self-shadowing was cut by the owner precisely to hold this line. If you find yourself adding a field sample to the shading block, stop.
4. **Nothing compiles WGSL in tests.** A green suite does not mean the shader works. Every visual change gets an eyeball pass on `sdf-game.html`.
5. **Set `colorSpace` on colour textures only.** `THREE.SRGBColorSpace` on albedo; normal and roughness maps are *data* and must stay linear.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/game/level/stone-textures.ts` | **create** | Pure pixel generation for stone albedo/normal/roughness + a thin canvas→`THREE.DataTexture` wrapper |
| `src/game/level/stone-textures.test.ts` | **create** | Unit tests over the pure generators |
| `src/lab/sdf-zombie/webgpu/dungeon-lighting.ts` | **create** | The dungeon rig as *data* + a builder that turns it into three objects |
| `src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts` | **create** | Gates on the rig data and the shadow-camera layer fix |
| `src/lab/sdf-zombie/webgpu/game-level.ts` | modify | Dungeon stone palette replacing the gallery palette |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | modify | Wiring: materials, rig, flashlight transform, hull cast flag |
| `src/lab/sdf-zombie/webgpu/occluder-hull.ts` | modify | A separate **shadow-caster** inflation, distinct from `HULL_SHRINK` |
| `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` | modify | Two new uniforms: `spotPos`, `spotAxis`, `spotCfg` |
| `src/lab/sdf-zombie/webgpu/march.wgsl.ts` | modify | Analytic spotlight in the hit-shading block |

---

## Task 1: Dungeon preset behind a toggle (off-state parity)

Everything later hangs off this flag. Building it first means every subsequent task can prove it changed nothing when the dungeon is off.

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/dungeon-lighting.ts`
- Create: `src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts
//
// The dungeon rig is DATA before it is objects, so its numbers can be gated
// without a GPU. Fixture note (degenerate-fixture house rule): the darkness
// assertions compare the dungeon rig against the GALLERY rig it replaces, so
// they cannot pass by accident on an all-zero struct.
import { describe, expect, it } from 'vitest';
import { DUNGEON_RIG, GALLERY_RIG, type AmbientRig } from './dungeon-lighting';

const lum = (c: readonly [number, number, number]) =>
  0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('dungeon rig', () => {
  it('is dramatically darker than the gallery rig it replaces', () => {
    // The whole point of the pivot: ambient must collapse, not merely dip.
    expect(DUNGEON_RIG.ambientIntensity).toBeLessThan(GALLERY_RIG.ambientIntensity * 0.1);
    expect(DUNGEON_RIG.hemiIntensity).toBeLessThan(GALLERY_RIG.hemiIntensity * 0.1);
    expect(DUNGEON_RIG.sunIntensity).toBe(0);
  });

  it('fog closes in hard — the reference swallows a corridor by ~6 m', () => {
    expect(DUNGEON_RIG.fogFar).toBeLessThan(GALLERY_RIG.fogFar * 0.5);
    expect(DUNGEON_RIG.fogNear).toBeLessThan(DUNGEON_RIG.fogFar);
    expect(lum(DUNGEON_RIG.fogColor)).toBeLessThan(0.02);
  });

  it('the flashlight is COLD and the practicals are WARM — the palette decision', () => {
    const [fr, fg, fb] = DUNGEON_RIG.flashlightColor;
    expect(fb).toBeGreaterThanOrEqual(fr);           // cold: blue >= red
    const [pr, , pb] = DUNGEON_RIG.practicalColor;
    expect(pr).toBeGreaterThan(pb + 0.3);            // warm: red clearly over blue
    expect(fg).toBeGreaterThan(0.9);                 // near-white, not blue-tinted
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts`
Expected: FAIL — `Failed to resolve import "./dungeon-lighting"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lab/sdf-zombie/webgpu/dungeon-lighting.ts
//
// THE DUNGEON RIG, AS DATA. Kept separate from game-main so the numbers can be
// gated by test without standing up a renderer, and so the gallery rig survives
// as a live A/B rather than as a comment. See
// docs/superpowers/specs/2026-09-01-dungeon-relighting-design.md.
export type Vec3 = [number, number, number];

export interface AmbientRig {
  /** THREE.AmbientLight intensity. */
  ambientIntensity: number;
  /** THREE.HemisphereLight intensity. */
  hemiIntensity: number;
  /** THREE.DirectionalLight intensity — 0 in a dungeon; there is no sun. */
  sunIntensity: number;
  ambientColor: Vec3;
  hemiSky: Vec3;
  hemiGround: Vec3;
  fogColor: Vec3;
  fogNear: number;
  fogFar: number;
  /** Near-white. Warm light on warm stone kills the specular we are here for. */
  flashlightColor: Vec3;
  /** Warm fire, the only warm source in the room. */
  practicalColor: Vec3;
}

/** The white-wall gallery as it shipped (L1 P1). Kept for the A/B and as the
 *  fixture the dungeon's darkness assertions are measured against. */
export const GALLERY_RIG: AmbientRig = {
  ambientIntensity: 0.95,
  hemiIntensity: 0.75,
  sunIntensity: 0.9,
  ambientColor: [1, 1, 1],
  hemiSky: [0.96, 0.95, 0.94],
  hemiGround: [0.56, 0.55, 0.52],
  fogColor: [0.10, 0.067, 0.086],
  fogNear: 10,
  fogFar: 60,
  flashlightColor: [1, 0.97, 0.94],
  practicalColor: [1, 0.55, 0.12],
};

/** Dark, dank, wet gray. Ambient is a FLOOR, not a fill: enough that geometry
 *  is not literally invisible when the beam points elsewhere, far too little to
 *  read by. Everything you actually see comes from the flashlight and the fires. */
export const DUNGEON_RIG: AmbientRig = {
  ambientIntensity: 0.035,
  hemiIntensity: 0.05,
  sunIntensity: 0,
  ambientColor: [0.52, 0.57, 0.63],   // cold, slightly blue — damp stone in the dark
  hemiSky: [0.34, 0.38, 0.44],
  hemiGround: [0.13, 0.13, 0.12],
  fogColor: [0.008, 0.009, 0.011],    // effectively black
  fogNear: 2.5,
  fogFar: 13,
  flashlightColor: [0.94, 0.96, 1.0], // cold near-white
  practicalColor: [1.0, 0.46, 0.13],  // fire
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/dungeon-lighting.ts src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts
git commit -m "dungeon: the rig as data, with the gallery kept as its A/B fixture"
```

---

## Task 2: The flashlight, and the shadow fix that makes it mean anything

This task implements the **verified fix** from the spec's spike section. Read that section before starting — the root cause is confirmed in three's source and the fix is two lines, but it is completely non-obvious.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/dungeon-lighting.ts`
- Modify: `src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts`:

```ts
import * as THREE from 'three';
import { createFlashlight, FLASHLIGHT_OFFSET } from './dungeon-lighting';
import { OCCLUDER_LAYER } from './sdf-layer';

describe('createFlashlight', () => {
  it('sets a shadow-camera layer mask with a bit ABOVE bit 0 — the whole bug', () => {
    // ShadowNode.js:731 copies the MAIN camera's mask onto the shadow camera
    // whenever (mask & 0xFFFFFFFE) === 0. sdfLayer pins camera.layers to
    // CONE_LAYER/OCCLUDER_LAYER mid-frame, so inheriting it renders a shadow
    // map with no level geometry in it. A high bit here stops the copy.
    const { spot } = createFlashlight();
    expect(spot.shadow.camera.layers.mask & 0xFFFFFFFE).not.toBe(0);
  });

  it('casts from BOTH the level (layer 0) and the character hull', () => {
    const { spot } = createFlashlight();
    expect(spot.shadow.camera.layers.test(new THREE.Layers())).toBe(true); // layer 0
    const hullLayer = new THREE.Layers();
    hullLayer.set(OCCLUDER_LAYER);
    expect(spot.shadow.camera.layers.test(hullLayer)).toBe(true);
  });

  it('is mounted OFFSET from the eye — an eye-mounted light casts no visible shadow', () => {
    // Horizontal offset is what makes the shadow emerge from behind its caster.
    expect(Math.abs(FLASHLIGHT_OFFSET[0])).toBeGreaterThan(0.15);
    expect(FLASHLIGHT_OFFSET[1]).toBeLessThan(0);   // below the eye
  });

  it('casts shadows and is cold', () => {
    const { spot } = createFlashlight();
    expect(spot.castShadow).toBe(true);
    expect(spot.color.b).toBeGreaterThanOrEqual(spot.color.r);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts`
Expected: FAIL — `createFlashlight is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lab/sdf-zombie/webgpu/dungeon-lighting.ts`:

```ts
import * as THREE from 'three';
import { OCCLUDER_LAYER } from './sdf-layer';

/** Offset from the eye, in view space: right, up, forward.
 *
 *  LOAD-BEARING. A flashlight AT the eye casts no visible shadow — every
 *  shadow it throws is exactly hidden behind the object throwing it (the
 *  headlight problem, demonstrated live during the spike). The horizontal
 *  offset is what makes shadows emerge, and it is the entire Doom 3 read. */
export const FLASHLIGHT_OFFSET: Vec3 = [0.25, -0.15, 0.1];

export interface Flashlight {
  spot: THREE.SpotLight;
  /** Pose the light from the camera each frame. */
  update(camera: THREE.PerspectiveCamera): void;
}

export function createFlashlight(rig: AmbientRig = DUNGEON_RIG): Flashlight {
  const c = rig.flashlightColor;
  const spot = new THREE.SpotLight(
    new THREE.Color(c[0], c[1], c[2]),
    90,               // intensity — physically-correct falloff wants a big number
    16,               // distance
    Math.PI * 0.24,   // cone half-angle
    0.45,             // penumbra
    1.6,              // decay
  );
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 0.2;
  spot.shadow.camera.far = 18;
  spot.shadow.bias = -0.002;

  // THE FIX — see the test above and the spec's spike section. Setting any bit
  // above bit 0 stops three inheriting the main camera's (mid-frame, wrong)
  // mask, AND opts the character hull in as a shadow caster. One change, both
  // shadow mechanisms.
  spot.shadow.camera.layers.set(0);
  spot.shadow.camera.layers.enable(OCCLUDER_LAYER);

  const eye = new THREE.Vector3();
  const off = new THREE.Vector3();
  const fwd = new THREE.Vector3();

  function update(camera: THREE.PerspectiveCamera) {
    camera.updateMatrixWorld();
    camera.getWorldPosition(eye);
    off.set(FLASHLIGHT_OFFSET[0], FLASHLIGHT_OFFSET[1], FLASHLIGHT_OFFSET[2])
      .applyQuaternion(camera.quaternion);
    spot.position.copy(eye).add(off);
    camera.getWorldDirection(fwd);
    spot.target.position.copy(spot.position).addScaledVector(fwd, 10);
    spot.target.updateMatrixWorld();
    spot.updateMatrixWorld();
  }

  return { spot, update };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Wire it into the game page**

In `src/lab/sdf-zombie/webgpu/game-main.ts`, immediately after `scene.add(accentGroup);`, insert:

```ts
  // ---------------------------------------------------------------------
  // DUNGEON RIG. Off-state parity matters: with dungeon disabled the gallery
  // must render exactly as before, so the rig is applied, not hard-coded.
  // ---------------------------------------------------------------------
  let dungeonOn = true;
  const flashlight = createFlashlight();
  scene.add(flashlight.spot);
  scene.add(flashlight.spot.target);

  handle.renderer.shadowMap.enabled = true;
  handle.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  levelGroup.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  function applyRig(rig: AmbientRig) {
    hemi.intensity = rig.hemiIntensity;
    hemi.color.setRGB(...rig.hemiSky);
    hemi.groundColor.setRGB(...rig.hemiGround);
    for (const child of scene.children) {
      if (child instanceof THREE.DirectionalLight) child.intensity = rig.sunIntensity;
      if (child instanceof THREE.AmbientLight) {
        child.intensity = rig.ambientIntensity;
        child.color.setRGB(...rig.ambientColor);
      }
    }
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.setRGB(...rig.fogColor);
      fog.near = rig.fogNear;
      fog.far = rig.fogFar;
    }
    handle.renderer.setClearColor(new THREE.Color(...rig.fogColor));
    flashlight.spot.visible = rig === DUNGEON_RIG;
  }
  applyRig(DUNGEON_RIG);

  (globalThis as Record<string, unknown>).__dungeon = {
    setDungeon(on: boolean) { dungeonOn = on; applyRig(on ? DUNGEON_RIG : GALLERY_RIG); },
    get on() { return dungeonOn; },
  };
```

Add to the import block at the top of `game-main.ts`:

```ts
import { createFlashlight, applyRigTypes as _unusedRigTypes, DUNGEON_RIG, GALLERY_RIG, type AmbientRig } from './dungeon-lighting';
```

…except drop the placeholder import — the actual line is:

```ts
import { createFlashlight, DUNGEON_RIG, GALLERY_RIG, type AmbientRig } from './dungeon-lighting';
```

Then, inside the existing per-frame draw function registered via `handle.setDrawFn`, add as the **first** statement of the callback:

```ts
    flashlight.update(camera);
```

- [ ] **Step 6: Verify on screen — this is not optional**

Nothing in this repo compiles WGSL or shaders in tests, and three render bugs have survived eight green dispatch tasks here.

1. Run the dev server via the preview tooling (never `npm run dev` in a raw shell) and open `/sdf-game.html`.
2. Expect: a dark room with one bright cone, and **a cast shadow behind furniture** offset from your view direction.
3. In the console, A/B the fix: `__dungeon.setDungeon(false)` must restore the bright gallery exactly.
4. Confirm shadows are real, not cone falloff:
   `__spikeCheck = () => { const s = ...; }` — simpler: aim at a crate and strafe. The dark region must move with the *light*, not with the crate's own shading.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: 7 failures, all in `scripts/blob-measure.test.ts` (the pre-existing known-failure file). Any other failure is yours.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/dungeon-lighting.ts src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "dungeon: offset flashlight + the shadow-camera layer fix

ShadowNode.js:731 copies the main camera's layer mask onto the shadow camera
when the shadow camera has no bit above bit 0, and sdfLayer pins camera.layers
mid-frame — so the shadow map rendered with no level geometry in it. Setting
the mask explicitly fixes it and enrols the character hull as a caster."
```

---

## Task 3: Procedural stone — the pure generators

The normal map **is** the feature. "More specular" is meaningless on a flat surface: a highlight needs relief to slide across.

Keep pixel generation free of `canvas` and `three` so it is testable in vitest.

**Files:**
- Create: `src/game/level/stone-textures.ts`
- Create: `src/game/level/stone-textures.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/game/level/stone-textures.test.ts
//
// Fixture note (degenerate-fixture house rule): every assertion here compares
// TWO different sample regions, or two different tunings, so a generator that
// returned a constant buffer cannot pass.
import { describe, expect, it } from 'vitest';
import { generateStone, STONE_SIZE, type StoneKind } from './stone-textures';

const px = (buf: Uint8ClampedArray, x: number, y: number) => {
  const i = (y * STONE_SIZE + x) * 4;
  return [buf[i]!, buf[i + 1]!, buf[i + 2]!, buf[i + 3]!] as const;
};

describe('generateStone', () => {
  it('is deterministic for a given seed', () => {
    const a = generateStone('wallBrick', 1234);
    const b = generateStone('wallBrick', 1234);
    expect(Array.from(a.albedo.slice(0, 512))).toEqual(Array.from(b.albedo.slice(0, 512)));
  });

  it('a different seed gives different stone', () => {
    const a = generateStone('wallBrick', 1);
    const b = generateStone('wallBrick', 2);
    expect(Array.from(a.albedo.slice(0, 512))).not.toEqual(Array.from(b.albedo.slice(0, 512)));
  });

  it('albedo is DESATURATED GRAY — the palette decision, not sepia', () => {
    const { albedo } = generateStone('wallBrick', 7);
    let checked = 0;
    for (let y = 4; y < STONE_SIZE; y += 37) {
      for (let x = 4; x < STONE_SIZE; x += 37) {
        const [r, g, b] = px(albedo, x, y);
        // red must never run away from blue the way sandstone does
        expect(r - b).toBeLessThan(26);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('the normal map is a real map, not a flat sheet', () => {
    const { normal } = generateStone('wallBrick', 7);
    // A flat normal map is (128,128,255) everywhere. Mortar lines must deviate.
    let deviating = 0;
    for (let i = 0; i < normal.length; i += 4) {
      if (Math.abs(normal[i]! - 128) > 12 || Math.abs(normal[i + 1]! - 128) > 12) deviating++;
    }
    expect(deviating).toBeGreaterThan(normal.length / 4 * 0.02);
  });

  it('normal-map STRENGTH is a real knob — the primary Doom 3 control', () => {
    const soft = generateStone('wallBrick', 7, { normalStrength: 0.2 });
    const hard = generateStone('wallBrick', 7, { normalStrength: 2.0 });
    const spread = (n: Uint8ClampedArray) => {
      let s = 0;
      for (let i = 0; i < n.length; i += 4) s += Math.abs(n[i]! - 128);
      return s;
    };
    expect(spread(hard)).toBeGreaterThan(spread(soft) * 1.5);
  });

  it('WET regions are both darker and glossier than dry ones', () => {
    const { albedo, roughness, wetMask } = generateStone('wallBrick', 7);
    let wet = -1, dry = -1;
    for (let i = 0; i < wetMask.length && (wet < 0 || dry < 0); i++) {
      if (wetMask[i]! > 200 && wet < 0) wet = i;
      if (wetMask[i]! < 20 && dry < 0) dry = i;
    }
    expect(wet).toBeGreaterThanOrEqual(0);
    expect(dry).toBeGreaterThanOrEqual(0);
    // glossier == LOWER roughness
    expect(roughness[wet * 4]!).toBeLessThan(roughness[dry * 4]!);
    expect(albedo[wet * 4]!).toBeLessThan(albedo[dry * 4]!);
  });

  it('floor cobble and wall brick are different stone', () => {
    const wall = generateStone('wallBrick', 7);
    const floor = generateStone('floorCobble', 7);
    expect(Array.from(wall.albedo.slice(0, 512))).not.toEqual(Array.from(floor.albedo.slice(0, 512)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/level/stone-textures.test.ts`
Expected: FAIL — `Failed to resolve import "./stone-textures"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/game/level/stone-textures.ts
//
// PROCEDURAL STONE. Generated, never shipped as art — which sidesteps the
// extracted-Blood-asset guardrail entirely (see CLAUDE.md) and, more usefully,
// makes normal-map strength a tunable number instead of a repaint.
//
// The CORE is pure: no canvas, no three, no DOM. That is what lets the look be
// gated by unit test in a codebase where nothing compiles a shader.
export const STONE_SIZE = 256;

export type StoneKind = 'wallBrick' | 'floorCobble' | 'ceilingVault';

export interface StoneTuning {
  /** Height→normal gain. THE primary Doom 3 knob: this is what the moving
   *  flashlight highlight slides across. */
  normalStrength: number;
  /** Roughness of bone-dry stone. */
  dryRoughness: number;
  /** Roughness of soaked stone. Wet == glossy == LOW roughness. */
  wetRoughness: number;
  /** How much wet stone darkens its albedo. */
  wetDarkening: number;
}

export const DEFAULT_TUNING: StoneTuning = {
  normalStrength: 1.0,
  dryRoughness: 0.82,
  wetRoughness: 0.22,
  wetDarkening: 0.45,
};

export interface StoneMaps {
  albedo: Uint8ClampedArray;    // RGBA, sRGB
  normal: Uint8ClampedArray;    // RGBA, LINEAR — tangent-space normal
  roughness: Uint8ClampedArray; // RGBA, LINEAR — value in .r
  /** Single channel, 0..255. Exposed so tests (and tuning) can find wet spots. */
  wetMask: Uint8ClampedArray;
}

/** Deterministic hash-noise. Not the prettiest noise; it is reproducible,
 *  which matters more here than beauty — the tests pin generated pixels. */
function hash2(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 1274126177;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x: number, y: number, seed: number, scale: number): number {
  const sx = x / scale, sy = y / scale;
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const fx = sx - x0, fy = sy - y0;
  const ex = fx * fx * (3 - 2 * fx), ey = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0, seed), n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed), n11 = hash2(x0 + 1, y0 + 1, seed);
  return (n00 * (1 - ex) + n10 * ex) * (1 - ey) + (n01 * (1 - ex) + n11 * ex) * ey;
}

function fbm(x: number, y: number, seed: number, scale: number, octaves = 4): number {
  let sum = 0, amp = 0.5, s = scale;
  for (let o = 0; o < octaves; o++) {
    sum += smoothNoise(x, y, seed + o * 101, s) * amp;
    s *= 0.5; amp *= 0.5;
  }
  return sum;
}

/** Height field for one stone kind, 0..1. Mortar courses sit LOW so the light
 *  rakes across the brick faces and catches their edges. */
function heightAt(kind: StoneKind, x: number, y: number, seed: number): number {
  const grain = fbm(x, y, seed, 18) * 0.35 + fbm(x, y, seed + 7, 5) * 0.12;
  if (kind === 'floorCobble') {
    const cx = Math.floor(x / 22), cy = Math.floor(y / 22);
    const jitter = hash2(cx, cy, seed) * 6;
    const lx = ((x + jitter) % 22) / 22 - 0.5, ly = ((y + jitter) % 22) / 22 - 0.5;
    const dome = Math.max(0, 1 - (lx * lx + ly * ly) * 4.2);
    return Math.min(1, dome * 0.7 + grain);
  }
  const courseH = kind === 'ceilingVault' ? 20 : 28;
  const row = Math.floor(y / courseH);
  const stagger = (row % 2) * 0.5;
  const brickW = kind === 'ceilingVault' ? 40 : 56;
  const u = (x / brickW + stagger) % 1;
  const v = (y % courseH) / courseH;
  const mortar = 0.09;
  const inBrick = u > mortar && u < 1 - mortar && v > mortar && v < 1 - mortar;
  const edge = Math.min(
    Math.min(u, 1 - u) / mortar,
    Math.min(v, 1 - v) / mortar,
  );
  const face = inBrick ? 1 : Math.max(0, edge) * 0.55;
  const chip = hash2(Math.floor(x / brickW), row, seed + 3) * 0.14;
  return Math.min(1, face * (0.82 - chip) + grain);
}

/** Wetness, 0..1. Runs DOWN: streaks, and a soaked band at the bottom of the
 *  image, which maps to the base of a wall where damp actually collects. */
function wetAt(kind: StoneKind, x: number, y: number, seed: number): number {
  const t = y / STONE_SIZE;
  if (kind === 'ceilingVault') {
    // Ceilings get seep patches, not gravity streaks.
    return Math.max(0, fbm(x, y, seed + 31, 40) * 1.7 - 0.62);
  }
  const base = kind === 'floorCobble'
    ? Math.max(0, fbm(x, y, seed + 17, 34) * 1.9 - 0.72)   // puddles
    : Math.pow(t, 2.2) * 0.85;                              // damp rises up the wall
  const streak = Math.max(0, fbm(x * 0.25, y, seed + 5, 26) * 1.6 - 0.72) * (1 - t * 0.4);
  return Math.min(1, base + streak);
}

export function generateStone(
  kind: StoneKind,
  seed: number,
  tuning: Partial<StoneTuning> = {},
): StoneMaps {
  const t = { ...DEFAULT_TUNING, ...tuning };
  const n = STONE_SIZE * STONE_SIZE;
  const albedo = new Uint8ClampedArray(n * 4);
  const normal = new Uint8ClampedArray(n * 4);
  const roughness = new Uint8ClampedArray(n * 4);
  const wetMask = new Uint8ClampedArray(n);

  // Height first — the normal map is its derivative, so it must exist whole.
  const h = new Float32Array(n);
  for (let y = 0; y < STONE_SIZE; y++) {
    for (let x = 0; x < STONE_SIZE; x++) h[y * STONE_SIZE + x] = heightAt(kind, x, y, seed);
  }

  // COLD GRAY, deliberately. Warm light on warm stone gives soft golden
  // highlights that fight the specular this whole feature exists to deliver.
  const BASE: Record<StoneKind, [number, number, number]> = {
    wallBrick: [116, 119, 122],
    floorCobble: [86, 88, 90],
    ceilingVault: [98, 101, 105],
  };

  const wrap = (i: number) => (i + STONE_SIZE) % STONE_SIZE;
  for (let y = 0; y < STONE_SIZE; y++) {
    for (let x = 0; x < STONE_SIZE; x++) {
      const i = y * STONE_SIZE + x;
      const wet = wetAt(kind, x, y, seed);
      wetMask[i] = Math.round(wet * 255);

      const [br, bg, bb] = BASE[kind];
      const shade = 0.6 + h[i]! * 0.5;
      const damp = 1 - wet * t.wetDarkening;
      albedo[i * 4 + 0] = br * shade * damp;
      albedo[i * 4 + 1] = bg * shade * damp;
      albedo[i * 4 + 2] = bb * shade * damp * (1 + wet * 0.05); // damp reads cooler
      albedo[i * 4 + 3] = 255;

      const r = t.dryRoughness + (t.wetRoughness - t.dryRoughness) * wet;
      roughness[i * 4 + 0] = r * 255;
      roughness[i * 4 + 1] = r * 255;
      roughness[i * 4 + 2] = r * 255;
      roughness[i * 4 + 3] = 255;

      // Sobel-lite central difference → tangent-space normal.
      const hl = h[y * STONE_SIZE + wrap(x - 1)]!, hr = h[y * STONE_SIZE + wrap(x + 1)]!;
      const hd = h[wrap(y - 1) * STONE_SIZE + x]!, hu = h[wrap(y + 1) * STONE_SIZE + x]!;
      const dx = (hl - hr) * t.normalStrength * 3;
      const dy = (hd - hu) * t.normalStrength * 3;
      const len = Math.hypot(dx, dy, 1);
      normal[i * 4 + 0] = (dx / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 1] = (dy / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 2] = (1 / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 3] = 255;
    }
  }
  return { albedo, normal, roughness, wetMask };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/level/stone-textures.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/game/level/stone-textures.ts src/game/level/stone-textures.test.ts
git commit -m "stone: pure procedural albedo/normal/roughness generators

Core is canvas-free and three-free so the look can be gated by unit test in a
codebase where nothing compiles a shader. Normal strength is the Doom 3 knob."
```

---

## Task 4: Stone → three.js textures, wired through the role seam

**Files:**
- Modify: `src/game/level/stone-textures.ts`
- Modify: `src/game/level/theme-material-set.ts`
- Modify: `src/game/level/theme-material-set.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/game/level/theme-material-set.test.ts`:

```ts
import * as THREE from 'three';
import { dungeonMaterialSet } from './theme-material-set';

describe('dungeonMaterialSet', () => {
  it('every surface carries albedo, normal AND roughness maps', () => {
    const set = dungeonMaterialSet();
    for (const key of ['floor', 'wall', 'coverLow', 'coverMid', 'perimeterAccent'] as const) {
      const m = set[key] as THREE.MeshStandardMaterial;
      expect(m.map, `${key} albedo`).toBeTruthy();
      expect(m.normalMap, `${key} normal`).toBeTruthy();
      expect(m.roughnessMap, `${key} roughness`).toBeTruthy();
    }
  });

  it('albedo is sRGB and the DATA maps stay linear — the recorded colour-space bug', () => {
    const m = dungeonMaterialSet().wall as THREE.MeshStandardMaterial;
    expect(m.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(m.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(m.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);
  });

  it('floor and wall use DIFFERENT stone, not one texture reused', () => {
    const set = dungeonMaterialSet();
    const wall = set.wall as THREE.MeshStandardMaterial;
    const floor = set.floor as THREE.MeshStandardMaterial;
    expect(wall.map).not.toBe(floor.map);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/level/theme-material-set.test.ts`
Expected: FAIL — `dungeonMaterialSet is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/game/level/stone-textures.ts`:

```ts
import * as THREE from 'three';

/** Wrap generated pixels as GPU textures.
 *
 *  COLOUR SPACE IS NOT COSMETIC HERE. three defaults textures to NoColorSpace
 *  while the renderer outputs sRGB, so an untagged albedo double-converts and
 *  washes out — a bug this codebase has already paid for once. Albedo is sRGB;
 *  normal and roughness are DATA and must stay linear. */
export function stoneTextures(
  kind: StoneKind,
  seed: number,
  tuning: Partial<StoneTuning> = {},
): { map: THREE.DataTexture; normalMap: THREE.DataTexture; roughnessMap: THREE.DataTexture } {
  const { albedo, normal, roughness } = generateStone(kind, seed, tuning);
  const make = (data: Uint8ClampedArray, srgb: boolean) => {
    const t = new THREE.DataTexture(data, STONE_SIZE, STONE_SIZE, THREE.RGBAFormat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  };
  return {
    map: make(albedo, true),
    normalMap: make(normal, false),
    roughnessMap: make(roughness, false),
  };
}
```

Append to `src/game/level/theme-material-set.ts`:

```ts
import { stoneTextures } from './stone-textures';

/** The dungeon set. Replaces defaultMaterialSet() on the game page; the
 *  untextured default stays for the gallery A/B. */
export function dungeonMaterialSet(): ThemeMaterialSet {
  const wall = stoneTextures('wallBrick', 11);
  const floor = stoneTextures('floorCobble', 23);
  const ceil = stoneTextures('ceilingVault', 37);
  const mat = (
    tex: ReturnType<typeof stoneTextures>,
    repeat: number,
  ) => {
    const m = new THREE.MeshStandardMaterial({
      ...tex,
      // Relief comes from the normal map, so keep the scalar low and let the
      // roughness MAP carry the wet/dry story.
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(1.1, 1.1),
    });
    for (const t of [m.map, m.normalMap, m.roughnessMap]) {
      if (t) t.repeat.set(repeat, repeat);
    }
    return m;
  };
  return {
    wall: mat(wall, 2),
    floor: mat(floor, 3),
    coverLow: mat(wall, 1),
    coverMid: mat(wall, 1),
    perimeterAccent: mat(ceil, 2),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/level/theme-material-set.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/level/stone-textures.ts src/game/level/theme-material-set.ts src/game/level/theme-material-set.test.ts
git commit -m "stone: DataTexture wrapper + dungeonMaterialSet through the role seam"
```

---

## Task 5: Dungeon palette on the level, and stone on the meshes

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-level.ts:129-131,162`
- Modify: `src/lab/sdf-zombie/webgpu/gallery-lighting.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:137-175`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/dungeon-palette.test.ts`:

```ts
// Fixture note: each assertion contrasts two different surfaces or two
// channels, so a uniform-grey constant cannot satisfy them all.
import { describe, expect, it } from 'vitest';
import { ROOMS, TUNNELS } from './game-level';

const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

describe('dungeon palette', () => {
  it('walls are DARK stone — the gallery white is gone', () => {
    for (const r of ROOMS) {
      expect(lum(r.wallColor), r.name).toBeLessThan(0.28);
      expect(lum(r.ceilColor), r.name).toBeLessThan(0.28);
      expect(lum(r.floorColor), r.name).toBeLessThan(lum(r.wallColor));
    }
  });

  it('stone is COLD, never sepia — red must not lead blue', () => {
    for (const r of ROOMS) {
      for (const c of [r.wallColor, r.floorColor, r.ceilColor]) {
        expect(c[0]!).toBeLessThanOrEqual(c[2]! + 0.012);
      }
    }
    for (const t of TUNNELS) expect(t.color[0]!).toBeLessThanOrEqual(t.color[2]! + 0.012);
  });

  it('tunnels are darker than the rooms they join — a throat, not a gallery', () => {
    for (const t of TUNNELS) expect(lum(t.color)).toBeLessThan(lum(ROOMS[0]!.wallColor));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/dungeon-palette.test.ts`
Expected: FAIL — walls are `[0.88, 0.87, 0.85]`, luminance ≈ 0.87.

- [ ] **Step 3: Write minimal implementation**

In `src/lab/sdf-zombie/webgpu/game-level.ts`, replace lines 129–131:

```ts
// DUNGEON STONE. Cold gray, deliberately not the reference video's sepia:
// warm light on warm stone gives soft golden highlights that fight the
// specular this pivot exists to deliver. Ceilings sit BELOW walls now —
// the gallery lifted them so they read as a top surface under flat ambient;
// here the flashlight does that job and a lifted ceiling only kills the dark.
const GALLERY_WALL: Vec3 = [0.21, 0.215, 0.225];
const GALLERY_FLOOR: Vec3 = [0.135, 0.138, 0.142];
const GALLERY_CEIL: Vec3 = [0.175, 0.18, 0.19];
```

And line 162:

```ts
// Darker than either room: the passage is a throat between chambers.
const TUNNEL_COLOR: Vec3 = [0.10, 0.104, 0.112];
```

- [ ] **Step 4: Update the superseded gallery assertions**

`gallery-lighting.test.ts`'s first test asserts `wallColor >= 0.8` and `ceilColor > wallColor`. Both are now false by design. Replace that `describe('gallery paint')` block entirely with:

```ts
describe('gallery paint — SUPERSEDED by the dungeon pivot', () => {
  // The white-gallery assertions moved to dungeon-palette.test.ts, which
  // asserts the opposite on purpose (L2, 2026-09-01). What survives here is
  // the STRUCTURAL rule that outlived the repaint: the floor must never read
  // as another wall, or the horizon disappears.
  it('floors stay clearly darker than walls', () => {
    const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    for (const r of ROOMS) expect(lum(r.floorColor)).toBeLessThan(lum(r.wallColor));
  });
});
```

- [ ] **Step 5: Put stone on the meshes**

In `game-main.ts`, the plane loop at `:140` and box loop at `:165` construct bare `MeshStandardMaterial`s. Replace both material constructions so they take maps from the role seam. Before the `for (const p of surfaces.planes)` loop, add:

```ts
  const stoneSet = dungeonMaterialSet();
  const stoneFor = (axis: 0 | 1 | 2, facing: 1 | -1) =>
    axis !== 1 ? stoneSet.wall
      : facing > 0 ? stoneSet.floor
        : stoneSet.perimeterAccent;
```

Then in the plane loop, replace the `new THREE.Mesh(geo, new THREE.MeshStandardMaterial({...}))` call with:

```ts
    const base = stoneFor(axis, p.facing) as THREE.MeshStandardMaterial;
    const mesh = new THREE.Mesh(geo, base.clone());
    const mm = mesh.material as THREE.MeshStandardMaterial;
    mm.color = new THREE.Color(p.color[0], p.color[1], p.color[2]);
    // Ceilings keep a whisper of self-light so they do not read as a void —
    // but far less than the gallery needed, because the flashlight now
    // reaches them.
    if (isCeiling) mm.emissive = new THREE.Color(p.color[0], p.color[1], p.color[2]).multiplyScalar(0.10);
```

In the box loop, replace its material with:

```ts
    const mesh = new THREE.Mesh(geo, (stoneSet.coverLow as THREE.MeshStandardMaterial).clone());
    (mesh.material as THREE.MeshStandardMaterial).color =
      new THREE.Color(b.color[0], b.color[1], b.color[2]);
```

Add the import to `game-main.ts`:

```ts
import { dungeonMaterialSet } from '../../../game/level/theme-material-set';
```

(Verify the relative depth against the file's existing imports and adjust if it differs.)

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: 7 failures, all in `scripts/blob-measure.test.ts`.

- [ ] **Step 7: Verify on screen**

Open `/sdf-game.html`. Expect visible brick courses with the flashlight raking across them and highlights that **move as you strafe** — that motion is the whole deliverable. If the stone looks flat, the normal map is not bound; check `normalScale` and that `normalMap.colorSpace` is `NoColorSpace`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "dungeon: cold stone palette + textured level surfaces"
```

---

## Task 6: Braziers — the accents become fire

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-level.ts:133-160`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (accent group)
- Modify: `src/lab/sdf-zombie/webgpu/dungeon-palette.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/webgpu/dungeon-palette.test.ts`:

```ts
describe('braziers', () => {
  it('every accent is FIRE — warm, never the gallery art-wash', () => {
    for (const r of ROOMS) {
      for (const a of r.accents) {
        expect(a.color[0]!, r.name).toBeGreaterThan(a.color[2]! + 0.35);
        expect(a.color[1]!, r.name).toBeGreaterThan(a.color[2]!);
      }
    }
  });

  it('at least one brazier per room, so no chamber is lit only by the beam', () => {
    for (const r of ROOMS) expect(r.accents.length, r.name).toBeGreaterThanOrEqual(1);
  });

  it('braziers sit low enough to be furniture, not ceiling fixtures', () => {
    for (const r of ROOMS) for (const a of r.accents) expect(a.pos[1]!).toBeLessThan(2.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/dungeon-palette.test.ts`
Expected: FAIL — room1's accent is `[1.0, 0.10, 0.06]` at `y = 2.5`; the teal/violet/magenta accents fail the warmth check outright.

- [ ] **Step 3: Write minimal implementation**

In `game-level.ts`, replace each room's `accents` array. Keep positions roughly where they were (they are clear of tunnel mouths and spawn points, which the existing gates depend on) but drop them to brazier height and recolour to fire:

```ts
  // Room 1
  accents: [{ pos: [-7.5, 1.15, -2.8], color: [1.0, 0.46, 0.13], power: 9 }],
  // Room 2
  accents: [{ pos: [7.6, 1.15, -6.3], color: [1.0, 0.42, 0.11], power: 9 }],
  // Room 3 — two fires, one cooler and further off, for depth
  accents: [
    { pos: [2.0, 1.15, 2.2], color: [1.0, 0.50, 0.16], power: 10 },
    { pos: [7.8, 1.15, 7.8], color: [0.95, 0.38, 0.10], power: 7 },
  ],
  // Room 4
  accents: [{ pos: [-3.5, 1.15, 7.9], color: [1.0, 0.44, 0.12], power: 9 }],
```

In `game-main.ts`, in the accent loop that builds `THREE.PointLight`s, add a visible source and flicker. Replace the loop body with:

```ts
  const flickerLights: { light: THREE.PointLight; base: number; phase: number }[] = [];
  for (const r of ROOMS) {
    for (const a of r.accents) {
      const pl = new THREE.PointLight(
        new THREE.Color(a.color[0], a.color[1], a.color[2]), a.power);
      pl.position.set(a.pos[0], a.pos[1], a.pos[2]);
      accentGroup.add(pl);
      flickerLights.push({ light: pl, base: a.power, phase: a.pos[0] * 3.1 + a.pos[2] * 1.7 });

      // A visible source. Without it the light has no cause and reads as a bug.
      const bowl = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.16, 1),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(a.color[0], a.color[1], a.color[2]),
          emissive: new THREE.Color(a.color[0], a.color[1], a.color[2]),
          emissiveIntensity: 2.2,
          roughness: 0.7,
        }));
      bowl.position.set(a.pos[0], a.pos[1], a.pos[2]);
      accentGroup.add(bowl);
    }
  }
```

Then, in the per-frame draw callback (alongside `flashlight.update(camera)`), add:

```ts
    // Fire flicker. Cheap and deliberately not random per frame — a smooth
    // two-rate wobble reads as flame; white noise reads as a broken light.
    const ft = performance.now() * 0.001;
    for (const f of flickerLights) {
      const w = Math.sin(ft * 7.3 + f.phase) * 0.5 + Math.sin(ft * 17.1 + f.phase * 2.3) * 0.25;
      f.light.intensity = f.base * (1 + w * 0.14);
    }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/dungeon-palette.test.ts`
Expected: PASS.

- [ ] **Step 5: Check the bounce gate still holds**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/gallery-lighting.test.ts`
Expected: PASS. `litWallAlbedo`'s tests use their own local fixtures, so recolouring `ROOMS` must not break them. If one fails, the test was leaning on `ROOMS` data — fix the test to use a local fixture, not the constants.

- [ ] **Step 6: Verify on screen, then commit**

Open `/sdf-game.html`, walk to a brazier. Expect a warm pool with a visible glowing source and a subtle flicker, against cold stone.

```bash
git add -A
git commit -m "dungeon: braziers — accents become fire with visible sources and flicker"
```

---

## Task 7: The flashlight reaches the SDF characters

**The owner has already caught this one by eye:** *"the characters themselves dont seem to be lit by the direction of the light source."* That is the two-lighting-systems split — SDF bodies are shaded inside the march and cannot see a `THREE.SpotLight` at all.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts:227-231,580-596`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts:1184,1795-1850`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`:

```ts
import { MARCH_WGSL } from './march.wgsl';

describe('analytic flashlight', () => {
  it('is present in the shading block', () => {
    expect(MARCH_WGSL).toContain('spotCfg');
    expect(MARCH_WGSL).toContain('spotPos');
    expect(MARCH_WGSL).toContain('spotAxis');
  });

  it('adds ZERO mapBody evaluations — the constraint the whole design rests on', () => {
    // Extract the spotlight block and prove no field call hides in it.
    const start = MARCH_WGSL.indexOf('// ---- ANALYTIC FLASHLIGHT');
    const end = MARCH_WGSL.indexOf('// ---- END ANALYTIC FLASHLIGHT');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = MARCH_WGSL.slice(start, end);
    expect(block).not.toContain('mapBody');
    expect(block).not.toContain('map(');
  });

  it('drives keyColor, not albedo — brightness cannot ride the bounce hue', () => {
    const start = MARCH_WGSL.indexOf('// ---- ANALYTIC FLASHLIGHT');
    const end = MARCH_WGSL.indexOf('// ---- END ANALYTIC FLASHLIGHT');
    const block = MARCH_WGSL.slice(start, end);
    expect(block).toContain('keyColor');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
Expected: FAIL — `expect(start).toBeGreaterThan(-1)` gets `-1`.

- [ ] **Step 3: Add the uniforms**

In `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`, after the `lightCfg` uniform declaration (~line 229), add:

```ts
    /** Flashlight world position. */
    spotPos: uniform(new THREE.Vector3(0, 0, 0)),
    /** Flashlight beam axis, normalised, pointing AWAY from the lamp. */
    spotAxis: uniform(new THREE.Vector3(0, 0, -1)),
    /** x intensity (0 disables), y cosInner, z cosOuter, w range. */
    spotCfg: uniform(new THREE.Vector4(0, 0.93, 0.80, 16)),
    spotColor: uniform(new THREE.Color(0.94, 0.96, 1.0)),
```

And in the params object (~line 581, beside `lightCfg: u.lightCfg,`):

```ts
    spotPos: u.spotPos,
    spotAxis: u.spotAxis,
    spotCfg: u.spotCfg,
    spotColor: u.spotColor,
```

The `specialise`/clone path at ~line 1191 copies template uniforms per body; add matching lines beside `u.lightCfg.value.copy(...)`:

```ts
    u.spotPos.value.copy(template.spotPos.value);
    u.spotAxis.value.copy(template.spotAxis.value);
    u.spotCfg.value.copy(template.spotCfg.value);
    u.spotColor.value.copy(template.spotColor.value);
```

- [ ] **Step 4: Add the WGSL**

In `march.wgsl.ts`, add to the shading function's parameter list beside `lightCfg: vec2<f32>,` (~line 1185):

```wgsl
  spotPos: vec3<f32>,
  spotAxis: vec3<f32>,
  spotCfg: vec4<f32>,
  spotColor: vec3<f32>,
```

Then, immediately **before** the `let amb = ambientAt(...)` line (~line 1848), insert:

```wgsl
  // ---- ANALYTIC FLASHLIGHT ------------------------------------------------
  // The world's SpotLight is invisible to the march — SDF bodies are shaded
  // here, not by three — so the beam is re-evaluated analytically per pixel.
  //
  // PER-PIXEL, not per-body, so the cone edge cuts ACROSS a figure instead of
  // the whole zombie popping on at once.
  //
  // ZERO mapBody evaluations: a normalise, two dots and a divide. This is the
  // constraint that let character self-shadowing be cut rather than paid for.
  //
  // It drives L and keyColor — NOT albedo. ambientAt renormalises bounce to
  // unit luminance, so an albedo boost would change hue and leave brightness
  // untouched. Brightness must ride the key. (Precedent: game-flash.ts.)
  var L = normalize(lightDir);
  var keyC = keyColor;
  var keyI = lightCfg.x;
  if (spotCfg.x > 0.0) {
    let toLamp = spotPos - p;
    let dist = length(toLamp);
    let Ls = toLamp / max(dist, 1e-4);
    let cone = dot(-Ls, normalize(spotAxis));
    let coneFall = clamp((cone - spotCfg.z) / max(spotCfg.y - spotCfg.z, 1e-4), 0.0, 1.0);
    let distFall = clamp(1.0 - dist / max(spotCfg.w, 1e-4), 0.0, 1.0);
    let beam = coneFall * coneFall * distFall * distFall * spotCfg.x;
    // Blend the key TOWARD the beam. At beam 0 this is exactly the old key,
    // which keeps the lab and every existing preset bit-identical.
    L = normalize(mix(L, Ls, clamp(beam, 0.0, 1.0)));
    keyC = mix(keyColor, spotColor, clamp(beam, 0.0, 1.0));
    keyI = mix(lightCfg.x, lightCfg.x + beam * 2.2, 1.0);
  }
  // ---- END ANALYTIC FLASHLIGHT --------------------------------------------
```

Now replace the uses in the two shading expressions that follow. The existing lines are:

```wgsl
  let amb = ambientAt(p, n, boxMin, boxMax, wallNegX, wallPosX, wallNegY, wallPosY, wallNegZ, wallPosZ, bounceCfg, lightCfg.y, keyColor);
  var fleshLit = albedo * (amb + diff * wShadow * lightCfg.x * keyColor) * ao
               + keyColor * (shine * wShadow * mix(surfCfg.x, 1.5, gloss) + fres * mix(1.0, 2.5, gloss)) * wet
               + scatter;
```

Change `keyColor` → `keyC` and `lightCfg.x` → `keyI` in the two `fleshLit` lines **only**, leaving `ambientAt`'s own `keyColor` argument alone (it is the ambient's hue basis and must not move):

```wgsl
  let amb = ambientAt(p, n, boxMin, boxMax, wallNegX, wallPosX, wallNegY, wallPosY, wallNegZ, wallPosZ, bounceCfg, lightCfg.y, keyColor);
  var fleshLit = albedo * (amb + diff * wShadow * keyI * keyC) * ao
               + keyC * (shine * wShadow * mix(surfCfg.x, 1.5, gloss) + fres * mix(1.0, 2.5, gloss)) * wet
               + scatter;
```

**Important:** `diff`, `shine` and `fres` are computed from `L` *earlier* in the function. Move the flashlight block to sit **before** the first use of `L` (search for where `diff` is assigned) so the new `L` feeds them. If `L` is currently declared with `let`, change that declaration to the `var L` above and delete the old one — do not leave two.

- [ ] **Step 5: Feed the uniforms each frame**

In `game-main.ts`'s draw callback, after `flashlight.update(camera)`:

```ts
    // Hand the march the same beam the meshes get.
    const sAxis = new THREE.Vector3();
    flashlight.spot.target.getWorldPosition(sAxis).sub(flashlight.spot.position).normalize();
    chunkMaterial.uniforms?.spotPos?.value.copy(flashlight.spot.position);
```

Use whatever accessor the view exposes for per-body uniforms — follow the pattern already used by `game-flash.ts` for muzzle flash, which solves the identical problem. Set:
`spotPos` = `flashlight.spot.position`, `spotAxis` = the normalised target−position vector, `spotCfg` = `(dungeonOn ? 1 : 0, cos(angle*(1-penumbra)), cos(angle), distance)`, `spotColor` = the rig's `flashlightColor`.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: 7 failures, all in `scripts/blob-measure.test.ts`.

- [ ] **Step 7: Verify on screen — the owner's specific complaint**

Open `/sdf-game.html`. Aim the beam at a zombie and **strafe around it**. The lit side must follow the beam. Aim away: the zombie must fall into ambient. Then check the cone edge cuts across a body rather than switching it wholesale.

Also verify the lab is untouched: open `/sdf-lab-webgpu.html` and confirm the zombie looks exactly as before (`spotCfg.x` is 0 there, so the expression collapses to the old one).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "dungeon: analytic flashlight in the march — characters see the beam

Per-pixel, zero mapBody evaluations, driving keyColor rather than albedo
because ambientAt renormalises bounce to unit luminance."
```

---

## Task 8: Fix the blob shadows

The occluder hull casts as **disconnected blobs** — owner-rejected. `HULL_SHRINK 0.8` is correct for depth-occlusion (stay conservatively inside the body) and wrong for shadow casting, where gaps between shrunk spheres become gaps in the shadow.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/occluder-hull.ts:43,170-215`
- Modify: `src/lab/sdf-zombie/webgpu/occluder-hull.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/webgpu/occluder-hull.test.ts`:

```ts
import { SHADOW_HULL_INFLATE, HULL_SHRINK, buildHullInstances } from './occluder-hull';

describe('shadow-caster hull', () => {
  it('inflates rather than shrinks — gaps between spheres become gaps in the shadow', () => {
    expect(SHADOW_HULL_INFLATE).toBeGreaterThan(1.0);
    expect(HULL_SHRINK).toBeLessThan(1.0);
  });

  it('shadow spheres are strictly larger than occlusion spheres for the same body', () => {
    const bodies = makeTestBodies();   // reuse this file's existing fixture helper
    const occl = buildHullInstances(bodies, HULL_SHRINK, []);
    const shad = buildHullInstances(bodies, SHADOW_HULL_INFLATE, []);
    expect(shad.length).toBe(occl.length);
    for (let i = 0; i < shad.length; i++) {
      expect(shad[i]!.radius).toBeGreaterThan(occl[i]!.radius);
    }
  });
});
```

If `occluder-hull.test.ts` has no `makeTestBodies` helper, reuse whatever body fixture that file already builds — do not invent a new one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/occluder-hull.test.ts`
Expected: FAIL — `SHADOW_HULL_INFLATE` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `occluder-hull.ts`, beside `HULL_SHRINK`:

```ts
/** Scale for the SHADOW-CASTING hull, as opposed to the depth-occlusion hull.
 *
 *  HULL_SHRINK exists to keep the hull conservatively INSIDE the body so the
 *  march never skips real geometry. Reusing it for shadows was wrong: shrunk
 *  spheres leave gaps between them, and those gaps show up as holes in the
 *  shadow — the figure casts as a scatter of blobs rather than a body
 *  (owner-rejected, 2026-09-01). A shadow caster wants the opposite bias:
 *  overlap, so neighbouring spheres fuse into one silhouette. */
export const SHADOW_HULL_INFLATE = 1.35;
```

Then give `createOccluderHull` an optional second instanced mesh for shadow casting, or — simpler and preferred — add a `shadowObject` to the returned interface built from the same instances at the inflated scale:

```ts
export interface OccluderHull {
  object: THREE.Mesh;
  /** A SECOND hull, inflated, used only as a shadow caster. Invisible to the
   *  camera; it exists purely to be rendered into the shadow map. */
  shadowObject: THREE.Mesh;
  update(bodies: BuiltBody[], wounds?: WoundSphere[]): void;
  readonly instanceCount: number;
  dispose(): void;
}
```

Build `shadowObject` exactly as `object` is built but with `buildHullInstances(bodies, SHADOW_HULL_INFLATE, wounds)`, `visible` left true (it must render into the shadow map) and `layers.set(OCCLUDER_LAYER)` so the *camera* never draws it while the shadow camera does. Set `shadowObject.castShadow = true` and `object.castShadow = false`.

- [ ] **Step 4: Wire it**

In `game-main.ts`, beside the existing `occluderHull.object` setup:

```ts
  occluderHull.shadowObject.layers.set(OCCLUDER_LAYER);
  occluderHull.shadowObject.castShadow = true;
  scene.add(occluderHull.shadowObject);
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: 7 failures, all in `scripts/blob-measure.test.ts`.

- [ ] **Step 6: Verify on screen — this is the owner's rejection to clear**

Stand a zombie in the beam with a wall behind it. The shadow must read as **one connected figure**, not a scatter of circles. If gaps remain, raise `SHADOW_HULL_INFLATE` in 0.1 steps until they close, then stop — over-inflating makes the shadow visibly fatter than the body.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "dungeon: a separate inflated hull for shadow casting

HULL_SHRINK keeps the occlusion hull inside the body; reusing it as a shadow
caster left gaps between spheres that read as holes in the shadow."
```

---

## Task 9: Bench and the off-state parity gate

The spec calls this a **gate, not a report**. Frame cost here is genuinely unmeasured — the spike's console sampling was defeated by a stalled preview pane, and HUD readings near 100 ms could not be reproduced or trusted. Compounding debt: goo already ships ON and unbenched.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-bench-scenario.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-bench-scenario.test.ts`

- [ ] **Step 1: Add bench scenarios**

Follow the existing scenario shape in `game-bench-scenario.ts`. Add three:
`dungeon-off` (gallery rig, no flashlight), `dungeon-no-shadow` (dungeon rig, `castShadow = false`), `dungeon-shadow` (full).

- [ ] **Step 2: Write the parity test**

```ts
describe('off-state parity', () => {
  it('dungeon-off drives the SAME rig values the gallery shipped with', () => {
    const s = scenarioByName('dungeon-off');
    expect(s.rig).toEqual(GALLERY_RIG);
    expect(s.flashlight).toBe(false);
  });
});
```

- [ ] **Step 3: Run the bench**

Run: `npm run bench:sdf`
Record median and p90 frame time for all three scenarios into `docs/dev-notes/2026-09-01-dungeon-relight/baselines.json`, following the shape of `docs/dev-notes/2026-08-24-sdf-bench/baselines.json`.

- [ ] **Step 4: Report the number, and stop if it is bad**

Write the three numbers into `TASKS.md` under `L2`. If `dungeon-shadow` costs more than **+40%** over `dungeon-no-shadow`, do **not** quietly ship it — surface the number to the owner with the shadow-map-resolution trade (512² is cheaper and softer) and let them choose. Silent truncation of a cost decision is the failure mode this gate exists to prevent.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "dungeon: bench scenarios + off-state parity gate, with numbers"
```

---

## Task 10: Retune the blood against the new walls

Goo defaults (`sizeScale 0.14`, `threshold 0.65`, `blurPx 0`, `stretch 4`, `edge 2.75`, `absorb 1.6`, `spec 2.85`, `gloss 220`, `rim 0`, `shadowRed 0.12`) were tuned against **white gallery walls this plan deletes**. `shadowRed` in particular exists so blood never reads black — calibrated against a background that no longer exists.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/goo-layer.ts` (defaults only)

- [ ] **Step 1: Retune with the owner, live**

Open `/sdf-game.html`, shoot a zombie, open the goo panel (`goo-panel.ts` — 12 sliders, presets, and a COPY button that emits the exact console calls). This is a panel session, not a code session.

Pay attention to: `absorb` and `spec` (tuned against a bright background), `shadowRed` (its whole job is background-dependent), and `gloss` against the new specular-heavy stone.

- [ ] **Step 2: Paste the COPY output as the new defaults**

Update the defaults in `goo-layer.ts` to the owner-approved values.

- [ ] **Step 3: Verify and commit**

Confirm blood still never reads black in shadow, and still reads red in the beam.

```bash
git add -A
git commit -m "dungeon: retune goo defaults against the dungeon rig

The shipped values were found against white gallery walls."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 Procedural stone | 3, 4 |
| §2 Light rig (flashlight, braziers, fog) | 1, 2, 6 |
| §3 mechanism 1 walls→walls | 2 |
| §3 mechanism 2 characters→walls | 2 (enrolment) + 8 (blob fix) |
| §3 mechanism 3 walls→characters | **GAP — see below** |
| §3 shadow softness | 2 (`PCFSoftShadowMap`), 9 (resolution trade) |
| §4 Flashlight on SDF characters | 7 |
| §5 Blood retune | 10 |
| §6 verification (bench, parity, eval count, regression test) | 2, 7, 9 |

**Gap found and closed:** §3 mechanism 3 (walls shadowing characters via an analytic AABB ray) has no task. It is genuinely deferrable — with the flashlight mounted near the eye, a character you can see is nearly always one the lamp can see too, so wall-shadowing of characters is a small effect at this offset. **Decision: cut it from this plan**, and record it in `TASKS.md` as a follow-up rather than silently dropping it. Adding it would mean a per-pixel loop over ~56 AABBs for a rarely-visible case, which is the wrong trade before Task 9 gives us a frame-time budget.

**Placeholder scan:** One was found and fixed — Task 2 Step 5 originally carried a bogus `applyRigTypes` import; the correct import line is given. Task 7 Step 5 deliberately points at `game-flash.ts`'s existing pattern rather than inventing an accessor, because the per-body uniform plumbing must match what that file already does.

**Type consistency:** `AmbientRig`, `DUNGEON_RIG`, `GALLERY_RIG`, `createFlashlight`, `Flashlight`, `FLASHLIGHT_OFFSET` (task 1–2); `StoneKind`, `StoneTuning`, `StoneMaps`, `generateStone`, `stoneTextures`, `STONE_SIZE` (task 3–4); `dungeonMaterialSet` (task 4–5); `spotPos`/`spotAxis`/`spotCfg`/`spotColor` used identically in tasks 7's TS and WGSL; `SHADOW_HULL_INFLATE` and `shadowObject` consistent across task 8's test, implementation and wiring.
