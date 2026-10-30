# Sector levels 2 — glowing pools and sector light — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** E1M1's nukage (and any lava/acid) pools glow and hurt, and every sector carries Doom's
own light level — darkened hard, with flicker, pulse and strobe sectors — so the map has Doom's
bright-room / dark-corridor rhythm inside the arena's darkness. `?doomlight=0` flattens it back
to plan 1's look for comparison.

**Spec:** `docs/superpowers/specs/2026-10-24-doom-sector-levels-design.md` — §7 (lighting) and §8
(hazard floors). Plan 1: `docs/superpowers/plans/2026-10-24-sector-levels-1-walk-e1m1.md` and its
notes `docs/dev-notes/2026-10-24-sector-levels-1/NOTES.md` (read the notes' known gaps).

**Architecture:** the decisions are pure and tested: `sector-light.ts` (light level → ambient
fraction on a hard curve; the flicker/pulse/strobe multiplier at sim time t; one Float32Array of
current per-sector levels), `hazard-floor.ts` (whole-point damage on a 1 s accumulator), and a
`sectorInteriorPoint` helper. The renderer only reads them: `game-sector-mesh.ts` gives every
vertex a `sectorIndex` attribute and every mesh its own `MeshStandardNodeMaterial` whose
`emissiveNode` is `albedo × levels[sectorIndex]` (TSL glue over a `uniformArray` refreshed each
tick); glow floors are drawn by a hand-written WGSL surface (`sector-glow.wgsl.ts`) on meshes
outside the level group. The converter adds one cheap (list-tier) light per pool.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest, Python 3 + pytest,
headless-Chrome gate (`scripts/sdf-game-doom-gate.*`).

**Decisions taken in this plan (tell the owner if any feels wrong in play):**
- Sector light is a **self-lit ambient term** (`emissive = albedo × level`), not a scale on the
  probe/ambient light: in this engine the dungeon ambient is ~0.035 and the probes are matched
  per room, so scaling them (`aoNode`) would barely show. The flashlight and fill lights still add
  on top. Curve defaults: `max 0.07`, `gamma 2.2` (Doom 255 → 7 % of albedo, 160 → ~2.6 %).
  Tunable live with `__sdfGame.sectorLight({ max, gamma })`.
- Ceilings on sector levels lose plan 1's fixed 10 % whisper when sector light is on (their sector
  level replaces it); `?doomlight=0` brings plan 1's look back exactly.
- Strobe sectors flash at Doom's rhythm (bright ~0.14 s of each 1 s); with the repo's
  reduced-flashes setting they become a slow pulse instead (no hard cuts).
- Pool lights use `mood: 'fire'` so they take the cheap list tier (about free, ≤ 8 per room) —
  the cost is a gentle fire flicker on the pool's light, which reads as a liquid.
- The spec's "halo up the walls" is the pool light; no extra wall shader (YAGNI).
- Bodies are not darkened per sector yet (no enemies until plan 3; noted there).
- The deferred renderer (`?renderer=deferred`, opt-in) drops custom nodes: sector light and glow
  show in the default forward path only. Noted, not fixed.

**Out of scope:** doors and lifts, enemies/pickups/barrels (plan 3), sound, per-sector body fill.

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests** (no `three` import).
    The renderer-facing module only reads that logic's output and writes uniforms/objects.
  - Rendering that matters goes in **hand-written WGSL** (`*.wgsl.ts` string modules). TSL node
    graphs are for thin glue (binding, blending), not for the effect itself.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module — never as new
    `main()` bindings (`npm test -- game-context-coverage`).
  - Keep the simulation deterministic (seeded RNG, sim-time clocks, no wall-clock in logic).
- Work ONLY in your worktree. Never `git stash`. `node_modules` is symlinked — do not reinstall.
- **Targeted tests only** (`npx vitest run <path>`, or `npm run test:changed`) plus `npm run typecheck`
  (slow, ~2 min: run once per round). Never the full suite locally.
- **Headless capture only** — the in-app browser pane loses the WebGPU device. Capture scripts
  require `window.__warmGate.phase === 'ready'` and fail on renderer pipeline errors.
- **Prove visual and performance claims with a number** and look at the images yourself.
- **Boot time is a gate:** a change that touches shaders or materials reports cold-boot
  `drawOnce` against the base branch (fresh profile each run) — see how `scripts/sdf-game-*-gate`
  scripts or `scripts/frame-cost.mjs` measure it; report the number, don't block on load noise.
- WebGPU: alpha in `colorNode.w`, never `alphaHash`/`alphaTest`. Never toggle a light's
  `.visible`. Never sample the render target you are writing.
- Kill anything you start outside a capture script in the same step. Machine load is often high
  (other sessions): a frame-budget failure at load average > 15 is re-run, not "fixed".
- **Anything derived from the WAD is a dev placeholder**: never commit
  `public/assets/levels/doom-*.level.json` or anything under `.lab-tmp/`.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lab/sdf-zombie/webgpu/sector-light.ts` | create | Curve, effect multiplier, per-sector level array |
| `src/lab/sdf-zombie/webgpu/hazard-floor.ts` | create | Damage accumulator for hurt floors |
| `src/lab/sdf-zombie/webgpu/sector-geometry.ts` | modify | `sectorInteriorPoint` |
| `src/lab/sdf-zombie/webgpu/sector-glow.wgsl.ts` | create | `SECTOR_GLOW` WGSL surface |
| `src/lab/sdf-zombie/webgpu/game-sector-mesh.ts` | modify | `sectorIndex` attribute, per-mesh node materials, glow meshes |
| `src/lab/sdf-zombie/webgpu/game-sector-light.ts` | create | Runtime: uniform array, per-tick refresh, toggle, seam config |
| `src/lab/sdf-zombie/webgpu/game-state-world.ts` | modify | `world.sectorFx` slice field |
| `src/lab/sdf-zombie/webgpu/game-tick.ts` | modify | call `stepSectorLight` |
| `src/lab/sdf-zombie/webgpu/game-loop.ts` | modify | hurt-floor damage in `stepLoop` |
| `src/lab/sdf-zombie/webgpu/game-seams-world.ts` | modify | `sectorLight()`, `health()`, `hazardPoint()` seams |
| `scripts/levels/doom_map.py`, `scripts/tests/test_doom_map.py` | modify | pool lights |
| `scripts/sdf-game-doom-gate.mjs` | modify | hazard, glow and A/B checks; shots |
| `docs/dev-notes/2026-10-24-sector-levels-2/NOTES.md` | create | results, numbers, sheet |

---

## Task 1: Sector light logic (pure)

**Files:** Create `src/lab/sdf-zombie/webgpu/sector-light.ts`; Test `src/lab/sdf-zombie/webgpu/sector-light.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/sector-light.test.ts
//
// Spec 2026-10-24 §7: Doom light levels on a hard curve; flicker, pulse and strobe on sim time.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SECTOR_LIGHT, sectorAmbient, sectorEffect, writeSectorLevels } from './sector-light';
import type { SectorDef } from './sector-def';

const sector = (light: number, special: SectorDef['special'] = 'none'): SectorDef => ({
  floor: 0, ceil: 4, light, special, hurtPerSec: 0, glow: null,
  materials: { floor: 'default', ceil: 'default', wall: 'default' }, zone: 0,
});

describe('sectorAmbient', () => {
  it('maps full light to the cap and no light to zero', () => {
    expect(sectorAmbient(1, DEFAULT_SECTOR_LIGHT)).toBeCloseTo(DEFAULT_SECTOR_LIGHT.max, 9);
    expect(sectorAmbient(0, DEFAULT_SECTOR_LIGHT)).toBe(0);
  });
  it('is a hard curve: Doom 160 is well under half of Doom 255', () => {
    const r = sectorAmbient(160 / 255, DEFAULT_SECTOR_LIGHT) / sectorAmbient(1, DEFAULT_SECTOR_LIGHT);
    expect(r).toBeGreaterThan(0.3);
    expect(r).toBeLessThan(0.4);
  });
  it('is monotonic and clamps out-of-range input', () => {
    let prev = -1;
    for (let l = 0; l <= 1.0001; l += 0.05) { const a = sectorAmbient(l, DEFAULT_SECTOR_LIGHT); expect(a).toBeGreaterThanOrEqual(prev); prev = a; }
    expect(sectorAmbient(2, DEFAULT_SECTOR_LIGHT)).toBeCloseTo(DEFAULT_SECTOR_LIGHT.max, 9);
    expect(sectorAmbient(-1, DEFAULT_SECTOR_LIGHT)).toBe(0);
  });
});

describe('sectorEffect', () => {
  const ts = Array.from({ length: 2000 }, (_, i) => i * 0.005);              // 10 s at 5 ms
  it('is 1 for plain sectors and hurt floors', () => {
    expect(ts.every(t => sectorEffect('none', t, 3, false) === 1)).toBe(true);
    expect(ts.every(t => sectorEffect('hurt', t, 3, false) === 1)).toBe(true);
  });
  it('strobe is bright about 14 % of the time and dark the rest', () => {
    const vals = ts.map(t => sectorEffect('strobe', t, 3, false));
    const bright = vals.filter(v => v === 1).length / vals.length;
    expect(bright).toBeGreaterThan(0.1);
    expect(bright).toBeLessThan(0.2);
    expect(Math.min(...vals)).toBeCloseTo(0.35, 9);
  });
  it('reduced flashes turn strobe into a smooth pulse', () => {
    const vals = ts.map(t => sectorEffect('strobe', t, 3, true));
    for (let i = 1; i < vals.length; i++) expect(Math.abs(vals[i]! - vals[i - 1]!)).toBeLessThan(0.02);
  });
  it('pulse swings smoothly between 0.35 and 1', () => {
    const vals = ts.map(t => sectorEffect('pulse', t, 3, false));
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0.35 - 1e-9);
    expect(Math.max(...vals)).toBeLessThanOrEqual(1 + 1e-9);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.5);
  });
  it('flicker drops out sometimes, deterministically per seed', () => {
    const a = ts.map(t => sectorEffect('flicker', t, 7, false));
    expect(a.some(v => v === 0)).toBe(true);
    expect(a.filter(v => v > 0.5).length / a.length).toBeGreaterThan(0.6);
    expect(ts.map(t => sectorEffect('flicker', t, 7, false))).toEqual(a);
    expect(ts.map(t => sectorEffect('flicker', t, 8, false))).not.toEqual(a);
  });
});

describe('writeSectorLevels', () => {
  it('writes ambient × effect per sector, or zeros when off', () => {
    const sectors = [sector(1), sector(0.5), sector(1, 'strobe')];
    const out = new Float32Array(3);
    writeSectorLevels(sectors, 0.5, { ...DEFAULT_SECTOR_LIGHT, on: true }, false, out);
    expect(out[0]).toBeCloseTo(DEFAULT_SECTOR_LIGHT.max, 6);
    expect(out[1]).toBeCloseTo(sectorAmbient(0.5, DEFAULT_SECTOR_LIGHT), 6);
    expect(out[2]).toBeCloseTo(DEFAULT_SECTOR_LIGHT.max * sectorEffect('strobe', 0.5, 2, false), 6);
    writeSectorLevels(sectors, 0.5, { ...DEFAULT_SECTOR_LIGHT, on: false }, false, out);
    expect([...out]).toEqual([0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run src/lab/sdf-zombie/webgpu/sector-light.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write `sector-light.ts`**

```ts
// src/lab/sdf-zombie/webgpu/sector-light.ts
//
// SECTOR LIGHT (spec 2026-10-24-doom-sector-levels-design.md §7). A sector's Doom light level
// (0..1) becomes a self-lit ambient fraction of its albedo on a HARD curve, so even Doom's bright
// rooms stay dim in this engine's dark; flicker, pulse and strobe sectors multiply it on sim time.
// The renderer reads one Float32Array of current levels (game-sector-light.ts).
//
// Pure: no three.js, no DOM. The seed of a sector is its index, so the same map flickers the same.

import { moodLevel } from './lamp-moods';
import type { SectorDef, SectorSpecial } from './sector-def';

export interface SectorLightCurve { max: number; gamma: number }
export interface SectorLightConfig extends SectorLightCurve { on: boolean }

/** Doom 255 → 7 % of albedo, Doom 160 → about 2.6 %. Tuned live with __sdfGame.sectorLight. */
export const DEFAULT_SECTOR_LIGHT: SectorLightCurve = { max: 0.07, gamma: 2.2 };

/** Strobe: Doom's STROBEBRIGHT (5 tics) out of ~1 s; the dark phase keeps 35 % of the light. */
const STROBE_PERIOD_S = 1.0;
const STROBE_BRIGHT_S = 0.14;
const DIM = 0.35;
/** Pulse (Doom's glowing light): one slow swing between DIM and 1. */
const PULSE_PERIOD_S = 2.2;
/** Reduced flashes: strobe becomes a pulse this slow. */
const STROBE_REDUCED_PERIOD_S = 3.0;

export function sectorAmbient(light: number, curve: SectorLightCurve): number {
  const l = Math.min(1, Math.max(0, light));
  return curve.max * l ** curve.gamma;
}

const pulse = (t: number, period: number, seed: number) =>
  DIM + (1 - DIM) * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / period + seed * 1.7));

/** The light multiplier of a sector special at sim time t (s). */
export function sectorEffect(special: SectorSpecial, t: number, seed: number, reducedFlashes: boolean): number {
  switch (special) {
    case 'flicker':
      return Math.min(1, moodLevel('flicker', t, seed));
    case 'pulse':
      return pulse(t, PULSE_PERIOD_S, seed);
    case 'strobe': {
      if (reducedFlashes) return pulse(t, STROBE_REDUCED_PERIOD_S, seed);
      const phase = (((t + seed * 0.37) % STROBE_PERIOD_S) + STROBE_PERIOD_S) % STROBE_PERIOD_S;
      return phase < STROBE_BRIGHT_S ? 1 : DIM;
    }
    default:
      return 1;
  }
}

/** Fill `out[i]` with sector i's current self-lit level (0 everywhere when `cfg.on` is false). */
export function writeSectorLevels(
  sectors: readonly SectorDef[], t: number, cfg: SectorLightConfig, reducedFlashes: boolean, out: Float32Array,
): void {
  for (let i = 0; i < sectors.length; i++) {
    const s = sectors[i]!;
    out[i] = cfg.on ? sectorAmbient(s.light, cfg) * sectorEffect(s.special, t, i, reducedFlashes) : 0;
  }
}
```

(The tests above pass `seed` = the sector index — `writeSectorLevels` uses `i`; the strobe
expectation for sector 2 uses seed 2.)

- [ ] **Step 4: Run the tests** — same command → PASS. If `moodLevel('flicker', …)` never returns
exactly 0 for seed 7 over 10 s, print the minimum and report: the test's "drops out" assertion
should then use `< 0.05` (that is a fact about lamp-moods, not a weakening).

- [ ] **Step 5: Commit** — `feat(levels): sector light curve and effects (pure)`.

---

## Task 2: Hurt floors and a sector's interior point (pure)

**Files:** Create `src/lab/sdf-zombie/webgpu/hazard-floor.ts` + test; Modify `src/lab/sdf-zombie/webgpu/sector-geometry.ts` (+ its test).

- [ ] **Step 1: Failing tests**

```ts
// src/lab/sdf-zombie/webgpu/hazard-floor.test.ts
import { describe, expect, it } from 'vitest';
import { newHazard, stepHazard } from './hazard-floor';

describe('stepHazard', () => {
  it('deals whole points once a second while on a hurt floor', () => {
    const h = newHazard();
    let total = 0;
    for (let i = 0; i < 180; i++) total += stepHazard(h, 10, 1 / 60);        // 3 s at 60 Hz
    expect(total).toBe(30);
  });
  it('the first hit lands after half a second, not instantly', () => {
    const h = newHazard();
    let first = -1;
    for (let i = 0; i < 60 && first < 0; i++) if (stepHazard(h, 5, 1 / 60) > 0) first = i;
    expect(first).toBeGreaterThanOrEqual(28);
    expect(first).toBeLessThanOrEqual(31);
  });
  it('stepping off resets it; a safe floor never hurts', () => {
    const h = newHazard();
    for (let i = 0; i < 25; i++) stepHazard(h, 10, 1 / 60);
    expect(stepHazard(h, 0, 1 / 60)).toBe(0);
    let total = 0;
    for (let i = 0; i < 25; i++) total += stepHazard(h, 10, 1 / 60);
    expect(total).toBe(0);                                                   // 25 frames < 0.5 s again
  });
  it('rounds fractional rates to whole points', () => {
    const h = newHazard();
    let total = 0;
    for (let i = 0; i < 120; i++) total += stepHazard(h, 2.6, 1 / 60);
    expect(total).toBe(6);                                                   // round(2.6) = 3, twice
  });
});
```

Add to `sector-geometry.test.ts`:

```ts
import { sectorInteriorPoint } from './sector-geometry';
describe('sectorInteriorPoint', () => {
  it('lands inside each fixture sector, clear of its lines', () => {
    const m = map();
    const g = buildSectorGround(m);
    for (let s = 0; s < m.sectors.length; s++) {
      const [x, z] = sectorInteriorPoint(m, s)!;
      expect(g.sectorAt(x, z)).toBe(s);
    }
  });
  it('avoids the column hole in A', () => {
    const [x, z] = sectorInteriorPoint(map(), 0)!;
    expect(x >= -1 && x <= 1 && z <= -3 && z >= -5).toBe(false);
  });
});
```

- [ ] **Step 2: Run them** — `npx vitest run src/lab/sdf-zombie/webgpu/hazard-floor.test.ts src/lab/sdf-zombie/webgpu/sector-geometry.test.ts` → FAIL.

- [ ] **Step 3: Write `hazard-floor.ts`**

```ts
// src/lab/sdf-zombie/webgpu/hazard-floor.ts
//
// HURT FLOORS (spec 2026-10-24 §8): standing on a hurt sector deals whole points of damage once a
// second, the first after half a second (Doom hits every 32 tics; a whole-point tick keeps the HUD
// and the red flash readable). Stepping off resets it. Pure: no three.js, no DOM.

const PERIOD_S = 1;
const FIRST_S = 0.5;

export interface HazardState { acc: number }

export function newHazard(): HazardState {
  return { acc: PERIOD_S - FIRST_S };
}

/** One sim step on a floor hurting `hurtPerSec` (0 = safe). Returns the damage to apply now. */
export function stepHazard(h: HazardState, hurtPerSec: number, dt: number): number {
  if (!(hurtPerSec > 0)) { h.acc = PERIOD_S - FIRST_S; return 0; }
  h.acc += dt;
  let dmg = 0;
  while (h.acc >= PERIOD_S) { h.acc -= PERIOD_S; dmg += Math.round(hurtPerSec * PERIOD_S); }
  return dmg;
}
```

- [ ] **Step 4: Add `sectorInteriorPoint` to `sector-geometry.ts`**

Deterministic: sample a grid over the sector's bounding box (`step = max(0.25, min(w, h) / 24)`),
keep the inside samples (even-odd over the sector's directed edges — use the shared helper the
step-1 fix-up added, e.g. `pointInEdges(x, z, sectorEdges(map, s))`, if it exists; otherwise
`pointInLoop` over each loop with even-odd across loops), and return the one farthest from any of
the sector's edges (ties: first in row-major order). Return `null` for a sector with no inside
sample. Export:

```ts
/** A point well inside sector s (the inside grid sample farthest from its lines), or null. */
export function sectorInteriorPoint(map: SectorMap, s: number): [number, number] | null
```

Write the full function (≈25 lines) with a `distToSeg` helper.

- [ ] **Step 5: Tests pass; commit** — `feat(levels): hurt-floor damage and a sector interior point (pure)`.

---

## Task 3: The glow surface (WGSL)

**Files:** Create `src/lab/sdf-zombie/webgpu/sector-glow.wgsl.ts`; Test `src/lab/sdf-zombie/webgpu/sector-glow.wgsl.test.ts`.

- [ ] **Step 1: Write `sector-glow.wgsl.ts`**

```ts
// src/lab/sdf-zombie/webgpu/sector-glow.wgsl.ts
//
// GLOWING HAZARD FLOORS (spec 2026-10-24 §8): nukage, lava and acid as a self-lit, slowly flowing
// surface in world space (so a pool split across sectors flows as one). Two octaves of value noise
// drifting against each other give the slime; a brighter vein band and a dark crust keep it from
// reading as flat colour. `kind`: 0 nukage, 1 lava, 2 acid. Returns linear RGB (unlit; it is the
// light source — the pool's list-tier light lights everything else).

export const SECTOR_GLOW_HASH = /* wgsl */ `fn sgHash(p: vec2<f32>) -> f32 {
  let q = fract(p * vec2<f32>(123.34, 456.21));
  let r = q + dot(q, q + 45.32);
  return fract(r.x * r.y);
}`;

export const SECTOR_GLOW_NOISE = /* wgsl */ `fn sgNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = sgHash(i);
  let b = sgHash(i + vec2<f32>(1.0, 0.0));
  let c = sgHash(i + vec2<f32>(0.0, 1.0));
  let d = sgHash(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}`;

export const SECTOR_GLOW = /* wgsl */ `fn sectorGlow(wpos: vec3<f32>, t: f32, kind: f32) -> vec3<f32> {
  let p = wpos.xz * 0.55;
  let n1 = sgNoise(p + vec2<f32>(t * 0.11, t * 0.07));
  let n2 = sgNoise(p * 2.3 - vec2<f32>(t * 0.17, -t * 0.05));
  let n = n1 * 0.65 + n2 * 0.35;
  let vein = smoothstep(0.62, 0.78, n) - smoothstep(0.78, 0.95, n);
  let crust = smoothstep(0.30, 0.12, n);
  var base = vec3<f32>(0.10, 0.85, 0.18);
  var hot = vec3<f32>(0.75, 1.00, 0.45);
  if (kind > 0.5 && kind < 1.5) { base = vec3<f32>(0.95, 0.30, 0.05); hot = vec3<f32>(1.00, 0.80, 0.35); }
  if (kind > 1.5) { base = vec3<f32>(0.55, 0.85, 0.10); hot = vec3<f32>(0.95, 1.00, 0.55); }
  let pulse = 0.9 + 0.1 * sin(t * 1.3 + n * 6.0);
  return (base * (0.55 + 0.45 * n) + hot * vein * 0.9) * (1.0 - crust * 0.6) * pulse;
}`;

export const GLOW_KIND_INDEX = { nukage: 0, lava: 1, acid: 2 } as const;
```

- [ ] **Step 2: A string-level test** (the repo tests WGSL modules for shape; follow an existing
`*.wgsl.test.ts` if one exists, e.g. `grep -l "wgsl" src/lab/sdf-zombie/webgpu/*.wgsl.test.ts`):
assert each export starts with `fn ` and has a `-> ` return, `sectorGlow` references `sgNoise`,
`sgNoise` references `sgHash`, and there is no `:` inside a `//` comment in the WGSL strings. Run
it; commit — `feat(levels): WGSL surface for glowing hazard floors`.

---

## Task 4: Sector meshes carry their sector; glow floors; the runtime

**Files:** Modify `game-sector-mesh.ts`, `game-state-world.ts`, `game-tick.ts`, `game-seams-world.ts`, `game-main.ts` (only if needed to call the builder's new return); Create `game-sector-light.ts`.

Read first: the current `game-sector-mesh.ts` (the step-1 fix-up may have changed it), the boot
light loop in `game-main.ts` (search `library.fromMaterial` — every `levelGroup` mesh gets
`nm = library.fromMaterial(mesh.material); nm.lightsNode = list` — **a NodeMaterial instance is
reused as is**, so each mesh must own its material, never share one across zones), `game-void.ts`
(the `wgslFn` + `include(...)` pattern and `MeshBasicNodeMaterial` glow added with `scene.add`,
outside `levelGroup`, so the deferred router never hides it), `game-state-world.ts` (how a world
field is declared, initialised and listed), and how the repo reads the reduced-flashes setting
(`grep -rn "flashes" src/lab/sdf-zombie/webgpu/*.ts`).

- [ ] **Step 1: `sectorIndex` on every vertex.** In `Batch.tri`, take a `sector: number` and push it
into a `sec: number[]` per vertex; `geometry()` adds `g.setAttribute('sectorIndex', new
THREE.Float32BufferAttribute(this.sec, 1))`. Floors/ceilings pass `poly.sector`, walls `q.sector`.

- [ ] **Step 2: Glow floors leave the stone batch.** A sector with `glow !== null` puts its FLOOR
triangles into `glowBatch(glow)` (one batch per kind) instead of `batch(zone, 'floor')`; its
ceiling and walls are unchanged.

- [ ] **Step 3: Per-mesh node materials with the sector term.** Replace the three shared classic
materials with a function building one `MeshStandardNodeMaterial` per mesh from the stone set's
role material (copy `map`, `normalMap`, `roughnessMap` — world-tiled clones made ONCE per role and
shared as textures, which is fine — plus `roughness`, `metalness`, `normalScale`, `color` from the
palette). Then:

```ts
// The sector's self-lit level (sector-light.ts via game-sector-light.ts), times the albedo.
const lvl = levels.element(attribute('sectorIndex', 'float').toInt());
nm.emissiveNode = materialColor.mul(lvl).add(baseEmissive);
```

where `levels` is the runtime's `uniformArray(new Array(map.sectors.length).fill(0), 'float')`
(three's TSL `uniformArray` — check its exact signature in
`node_modules/three/src/nodes/accessors/UniformArrayNode.js` and its use of `.element()`), and
`baseEmissive` is `vec3(P.ceil).mul(uCeilWhisper)` for ceilings (`uCeilWhisper` a `uniform(0.10)`
the runtime sets to 0.10 when sector light is off and 0 when on) and `vec3(0)` otherwise. Use
`materialColor` (TSL, the material's diffuse incl. map) if available, else `texture(map, uv()).rgb
.mul(color)`; check the TSL exports in `node_modules/three/src/nodes/TSL.js`.

- [ ] **Step 4: Glow meshes.** For each glow kind with triangles: `MeshBasicNodeMaterial` with

```ts
const glowFn = wgslFn(SECTOR_GLOW, [include(wgslFn(SECTOR_GLOW_NOISE, [include(wgslFn(SECTOR_GLOW_HASH))]))]);
mat.colorNode = vec4(glowFn({ wpos: positionWorld, t: uGlowTime, kind: float(GLOW_KIND_INDEX[kind]) }), 1);
mat.fog = false;
```

Mesh `userData.shadow = false`, `userData.skipLevelLights = true`, added to a new
`THREE.Group` named `sector-glow` that is added to the **scene**, not `levelGroup` (as
`game-void.ts` does). Lift the glow floor 2 mm (`y + 0.002`) so it never z-fights a neighbour's
riser edge.

- [ ] **Step 5: The runtime `game-sector-light.ts`.**

```ts
// src/lab/sdf-zombie/webgpu/game-sector-light.ts
//
// SECTOR LIGHT AND GLOW at runtime (spec 2026-10-24 §7–§8): owns the per-sector level uniform
// array the sector meshes read, refreshes it every tick from sector-light.ts on the sim clock,
// advances the glow surfaces' time, and holds the on/off toggle (?doomlight=0) and the curve the
// __sdfGame.sectorLight seam tunes.

export interface SectorFxRuntime {
  levels: /* the uniformArray node */ ...;
  values: Float32Array;
  cfg: SectorLightConfig;
  ceilWhisper: /* uniform node */ ...;
  glowTime: /* uniform node */ ...;
  reducedFlashes: boolean;
}
export function createSectorFx(sectorCount: number, search: URLSearchParams, reducedFlashes: boolean): SectorFxRuntime
export function stepSectorLight(ctx: GameContext): void   // writeSectorLevels(def.sectors.sectors, simTimeMs()/1000, …) → levels.array; glowTime = t; ceilWhisper = cfg.on ? 0 : 0.10
export function setSectorLightConfig(fx: SectorFxRuntime, patch: Partial<SectorLightConfig>): SectorLightConfig
```

Write it fully (types from three/tsl; `cfg.on = search.get('doomlight') !== '0'`). `addSectorMeshes`
creates the runtime and stores it on `ctx.world.sectorFx` (declare the field in
`game-state-world.ts` as `SectorFxRuntime | null`, initialised `null`, and add it wherever the file
lists world fields so `game-context-coverage` passes). After `uniformArray` values change, set
whatever flag three needs (check `UniformArrayNode` — usually writing into `.array` is enough).

- [ ] **Step 6: Tick and seams.** In `game-tick.ts`, beside the dynamic-light step, call
`stepSectorLight(ctx)` when `ctx.world.sectorFx` is set. In `game-seams-world.ts` add:

```ts
    /** Sector light (spec 2026-10-24 §7): read or patch the curve and the on/off toggle. */
    sectorLight: (patch?: { max?: number; gamma?: number; on?: boolean }) =>
      ctx.world.sectorFx ? setSectorLightConfig(ctx.world.sectorFx, patch ?? {}) : null,
    /** A point well inside the first hurt sector (gates), or null. */
    hazardPoint: () => { /* find first sector with special 'hurt' in def.sectors; sectorInteriorPoint */ },
    health: () => ctx.world.loop?.vitals.health ?? null,
```

- [ ] **Step 7: Verify.** `npm run typecheck`; `npm run test:changed`; `npm test -- game-context-coverage`;
then `LAB_TMP=.lab-tmp DOOM_GATE_ONLY_FIXTURE=1 bash scripts/sdf-game-doom-gate.sh` (the fixture
has no glow sectors: this proves nothing regressed). Commit —
`feat(levels): sector light and glowing floors in the game`.

---

## Task 5: Hurt floors damage the player

**Files:** Modify `src/lab/sdf-zombie/webgpu/game-loop.ts` (+ a focused test if `game-loop` has one; otherwise rely on Task 2's pure tests and the gate).

- [ ] **Step 1:** Add `hazard: HazardState` to the loop runtime created in `createLoop`
(`newHazard()`). In `stepLoop`, after the zombie-bite block and before `const def = …`:

```ts
  // HURT FLOORS (spec 2026-10-24 §8): feet on a hurt sector's floor (not jumping over it).
  const sectors = ctx.world.level.def?.sectors;
  if (sectors) {
    const g = ctx.world.level.ground as SectorGround;
    const s = ctx.player.player.grounded ? g.sectorAt(feet[0], feet[2]) : -1;
    const sec = s >= 0 ? sectors.sectors[s]! : null;
    const dmg = stepHazard(rt.hazard, sec && sec.special === 'hurt' ? sec.hurtPerSec : 0, dt);
    if (dmg > 0) damagePlayer(ctx, dmg, 'pellet');
  }
```

`damagePlayer` already ignores god mode, death and sequences.

- [ ] **Step 2:** typecheck, `npm run test:changed`; commit — `feat(levels): hurt floors damage the player`.

---

## Task 6: Pool lights in the converter

**Files:** Modify `scripts/levels/doom_map.py`, `scripts/tests/test_doom_map.py`.

- [ ] **Step 1: Failing test.** The test WAD's sector B is nukage (32 m² at 32 units/m). Assert the
output has a light with `mood == 'fire'`, `fixture == 'none'`, a green colour (`g > r` and `g > b`),
inside B (use the converter's own inside test), at `y == floor(B) + 0.6`; and that pool lights do
not count toward the fill-light cap (a test map with 10 big zones and a pool still gets the pool
light).

- [ ] **Step 2: Implement.** Group connected glow sectors of the same kind (union over two-sided
lines joining two glow sectors of that kind). For each group with real area ≥ 4 m²: one light at
the farthest-inside point of its biggest sector (reuse the fill-light helper), `y = floor + 0.6`,
colour `{nukage: [0.35, 1.0, 0.3], lava: [1.0, 0.45, 0.12], acid: [0.75, 1.0, 0.25]}`,
`power = min(14, 4 + 0.15 * area)`, `mood: 'fire'`, `fixture: 'none'`. Cap 8 pool lights per map
(keep the biggest). Print the pool-light count in the summary line.

- [ ] **Step 3:** `python3 -m pytest scripts/tests/test_doom_map.py -q`; regenerate E1M1
(`python3 scripts/levels/doom_map.py "$HOME/MIYOO BACKUP/Roms/PORTS/Games/Doom (PrBoom)/doom/doomu.wad" E1M1 --svg .lab-tmp/doom`)
and re-run the TS parse check (`npx tsx -e …parseSectorLevel…`, as in plan 1 Task 6). Commit —
`feat(levels): converter lights the pools` (no generated files).

---

## Task 7: Gate, numbers, look, notes

**Files:** Modify `scripts/sdf-game-doom-gate.mjs`; Create `docs/dev-notes/2026-10-24-sector-levels-2/NOTES.md`; Modify `docs/tasks/levels.md`.

- [ ] **Step 1: Gate additions (E1M1 section, after the route):**
  1. **Hazard:** reload with `?level=doom-e1m1&god=0`; `p = __sdfGame.hazardPoint()`; fail if null;
     `setPose(p[0], p[1], 0, 0)`; read `health()`, wait 3.2 s, read again; pass if it dropped by at
     least `2 × hurtPerSec` of that sector (read from the level JSON in node with `fs`) and the
     player is not dead. Then move off and check it stops dropping over 2 s.
  2. **Glow reads:** at the hazard point, pitch −1.2 (looking down), take a screenshot and measure
     in the page (decode the PNG with `createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob())`,
     draw to an `OffscreenCanvas`, `getImageData` the centre 30 % crop): mean G > 1.4 × mean R and
     mean G > 40/255. Report the numbers.
  3. **Sector light A/B:** at a fixed pose in a Doom-bright sector (choose from the JSON: a non-glow
     sector with the highest `light`, use `sectorInteriorPoint` via a seam or compute in node),
     facing a wall, with the flashlight OFF if a seam allows it (`setFlashlight(false)` exists on
     some levels — check), measure mean frame luminance with sector light on and after
     `sectorLight({ on: false })`; pass if on > off × 1.05. Report both numbers and the ratio.
     Repeat in the darkest sector: report (no assertion).
  4. Budget and SHOTS as before, plus `e1m1-pool.png`, and an A/B pair `e1m1-bright-on.png` /
     `e1m1-bright-off.png`.

- [ ] **Step 2: Run it** (`LAB_TMP=.lab-tmp SHOTS=1 bash scripts/sdf-game-doom-gate.sh`); also the
cold-boot `drawOnce` number vs plan 1 (report). LOOK at every new shot. Build a side-by-side sheet
(on/off pairs for two bright sectors, one dark, one pool) into
`.lab-tmp/doom/sector-light-sheet.png` (any tool that's available — e.g. a page that draws the four
PNGs onto one canvas via CDP, or `sips`/ImageMagick if installed).

- [ ] **Step 3: Notes** — what was built, the decisions list at the top of this plan with the
measured numbers (curve, glow G/R, A/B ratios, frame ms, boot), what the shots show, known gaps
(deferred mode, bodies not darkened per sector, strobe/flash accessibility setting used, wall halo
via the pool light only). Owner review asks: the curve (`max`, `gamma`), whether ceilings should
keep a whisper, pool colour/brightness.

- [ ] **Step 4:** `docs/tasks/levels.md`: mark items 3 (hazard floors) and 4 (sector lighting) done
with links; note that plan 3 (things) is next. Commit — `test(levels): pools and sector light — gate, notes`.
