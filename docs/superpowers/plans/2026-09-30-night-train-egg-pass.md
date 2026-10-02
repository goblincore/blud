# Night Train Egg Pass (ending plan 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the control room's flat placeholder egg with the real one: a red-veined transparent outer egg around a milky, spotted inner egg that holds a soft, hard-to-make-out dark figure against a warm backlight, pulsing like something alive, drawn by one hand-written WGSL pass.

**Spec:** `docs/superpowers/specs/2026-09-30-night-train-egg-ending-design.md` (§2 "The egg", §1 "Pulse") — read it first. Look targets: `docs/dev-notes/2026-09-30-egg-ending/egg-close.png` and `control-room-door.png` (Blender blockout). Plan 1 (the room) is done: `docs/superpowers/plans/2026-09-30-night-train-control-room.md`, notes in `docs/dev-notes/2026-09-30-egg-ending/plan1-notes.md`.

**Architecture:** Follow the disco-star precedent (`disco-stars.ts` + `disco-star.wgsl.ts` + `game-disco-leaves.ts`):
- `egg-look.ts` — pure maths, no `three`: the ray-ellipsoid test, the analytic Gaussian line integral that makes the figure soft, the spot directions, the pulse and resolve rules. It is the TypeScript twin of the WGSL and is unit-tested.
- `egg.wgsl.ts` — the shader, built from the same tables: one proxy box in the SDF layer's late scene; per pixel it intersects the ray with three nested ellipsoids **analytically** and composes them in a fixed order (so walking round the egg needs no transparency sorting). The soft figure is a handful of anisotropic Gaussians, integrated **in closed form** along the ray (no marching).
- `game-egg-leaves.ts` — finds the plan-1 placeholder egg in the level art, hides it, builds the proxy mesh and uniforms, steps the pulse on the train clock, and exposes `__sdfGame.egg()` / `setEgg()` seams. State lives on `ctx.world.egg`.

**Tech Stack:** TypeScript, three.js r186 WebGPU/TSL `wgslFn`, Vitest, headless-Chrome check script (`scripts/sdf-egg-check.mjs`, own ports 5373/9373).

**Out of scope:** the egg light following the pulse (the room's egg accent is a `fire`-mood lamp), the consoles' screens pulsing, `egg.touch` and the sequence system, the montage (plans 3-4), the per-room art culling that plan 1's notes recommend.

---

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port):** the logic is the pure `egg-look.ts` with its own tests; the effect itself is hand-written WGSL (`egg.wgsl.ts`); TSL is only glue (uniforms, blending). State lives on `ctx` (`ctx.world.egg`), never as new `main()` bindings. Keep it deterministic: the pulse runs on the train/sim clock, never wall time.
- Work ONLY in this worktree (`.claude/worktrees/train-monitor-transition-51f385`). Never `git stash`. `node_modules` is symlinked — do not reinstall.
- **Targeted tests only** (`npx vitest run <files>`) plus `npx tsc --noEmit`. Never the bare full suite.
- **Headless capture only** — the in-app browser pane loses the WebGPU device. Capture scripts wait for `window.__warmGate.phase === 'ready'` and fail on renderer pipeline errors. `export LAB_TMP=.lab-tmp`. Never kill a server you did not start. Use ports 5373/9373 for this plan's check script.
- **Prove visual and performance claims with a number** (crop luminance, contrast, frame ms) and look at the images yourself with the Read tool.
- **Boot time is a gate:** this change adds a shader. Report cold-boot time (`__warmGate` ready) against the base commit `81ed9d9d` (fresh profile each run; ±1.3 s is noise).
- WebGPU: alpha lives in `colorNode.w`, never `alphaHash`/`alphaTest`. Never toggle a light's `.visible` (hiding a *mesh* is fine). `wgslFn` takes **one** `fn` per string; helpers go in as includes. In WGSL comments avoid backticks.
- A light added to the scene graph leaks into level lighting unless `game-lighting-leaves.ts levelSceneLights` skips it — this plan adds **no** light.
- Commit messages end with a blank line and `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Where things are (from plan 1)

- The room is `control-room` (room id 8), x −4…4, z −130.4…−140.4. The egg stands at x 0, **z −136.7**; the plinth top is at y 0.4 and the placeholder egg spans y 0.31…2.9 (centre y ≈ 1.6; semi-axes 0.95 wide, 1.3 tall).
- The placeholder is a single art mesh with material `train.egg` (art batches are named `art-batch:<room>:<materials>` by `batchArt()` in `game-art-leaves.ts`, merged per room/material/shadow). Collision (plinth + egg box x ±1.2, z −135.5…−137.9) and the completion trigger (x ±1.6, z −135.1…−138.3) are unchanged by this plan.
- Game axes: x east, y up, **−z north** (the way the player walks). The door is on the +z side of the egg, so the figure faces +z.
- Draw budget: the train gate allows +200 art draws; the office pose is at +182. This plan hides one batch (the placeholder) and adds one mesh (the proxy box): net 0.

---

## Task 1: `egg-look.ts` — the pure twin (TDD)

**Files:** Create `src/lab/sdf-zombie/webgpu/egg-look.ts` and `src/lab/sdf-zombie/webgpu/egg-look.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/egg-look.test.ts`:

```ts
// src/lab/sdf-zombie/webgpu/egg-look.test.ts

import { describe, expect, it } from 'vitest';
import {
  EGG, FIGURE, advancePhase, blurFor, coreEmission, eggBeat, eggProximity, eggPulse, eggResolve,
  figureTau, gaussLine, innerCentre, innerTransmit, rayEllipsoid, spotDirection, spotRadius, type Vec3,
} from './egg-look';

const C: Vec3 = [0, 1.6, -136.7];

describe('rayEllipsoid', () => {
  it('hits a sphere along its axis at -r and +r', () => {
    const h = rayEllipsoid([0, 0, 5], [0, 0, -1], [0, 0, 0], [1, 1, 1])!;
    expect(h[0]).toBeCloseTo(4, 6);
    expect(h[1]).toBeCloseTo(6, 6);
  });
  it('scales per axis', () => {
    const h = rayEllipsoid([0, 5, 0], [0, -1, 0], [0, 0, 0], [0.95, 1.3, 0.95])!;
    expect(h[0]).toBeCloseTo(3.7, 6);
    expect(h[1]).toBeCloseTo(6.3, 6);
  });
  it('misses a ray that passes by, and one that points away', () => {
    expect(rayEllipsoid([2, 0, 5], [0, 0, -1], [0, 0, 0], [1, 1, 1])).toBeNull();
    expect(rayEllipsoid([0, 0, 5], [0, 0, 1], [0, 0, 0], [1, 1, 1])).toBeNull();
  });
});

describe('gaussLine', () => {
  it('equals the numeric line integral of exp(-|(p-c)/s|^2)', () => {
    const o: Vec3 = [0.2, 0.1, 4], d: Vec3 = [0.02, 0.01, -1], c: Vec3 = [0, 0, 0], s: Vec3 = [0.3, 0.5, 0.18];
    const len = Math.hypot(...d);
    const dn: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
    let sum = 0;
    for (let t = 0; t < 8; t += 0.0005) {
      const p = [o[0] + dn[0] * t, o[1] + dn[1] * t, o[2] + dn[2] * t];
      sum += Math.exp(-((p[0]! / s[0]) ** 2 + (p[1]! / s[1]) ** 2 + (p[2]! / s[2]) ** 2)) * 0.0005;
    }
    expect(gaussLine(o, dn, c, s).value).toBeCloseTo(sum, 3);
  });
  it('reports the parameter of closest approach', () => {
    const g = gaussLine([0, 0, 5], [0, 0, -1], [0, 0, 0], [1, 1, 1]);
    expect(g.t).toBeCloseTo(5, 6);
  });
});

describe('spots', () => {
  it('directions are unit length and well separated', () => {
    const dirs = Array.from({ length: EGG.spots }, (_, i) => spotDirection(i));
    for (const d of dirs) expect(Math.hypot(...d)).toBeCloseTo(1, 6);
    let min = Infinity;
    for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
      const a = dirs[i]!, b = dirs[j]!;
      min = Math.min(min, Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    }
    expect(min).toBeGreaterThan(0.3);
  });
  it('radii are 0.10 to 0.31 rad and vary', () => {
    const r = Array.from({ length: EGG.spots }, (_, i) => spotRadius(i));
    expect(Math.min(...r)).toBeCloseTo(0.1, 6);
    expect(Math.max(...r)).toBeLessThanOrEqual(0.31 + 1e-9);
    expect(new Set(r.map(v => v.toFixed(3))).size).toBeGreaterThan(3);
  });
});

describe('the figure and the core', () => {
  const o: Vec3 = [0, C[1] + EGG.innerDy, C[2] + 4];   // in front of the egg (the door side), at the inner egg's height
  const d: Vec3 = [0, 0, -1];
  it('a ray through the figure is more absorbed than one that misses it', () => {
    const through = figureTau(o, d, C, 0.5);
    const miss = figureTau([1.2, o[1], o[2]], d, C, 0.5);
    expect(through).toBeGreaterThan(0.5);
    expect(miss).toBeLessThan(0.05);
  });
  it('only the figure in front of the core darkens the glow (looking from behind, the glow wins)', () => {
    const tCore = coreEmission(o, d, C).t;
    const front = figureTau(o, d, C, 0.5, tCore);
    expect(front).toBeGreaterThan(0.3);                       // from the door, the figure is in front of the core
    const back: Vec3 = [0, o[1], C[2] - 4];
    const tCoreBack = coreEmission(back, [0, 0, 1], C).t;
    expect(figureTau(back, [0, 0, 1], C, 0.5, tCoreBack)).toBeLessThan(0.5 * front);   // from behind, the core is in front
  });
  it('blur spreads the figure but keeps a single blob\'s peak absorption', () => {
    const b = FIGURE[0]!;
    const ci = innerCentre(C);
    const k = EGG.innerScale / 0.6;
    const bc: Vec3 = [ci[0] + (EGG.figureOffset[0] + b.pos[0]) * k, ci[1] + (EGG.figureOffset[1] + b.pos[1]) * k, ci[2] + (EGG.figureOffset[2] + b.pos[2]) * k];
    const through = (blur: number) => (EGG.figureStrength / blur) * gaussLine([bc[0], bc[1], bc[2] + 3], [0, 0, -1], bc, [b.sc[0] * k * blur, b.sc[1] * k * blur, b.sc[2] * k * blur]).value;
    expect(through(1.7)).toBeCloseTo(through(1.0), 6);
    expect(blurFor(0)).toBeCloseTo(EGG.blurFar, 6);
    expect(blurFor(1)).toBeCloseTo(EGG.blurNear, 6);
  });
  it('the milk thins towards the edge of the inner egg', () => {
    expect(innerTransmit(1.14)).toBeLessThan(innerTransmit(0.3));
    expect(innerTransmit(0)).toBe(1);
  });
});

describe('pulse, proximity and resolve', () => {
  it('the beat peaks at the start of a cycle and the pulse stays in 0.55..1', () => {
    expect(eggBeat(0)).toBeGreaterThan(0.95);
    expect(eggBeat(0.15)).toBeLessThan(0.3);
    for (let p = 0; p < 1; p += 0.01) {
      expect(eggPulse(p)).toBeGreaterThanOrEqual(0.55 - 1e-9);
      expect(eggPulse(p)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
  it('the phase advances faster when you are close, and wraps into 0..1', () => {
    const slow = advancePhase(0, 0.1, 0), fast = advancePhase(0, 0.1, 1);
    expect(fast).toBeGreaterThan(slow);
    expect(advancePhase(0.95, 0.2, 0)).toBeLessThan(1);
    expect(advancePhase(0.95, 0.2, 0)).toBeGreaterThanOrEqual(0);
  });
  it('proximity is 0 beyond 6 m and 1 within 1.8 m', () => {
    expect(eggProximity(10)).toBe(0);
    expect(eggProximity(1.0)).toBe(1);
    expect(eggProximity(3.5)).toBeGreaterThan(eggProximity(5));
  });
  it('resolve: 0 at range or with the setting 0; the setting at point blank', () => {
    expect(eggResolve(10, 0.5)).toBe(0);
    expect(eggResolve(1.0, 0.5)).toBeCloseTo(0.5, 6);
    expect(eggResolve(1.0, 0)).toBe(0);
    expect(eggResolve(1.0, 1)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it — it must fail**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/egg-look.test.ts 2>&1 | tail -8
```

Expected: FAIL (`Cannot find module './egg-look'`).

- [ ] **Step 3: Write `egg-look.ts`**

Create `src/lab/sdf-zombie/webgpu/egg-look.ts`:

```ts
// src/lab/sdf-zombie/webgpu/egg-look.ts
//
// THE CONTROL ROOM'S EGG (spec 2026-09-30-night-train-egg-ending-design.md §1-§2), as pure maths.
// A red-veined transparent outer egg around a milky, spotted inner egg that holds a soft dark
// figure against a warm core glow. TypeScript twin of egg.wgsl.ts: the WGSL draws, this tests; the
// tuning table and the figure table below are the single source for both (the WGSL is built from
// them). Veins and the surface lighting are WGSL-only. Pure: no three.js, no DOM.
//
// Frame: game axes, x east, y up, -z north; the door (the player) is on the +z side, so the figure
// faces +z. All sizes in metres.

export type Vec3 = [number, number, number];

export const EGG = {
  /** Outer egg semi-axes: a across (x and z), b high. The kit's egg-placeholder. */
  a: 0.95, b: 1.3,
  /** Inner egg: scale of the outer, and its centre's drop below the outer's (m). */
  innerScale: 0.6, innerDy: -0.12,
  /** The warm core glow behind the figure: centre offset from the inner centre, Gaussian scale (x, y, z), gain. */
  coreOffset: [0, 0, -0.2] as Vec3, coreScale: [0.3, 0.5, 0.18] as Vec3, coreGain: 5.0,
  /** The figure's centre offset from the inner centre, and the strength of its absorption (the optical depth through its
   *  middle comes out near 1 at resolve 0.5: a Gaussian blob's peak is strength / blur x sqrt(pi) x its depth scale). */
  figureOffset: [0, -0.02, -0.08] as Vec3, figureStrength: 3.2,
  /** Milk: extinction per metre inside the inner egg, the inner front surface's alpha, the outer shell's alpha. */
  milkSigma: 1.4, milkFront: 0.18, shellAlpha: 0.3,
  /** Figure blur at resolve 0 (far) and 1 (sharpest): a multiplier on the blobs' widths. */
  blurFar: 1.7, blurNear: 1.0,
  /** The default `egg.resolve` setting (0 = always a smudge, 1 = sharpens fully when you are close). */
  resolveDefault: 0.5,
  /** Resolve ramps from 0 at resolveFar to the setting at resolveNear (m from the egg's centre). */
  resolveNear: 1.8, resolveFar: 5.0,
  /** Proximity (pulse speed-up) ramps from 0 at proxFar to 1 at proxNear. */
  proxNear: 1.8, proxFar: 6.0,
  /** Beats per second: the base, and what is added at proximity 1. */
  pulseRate: 1.0, pulseRateNear: 1.6,
  /** Surface spots on the inner egg. */
  spots: 24,
} as const;

/** The figure: soft Gaussian blobs, offsets from the figure centre and Gaussian scales (x, y, z), at innerScale 0.6. */
export const FIGURE: ReadonlyArray<{ pos: Vec3; sc: Vec3 }> = [
  { pos: [0.01, -0.10, 0], sc: [0.20, 0.32, 0.14] },   // body
  { pos: [-0.07, 0.25, 0], sc: [0.12, 0.13, 0.10] },   // head
  { pos: [0.17, -0.18, 0], sc: [0.08, 0.20, 0.07] },   // limb
  { pos: [-0.16, -0.26, 0], sc: [0.07, 0.18, 0.06] },  // limb
  { pos: [0.13, 0.15, 0], sc: [0.10, 0.13, 0.08] },    // hump
];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Ray vs an axis-aligned ellipsoid (centre c, semi-axes r). [t0, t1] along the unit ray, or null when it misses or lies behind. */
export function rayEllipsoid(o: Vec3, d: Vec3, c: Vec3, r: Vec3): [number, number] | null {
  const oq: Vec3 = [(o[0] - c[0]) / r[0], (o[1] - c[1]) / r[1], (o[2] - c[2]) / r[2]];
  const dq: Vec3 = [d[0] / r[0], d[1] / r[1], d[2] / r[2]];
  const a = dot(dq, dq), b = dot(oq, dq), cc = dot(oq, oq) - 1;
  const disc = b * b - a * cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t1 = (-b + s) / a;
  if (t1 < 0) return null;
  return [(-b - s) / a, t1];
}

/** Line integral of exp(-|(p - c) / s|^2) along the unit ray o + t d, in closed form, and the t of closest approach. */
export function gaussLine(o: Vec3, d: Vec3, c: Vec3, s: Vec3): { value: number; t: number } {
  const oq: Vec3 = [(o[0] - c[0]) / s[0], (o[1] - c[1]) / s[1], (o[2] - c[2]) / s[2]];
  const dq: Vec3 = [d[0] / s[0], d[1] / s[1], d[2] / s[2]];
  const dd = dot(dq, dq);
  const t = -dot(oq, dq) / dd;
  const h: Vec3 = [oq[0] + dq[0] * t, oq[1] + dq[1] * t, oq[2] + dq[2] * t];
  return { value: (Math.sqrt(Math.PI) / Math.sqrt(dd)) * Math.exp(-dot(h, h)), t };
}

/** The inner egg's centre for an egg centred at `c`. */
export function innerCentre(c: Vec3): Vec3 {
  return [c[0], c[1] + EGG.innerDy, c[2]];
}

/** The figure's blur multiplier at a resolve value 0..1. */
export function blurFor(resolve: number): number {
  return EGG.blurFar + (EGG.blurNear - EGG.blurFar) * clamp01(resolve);
}

/** Optical depth of the figure along a ray. Only blobs whose closest approach comes before `tCore`
 *  (in front of the glow, from this side) count: default Infinity = all of them. */
export function figureTau(o: Vec3, d: Vec3, egg: Vec3, resolve: number, tCore: number = Infinity): number {
  const blur = blurFor(resolve), k = EGG.innerScale / 0.6, ci = innerCentre(egg);
  let tau = 0;
  for (const b of FIGURE) {
    const pos: Vec3 = [
      ci[0] + (EGG.figureOffset[0] + b.pos[0]) * k, ci[1] + (EGG.figureOffset[1] + b.pos[1]) * k, ci[2] + (EGG.figureOffset[2] + b.pos[2]) * k,
    ];
    const g = gaussLine(o, d, pos, [b.sc[0] * k * blur, b.sc[1] * k * blur, b.sc[2] * k * blur]);
    // Dividing by the blur keeps a blob's peak absorption constant while it spreads.
    if (g.t < tCore) tau += (EGG.figureStrength / blur) * g.value;
  }
  return tau;
}

/** The core glow's line integral (x gain) along a ray, and its t of closest approach. */
export function coreEmission(o: Vec3, d: Vec3, egg: Vec3): { value: number; t: number } {
  const k = EGG.innerScale / 0.6, ci = innerCentre(egg);
  const g = gaussLine(o, d,
    [ci[0] + EGG.coreOffset[0] * k, ci[1] + EGG.coreOffset[1] * k, ci[2] + EGG.coreOffset[2] * k],
    [EGG.coreScale[0] * k, EGG.coreScale[1] * k, EGG.coreScale[2] * k]);
  return { value: g.value * EGG.coreGain, t: g.t };
}

/** Transmittance of the milk over a chord of `len` metres inside the inner egg. */
export function innerTransmit(len: number): number {
  return Math.exp(-EGG.milkSigma * len);
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Spot i of n: a unit direction on the inner egg (a golden spiral). */
export function spotDirection(i: number, n: number = EGG.spots): Vec3 {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = i * GOLDEN;
  return [Math.cos(phi) * r, y, Math.sin(phi) * r];
}

/** Spot i's angular radius (rad): 0.10 to 0.31. */
export function spotRadius(i: number): number {
  return 0.1 + 0.035 * ((i * 5) % 7);
}

/** A heartbeat: a strong thump at phase 0, a softer one at 0.28; 0..1. */
export function eggBeat(phase: number): number {
  const p = phase - Math.floor(phase);
  const g = (x: number, w: number) => Math.exp(-((x / w) ** 2));
  return Math.min(1, g(p, 0.07) + 0.6 * g(p - 0.28, 0.09) + g(p - 1, 0.07));
}

/** The pulse the glow follows: never fully dark. */
export function eggPulse(phase: number): number {
  return 0.55 + 0.45 * eggBeat(phase);
}

/** 0 beyond proxFar, 1 within proxNear. */
export function eggProximity(dist: number): number {
  return 1 - smoothstep(EGG.proxNear, EGG.proxFar, dist);
}

/** The beat phase after dt seconds; the rate rises with proximity. Result in 0..1. */
export function advancePhase(phase: number, dt: number, prox: number): number {
  const p = phase + dt * (EGG.pulseRate + EGG.pulseRateNear * prox);
  return p - Math.floor(p);
}

/** How well the figure resolves: 0 at range, `setting` at point blank. */
export function eggResolve(dist: number, setting: number): number {
  return clamp01(setting) * (1 - smoothstep(EGG.resolveNear, EGG.resolveFar, dist));
}
```

- [ ] **Step 4: Run it — it must pass**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/egg-look.test.ts 2>&1 | tail -8
npx tsc --noEmit 2>&1 | tail -5
```

Expected: all tests pass; `tsc` prints nothing. If the "from behind, the glow wins" test fails, the core's closest-approach `t` and the blobs' are in the wrong order for that ray: check `coreOffset` is **−z** (behind the figure from the door) — that is the intended geometry.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/egg-look.ts src/lab/sdf-zombie/webgpu/egg-look.test.ts
git commit -m "feat(egg): pure twin — ellipsoid rays, analytic soft figure, spots, pulse and resolve

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 2: `egg.wgsl.ts` — the shader

**Files:** Create `src/lab/sdf-zombie/webgpu/egg.wgsl.ts` and `src/lab/sdf-zombie/webgpu/egg.wgsl.test.ts`.

- [ ] **Step 1: Write the test**

Create `src/lab/sdf-zombie/webgpu/egg.wgsl.test.ts`:

```ts
// src/lab/sdf-zombie/webgpu/egg.wgsl.test.ts

import { describe, expect, it } from 'vitest';
import { EGG_GAUSS, EGG_RAY, EGG_SHADE, EGG_SPOTS, EGG_VEINS } from './egg.wgsl';
import { EGG, FIGURE } from './egg-look';

describe('egg.wgsl', () => {
  it('each string declares exactly one fn', () => {
    for (const s of [EGG_RAY, EGG_GAUSS, EGG_SPOTS, EGG_VEINS, EGG_SHADE]) {
      expect(s.trim().startsWith('fn ')).toBe(true);
      expect(s.match(/^fn /gm)).toHaveLength(1);
    }
  });
  it('is built from the twin\'s tables', () => {
    expect(EGG_SHADE).toContain(`array<vec3<f32>, ${FIGURE.length}>`);
    expect(EGG_SHADE).toContain(`j < ${FIGURE.length}`);
    expect(EGG_SPOTS).toContain(`i < ${EGG.spots}`);
    for (const b of FIGURE) expect(EGG_SHADE).toContain(`vec3<f32>(${b.sc[0]}`);
  });
  it('the golden angle matches the twin', () => {
    expect(EGG_SPOTS).toContain(String(Math.PI * (3 - Math.sqrt(5))).slice(0, 7));
  });
  it('writes premultiplied colour and alpha = 1 - transmittance', () => {
    expect(EGG_SHADE).toContain('return vec4<f32>(col, 1.0 - T);');
  });
});
```

- [ ] **Step 2: Run it — it must fail**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/egg.wgsl.test.ts 2>&1 | tail -6
```

Expected: FAIL (module missing).

- [ ] **Step 3: Write the shader**

Create `src/lab/sdf-zombie/webgpu/egg.wgsl.ts`:

```ts
// src/lab/sdf-zombie/webgpu/egg.wgsl.ts
//
// The control room's egg (spec 2026-09-30-night-train-egg-ending-design.md §2), hand-written WGSL.
// One proxy box per egg; per pixel the view ray is intersected analytically with three nested
// ellipsoids and composed front to back in a fixed order, so the egg needs no transparency sorting
// while the player walks round it:
//   outer shell front (veins, fresnel) -> inner egg front (milk, spots) -> inside the inner egg
//   (milk volume, the core glow, the soft figure) -> inner egg back (spots) -> outer shell back.
// The figure and the glow are Gaussians integrated in closed form along the ray, so there is no
// marching. Output is premultiplied colour with alpha = 1 - transmittance. Twin: egg-look.ts; its
// tables (EGG, FIGURE) build the constants here. One fn per string (wgslFn takes one).

import { EGG, FIGURE } from './egg-look';

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const v3 = (v: readonly number[]) => `vec3<f32>(${f(v[0]!)}, ${f(v[1]!)}, ${f(v[2]!)})`;

/** Ray vs ellipsoid: (t0, t1), or (1, -1) when it misses or lies behind. */
export const EGG_RAY = /* wgsl */ `fn eggRay(o: vec3<f32>, d: vec3<f32>, c: vec3<f32>, r: vec3<f32>) -> vec2<f32> {
  let oq = (o - c) / r;
  let dq = d / r;
  let a = dot(dq, dq);
  let b = dot(oq, dq);
  let cc = dot(oq, oq) - 1.0;
  let disc = b * b - a * cc;
  if (disc < 0.0) { return vec2<f32>(1.0, -1.0); }
  let s = sqrt(disc);
  let t1 = (-b + s) / a;
  if (t1 < 0.0) { return vec2<f32>(1.0, -1.0); }
  return vec2<f32>((-b - s) / a, t1);
}`;

/** Closed-form line integral of exp(-|(p - c) / s|^2) along the ray, and the t of closest approach. */
export const EGG_GAUSS = /* wgsl */ `fn eggGauss(o: vec3<f32>, d: vec3<f32>, c: vec3<f32>, s: vec3<f32>) -> vec2<f32> {
  let oq = (o - c) / s;
  let dq = d / s;
  let dd = dot(dq, dq);
  let t = -dot(oq, dq) / dd;
  let h = oq + dq * t;
  return vec2<f32>(1.7724539 / sqrt(dd) * exp(-dot(h, h)), t);
}`;

/** Spot coverage 0..1 at a unit direction on the inner egg: golden-spiral centres, radii 0.10 to 0.31 rad. */
export const EGG_SPOTS = /* wgsl */ `fn eggSpots(u: vec3<f32>) -> f32 {
  var best = 0.0;
  for (var i = 0; i < ${EGG.spots}; i = i + 1) {
    let fi = f32(i);
    let y = 1.0 - 2.0 * (fi + 0.5) / ${f(EGG.spots)};
    let r = sqrt(max(0.0, 1.0 - y * y));
    let phi = fi * ${String(Math.PI * (3 - Math.sqrt(5)))};
    let dir = vec3<f32>(cos(phi) * r, y, sin(phi) * r);
    let rad = 0.1 + 0.035 * f32((i * 5) % 7);
    let ang = acos(clamp(dot(u, dir), -1.0, 1.0));
    best = max(best, 1.0 - smoothstep(rad * 0.75, rad, ang));
  }
  return best;
}`;

/** Red veins on the outer shell: nine wobbling meridians that thin out towards the poles. 0..1. */
export const EGG_VEINS = /* wgsl */ `fn eggVeins(u: vec3<f32>) -> f32 {
  let th = acos(clamp(u.y, -1.0, 1.0));
  let ph = atan2(u.z, u.x);
  var v = 0.0;
  for (var i = 0; i < 9; i = i + 1) {
    let fi = f32(i);
    let base = 6.2831853 * fi / 9.0 + 0.3 * sin(fi * 2.3);
    var dph = ph - base - 0.25 * sin(th * 3.2 + fi * 1.7);
    dph = dph - 6.2831853 * floor(dph / 6.2831853 + 0.5);
    let dist = abs(dph) * sin(th);
    v = max(v, exp(-(dist * dist) / 0.0009));
  }
  return v;
}`;

const FIG_POS = FIGURE.map(b => v3(b.pos)).join(', ');
const FIG_SC = FIGURE.map(b => v3(b.sc)).join(', ');

/**
 * The egg's rgba for a proxy-box fragment. axes: x outer horizontal semi-axis, y outer vertical,
 * z inner scale, w the inner centre's drop. look: x pulse 0..1, y resolve 0..1, z sim time.
 * milk: x extinction per metre, y inner front alpha, z shell alpha, w the figure's strength.
 * Includes: eggRay, eggGauss, eggSpots, eggVeins.
 */
export const EGG_SHADE = /* wgsl */ `fn eggShade(wpos: vec3<f32>, eye: vec3<f32>, c: vec3<f32>, axes: vec4<f32>, look: vec4<f32>, milk: vec4<f32>) -> vec4<f32> {
  let o = eye;
  let d = normalize(wpos - eye);
  let outerR = vec3<f32>(axes.x, axes.y, axes.x);
  let ro = eggRay(o, d, c, outerR);
  if (ro.x > ro.y) { return vec4<f32>(0.0); }
  let pulse = look.x;
  let blur = mix(${f(EGG.blurFar)}, ${f(EGG.blurNear)}, clamp(look.y, 0.0, 1.0));
  var col = vec3<f32>(0.0);
  var T = 1.0;

  // Outer shell, front face: a thin warm film, brighter at grazing angles, with red veins.
  let pf = o + d * ro.x;
  let nf = normalize((pf - c) / (outerR * outerR));
  let fresF = pow(1.0 - abs(dot(nf, d)), 2.5);
  let aSF = milk.z * (0.35 + 0.65 * fresF);
  let aVF = 0.55 * eggVeins(normalize((pf - c) / outerR));
  let shellF = vec3<f32>(0.95, 0.55, 0.38) * (0.25 + 0.75 * fresF) * (0.6 + 0.6 * pulse);
  let veinCol = vec3<f32>(0.9, 0.08, 0.05) * (0.5 + 1.1 * pulse);
  col = col + T * (shellF * aSF + veinCol * aVF * (1.0 - aSF));
  T = T * (1.0 - aSF) * (1.0 - aVF);

  // Inner egg.
  let k = axes.z;
  let ci = c + vec3<f32>(0.0, axes.w, 0.0);
  let innerR = outerR * k;
  let ri = eggRay(o, d, ci, innerR);
  if (ri.x <= ri.y) {
    let chord = ri.y - ri.x;
    let tm = exp(-milk.x * chord);
    let milkCol = vec3<f32>(0.86, 0.88, 0.82) * (0.22 + 0.4 * pulse);
    let spotCol = vec3<f32>(0.45, 0.85, 0.85) * (0.45 + 0.55 * pulse);

    // Front surface: a little milk and the spots.
    let ui = normalize((o + d * ri.x - ci) / innerR);
    let aMF = milk.y;
    let aSpF = 0.8 * eggSpots(ui);
    col = col + T * (milkCol * aMF + spotCol * aSpF * (1.0 - aMF));
    T = T * (1.0 - aMF) * (1.0 - aSpF);

    // Inside: the core glow, and the figure in front of it (from this side) darkening it.
    let kk = k / ${f(EGG.innerScale)};
    let gc = eggGauss(o, d, ci + ${v3(EGG.coreOffset)} * kk, ${v3(EGG.coreScale)} * kk);
    let fo = ${v3(EGG.figureOffset)};
    var bp = array<vec3<f32>, ${FIGURE.length}>(${FIG_POS});
    var bs = array<vec3<f32>, ${FIGURE.length}>(${FIG_SC});
    var tauFront = 0.0;
    var tauAll = 0.0;
    for (var j = 0; j < ${FIGURE.length}; j = j + 1) {
      let g = eggGauss(o, d, ci + (fo + bp[j]) * kk, bs[j] * kk * blur);
      let tj = milk.w / blur * g.x;
      tauAll = tauAll + tj;
      if (g.y < gc.y) { tauFront = tauFront + tj; }
    }
    let coreCol = vec3<f32>(1.0, 0.55, 0.25);
    let emit = coreCol * ${f(EGG.coreGain)} * gc.x * (0.55 + 0.45 * pulse) * exp(-tauFront) * sqrt(tm);
    let scatter = milkCol * (1.0 - tm) * 0.55;
    col = col + T * (emit + scatter);
    T = T * tm * exp(-tauAll * 0.7);

    // Back surface: the spots seen through the milk.
    let ub = normalize((o + d * ri.y - ci) / innerR);
    let aSpB = 0.25 * eggSpots(ub);
    col = col + T * spotCol * aSpB * 0.8;
    T = T * (1.0 - aSpB);
  }

  // Outer shell, back face.
  let pb = o + d * ro.y;
  let nb = normalize((pb - c) / (outerR * outerR));
  let fresB = pow(1.0 - abs(dot(nb, d)), 2.5);
  let aSB = milk.z * (0.3 + 0.7 * fresB);
  let aVB = 0.35 * eggVeins(normalize((pb - c) / outerR));
  let shellB = vec3<f32>(0.95, 0.55, 0.38) * (0.25 + 0.75 * fresB) * (0.6 + 0.6 * pulse);
  col = col + T * (shellB * aSB + veinCol * aVB * (1.0 - aSB));
  T = T * (1.0 - aSB) * (1.0 - aVB);
  return vec4<f32>(col, 1.0 - T);
}`;
```

- [ ] **Step 4: Run the test and the type check**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/egg.wgsl.test.ts src/lab/sdf-zombie/webgpu/egg-look.test.ts 2>&1 | tail -8
npx tsc --noEmit 2>&1 | tail -5
```

Expected: both test files pass; `tsc` clean. (If the "golden angle" assertion fails on formatting, print `String(Math.PI * (3 - Math.sqrt(5)))` and make the test slice match what the template emits — they use the same expression, so only the test's slice length can be wrong.)

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/egg.wgsl.ts src/lab/sdf-zombie/webgpu/egg.wgsl.test.ts
git commit -m "feat(egg): WGSL — nested analytic ellipsoids, soft Gaussian figure, spots, veins

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 3: The leaf, the world slice, and the wiring

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-egg-leaves.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-state-world.ts` (type import line ~26, field near line 75, default near 136, `WORLD_BINDINGS` near 173)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (import line ~105; `createEgg` after `createDisco(ctx);` ~974; `adoptEggFx` after `adoptDiscoFx(ctx);` ~1274; `stepEgg` after `stepDisco(ctx);` ~7084; `createEggSeams(ctx)` after `createDiscoSeams(ctx)` ~8678)

- [ ] **Step 1: Write the leaf**

Create `src/lab/sdf-zombie/webgpu/game-egg-leaves.ts`:

```ts
// src/lab/sdf-zombie/webgpu/game-egg-leaves.ts
//
// THE CONTROL ROOM'S EGG in the game (spec 2026-09-30-night-train-egg-ending-design.md §2): finds the
// plan-1 placeholder egg in the level art (material train.egg), hides it, and draws the real one as a
// single WGSL pass (egg.wgsl.ts) on a proxy box in the SDF layer's late scene, so it hangs over the
// flesh and depth-tests against the level. Decisions are pure (egg-look.ts): the pulse, how the
// figure resolves with distance. A level with no egg gets null and nothing changes.
//
// The proxy box (front faces) hugs the outer egg, so its depth is a conservative stand-in for the
// egg's; the plinth (radius 1.2 m) keeps the player out of the box, so the eye is never inside it.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraPosition, positionWorld, uniform, wgslFn } from 'three/tsl';
import type { GameContext } from './game-context';
import { EGG, advancePhase, eggPulse, eggProximity, eggResolve, type Vec3 } from './egg-look';
import { EGG_GAUSS, EGG_RAY, EGG_SHADE, EGG_SPOTS, EGG_VEINS } from './egg.wgsl';
import { roomIdAt } from './game-level-leaves';
import { nearRoomMask } from './game-light-list-leaves';

/** The proxy box is this much bigger than the outer egg on every side (m). */
const PAD_M = 0.15;

type Include = NonNullable<Parameters<typeof wgslFn>[1]>[number];

export interface EggRuntime {
  /** The plan-1 placeholder (hidden while the real egg draws). */
  placeholder: THREE.Mesh;
  room: number;
  /** The egg's centre (world). */
  centre: Vec3;
  proxy: THREE.Mesh;
  /** Shader inputs. look = (pulse, resolve, time, 0). */
  look: { value: THREE.Vector4 };
  /** The beat phase 0..1, the train clock at the last step, the pulse and resolve this step. */
  phase: number;
  lastT: number;
  pulse: number;
  resolve: number;
  dist: number;
  /** Look controls: the resolve setting, a held pulse (null = live), and `off` (measurement: placeholder instead). */
  resolveSetting: number;
  holdPulse: number | null;
  off: boolean;
}

const matName = (m: THREE.Mesh): string => {
  const mat = Array.isArray(m.material) ? m.material[0] : m.material;
  return (mat?.name ?? '') as string;
};

/** Find the placeholder, build the proxy and uniforms. Before the per-room light lists (the proxy is
 *  unlit). Null without a placeholder egg. */
export function createEgg(ctx: GameContext): EggRuntime | null {
  const objects = (ctx.world.art?.objects ?? []) as THREE.Mesh[];
  const placeholder = objects.find(m => !!m.isMesh && (m.name.includes('train.egg') || matName(m).includes('train.egg')));
  if (!placeholder) return null;
  placeholder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(placeholder);
  const centre: Vec3 = [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2];
  const room = typeof placeholder.userData.room === 'number' ? (placeholder.userData.room as number) : roomIdAt(ctx, centre[0], centre[2]);

  const inc = (fn: ReturnType<typeof wgslFn>) => fn as unknown as Include;
  const shade = wgslFn(EGG_SHADE, [inc(wgslFn(EGG_RAY)), inc(wgslFn(EGG_GAUSS)), inc(wgslFn(EGG_SPOTS)), inc(wgslFn(EGG_VEINS))]);
  const look = uniform(new THREE.Vector4(0.6, EGG.resolveDefault, 0, 0));
  const mat = new MeshBasicNodeMaterial();
  mat.colorNode = shade({
    wpos: positionWorld, eye: cameraPosition,
    c: uniform(new THREE.Vector3(centre[0], centre[1], centre[2])),
    axes: uniform(new THREE.Vector4(EGG.a, EGG.b, EGG.innerScale, EGG.innerDy)),
    look,
    milk: uniform(new THREE.Vector4(EGG.milkSigma, EGG.milkFront, EGG.shellAlpha, EGG.figureStrength)),
  }) as never;
  mat.transparent = true;
  mat.premultipliedAlpha = true;
  mat.blending = THREE.NormalBlending;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.side = THREE.FrontSide;
  mat.fog = false;
  mat.name = 'train.egg-pass';

  const proxy = new THREE.Mesh(new THREE.BoxGeometry(2 * EGG.a + 2 * PAD_M, 2 * EGG.b + 2 * PAD_M, 2 * EGG.a + 2 * PAD_M), mat);
  proxy.position.set(centre[0], centre[1], centre[2]);
  proxy.name = 'train.egg-pass';
  proxy.castShadow = false;
  proxy.receiveShadow = false;
  proxy.userData.skipLevelLights = true;
  ctx.boot.handle.scene.add(proxy);   // moved to the late-effects scene by adoptEggFx
  placeholder.visible = false;

  const rt: EggRuntime = {
    placeholder, room, centre, proxy, look: look as unknown as { value: THREE.Vector4 },
    phase: 0, lastT: 0, pulse: 0.6, resolve: 0, dist: 99,
    resolveSetting: EGG.resolveDefault, holdPulse: null, off: false,
  };
  ctx.world.egg = rt;
  return rt;
}

/** Once the SDF layer exists: the egg draws after the bodies (sdf-layer lateScene). */
export function adoptEggFx(ctx: GameContext): void {
  const late = ctx.render.sdfLayer?.lateScene, rt = ctx.world.egg;
  if (late && rt) late.add(rt.proxy);
}

/** Per sim step: the pulse (on the train clock, quickening as you close in), how far the figure
 *  resolves, and whether the egg is near enough to draw. */
export function stepEgg(ctx: GameContext): void {
  const rt = ctx.world.egg;
  if (!rt) return;
  const [px, , pz] = ctx.player.player.pos;
  rt.dist = Math.hypot(px - rt.centre[0], pz - rt.centre[2]);
  const near = nearRoomMask(ctx.world.level.tunnels, roomIdAt(ctx, px, pz), px, pz);
  const show = !rt.off && (near === 0 || (rt.room >= 0 && rt.room < 31 && (near & (1 << rt.room)) !== 0));
  rt.proxy.visible = show;
  rt.placeholder.visible = rt.off;
  if (!show) return;
  const t = ctx.world.train?.time.value ?? 0;
  const dt = Math.max(0, Math.min(0.25, t - rt.lastT));
  rt.lastT = t;
  rt.phase = advancePhase(rt.phase, dt, eggProximity(rt.dist));
  rt.pulse = rt.holdPulse ?? eggPulse(rt.phase);
  rt.resolve = eggResolve(rt.dist, rt.resolveSetting);
  rt.look.value.set(rt.pulse, rt.resolve, t, 0);
}

/** Seams: `__sdfGame.egg()` and `setEgg({ off, resolve, pulse })` (look and cost checks only). */
export function createEggSeams(ctx: GameContext) {
  return {
    egg: () => {
      const rt = ctx.world.egg;
      if (!rt) return null;
      return {
        room: rt.room, centre: rt.centre.map(v => +v.toFixed(3)), visible: rt.proxy.visible,
        inLateScene: rt.proxy.parent?.name === 'sdf.late-fx', placeholderVisible: rt.placeholder.visible,
        pulse: +rt.pulse.toFixed(4), resolve: +rt.resolve.toFixed(4), phase: +rt.phase.toFixed(4),
        dist: +rt.dist.toFixed(3), resolveSetting: rt.resolveSetting, holdPulse: rt.holdPulse, off: rt.off,
        material: (rt.proxy.material as THREE.Material).name, placeholderName: rt.placeholder.name,
      };
    },
    setEgg: (o: { off?: boolean; resolve?: number; pulse?: number | null }) => {
      const rt = ctx.world.egg;
      if (!rt) return null;
      if (o.off !== undefined) rt.off = o.off;
      if (o.resolve !== undefined) rt.resolveSetting = o.resolve;
      if (o.pulse !== undefined) rt.holdPulse = o.pulse;
      return { off: rt.off, resolveSetting: rt.resolveSetting, holdPulse: rt.holdPulse };
    },
  };
}
```

- [ ] **Step 2: Add the world-slice field**

In `src/lab/sdf-zombie/webgpu/game-state-world.ts`, mirroring `disco`:
1. After `import type { DiscoRuntime } from './game-disco-leaves';` add `import type { EggRuntime } from './game-egg-leaves';`.
2. After the `disco: DiscoRuntime | null;` field (and its doc comment) add:

```ts
  /** The control room's egg: the real one (WGSL pass) replacing the placeholder; null without one. */
  egg: EggRuntime | null;
```

3. After `disco: null,` in `makeWorldState` add `egg: null,`.
4. In `WORLD_BINDINGS`, after `disco: 'world.disco',` add `egg: 'world.egg',`.

- [ ] **Step 3: Wire `game-main.ts`**

Five one-line additions, each beside its disco twin:

```ts
import { adoptEggFx, createEgg, createEggSeams, stepEgg } from './game-egg-leaves';   // after the game-disco-leaves import (~105)
```
```ts
  // The control room's egg (after the level art exists; before the light lists: unlit).
  createEgg(ctx);                                  // after createDisco(ctx); (~974)
```
```ts
  adoptEggFx(ctx);                                 // after adoptDiscoFx(ctx); (~1274)
```
```ts
    stepEgg(ctx);                                  // after stepDisco(ctx); (~7084)
```
```ts
    createEggSeams(ctx),                           // after createDiscoSeams(ctx), (~8678)
```

Before editing, `grep -n "setEgg\|egg:" src/lab/sdf-zombie/webgpu/game-main.ts src/lab/sdf-zombie/webgpu/game-seams*.ts` to be sure no seam named `egg` or `setEgg` exists already.

- [ ] **Step 4: Type-check and run the structure tests**

```bash
npx tsc --noEmit 2>&1 | tail -10
npx vitest run src/lab/sdf-zombie/webgpu/game-state-world.test.ts src/lab/sdf-zombie/webgpu/game-context.test.ts src/lab/sdf-zombie/webgpu/egg-look.test.ts src/lab/sdf-zombie/webgpu/egg.wgsl.test.ts 2>&1 | tail -10
```

Expected: clean `tsc`; all pass. If `wgslFn(...)` results do not type-check as `Include`, copy the cast used in `game-void-leaves.ts` line 38 (`include`) or `game-train-leaves.ts` line 95-100 exactly. If `mat.colorNode = shade({...}) as never` is rejected, use the same `as unknown as ReturnType<typeof vec4>` pattern as `game-disco-leaves.ts`.

- [ ] **Step 5: Boot smoke test in headless Chrome**

Start the repo's own servers through a throwaway script run (Task 4 builds the real check; this is a first look). Run the existing train gate's boot only, or:

```bash
export LAB_TMP=.lab-tmp
TRAIN_GATE_SHOT=.lab-tmp/egg-smoke bash scripts/sdf-game-train-gate.sh 2>&1 | tail -12
```

Expected: `PASS sdf-game-train-gate` and **no renderer pipeline errors** in its output. Open `.lab-tmp/egg-smoke/train-control.png` (the door view) with the Read tool: the placeholder's flat grey-white blob must be gone, replaced by the nested egg. If the page shows a WGSL compile error in the console, the gate prints it: fix the WGSL (common causes: a name clash with a WGSL builtin, `array` indexing with a non-`var`, a missing include). If the egg is **invisible** (the room looks empty), check in order: (a) `__sdfGame.egg()` returns non-null, (b) `visible` is true, (c) `inLateScene` is true, (d) `placeholderVisible` is false — then look at depth: the proxy's front faces must be in front of the plinth drum.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-egg-leaves.ts src/lab/sdf-zombie/webgpu/game-state-world.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "feat(egg): the egg pass in the game — proxy box in the late scene, pulse on the train clock

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 4: The check script

**Files:** Create `scripts/sdf-egg-check.mjs` and `scripts/sdf-egg-check.sh`.

- [ ] **Step 1: The wrapper**

Create `scripts/sdf-egg-check.sh` (then `chmod +x`):

```bash
#!/usr/bin/env bash
# Headless check for the control room's egg (scripts/sdf-egg-check.mjs). Owns its own vite + Chrome
# via the shared lifecycle, on its own port pair (not the disco check's 5367/9367).
#
# NEVER kill a server you did not start (scripts/lab-servers.sh says why).
# In a sandbox, export LAB_TMP=.lab-tmp or Chrome produces no frames.
#   EGG_SHEET=docs/dev-notes/2026-09-30-egg-ending/egg-pass.png scripts/sdf-egg-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5373}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9373}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-egg-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
```

- [ ] **Step 2: The script's plumbing**

Create `scripts/sdf-egg-check.mjs` by copying `scripts/sdf-disco-check.mjs` **lines 1-95 verbatim** (imports, `tab`/`ws` setup, `send`, `evaluate`, `boot`, the viewport override, `shoot`, `stepN`, `median`) and these two PNG helpers from `scripts/sdf-game-train-gate.mjs` (`decodePng`, lines ~71-112, and `meanRgb`, lines ~114-122; read `meanRgb`'s signature there and use it as written). Then:
- rewrite the header comment to describe this check's sections (below);
- rename `DISCO_SHOTS`/`DISCO_SHEET`/`DISCO_QUERY` to `EGG_SHOTS`/`EGG_SHEET`/`EGG_QUERY` and the default shot directory to `egg-shots`;
- replace the `disco` helper with `const egg = () => evaluate('__sdfGame.egg()');`;
- delete the disco-specific poses and sections.

Then append the sections below. `luma(img, box)` is the mean of `meanRgb`'s channels weighted `0.2126 R + 0.7152 G + 0.0722 B`; `shootImg(name)` is `shoot` that also returns the decoded image (`decodePng` of the PNG buffer it writes — extend `shoot` to return it).

- [ ] **Step 3: The sections**

```js
// Poses: x, z, yaw, pitch. The egg is at x 0, z -136.7; the completion box is z -135.1..-138.3 (never enter it:
// a level.end ends the run), the plinth fills z -135.5..-137.9.
const FAR = '0, -131.4, 0, 0';      // the door, 5.3 m
const MID = '0, -133.4, 0, 0';      // 3.3 m
const NEAR = '0, -134.9, 0, 0';     // 1.8 m, at the edge of the completion box
const BEHIND = `0, -139.0, ${Math.PI}, 0`;   // between the egg and the CRT wall, looking back south at it
const q = 'level=night-train&frozen&nospawn&god' + (process.env.EGG_QUERY ?? '');
if (!(await boot(q))) { console.error(consoleEvents.slice(-8)); fail(`night-train did not boot (${q})`); }
await evaluate(`document.getElementById('loader')?.classList.add('loader-hidden')`);
for (const c of ['setFlashlight(false)', 'setDemoHold(true)', 'holdWindowLight(0, -1)', 'setLightClockFrozen(true)', 'setLightTime(0)']) await evaluate(`__sdfGame.${c}`);
const at = async (pose) => { await evaluate(`__sdfGame.setPose(${pose})`); await sleep(1500); await evaluate(`__sdfGame.setPose(${pose})`); await stepN(6); };

// 1. WIRING.
await at(FAR);
let E = await egg();
if (!E) fail('no egg() seam / no placeholder egg on night-train');
if (E.room !== 8) fail(`egg in room ${E.room}, not the control room`);
if (!E.inLateScene) fail('the egg proxy is not in the late scene');
if (!E.visible) fail(`the egg proxy is hidden at the door: ${JSON.stringify(E)}`);
if (E.placeholderVisible) fail('the placeholder egg is still drawn');
if (Math.abs(E.centre[0]) > 0.05 || Math.abs(E.centre[2] + 136.7) > 0.05 || Math.abs(E.centre[1] - 1.6) > 0.1) fail(`egg centre ${E.centre} is not (0, 1.6, -136.7)`);
pass(`wiring: egg at ${E.centre}, proxy ${E.material} in the late scene, placeholder hidden`);
const imgOn = await shootImg('1-door');

// 2. IT DRAWS: with the pass off (the placeholder back) the egg region differs; the pass is not blank.
// The egg region of the frame at the door pose; adjust the box if the first shots show the egg elsewhere.
const EGG_BOX = [0.36, 0.18, 0.64, 0.82];
await evaluate('__sdfGame.setEgg({ off: true })'); await stepN(2);
const imgOff = await shootImg('2-placeholder');
await evaluate('__sdfGame.setEgg({ off: false })'); await stepN(2);
const lOn = luma(imgOn, EGG_BOX), lOff = luma(imgOff, EGG_BOX);
if (Math.abs(lOn - lOff) < 3) fail(`the egg pass looks the same as the placeholder (luma ${lOn.toFixed(1)} vs ${lOff.toFixed(1)})`);
pass(`draws: egg region luma ${lOn.toFixed(1)} (pass) vs ${lOff.toFixed(1)} (placeholder)`);

// 3. PULSE: held at 0 and at 1 the egg region differs; live it varies over 2 s of steps.
await evaluate('__sdfGame.setEgg({ pulse: 0 })'); await stepN(2);
const lP0 = luma(await shootImg('3-pulse0'), EGG_BOX);
await evaluate('__sdfGame.setEgg({ pulse: 1 })'); await stepN(2);
const lP1 = luma(await shootImg('3-pulse1'), EGG_BOX);
if (!(lP1 > lP0 * 1.08)) fail(`pulse 1 is not brighter than pulse 0 (${lP1.toFixed(1)} vs ${lP0.toFixed(1)})`);
await evaluate('__sdfGame.setEgg({ pulse: null })');
const seen = new Set();
for (let i = 0; i < 40; i++) { await stepN(3, 1 / 30); seen.add((await egg()).pulse.toFixed(2)); }
if (seen.size < 4) fail(`the live pulse barely moves (${[...seen]})`);
pass(`pulse: held 0 -> ${lP0.toFixed(1)}, held 1 -> ${lP1.toFixed(1)} (+${((lP1 / lP0 - 1) * 100).toFixed(0)}%); live pulse took ${seen.size} distinct values`);

// 4. THE FIGURE RESOLVES with distance and with the setting. Contrast = how much darker the figure's
// column is than the milk either side of it, at the same height (FIG_BOX centre, SIDE_BOXes either side);
// read the first sheet and adjust the boxes so they bracket the figure at each pose.
const FIG_BOX = [0.46, 0.38, 0.54, 0.62], SIDE_L = [0.36, 0.38, 0.44, 0.62], SIDE_R = [0.56, 0.38, 0.64, 0.62];
const contrast = (img) => { const side = (luma(img, SIDE_L) + luma(img, SIDE_R)) / 2; return (side - luma(img, FIG_BOX)) / Math.max(side, 1e-3); };
await evaluate('__sdfGame.setEgg({ resolve: 0 })');
await at(NEAR); const cN0 = contrast(await shootImg('4-near-resolve0'));
await evaluate('__sdfGame.setEgg({ resolve: 1 })'); await stepN(2);
const cN1 = contrast(await shootImg('4-near-resolve1'));
await at(FAR); const cF1 = contrast(await shootImg('4-far-resolve1'));
E = await egg();
console.log(`     figure contrast: near r0 ${cN0.toFixed(3)}, near r1 ${cN1.toFixed(3)}, far r1 ${cF1.toFixed(3)}`);
if (!(cN1 > cN0 * 1.15)) fail(`the setting does not sharpen the figure near (${cN1.toFixed(3)} vs ${cN0.toFixed(3)})`);
if (!(cF1 < cN1)) fail(`the figure is as clear at range as near (${cF1.toFixed(3)} vs ${cN1.toFixed(3)})`);
if (!(cN1 < 0.6)) fail(`the figure is too clear even soft (${cN1.toFixed(3)}); it should be hard to make out`);
pass(`figure: contrast near ${cN0.toFixed(2)} (resolve 0) -> ${cN1.toFixed(2)} (resolve 1), far ${cF1.toFixed(2)}`);
await evaluate(`__sdfGame.setEgg({ resolve: ${0.5} })`);

// 5. ALL ROUND: the egg draws from behind too (no sorting seam), and is not hollow.
await at(BEHIND);
E = await egg();
if (!E.visible) fail('the egg proxy is hidden behind the egg');
const lBehind = luma(await shootImg('5-behind'), EGG_BOX);
if (!(lBehind > 4)) fail(`from behind the egg region is black (${lBehind.toFixed(1)})`);
pass(`behind: egg region luma ${lBehind.toFixed(1)}`);

// 6. AWAY: in the Boiler Room the proxy is hidden.
await evaluate('__sdfGame.setPose(0, -105.0, 0, 0)'); await stepN(4);
E = await egg();
if (E.visible) fail('the egg proxy is drawn from the Boiler Room');
pass('away: hidden in the Boiler Room');

// 7. COST (report only): the door pose with the pass on vs off, interleaved.
if (!process.env.EGG_SKIP_COST) {
  await at(FAR);
  const on = [], off = [];
  for (let k = 0; k < 5; k++) {
    await evaluate('__sdfGame.setEgg({ off: true })'); await stepN(1, 0); off.push(await evaluate('__sdfGame.timeDraws(9)'));
    await evaluate('__sdfGame.setEgg({ off: false })'); await stepN(1, 0); on.push(await evaluate('__sdfGame.timeDraws(9)'));
  }
  const d = median(on) - median(off);
  console.log(`cost: egg pass on ${median(on).toFixed(2)} ms vs placeholder ${median(off).toFixed(2)} ms (${d >= 0 ? '+' : ''}${d.toFixed(2)} ms, load ${loadavg()[0].toFixed(1)})`);
  if (d > 1.0) console.log('WARN: the egg pass costs more than +1.0 ms');
}

console.log('PASS sdf-egg-check');
process.exit(0);
```

Also add the `EGG_SHEET` contact-sheet step the disco check has (copy its sheet code, which tiles the kept shots with labels) so `EGG_SHEET=<png>` writes one image of: door, near r0, near r1, behind, pulse 0, pulse 1.

- [ ] **Step 4: Run it**

```bash
chmod +x scripts/sdf-egg-check.sh
export LAB_TMP=.lab-tmp
EGG_SHEET=.lab-tmp/egg-sheet.png scripts/sdf-egg-check.sh 2>&1 | tail -25
```

Expected: `PASS sdf-egg-check` after you have set the three screen boxes (`EGG_BOX`, `FIG_BOX`, `SIDE_L/R`) from the first sheet: open `.lab-tmp/egg-shots/*.png` with the Read tool, find where the egg and the figure are at each pose, and edit the fractions so `EGG_BOX` brackets the whole egg at the door pose and the figure box sits on the figure at the near pose. Thresholds (`1.08`, `1.15`, `0.6`) are the plan's intent; if a check fails because the **look** is wrong rather than the box, do not loosen it — that is Task 5's tuning.

- [ ] **Step 5: Commit**

```bash
git add scripts/sdf-egg-check.mjs scripts/sdf-egg-check.sh
git commit -m "test(egg): headless check — wiring, pulse, figure resolve, all-round, away, cost

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Look pass, regressions, notes

**Files:** Modify `src/lab/sdf-zombie/webgpu/egg-look.ts` (the `EGG` and `FIGURE` tables only), `docs/dev-notes/2026-09-30-egg-ending/` (new notes + sheet), `docs/tasks/levels.md`, `TASKS.md`.

- [ ] **Step 1: Compare with the blockout, one lever at a time**

The owner prefers visual/lighting changes slowly, step by step, with side-by-side sheets (project memory). Produce the sheet (`EGG_SHEET=docs/dev-notes/2026-09-30-egg-ending/egg-pass.png scripts/sdf-egg-check.sh`) and look at it beside `egg-close.png` and `control-room-door.png`. The look targets, in the owner's words (2026-09-30):
- the **inner egg is milky, translucent and spotted** (teal spots), not transparent;
- it sits **inside a red, veiny, transparent outer egg**;
- the **silhouette is blurry and hard to make out**, not a clearly defined shape;
- the room keeps its dark, warm, ominous lighting (the egg must not flood the room).

Tune only the named constants in `egg-look.ts`, **one lever per iteration**, re-running the sheet each time, in this order and no further than needed:
1. Figure too faint or too clear: `figureStrength` (absorption), then `blurFar`/`blurNear`, then the blob scales in `FIGURE`.
2. Milk too opaque or too glassy: `milkSigma`, then `milkFront`.
3. Glow too hot or too dim: `coreGain`, then `coreScale`.
4. Spots too sticker-like: `spots` count; their radii are in `spotRadius` (change it in `egg-look.ts` and re-run its test).
5. Outer shell too heavy or too faint: `shellAlpha`.
Edits to the WGSL beyond constants (veins' look, the shell colours, the interior formulas) are allowed only if a constant cannot reach the target — say why in the notes. Keep `egg-look.test.ts` and `egg.wgsl.test.ts` passing after every change (the tests encode structure, not the tuned values).

- [ ] **Step 2: The numbers**

With the final tuning, run the check once more and record in the notes: the figure-contrast line (near r0 / near r1 / far r1), the pulse brightness delta, the cost line, and the cold-boot time against the base commit `81ed9d9d` (run `scripts/sdf-game-train-gate.sh`'s boot or the disco check's boot twice on each commit, fresh profile, and report the medians; ±1.3 s is noise).

- [ ] **Step 3: Regressions**

```bash
export LAB_TMP=.lab-tmp
bash scripts/sdf-game-loop-gate.sh 2>&1 | tail -4
bash scripts/sdf-game-train-gate.sh 2>&1 | tail -14
bash scripts/sdf-disco-check.sh 2>&1 | tail -4
npx vitest run src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts src/lab/sdf-zombie/webgpu/egg-look.test.ts src/lab/sdf-zombie/webgpu/egg.wgsl.test.ts src/lab/sdf-zombie/webgpu/game-state-world.test.ts 2>&1 | tail -6
npx tsc --noEmit 2>&1 | tail -3
```

Expected: all PASS. In the train gate the `control` pose may differ from plan 1's (`+23 draws`) by the proxy-for-placeholder swap (net 0 draws expected; record the number). The loop gate's completion at the egg must still pass (the trigger is unchanged and the proxy has no collision).

- [ ] **Step 4: Notes and task board**

Create `docs/dev-notes/2026-09-30-egg-ending/plan2-notes.md`: what was built (the four commits), the final sheet (link `egg-pass.png`) beside the blockout, the numbers from Step 2, every constant you changed from the plan's defaults and why, and the open items (the egg light and the consoles' screens do not follow the pulse; the outer shell is an ellipsoid without the blockout's slight taper; spots are flat discs; the figure is five blobs).

Update `docs/tasks/levels.md` item 4n: append `**Plan 2 done** ([plan](../../docs/superpowers/plans/2026-09-30-night-train-egg-pass.md), [notes](../../docs/dev-notes/2026-09-30-egg-ending/plan2-notes.md)): the egg is a WGSL pass (nested veined outer egg, milky spotted inner egg, soft figure), pulsing on the train clock. Next: plan 3 (the sequence system).` and in `TASKS.md` replace `**Plan 1 (the room) built; next: plan 2, the egg pass (WGSL).**` with `**Plans 1 (the room) and 2 (the egg pass) built; next: plan 3, the sequence system.**`

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/egg-look.ts docs/dev-notes/2026-09-30-egg-ending docs/tasks/levels.md TASKS.md
git commit -m "feat(egg): look pass tuned against the blockout; notes, numbers and task board

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review (run by the plan's author, 2026-09-30)

- **Spec coverage.** §2 outer egg (transparent, red-veiny, warm) → `eggVeins` + shell layers; inner egg (0.6 scale, milky, spotted) → inner front/volume + `eggSpots`; the soft figure with a warm backlight → Gaussian blobs + core; `egg.resolve` (one 0-1 parameter, sharpens within ~3 m) → `eggResolve`/`setEgg({resolve})`; analytic nested ellipsoids in a fixed order, no sorting → `eggShade`; collision unchanged. §1 pulse (about 1 Hz, quickens as you approach) → `advancePhase`/`eggPulse`. The flinch at gunfire and the pulse driving the room's lights and screens are **explicitly out of scope** (listed at the top).
- **Placeholders.** None: every code step has the code. The three screen-box fractions in the check script and the tuning constants are measured and set during Task 4/5 from the first captures, with the order and the stop rule stated; the thresholds are fixed.
- **Names.** `EGG`, `FIGURE`, `rayEllipsoid`, `gaussLine`, `figureTau`, `coreEmission`, `innerTransmit`, `spotDirection`, `spotRadius`, `eggBeat`, `eggPulse`, `eggProximity`, `advancePhase`, `eggResolve`, `blurFor`, `innerCentre` (twin); `EGG_RAY`, `EGG_GAUSS`, `EGG_SPOTS`, `EGG_VEINS`, `EGG_SHADE` (WGSL); `createEgg`, `adoptEggFx`, `stepEgg`, `createEggSeams`, `EggRuntime`, `ctx.world.egg`, seams `egg()` / `setEgg()` (leaf) are used identically across the tasks and the check script.
- **Risks.** (1) The art-batch mesh for `train.egg` is found by name/material; if `batchArt` renames it differently the seam returns null and Task 3 Step 5 says how to diagnose. (2) `wgslFn` array indexing with a loop variable and `%` on `i32` are standard WGSL but have not been compiled in this repo before: Task 3 Step 5 is the first compile. (3) The FrontSide proxy's depth is slightly in front of the egg surface, so a thin sliver between the box face and the ellipsoid can hide a clamp's top edge. Accepted; the box hugs the egg within 0.15 m. (4) Cost is unmeasured until Task 4; the plan treats +1.0 ms as a warning, not a failure.
