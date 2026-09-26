# The Void and the portal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New game starts in `the-void`: black, drifting embers, one red Diablo-style portal with rail tracks seen through it; walking in loads the next level.

**Architecture:** Two additive Level Format v1 keys (`void` rooms, `portals`) flow through the parser, the exporter and `ActiveLevel`. The look is hand-written WGSL (`portal.wgsl.ts`) with a pure TypeScript twin (`void-portal.ts`) for tests; `game-void-leaves.ts` wires three objects the way `game-outdoor-leaves.ts` does. Entering reuses the Esc menu's `levelUrl` reload.

**Tech Stack:** TypeScript, three r186 WebGPU + TSL `wgslFn`, vitest, Blender 4 (headless build + export), CDP headless gate.

**Spec:** [2026-09-24-void-portal-design.md](../specs/2026-09-24-void-portal-design.md)

**Conventions used below:**
- Yaw: `yaw = 0` faces −z; a facing `yaw` points along `(sin yaw, 0, −cos yaw)`. A portal's `yaw` is the side that shows the tracks (toward the viewer); the tracks run the other way.
- Tests: `npx vitest run <path>`. Typecheck: `npx tsc --noEmit -p .`.
- Headless: `LAB_TMP=.lab-tmp`.

---

### Task 1: Level format: `void` rooms and `portals`

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/level-def.ts` (Capability, PortalDef, LevelRoom.void, LevelDef.portals, layoutSurfaces, enclosureOfIn)
- Modify: `src/lab/sdf-zombie/webgpu/level-json.ts` (KEYS, room `void`, `portals`, requires)
- Modify: `src/lab/sdf-zombie/webgpu/active-level.ts` (ENGINE_CAPABILITIES, `portals` on ActiveLevel)
- Create: `public/assets/levels/fixtures/void-portal.level.json`
- Test: `src/lab/sdf-zombie/webgpu/level-json.void.test.ts`, update `active-level.test.ts`

- [ ] **Step 1: Write the fixture**

```json
{
  "version": 1,
  "id": "void-portal",
  "rooms": [{ "id": 1, "name": "void", "min": [-20, -40], "max": [20, 0], "height": 8, "void": true }],
  "start": { "pos": [0, 0, -6], "yaw": 0 },
  "portals": [{ "id": "first", "pos": [0, 0, -18], "yaw": 3.1416, "width": 2.2, "height": 3.4, "target": "the-wake" }]
}
```

- [ ] **Step 2: Write the failing tests** (`level-json.void.test.ts`)

```ts
// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { layoutColliders, layoutSurfaces, enclosureOfIn } from './level-def';
import { parseLevelJson } from './level-json';

const raw = () => JSON.parse(readFileSync('public/assets/levels/fixtures/void-portal.level.json', 'utf8'));

describe('void rooms and portals', () => {
  it('parses a void room and a portal', () => {
    const d = parseLevelJson(raw());
    expect(d.rooms[0]!.void).toBe(true);
    expect(d.portals).toEqual([{ id: 'first', pos: [0, 0, -18], yaw: 3.1416, width: 2.2, height: 3.4, target: 'the-wake' }]);
    expect(d.requires).toEqual(['void', 'portals']);
  });
  it('draws nothing for a void room but keeps its collision', () => {
    const d = parseLevelJson(raw());
    expect(layoutSurfaces(d).planes).toEqual([]);
    expect(layoutColliders(d).length).toBe(4);
  });
  it('a void room encloses in black', () => {
    const e = enclosureOfIn(parseLevelJson(raw()), 'void')!;
    expect(Object.values(e.walls).every(c => c.every(v => v === 0))).toBe(true);
  });
  it('rejects void with a sky', () => {
    const j = raw(); j.rooms[0].sky = 'night';
    expect(() => parseLevelJson(j)).toThrow(/void rooms have no sky, edge or paths/);
  });
  it('rejects a bad portal target and a portal outside every room', () => {
    const j = raw(); j.portals[0].target = 'The Wake';
    expect(() => parseLevelJson(j)).toThrow(/target must match/);
    const k = raw(); k.portals[0].pos = [0, 0, 50];
    expect(() => parseLevelJson(k)).toThrow(/portal first: outside every room/);
  });
  it('rejects a non-positive portal size', () => {
    const j = raw(); j.portals[0].width = 0;
    expect(() => parseLevelJson(j)).toThrow(/width and height must be > 0/);
  });
});
```

- [ ] **Step 3: Run it; expect FAIL** (`void` unknown key / `portals` unknown key).

- [ ] **Step 4: Implement**

`level-def.ts`:

```ts
export type Capability = 'multi-floor' | 'windows' | 'open-sky' | 'void' | 'portals';
/** Void v1 §3: a portal; `yaw` faces the viewer side, `target` is a level id. */
export interface PortalDef { id: string; pos: Vec3; yaw: number; width: number; height: number; target: string }
// LevelRoom gains:
  /** Void v1 §3: nothing drawn (walls, floor, ceiling); collision unchanged. */
  void: boolean;
// LevelDef gains:
  portals: PortalDef[];
```

In `layoutSurfaces`, first line of the room loop: `if (r.void) continue;`. In `enclosureOfIn`, when `room.void`, return the box with all six walls `[0, 0, 0]`.

`level-json.ts`: add `'portals'` to `KEYS.top`, `'void'` to `KEYS.room`, `portal: ['id', 'pos', 'yaw', 'width', 'height', 'target', 'states']`. In the room parse:

```ts
    const isVoid = o.void === undefined ? false : o.void === true ? true : (errors.push(`${where}.void: expected true or false`), false);
    if (isVoid && (o.sky !== undefined || o.edge !== undefined || o.paths !== undefined)) errors.push(`${where}: void rooms have no sky, edge or paths`);
```

and push `void: isVoid` on the room. After bells:

```ts
  const portals: PortalDef[] = [];
  list(j.portals, 'portals').forEach((o, i) => {
    const pid = str(o.id, `portals[${i}].id`, `portal${i}`);
    keys(o, 'portal', `portal ${pid}`);
    const keep = present(o, `portal ${pid}`);
    claim(pid);
    const pos = vec(o.pos, 3, `portal ${pid}.pos`) as unknown as Vec3;
    const width = num(o.width, `portal ${pid}.width`, 2.2), height = num(o.height, `portal ${pid}.height`, 3.4);
    if (!(width > 0 && height > 0)) errors.push(`portal ${pid}: width and height must be > 0`);
    const target = str(o.target, `portal ${pid}.target`);
    if (!/^[a-z0-9-]+$/.test(target)) errors.push(`portal ${pid}: target must match [a-z0-9-]+`);
    if (!inRoom(pos[0], pos[2])) errors.push(`portal ${pid}: outside every room`);
    if (keep) portals.push({ id: pid, pos, yaw: isNum(o.yaw) ? o.yaw : 0, width, height, target });
  });
```

Capabilities (after open-sky): `if (rooms.some(r => r.void)) requires.push('void'); if (portals.length > 0) requires.push('portals');`. Return `portals`.

`active-level.ts`: `ENGINE_CAPABILITIES` adds `'void', 'portals'`; `ActiveLevel` gains `portals: readonly PortalDef[]` (`[]` for the ring, `def.portals` authored). Update the `active-level.test.ts` expectation to `['open-sky', 'portals', 'void', 'windows']`.

Every other `LevelRoom` literal in the repo (tests, fixtures builders) gains `void: false`; `tsc` finds them.

- [ ] **Step 5: Run** `npx vitest run src/lab/sdf-zombie/webgpu/level-json src/lab/sdf-zombie/webgpu/level-def src/lab/sdf-zombie/webgpu/active-level` and `npx tsc --noEmit -p .`; expect PASS.

- [ ] **Step 6: Commit** `feat(level): void rooms and portals (format v1 additive keys)`.

---

### Task 2: Exporter and conventions

**Files:**
- Modify: `scripts/levels/export_level.py`
- Modify: `docs/game/levels/blender-conventions.md`

- [ ] **Step 1: Exporter.** Rooms: `if o.get("void"): room["void"] = True`. Markers: add `"portals"` to the initial list keys, and a branch:

```python
        elif kind == "portal":
            _, target, pid = fields(o, "portal", 3)
            doc["portals"].append(with_states(o, {"id": pid, "pos": pos, "yaw": yaw_of(o), "target": target,
                                                  "width": rnd(o.get("width", 2.2)), "height": rnd(o.get("height", 3.4))}))
```

- [ ] **Step 2: Conventions.** Add rows: room custom property `void` (bool: nothing drawn, collision kept; excludes sky/edge/paths); marker `portal:<target>:<id>` (an empty; its facing is the viewer side; custom props `width`, `height`, default 2.2 × 3.4 m).

- [ ] **Step 3: Verify** with Task 4's build (the exporter has no unit tests; the level test pins its output).

- [ ] **Step 4: Commit** `feat(level): exporter + conventions for void rooms and portals`.

---

### Task 3: Portal maths and WGSL (pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/void-portal.ts` (twin + decisions)
- Create: `src/lab/sdf-zombie/webgpu/portal.wgsl.ts` (`PORTAL_COLOR`, `EMBER_POS`, `GLOW_POOL`)
- Test: `src/lab/sdf-zombie/webgpu/void-portal.test.ts`, `src/lab/sdf-zombie/webgpu/portal.wgsl.test.ts`

- [ ] **Step 1: Failing tests** (`void-portal.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { emberWrap, glowAt, insidePortal, ovalDistance, portalFrame, trackHit, trackIntensity, RAIL_HALF_GAUGE } from './void-portal';

const P = { pos: [0, 0, -18] as [number, number, number], yaw: Math.PI, width: 2.2, height: 3.4 };

describe('void portal maths', () => {
  it('frame: facing the viewer at +z, tracks run to -z', () => {
    const f = portalFrame(P);
    expect(f.facing[2]).toBeCloseTo(1); expect(f.back[2]).toBeCloseTo(-1);
  });
  it('insidePortal: the box is width x 0.6 m x height around the base', () => {
    expect(insidePortal(P, [0, 0, -18])).toBe(true);
    expect(insidePortal(P, [0, 0, -18.25])).toBe(true);
    expect(insidePortal(P, [0, 0, -17.5])).toBe(false);
    expect(insidePortal(P, [1.2, 0, -18])).toBe(false);
  });
  it('oval distance: <0 inside, 0 on the rim, >0 outside', () => {
    expect(ovalDistance(0, 0)).toBeLessThan(0);
    expect(ovalDistance(1, 0)).toBeCloseTo(0);
    expect(ovalDistance(0, 1.2)).toBeGreaterThan(0);
  });
  it('a ray through the lower oval hits the ground behind the portal', () => {
    const h = trackHit(P, [0, 1.6, -6], [0, 0.6, -18])!;
    expect(h.depth).toBeGreaterThan(0); expect(Math.abs(h.lateral)).toBeLessThan(1e-6);
    expect(trackHit(P, [0, 1.6, -6], [0, 2.5, -18])).toBeNull(); // looking up: no ground
  });
  it('rails show on-axis, sleepers between them, black by far distance', () => {
    expect(trackIntensity(1, RAIL_HALF_GAUGE)).toBeGreaterThan(0.5);
    expect(trackIntensity(1, 0.3 + 0)).toBeGreaterThanOrEqual(0); // sleeper or gap, never negative
    expect(trackIntensity(1, 3)).toBe(0);
    expect(trackIntensity(80, RAIL_HALF_GAUGE)).toBeLessThan(0.01);
  });
  it('parallax: stepping sideways moves where the ray lands', () => {
    const a = trackHit(P, [0, 1.6, -6], [0, 0.6, -18])!;
    const b = trackHit(P, [2, 1.6, -6], [0, 0.6, -18])!;
    expect(b.lateral).not.toBeCloseTo(a.lateral);
  });
  it('embers wrap into the box around the camera', () => {
    const w = emberWrap([30, 1, -5], [0, 1.6, 0], 24);
    expect(Math.abs(w[0])).toBeLessThanOrEqual(12);
    expect(w[2]).toBe(-5);
  });
  it('glow pool falls off to zero at its radius', () => {
    expect(glowAt(0, 4)).toBeCloseTo(1); expect(glowAt(4, 4)).toBe(0);
  });
});
```

- [ ] **Step 2: Run; expect FAIL** (module missing).

- [ ] **Step 3: Implement `void-portal.ts`**

```ts
// src/lab/sdf-zombie/webgpu/void-portal.ts
//
// The Void's portal, as pure maths (spec 2026-09-24-void-portal-design.md §5, §6):
// the portal's frame, the entry test, the oval, where a view ray through the portal
// lands on the ground behind it and what the tracks look like there, the ember wrap
// and the glow pool. TypeScript twin of portal.wgsl.ts: the WGSL draws, this tests.
// Change one, change both — portal.wgsl.test.ts pins the shared literals. Noise
// (rim flicker, haze swirl) is WGSL-only. Pure: no three.js, no DOM.

import type { Vec3 } from '../types';

export interface PortalLike { pos: Vec3; yaw: number; width: number; height: number }

export const PORTAL_DEPTH_M = 0.6;
export const RAIL_HALF_GAUGE = 0.72;
export const RAIL_HALF_WIDTH = 0.04;
export const SLEEPER_PITCH_M = 0.6;
export const SLEEPER_FILL = 0.25;
export const SLEEPER_HALF_LEN = 1.2;
export const TRACK_FADE_M = 14;
export const TRACK_BLACK_M = 60;

export function portalFrame(p: PortalLike): { facing: Vec3; back: Vec3; right: Vec3 } {
  const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
  return { facing: [s, 0, -c], back: [-s, 0, c], right: [c, 0, s] };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Inside the portal's trigger box: width across, PORTAL_DEPTH_M through, height up. */
export function insidePortal(p: PortalLike, pos: Vec3): boolean {
  const f = portalFrame(p), d = sub(pos, p.pos);
  return Math.abs(dot(d, f.right)) <= p.width / 2 && Math.abs(dot(d, f.facing)) <= PORTAL_DEPTH_M / 2
    && d[1] >= -0.5 && d[1] <= p.height;
}

/** Oval signed distance in the portal's normalised plane coords (u, v in [-1, 1]). */
export function ovalDistance(u: number, v: number): number {
  return Math.hypot(u, v) - 1;
}

/** The view ray from `eye` through `onPortal`, carried behind the portal to the ground
 *  plane at the portal's base: depth behind the plane and lateral offset, or null. */
export function trackHit(p: PortalLike, eye: Vec3, onPortal: Vec3): { depth: number; lateral: number } | null {
  const d = sub(onPortal, eye);
  if (d[1] >= -1e-6) return null;
  const t = (onPortal[1] - p.pos[1]) / -d[1];
  const hit: Vec3 = [onPortal[0] + d[0] * t, p.pos[1], onPortal[2] + d[2] * t];
  const f = portalFrame(p), rel = sub(hit, p.pos);
  const depth = dot(rel, f.back);
  return depth > 0 ? { depth, lateral: dot(rel, f.right) } : null;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** 0..1 brightness of the tracks at a ground hit (before the red tint). */
export function trackIntensity(depth: number, lateral: number): number {
  const railD = Math.abs(Math.abs(lateral) - RAIL_HALF_GAUGE);
  const rail = 1 - smooth(RAIL_HALF_WIDTH * 0.5, RAIL_HALF_WIDTH, railD);
  const phase = depth / SLEEPER_PITCH_M - Math.floor(depth / SLEEPER_PITCH_M);
  const sleeper = (phase < SLEEPER_FILL ? 1 : 0) * (Math.abs(lateral) < SLEEPER_HALF_LEN ? 0.45 : 0);
  const fade = Math.exp(-depth / TRACK_FADE_M) * (1 - smooth(TRACK_BLACK_M * 0.5, TRACK_BLACK_M, depth));
  return Math.max(rail, sleeper) * fade;
}

/** Wrap an ember position into a `box`-metre cube (x, z) centred on the camera; y untouched. */
export function emberWrap(pos: Vec3, cam: Vec3, box: number): Vec3 {
  const w = (v: number, c: number) => c + (((v - c + box / 2) % box) + box) % box - box / 2;
  return [w(pos[0], cam[0]), pos[1], w(pos[2], cam[2])];
}

/** Glow pool brightness at `r` metres from its centre. */
export function glowAt(r: number, radius: number): number {
  const t = Math.min(1, r / radius);
  return (1 - t) * (1 - t);
}
```

- [ ] **Step 4: Implement `portal.wgsl.ts`** (one function per string; literals match the twin)

```ts
// src/lab/sdf-zombie/webgpu/portal.wgsl.ts
//
// The Void's portal, embers and glow pool, hand-written WGSL (spec
// 2026-09-24-void-portal-design.md §5). Twin: void-portal.ts.

const NOISE = /* wgsl */ `
  fn h21(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
  fn vnoise(p: vec2<f32>) -> f32 {
    let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2<f32>(1.0, 0.0)), u.x), mix(h21(i + vec2<f32>(0.0, 1.0)), h21(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
  }`;

/** rgb additive colour of a portal-quad fragment. cfg: x width, y height, z time. */
export const PORTAL_COLOR = /* wgsl */ `fn portalColor(wpos: vec3<f32>, eye: vec3<f32>, base: vec3<f32>, facing: vec3<f32>, right: vec3<f32>, cfg: vec3<f32>) -> vec3<f32> {
  ${NOISE}
  let rel = wpos - base;
  let u = dot(rel, right) / (cfg.x * 0.5);
  let v = (rel.y - cfg.y * 0.5) / (cfg.y * 0.5);
  let ang = atan2(v, u);
  let t = cfg.z;
  let n1 = vnoise(vec2<f32>(ang * 3.0 + t * 1.3, t * 2.1));
  let n2 = vnoise(vec2<f32>(ang * 9.0 - t * 3.7, length(vec2<f32>(u, v)) * 6.0 - t * 4.0));
  let d = length(vec2<f32>(u, v)) - 1.0 - (n1 - 0.5) * 0.10 - (n2 - 0.5) * 0.06;
  // Rim: white-hot just inside the edge, red outward, broken into wisps.
  let core = exp(-abs(d) * 26.0);
  let glow = exp(-max(d, 0.0) * 7.0) * step(-0.02, d) * (0.6 + 0.8 * n2);
  var c = vec3<f32>(1.0, 0.95, 0.9) * core * 1.6 + vec3<f32>(0.9, 0.06, 0.04) * glow * 1.4;
  if (d < 0.0) {
    // Haze: slow dark-red swirl.
    let r = length(vec2<f32>(u, v));
    let sw = vnoise(vec2<f32>(ang * 2.0 + r * 3.0 - t * 0.6, r * 4.0 + t * 0.4));
    var inside = vec3<f32>(0.22, 0.015, 0.02) * (0.5 + sw);
    // Tracks: the view ray carried to the ground plane behind the portal.
    let dir = wpos - eye;
    if (dir.y < -1e-6) {
      let s = (wpos.y - base.y) / -dir.y;
      let hit = wpos + dir * s;
      let hrel = hit - base;
      let depth = dot(hrel, -facing);
      let lateral = dot(hrel, right);
      if (depth > 0.0) {
        let railD = abs(abs(lateral) - 0.72);
        let rail = 1.0 - smoothstep(0.02, 0.04, railD);
        let phase = fract(depth / 0.6);
        let sleeper = select(0.0, 0.45, phase < 0.25 && abs(lateral) < 1.2);
        let fade = exp(-depth / 14.0) * (1.0 - smoothstep(30.0, 60.0, depth));
        inside = inside + vec3<f32>(0.85, 0.22, 0.18) * max(rail, sleeper) * fade;
      }
    }
    c = c + inside * smoothstep(0.0, -0.08, d);
  }
  return c;
}`;

/** World position of ember `i` at time t, wrapped into a `box` cube around the camera. */
export const EMBER_POS = /* wgsl */ `fn emberPos(i: f32, t: f32, cam: vec3<f32>, box: f32) -> vec3<f32> {
  let h = fract(sin(vec3<f32>(i * 12.9898, i * 78.233, i * 37.719)) * 43758.5453);
  let drift = vec3<f32>(sin(t * 0.13 + i) * 0.4, t * (0.05 + h.y * 0.08), cos(t * 0.11 + i * 1.7) * 0.4);
  let p = vec3<f32>(h.x * box, h.y * 6.0, h.z * box) + drift;
  let w = cam.xz + ((((p.xz - cam.xz + box * 0.5) % box) + box) % box) - box * 0.5;
  return vec3<f32>(w.x, fract(p.y / 6.0) * 6.0, w.y);
}`;

/** Glow pool: additive red at uv (0..1 square), radial falloff. */
export const GLOW_POOL = /* wgsl */ `fn glowPool(uv: vec2<f32>) -> vec3<f32> {
  let r = min(1.0, length(uv - vec2<f32>(0.5, 0.5)) * 2.0);
  return vec3<f32>(0.55, 0.03, 0.02) * (1.0 - r) * (1.0 - r);
}`;
```

- [ ] **Step 5: `portal.wgsl.test.ts`** pins the literals shared with the twin:

```ts
import { describe, expect, it } from 'vitest';
import { EMBER_POS, GLOW_POOL, PORTAL_COLOR } from './portal.wgsl';
import { RAIL_HALF_GAUGE, SLEEPER_PITCH_M, TRACK_FADE_M, TRACK_BLACK_M } from './void-portal';

describe('portal.wgsl', () => {
  it('shares its track constants with the twin', () => {
    expect(PORTAL_COLOR).toContain(`abs(abs(lateral) - ${RAIL_HALF_GAUGE})`);
    expect(PORTAL_COLOR).toContain(`fract(depth / ${SLEEPER_PITCH_M})`);
    expect(PORTAL_COLOR).toContain(`exp(-depth / ${TRACK_FADE_M}.0)`);
    expect(PORTAL_COLOR).toContain(`smoothstep(30.0, ${TRACK_BLACK_M}.0, depth)`);
  });
  it('each string declares exactly one fn', () => {
    for (const s of [PORTAL_COLOR, EMBER_POS, GLOW_POOL]) expect(s.trim().startsWith('fn ')).toBe(true);
  });
});
```

(`PORTAL_COLOR` nests the noise helpers inside the function body because `wgslFn` takes one function per string. WGSL has no nested `fn`; if the compiler rejects it, move `h21`/`vnoise` into a separate `wgslFn` passed as an `includes` array: `wgslFn(PORTAL_COLOR, [noiseFn])`. Task 5's boot check finds out.)

- [ ] **Step 6: Run** both tests; expect PASS. **Commit** `feat(void): portal, ember and glow maths + WGSL`.

---

### Task 4: The level `the-void`

**Files:**
- Create: `scripts/levels/build_the_void.py`
- Create: `assets-source/levels/the-void.blend`, `public/assets/levels/the-void.level.json` (generated)
- Test: `src/lab/sdf-zombie/webgpu/level-json.the-void.test.ts`

- [ ] **Step 1: Failing test**

```ts
// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, missingCapabilities } from './active-level';
import { parseLevelJson } from './level-json';
import { portalFrame } from './void-portal';

const v = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/the-void.level.json', 'utf8')));

describe('the-void.level.json', () => {
  it('one void room, one portal to the first level, nothing to fight', () => {
    expect(v.rooms).toHaveLength(1);
    expect(v.rooms[0]!.void).toBe(true);
    expect(v.portals).toHaveLength(1);
    expect(v.portals[0]!.target).toBe('the-wake');
    expect(v.spawns).toEqual([]);
    expect(missingCapabilities(v, ENGINE_CAPABILITIES)).toEqual([]);
  });
  it('the player starts about 12 m out, facing the portal, on its viewer side', () => {
    const p = v.portals[0]!, s = v.playerStart;
    const dist = Math.hypot(s.x - p.pos[0], s.z - p.pos[2]);
    expect(dist).toBeGreaterThan(11); expect(dist).toBeLessThan(13);
    const f = portalFrame(p);
    expect((s.x - p.pos[0]) * f.facing[0] + (s.z - p.pos[2]) * f.facing[2]).toBeGreaterThan(0);
    const look = [Math.sin(s.yaw), -Math.cos(s.yaw)];
    expect(look[0]! * (p.pos[0] - s.x) + look[1]! * (p.pos[2] - s.z)).toBeGreaterThan(11);
  });
  it('a red light sits at the portal', () => {
    expect(v.rooms[0]!.accents).toHaveLength(1);
    expect(v.rooms[0]!.accents[0]!.color[0]).toBeGreaterThan(v.rooms[0]!.accents[0]!.color[1]);
  });
});
```

- [ ] **Step 2: Build script** (`build_the_void.py`), same helpers as `build_the_wake_blockout.py` (`coll`, `gbox`, `gempty`, `glight` copied verbatim):

```python
SC["level_id"] = "the-void"
SC["level_name"] = "The Void"
SC["ammo"] = "infinite"
# One void room, 40 x 40 m: collision bounds only, nothing drawn.
o = gbox("rooms", "room:1:void", (-20, 0, -40), (20, 8, 0), wire=True)
o["void"] = True
gempty("start", (0, 0, -6), 0.0)                                        # facing -z, at the portal
gempty("portal:the-wake:first", (0, 0, -18), math.pi, width=2.2, height=3.4)  # faces +z, the player
glight("portal-light", (0, 1.7, -17.6), (1.0, 0.12, 0.08), 6)
```

- [ ] **Step 3: Build + export**

```bash
/opt/homebrew/bin/blender --background --factory-startup --python scripts/levels/build_the_void.py -- assets-source/levels/the-void.blend
/opt/homebrew/bin/blender --background --factory-startup assets-source/levels/the-void.blend --python scripts/levels/export_level.py -- public/assets/levels/the-void.level.json
```

- [ ] **Step 4: Run** the level test; expect PASS. **Commit** `feat(void): the-void level (build script, .blend, JSON)`.

---

### Task 5: Game wiring

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-void-leaves.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-state-lighting.ts` (+ test: 21 → 22 bindings)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (create after `createOutdoor`, step in `tick`, seams)

- [ ] **Step 1: State.** `LightingState` gains `void: VoidRuntime | null` (default `null`, binding `void: 'lighting.void'`); bump the count test to 22.

- [ ] **Step 2: `game-void-leaves.ts`**

```ts
// src/lab/sdf-zombie/webgpu/game-void-leaves.ts
//
// THE VOID in the game (spec 2026-09-24-void-portal-design.md §5-§6): the portal
// quads, the glow pools, the embers, black fog, and the portal trigger. Decisions
// are pure (void-portal.ts); the WGSL is portal.wgsl.ts. A level with no portals
// gets null and nothing is added.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial, SpriteNodeMaterial } from 'three/webgpu';
import { cameraPosition, float, instanceIndex, positionWorld, uniform, uv, varying, vec3, vec4, wgslFn } from 'three/tsl';
import type { GameContext } from './game-context';
import { levelUrl } from './game-menu';
import { EMBER_POS, GLOW_POOL, PORTAL_COLOR } from './portal.wgsl';
import { insidePortal, portalFrame } from './void-portal';

const EMBER_COUNT = 300;
const EMBER_BOX_M = 24;
const GLOW_RADIUS_M = 4;
const PORTAL_PAD = 1.4;   // quad size / oval size: room for the wisps
const FLASH_MS = 250;

export interface VoidRuntime {
  time: { value: number };
  entered: string | null;
  objects: THREE.Object3D[];
}

export function createVoid(ctx: GameContext): VoidRuntime | null {
  const portals = ctx.world.level.portals;
  if (portals.length === 0) return null;
  const scene = ctx.boot.handle.scene;
  const uTime = uniform(0);
  const objects: THREE.Object3D[] = [];
  const portalFn = wgslFn(PORTAL_COLOR);
  for (const p of portals) {
    const f = portalFrame(p);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = vec4(portalFn({
      wpos: positionWorld, eye: cameraPosition, base: vec3(...p.pos),
      facing: vec3(...f.facing), right: vec3(...f.right), cfg: vec3(float(p.width), float(p.height), uTime),
    }) as unknown as ReturnType<typeof vec3>, 1);
    mat.blending = THREE.AdditiveBlending; mat.transparent = true; mat.depthWrite = false; mat.fog = false;
    mat.side = THREE.DoubleSide;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(p.width * PORTAL_PAD, p.height * PORTAL_PAD), mat);
    quad.position.set(p.pos[0], p.pos[1] + p.height / 2, p.pos[2]);
    quad.rotation.y = -p.yaw + Math.PI; // plane normal +z -> portal facing
    quad.name = `portal:${p.id}`;
    const glowMat = new MeshBasicNodeMaterial();
    glowMat.colorNode = vec4(wgslFn(GLOW_POOL)({ uv: uv() }) as unknown as ReturnType<typeof vec3>, 1);
    glowMat.blending = THREE.AdditiveBlending; glowMat.transparent = true; glowMat.depthWrite = false; glowMat.fog = false;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(GLOW_RADIUS_M * 2, GLOW_RADIUS_M * 2), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(p.pos[0] + f.facing[0] * 1.5, p.pos[1] + 0.01, p.pos[2] + f.facing[2] * 1.5);
    scene.add(quad, glow);
    objects.push(quad, glow);
  }
  const first = portals[0]!;
  const emberMat = new SpriteNodeMaterial();
  const pos = wgslFn(EMBER_POS)({ i: float(instanceIndex), t: uTime, cam: cameraPosition, box: float(EMBER_BOX_M) });
  const vpos = varying(pos as unknown as ReturnType<typeof vec3>);
  emberMat.positionNode = vpos;
  emberMat.scaleNode = float(0.035);
  const near = float(1).sub(vpos.sub(vec3(...first.pos)).length().div(10).clamp(0, 1));
  emberMat.colorNode = vec4(vec3(0.35, 0.22, 0.18).mix(vec3(1.0, 0.18, 0.08), near).mul(0.8), 1);
  emberMat.blending = THREE.AdditiveBlending; emberMat.transparent = true; emberMat.depthWrite = false; emberMat.fog = false;
  const embers = new THREE.Sprite(emberMat);
  embers.count = EMBER_COUNT;
  embers.frustumCulled = false;
  scene.add(embers);
  objects.push(embers);
  ctx.boot.handle.renderer.setClearColor(new THREE.Color(0, 0, 0));
  return { time: uTime as unknown as { value: number }, entered: null, objects };
}

/** Per frame: advance the shader clock on sim time, keep the fog black, fire a portal. */
export function stepVoid(ctx: GameContext, dt: number): void {
  const rt = ctx.lighting.void;
  if (!rt) return;
  rt.time.value += dt;
  const fog = ctx.boot.handle.scene.fog as THREE.Fog | null;
  if (fog) fog.color.setRGB(0, 0, 0);
  if (rt.entered) return;
  const pos = ctx.player.player.pos;
  const hit = ctx.world.level.portals.find(p => insidePortal(p, pos));
  if (!hit) return;
  rt.entered = hit.target;
  const flash = document.createElement('div');
  flash.style.cssText = `position:fixed;inset:0;z-index:60;pointer-events:none;background:#c01010;opacity:0;transition:background ${FLASH_MS}ms,opacity ${FLASH_MS / 2}ms`;
  document.body.appendChild(flash);
  requestAnimationFrame(() => { flash.style.opacity = '1'; flash.style.background = '#fff'; });
  setTimeout(() => location.assign(levelUrl(location.href, hit.target)), FLASH_MS);
}

export function createVoidSeams(ctx: GameContext) {
  return {
    voidState: () => {
      const rt = ctx.lighting.void;
      return rt ? { portals: ctx.world.level.portals.map(p => ({ id: p.id, target: p.target, pos: [...p.pos] })), entered: rt.entered } : null;
    },
  };
}
```

- [ ] **Step 3: Wire `game-main.ts`**: import; `ctx.lighting.void = createVoid(ctx);` right after `ctx.lighting.outdoor = createOutdoor(ctx);`; `stepVoid(ctx, dt);` right after `stepOutdoor(ctx, dt);`; `createVoidSeams(ctx),` after `createOutdoorSeams(ctx),`.

- [ ] **Step 4: Verify** `npx tsc --noEmit -p .`, `npx vitest run src/lab/sdf-zombie/webgpu/game-state-lighting src/lab/sdf-zombie/webgpu/game-context`; then a headless boot of `?level=the-void` with no console errors (Task 7's gate). **Commit** `feat(void): portal, glow pool, embers and entry wired into the game`.

---

### Task 6: Menu

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-menu.ts`, `game-menu.test.ts`, `game-menu-dom.ts`

- [ ] **Step 1: Test** — `LEVEL_CHOICES` ids become `['ring', 'the-void', 'the-wake']`; add `export const NEW_GAME_LEVEL = 'the-void'` and a test `expect(NEW_GAME_LEVEL).toBe('the-void')`.
- [ ] **Step 2: DOM** — main panel: **Resume**, **New game** (`location.assign(levelUrl(location.href, NEW_GAME_LEVEL))`), **Levels (dev)** (the picker, titled `LEVELS (DEV)`).
- [ ] **Step 3: Run** the menu test; **Commit** `feat(menu): New game starts in the Void; level picker moves under Levels (dev)`.

---

### Task 7: Gate, regression, docs

**Files:**
- Create: `scripts/sdf-game-void-gate.sh`, `scripts/sdf-game-void-gate.mjs` (ports 5293/9293)
- Modify: `TASKS.md`, `docs/game/levels/blender-conventions.md` (done in Task 2)

- [ ] **Step 1: Gate** — copy the Wake gate's CDP plumbing and `decodePng`, then:

```js
// 1. BOOT
if (!(await boot('level=the-void'))) { console.error(consoleEvents.slice(-8)); fail('the-void did not boot to ready'); }
const vs = await evaluate('__sdfGame.voidState()');
if (!vs || vs.portals.length !== 1 || vs.portals[0].target !== 'the-wake') fail(`voidState ${JSON.stringify(vs)}`);
pass('boot: the-void active, one portal to the-wake');
// 2. LOOK — standing at the start, facing the portal.
await sleep(1500);
const shot = decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
const mean = (x0, y0, x1, y1) => { /* mean rgb 0..1 over the pixel box, as in the Wake gate */ };
const c = mean(0.46, 0.40, 0.54, 0.52), l = mean(0.02, 0.45, 0.10, 0.55), r = mean(0.90, 0.45, 0.98, 0.55);
if (!(c[0] > 0.08 && c[0] > 1.5 * c[1])) fail(`portal centre not red: ${c.map(v => v.toFixed(3))}`);
if (!(Math.max(...l, ...r) < 0.06)) fail(`void edges not black: ${l} ${r}`);
pass(`look: portal centre red ${c[0].toFixed(3)}, edges black`);
// 3. ENTER — stand in the portal; the page reloads into the target.
await evaluate('__sdfGame.setPose(0, -18, 0, 0)');
await sleep(1500);
const href = await evaluate('location.href');
if (!/level=the-wake/.test(href)) fail(`did not enter the portal: ${href}`);
pass('enter: the portal loads the-wake');
console.log('PASS sdf-game-void-gate');
```

- [ ] **Step 2: Run** `LAB_TMP=.lab-tmp scripts/sdf-game-void-gate.sh`, then the regression gates `scripts/sdf-game-wake-gate.sh` and `scripts/sdf-game-shorty-gate.sh` (restore the shorty gate's rewritten screenshots afterwards: `git checkout -- docs/dev-notes/2026-09-02-fpv-weapon-shorty` and delete its untracked extras). Capture one screenshot of the void for the owner.
- [ ] **Step 3: Full suite** `npx vitest run src/lab/sdf-zombie/webgpu src/game/level`.
- [ ] **Step 4: TASKS.md** — mark item 2 done with the gate result; next: owner look review, then the carriage kit spec.
- [ ] **Step 5: Commit** `test(void): headless gate (boot, look, enter); TASKS`.
