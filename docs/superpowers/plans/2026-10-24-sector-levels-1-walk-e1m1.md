# Sector levels 1 — walk an empty E1M1 — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a sector level format, 2.5D collision on sector floors and walls, and a WAD converter,
so the owner can walk an empty Doom E1M1 (doors open, the arena's stone material everywhere) at
`?level=doom-e1m1`.

**Spec:** `docs/superpowers/specs/2026-10-24-doom-sector-levels-design.md` — read it first
(§4 format, §5 converter, §6 geometry and collision, §10 step 1).

**Architecture:** pure modules hold everything that decides: `sector-def.ts` (types, limits),
`sector-json.ts` (parse + validate, synthesize one art-shelled room per zone, delegate the
shared markers to `parseLevelJson`), `level-ground.ts` (the ground interface; flat ground for
room levels), `sector-ground.ts` (point-in-sector grid, floors, ceilings, blocking lines),
`sector-geometry.ts` (polygons with holes, wall quads). `game-player.ts` learns segment
collision, floors and ceilings from a `LevelGround` and keeps byte-identical behaviour on flat
ground. The only renderer module, `game-sector-mesh.ts`, triangulates with three's `ShapeUtils`
and adds one merged mesh per zone and role to the level group, room-tagged like level art. The
Python converter `scripts/levels/doom_map.py` reads the WAD.

**Tech Stack:** TypeScript, three.js WebGPU, Vitest, Python 3 + pytest, headless-Chrome gate
(`scripts/*.mjs` over `scripts/lab-servers.sh`).

**Out of this plan (later plans):** moving doors (2), hazard glow and damage (3), sector light
levels (4), things, enemies, nav on heights, pickups, barrels, the exit, `--skill` (5). Known
gaps left on purpose, listed in the notes file in Task 7: slugs pass through sector walls
(`game-hit-trace.ts` reads the AABB colliders only), dynamite, gibs and blood still land at
`y = 0`, level lights pick the first zone room whose box holds them (zone boxes overlap).

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production
  scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests**
    (no `three` import; plain data in, plain data out). The renderer-facing module
    only reads that logic's output and writes objects.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module —
    never as new `main()` bindings (`npm test -- game-context-coverage`).
  - Keep the simulation deterministic (sim-time clocks, no wall-clock in logic).
- Work ONLY in your worktree. Never `git stash`. `node_modules` is symlinked — do not reinstall.
- **Targeted tests only** (`npx vitest run <path>`, or `npm run test:changed`) plus `npm run typecheck`.
  Never the full suite locally: CI runs it on every push (`gh run list --branch <branch>`).
- **Headless capture only** — the in-app browser pane loses the WebGPU device.
  Capture scripts require `window.__warmGate.phase === 'ready'` and fail on
  renderer pipeline errors.
- **Prove visual and performance claims with a number** and look at the images yourself.
- Kill anything you start outside a capture script in the same step.
- **Anything derived from the WAD is a dev placeholder** (the Blood rule): never commit
  `public/assets/levels/doom-*.level.json` or anything under `.lab-tmp/`.

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lab/sdf-zombie/webgpu/sector-def.ts` | create | Sector types, `SECTOR_STEP_M` 0.75, `SECTOR_HEADROOM_M` 1.9, `SKY_MATERIAL`, `zoneName` |
| `src/lab/sdf-zombie/webgpu/sector-json.ts` | create | `parseSectorLevel`, and `parseLevel` (picks sectors or rooms) |
| `src/lab/sdf-zombie/webgpu/level-ground.ts` | create | `LevelGround`, `WallSeg`, `FLAT_GROUND` |
| `src/lab/sdf-zombie/webgpu/sector-ground.ts` | create | `buildSectorGround` |
| `src/lab/sdf-zombie/webgpu/sector-geometry.ts` | create | `sectorPolygons`, `wallQuads` |
| `src/lab/sdf-zombie/webgpu/game-sector-mesh.ts` | create | Meshes into `ctx.world.levelGroup` |
| `src/lab/sdf-zombie/webgpu/level-def.ts` | modify | `Capability` gains `'sectors'`; `LevelDef.sectors?` |
| `src/lab/sdf-zombie/webgpu/active-level.ts` | modify | `ground` on `ActiveLevel`; `sectorActiveLevel`; `'sectors'` supported |
| `src/lab/sdf-zombie/webgpu/game-player.ts` | modify | `resolveSegments`, ground in `stepPlayer`, `stepLag` in `eyeOf` |
| `src/lab/sdf-zombie/webgpu/game-tick.ts:223` | modify | pass `ctx.world.level.ground` |
| `src/lab/sdf-zombie/webgpu/game-main.ts:594-597, 767` | modify | `parseLevel`, `sectorActiveLevel`, `addSectorMeshes` |
| `src/lab/sdf-zombie/webgpu/game-seams-world.ts:660` | modify | `level().geometry`, `ground(x, z)` seam |
| `public/assets/levels/fixtures/sectors.level.json` | create | Committed hand-made sector fixture |
| `scripts/levels/doom_tables.py` | create | Doom names and numbers → ours |
| `scripts/levels/doom_map.py` | create | WAD → `doom-<map>.level.json` (+ optional SVG plan) |
| `scripts/tests/test_doom_map.py` | create | Converter tests on a WAD built in the test |
| `scripts/sdf-game-doom-gate.{sh,mjs}` | create | Headless gate: the fixture, then E1M1 if generated |
| `.gitignore`, `package.json` | modify | ignore generated Doom levels; `dev:doom` |

### The fixture (used by Tasks 1–5 and 7)

Game axes: x right, z forward is −z (yaw 0 faces −z), y up. Four sectors and a column hole:

```
            z=0  ┌────────────┬──────────┐
                 │  A  floor 0│ D floor −1│   A: x −4..4, z 0..−8, ceil 4, zone 0
                 │   ┌──┐     │  (pit)    │      column hole x −1..1, z −3..−5 (no sector)
                 │   └──┘     │           │   D: x 4..8, z 0..−8, ceil 4, zone 1
           z=−8  ├────────────┼──────────┘   B: x −4..4, z −8..−12, floor 0.5 (a step: walkable)
                 │  B  0.5    │               C: x −4..4, z −12..−16, floor 1.5 (1.0 above B: blocks)
          z=−12  ├────────────┤
                 │  C  1.5    │
          z=−16  └────────────┘
                x=−4         x=4         x=8
```

---

## Task 1: Sector types, fixture, parser

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/sector-def.ts`, `src/lab/sdf-zombie/webgpu/sector-json.ts`,
  `public/assets/levels/fixtures/sectors.level.json`
- Modify: `src/lab/sdf-zombie/webgpu/level-def.ts:38` (Capability), `:96-131` (LevelDef)
- Test: `src/lab/sdf-zombie/webgpu/sector-json.test.ts`

- [ ] **Step 1: Write `sector-def.ts`**

```ts
// src/lab/sdf-zombie/webgpu/sector-def.ts
//
// SECTOR LEVELS — types and the movement limits.
// Spec: docs/superpowers/specs/2026-10-24-doom-sector-levels-design.md §4, §6.2.
// A sector is a 2D polygon bounded by its lines, with a floor, a ceiling and a light;
// a line is a wall (one sector) or an edge between two sectors (a step, a lip or nothing).
//
// Pure: no three.js, no DOM.

export type XZ = readonly [number, number];
export type SectorSpecial = 'none' | 'hurt' | 'flicker' | 'pulse' | 'strobe';
export const SECTOR_SPECIALS: readonly SectorSpecial[] = ['none', 'hurt', 'flicker', 'pulse', 'strobe'];
export type GlowKind = 'nukage' | 'lava' | 'acid';
export const GLOW_KINDS: readonly GlowKind[] = ['nukage', 'lava', 'acid'];

export interface SectorMaterials { floor: string; ceil: string; wall: string }
export interface SectorDef {
  floor: number;
  ceil: number;
  /** 0..1, Doom's 0..255 light level. */
  light: number;
  special: SectorSpecial;
  /** Damage per second on a hurt floor; 0 otherwise. */
  hurtPerSec: number;
  glow: GlowKind | null;
  materials: SectorMaterials;
  /** The lighting zone (spec §6.5): its synthesized room is `zoneName(zone)`. */
  zone: number;
}
export interface SectorDoor { sector: number; speed: number; wait: number }
export interface SectorLine {
  v: readonly [number, number];
  front: number;
  /** -1: a solid wall with nothing behind it. */
  back: number;
  door: SectorDoor | null;
  exit: boolean;
}
export interface SectorMap { vertices: XZ[]; sectors: SectorDef[]; lines: SectorLine[] }

/** Spec §6.2: the highest step a body walks up (Doom's 24 units at 32 units/m). */
export const SECTOR_STEP_M = 0.75;
/** Spec §6.2: the lowest opening a body fits through (the Flat's doorway rule). */
export const SECTOR_HEADROOM_M = 1.9;
/** The material that means "open to the sky": no ceiling drawn (Doom's F_SKY1). */
export const SKY_MATERIAL = 'sky';

/** The synthesized room name of a zone: what `ActiveLevel.keyAt` returns inside it. */
export function zoneName(zone: number): string {
  return `zone-${zone}`;
}
```

- [ ] **Step 2: Add the capability and the field in `level-def.ts`**

Line 38 becomes:

```ts
export type Capability = 'multi-floor' | 'windows' | 'open-sky' | 'void' | 'portals' | 'art' | 'sectors';
```

Add to the imports at the top:

```ts
import type { SectorMap } from './sector-def';
```

and in `interface LevelDef`, after `art: string | null;`:

```ts
  /** Sector levels (spec 2026-10-24 §4): the sector geometry; absent on room levels. Its zones
   *  are `rooms` with `shell: 'art'` (collision comes from the sectors, not their boxes). */
  sectors?: SectorMap;
```

- [ ] **Step 3: Write the fixture `public/assets/levels/fixtures/sectors.level.json`**

```json
{
  "version": 1,
  "id": "sectors-fixture",
  "name": "Sector fixture",
  "geometry": "sectors",
  "ammo": "infinite",
  "loadout": ["melee", "shotgun"],
  "vertices": [
    [-4, 0], [4, 0], [4, -8], [-4, -8], [4, -12], [-4, -12], [4, -16], [-4, -16], [8, 0], [8, -8],
    [-1, -3], [1, -3], [1, -5], [-1, -5]
  ],
  "sectors": [
    { "floor": 0, "ceil": 4, "light": 0.6, "zone": 0, "materials": { "floor": "metal-plate", "ceil": "concrete", "wall": "tech" } },
    { "floor": 0.5, "ceil": 4, "light": 0.6, "zone": 0 },
    { "floor": 1.5, "ceil": 4, "light": 0.4, "zone": 0 },
    { "floor": -1, "ceil": 4, "light": 0.3, "zone": 1, "materials": { "floor": "metal-plate", "ceil": "sky", "wall": "tech" } }
  ],
  "lines": [
    { "v": [0, 1], "front": 0 },
    { "v": [1, 2], "front": 0, "back": 3 },
    { "v": [2, 3], "front": 0, "back": 1 },
    { "v": [3, 0], "front": 0 },
    { "v": [10, 11], "front": 0 },
    { "v": [11, 12], "front": 0 },
    { "v": [12, 13], "front": 0 },
    { "v": [13, 10], "front": 0 },
    { "v": [2, 4], "front": 1 },
    { "v": [4, 5], "front": 1, "back": 2 },
    { "v": [5, 3], "front": 1 },
    { "v": [4, 6], "front": 2 },
    { "v": [6, 7], "front": 2 },
    { "v": [7, 5], "front": 2 },
    { "v": [1, 8], "front": 3 },
    { "v": [8, 9], "front": 3 },
    { "v": [9, 2], "front": 3 }
  ],
  "start": { "pos": [0, 0, -1.5], "yaw": 0 },
  "lights": [
    { "pos": [0, 3.4, -6], "color": [1.0, 0.92, 0.82], "power": 10, "fixture": "none" },
    { "pos": [6, 3.4, -4], "color": [1.0, 0.92, 0.82], "power": 6, "fixture": "none" }
  ]
}
```

- [ ] **Step 4: Write the failing tests `sector-json.test.ts`**

```ts
// src/lab/sdf-zombie/webgpu/sector-json.test.ts
//
// Sector levels (spec 2026-10-24 §4): parse, validate, zone rooms, delegation to Level Format v1.

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLevel, parseSectorLevel } from './sector-json';

const fixture = (): any => JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'));

describe('parseSectorLevel: the sectors fixture', () => {
  it('reads vertices, sectors and lines with defaults filled', () => {
    const L = parseSectorLevel(fixture());
    expect(L.id).toBe('sectors-fixture');
    expect(L.sectors!.vertices).toHaveLength(14);
    expect(L.sectors!.lines).toHaveLength(17);
    expect(L.sectors!.sectors.map(s => [s.floor, s.ceil, s.zone])).toEqual([[0, 4, 0], [0.5, 4, 0], [1.5, 4, 0], [-1, 4, 1]]);
    expect(L.sectors!.sectors[1]).toMatchObject({ special: 'none', hurtPerSec: 0, glow: null,
      materials: { floor: 'default', ceil: 'default', wall: 'default' } });
    expect(L.sectors!.lines[0]).toEqual({ v: [0, 1], front: 0, back: -1, door: null, exit: false });
    expect(L.sectors!.lines[1]!.back).toBe(3);
  });
  it('makes one art-shelled room per zone, boxed round its sectors', () => {
    const L = parseSectorLevel(fixture());
    expect(L.rooms.map(r => [r.id, r.name, r.minX, r.maxX, r.minZ, r.maxZ, r.floor, r.height, r.shell]))
      .toEqual([[1, 'zone-0', -4, 4, -16, 0, 0, 4, 'art'], [2, 'zone-1', 4, 8, -8, 0, -1, 5, 'art']]);
  });
  it('requires sectors, never multi-floor, and keeps the shared markers', () => {
    const L = parseSectorLevel(fixture());
    expect(L.requires).toContain('sectors');
    expect(L.requires).not.toContain('multi-floor');
    expect(L.playerStart).toMatchObject({ x: 0, y: 0, z: -1.5 });
    expect(L.ammo).toBe('infinite');
    expect(L.rooms[0]!.accents).toHaveLength(1);
  });
});

describe('parseSectorLevel: refusals (collects every problem)', () => {
  const broken = (edit: (j: any) => void) => { const j = fixture(); edit(j); return () => parseSectorLevel(j); };
  it('refuses a line to a missing vertex or sector', () => {
    expect(broken(j => { j.lines[0].v = [0, 99]; })).toThrow(/lines\[0\]\.v/);
    expect(broken(j => { j.lines[1].back = 9; })).toThrow(/lines\[1\]\.back/);
  });
  it('refuses an open sector (a vertex used an odd number of times)', () => {
    expect(broken(j => { j.lines.splice(12, 1); })).toThrow(/sector 2: not closed/);
  });
  it('refuses a ceiling at or below the floor', () => {
    expect(broken(j => { j.sectors[1].ceil = 0.5; })).toThrow(/sectors\[1\]: ceil must be above floor/);
  });
  it('refuses unknown keys and specials', () => {
    expect(broken(j => { j.sectors[0].wobble = 1; })).toThrow(/sectors\[0\]: unknown key wobble/);
    expect(broken(j => { j.sectors[0].special = 'spin'; })).toThrow(/sectors\[0\]\.special/);
    expect(broken(j => { j.sectors[0].special = 'hurt'; })).toThrow(/sectors\[0\]\.hurtPerSec/);
  });
  it('lets a door sector close (ceil == floor) but not invert', () => {
    expect(broken(j => { j.sectors[1].ceil = 0.5; j.lines[2].door = { sector: 1 }; })).not.toThrow();
    expect(broken(j => { j.sectors[1].ceil = 0.2; j.lines[2].door = { sector: 1 }; })).toThrow(/ceil must not be below floor/);
  });
});

describe('parseLevel', () => {
  it('sends sector files to the sector parser and the rest to Level Format v1', () => {
    expect(parseLevel(fixture()).sectors).toBeDefined();
    const rooms = JSON.parse(readFileSync('public/assets/levels/fixtures/two-rooms.level.json', 'utf8'));
    expect(parseLevel(rooms).sectors).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sector-json.test.ts`
Expected: FAIL — `Cannot find module './sector-json'`.

- [ ] **Step 6: Write `sector-json.ts`**

```ts
// src/lab/sdf-zombie/webgpu/sector-json.ts
//
// SECTOR LEVELS — parse and validate (spec 2026-10-24-doom-sector-levels-design.md §4).
// Written by scripts/levels/doom_map.py (and by hand for fixtures). The sector block is checked
// here; everything a sector level shares with Level Format v1 (start, lights, solids, spawns,
// pickups, triggers, cues) is checked by parseLevelJson, which gets one art-shelled room per
// zone so its "inside a room" rules hold. Collects every problem and throws once.

import type { Capability, LevelDef } from './level-def';
import { parseLevelJson, type ParseOptions } from './level-json';
import {
  GLOW_KINDS, SECTOR_SPECIALS, zoneName,
  type GlowKind, type SectorDef, type SectorLine, type SectorMap, type SectorSpecial, type XZ,
} from './sector-def';

type Json = Record<string, unknown>;

const TOP = ['version', 'id', 'name', 'ammo', 'loadout', 'completeOn', 'arena', 'palette', 'geometry',
  'vertices', 'sectors', 'lines', 'solids', 'lights', 'start', 'spawns', 'pickups', 'triggers', 'cues'];
/** Handed on to parseLevelJson unchanged. */
const SHARED = ['version', 'id', 'name', 'ammo', 'loadout', 'completeOn', 'arena', 'palette',
  'solids', 'lights', 'start', 'spawns', 'pickups', 'triggers', 'cues'];
const SECTOR_KEYS = ['floor', 'ceil', 'light', 'special', 'hurtPerSec', 'glow', 'materials', 'zone'];
const LINE_KEYS = ['v', 'front', 'back', 'door', 'exit'];
const DOOR_KEYS = ['sector', 'speed', 'wait'];
const MATERIAL_KEYS = ['floor', 'ceil', 'wall'];

/** A sector file (`"geometry": "sectors"`) or a Level Format v1 room file. */
export function parseLevel(raw: unknown, opts: ParseOptions = {}): LevelDef {
  const j = (raw ?? {}) as Json;
  return j.geometry === 'sectors' ? parseSectorLevel(raw, opts) : parseLevelJson(raw, opts);
}

export function parseSectorLevel(raw: unknown, opts: ParseOptions = {}): LevelDef {
  const errors: string[] = [];
  const j = (raw ?? {}) as Json;
  const id = typeof j.id === 'string' ? j.id : 'unknown';
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const isInt = (v: unknown): v is number => Number.isInteger(v);
  const unknownKeys = (o: Json, known: readonly string[], where: string) => {
    for (const k of Object.keys(o)) if (!known.includes(k)) errors.push(`${where}: unknown key ${k}`);
  };
  const objects = (v: unknown, where: string): Json[] => {
    if (Array.isArray(v) && v.every(x => typeof x === 'object' && x !== null && !Array.isArray(x))) return v as Json[];
    errors.push(`${where}: expected an array of objects`);
    return [];
  };

  unknownKeys(j, TOP, 'level');
  if (j.geometry !== 'sectors') errors.push('geometry: expected "sectors"');

  // --- vertices ------------------------------------------------------------------
  const vertices: XZ[] = [];
  if (!Array.isArray(j.vertices)) errors.push('vertices: expected an array of [x, z]');
  else j.vertices.forEach((v, i) => {
    if (Array.isArray(v) && v.length === 2 && v.every(isNum)) vertices.push([v[0], v[1]]);
    else { errors.push(`vertices[${i}]: expected [x, z]`); vertices.push([0, 0]); }
  });

  // --- sectors -------------------------------------------------------------------
  const sectors: SectorDef[] = objects(j.sectors, 'sectors').map((o, i) => {
    const where = `sectors[${i}]`;
    unknownKeys(o, SECTOR_KEYS, where);
    const floor = isNum(o.floor) ? o.floor : (errors.push(`${where}.floor: expected a number`), 0);
    const ceil = isNum(o.ceil) ? o.ceil : (errors.push(`${where}.ceil: expected a number`), floor + 1);
    const light = o.light === undefined ? 0.5 : isNum(o.light) && o.light >= 0 && o.light <= 1 ? o.light
      : (errors.push(`${where}.light: a number in 0..1`), 0.5);
    let special: SectorSpecial = 'none';
    if (o.special !== undefined) {
      if (SECTOR_SPECIALS.includes(o.special as SectorSpecial)) special = o.special as SectorSpecial;
      else errors.push(`${where}.special: one of ${SECTOR_SPECIALS.join(', ')}`);
    }
    const hurtPerSec = o.hurtPerSec === undefined ? 0 : isNum(o.hurtPerSec) && o.hurtPerSec >= 0 ? o.hurtPerSec
      : (errors.push(`${where}.hurtPerSec: a number >= 0`), 0);
    if (special === 'hurt' && !(hurtPerSec > 0)) errors.push(`${where}.hurtPerSec: a hurt sector needs hurtPerSec > 0`);
    let glow: GlowKind | null = null;
    if (o.glow !== undefined && o.glow !== null) {
      if (GLOW_KINDS.includes(o.glow as GlowKind)) glow = o.glow as GlowKind;
      else errors.push(`${where}.glow: one of ${GLOW_KINDS.join(', ')}`);
    }
    const mj = (typeof o.materials === 'object' && o.materials !== null ? o.materials : {}) as Json;
    unknownKeys(mj, MATERIAL_KEYS, `${where}.materials`);
    const mat = (k: string) => (typeof mj[k] === 'string' && mj[k] ? mj[k] as string : 'default');
    const zone = isInt(o.zone) && o.zone >= 0 ? o.zone : (errors.push(`${where}.zone: an integer >= 0`), 0);
    return { floor, ceil, light, special, hurtPerSec, glow,
      materials: { floor: mat('floor'), ceil: mat('ceil'), wall: mat('wall') }, zone };
  });
  if (sectors.length === 0) errors.push('sectors: a sector level needs at least one sector');

  // --- lines ---------------------------------------------------------------------
  const sectorIndex = (v: unknown) => isInt(v) && v >= 0 && v < sectors.length;
  const lines: SectorLine[] = objects(j.lines, 'lines').map((o, i) => {
    const where = `lines[${i}]`;
    unknownKeys(o, LINE_KEYS, where);
    const ok = Array.isArray(o.v) && o.v.length === 2 && o.v.every(x => isInt(x) && x >= 0 && x < vertices.length)
      && o.v[0] !== o.v[1];
    if (!ok) errors.push(`${where}.v: two different vertex indices`);
    const v = (ok ? o.v : [0, 0]) as [number, number];
    const front = sectorIndex(o.front) ? o.front as number : (errors.push(`${where}.front: a sector index`), 0);
    const back = o.back === undefined || o.back === -1 ? -1
      : sectorIndex(o.back) ? o.back as number : (errors.push(`${where}.back: a sector index or -1`), -1);
    let door: SectorLine['door'] = null;
    if (o.door !== undefined) {
      const d = (typeof o.door === 'object' && o.door !== null ? o.door : {}) as Json;
      unknownKeys(d, DOOR_KEYS, `${where}.door`);
      if (!sectorIndex(d.sector)) errors.push(`${where}.door.sector: a sector index`);
      const speed = d.speed === undefined ? 2 : isNum(d.speed) && d.speed > 0 ? d.speed : (errors.push(`${where}.door.speed: > 0`), 2);
      const wait = d.wait === undefined ? 4 : isNum(d.wait) && d.wait >= 0 ? d.wait : (errors.push(`${where}.door.wait: >= 0`), 4);
      door = { sector: sectorIndex(d.sector) ? d.sector as number : 0, speed, wait };
    }
    if (o.exit !== undefined && typeof o.exit !== 'boolean') errors.push(`${where}.exit: true or false`);
    return { v, front, back, door, exit: o.exit === true };
  });

  // --- closure: each sector's lines form closed loops ------------------------------
  sectors.forEach((_, s) => {
    const uses = new Map<number, number>();
    for (const l of lines) {
      if (l.front === l.back) continue;                       // both sides the same sector: adds 2, changes nothing
      if (l.front !== s && l.back !== s) continue;
      for (const vi of l.v) uses.set(vi, (uses.get(vi) ?? 0) + 1);
    }
    if (uses.size === 0) errors.push(`sector ${s}: no lines`);
    for (const [vi, n] of uses) if (n % 2 !== 0) { errors.push(`sector ${s}: not closed (vertex ${vi} used ${n} times)`); break; }
  });

  // --- heights: a door may close to its floor, nothing may invert -------------------
  const doorSectors = new Set(lines.flatMap(l => (l.door ? [l.door.sector] : [])));
  sectors.forEach((s, i) => {
    if (doorSectors.has(i)) { if (s.ceil < s.floor) errors.push(`sectors[${i}]: ceil must not be below floor`); }
    else if (!(s.ceil > s.floor)) errors.push(`sectors[${i}]: ceil must be above floor`);
  });

  if (errors.length > 0) throw new Error(`level ${id}: ${errors.join('; ')}`);

  // --- one art-shelled room per zone, boxed round its sectors' vertices -------------
  const zones = [...new Set(sectors.map(s => s.zone))].sort((a, b) => a - b);
  const rooms = zones.map(zone => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, lo = Infinity, hi = -Infinity;
    sectors.forEach((s, si) => {
      if (s.zone !== zone) return;
      lo = Math.min(lo, s.floor); hi = Math.max(hi, s.ceil);
      for (const l of lines) {
        if (l.front !== si && l.back !== si) continue;
        for (const vi of l.v) {
          const [x, z] = vertices[vi]!;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
      }
    });
    return { id: zone + 1, name: zoneName(zone), min: [minX, minZ], max: [maxX, maxZ], floor: lo,
      height: Math.max(hi - lo, 0.1), shell: 'art' };
  });

  const shared: Json = {};
  for (const k of SHARED) if (j[k] !== undefined) shared[k] = j[k];
  const base = parseLevelJson({ ...shared, rooms }, opts);
  const map: SectorMap = { vertices, sectors, lines };
  const requires: Capability[] = [...base.requires.filter(c => c !== 'multi-floor'), 'sectors'];
  return { ...base, requires, sectors: map };
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sector-json.test.ts src/lab/sdf-zombie/webgpu/level-json.test.ts`
Expected: PASS (level-json unchanged). If the `zone-1` room test fails on `height`, check:
D's floor −1 and ceil 4 give height 5.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck
git add src/lab/sdf-zombie/webgpu/sector-def.ts src/lab/sdf-zombie/webgpu/sector-json.ts src/lab/sdf-zombie/webgpu/sector-json.test.ts src/lab/sdf-zombie/webgpu/level-def.ts public/assets/levels/fixtures/sectors.level.json
git commit -m "feat(levels): sector level format — types, parser, fixture"
```

---

## Task 2: The ground interface and sector ground

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/level-ground.ts`, `src/lab/sdf-zombie/webgpu/sector-ground.ts`
- Test: `src/lab/sdf-zombie/webgpu/sector-ground.test.ts`

- [ ] **Step 1: Write `level-ground.ts`**

```ts
// src/lab/sdf-zombie/webgpu/level-ground.ts
//
// THE GROUND a body stands on (spec 2026-10-24-doom-sector-levels-design.md §6.1): the floor and
// ceiling under a point and the wall lines that block a body there. Room levels stand on y = 0
// with no lines (FLAT_GROUND, so they behave exactly as before); sector levels answer from their
// sectors (sector-ground.ts). Box solids stay in the AABB collider list.
//
// Pure: no three.js, no DOM.

/** A 2D wall segment in x/z. */
export interface WallSeg { ax: number; az: number; bx: number; bz: number }

export interface LevelGround {
  /** Floor height under (x, z); NaN outside every sector. */
  floorAt(x: number, z: number): number;
  /** Ceiling height over (x, z); NaN outside every sector, Infinity when there is none. */
  ceilAt(x: number, z: number): number;
  /** Wall segments within about `r` of (x, z) that block a body whose feet are at `feetY`. */
  blockingNear(x: number, z: number, r: number, feetY: number): readonly WallSeg[];
}

const NO_SEGS: readonly WallSeg[] = [];

export const FLAT_GROUND: LevelGround = {
  floorAt: () => 0,
  ceilAt: () => Infinity,
  blockingNear: () => NO_SEGS,
};
```

- [ ] **Step 2: Write the failing tests `sector-ground.test.ts`**

```ts
// src/lab/sdf-zombie/webgpu/sector-ground.test.ts
//
// Spec §6.1–§6.2 against the committed sectors fixture (see the plan's diagram).

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSectorLevel } from './sector-json';
import { buildSectorGround } from './sector-ground';
import type { WallSeg } from './level-ground';

const map = () => parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'))).sectors!;

describe('buildSectorGround: lookup', () => {
  const g = buildSectorGround(map());
  it('finds the sector under a point', () => {
    expect(g.sectorAt(0, -1)).toBe(0);
    expect(g.sectorAt(-3, -7)).toBe(0);
    expect(g.sectorAt(0, -10)).toBe(1);
    expect(g.sectorAt(0, -14)).toBe(2);
    expect(g.sectorAt(6, -4)).toBe(3);
  });
  it('says -1 in the column hole and outside the map', () => {
    expect(g.sectorAt(0, -4)).toBe(-1);
    expect(g.sectorAt(20, 20)).toBe(-1);
    expect(g.sectorAt(6, -12)).toBe(-1);
  });
  it('gives floors and ceilings, NaN outside', () => {
    expect([g.floorAt(0, -1), g.floorAt(0, -10), g.floorAt(0, -14), g.floorAt(6, -4)]).toEqual([0, 0.5, 1.5, -1]);
    expect(g.ceilAt(0, -10)).toBe(4);
    expect(g.floorAt(0, -4)).toBeNaN();
  });
});

describe('buildSectorGround: blocking lines', () => {
  it('one-sided walls always block', () => {
    const segs = buildSectorGround(map()).blockingNear(0, -2.8, 0.5, 0);   // the column's near face is z = -3
    expect(segs.some(s => s.az === -3 && s.bz === -3)).toBe(true);
  });
  // Pick lines by both ends: x = 4 also holds B's east wall (2-4), z = -8 also D's south wall (9-2).
  const ab = (s: WallSeg) => s.az === -8 && s.bz === -8 && Math.min(s.ax, s.bx) === -4;   // line 2-3
  const bc = (s: WallSeg) => s.az === -12 && s.bz === -12 && Math.min(s.ax, s.bx) === -4; // line 4-5
  const ad = (s: WallSeg) => s.ax === 4 && s.bx === 4 && Math.max(s.az, s.bz) === 0;      // line 1-2
  it('a 0.5 m step does not block; a 1.0 m step does; a drop does not', () => {
    const g = buildSectorGround(map());
    expect(g.blockingNear(0, -7.9, 0.5, 0).some(ab)).toBe(false);          // A -> B
    expect(g.blockingNear(0, -11.9, 0.5, 0.5).some(bc)).toBe(true);        // B -> C
    expect(g.blockingNear(3.9, -4, 0.5, 0).some(ad)).toBe(false);          // A -> D (down)
    expect(g.blockingNear(4.1, -4, 0.5, -1).some(ad)).toBe(true);          // D -> A (1 m up)
  });
  it('an opening under 1.9 m blocks', () => {
    const m = map();
    m.sectors[1]!.ceil = 2.3;                                               // opening min(4, 2.3) - max(0, 0.5) = 1.8
    expect(buildSectorGround(m).blockingNear(0, -7.9, 0.5, 0).some(ab)).toBe(true);
  });
  it('only returns lines near the point', () => {
    const segs = buildSectorGround(map()).blockingNear(-2, -1, 0.5, 0);
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.length).toBeLessThan(17);
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sector-ground.test.ts`
Expected: FAIL — `Cannot find module './sector-ground'`.

- [ ] **Step 4: Write `sector-ground.ts`**

```ts
// src/lab/sdf-zombie/webgpu/sector-ground.ts
//
// SECTOR GROUND (spec 2026-10-24-doom-sector-levels-design.md §6.1–§6.2): which sector is under a
// point (even-odd crossing over that sector's lines, candidates from a uniform grid), its floor
// and ceiling, and which lines block a body. A two-sided line blocks when the opening between the
// two sectors is under SECTOR_HEADROOM_M or the higher floor is over SECTOR_STEP_M above the feet;
// the same rule both ways, so drops are open and climbs are not.
//
// Pure: no three.js, no DOM. The Rust port implements the same rule.

import type { LevelGround, WallSeg } from './level-ground';
import { SECTOR_HEADROOM_M, SECTOR_STEP_M, type SectorMap } from './sector-def';

const CELL_M = 4;

export interface SectorGround extends LevelGround {
  /** The sector index under (x, z), or -1. */
  sectorAt(x: number, z: number): number;
}

export function buildSectorGround(map: SectorMap): SectorGround {
  const V = map.vertices, S = map.sectors, L = map.lines;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of V) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const cols = Math.max(1, Math.ceil((maxX - minX) / CELL_M));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / CELL_M));
  const col = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / CELL_M)));
  const row = (z: number) => Math.min(rows - 1, Math.max(0, Math.floor((z - minZ) / CELL_M)));
  const sectorCells: number[][] = Array.from({ length: cols * rows }, () => []);
  const lineCells: number[][] = Array.from({ length: cols * rows }, () => []);
  const forCells = (x0: number, z0: number, x1: number, z1: number, f: (cell: number) => void) => {
    for (let r = row(z0); r <= row(z1); r++) for (let c = col(x0); c <= col(x1); c++) f(r * cols + c);
  };

  const sectorLines: number[][] = S.map(() => []);
  L.forEach((l, i) => {
    if (l.front !== l.back) { sectorLines[l.front]!.push(i); if (l.back >= 0) sectorLines[l.back]!.push(i); }
    const [ax, az] = V[l.v[0]]!, [bx, bz] = V[l.v[1]]!;
    forCells(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), cell => lineCells[cell]!.push(i));
  });
  sectorLines.forEach((ls, s) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const i of ls) for (const vi of L[i]!.v) {
      const [x, z] = V[vi]!;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    if (ls.length > 0) forCells(x0, z0, x1, z1, cell => sectorCells[cell]!.push(s));
  });

  const inside = (s: number, x: number, z: number): boolean => {
    let odd = false;
    for (const i of sectorLines[s]!) {
      const [ax, az] = V[L[i]!.v[0]]!, [bx, bz] = V[L[i]!.v[1]]!;
      if ((az > z) !== (bz > z) && x < ax + ((z - az) * (bx - ax)) / (bz - az)) odd = !odd;
    }
    return odd;
  };
  const sectorAt = (x: number, z: number): number => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return -1;
    for (const s of sectorCells[row(z) * cols + col(x)]!) if (inside(s, x, z)) return s;
    return -1;
  };
  const blocks = (i: number, feetY: number): boolean => {
    const l = L[i]!;
    if (l.back < 0) return true;
    const a = S[l.front]!, b = S[l.back]!;
    const lo = Math.max(a.floor, b.floor), hi = Math.min(a.ceil, b.ceil);
    return hi - lo < SECTOR_HEADROOM_M || lo - feetY > SECTOR_STEP_M;
  };

  return {
    sectorAt,
    floorAt: (x, z) => { const s = sectorAt(x, z); return s < 0 ? NaN : S[s]!.floor; },
    ceilAt: (x, z) => { const s = sectorAt(x, z); return s < 0 ? NaN : S[s]!.ceil; },
    blockingNear(x, z, r, feetY) {
      const out: WallSeg[] = [];
      const seen = new Set<number>();
      forCells(x - r, z - r, x + r, z + r, cell => {
        for (const i of lineCells[cell]!) {
          if (seen.has(i)) continue;
          seen.add(i);
          if (!blocks(i, feetY)) continue;
          const [ax, az] = V[L[i]!.v[0]]!, [bx, bz] = V[L[i]!.v[1]]!;
          out.push({ ax, az, bx, bz });
        }
      });
      return out;
    },
  };
}
```

Note: `blocks`, `floorAt` and `ceilAt` read `S[...]` live, never cached heights. Plan 2's doors
rely on that: they change a door sector's `ceil` in place.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sector-ground.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/level-ground.ts src/lab/sdf-zombie/webgpu/sector-ground.ts src/lab/sdf-zombie/webgpu/sector-ground.test.ts
git commit -m "feat(levels): the ground interface and sector lookup with blocking lines"
```

---

## Task 3: The player on sector ground

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-player.ts` (PlayerState `:23-30`, stepPlayer `:133-197`, eyeOf `:200-202`)
- Test: `src/lab/sdf-zombie/webgpu/game-player.test.ts` (new; the module has none)

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/game-player.test.ts
//
// The player on sector ground (spec 2026-10-24 §6.2) and unchanged on flat ground.

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eyeOf, PLAYER, resolveSegments, stepPlayer, type Mut3, type PlayerState } from './game-player';
import { FLAT_GROUND } from './level-ground';
import { buildSectorGround } from './sector-ground';
import { parseSectorLevel } from './sector-json';

const ground = () => buildSectorGround(parseSectorLevel(
  JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'))).sectors!);
const at = (x: number, y: number, z: number, yaw = 0): PlayerState => ({ pos: [x, y, z], vel: [0, 0, 0], yaw, pitch: 0, grounded: true });
const walk = (s: PlayerState, secs: number, g = ground(), x = 0, z = 1) => {
  for (let t = 0; t < secs; t += 1 / 60) stepPlayer(s, { x, z, jump: false }, 1 / 60, [], g);
  return s;
};

describe('resolveSegments', () => {
  it('pushes a circle off a segment to exactly its radius and reports the push', () => {
    const p: Mut3 = [0, 0, -0.1];
    const push = resolveSegments(p, [{ ax: -1, az: 0, bx: 1, bz: 0 }], 0.32);
    expect(p[2]).toBeCloseTo(-0.32, 6);
    expect(push![1]).toBeCloseTo(-0.22, 6);
  });
  it('leaves a circle clear of every segment alone', () => {
    const p: Mut3 = [0, 0, -1];
    expect(resolveSegments(p, [{ ax: -1, az: 0, bx: 1, bz: 0 }], 0.32)).toBeNull();
    expect(p).toEqual([0, 0, -1]);
  });
});

describe('stepPlayer on the sectors fixture', () => {
  it('walks up the 0.5 m step into B', () => {
    const s = walk(at(2.5, 0, -6), 1.5);                                   // forward is -z at yaw 0
    expect(s.pos[2]).toBeLessThan(-8.3);
    expect(s.pos[1]).toBeCloseTo(0.5, 6);
    expect(s.grounded).toBe(true);
  });
  it('is stopped by the 1.0 m ledge at C', () => {
    const s = walk(at(2.5, 0.5, -10), 3);
    expect(s.pos[2]).toBeGreaterThan(-12);
    expect(s.pos[2]).toBeCloseTo(-12 + PLAYER.radius, 2);
    expect(s.pos[1]).toBeCloseTo(0.5, 6);
  });
  it('drops into the pit D and cannot climb back', () => {
    const s = walk(at(2.5, 0, -6, Math.PI / 2), 2);                        // yaw pi/2 faces +x
    expect(s.pos[0]).toBeGreaterThan(4.3);
    expect(s.pos[1]).toBeCloseTo(-1, 6);
    s.yaw = -Math.PI / 2;
    walk(s, 2);
    expect(s.pos[0]).toBeCloseTo(4 + PLAYER.radius, 2);
  });
  it('is stopped by the column (a hole in A)', () => {
    const s = walk(at(0, 0, -1.5), 2);
    expect(s.pos[2]).toBeCloseTo(-3 + PLAYER.radius, 2);
  });
  it('eases the eye up a step instead of snapping', () => {
    const s = at(2.5, 0, -7.7);
    let first = NaN;
    for (let i = 0; i < 30; i++) {
      stepPlayer(s, { x: 0, z: 1, jump: false }, 1 / 60, [], ground());
      if (Number.isNaN(first) && s.pos[1] > 0.4) first = eyeOf(s)[1];
    }
    expect(first).toBeLessThan(0.5 + PLAYER.eye - 0.2);                    // the eye lags the feet on the frame they rise
    expect(eyeOf(s)[1]).toBeCloseTo(0.5 + PLAYER.eye, 6);                  // and has caught up a few frames later
  });
});

describe('stepPlayer on flat ground (room levels) is unchanged', () => {
  it('stands at y = 0 with the eye at PLAYER.eye and no lag', () => {
    const s = walk(at(0, 0, 0), 1, FLAT_GROUND as never);
    expect(s.pos[1]).toBe(0);
    expect(eyeOf(s)[1]).toBe(PLAYER.eye);
    expect(s.stepLag ?? 0).toBe(0);
  });
  it('the default ground is flat', () => {
    const s = at(0, 0, 0);
    for (let t = 0; t < 1; t += 1 / 60) stepPlayer(s, { x: 0, z: 1, jump: false }, 1 / 60, []);
    expect(s.pos[1]).toBe(0);
    expect(s.pos[2]).toBeLessThan(-2);
  });
});
```

(`walk` with `FLAT_GROUND as never` keeps the helper's default sector ground type simple.)

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-player.test.ts`
Expected: FAIL — `resolveSegments` is not exported.

- [ ] **Step 3: Edit `game-player.ts`**

Header comment: after the `// can hit (spawned overlapping, or a dt so large it tunneled).` paragraph add:

```ts
//
// On a sector level (spec 2026-10-24-doom-sector-levels-design.md §6.2) the floor and ceiling
// come from a LevelGround and its blocking wall lines push the body's circle in x/z. Room levels
// pass FLAT_GROUND (floor 0, no lines), which is exactly the old y = 0 floor.
```

Imports:

```ts
import type { Vec3 } from '../types';
import type { Aabb } from './game-level';
import { FLAT_GROUND, type LevelGround, type WallSeg } from './level-ground';
```

`PlayerState` gains, after `grounded: boolean;`:

```ts
  /** Metres the eye trails the feet after a step up; eases back to 0 (eyeOf). Absent = 0. */
  stepLag?: number;
```

After `PLAYER` add:

```ts
/** How fast the eye catches up after a step up, m/s (0.75 m in about 0.12 s). */
const STEP_EASE_MPS = 6;
/** Rises smaller than this are settling, not steps (no eye lag). */
const STEP_MIN_M = 0.01;
/** Extra reach when asking for nearby wall lines, beyond the radius. */
const SEG_QUERY_PAD_M = 0.25;
```

Add after `resolveCapsule`:

```ts
/** Push a circle of radius r at pos (x, z) off every segment, in place. Returns the total push in
 *  x/z, or null when nothing touched. Two passes, as resolveCapsule. */
export function resolveSegments(pos: Mut3, segs: readonly WallSeg[], r: number): [number, number] | null {
  let px = 0, pz = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const g of segs) {
      const ex = g.bx - g.ax, ez = g.bz - g.az;
      const len2 = ex * ex + ez * ez;
      if (len2 < 1e-12) continue;
      const t = clamp(((pos[0] - g.ax) * ex + (pos[2] - g.az) * ez) / len2, 0, 1);
      let dx = pos[0] - (g.ax + ex * t), dz = pos[2] - (g.az + ez * t);
      const d = Math.hypot(dx, dz);
      if (d >= r) continue;
      if (d < 1e-9) { const n = Math.sqrt(len2); dx = -ez / n; dz = ex / n; } else { dx /= d; dz /= d; }
      const k = r - d;
      pos[0] += dx * k; pos[2] += dz * k;
      px += dx * k; pz += dz * k;
    }
  }
  return px !== 0 || pz !== 0 ? [px, pz] : null;
}

/** Remove the velocity component going INTO a push, so walls don't pump speed. */
function killInto(vel: Mut3, push: Mut3): void {
  const len = Math.hypot(push[0], push[1], push[2]);
  if (len <= 1e-9) return;
  const n: Mut3 = [push[0] / len, push[1] / len, push[2] / len];
  const into = vel[0] * n[0] + vel[1] * n[1] + vel[2] * n[2];
  if (into < 0) { vel[0] -= n[0] * into; vel[1] -= n[1] * into; vel[2] -= n[2] * into; }
}
```

`stepPlayer`: the doc comment's first line becomes
`* One movement step: intent -> horizontal velocity (ground friction /`
`* acceleration), gravity, integrate, collide with the ground's walls and floor, then the colliders.`;
the signature gains the ground:

```ts
export function stepPlayer(
  s: PlayerState,
  input: MoveInput,
  dt: number,
  colliders: readonly Aabb[],
  ground: LevelGround = FLAT_GROUND,
): PlayerState {
```

Replace from `  s.pos[0] += s.vel[0] * dtc;` through the end of the `// The floor plane.` if/else block with:

```ts
  const fromX = s.pos[0], fromY = s.pos[1], fromZ = s.pos[2];
  const wasGrounded = s.grounded;
  s.pos[0] += s.vel[0] * dtc;
  s.pos[1] += s.vel[1] * dtc;
  s.pos[2] += s.vel[2] * dtc;

  // Wall lines that block at these feet (none on flat ground).
  const segPush = resolveSegments(
    s.pos, ground.blockingNear(s.pos[0], s.pos[2], PLAYER.radius + SEG_QUERY_PAD_M, s.pos[1]), PLAYER.radius);
  if (segPush) killInto(s.vel, [segPush[0], 0, segPush[1]]);

  // The floor under the feet: y = 0 on flat ground, the sector's floor on a sector level. Off every
  // sector (a corner squeeze past a line end) undo the move in x/z.
  let floor = ground.floorAt(s.pos[0], s.pos[2]);
  if (Number.isNaN(floor)) {
    s.pos[0] = fromX; s.pos[2] = fromZ;
    floor = ground.floorAt(fromX, fromZ);
    if (Number.isNaN(floor)) floor = fromY;
  }
  if (s.pos[1] <= floor) {
    const rise = floor - fromY;
    if (wasGrounded && rise > STEP_MIN_M) s.stepLag = (s.stepLag ?? 0) - rise;
    s.pos[1] = floor;
    if (s.vel[1] < 0) s.vel[1] = 0;
    s.grounded = true;
  } else {
    s.grounded = false;
  }
  const ceil = ground.ceilAt(s.pos[0], s.pos[2]);
  if (s.pos[1] + PLAYER.height > ceil) {
    s.pos[1] = Math.max(floor, ceil - PLAYER.height);
    if (s.vel[1] > 0) s.vel[1] = 0;
  }
  if (s.stepLag) s.stepLag = Math.min(0, s.stepLag + STEP_EASE_MPS * dtc);
```

Leave the AABB block (`const before: Mut3 = ...` to `return s;`) as it is.

`eyeOf`:

```ts
/** Eye position for the camera; trails the feet briefly after a step up. */
export function eyeOf(s: PlayerState): Vec3 {
  return [s.pos[0], s.pos[1] + PLAYER.eye + (s.stepLag ?? 0), s.pos[2]];
}
```

On flat ground `fromY` is 0 while grounded, so `rise` is 0 and `stepLag` never becomes non-zero:
the ring, Night Train and Wake keep the exact old numbers.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-player.test.ts`
Expected: PASS (9 tests). If "drops into the pit" fails on the climb back, print `s.pos` — the
D→A line must block at feet −1 (rise 1.0 > 0.75).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lab/sdf-zombie/webgpu/game-player.ts src/lab/sdf-zombie/webgpu/game-player.test.ts
git commit -m "feat(player): 2.5D collision on sector ground; the eye eases up steps"
```

---

## Task 4: Sector geometry (polygons and wall quads)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/sector-geometry.ts`
- Test: `src/lab/sdf-zombie/webgpu/sector-geometry.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/sector-geometry.test.ts
//
// Spec §6.4: floors/ceilings as polygons with holes, walls as quads facing into their sector.

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loopArea, sectorPolygons, wallQuads } from './sector-geometry';
import { buildSectorGround } from './sector-ground';
import { parseSectorLevel } from './sector-json';

const map = () => parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'))).sectors!;

describe('sectorPolygons', () => {
  const polys = sectorPolygons(map());
  it('gives one polygon per sector here', () => {
    expect(polys.map(p => p.sector)).toEqual([0, 1, 2, 3]);
  });
  it('finds the column as a hole in A', () => {
    const a = polys.find(p => p.sector === 0)!;
    expect(Math.abs(loopArea(a.outer))).toBeCloseTo(64, 6);
    expect(a.holes).toHaveLength(1);
    expect(Math.abs(loopArea(a.holes[0]!))).toBeCloseTo(4, 6);
  });
  it('B has no holes and the right area', () => {
    const b = polys.find(p => p.sector === 1)!;
    expect(b.holes).toHaveLength(0);
    expect(Math.abs(loopArea(b.outer))).toBeCloseTo(32, 6);
  });
});

describe('wallQuads', () => {
  const m = map();
  const quads = wallQuads(m, buildSectorGround(m).sectorAt);
  it('makes full-height walls for one-sided lines', () => {
    const north = quads.find(q => q.a[1] === 0 && q.b[1] === 0 && q.sector === 0)!;   // line 0-1 at z = 0
    expect([north.y0, north.y1, north.part]).toEqual([0, 4, 'mid']);
  });
  it('makes the step riser between A and B, seen from A', () => {
    const riser = quads.find(q => q.a[1] === -8 && q.b[1] === -8 && q.part === 'lower')!;
    expect([riser.y0, riser.y1, riser.sector]).toEqual([0, 0.5, 0]);
  });
  it('makes the pit wall between A and D, seen from D', () => {
    const pit = quads.find(q => q.a[0] === 4 && q.b[0] === 4 && q.part === 'lower')!;
    expect([pit.y0, pit.y1, pit.sector]).toEqual([-1, 0, 3]);
  });
  it('makes no quad where both sides match', () => {
    expect(quads.some(q => q.a[0] === 4 && q.b[0] === 4 && q.part === 'upper')).toBe(false);
  });
  it('faces every quad into its sector (left of a -> b)', () => {
    const g = buildSectorGround(m);
    for (const q of quads) {
      const mx = (q.a[0] + q.b[0]) / 2, mz = (q.a[1] + q.b[1]) / 2;
      const dx = q.b[0] - q.a[0], dz = q.b[1] - q.a[1], n = Math.hypot(dx, dz);
      expect(g.sectorAt(mx + (-dz / n) * 0.05, mz + (dx / n) * 0.05)).toBe(q.sector);
    }
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sector-geometry.test.ts`
Expected: FAIL — `Cannot find module './sector-geometry'`.

- [ ] **Step 3: Write `sector-geometry.ts`**

```ts
// src/lab/sdf-zombie/webgpu/sector-geometry.ts
//
// SECTOR GEOMETRY as plain data (spec 2026-10-24-doom-sector-levels-design.md §6.4): each sector's
// boundary as loops (outer polygons and their holes) for triangulating floors and ceilings, and
// one quad per visible wall part, oriented so its face points into the sector it is seen from
// (the face normal is the LEFT of a -> b in x/z). Triangulation itself is the renderer's (earcut,
// via three's ShapeUtils in game-sector-mesh.ts; earcutr in the Rust port).
//
// Pure: no three.js, no DOM.

import { SKY_MATERIAL, type SectorMap, type XZ } from './sector-def';

export interface SectorPolygon { sector: number; outer: XZ[]; holes: XZ[][] }
export type WallPart = 'mid' | 'lower' | 'upper';
export interface WallQuad { a: XZ; b: XZ; y0: number; y1: number; sector: number; part: WallPart }

/** Signed shoelace area in x/z. */
export function loopArea(loop: readonly XZ[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, z0] = loop[i]!, [x1, z1] = loop[(i + 1) % loop.length]!;
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

function pointInLoop(x: number, z: number, loop: readonly XZ[]): boolean {
  let odd = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [ax, az] = loop[i]!, [bx, bz] = loop[j]!;
    if ((az > z) !== (bz > z) && x < ax + ((z - az) * (bx - ax)) / (bz - az)) odd = !odd;
  }
  return odd;
}

/** The closed vertex loops bounding one sector. Edges are chained without direction; at a vertex
 *  with several unused edges the first in line order is taken (Doom maps rarely pinch). */
function sectorLoops(map: SectorMap, sector: number): XZ[][] {
  const edges = map.lines.filter(l => l.front !== l.back && (l.front === sector || l.back === sector)).map(l => l.v);
  const used = new Array<boolean>(edges.length).fill(false);
  const loops: XZ[][] = [];
  for (let start = 0; start < edges.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    const first = edges[start]![0];
    const loop: number[] = [first];
    let cur = edges[start]![1];
    while (cur !== first) {
      loop.push(cur);
      const next = edges.findIndex((e, i) => !used[i] && (e[0] === cur || e[1] === cur));
      if (next < 0) break;                                          // open: the parser refuses this
      used[next] = true;
      cur = edges[next]![0] === cur ? edges[next]![1] : edges[next]![0];
    }
    if (loop.length >= 3) loops.push(loop.map(vi => map.vertices[vi]!));
  }
  return loops;
}

/** Every sector as outer polygons with their holes: a loop nested inside an odd number of the
 *  sector's other loops is a hole of the smallest loop that holds it. */
export function sectorPolygons(map: SectorMap): SectorPolygon[] {
  const out: SectorPolygon[] = [];
  map.sectors.forEach((_, sector) => {
    const loops = sectorLoops(map, sector);
    const probe = (l: XZ[]): [number, number] => [(l[0]![0] + l[1]![0]) / 2, (l[0]![1] + l[1]![1]) / 2];
    const holders = loops.map((l, i) => {
      const [px, pz] = probe(l);
      return loops.map((o, k) => k).filter(k => k !== i && pointInLoop(px, pz, loops[k]!));
    });
    const outers = loops.map((_, i) => i).filter(i => holders[i]!.length % 2 === 0);
    const polys = outers.map(i => ({ sector, outer: loops[i]!, holes: [] as XZ[][] }));
    loops.forEach((l, i) => {
      if (holders[i]!.length % 2 === 0) return;
      const owner = holders[i]!.filter(k => outers.includes(k))
        .sort((p, q) => Math.abs(loopArea(loops[p]!)) - Math.abs(loopArea(loops[q]!)))[0];
      if (owner !== undefined) polys[outers.indexOf(owner)]!.holes.push(l);
    });
    out.push(...polys);
  });
  return out;
}

/** Wall quads: one-sided lines full height; two-sided lines a lower riser (seen from the lower
 *  floor) and an upper lip (seen from the higher ceiling, skipped when both ceilings are sky).
 *  `sectorAt` orients each quad into its sector. */
export function wallQuads(map: SectorMap, sectorAt: (x: number, z: number) => number): WallQuad[] {
  const out: WallQuad[] = [];
  const push = (a: XZ, b: XZ, y0: number, y1: number, sector: number, part: WallPart) => {
    if (y1 - y0 < 1e-4) return;
    const dx = b[0] - a[0], dz = b[1] - a[1], n = Math.hypot(dx, dz);
    const mx = (a[0] + b[0]) / 2 + (-dz / n) * 0.05, mz = (a[1] + b[1]) / 2 + (dx / n) * 0.05;
    out.push(sectorAt(mx, mz) === sector ? { a, b, y0, y1, sector, part } : { a: b, b: a, y0, y1, sector, part });
  };
  for (const l of map.lines) {
    const a = map.vertices[l.v[0]]!, b = map.vertices[l.v[1]]!;
    const f = map.sectors[l.front]!;
    if (l.back < 0) { push(a, b, f.floor, f.ceil, l.front, 'mid'); continue; }
    if (l.back === l.front) continue;
    const k = map.sectors[l.back]!;
    if (f.floor !== k.floor) {
      const low = f.floor < k.floor ? l.front : l.back;
      push(a, b, Math.min(f.floor, k.floor), Math.max(f.floor, k.floor), low, 'lower');
    }
    if (f.ceil !== k.ceil && !(f.materials.ceil === SKY_MATERIAL && k.materials.ceil === SKY_MATERIAL)) {
      const high = f.ceil > k.ceil ? l.front : l.back;
      push(a, b, Math.min(f.ceil, k.ceil), Math.max(f.ceil, k.ceil), high, 'upper');
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sector-geometry.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/sector-geometry.ts src/lab/sdf-zombie/webgpu/sector-geometry.test.ts
git commit -m "feat(levels): sector polygons with holes and oriented wall quads"
```

---

## Task 5: Wire sector levels into the game

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-sector-mesh.ts`
- Modify: `src/lab/sdf-zombie/webgpu/active-level.ts`, `src/lab/sdf-zombie/webgpu/game-tick.ts:223`,
  `src/lab/sdf-zombie/webgpu/game-main.ts:594-597` and before `:767`,
  `src/lab/sdf-zombie/webgpu/game-seams-world.ts:660`
- Test: `src/lab/sdf-zombie/webgpu/active-level.test.ts` (create if absent; else add a describe)

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/active-level.test.ts  (add this describe; keep any existing ones)
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authoredLevel, ENGINE_CAPABILITIES, missingCapabilities, ringLevel, sectorActiveLevel } from './active-level';
import { FLAT_GROUND } from './level-ground';
import { parseLevelJson } from './level-json';
import { parseSectorLevel } from './sector-json';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

describe('sectorActiveLevel', () => {
  const def = parseSectorLevel(read('public/assets/levels/fixtures/sectors.level.json'));
  const L = sectorActiveLevel(def);
  it('is loadable by the engine', () => expect(missingCapabilities(def, ENGINE_CAPABILITIES)).toEqual([]));
  it('answers keyAt from the sector under the point', () => {
    expect(L.keyAt(0, -1)).toBe('zone-0');
    expect(L.keyAt(6, -4)).toBe('zone-1');
    expect(L.keyAt(0, -4)).toBe('void');                                // the column
  });
  it('has sector ground and no room walls in its colliders', () => {
    expect(L.ground.floorAt(0, -10)).toBe(0.5);
    expect(L.staticColliders).toEqual([]);
  });
  it('room levels and the ring stand on flat ground', () => {
    expect(ringLevel().ground).toBe(FLAT_GROUND);
    expect(authoredLevel(parseLevelJson(read('public/assets/levels/fixtures/two-rooms.level.json'))).ground).toBe(FLAT_GROUND);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/active-level.test.ts`
Expected: FAIL — `sectorActiveLevel` is not exported.

- [ ] **Step 3: Edit `active-level.ts`**

Imports, add:

```ts
import { FLAT_GROUND, type LevelGround } from './level-ground';
import { zoneName } from './sector-def';
import { buildSectorGround } from './sector-ground';
```

`ENGINE_CAPABILITIES` (line 23) becomes:

```ts
export const ENGINE_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>(['windows', 'open-sky', 'void', 'portals', 'art', 'sectors']);
```

In `interface ActiveLevel`, after `portals`:

```ts
  /** What bodies stand on (level-ground.ts): FLAT_GROUND for the ring and room levels. */
  ground: LevelGround;
```

Add `ground: FLAT_GROUND,` to the object returned by `ringLevel()` and by `authoredLevel(def)`
(after `portals`). Then add at the end of the file:

```ts
/** A sector level (spec 2026-10-24 §6): the sectors are its ground and its walls; its zone rooms
 *  carry lighting, probes and keys but no wall colliders (only the level's box solids collide). */
export function sectorActiveLevel(def: LevelDef): ActiveLevel {
  const map = def.sectors;
  if (!map) throw new Error(`level ${def.id}: not a sector level`);
  const ground = buildSectorGround(map);
  return {
    ...authoredLevel(def),
    staticColliders: layoutColliders({ ...def, rooms: [], tunnels: [] }),
    keyAt: (x, z) => {
      const s = ground.sectorAt(x, z);
      return s < 0 ? 'void' : zoneName(map.sectors[s]!.zone);
    },
    ground,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/active-level.test.ts`
Expected: PASS.

- [ ] **Step 5: Pass the ground to the player — `game-tick.ts:223`**

```ts
  stepPlayer(ctx.player.player, input, dt, [...ctx.world.colliders, ...zombieBoxes], ctx.world.level.ground);
```

- [ ] **Step 6: Write `game-sector-mesh.ts`**

```ts
// src/lab/sdf-zombie/webgpu/game-sector-mesh.ts
//
// SECTOR LEVEL MESHES (spec 2026-10-24-doom-sector-levels-design.md §6.4): floors, ceilings and
// walls from sector-geometry.ts, merged into one mesh per zone and role, room-tagged like level art
// so the per-room light lists light them, and wearing the stone set's materials with WORLD-space
// UVs (one texture tile per TILE_M metres) so the pattern runs on across every wall and floor.
// Sky ceilings are not drawn.

import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import { SKY_MATERIAL, type SectorMap, type XZ } from './sector-def';
import { sectorPolygons, wallQuads } from './sector-geometry';
import type { SectorGround } from './sector-ground';

const TILE_M = 2;
type Role = 'floor' | 'ceil' | 'wall';

class Batch {
  pos: number[] = []; uv: number[] = []; nrm: number[] = [];
  /** One triangle; flipped if its normal disagrees with `want`. */
  tri(p: number[][], uv: number[][], want: [number, number, number]) {
    const [a, b, c] = p as [number[], number[], number[]];
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const order = n[0]! * want[0] + n[1]! * want[1] + n[2]! * want[2] >= 0 ? [0, 1, 2] : [0, 2, 1];
    for (const i of order) { this.pos.push(...p[i]!); this.uv.push(...uv[i]!); this.nrm.push(...want); }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** A clone of a stone material whose textures repeat once per UV unit (the UVs are world/TILE_M). */
function worldTiled(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = base.clone();
  for (const k of ['map', 'normalMap', 'roughnessMap'] as const) {
    const t = m[k];
    if (!t) continue;
    const c = t.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(1, 1);
    c.needsUpdate = true;
    m[k] = c;
  }
  return m;
}

export function addSectorMeshes(ctx: GameContext, map: SectorMap, ground: SectorGround): number {
  const batches = new Map<string, Batch>();
  const batch = (zone: number, role: Role) => {
    const key = `${zone}:${role}`;
    let b = batches.get(key);
    if (!b) batches.set(key, (b = new Batch()));
    return b;
  };

  for (const poly of sectorPolygons(map)) {
    const s = map.sectors[poly.sector]!;
    const contour = poly.outer.map(([x, z]) => new THREE.Vector2(x, z));
    const holes = poly.holes.map(h => h.map(([x, z]) => new THREE.Vector2(x, z)));
    const pts: XZ[] = [...poly.outer, ...poly.holes.flat()];
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    for (const [role, y, want] of [['floor', s.floor, [0, 1, 0]], ['ceil', s.ceil, [0, -1, 0]]] as const) {
      if (role === 'ceil' && s.materials.ceil === SKY_MATERIAL) continue;
      const b = batch(s.zone, role);
      for (const f of faces) {
        const p = f.map(i => [pts[i]![0], y, pts[i]![1]]);
        b.tri(p, f.map(i => [pts[i]![0] / TILE_M, pts[i]![1] / TILE_M]), want as [number, number, number]);
      }
    }
  }

  for (const q of wallQuads(map, ground.sectorAt)) {
    const zone = map.sectors[q.sector]!.zone;
    const dx = q.b[0] - q.a[0], dz = q.b[1] - q.a[1], len = Math.hypot(dx, dz);
    const want: [number, number, number] = [-dz / len, 0, dx / len];
    const a0 = [q.a[0], q.y0, q.a[1]], b0 = [q.b[0], q.y0, q.b[1]];
    const b1 = [q.b[0], q.y1, q.b[1]], a1 = [q.a[0], q.y1, q.a[1]];
    const u0 = 0, u1 = len / TILE_M, v0 = q.y0 / TILE_M, v1 = q.y1 / TILE_M;
    const b = batch(zone, 'wall');
    b.tri([a0, b0, b1], [[u0, v0], [u1, v0], [u1, v1]], want);
    b.tri([a0, b1, a1], [[u0, v0], [u1, v1], [u0, v1]], want);
  }

  const P = ctx.world.level.def!.palette;
  const mats: Record<Role, THREE.MeshStandardMaterial> = {
    floor: worldTiled(ctx.world.stoneSet.floor as THREE.MeshStandardMaterial),
    ceil: worldTiled(ctx.world.stoneSet.perimeterAccent as THREE.MeshStandardMaterial),
    wall: worldTiled(ctx.world.stoneSet.wall as THREE.MeshStandardMaterial),
  };
  mats.floor.color = new THREE.Color(...P.floor);
  mats.ceil.color = new THREE.Color(...P.ceil);
  // The ceilings' whisper of self-light, as the plane path in game-main gives generated ceilings.
  mats.ceil.emissive = new THREE.Color(...P.ceil).multiplyScalar(0.10);
  mats.wall.color = new THREE.Color(...P.wall);

  for (const [key, b] of batches) {
    const [zone, role] = key.split(':') as [string, Role];
    const mesh = new THREE.Mesh(b.geometry(), mats[role]);
    mesh.name = `sector-${role}-zone-${zone}`;
    mesh.userData.room = Number(zone) + 1;                       // the zone's synthesized room id
    ctx.world.levelGroup.add(mesh);
  }
  return batches.size;
}
```

If `ctx.world.stoneSet` members are typed as `THREE.Material`, the casts above match how
`game-main.ts:715` already treats them.

- [ ] **Step 7: Wire `game-main.ts`**

Imports (beside the `active-level` import at line 101):

```ts
import { ENGINE_CAPABILITIES, authoredLevel, missingCapabilities, ringLevel, sectorActiveLevel } from './active-level';
import { parseLevel } from './sector-json';
import { addSectorMeshes } from './game-sector-mesh';
import type { SectorGround } from './sector-ground';
```

Remove `parseLevelJson` from its import if nothing else in the file uses it (`grep -n parseLevelJson`).
Lines 594–597 become:

```ts
      const def = parseLevel(await res.json(), { state: q.get('state') ?? undefined });
      const missing = missingCapabilities(def, ENGINE_CAPABILITIES);
      if (missing.length > 0) throw new Error(`level ${def.id} needs engine support for: ${missing.join(', ')}`);
      ctx.world.level = def.sectors ? sectorActiveLevel(def) : authoredLevel(def);
```

Directly before line 767 (`if (ctx.world.artScene && ...) placeLevelArt(...)`):

```ts
  // Sector levels (spec 2026-10-24 §6.4): floors, ceilings and walls from the sectors.
  if (ctx.world.level.def?.sectors) {
    addSectorMeshes(ctx, ctx.world.level.def.sectors, ctx.world.level.ground as SectorGround);
  }
```

- [ ] **Step 8: Seams — `game-seams-world.ts:660`**

In `level: () => ({ ... })` add `geometry: ctx.world.level.def?.sectors ? 'sectors' : 'rooms',`.
Beside it add:

```ts
    /** The ground under (x, z): floor and ceiling heights (NaN outside every sector). */
    ground: (x: number, z: number) => ({ floor: ctx.world.level.ground.floorAt(x, z), ceil: ctx.world.level.ground.ceilAt(x, z) }),
```

If the seams object has a declared interface, add both members there too (`grep -n "level:" game-seams-world.ts`).

- [ ] **Step 9: Typecheck and the changed tests**

```bash
npm run typecheck
npm run test:changed
npm test -- game-context-coverage
```

Expected: all pass.

- [ ] **Step 10: Boot the fixture headless**

Write Task 7 Steps 1–2 (the gate) now and run only its fixture section:

```bash
LAB_TMP=.lab-tmp DOOM_GATE_ONLY_FIXTURE=1 bash scripts/sdf-game-doom-gate.sh
```

Expected: boot reaches `__warmGate.phase === 'ready'` with `geometry` `sectors`, and the four
fixture walks pass. A failing walk with passing unit tests means the wiring is wrong (the ground
not passed in game-tick, or `sectorActiveLevel` not chosen in game-main); check those first.

- [ ] **Step 11: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/active-level.ts src/lab/sdf-zombie/webgpu/active-level.test.ts src/lab/sdf-zombie/webgpu/game-sector-mesh.ts src/lab/sdf-zombie/webgpu/game-tick.ts src/lab/sdf-zombie/webgpu/game-main.ts src/lab/sdf-zombie/webgpu/game-seams-world.ts
git commit -m "feat(levels): load and draw sector levels; the player stands on their ground"
```

---

## Task 6: The WAD converter

**Files:**
- Create: `scripts/levels/doom_tables.py`, `scripts/levels/doom_map.py`, `scripts/tests/test_doom_map.py`
- Modify: `.gitignore`, `package.json`

- [ ] **Step 1: Write `doom_tables.py`**

```python
"""Doom names and numbers -> Blud sector-level names (spec 2026-10-24-doom-sector-levels-design.md §5).

Committed: these are our names for Doom's categories, not Doom data. No texture name from a WAD
appears in a generated level; it is mapped to one of ours here.
"""
from __future__ import annotations

SKY_FLAT = "F_SKY1"

# (prefix, ours), first match wins.
FLAT_FAMILIES = [
    ("F_SKY", "sky"), ("NUKAGE", "nukage"), ("LAVA", "lava"), ("SLIME", "acid"), ("FWATER", "acid"),
    ("BLOOD", "acid"), ("FLOOR", "metal-plate"), ("FLAT", "tile"), ("CEIL", "concrete"),
    ("TLITE", "light-panel"), ("GRNLITE", "light-panel"), ("STEP", "metal-plate"), ("DEM", "tile"),
]
TEXTURE_FAMILIES = [
    ("STAR", "tech"), ("TEK", "tech"), ("COMP", "tech"), ("BROWN", "rust"), ("BRN", "rust"),
    ("DOOR", "door"), ("EXIT", "door"), ("SUPPORT", "metal"), ("METAL", "metal"), ("LITE", "light-panel"),
    ("STONE", "concrete"), ("GRAY", "concrete"), ("ICKW", "concrete"), ("PIPE", "metal"), ("SW1", "tech"),
]
GLOW_MATERIALS = {"nukage", "lava", "acid"}

# Linedef specials: manual doors (locked ones treated as plain in step 1-2: E1M1 has none) and exits.
DOOR_SPECIALS = {1, 26, 27, 28, 31, 32, 33, 34, 117, 118}
EXIT_SPECIALS = {11, 51, 52, 124}

# Sector types -> (special, hurtPerSec). Doom hurts every 32 tics (~0.91 s); we use per second.
SECTOR_TYPES = {
    1: ("flicker", 0), 2: ("strobe", 0), 3: ("strobe", 0), 4: ("hurt", 20), 5: ("hurt", 10),
    7: ("hurt", 5), 8: ("pulse", 0), 12: ("strobe", 0), 13: ("strobe", 0), 16: ("hurt", 20), 17: ("flicker", 0),
}


def _family(name: str, table: list[tuple[str, str]], default: str) -> str:
    for prefix, ours in table:
        if name.startswith(prefix):
            return ours
    return default


def material_for_flat(name: str) -> str:
    return _family(name.upper(), FLAT_FAMILIES, "concrete")


def material_for_texture(name: str) -> str:
    return _family(name.upper(), TEXTURE_FAMILIES, "tech")


def sector_special(kind: int) -> tuple[str, float]:
    return SECTOR_TYPES.get(kind, ("none", 0))
```

- [ ] **Step 2: Write the failing tests `scripts/tests/test_doom_map.py`**

The test builds a tiny WAD in memory: two sectors side by side (A 256×256 at floor 0, B 128×256 at
floor 16, a step), a door sector is not needed here (doors are plan 2); the player start in A.

```python
"""Tests for scripts/levels/doom_map.py on a WAD built in the test (no id data)."""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "levels"))
import doom_map  # noqa: E402


def name8(s: str) -> bytes:
    return s.encode("ascii").ljust(8, b"\0")


def build_wad() -> bytes:
    # A: x 0..256, y 0..256 floor 0 ceil 128; B: x 256..384, y 0..256 floor 16 ceil 128 (F_SKY1 ceiling).
    verts = [(0, 0), (256, 0), (256, 256), (0, 256), (384, 0), (384, 256)]
    sectors = [(0, 128, "FLOOR4_8", "CEIL3_5", 160, 0, 0), (16, 128, "NUKAGE1", "F_SKY1", 255, 7, 0)]
    sides = [(0, 0, "-", "-", "STARTAN3", 0),   # 0 A walls
             (0, 0, "-", "STEP6", "-", 0),      # 1 A side of the step line
             (0, 0, "-", "-", "-", 1),          # 2 B side of the step line
             (0, 0, "-", "-", "BROWN1", 1)]     # 3 B walls
    # (v1, v2, flags, special, tag, right, left)
    lines = [(0, 1, 1, 0, 0, 0, 0xFFFF), (1, 2, 4, 0, 0, 1, 2), (2, 3, 1, 0, 0, 0, 0xFFFF), (3, 0, 1, 0, 0, 0, 0xFFFF),
             (1, 4, 1, 0, 0, 3, 0xFFFF), (4, 5, 1, 0, 0, 3, 0xFFFF), (5, 2, 1, 0, 0, 3, 0xFFFF)]
    things = [(64, 128, 0, 1, 7), (300, 128, 0, 3004, 7)]   # player 1 start facing east; a zombieman (ignored in plan 1)
    lumps = [
        ("E1M1", b""),
        ("THINGS", b"".join(struct.pack("<hhhhh", *t) for t in things)),
        ("LINEDEFS", b"".join(struct.pack("<HHhhhHH", *l) for l in lines)),
        ("SIDEDEFS", b"".join(struct.pack("<hh8s8s8sH", x, y, name8(u), name8(lo), name8(m), s) for x, y, u, lo, m, s in sides)),
        ("VERTEXES", b"".join(struct.pack("<hh", *v) for v in verts)),
        ("SEGS", b""), ("SSECTORS", b""), ("NODES", b""),
        ("SECTORS", b"".join(struct.pack("<hh8s8shhh", f, c, name8(ft), name8(ct), li, sp, tg) for f, c, ft, ct, li, sp, tg in sectors)),
        ("REJECT", b""), ("BLOCKMAP", b""),
    ]
    body = b""
    directory = b""
    offset = 12
    for name, data in lumps:
        directory += struct.pack("<ii8s", offset, len(data), name8(name))
        body += data
        offset += len(data)
    return struct.pack("<4sii", b"PWAD", len(lumps), offset) + body + directory


def convert(tmp_path) -> dict:
    wad = tmp_path / "t.wad"
    wad.write_bytes(build_wad())
    out = doom_map.convert(wad, "E1M1", units_per_m=32)
    json.dumps(out)                                     # serialisable
    return out


def test_scale_and_origin_at_the_start(tmp_path):
    out = convert(tmp_path)
    assert out["geometry"] == "sectors" and out["id"] == "doom-e1m1"
    assert out["start"]["pos"] == [0.0, 0.0, 0.0]
    xs = [v[0] for v in out["vertices"]]
    zs = [v[1] for v in out["vertices"]]
    assert min(xs) == -2.0 and max(xs) == 10.0          # (0 - 64) / 32, (384 - 64) / 32
    assert min(zs) == -4.0 and max(zs) == 4.0           # Doom +y is our -z: -(256 - 128) / 32 .. (128 - 0) / 32


def test_heights_light_specials_materials(tmp_path):
    a, b = convert(tmp_path)["sectors"]
    assert (a["floor"], a["ceil"]) == (0.0, 4.0)
    assert (b["floor"], b["ceil"]) == (0.5, 4.0)
    assert a["light"] == round(160 / 255, 3)
    assert b["special"] == "hurt" and b["hurtPerSec"] == 5
    assert b["glow"] == "nukage" and b["materials"]["ceil"] == "sky"
    assert a["materials"] == {"floor": "metal-plate", "ceil": "concrete", "wall": "tech"}


def test_lines_and_zones(tmp_path):
    out = convert(tmp_path)
    step = [l for l in out["lines"] if l.get("back") is not None]
    assert len(step) == 1 and {step[0]["front"], step[0]["back"]} == {0, 1}
    assert len(out["lines"]) == 7
    assert [s["zone"] for s in out["sectors"]] == [0, 0]   # joined by a non-door line
    assert len(out["lights"]) == 1


def test_yaw_east_is_plus_x(tmp_path):
    import math
    yaw = convert(tmp_path)["start"]["yaw"]
    assert math.isclose(math.sin(yaw), 1.0, abs_tol=1e-9)  # forward = [sin yaw, 0, -cos yaw]
```

- [ ] **Step 3: Run to see it fail**

Run: `python3 -m pytest scripts/tests/test_doom_map.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'doom_map'`.

- [ ] **Step 4: Write `doom_map.py`**

```python
#!/usr/bin/env python3
"""Convert a Doom map from a WAD into a Blud sector level.

    python3 scripts/levels/doom_map.py <wad> E1M1 [--units-per-m 32] [--out public/assets/levels] [--svg .lab-tmp/doom]

Spec: docs/superpowers/specs/2026-10-24-doom-sector-levels-design.md §5. Reads the vanilla map
lumps (VERTEXES, LINEDEFS, SIDEDEFS, SECTORS, THINGS; no BSP). Writes <out>/doom-<map>.level.json.
The output is derived from id Software's data: a dev placeholder, never committed (.gitignore).

Plan 1 writes geometry, zones, one fill light per zone and the player start. Door sectors are
written OPEN (plan 2 makes them move); other things are skipped (plan 5).
"""
from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from doom_tables import (  # noqa: E402
    DOOR_SPECIALS, EXIT_SPECIALS, GLOW_MATERIALS, material_for_flat, material_for_texture, sector_special,
)

MAP_LUMPS = ("THINGS", "LINEDEFS", "SIDEDEFS", "VERTEXES", "SECTORS")
PLAYER1_START = 1
DOOR_OPEN_GAP_UNITS = 4          # Doom: a door opens to 4 units below the lowest neighbouring ceiling
ZONE_SPLIT_M2 = 400.0            # spec §6.5


def _name8(b: bytes) -> str:
    return b.rstrip(b"\0").decode("ascii", "replace").upper()


def read_wad(data: bytes) -> list[tuple[str, bytes]]:
    magic, count, table = struct.unpack_from("<4sii", data, 0)
    if magic not in (b"IWAD", b"PWAD"):
        raise ValueError("not a WAD")
    out = []
    for i in range(count):
        pos, size, raw = struct.unpack_from("<ii8s", data, table + 16 * i)
        out.append((_name8(raw), data[pos:pos + size]))
    return out


def map_lumps(entries: list[tuple[str, bytes]], name: str) -> dict[str, bytes]:
    for i, (n, _) in enumerate(entries):
        if n == name.upper():
            found = {n2: d for n2, d in entries[i + 1:i + 11] if n2 in MAP_LUMPS}
            missing = [k for k in MAP_LUMPS if k not in found]
            if missing:
                raise ValueError(f"{name}: missing lumps {missing}")
            return found
    raise ValueError(f"map {name} not in the WAD")


def parse_map(l: dict[str, bytes]):
    verts = [struct.unpack_from("<hh", l["VERTEXES"], i) for i in range(0, len(l["VERTEXES"]), 4)]
    sectors = []
    for i in range(0, len(l["SECTORS"]), 26):
        fh, ch, ft, ct, light, special, tag = struct.unpack_from("<hh8s8shhh", l["SECTORS"], i)
        sectors.append(dict(floor=fh, ceil=ch, floor_tex=_name8(ft), ceil_tex=_name8(ct), light=light, special=special, tag=tag))
    sides = []
    for i in range(0, len(l["SIDEDEFS"]), 30):
        _, _, up, lo, mid, sec = struct.unpack_from("<hh8s8s8sH", l["SIDEDEFS"], i)
        sides.append(dict(upper=_name8(up), lower=_name8(lo), middle=_name8(mid), sector=sec))
    lines = []
    for i in range(0, len(l["LINEDEFS"]), 14):
        v1, v2, flags, special, tag, right, left = struct.unpack_from("<HHhhhHH", l["LINEDEFS"], i)
        lines.append(dict(v1=v1, v2=v2, special=special, right=right, left=None if left == 0xFFFF else left))
    things = []
    for i in range(0, len(l["THINGS"]), 10):
        x, y, angle, kind, flags = struct.unpack_from("<hhhhh", l["THINGS"], i)
        things.append(dict(x=x, y=y, angle=angle, type=kind, flags=flags))
    return verts, sectors, sides, lines, things


def _sector_at(x: float, y: float, verts, lines, sides, sector: int) -> bool:
    odd = False
    for ln in lines:
        f = sides[ln["right"]]["sector"]
        b = sides[ln["left"]]["sector"] if ln["left"] is not None else None
        if f == b or sector not in (f, b):
            continue
        (ax, ay), (bx, by) = verts[ln["v1"]], verts[ln["v2"]]
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            odd = not odd
    return odd


class _Union:
    def __init__(self, n: int):
        self.p = list(range(n))

    def find(self, a: int) -> int:
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def join(self, a: int, b: int) -> None:
        self.p[self.find(a)] = self.find(b)


def _zones(n_sectors: int, pairs: list[tuple[int, int]], doors: set[int], bbox) -> list[int]:
    """Spec §6.5: sectors joined by lines that touch no door; a door joins its first neighbour;
    a zone whose box is over ZONE_SPLIT_M2 splits at the median along its longer axis."""
    u = _Union(n_sectors)
    for a, b in pairs:
        if a not in doors and b not in doors:
            u.join(a, b)
    for d in sorted(doors):
        nb = sorted({b if a == d else a for a, b in pairs if d in (a, b) and a != b})
        if nb:
            u.join(d, nb[0])
    groups: dict[int, list[int]] = {}
    for s in range(n_sectors):
        groups.setdefault(u.find(s), []).append(s)

    def split(group: list[int]) -> list[list[int]]:
        x0 = min(bbox[s][0] for s in group); x1 = max(bbox[s][2] for s in group)
        z0 = min(bbox[s][1] for s in group); z1 = max(bbox[s][3] for s in group)
        if len(group) < 2 or (x1 - x0) * (z1 - z0) <= ZONE_SPLIT_M2:
            return [group]
        axis = 0 if x1 - x0 >= z1 - z0 else 1
        centre = lambda s: (bbox[s][axis] + bbox[s][axis + 2]) / 2  # noqa: E731
        ordered = sorted(group, key=centre)
        mid = len(ordered) // 2
        return split(ordered[:mid]) + split(ordered[mid:])

    zone_of = [0] * n_sectors
    zone = 0
    for root in sorted(groups, key=lambda r: min(groups[r])):
        for part in split(groups[root]):
            for s in part:
                zone_of[s] = zone
            zone += 1
    return zone_of


def convert(wad_path: Path, map_name: str, units_per_m: float = 32) -> dict:
    verts, sectors, sides, lines, things = parse_map(map_lumps(read_wad(Path(wad_path).read_bytes()), map_name))
    start = next((t for t in things if t["type"] == PLAYER1_START), None)
    if start is None:
        raise ValueError(f"{map_name}: no player 1 start")
    start_sector = next((s for s in range(len(sectors)) if _sector_at(start["x"], start["y"], verts, lines, sides, s)), 0)
    sx, sy, base = start["x"], start["y"], sectors[start_sector]["floor"]
    m = float(units_per_m)
    X = lambda x: round((x - sx) / m, 4)    # noqa: E731
    Z = lambda y: round(-(y - sy) / m, 4)   # noqa: E731  Doom +y is our -z
    H = lambda h: round((h - base) / m, 4)  # noqa: E731

    # Door sectors (a manual door's back side) and their open height.
    pairs = []
    for ln in lines:
        if ln["left"] is not None:
            pairs.append((sides[ln["right"]]["sector"], sides[ln["left"]]["sector"]))
    doors = {sides[ln["left"]]["sector"] for ln in lines if ln["special"] in DOOR_SPECIALS and ln["left"] is not None}
    ceil = {i: s["ceil"] for i, s in enumerate(sectors)}
    for d in doors:
        nb = [b if a == d else a for a, b in pairs if d in (a, b) and a != b]
        if nb:
            ceil[d] = min(sectors[n]["ceil"] for n in nb) - DOOR_OPEN_GAP_UNITS

    # Each sector's wall material: the most common texture on the line sides facing into it.
    faces: dict[int, dict[str, int]] = {}
    for ln in lines:
        for side in (ln["right"], ln["left"]):
            if side is None:
                continue
            sd = sides[side]
            for tex in (sd["middle"], sd["upper"], sd["lower"]):
                if tex and tex != "-":
                    f = faces.setdefault(sd["sector"], {})
                    f[tex] = f.get(tex, 0) + 1

    bbox = {}
    for i in range(len(sectors)):
        pts = [verts[v] for ln in lines for v in (ln["v1"], ln["v2"])
               if i in (sides[ln["right"]]["sector"], sides[ln["left"]]["sector"] if ln["left"] is not None else None)]
        xs = [X(p[0]) for p in pts] or [0.0]
        zs = [Z(p[1]) for p in pts] or [0.0]
        bbox[i] = (min(xs), min(zs), max(xs), max(zs))
    zone_of = _zones(len(sectors), pairs, doors, bbox)

    out_sectors = []
    for i, s in enumerate(sectors):
        special, hurt = sector_special(s["special"])
        floor_mat = material_for_flat(s["floor_tex"])
        wall_tex = max(faces.get(i, {"-": 1}).items(), key=lambda kv: kv[1])[0]
        sec = {
            "floor": H(s["floor"]), "ceil": H(ceil[i]), "light": round(max(0, min(255, s["light"])) / 255, 3),
            "zone": zone_of[i],
            "materials": {"floor": floor_mat, "ceil": material_for_flat(s["ceil_tex"]), "wall": material_for_texture(wall_tex)},
        }
        if special != "none":
            sec["special"] = special
        if hurt:
            sec["hurtPerSec"] = hurt
        if floor_mat in GLOW_MATERIALS:
            sec["glow"] = floor_mat
        out_sectors.append(sec)

    out_lines = []
    for ln in lines:
        rec = {"v": [ln["v1"], ln["v2"]], "front": sides[ln["right"]]["sector"]}
        if ln["left"] is not None:
            rec["back"] = sides[ln["left"]]["sector"]
            if ln["special"] in DOOR_SPECIALS:
                rec["door"] = {"sector": rec["back"]}
        if ln["special"] in EXIT_SPECIALS:
            rec["exit"] = True
        out_lines.append(rec)

    # One soft fill light per zone, at the middle of its biggest sector, 0.4 m under the ceiling.
    lights = []
    for zone in sorted(set(zone_of)):
        members = [i for i in range(len(sectors)) if zone_of[i] == zone]
        big = max(members, key=lambda i: (bbox[i][2] - bbox[i][0]) * (bbox[i][3] - bbox[i][1]))
        cx, cz = (bbox[big][0] + bbox[big][2]) / 2, (bbox[big][1] + bbox[big][3]) / 2
        f, c = out_sectors[big]["floor"], out_sectors[big]["ceil"]
        mean = sum(out_sectors[i]["light"] for i in members) / len(members)
        lights.append({"pos": [round(cx, 3), round(max(f + 1.5, c - 0.4), 3), round(cz, 3)],
                       "color": [1.0, 0.92, 0.82], "power": round(3 + 9 * mean, 2), "fixture": "none"})

    return {
        "version": 1, "id": f"doom-{map_name.lower()}", "name": f"Doom {map_name.upper()} (dev placeholder)",
        "geometry": "sectors", "ammo": "infinite", "loadout": ["melee", "shotgun", "dynamite", "flare"],
        "vertices": [[X(x), Z(y)] for x, y in verts],
        "sectors": out_sectors, "lines": out_lines,
        "start": {"pos": [0.0, 0.0, 0.0], "yaw": round(math.radians(90 - start["angle"]), 6)},
        "lights": lights,
    }


def write_svg(level: dict, path: Path) -> None:
    """Top-down plan for picking waypoints: lines grey (two-sided) / white (walls), zone numbers, the start."""
    vs = level["vertices"]
    x0 = min(v[0] for v in vs); x1 = max(v[0] for v in vs); z0 = min(v[1] for v in vs); z1 = max(v[1] for v in vs)
    s = 12
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0 * s - 20} {z0 * s - 20} {(x1 - x0) * s + 40} {(z1 - z0) * s + 40}" style="background:#111">']
    for ln in level["lines"]:
        (ax, az), (bx, bz) = vs[ln["v"][0]], vs[ln["v"][1]]
        colour = "#c33" if "door" in ln else "#666" if "back" in ln else "#eee"
        parts.append(f'<line x1="{ax * s}" y1="{az * s}" x2="{bx * s}" y2="{bz * s}" stroke="{colour}" stroke-width="1.5"/>')
    for i, li in enumerate(level["lights"]):
        parts.append(f'<text x="{li["pos"][0] * s}" y="{li["pos"][2] * s}" fill="#fc6" font-size="10">z{i}</text>')
    for k in range(int(x0 // 10) * 10, int(x1) + 1, 10):
        parts.append(f'<text x="{k * s}" y="{z0 * s - 6}" fill="#888" font-size="8">x{k}</text>')
    for k in range(int(z0 // 10) * 10, int(z1) + 1, 10):
        parts.append(f'<text x="{x0 * s - 18}" y="{k * s}" fill="#888" font-size="8">z{k}</text>')
    parts.append('<circle cx="0" cy="0" r="5" fill="#3c3"/></svg>')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(parts))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wad", type=Path)
    ap.add_argument("map")
    ap.add_argument("--units-per-m", type=float, default=32)
    ap.add_argument("--out", type=Path, default=Path("public/assets/levels"))
    ap.add_argument("--svg", type=Path, default=None, help="directory for a <MAP>.svg plan (keep it in .lab-tmp/)")
    a = ap.parse_args()
    level = convert(a.wad, a.map, a.units_per_m)
    path = a.out / f"{level['id']}.level.json"
    path.write_text(json.dumps(level, indent=1))
    zones = len({s["zone"] for s in level["sectors"]})
    doors = sum(1 for ln in level["lines"] if "door" in ln)
    print(f"{path}: {len(level['sectors'])} sectors, {len(level['lines'])} lines, {zones} zones, {doors} door lines")
    if a.svg:
        write_svg(level, a.svg / f"{a.map.upper()}.svg")
        print(f"plan: {a.svg / (a.map.upper() + '.svg')}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the tests**

Run: `python3 -m pytest scripts/tests/test_doom_map.py -q`
Expected: 4 passed.

- [ ] **Step 6: Ignore generated Doom levels; add the dev script**

`.gitignore`, beside the other placeholder rules:

```
# Doom maps converted by scripts/levels/doom_map.py: derived from id data, dev placeholders only
public/assets/levels/doom-*.level.json
```

`package.json` scripts, after `dev:arena`:

```json
    "dev:doom": "vite --open /sdf-game.html?level=doom-e1m1",
```

- [ ] **Step 7: Convert E1M1 and check it parses**

```bash
python3 scripts/levels/doom_map.py "$HOME/MIYOO BACKUP/Roms/PORTS/Games/Doom (PrBoom)/doom/doomu.wad" E1M1 --svg .lab-tmp/doom
git status --short public/assets/levels   # must show nothing: the file is ignored
```

Then parse the generated file once from a scratch vitest-free script:

```bash
npx tsx -e "import {readFileSync} from 'node:fs'; import {parseSectorLevel} from './src/lab/sdf-zombie/webgpu/sector-json.ts'; const L = parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/doom-e1m1.level.json','utf8'))); console.log(L.sectors.sectors.length, 'sectors', L.rooms.length, 'zones')"
```

Expected: the converter prints about 80–90 sectors and a handful of door lines; the parse prints
the same sector count with no error. If the parser reports `not closed`, the sector at fault is a
Doom quirk (a line with the same sector on both sides is skipped; a sector touching itself at a
vertex is fine): record the sector index in the notes and fix the converter, not the parser. If
`npx tsx` is unavailable, use `node --experimental-strip-types` with the same code.

- [ ] **Step 8: Commit (no generated files)**

```bash
git add scripts/levels/doom_tables.py scripts/levels/doom_map.py scripts/tests/test_doom_map.py .gitignore package.json
git commit -m "feat(levels): Doom WAD -> sector level converter (generated levels stay local)"
```

---

## Task 7: The gate, the walk, the notes

**Files:**
- Create: `scripts/sdf-game-doom-gate.sh`, `scripts/sdf-game-doom-gate.mjs`,
  `docs/dev-notes/2026-10-24-sector-levels-1/NOTES.md`
- Modify: `docs/tasks/levels.md` (the "Sector levels" section), `TASKS.md` if it lists in-flight work

- [ ] **Step 1: Write `scripts/sdf-game-doom-gate.sh`**

```bash
#!/usr/bin/env bash
# Headless gate for sector levels (docs/superpowers/specs/2026-10-24-doom-sector-levels-design.md):
# the committed fixture always; Doom E1M1 when it has been generated locally (doom_map.py).
# Owns its own vite + Chrome via the shared lifecycle, on its own port pair.
#
# NEVER kill a server you did not start (scripts/lab-servers.sh says why).
# In a sandbox, export LAB_TMP=.lab-tmp or Chrome produces no frames.
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5483}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9483}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game-doom-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
```

- [ ] **Step 2: Write `scripts/sdf-game-doom-gate.mjs`**

Start the file with the header comment and the two `import`/`const OUT` lines from the block
below, then paste lines 11–40 of `scripts/sdf-game-flat-gate.mjs` (from `const VITE` to the
`Emulation.setDeviceMetricsOverride` call: the CDP tab, `send`, `evaluate`, `sleep`, `fail`,
`pass`, `withTimeout`, `consoleEvents`) with the default ports changed to 5483 / 9483 and its own
`OUT` line dropped. Then the rest of the block:

```js
// scripts/sdf-game-doom-gate.mjs — headless gate for sector levels (spec 2026-10-24-doom-sector-levels-design.md).
//   1. FIXTURE boot: webgpu, ready, no errors, geometry 'sectors'.
//   2. FIXTURE walk: up the 0.5 m step, stopped by the 1.0 m ledge, down into the pit, stopped by the column.
//   3. E1M1 (skipped if public/assets/levels/doom-e1m1.level.json is absent): boot, the ROUTE, budget, shots.
// Usage: LAB_TMP=.lab-tmp bash scripts/sdf-game-doom-gate.sh   (DOOM_GATE_ONLY_FIXTURE=1 skips 3; SHOTS=1 writes shots)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
const OUT = '.lab-tmp/doom';

async function boot(level) {
  consoleEvents = [];
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=${level}` });
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) {
    await sleep(500);
    ready = (await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null)) === 'ready';
    if (consoleEvents.some((e) => e.type === 'error' || e.type === 'exception')) break;
  }
  if (!ready) { console.error(consoleEvents.slice(-8)); fail(`${level} did not boot to ready`); }
  if ((await evaluate('__sdfGame.backend')) !== 'webgpu') fail('backend is not webgpu');
  const info = await evaluate('__sdfGame.level()');
  if (info.geometry !== 'sectors') fail(`${level}: geometry ${info.geometry}, expected sectors`);
  pass(`boot: ${level} ready on webgpu, ${info.rooms.length} zones`);
}

/** Walk from `from` toward `to` for `ms`; return the final pose. y is set to the floor there first. */
async function walk(from, to, ms) {
  const floor = (await evaluate(`__sdfGame.ground(${from[0]}, ${from[1]})`)).floor;
  await evaluate(`__sdfGame.setPose(${from[0]}, ${from[1]}, 0, 0, ${floor})`);
  await evaluate(`__sdfGame.walkTo(${to[0]}, ${to[1]})`);
  await sleep(ms);
  const pos = (await evaluate('__sdfGame.pose()')).pos;
  await evaluate('__sdfGame.walkCancel()');
  return pos;
}

// 1–2. THE FIXTURE (see the plan's diagram)
await boot('fixtures/sectors');
let p = await walk([2.5, -6], [2.5, -10], 3000);
if (!(Math.abs(p[1] - 0.5) < 0.02 && p[2] < -8.3)) fail(`step: ended at ${p.map((v) => v.toFixed(2))}, expected on B (y 0.5, z < -8.3)`);
pass('fixture: walked up the 0.5 m step');
p = await walk([2.5, -10], [2.5, -14], 3000);
if (!(p[2] > -12 && Math.abs(p[1] - 0.5) < 0.02)) fail(`ledge: ended at ${p.map((v) => v.toFixed(2))}, expected stopped on B`);
pass(`fixture: stopped ${(p[2] + 12).toFixed(2)} m short of the 1.0 m ledge`);
p = await walk([2.5, -6], [6.5, -6], 3000);
if (!(Math.abs(p[1] + 1) < 0.02 && p[0] > 4.3)) fail(`pit: ended at ${p.map((v) => v.toFixed(2))}, expected in D (y -1)`);
pass('fixture: dropped into the pit');
// The autopilot strafes round a blocker when stuck, so the end pose says nothing: measure the closest approach
// to the column's footprint (x -1..1, z -5..-3) while walking at it, as sdf-game-flat-gate does.
await evaluate('__sdfGame.setPose(0, -1.2, 0, 0, 0)');
await evaluate('__sdfGame.walkTo(0, -6)');
let nearest = Infinity;
for (let i = 0; i < 12; i++) {
  await sleep(250);
  const [px, , pz] = (await evaluate('__sdfGame.pose()')).pos;
  nearest = Math.min(nearest, Math.hypot(Math.max(-1 - px, 0, px - 1), Math.max(-5 - pz, 0, pz + 3)));
}
await evaluate('__sdfGame.walkCancel()');
if (nearest < 0.28) fail(`column: came ${nearest.toFixed(2)} m from it (the radius is 0.32)`);
if (nearest > 0.45) fail(`column: never reached it (closest ${nearest.toFixed(2)} m)`);
pass(`fixture: stopped ${nearest.toFixed(2)} m from the column`);

// 3. E1M1
if (process.env.DOOM_GATE_ONLY_FIXTURE === '1') process.exit(0);
if (!existsSync('public/assets/levels/doom-e1m1.level.json')) {
  console.log('skip E1M1: run scripts/levels/doom_map.py <doomu.wad> E1M1 first');
  process.exit(0);
}
await boot('doom-e1m1');
const start = await evaluate('__sdfGame.ground(0, 0)');
if (start.floor !== 0) fail(`E1M1 start floor ${start.floor}, expected 0`);
// ROUTE: [x, z] waypoints along the main path, read off .lab-tmp/doom/E1M1.svg (Step 3). Each leg
// must end within 0.6 m of its target, standing on the floor the ground reports there.
const ROUTE = JSON.parse(process.env.DOOM_ROUTE ?? '[]');
if (ROUTE.length < 4) fail('E1M1: ROUTE needs at least 4 waypoints (DOOM_ROUTE env, see the plan Task 7 Step 3)');
for (let i = 1; i < ROUTE.length; i++) {
  const q = await walk(ROUTE[i - 1], ROUTE[i], 6000);
  const gap = Math.hypot(q[0] - ROUTE[i][0], q[2] - ROUTE[i][1]);
  const floor = (await evaluate(`__sdfGame.ground(${q[0]}, ${q[2]})`)).floor;
  if (gap > 0.6) fail(`E1M1 leg ${i}: stopped ${gap.toFixed(2)} m short of ${ROUTE[i]}`);
  if (Math.abs(q[1] - floor) > 0.02) fail(`E1M1 leg ${i}: feet ${q[1].toFixed(2)} but floor ${floor}`);
  pass(`E1M1 leg ${i}: reached ${ROUTE[i]} on floor ${floor}`);
}

await evaluate('__sdfGame.setPose(0, 0, 0, 0, 0)');
await sleep(800);
const drawCalls = (await evaluate('__sdfGame.drawStats(true)')).drawCalls;
await evaluate('__sdfGame.timeDraws(15)');
const readings = [];
for (let i = 0; i < 3; i++) readings.push(await evaluate('__sdfGame.timeDraws(21)'));
const frameMs = readings.sort((a, b) => a - b)[1];
console.log(`budget: ${drawCalls} draw calls, ${frameMs.toFixed(2)} ms a frame at the start`);
if (frameMs > 33.3) fail(`frame ${frameMs.toFixed(2)} ms > 33.3 ms`);
pass('E1M1 budget: under 33.3 ms');

if (process.env.SHOTS === '1') {
  mkdirSync(OUT, { recursive: true });
  for (const [i, [x, z]] of [[0, 0], ...ROUTE].entries()) {
    const f = (await evaluate(`__sdfGame.ground(${x}, ${z})`)).floor;
    for (const [k, yaw] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) {
      await evaluate(`__sdfGame.setPose(${x}, ${z}, ${yaw}, 0, ${f})`);
      await sleep(600);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/e1m1-${i}-${k}.png`, Buffer.from(shot.result.data, 'base64'));
    }
  }
  pass(`shots: ${OUT}/e1m1-*.png`);
}
process.exit(0);
```

If `walkCancel`, `drawStats` or `timeDraws` are named differently in this branch, copy the names
from `sdf-game-flat-gate.mjs`, which uses them.

- [ ] **Step 3: Run the fixture, pick the E1M1 route, run everything**

```bash
LAB_TMP=.lab-tmp DOOM_GATE_ONLY_FIXTURE=1 bash scripts/sdf-game-doom-gate.sh
```

Expected: 5 `ok` lines (boot + 4 walks). Then open `.lab-tmp/doom/E1M1.svg` (the green dot is the
start at 0, 0; grid labels every 10 m) and choose 4–6 waypoints along E1M1's main path: out of the
start room, up its steps, across the zigzag walkway over the nukage, into the room beyond. Keep each
leg a straight line that does not cut a wall corner. Then:

```bash
LAB_TMP=.lab-tmp SHOTS=1 DOOM_ROUTE='[[0,0],[x1,z1],[x2,z2],[x3,z3]]' bash scripts/sdf-game-doom-gate.sh
```

Expected: every leg passes, budget under 33.3 ms, shots written. **Look at the shots yourself**:
walls, floors and steps must read as solid, stone-textured, tiled at the same scale everywhere,
no missing walls (black gaps where a wall should be) and no inside-out faces. Record the route in
the notes so the next plan's gate can reuse it.

- [ ] **Step 4: Regression gates for room levels**

```bash
LAB_TMP=.lab-tmp bash scripts/sdf-game-wake-gate.sh
LAB_TMP=.lab-tmp bash scripts/sdf-game-flat-gate.sh
```

Expected: both pass unchanged (the Wake's multi-floor refusal still refuses: `sectors` is a new
capability, `multi-floor` is still unsupported).

- [ ] **Step 5: Write `docs/dev-notes/2026-10-24-sector-levels-1/NOTES.md`**

Include: what was built; the converter's summary line for E1M1 (sectors, lines, zones, door
lines); the E1M1 route used; draw calls and frame ms; the shots looked at (paths only — they are
in `.lab-tmp/`, never committed); and the known gaps (slugs through sector walls; dynamite, gibs
and blood at y = 0; lights choose the first overlapping zone room; loop chaining at pinch vertices
takes the first edge). End with "Owner checkpoint: play `npm run dev:doom` and judge the space."

- [ ] **Step 6: Update the task wiki**

In `docs/tasks/levels.md`, section "Sector levels + the E1M1 experiment", mark item 1 `[x]` with a
link to this plan and the notes, and the line "Owner checkpoint pending: walk it (`npm run dev:doom`)".

- [ ] **Step 7: Commit**

```bash
git add scripts/sdf-game-doom-gate.sh scripts/sdf-game-doom-gate.mjs docs/dev-notes/2026-10-24-sector-levels-1/NOTES.md docs/tasks/levels.md
git commit -m "test(levels): sector level gate — fixture walk, E1M1 route and budget"
```
