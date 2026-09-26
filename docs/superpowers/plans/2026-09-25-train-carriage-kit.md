# Train carriage kit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Night Train's first slice as art and tech: a scripted kit (`kit.blend`), carriages 1, 3, 5 and 8 walkable in `night-train`, WGSL window scenery, camera/lamp/curtain sway; the Void's portal leads there.

**Architecture:** Pure logic first (`train-motion.ts`, `train-window.ts` twin), WGSL (`train-window.wgsl.ts`), then Blender (kit script with baked procedural materials; carriage build script from a table), then game wiring (`game-train-leaves.ts`: window material swap by name, sway on tagged instanced meshes, camera roll/bob), then the gate.

**Tech Stack:** TypeScript, three r186 WebGPU + TSL `wgslFn`, Blender 5.2 (bmesh, Cycles EMIT bake), vitest, CDP headless gate.

**Spec:** [2026-09-25-train-carriage-kit-design.md](../specs/2026-09-25-train-carriage-kit-design.md)

**Conventions:** game space (x, y, z), y up, the train runs along −z (the cab is north). Blender = (x, −z, y). The carriage centreline is x = 0. Kit modules' origin: centreline, floor, the bay's **south** end (+z side); a bay extends toward −z by 1.9 m.

**Two refinements of the spec, decided here:**
- **Curtains swing** about their rail like the lamps (an instance-matrix rotation), instead of a vertex-shader bend: instanced kit pieces make per-instance transforms the natural lever, and it keeps the glTF material untouched.
- **Kit instances group per (room, piece, part mesh):** a kit piece made of several meshes (wall + frame + glass) becomes one instanced node per part. The node keeps the name `kit:<room>:<piece>` when the piece has one mesh, else `kit:<room>:<piece>.<part>`, and carries the piece's `sway` extra.

---

### Task 1: `train-motion.ts` (pure)

**Files:** Create `src/lab/sdf-zombie/webgpu/train-motion.ts`, `train-motion.test.ts`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { RAIL_LENGTH_M, cameraSway, curtainSway, joltAt, lampSwing } from './train-motion';

describe('train motion', () => {
  it('camera sway is bounded and deterministic', () => {
    for (let t = 0; t < 60; t += 0.37) {
      const s = cameraSway(t, 20);
      expect(Math.abs(s.roll)).toBeLessThanOrEqual((0.6 + 0.4) * Math.PI / 180);
      expect(Math.abs(s.bob)).toBeLessThanOrEqual(0.006 + 0.01);
      expect(cameraSway(t, 20)).toEqual(s);
    }
  });
  it('a jolt lands every rail length and decays in 0.25 s', () => {
    const period = RAIL_LENGTH_M / 20;
    expect(joltAt(0, 20)).toBeCloseTo(1);
    expect(joltAt(period, 20)).toBeCloseTo(1);
    expect(joltAt(0.3, 20)).toBe(0);
    expect(joltAt(period * 0.5, 20)).toBe(0);
  });
  it('no speed, no motion', () => {
    expect(cameraSway(5, 0)).toEqual({ roll: 0, bob: 0 });
    expect(lampSwing(5, 0, 0)).toBe(0);
  });
  it('lamps swing within 4 degrees; curtains within 0..1', () => {
    for (let t = 0; t < 30; t += 0.21) {
      expect(Math.abs(lampSwing(t, 20, 1.3))).toBeLessThanOrEqual(4 * Math.PI / 180);
      const c = curtainSway(t, 20, 0.7);
      expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run; FAIL. Step 3: Implement**

```ts
// src/lab/sdf-zombie/webgpu/train-motion.ts
//
// The train's motion (carriage kit spec §6), as pure functions of SIM time and speed:
// camera roll and bob, rail-joint jolts, lamp and curtain swing. The carriages never move;
// this is what makes them feel like they do. Deterministic: same inputs, same outputs.

export const RAIL_LENGTH_M = 18;
const DEG = Math.PI / 180;
const ROLL_DEG = 0.6, BOB_M = 0.006, JOLT_S = 0.25, JOLT_ROLL_DEG = 0.4, JOLT_BOB_M = 0.01;
const LAMP_DEG = 4;

/** 1 at a rail joint, decaying linearly to 0 over JOLT_S; 0 when stopped. */
export function joltAt(t: number, speed: number): number {
  if (speed <= 0) return 0;
  const period = RAIL_LENGTH_M / speed;
  const since = ((t % period) + period) % period;
  return since < JOLT_S ? 1 - since / JOLT_S : 0;
}

/** Camera roll (radians) and bob (metres). Two incommensurate sines, plus the jolt. */
export function cameraSway(t: number, speed: number): { roll: number; bob: number } {
  if (speed <= 0) return { roll: 0, bob: 0 };
  const k = Math.min(1, speed / 20), j = joltAt(t, speed);
  const roll = (Math.sin(t * 1.1) * 0.7 + Math.sin(t * 1.73 + 1) * 0.3) * ROLL_DEG * DEG * k + j * JOLT_ROLL_DEG * DEG * Math.sign(Math.sin(t * 0.5) || 1);
  const bob = Math.sin(t * 7.3) * BOB_M * k - j * JOLT_BOB_M;
  return { roll, bob };
}

/** A lamp's swing angle (radians): lags the roll by its phase, kicked by jolts. */
export function lampSwing(t: number, speed: number, phase: number): number {
  if (speed <= 0) return 0;
  const k = Math.min(1, speed / 20), j = joltAt(t - 0.1, speed);
  const a = (Math.sin(t * 1.1 - phase) * 0.75 + j * 0.25 * Math.cos(t * 9 + phase)) * LAMP_DEG * DEG * k;
  return Math.max(-LAMP_DEG * DEG, Math.min(LAMP_DEG * DEG, a));
}

/** A curtain's sway amount 0..1 (the leaf layer maps it to a small swing). */
export function curtainSway(t: number, speed: number, phase: number): number {
  if (speed <= 0) return 0;
  const k = Math.min(1, speed / 20);
  return Math.max(0, Math.min(1, (0.5 + 0.35 * Math.sin(t * 0.9 + phase) + 0.15 * joltAt(t - 0.15, speed)) * k));
}
```

- [ ] **Step 4: Run; PASS. Commit** `feat(train): train-motion pure sway, jolts, lamp and curtain swing`.

---

### Task 2: Window scenery (twin + WGSL)

**Files:** Create `train-window.ts`, `train-window.test.ts`, `train-window.wgsl.ts`, `train-window.wgsl.test.ts`.

- [ ] **Step 1: Twin + tests.** `train-window.ts` exports the night preset and the pure layer tests:

```ts
// src/lab/sdf-zombie/webgpu/train-window.ts
//
// TypeScript twin of TRAIN_WINDOW (train-window.wgsl.ts; carriage kit spec §5): what a view
// ray through a window pane meets: poles, fence posts, the treeline, the hills, the sky.
// The track runs along -z; the train moves toward -z at `speed`, so scenery moves toward +z.

import type { Vec3 } from '../types';

export interface WindowPreset {
  speed: number;           // m/s
  poleDist: number; polePitch: number; poleHeight: number;
  postDist: number; postPitch: number; postHeight: number;
  treeDist: number; treeHeight: number;
  hillDist: number; hillHeight: number;
  ground: Vec3; tree: Vec3; hill: Vec3; pole: Vec3;
}

export const WINDOW_PRESETS: Record<'night', WindowPreset> = {
  night: {
    speed: 20,
    poleDist: 6, polePitch: 40, poleHeight: 7,
    postDist: 3.5, postPitch: 3, postHeight: 1.1,
    treeDist: 60, treeHeight: 9,
    hillDist: 400, hillHeight: 40,
    ground: [0.012, 0.014, 0.016], tree: [0.006, 0.008, 0.01], hill: [0.018, 0.022, 0.03], pole: [0.004, 0.004, 0.005],
  },
};

/** Where the ray from `eye` along `dir` (pointing outward, |x| growing) crosses the plane
 *  |x| = dist beside the track: the z there and the height above the rail head (y = 0). */
export function crossAt(eye: Vec3, dir: Vec3, dist: number): { z: number; y: number } | null {
  if (Math.abs(dir[0]) < 1e-6) return null;
  const t = (Math.sign(dir[0]) * dist - eye[0]) / dir[0];
  if (t <= 0) return null;
  return { z: eye[2] + dir[2] * t, y: eye[1] + dir[1] * t };
}

/** Is scenery coordinate z (moving: z + speed * time) on a pole/post of the given pitch and width? */
export function onStrip(z: number, time: number, speed: number, pitch: number, width: number): boolean {
  const u = (((z + speed * time) % pitch) + pitch) % pitch;
  return u < width;
}

/** Silhouette height (metres) of a band at scenery coordinate s: a sum of sines (the WGSL uses the same). */
export function silhouette(s: number, height: number, freq: number): number {
  return height * (0.55 + 0.25 * Math.sin(s * freq) + 0.12 * Math.sin(s * freq * 2.7 + 1.3) + 0.08 * Math.sin(s * freq * 6.1 + 4.1));
}
```

Tests (`train-window.test.ts`): `crossAt` from eye (0, 1.6, 0) with dir (1, 0, −1) reaches |x| = 6 at z = −6; `onStrip` true at z = 0, t = 0 and again one pitch later, false half a pitch later; moving time by `pitch / speed` returns the same answer (scenery scrolls one pitch); `silhouette` stays within [0.1·h, h] for 1000 samples; the preset's layers are ordered `postDist < poleDist < treeDist < hillDist`.

- [ ] **Step 2: WGSL** (`train-window.wgsl.ts`): `TRAIN_WINDOW` — one fn, `includes` `SKY_COLOR`:

```wgsl
fn trainWindow(wpos: vec3<f32>, eye: vec3<f32>, t: f32, cfg0: vec4<f32>, cfg1: vec4<f32>, cfg2: vec4<f32>,
  zenith: vec3<f32>, horizon: vec3<f32>, band: vec3<f32>, moonDir: vec3<f32>, moonColor: vec3<f32>, moonCfg: vec4<f32>) -> vec3<f32> {
  // cfg0: speed, poleDist, polePitch, poleHeight · cfg1: postDist, postPitch, postHeight, treeDist
  // cfg2: treeHeight, hillDist, hillHeight, unused. Rail head is y = 0 (the floor); scenery is dark.
  let d = normalize(wpos - eye);
  var c = skyColor(d, zenith, horizon, band, moonDir, moonColor, moonCfg, vec3<f32>(0.0), vec3<f32>(0.0), vec4<f32>(0.0));
  if (abs(d.x) < 1e-4) { return c * 0.5; }
  let side = sign(d.x);
  // Far to near, each layer painting over the last.
  let tHill = (side * cfg2.y - eye.x) / d.x;
  let hz = eye.z + d.z * tHill; let hy = eye.y + d.y * tHill;
  let hillH = cfg2.z * (0.55 + 0.25 * sin(hz * 0.004) + 0.12 * sin(hz * 0.004 * 2.7 + 1.3) + 0.08 * sin(hz * 0.004 * 6.1 + 4.1));
  if (hy < hillH) { c = vec3<f32>(0.018, 0.022, 0.03); }
  let tTree = (side * cfg1.w - eye.x) / d.x;
  let tz = eye.z + d.z * tTree + cfg0.x * t * 0.05; let ty = eye.y + d.y * tTree;
  let treeH = cfg2.x * (0.55 + 0.25 * sin(tz * 0.35) + 0.12 * sin(tz * 0.35 * 2.7 + 1.3) + 0.08 * sin(tz * 0.35 * 6.1 + 4.1));
  if (ty < treeH) { c = vec3<f32>(0.006, 0.008, 0.01); }
  if (d.y < 0.0) {
    // Ground plane below the rail head, darkening toward the train.
    c = mix(vec3<f32>(0.012, 0.014, 0.016), c, smoothstep(-0.02, 0.0, d.y));
  }
  let tPole = (side * cfg0.y - eye.x) / d.x;
  let pz = eye.z + d.z * tPole + cfg0.x * t; let py = eye.y + d.y * tPole;
  let pu = ((pz % cfg0.z) + cfg0.z) % cfg0.z;
  if (pu < 0.25 && py < cfg0.w && py > -1.0) { c = vec3<f32>(0.004, 0.004, 0.005); }
  let tPost = (side * cfg1.x - eye.x) / d.x;
  let fz = eye.z + d.z * tPost + cfg0.x * t; let fy = eye.y + d.y * tPost;
  let fu = ((fz % cfg1.y) + cfg1.y) % cfg1.y;
  if (fu < 0.12 && fy < cfg1.z && fy > -1.0) { c = vec3<f32>(0.004, 0.004, 0.005); }
  return c;
}
```

`train-window.wgsl.test.ts` pins the literals shared with the twin (the silhouette coefficients `0.55`, `0.25`, `0.12`, `0.08`, `2.7`, `6.1`), and that the string declares one fn.

- [ ] **Step 3: Run; PASS. Commit** `feat(train): window scenery twin + WGSL`.

---

### Task 3: Exporter: kit parts, sway extras

**Files:** Modify `scripts/levels/export_level.py`; the fixture test stays green.

- [ ] **Step 1:** In `export_art`, when realising a collection instance, record for each new mesh object `o["kit"] = <piece>` and, from the matching original in `inst.instance_collection.all_objects` (by mesh data), copy `sway` if present. Group parents by `(room, kit, o.data.name)`; name the parent `kit:<room>:<kit>` when that kit collection has one mesh object, else `kit:<room>:<kit>.<mesh name>`; set `p["room"]` and, when any child has it, `p["sway"]`.
- [ ] **Step 2:** Re-export the fixture; `npx vitest run src/lab/sdf-zombie/webgpu/level-json.art-shell` stays green (one-mesh seat keeps `kit:1:seat`). **Commit** `feat(art): kit parts group per mesh; sway extras`.

---

### Task 4: The kit — `build_train_kit.py` → `kit.blend`

**Files:** Create `scripts/levels/build_train_kit.py`, `assets-source/levels/kit.blend` (generated), `assets-source/levels/kit-textures/*.png` (generated, committed: they are ours).

- [ ] **Step 1: Materials.** For each of `train.wood-dark`, `train.panel`, `train.brass`, `train.runner`, `train.velvet`, `train.iron`: a procedural node tree (wood: Wave Texture bands along the board + Noise for grain, dark brown ramp; panel: Noise stains over cream; brass: Noise over warm yellow, metallic 1, roughness 0.35; runner: Checker + Wave into a dark blue/gold ramp; velvet: Noise over deep red; iron: Noise over near-black). Bake each to a `size × size` image (1024 wood/panel/runner, 512 the rest) by routing the colour into Emission on a UV-mapped 1 × 1 m plane and `bpy.ops.object.bake(type='EMIT')` (Cycles, 1 sample); save PNGs to `assets-source/levels/kit-textures/`; build the final material `train.*` as Principled with an Image Texture of the baked PNG (plus the metallic/roughness values). Emissive flat materials: `train.lamp` (warm 1.0, 0.8, 0.55, strength 1), `train.firebox` (1.0, 0.45, 0.12, strength 1). Glass: `window:night` (flat black; the game replaces it).
- [ ] **Step 2: UVs.** Every module is built with bmesh; each face gets planar UVs from its dominant normal axis, 1 texture repeat per metre (a helper `planar_uv(bm, scale=1.0)`).
- [ ] **Step 3: Modules** (each its own collection; dimensions in game metres, Blender space applied by the helper `g(x, y, z) -> (x, -z, y)`; the bay spans z ∈ [−1.9, 0]; the carriage is x ∈ [−1.5, 1.5]):
  - `bay-wall-window` (the **west** wall, x = −1.5; the east side is this rotated 180° about the bay centre): dado board 0.95 m high × 1.9 m, 0.04 m proud (`train.wood-dark`); cap rail 0.06 × 0.06 m at 0.95 m (`train.wood-dark`); panel above from 0.95 m to 2.2 m with a window opening 1.1 m wide × 0.8 m high centred at 1.45 m (`train.panel`); brass frame 0.05 m around the opening (`train.brass`); glass pane 1.1 × 0.8 m set 0.03 m behind the panel face (`window:night`); brass handrail Ø0.03 m at 1.0 m along the bay.
  - `bay-wall-plain`: same without the opening, frame, glass.
  - `bay-wall-door`: same as plain, with a door 0.8 × 2.0 m panel (`train.wood-dark`) and brass handle, centred.
  - `bay-pillar`: 0.12 m wide × 0.08 m proud × 2.2 m, at z = 0 (`train.wood-dark`).
  - `bay-ceiling-26` / `bay-ceiling-32`: the wall panel continues from 2.2 m (resp. 2.8 m) up to a curved cove (4 segments) to the ceiling at 2.6 m (resp. 3.2 m); a clerestory box 1.2 m wide × 0.12 m raised along the centre (`train.panel`), with a brass rail each side; two ribbed brackets per bay (`train.wood-dark`); a round lamp Ø0.3 m at the bay centre (`train.lamp`).
  - `bay-floor-planks` (planks: `train.wood-dark`, 3.0 × 1.9 m) and `bay-floor-runner` (planks + a 1.2 m runner 0.005 m above, `train.runner`).
  - `end-wall-door`: the full-width end wall 3.0 × 2.6 m (dado + panel) with a 1.4 × 2.1 m centred opening and a wood frame; `end-wall-door-32` for 3.2 m.
  - `vestibule`: 1.2 m long, 1.4 m wide: floor plate (`train.iron`), side walls (bellows as 6 folds, `train.iron`), roof at 2.2 m.
  - `lamp-hanging` (origin at the ceiling attach point; a 0.4 m rod + a 0.3 m shade, `train.brass` + `train.lamp`; custom prop `sway = "lamp"` on each object).
  - `curtain` (origin at the rail; two 0.35 × 0.7 m panels, `train.velvet`; `sway = "curtain"`).
  - `seat-bench` (0.9 m wide along the wall × 0.6 m deep, seat 0.45 m, back to 1.1 m; `train.velvet` + `train.wood-dark`).
  - `luggage-rack` (1.9 × 0.4 m shelf at 1.9 m, brass rails), `trunk` (0.9 × 0.5 × 0.5 m, `train.wood-dark` + `train.brass` bands), `coffin` (2.0 × 0.6 × 0.5 m tapered, `train.wood-dark`).
  - `dining-table` (1.0 × 0.7 m at 0.75 m, one pedestal), `dining-chair` (0.45 m seat, `train.velvet`), `buffet-counter` (3.0 × 0.6 × 1.0 m, `train.wood-dark` + `train.brass` top edge).
  - `jukebox` (0.8 × 0.5 × 1.5 m, rounded top, `train.wood-dark` + `train.brass` + a `train.lamp` window), `favour-table` (1.6 × 0.7 m at 0.75 m, `train.panel` cloth).
  - `cab-shell` (8 m long, 3.0 m wide, 2.6 m high): floor `train.iron`; walls `train.iron` with a window each side; the boiler backhead (a Ø2.2 m half-cylinder face at the north end, `train.iron`); the firebox door 0.6 × 0.5 m at 0.8 m (`train.firebox` glow + `train.iron` frame); four gauges (discs Ø0.18, `train.brass`); the coal door opening at the south end.
- [ ] **Step 4: Run and inspect.** `blender --background --factory-startup --python scripts/levels/build_train_kit.py`; then render each collection at eye height with Workbench to `$SCRATCH/kit-*.png` and look at them (a helper in the same script behind `--renders <dir>`). Fix anything malformed before moving on. **Commit** `feat(train): kit.blend — bay modules, props, cab; baked materials`.

---

### Task 5: The carriages — `build_night_train.py` → `night-train`

**Files:** Create `scripts/levels/build_night_train.py`; generated `assets-source/levels/night-train.blend`, `public/assets/levels/night-train.level.json` + `night-train.art.glb`; Test `level-json.night-train.test.ts`.

- [ ] **Step 1: Failing level test**

```ts
// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, missingCapabilities } from './active-level';
import { roomAtPoint } from './level-def';
import { parseLevelJson } from './level-json';

const t = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/night-train.level.json', 'utf8')));

describe('night-train.level.json', () => {
  it('four art-shelled carriages in order, back to front', () => {
    expect(t.rooms.map(r => r.name)).toEqual(['guards-van', 'dining-car', 'party-carriage', 'cab']);
    expect(t.rooms.every(r => r.shell === 'art')).toBe(true);
    for (let i = 1; i < t.rooms.length; i++) expect(t.rooms[i]!.maxZ).toBeLessThan(t.rooms[i - 1]!.minZ);
    expect(t.rooms.find(r => r.name === 'party-carriage')!.height).toBeCloseTo(3.2);
    expect(t.art).toBe('night-train.art.glb');
    expect(missingCapabilities(t, ENGINE_CAPABILITIES)).toEqual([]);
  });
  it('vestibules join each pair and are at least 1.4 m wide', () => {
    expect(t.tunnels).toHaveLength(3);
    for (const v of t.tunnels) expect(v.maxX - v.minX).toBeGreaterThanOrEqual(1.4 - 1e-6);
  });
  it('starts at the back of the guard\'s van, facing the cab', () => {
    expect(roomAtPoint(t, t.playerStart.x, t.playerStart.z)?.name).toBe('guards-van');
    expect(Math.abs(t.playerStart.yaw)).toBeLessThan(1e-3);
  });
  it('furniture keeps an aisle of at least 1.4 m in every carriage but the cab', () => {
    for (const r of t.rooms.filter(r => r.name !== 'cab')) {
      const f = t.furniture.filter(b => b.room === r.id);
      expect(f.length).toBeGreaterThan(0);
      const west = Math.max(r.minX, ...f.filter(b => b.maxX < 0.2).map(b => b.maxX));
      const east = Math.min(r.maxX, ...f.filter(b => b.minX > -0.2).map(b => b.minX));
      expect(east - west).toBeGreaterThanOrEqual(1.4 - 1e-6);
    }
  });
});
```

- [ ] **Step 2: Build script.** A table drives everything:

```python
CARRIAGES = [  # (id, name, length m, ceiling, bays: list of (west wall, east wall, floor, props))
    (1, "guards-van", 16.0, 2.6, "van"),
    (3, "dining-car", 18.0, 2.6, "dining"),
    (5, "party-carriage", 20.0, 3.2, "party"),
    (8, "cab", 8.0, 2.6, "cab"),
]
VESTIBULE = 1.2
```

Carriages are placed from z = 0 toward −z with a 1.2 m vestibule between (a room's `minZ` = next room's `maxZ` + 1.2). The room is x ∈ [−1.5, 1.5], height = ceiling, `shell = "art"`. A tunnel `(a, b)` 1.4 m wide (x ∈ [−0.7, 0.7]) spans each gap, height 2.1. Per carriage type, `bays = floor(length / 1.9)`, remainder split between both ends as plain wall. Bay recipes:
  - `van`: walls plain except bays 2 and 5 (window); floor planks; each bay alternates a luggage rack (both walls) and trunks against the west wall; two coffins on the east side of bays 3 and 6; furniture boxes for trunks/coffins (0.2 m clearance).
  - `dining`: window walls; runner floor; tables with two chairs against both walls every bay (table 0.7 m deep from the wall); a buffet counter across the north end's west half; curtains on every window.
  - `party`: window walls, `bay-ceiling-32`; runner floor; favour tables against the west wall in bays 1–3, the jukebox at the north-east corner, hanging lamps at every other bay; curtains.
  - `cab`: the `cab-shell` piece only; furniture boxes for the backhead (north 1.2 m, full width).
  Every piece is a collection-instance empty in `dressing` (linked from `kit.blend`, relative path), and every seat/table/counter/rack-at-floor/trunk/coffin/jukebox writes its `furniture` box (game AABB, `room` = carriage). End walls: `end-wall-door` at both ends of each carriage (the cab only at its south end). Lights: one warm point light per 8 m of carriage at 2.2 m (colour 1.0, 0.72, 0.45, power 3), the cab gets one firebox light (1.0, 0.42, 0.12, power 4) by the firebox. Start: centre of the van's south end, 1 m in, yaw 0.
- [ ] **Step 3: Build + export; run the test; PASS.** Also render three eye-height views in Blender (Workbench, texture colours) into the scratchpad and look at them.
- [ ] **Step 4: Commit** `feat(train): night-train carriages 1, 3, 5, 8 from the kit`.

---

### Task 6: Game wiring

**Files:** Create `src/lab/sdf-zombie/webgpu/game-train-leaves.ts`; Modify `game-art-leaves.ts` (window material swap, sway list), `game-state-world.ts` (+ test) or reuse `ctx.world.art` for the train runtime, `game-main.ts` (step + camera), a seam.

- [ ] **Step 1:** In `placeLevelArt`, for each mesh whose material name starts with `window:`, record it; for each mesh (or ancestor) with `userData.sway`, record `{ mesh, kind, base matrices }` (for an InstancedMesh, decompose each instance matrix once).
- [ ] **Step 2: `game-train-leaves.ts`:** `createTrain(ctx)` returns null when the art has neither windows nor sway; else it replaces each window mesh's material with a `MeshBasicNodeMaterial` whose `colorNode` is `trainWindow(...)` (includes `SKY_COLOR`, uniforms from `SKY_PRESETS.night` and the window preset), marks the mesh `userData.skipLevelLights = true`, and keeps a time uniform. `stepTrain(ctx, dt)` advances time (sim), writes each lamp/curtain instance matrix `T · Rz(angle) · R · S` (lamps `lampSwing(t, speed, i * 0.7)`, curtains `curtainSway(...) * 3°`), and sets `needsUpdate`. `applyTrainCamera(ctx, camera)` adds `bob` to the camera's y and `rotateZ(roll)` after `lookAt`, before `updateMatrixWorld`. Seams: `train()` → `{ speed, time, windows, swaying }`, `setTrainSpeed(v)`.
- [ ] **Step 3: `game-main.ts`:** `ctx.world.train = createTrain(ctx)` after `createVoid`; `stepTrain(ctx, dt)` beside `stepVoid`; `applyTrainCamera(ctx, camera)` right before `camera.updateMatrixWorld()` in the camera block; the light-list loop skips meshes with `userData.skipLevelLights`.
- [ ] **Step 4:** tsc; state test; **Commit** `feat(train): window scenery, sway and camera motion in the game`.

---

### Task 7: The Void leads to the train; gate; budget

**Files:** Modify `scripts/levels/build_the_void.py` (target `night-train`), regenerate `the-void.*`, `level-json.the-void.test.ts`, `scripts/sdf-game-void-gate.mjs` (expects `night-train`), `game-menu.ts` (+ test: add `night-train` to the dev picker); Create `scripts/sdf-game-train-gate.sh` / `.mjs` (ports 5295/9295).

- [ ] **Step 1:** Portal target → `night-train`; rebuild + export the Void; update its tests and gate.
- [ ] **Step 2: Gate:** boot `level=night-train&frozen`; `artInfo().meshes > 0`; `train().windows > 0`; pose in the dining car facing a west window (yaw −π/2); two screenshots 0.5 s apart with the sim running (unfreeze): the window box's pixels differ (mean abs diff > 0.004) and are not flat (std > 0.01); roll over 2 s: sample `__sdfGame.pose()`? — use a `train()` seam field `roll`, min/max differ by > 0.002 rad; autopilot `walkTo(0, cabZ)` from the start for up to 20 s: the player reaches the cab room; cost: draw calls + `timeDraws(9)` at poses van, dining, party (record; budget proposed to the owner).
- [ ] **Step 3:** Regressions: ring (shorty), Void, Wake, art gates; full suite. Screenshots for the owner (van, dining, party, cab).
- [ ] **Step 4: TASKS.md**; **Commit** `test(train): gate (windows, sway, walk to the cab, cost); the Void leads to night-train`.
