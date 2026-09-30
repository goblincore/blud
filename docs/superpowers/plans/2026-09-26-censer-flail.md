# Censer Flail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The player's first melee weapon: a burning funeral censer on a chain, knotted to a broken
brass candlestick. Tap for a quick stroke, hold to spin and charge, release for a heavy stroke;
the stroke direction comes from where the weapon sits in the free-aim dead zone; each hit carves
a crater that drags into a gouge along the swing.

**Spec:** `docs/superpowers/specs/2026-09-26-censer-flail-design.md` — read it first.

**Architecture:** Three pure, renderer-free modules hold all the logic: `censer-swing.ts` (the
state machine and the handle's pose), `censer-head.ts` (a rope pendulum the handle swings), and
`censer-hit.ts` (head motion → wound spheres). A renderer-facing leaf, `game-censer.ts`, places
the haft on the aim rig and the head and chain in the world, and hands hit events to the actors
through the existing `ZombieActor.blast()` path (blast-type sphere wounds, a direct collapse-meter
credit, the existing sever checks). No shader changes.

**Tech Stack:** TypeScript, three.js WebGPU, Vitest, Blender 5.2 (Python, headless) for the model,
headless-Chrome gate scripts (`scripts/*.mjs`).

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests** (no `three` import;
    plain data in, plain data out). The renderer-facing module only reads that logic's output and
    writes objects.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module — never as new `main()`
    bindings (`npm test -- game-context-coverage`).
  - Keep the simulation deterministic (sim-time clocks, no wall-clock in logic) and
    console/capture seams in plain data.
- Work ONLY in your worktree. Never `git stash`. `node_modules` is symlinked — do not reinstall.
- **Targeted tests only** (`npm test -- <names>`) plus `npx tsc --noEmit`. Never the bare full suite.
- **Headless capture only** — the in-app browser pane loses the WebGPU device. Capture scripts
  require `window.__warmGate.phase === 'ready'` and fail on renderer pipeline errors.
- **Prove visual claims with a number** and look at the images yourself.
- WebGPU: never toggle a light's `.visible`. Never sample the render target you are writing.
- Kill anything you start outside a capture script in the same step.
- Extracted Blood assets are dev placeholders — never commit them.

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lab/sdf-zombie/webgpu/censer-swing.ts` | create | Swing state machine, stroke direction, handle pose (pure) |
| `src/lab/sdf-zombie/webgpu/censer-swing.test.ts` | create | Its tests |
| `src/lab/sdf-zombie/webgpu/censer-head.ts` | create | Rope pendulum, fixed step, floor/box collision (pure) |
| `src/lab/sdf-zombie/webgpu/censer-head.test.ts` | create | Its tests |
| `src/lab/sdf-zombie/webgpu/censer-hit.ts` | create | Head segment × actor fields → crater + gouge spheres (pure) |
| `src/lab/sdf-zombie/webgpu/censer-hit.test.ts` | create | Its tests |
| `src/lab/sdf-zombie/webgpu/game-actor.ts` | modify | `ActorBlastEffect.reaction` option |
| `src/lab/sdf-zombie/webgpu/game-actor.test.ts` | modify | Reaction tests |
| `src/lab/sdf-zombie/webgpu/game-weapon-slots.ts` (+ test) | modify | `'censer'` slot on key 1 |
| `src/lab/sdf-zombie/webgpu/game-loop-leaves.ts` | modify | `ownsSlot` maps censer ↔ `'melee'`; pickup equips it |
| `src/lab/sdf-zombie/webgpu/game-panels-leaves.ts` | modify | HUD slot label |
| `scripts/model_censer.py` | create | Blender script → `public/assets/lab/censer.glb` |
| `src/lab/sdf-zombie/webgpu/game-censer.ts` | create | The renderer-facing leaf |
| `src/lab/sdf-zombie/webgpu/game-seams-censer.ts` | create | `__sdfGame.censer.*` automation seams |
| `src/lab/sdf-zombie/webgpu/game-state-weapon.ts` | modify | `censer` field on the weapon slice |
| `src/lab/sdf-zombie/webgpu/game-weapon-leaves.ts` | modify | Holster call in `stepWeaponSlots` |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | modify | Create, input, tick, hit-stop, start slot, seams |
| `scripts/censer-gate.mjs` | create | In-game gate + photo strips |
| `docs/dev-notes/2026-09-26-censer/NOTES.md` | create | Measurements, photos, tuning log |

---

### Task 1: The swing state machine (`censer-swing.ts`)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/censer-swing.ts`
- Test: `src/lab/sdf-zombie/webgpu/censer-swing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/censer-swing.test.ts
import { describe, expect, it } from 'vitest';
import {
  CENSER_SWING, cancelCenserSwing, deadzoneOffset, handlePose, hitWindow,
  makeCenserSwing, stepCenserSwing, strokeDirection, type CenserSwing, type Dir2,
} from './censer-swing';
import { FREE_AIM } from './free-aim';

const DT = 1 / 240;
const run = (s: CenserSwing, sec: number, down: boolean, offset: Dir2 = { x: 0, y: 0 }): CenserSwing => {
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) s = stepCenserSwing(s, { down, offset }, DT);
  return s;
};
const near = (a: Dir2, b: Dir2) => { expect(a.x).toBeCloseTo(b.x, 5); expect(a.y).toBeCloseTo(b.y, 5); };

describe('deadzoneOffset', () => {
  it('is ±1 at the dead-zone edge and clamps beyond it', () => {
    near(deadzoneOffset({ x: FREE_AIM.deadzoneX, y: -FREE_AIM.deadzoneY }), { x: 1, y: -1 });
    near(deadzoneOffset({ x: 0.9, y: 0 }), { x: 1, y: 0 });
  });
});

describe('strokeDirection', () => {
  it('runs from the weapon toward the opposite side', () => {
    near(strokeDirection({ x: 0, y: 1 }), { x: 0, y: -1 });   // high → overhead slam
    near(strokeDirection({ x: 0, y: -1 }), { x: 0, y: 1 });   // low → uppercut
    near(strokeDirection({ x: 1, y: 0 }), { x: -1, y: 0 });   // right → hook back left
    near(strokeDirection({ x: -1, y: 0 }), { x: 1, y: 0 });   // left → hook back right
  });
  it('centred is the default diagonal, upper right to lower left', () => {
    near(strokeDirection({ x: 0, y: 0 }), { x: -Math.SQRT1_2, y: -Math.SQRT1_2 });
  });
  it('blends continuously out of the centre', () => {
    let prev = strokeDirection({ x: 0, y: 0 });
    for (let m = 0.01; m <= 0.4; m += 0.01) {
      const d = strokeDirection({ x: m, y: 0.3 * m });
      expect(Math.acos(Math.min(1, d.x * prev.x + d.y * prev.y))).toBeLessThan(0.25);
      prev = d;
    }
  });
});

describe('stepCenserSwing', () => {
  it('a tap is a quick stroke, then a recover, then idle', () => {
    let s = run(makeCenserSwing(), 0.1, true);
    expect(s.phase).toBe('pending');
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);
    expect(s.phase).toBe('stroke');
    expect(s.heavy).toBe(false);
    expect(s.charge).toBe(0);
    expect(s.strokeId).toBe(1);
    s = run(s, CENSER_SWING.tapStrokeSec + 0.01, false);
    expect(s.phase).toBe('recover');
    s = run(s, CENSER_SWING.tapRecoverSec + 0.01, false);
    expect(s.phase).toBe('idle');
  });
  it('holding past the threshold winds up and charges over chargeSec', () => {
    let s = run(makeCenserSwing(), CENSER_SWING.holdSec + 0.01, true);
    expect(s.phase).toBe('windup');
    s = run(s, 0.5, true);
    expect(s.charge).toBeGreaterThan(0.45);
    expect(s.charge).toBeLessThan(0.56);
    s = run(s, 3, true);
    expect(s.charge).toBe(1);
    expect(s.phase).toBe('windup');   // the spin can be held at full charge
  });
  it('release after a wind-up is a heavy stroke that keeps its charge', () => {
    let s = run(makeCenserSwing(), CENSER_SWING.holdSec + 0.6, true);
    const charge = s.charge;
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);
    expect(s.phase).toBe('stroke');
    expect(s.heavy).toBe(true);
    expect(s.charge).toBeCloseTo(charge, 2);
    s = run(s, CENSER_SWING.heavyStrokeSec + 0.01, false);
    expect(s.phase).toBe('recover');
    s = run(s, CENSER_SWING.heavyRecoverSec + 0.01, false);
    expect(s.phase).toBe('idle');
  });
  it('reads the direction at release, not at press', () => {
    let s = run(makeCenserSwing(), 1.0, true, { x: 1, y: 0 });
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 1 } }, DT);
    near(s.dir, { x: 0, y: -1 });
  });
  it('the hit window is the stroke and its recover', () => {
    let s = run(makeCenserSwing(), 0.05, true);
    expect(hitWindow(s)).toBe(false);
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);
    expect(hitWindow(s)).toBe(true);
    s = run(s, CENSER_SWING.tapStrokeSec + 0.01, false);
    expect(s.phase).toBe('recover');
    expect(hitWindow(s)).toBe(true);
    s = run(s, CENSER_SWING.tapRecoverSec + 0.01, false);
    expect(hitWindow(s)).toBe(false);
  });
  it('cancel returns to idle and keeps the stroke counter', () => {
    let s = run(makeCenserSwing(), 0.05, true);
    s = stepCenserSwing(s, { down: false, offset: { x: 0, y: 0 } }, DT);
    const c = cancelCenserSwing(s);
    expect(c.phase).toBe('idle');
    expect(c.strokeId).toBe(1);
  });
});

describe('handlePose', () => {
  it('has no pops through a tap and a full heavy swing (< 5 cm per 240 Hz step)', () => {
    let s = makeCenserSwing();
    let prev = handlePose(s);
    let worst = 0;
    const seq: Array<[number, boolean]> = [[0.1, true], [0.7, false], [1.6, true], [1.0, false]];
    for (const [sec, down] of seq) {
      const n = Math.round(sec / DT);
      for (let i = 0; i < n; i++) {
        s = stepCenserSwing(s, { down, offset: { x: 0.6, y: 0.4 } }, DT);
        const p = handlePose(s);
        worst = Math.max(worst, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
        prev = p;
      }
    }
    expect(worst).toBeLessThan(0.05);
  });
  it('the stroke sweeps along its direction', () => {
    let s = run(makeCenserSwing(), 0.05, true, { x: 1, y: 0 });
    s = stepCenserSwing(s, { down: false, offset: { x: 1, y: 0 } }, DT);   // travel (-1, 0)
    s = run(s, CENSER_SWING.tapStrokeSec * 0.99, false, { x: 1, y: 0 });
    expect(s.phase).toBe('stroke');
    expect(handlePose(s)[0]).toBeLessThan(-0.2);   // swept to the left
  });
  it('rests at zero when idle', () => {
    expect(handlePose(makeCenserSwing())).toEqual([0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- censer-swing`
Expected: FAIL — `Failed to resolve import "./censer-swing"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lab/sdf-zombie/webgpu/censer-swing.ts
//
// THE CENSER'S SWING (spec docs/superpowers/specs/2026-09-26-censer-flail-design.md §3).
// Pure: button state, dt and the weapon's place in the dead zone in; the phase,
// the charge and the HANDLE's pose (view-space metres, relative to its rest) out.
// No Three.js. The head is not here — censer-head.ts swings it off this handle.
//
//   idle → (press) → pending ─(released before holdSec)→ stroke (tap)
//                        └─(held holdSec)→ windup (spin, charge 0→1) ─(release)→ stroke (heavy)
//   stroke → recover → idle
//
// The stroke runs FROM the weapon's side of the dead zone TOWARD the opposite
// side, read at release, so a charged spin can be steered before it lands.

import type { Vec3 } from '../types';
import { FREE_AIM, type AimPoint } from './free-aim';

export const CENSER_SWING = {
  /** Held longer than this, a press becomes a wind-up instead of a tap. */
  holdSec: 0.18,
  /** Seconds of spinning to reach full charge. */
  chargeSec: 1.0,
  tapStrokeSec: 0.22,
  tapRecoverSec: 0.35,
  heavyStrokeSec: 0.28,
  heavyRecoverSec: 0.5,
  /** Dead-zone radius (dead-zone units) inside which the default diagonal takes over. */
  centreRadius: 0.25,
  /** The stroke sweeps from −halfSpan to +halfSpan along its direction, metres. */
  strokeHalfSpan: 0.32,
  /** Forward (−z) bulge at the middle of the stroke, metres. */
  strokeReach: 0.18,
  /** Fraction of the stroke spent blending in from the pose it started at. */
  leadFrac: 0.3,
  /** The wind-up: the handle rises this far and circles at this radius. */
  spinLift: 0.22,
  spinRadius: 0.1,
  spinLiftSec: 0.15,
  spinHzMin: 1.2,
  spinHzMax: 2.6,
  /** Travel angle of the centred stroke: upper right → lower left. */
  defaultAngle: Math.atan2(-1, -1),
} as const;

export type CenserPhase = 'idle' | 'pending' | 'windup' | 'stroke' | 'recover';

/** A screen-space direction or offset: x right, y up. */
export interface Dir2 { x: number; y: number }

export interface CenserSwing {
  phase: CenserPhase;
  /** Seconds in the current phase. */
  t: number;
  /** 0..1; kept through a heavy stroke, 0 for a tap. */
  charge: number;
  heavy: boolean;
  /** Unit direction of travel of the current (or last) stroke. */
  dir: Dir2;
  /** Wind-up spin angle, radians. */
  spin: number;
  /** Increments at every stroke start — the hit ledger's key. */
  strokeId: number;
  /** Handle pose when the stroke started; blended out over leadFrac. */
  from: Vec3;
}

export interface SwingInput { down: boolean; offset: Dir2 }

const ZERO: Vec3 = [0, 0, 0];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function makeCenserSwing(): CenserSwing {
  const a = CENSER_SWING.defaultAngle;
  return {
    phase: 'idle', t: 0, charge: 0, heavy: false,
    dir: { x: Math.cos(a), y: Math.sin(a) }, spin: 0, strokeId: 0, from: ZERO,
  };
}

/** The weapon's place in the dead zone, ±1 at its edge (the reticle is the weapon's target). */
export function deadzoneOffset(aim: AimPoint): Dir2 {
  const c = (v: number) => Math.min(1, Math.max(-1, v));
  return { x: c(aim.x / FREE_AIM.deadzoneX), y: c(aim.y / FREE_AIM.deadzoneY) };
}

/** Unit travel direction for a stroke released with the weapon at `offset`. */
export function strokeDirection(offset: Dir2): Dir2 {
  const S = CENSER_SWING;
  const m = Math.hypot(offset.x, offset.y);
  let a: number = S.defaultAngle;
  if (m > 1e-9) {
    const away = Math.atan2(-offset.y, -offset.x);
    let d = away - S.defaultAngle;
    d = Math.atan2(Math.sin(d), Math.cos(d));   // shortest way round
    a = S.defaultAngle + d * smooth(0, S.centreRadius, m);
  }
  return { x: Math.cos(a), y: Math.sin(a) };
}

export const strokeSec = (heavy: boolean): number =>
  heavy ? CENSER_SWING.heavyStrokeSec : CENSER_SWING.tapStrokeSec;
export const recoverSec = (heavy: boolean): number =>
  heavy ? CENSER_SWING.heavyRecoverSec : CENSER_SWING.tapRecoverSec;

function strokePath(dir: Dir2, u: number): Vec3 {
  const S = CENSER_SWING;
  const along = lerp(-S.strokeHalfSpan, S.strokeHalfSpan, u);
  return [dir.x * along, dir.y * along, -S.strokeReach * Math.sin(Math.PI * u)];
}

function spinPose(t: number, spin: number): Vec3 {
  const S = CENSER_SWING;
  const k = smooth(0, S.spinLiftSec, t);
  return [S.spinRadius * k * Math.cos(spin), S.spinLift * k, -S.spinRadius * k * Math.sin(spin)];
}

/** The handle's offset from its rest, view-space metres. Continuous across every transition. */
export function handlePose(s: CenserSwing): Vec3 {
  switch (s.phase) {
    case 'idle':
    case 'pending':
      return ZERO;
    case 'windup':
      return spinPose(s.t, s.spin);
    case 'stroke': {
      const u = clamp01(s.t / strokeSec(s.heavy));
      return lerp3(s.from, strokePath(s.dir, smooth(0, 1, u)), smooth(0, CENSER_SWING.leadFrac, u));
    }
    case 'recover':
      return lerp3(strokePath(s.dir, 1), ZERO, smooth(0, 1, s.t / recoverSec(s.heavy)));
  }
}

function beginStroke(s: CenserSwing, heavy: boolean, offset: Dir2): CenserSwing {
  return {
    ...s, phase: 'stroke', t: 0, heavy, charge: heavy ? s.charge : 0,
    dir: strokeDirection(offset), strokeId: s.strokeId + 1, from: handlePose(s),
  };
}

export function stepCenserSwing(s: CenserSwing, input: SwingInput, dt: number): CenserSwing {
  const S = CENSER_SWING;
  const d = dt > 0 ? dt : 0;
  const t = s.t + d;
  switch (s.phase) {
    case 'idle':
      return input.down ? { ...s, phase: 'pending', t: 0, charge: 0 } : s;
    case 'pending':
      if (!input.down) return beginStroke({ ...s, t }, false, input.offset);
      return t >= S.holdSec ? { ...s, phase: 'windup', t: t - S.holdSec, spin: 0 } : { ...s, t };
    case 'windup': {
      const charge = Math.min(1, t / S.chargeSec);
      const hz = lerp(S.spinHzMin, S.spinHzMax, charge);
      const next: CenserSwing = { ...s, t, charge, spin: s.spin + 2 * Math.PI * hz * d };
      return input.down ? next : beginStroke(next, true, input.offset);
    }
    case 'stroke':
      return t >= strokeSec(s.heavy) ? { ...s, phase: 'recover', t: t - strokeSec(s.heavy) } : { ...s, t };
    case 'recover':
      return t >= recoverSec(s.heavy) ? { ...s, phase: 'idle', t: 0, charge: 0, heavy: false } : { ...s, t };
  }
}

/** Hits count during the stroke AND its recover: the head lags the handle, so its
 *  fastest moment often comes after the handle has stopped. */
export function hitWindow(s: CenserSwing): boolean {
  return s.phase === 'stroke' || s.phase === 'recover';
}

/** Weapon switch or death: back to idle; the stroke counter survives so a stale hit ledger never matches. */
export function cancelCenserSwing(s: CenserSwing): CenserSwing {
  return { ...makeCenserSwing(), strokeId: s.strokeId };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- censer-swing`
Expected: PASS (13 tests).

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/lab/sdf-zombie/webgpu/censer-swing.ts src/lab/sdf-zombie/webgpu/censer-swing.test.ts
git commit -m "feat(censer): swing state machine — tap/hold/charge, dead-zone stroke direction, handle pose

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The rope pendulum (`censer-head.ts`)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/censer-head.ts`
- Test: `src/lab/sdf-zombie/webgpu/censer-head.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/censer-head.test.ts
import { describe, expect, it } from 'vitest';
import {
  CENSER_HEAD, makeCenserHead, stepCenserHead, type Box, type CenserHead, type HeadWorld,
} from './censer-head';
import type { Vec3 } from '../types';

const OPEN: HeadWorld = { floorY: -100, boxes: [] };
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const speed = (h: CenserHead) => Math.hypot(h.vel[0], h.vel[1], h.vel[2]);
/** Kinetic + potential energy per unit mass. */
const energy = (h: CenserHead) => 0.5 * speed(h) ** 2 - CENSER_HEAD.gravity * h.pos[1];
/** Held out horizontally, rope taut, at rest. */
const swungOut = (anchor: Vec3): CenserHead =>
  ({ ...makeCenserHead(anchor), pos: [anchor[0] + CENSER_HEAD.ropeLen, anchor[1], anchor[2]] });

describe('censer head (rope pendulum)', () => {
  it('hangs straight down at rest', () => {
    const a: Vec3 = [0, 2, 0];
    let h = makeCenserHead(a);
    for (let i = 0; i < 120; i++) h = stepCenserHead(h, a, 1 / 60, OPEN);
    expect(h.pos[1]).toBeCloseTo(2 - CENSER_HEAD.ropeLen, 3);
    expect(speed(h)).toBeLessThan(0.01);
  });

  it('never stretches the rope, however the handle moves', () => {
    let h = makeCenserHead([0, 2, 0]);
    let worst = -Infinity;
    for (let i = 0; i < 240; i++) {
      const t = i / 60;
      const a: Vec3 = [0.3 * Math.cos(t * 12), 2 + 0.2 * Math.sin(t * 9), 0.3 * Math.sin(t * 12)];
      h = stepCenserHead(h, a, 1 / 60, OPEN);
      worst = Math.max(worst, dist(h.pos, a) - CENSER_HEAD.ropeLen);
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('goes slack when the handle moves toward the head', () => {
    let h = makeCenserHead([0, 2, 0]);
    h = stepCenserHead(h, [0, 1.7, 0], 1 / 60, OPEN);
    expect(dist(h.pos, [0, 1.7, 0])).toBeLessThan(CENSER_HEAD.ropeLen - 0.2);
  });

  it('loses energy with no input (drag)', () => {
    const a: Vec3 = [0, 2, 0];
    let h = swungOut(a);
    const e0 = energy(h);
    for (let i = 0; i < 180; i++) h = stepCenserHead(h, a, 1 / 60, OPEN);
    expect(energy(h)).toBeLessThan(e0 - 0.05);
  });

  it('is the same whatever the frame split (fixed step)', () => {
    const a: Vec3 = [0, 2, 0];
    let h1 = swungOut(a), h2 = swungOut(a);
    for (let i = 0; i < 60; i++) h1 = stepCenserHead(h1, a, 1 / 60, OPEN);
    for (let i = 0; i < 120; i++) h2 = stepCenserHead(h2, a, 1 / 120, OPEN);
    for (let k = 0; k < 3; k++) expect(h2.pos[k]).toBeCloseTo(h1.pos[k]!, 9);
  });

  it('the handle drags the head: a 0.22 s stroke gets it moving', () => {
    let a: Vec3 = [-0.32, 2, 0];
    let h = makeCenserHead(a);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      const t = Math.min(1, i / 13);
      a = [-0.32 + 0.64 * t, 2, 0];
      h = stepCenserHead(h, a, 1 / 60, OPEN);
      peak = Math.max(peak, speed(h));
    }
    expect(peak).toBeGreaterThan(1.5);
  });

  it('scales the velocity by what the substep hook returns', () => {
    const a: Vec3 = [0, 2, 0];
    let free = swungOut(a), soaked = swungOut(a);
    for (let i = 0; i < 20; i++) {
      free = stepCenserHead(free, a, 1 / 60, OPEN);
      soaked = stepCenserHead(soaked, a, 1 / 60, OPEN, () => 0.9);
    }
    expect(speed(soaked)).toBeLessThan(speed(free) * 0.5);
  });

  it('hands the hook every substep\'s segment', () => {
    const a: Vec3 = [0, 2, 0];
    let calls = 0;
    stepCenserHead(swungOut(a), a, 1 / 60, OPEN, (from, to) => { calls++; expect(dist(from, to)).toBeLessThan(0.1); });
    expect(calls).toBe(CENSER_HEAD.stepHz / 60);
  });

  it('stays above the floor', () => {
    const a: Vec3 = [0, 0.3, 0];
    let h = makeCenserHead(a);
    let low = Infinity;
    for (let i = 0; i < 120; i++) {
      h = stepCenserHead(h, a, 1 / 60, { floorY: 0, boxes: [] });
      low = Math.min(low, h.pos[1]);
    }
    expect(low).toBeGreaterThanOrEqual(CENSER_HEAD.radius - 1e-9);
  });

  it('never ends a step inside a box', () => {
    const box: Box = { min: [0.1, 0, -0.5], max: [0.6, 3, 0.5] };
    const r = CENSER_HEAD.radius;
    const inside = (p: Vec3) => [0, 1, 2].every(k =>
      p[k]! > box.min[k]! - r + 1e-6 && p[k]! < box.max[k]! + r - 1e-6);
    const a: Vec3 = [0, 2, 0];
    let h: CenserHead = { ...makeCenserHead(a), pos: [-0.55, 2, 0] };
    for (let i = 0; i < 120; i++) {
      h = stepCenserHead(h, a, 1 / 60, { floorY: -100, boxes: [box] });
      expect(inside(h.pos)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- censer-head`
Expected: FAIL — `Failed to resolve import "./censer-head"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lab/sdf-zombie/webgpu/censer-head.ts
//
// THE CENSER'S HEAD: one point mass on a rope (spec §4.1, decision 3). Pure.
//
// The rope is INEXTENSIBLE BUT SLACK-ABLE: it only ever pulls, and only when
// taut. Fixed-step integration (stepHz) with an accumulator, so the result does
// not depend on how frames split the time — and a 16 m/s head moves under 7 cm
// per substep, below a forearm's width. The anchor (the knot on the haft) is
// interpolated across a frame's substeps, and its velocity is what lets a
// stroke YANK the head: the rope removes only the head's velocity RELATIVE to
// the anchor, along the rope.
//
// The chain is drawn, not simulated (game-censer.ts). A linked chain can
// replace this behind the same functions.

import type { Vec3 } from '../types';

export const CENSER_HEAD = {
  ropeLen: 0.55,
  /** The thurible's bowl as a sphere: the collision sphere and the contact offset. */
  radius: 0.07,
  gravity: -9.81,
  /** Linear air drag, 1/s. */
  drag: 0.6,
  stepHz: 240,
  /** Bounce kept off a wall or the floor, 0..1. */
  restitution: 0.25,
  /** Backlog cap: a long stall simulates at most this many substeps and drops the rest. */
  maxSubsteps: 24,
} as const;

export interface Box { min: Vec3; max: Vec3 }
export interface HeadWorld { floorY: number; boxes: readonly Box[] }

export interface CenserHead {
  pos: Vec3;
  vel: Vec3;
  /** The anchor the last substep used: where the next frame's interpolation starts. */
  anchor: Vec3;
  /** Unsimulated time carried to the next frame, seconds. */
  acc: number;
}

/** Called after every substep with the head's segment and velocity. A number
 *  return scales the velocity (the energy struck flesh soaked up). */
export type SubstepHook = (from: Vec3, to: Vec3, vel: Vec3) => number | void;

export function makeCenserHead(anchor: Vec3): CenserHead {
  return {
    pos: [anchor[0], anchor[1] - CENSER_HEAD.ropeLen, anchor[2]],
    vel: [0, 0, 0],
    anchor: [anchor[0], anchor[1], anchor[2]],
    acc: 0,
  };
}

/** Push the head sphere out of the floor and any box it entered; kill most of the inbound speed. */
function collide(p: Vec3, v: Vec3, world: HeadWorld): void {
  const r = CENSER_HEAD.radius, e = CENSER_HEAD.restitution;
  if (p[1] - r < world.floorY) {
    p[1] = world.floorY + r;
    if (v[1] < 0) v[1] = -v[1] * e;
  }
  for (const b of world.boxes) {
    let inside = true, best = Infinity, axis = -1, face = 0;
    for (let k = 0; k < 3; k++) {
      const lo = b.min[k]! - r, hi = b.max[k]! + r, pk = p[k]!;
      if (pk <= lo || pk >= hi) { inside = false; break; }
      if (pk - lo < best) { best = pk - lo; axis = k; face = lo; }
      if (hi - pk < best) { best = hi - pk; axis = k; face = hi; }
    }
    if (!inside || axis < 0) continue;
    const outward = face > p[axis]! ? 1 : -1;
    p[axis] = face;
    if (v[axis]! * outward < 0) v[axis] = -v[axis]! * e;
  }
}

export function stepCenserHead(
  s: CenserHead, anchor: Vec3, dt: number, world: HeadWorld, hook?: SubstepHook,
): CenserHead {
  const H = CENSER_HEAD;
  const h = 1 / H.stepHz;
  let acc = s.acc + (dt > 0 ? dt : 0);
  let steps = Math.floor(acc / h + 1e-9);
  acc = Math.max(0, acc - steps * h);
  if (steps > H.maxSubsteps) { steps = H.maxSubsteps; acc = 0; }
  if (steps === 0) return { ...s, acc };

  const p: Vec3 = [s.pos[0], s.pos[1], s.pos[2]];
  const v: Vec3 = [s.vel[0], s.vel[1], s.vel[2]];
  const a0 = s.anchor;
  const decay = Math.exp(-H.drag * h);
  // Anchor velocity is constant across this frame's substeps (linear interpolation).
  const av: Vec3 = [
    (anchor[0] - a0[0]) / (steps * h), (anchor[1] - a0[1]) / (steps * h), (anchor[2] - a0[2]) / (steps * h),
  ];
  for (let i = 0; i < steps; i++) {
    const f = (i + 1) / steps;
    const a: Vec3 = [a0[0] + (anchor[0] - a0[0]) * f, a0[1] + (anchor[1] - a0[1]) * f, a0[2] + (anchor[2] - a0[2]) * f];
    const from: Vec3 = [p[0], p[1], p[2]];
    v[1] += H.gravity * h;
    for (let k = 0; k < 3; k++) { v[k] = v[k]! * decay; p[k] = p[k]! + v[k]! * h; }
    const d: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L > H.ropeLen) {
      const n: Vec3 = [d[0] / L, d[1] / L, d[2] / L];
      for (let k = 0; k < 3; k++) p[k] = a[k]! + n[k]! * H.ropeLen;
      const rel = (v[0] - av[0]) * n[0] + (v[1] - av[1]) * n[1] + (v[2] - av[2]) * n[2];
      if (rel > 0) for (let k = 0; k < 3; k++) v[k] = v[k]! - n[k]! * rel;
    }
    collide(p, v, world);
    if (hook) {
      const k = hook(from, [p[0], p[1], p[2]], [v[0], v[1], v[2]]);
      if (typeof k === 'number') for (let j = 0; j < 3; j++) v[j] = v[j]! * k;
    }
  }
  return { pos: p, vel: v, anchor: [anchor[0], anchor[1], anchor[2]], acc };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- censer-head`
Expected: PASS (10 tests). If *the handle drags the head* fails, print `peak`: the number is a
feel number, not a physics law. Lower the bound to half the measured value and say so in the
commit message — don't retune the rope to pass a test.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/lab/sdf-zombie/webgpu/censer-head.ts src/lab/sdf-zombie/webgpu/censer-head.test.ts
git commit -m "feat(censer): rope-pendulum head — fixed step, slack rope, floor/box collision, substep hook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Head motion → wound spheres (`censer-hit.ts`)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/censer-hit.ts`
- Test: `src/lab/sdf-zombie/webgpu/censer-hit.test.ts`

Uses `traceProjectile(from, to, field)` from `src/lab/sdf-zombie/webgpu/game-weapon.ts` (pure; it
substeps a segment at 5 cm, returns the bisected surface point or null, and returns `from` when
`from` is already within `hitEps` of the surface).

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/censer-hit.test.ts
import { describe, expect, it } from 'vitest';
import {
  CENSER_HIT, makeStrokeHits, sweepHead, type ActorProbe, type HitEvent, type StrokeHits,
} from './censer-hit';
import type { Vec3 } from '../types';

const R = 0.07;   // CENSER_HEAD.radius
const ball = (id: number, c: Vec3, r = 0.3): ActorProbe => ({
  id, centre: c, field: p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r,
});
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Walk the head from → to in 1 cm substeps, as censer-head's hook would, applying velScale. */
function drag(hits: StrokeHits, from: Vec3, to: Vec3, vel: Vec3, actors: ActorProbe[]) {
  const n = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) / 0.01);
  const events: HitEvent[] = [];
  let scale = 1, p = from;
  for (let i = 1; i <= n; i++) {
    const q = lerp3(from, to, i / n);
    const r = sweepHead(hits, p, q, [vel[0] * scale, vel[1] * scale, vel[2] * scale], R, actors);
    events.push(...r.events);
    scale *= r.velScale;
    p = q;
  }
  return { events, scale, spheres: events.flatMap(e => e.spheres) };
}

describe('sweepHead', () => {
  it('misses cleanly', () => {
    const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 2], [0, 0, 1.5], [0, 0, -9], R, [ball(1, [0, 0, 0])]);
    expect(r.events).toHaveLength(0);
    expect(r.velScale).toBe(1);
  });

  it('first contact stamps one crater on the body surface', () => {
    const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 1], [0, 0, 0.3], [0, 0, -9], R, [ball(1, [0, 0, 0])]);
    expect(r.events).toHaveLength(1);
    const s = r.events[0]!.spheres;
    expect(s).toHaveLength(1);
    expect(s[0]!.kind).toBe('crater');
    expect(Math.hypot(s[0]!.at[0], s[0]!.at[1], s[0]!.at[2] - 0.3)).toBeLessThan(0.012);
    expect(s[0]!.radius).toBeCloseTo(CENSER_HIT.tap.craterR, 3);
    expect(s[0]!.severRadius).toBeCloseTo(CENSER_HIT.tap.craterR * CENSER_HIT.severMul, 3);
    expect(s[0]!.meterCredit).toBeCloseTo(CENSER_HIT.tap.meter, 3);
    expect(r.velScale).toBeCloseTo(1 - CENSER_HIT.absorbCrater, 6);
  });

  it('sizes the crater by the speed into the surface; a graze stamps nothing', () => {
    const radiusAt = (speed: number) => {
      const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 1], [0, 0, 0.3], [0, 0, -speed], R, [ball(1, [0, 0, 0])]);
      return r.events[0]?.spheres[0]?.radius ?? null;
    };
    expect(radiusAt(4.5)).toBeCloseTo(CENSER_HIT.tap.craterR * 0.5, 3);
    expect(radiusAt(2)).toBeCloseTo(CENSER_HIT.tap.craterR * CENSER_HIT.minSpeedFrac, 3);
    expect(radiusAt(1)).toBeNull();
  });

  it('a full-charge strike is the big crater', () => {
    const r = sweepHead(makeStrokeHits(1, 1), [0, 0, 1], [0, 0, 0.3], [0, 0, -16], R, [ball(1, [0, 0, 0])]);
    expect(r.events[0]!.spheres[0]!.radius).toBeCloseTo(CENSER_HIT.heavy.craterR, 3);
  });

  it('the gouge trails the crater along the travel, shrinking', () => {
    const { spheres } = drag(makeStrokeHits(1, 0), [-0.45, 0, 0.33], [0.45, 0, 0.33], [9, 0, -1], [ball(1, [0, 0, 0])]);
    expect(spheres[0]!.kind).toBe('crater');
    const gouge = spheres.slice(1);
    expect(gouge.length).toBeGreaterThanOrEqual(1);
    expect(gouge.length).toBeLessThanOrEqual(CENSER_HIT.tap.gougeMax);
    for (const g of gouge) expect(g.kind).toBe('gouge');
    for (let i = 1; i < spheres.length; i++) {
      expect(spheres[i]!.at[0]).toBeGreaterThan(spheres[i - 1]!.at[0]);
      expect(spheres[i]!.radius).toBeCloseTo(spheres[i - 1]!.radius * CENSER_HIT.gougeShrink, 6);
      expect(spheres[i]!.meterCredit).toBeCloseTo(spheres[0]!.meterCredit * CENSER_HIT.gougeMeterFrac, 6);
    }
  });

  it('hits each body once per stroke; a new stroke hits again', () => {
    const body = [ball(1, [0, 0, 0])];
    const hits = makeStrokeHits(1, 0);
    expect(drag(hits, [-0.45, 0, 0.33], [0.45, 0, 0.33], [9, 0, -1], body).spheres.length).toBeGreaterThan(0);
    expect(drag(hits, [0.45, 0, 0.33], [-0.45, 0, 0.33], [-9, 0, -1], body).spheres).toHaveLength(0);
    expect(drag(makeStrokeHits(2, 0), [0.45, 0, 0.33], [-0.45, 0, 0.33], [-9, 0, -1], body).spheres.length).toBeGreaterThan(0);
  });

  it('a stroke that starts inside the body waits until the head has left it', () => {
    const body = [ball(1, [0, 0, 0])];
    const hits = makeStrokeHits(1, 0);
    expect(sweepHead(hits, [0, 0, 0.2], [0, 0, 0.25], [0, 0, 9], R, body).events).toHaveLength(0);
    expect(drag(hits, [0, 0, 0.25], [0, 0, 0.6], [0, 0, 9], body).spheres).toHaveLength(0);
    const back = drag(hits, [0, 0, 0.6], [0, 0, 0.3], [0, 0, -9], body);
    expect(back.spheres[0]?.kind).toBe('crater');
  });

  it('the gouge ends when the head stalls in the flesh', () => {
    const body = [ball(1, [0, 0, 0])];
    const hits = makeStrokeHits(1, 0);
    const hit = sweepHead(hits, [-0.45, 0, 0.33], [-0.12, 0, 0.33], [9, 0, -1], R, body);
    expect(hit.events[0]!.spheres[0]!.kind).toBe('crater');
    expect(drag(hits, [-0.12, 0, 0.33], [0.12, 0, 0.33], [0.5, 0, 0], body).spheres).toHaveLength(0);
    expect(drag(hits, [0.12, 0, 0.33], [0.45, 0, 0.33], [9, 0, 0], body).spheres).toHaveLength(0);
  });

  it('two bodies in one sweep: both are hit, the second with the speed left over', () => {
    const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 1], [0, 0, 0.3], [0, 0, -9], R,
      [ball(1, [0, 0, 0]), ball(2, [0, 0, 0.01])]);
    expect(r.events.map(e => e.actorId)).toEqual([1, 2]);
    expect(r.events[1]!.spheres[0]!.radius).toBeLessThan(r.events[0]!.spheres[0]!.radius);
    expect(r.velScale).toBeCloseTo((1 - CENSER_HIT.absorbCrater) ** 2, 6);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- censer-hit`
Expected: FAIL — `Failed to resolve import "./censer-hit"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lab/sdf-zombie/webgpu/censer-hit.ts
//
// THE CENSER'S WOUNDS (spec §4.1–4.2). Pure: the head's substep segment and the
// actors' signed-distance fields in; wound SPHERES out. The caller turns each
// sphere into a 'blast'-type wound (damage.ts worldHitToWound) and hands the
// batch to ZombieActor.blast(), which credits the collapse meter with the
// spheres' meterCredit directly and runs the sever checks.
//
//   first contact  → one CRATER at the surface under the head, sized by the
//                    head's speed INTO the surface against the stroke's
//                    reference speed (a graze below minInSpeed stamps nothing)
//   while inside   → a GOUGE sphere every gougeStep of travel, each gougeShrink
//                    smaller, up to the stroke's cap; ends when the head exits
//                    or stalls below gougeMinSpeed
//   every stamp    → the head loses speed (velScale), so it bounces out
//   once per stroke per body; a stroke that STARTS inside a body waits until
//   the head has left it (a zombie hugging the player is not wounded by a
//   resting censer).
//
// `sweepHead` MUTATES the per-stroke ledger it is given (`StrokeHits`).

import type { Vec3 } from '../types';
import { traceProjectile } from './game-weapon';

export const CENSER_HIT = {
  /** Tap (charge 0) and full-charge ends of every per-stroke number; lerped by charge. */
  tap: { craterR: 0.06, gougeMax: 3, speedRef: 9, meter: 0.1 },
  heavy: { craterR: 0.11, gougeMax: 6, speedRef: 16, meter: 0.3 },
  /** Floor on the speed factor: a slow but real hit still leaves a mark. */
  minSpeedFrac: 0.4,
  /** m/s into the surface below which a contact is a graze. */
  minInSpeed: 1.5,
  /** m/s below which a head inside the flesh has stalled and the gouge ends. */
  gougeMinSpeed: 2.0,
  gougeStep: 0.03,
  gougeShrink: 0.8,
  gougeMeterFrac: 0.25,
  /** A gouge sphere closer than this × the smaller radius to the last one is merged (skipped). */
  mergeFrac: 0.5,
  /** severRadius = radius × this: the carve union the sever test sees. */
  severMul: 1.15,
  absorbCrater: 0.35,
  absorbGouge: 0.12,
  /** Segment-to-torso distance past which a body is not tested at all, metres. */
  broadPhase: 1.35,
  gradEps: 0.005,
} as const;

export interface ActorProbe {
  id: number;
  /** Broad-phase centre (the torso cluster). */
  centre: Vec3;
  /** The posed body's signed distance (sdBody). */
  field: (p: Vec3) => number;
}

export interface WoundSphere {
  at: Vec3;
  radius: number;
  severRadius: number;
  kind: 'crater' | 'gouge';
  meterCredit: number;
}

export interface HitEvent {
  actorId: number;
  spheres: WoundSphere[];
  /** Unit direction of the head's travel. */
  dir: Vec3;
  /** m/s into the surface at this stamp. */
  speedIn: number;
}

interface Contact {
  /** False until the head has been seen outside this body (stroke started inside). */
  armed: boolean;
  inside: boolean;
  done: boolean;
  stamps: number;
  last: Vec3;
  lastR: number;
  /** The crater's speed factor; the gouge credits scale with it. */
  k: number;
}

export interface StrokeHits {
  strokeId: number;
  charge: number;
  contacts: Map<number, Contact>;
}

export function makeStrokeHits(strokeId: number, charge: number): StrokeHits {
  return { strokeId, charge: Math.min(1, Math.max(0, charge)), contacts: new Map() };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3, fallback: Vec3): Vec3 => { const l = len(a); return l > 1e-9 ? scl(a, 1 / l) : fallback; };

export function hitTier(charge: number) {
  const T = CENSER_HIT.tap, H = CENSER_HIT.heavy;
  return {
    craterR: mix(T.craterR, H.craterR, charge),
    gougeMax: Math.round(mix(T.gougeMax, H.gougeMax, charge)),
    speedRef: mix(T.speedRef, H.speedRef, charge),
    meter: mix(T.meter, H.meter, charge),
  };
}

/** Outward unit normal of a field by central differences. */
export function surfaceNormal(field: (p: Vec3) => number, p: Vec3): Vec3 {
  const e = CENSER_HIT.gradEps;
  const g: Vec3 = [
    field([p[0] + e, p[1], p[2]]) - field([p[0] - e, p[1], p[2]]),
    field([p[0], p[1] + e, p[2]]) - field([p[0], p[1] - e, p[2]]),
    field([p[0], p[1], p[2] + e]) - field([p[0], p[1], p[2] - e]),
  ];
  return unit(g, [0, 1, 0]);
}

function segPointDist(a: Vec3, b: Vec3, p: Vec3): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
}

export function sweepHead(
  hits: StrokeHits, from: Vec3, to: Vec3, vel: Vec3, headR: number, actors: readonly ActorProbe[],
): { events: HitEvent[]; velScale: number } {
  const C = CENSER_HIT;
  const T = hitTier(hits.charge);
  const events: HitEvent[] = [];
  let velScale = 1;
  for (const a of actors) {
    if (segPointDist(from, to, a.centre) > C.broadPhase + headR) continue;
    const outside = (p: Vec3) => a.field(p) - headR > 0;
    let c = hits.contacts.get(a.id);
    if (!c) {
      c = { armed: outside(from), inside: false, done: false, stamps: 0, last: [0, 0, 0], lastR: 0, k: 1 };
      hits.contacts.set(a.id, c);
    }
    if (c.done) continue;
    if (!c.armed) { if (outside(to)) c.armed = true; continue; }

    const v = scl(vel, velScale);
    const dir = unit(v, unit(sub(to, from), [0, 0, -1]));
    if (!c.inside) {
      const hp = traceProjectile(from, to, q => a.field(q) - headR);
      if (!hp) continue;
      const n = surfaceNormal(a.field, hp);
      const speedIn = -dot(v, n);
      if (speedIn < C.minInSpeed) continue;   // a graze
      c.k = Math.min(1, Math.max(C.minSpeedFrac, speedIn / T.speedRef));
      const r = T.craterR * c.k;
      const at = sub(hp, scl(n, headR));      // the body surface under the head
      c.inside = true; c.stamps = 1; c.last = at; c.lastR = r;
      velScale *= 1 - C.absorbCrater;
      events.push({
        actorId: a.id, dir, speedIn,
        spheres: [{ at, radius: r, severRadius: r * C.severMul, kind: 'crater', meterCredit: T.meter * c.k }],
      });
      continue;
    }

    const dIn = a.field(to);
    if (dIn - headR > 0) { c.inside = false; c.done = true; continue; }   // out the far side
    if (c.stamps - 1 >= T.gougeMax) continue;
    if (len(v) < C.gougeMinSpeed) { c.done = true; continue; }          // stalled in the flesh
    const n = surfaceNormal(a.field, to);
    const at = sub(to, scl(n, dIn));                                      // head centre onto the surface
    const step = len(sub(at, c.last));
    const r = c.lastR * C.gougeShrink;
    if (step < C.gougeStep || step < C.mergeFrac * Math.min(r, c.lastR)) continue;
    c.stamps++; c.last = at; c.lastR = r;
    velScale *= 1 - C.absorbGouge;
    events.push({
      actorId: a.id, dir, speedIn: -dot(v, n),
      spheres: [{ at, radius: r, severRadius: r * C.severMul, kind: 'gouge', meterCredit: T.meter * c.k * C.gougeMeterFrac }],
    });
  }
  return { events, velScale };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- censer-hit`
Expected: PASS (9 tests).

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/lab/sdf-zombie/webgpu/censer-hit.ts src/lab/sdf-zombie/webgpu/censer-hit.test.ts
git commit -m "feat(censer): head sweep → crater + gouge wound spheres (speed-scaled, once per stroke, merge)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `ActorBlastEffect.reaction` (flinch, blast or none)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.ts` (the `ActorBlastEffect` interface near line 515;
  step (3) of `function blast` near line 1610)
- Test: `src/lab/sdf-zombie/webgpu/game-actor.test.ts` (append after the
  `describe('blast reaction — the body must not tear in half', …)` block, ~line 935)

The censer lands through `blast()` because it already credits the meter directly and runs the
sever tail. Today `blast()` always raises a blast-class signal and knocks the root; a tap must only
flinch, and a gouge-only batch (the head still carving on a later frame) must not re-react.

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/webgpu/game-actor.test.ts`:

```ts
describe('blast() reaction option (the censer)', () => {
  const chestOf = (a: ReturnType<typeof makeTestActor>): Vec3 =>
    [...a.posed().clusters.find(c => c.limb === 'torso')!.center] as Vec3;
  const travelAfter = (reaction: 'blast' | 'flinch' | 'none') => {
    const hit = makeTestActor({ start: [0, 0, 0] });
    const control = makeTestActor({ start: [0, 0, 0] });
    for (let f = 0; f < 30; f++) { hit.step(1 / 60); control.step(1 / 60); }
    hit.blast({ wounds: [], meterCredit: 0, impulse: { at: chestOf(hit), vel: [6, 0, 0] }, reaction });
    for (let f = 0; f < 30; f++) { hit.step(1 / 60); control.step(1 / 60); }
    const a = hit.pose().pos, b = control.pose().pos;
    return Math.hypot(a[0] - b[0], a[2] - b[2]);
  };

  it("'blast' still knocks the root (today's behaviour)", () => {
    expect(travelAfter('blast')).toBeGreaterThan(0.05);
  });
  it("'flinch' does not knock the root", () => {
    expect(travelAfter('flinch')).toBeLessThan(0.02);
  });
  it("'none' changes nothing", () => {
    expect(travelAfter('none')).toBeLessThan(1e-6);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- game-actor`
Expected: FAIL — a TypeScript/vitest error that `reaction` does not exist on `ActorBlastEffect`, or
the `'flinch'` travel assertion failing (it knocks today).

- [ ] **Step 3: Add the option**

In `src/lab/sdf-zombie/webgpu/game-actor.ts`, extend the interface:

```ts
/** The slice of explosion-aoe.ts's `BodyExplosionEffect` the actor needs. */
export interface ActorBlastEffect {
  wounds: readonly Wound[];
  /** Σ wound radii × COLLAPSE_TUNING.meterRadiusWeight, falloff-scaled. */
  meterCredit: number;
  /** Concussion shove at the nearest surface point, or null. `vel` is the
   *  world-space velocity; its direction also anchors the reaction. */
  impulse: { at: Vec3; vel: Vec3 } | null;
  /** How the body reacts (default 'blast'). The censer (game-censer.ts) sends
   *  'flinch' for a tap — a pellet-class signal, no stagger, no knock — and
   *  'none' for a gouge-only batch, whose crater already raised the reaction. */
  reaction?: 'blast' | 'flinch' | 'none';
}
```

In `function blast(effect: ActorBlastEffect)`, replace step (3) — from the line
`const at: Vec3 = impulse ? impulse.at : bodyCentreWorld();` through the closing brace of the
`if (soldierDamage) { … } else { … }` knock block — with:

```ts
    const at: Vec3 = impulse ? impulse.at : bodyCentreWorld();
    const dirWorld: Vec3 = impulse ? unitOrZero(impulse.vel) : [0, 0, 0];
    const reaction = effect.reaction ?? 'blast';
    if (reaction === 'flinch') {
      // A melee tap: the pellet-class flinch, no stagger, no root knock.
      selectPendingShot({
        type: 'pellet',
        dirWorld: [...dirWorld] as Vec3,
        woundWorld: [...at] as Vec3,
        torso: true,
        ...(soldierDamage ? { soldierLevel: 'small' as const } : {}),
      });
    } else if (reaction === 'blast') {
      selectPendingShot({
        type: 'blast',
        dirWorld: [...dirWorld] as Vec3,
        woundWorld: [...at] as Vec3,
        torso: true,
        ...(soldierDamage ? { soldierLevel: 'medium' as const } : {}),
        gain: SLUG_GAIN,
      });
      if (soldierDamage) {
        mind.stagger(soldierStaggerDuration('medium'));
      } else {
        const l = Math.hypot(dirWorld[0], dirWorld[2]);
        if (l > 1e-6) {
          knockV = Math.max(knockV, BLAST_KNOCK_MPS);
          knockDir = [dirWorld[0] / l, 0, dirWorld[2] / l];
        }
      }
    }
```

Keep the existing comment block above step (3) and add one line to it:
`//     \`effect.reaction\` ('flinch' | 'none', the censer) narrows or skips this step.`

Also add one sentence to the `blast(effect)` doc comment in the `ZombieActor` interface
(~line 497): *"`effect.reaction` narrows the reaction for melee: 'flinch' or 'none'."*

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- game-actor explosion`
Expected: PASS, including the three existing *blast reaction* tests (they omit `reaction`, so they
get the default `'blast'`).

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/lab/sdf-zombie/webgpu/game-actor.ts src/lab/sdf-zombie/webgpu/game-actor.test.ts
git commit -m "feat(actor): blast() reaction option — 'flinch' / 'none' for melee (default 'blast' unchanged)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The `'censer'` slot on key 1, owned through the `'melee'` pickup

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-weapon-slots.ts:28-44`
- Modify: `src/lab/sdf-zombie/webgpu/game-weapon-slots.test.ts:29-35`
- Modify: `src/lab/sdf-zombie/webgpu/game-loop-leaves.ts` (`createLoop` default inventory ~line 76;
  `ownsSlot` ~line 134; the pickup loop in `stepLoop` ~line 189-203)
- Modify: `src/lab/sdf-zombie/webgpu/game-panels-leaves.ts:16-24` (HUD label)

- [ ] **Step 1: Update the slot tests first**

In `game-weapon-slots.test.ts`, replace the key/order expectations (lines 29-35) with:

```ts
    expect(slotForKey('Digit1')).toBe('censer');
    expect(slotForKey('Digit2')).toBe('shotgun');
    expect(slotForKey('Digit3')).toBe('dynamite');
    expect(slotForKey('Digit4')).toBe('flare');
    expect(slotForKey('Digit5')).toBeNull();
```

and

```ts
    expect(WEAPON_SLOTS).toEqual(['censer', 'shotgun', 'dynamite', 'flare']);
```

(Read the surrounding `it(...)` blocks first and keep their structure; only the literals change.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- game-weapon-slots`
Expected: FAIL — `expected 'shotgun' to be 'censer'`.

- [ ] **Step 3: Add the slot**

In `game-weapon-slots.ts` replace the type, order and key map:

```ts
/** Which weapon the player is holding. `censer` is the melee flail
 *  (game-censer.ts, 2026-09-26). `shotgun` is the grapeshot double.
 *  `flare` is the 2026-09-18 in-game burning-test harness: no projectile, no
 *  damage — its only verb is igniting the actor it hits. */
export type WeaponSlot = 'censer' | 'shotgun' | 'dynamite' | 'flare';

/** Slot order, which is ALSO the number-key order (1 → censer, 2 → shotgun,
 *  3 → dynamite, 4 → flare). Melee on 1, as in Blood. */
export const WEAPON_SLOTS: readonly WeaponSlot[] = ['censer', 'shotgun', 'dynamite', 'flare'];

/** `event.code` → slot. Only these keys select a weapon; every other key falls
 *  through to the existing handlers untouched. */
export const SLOT_BY_KEY: Readonly<Record<string, WeaponSlot>> = {
  Digit1: 'censer',
  Digit2: 'shotgun',
  Digit3: 'dynamite',
  Digit4: 'flare',
};
```

`makeWeaponSlotState(current = 'shotgun')` keeps its default (callers pick the start slot).

- [ ] **Step 4: Ownership, the default inventory and the pickup**

In `game-loop-leaves.ts`:

1. The sandbox inventory (no authored level) gets the censer too:

```ts
    inventory: authored ? makeInventory(def.loadout) : makeInventory(['melee', 'shotgun', 'dynamite', 'flare']),
```

2. `ownsSlot` maps the slot to its inventory item:

```ts
/** May the player select or fire this slot? The censer is owned as the
 *  'melee' inventory item (the level format's name). The flare is a dev
 *  harness: always. */
export function ownsSlot(ctx: GameContext, slot: WeaponSlot): boolean {
  const rt = ctx.world.loop;
  const item = slot === 'censer' ? 'melee' : slot;
  return !rt || slot === 'flare' || rt.inventory.weapons.includes(item);
}
```

3. In `stepLoop`'s pickup block, next to `const hadShotgun = …`, add
`const hadMelee = rt.inventory.weapons.includes('melee');` and inside the
`for (const p of picked.collected)` loop, after the shotgun branch:

```ts
      if (p.item === 'melee' && !hadMelee && !ownsSlot(ctx, ctx.weapon.slotState.live)) {
        // Empty-handed: the censer comes straight up.
        ctx.weapon.slotState = requestSlot(ctx.weapon.slotState, 'censer');
      }
```

- [ ] **Step 5: HUD label**

In `game-panels-leaves.ts` `updateHud`, replace the `const slot = …` expression with:

```ts
  const S = ctx.weapon.slotState;
  const slot = S.phase !== 'up'
    ? `switching ${S.target}`
    : S.live === 'censer'
      ? `1 CENSER ${ctx.weapon.censer?.debug().phase ?? ''}`.trimEnd()
      : S.live === 'dynamite'
        ? `3 DYNAMITE ${ctx.vfx.cook.phase === 'cooking'
          ? `${(ctx.dynamite.charge * 100).toFixed(0)}% LIT`
          : `${ctx.bake.liveBundles.length} out`}`
        : S.live === 'flare'
          ? '4 FLARE'
          : '2 GRAPESHOT';
```

`ctx.weapon.censer` does not exist until Task 7 — **leave this step's `censer?.debug()` line for
Task 7** if you run Task 5 alone: write `` `1 CENSER` `` now and add the phase in Task 7 Step 6.

- [ ] **Step 6: Run the tests**

Run: `npm test -- game-weapon-slots pickups game-loop game-seams`
Expected: PASS. If a test outside `game-weapon-slots.test.ts` encodes the old key numbers
(`Digit1 → shotgun`), update its literal the same way and name it in the commit message.

- [ ] **Step 7: Type-check and commit**

```bash
npx tsc --noEmit
git add src/lab/sdf-zombie/webgpu/game-weapon-slots.ts src/lab/sdf-zombie/webgpu/game-weapon-slots.test.ts \
  src/lab/sdf-zombie/webgpu/game-loop-leaves.ts src/lab/sdf-zombie/webgpu/game-panels-leaves.ts
git commit -m "feat(slots): 'censer' slot on key 1 (shotgun 2, dynamite 3, flare 4), owned via the 'melee' pickup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Note: until Task 7 lands, selecting slot 1 shows empty hands (nothing draws the censer yet).

---

### Task 6: The model — `scripts/model_censer.py` → `public/assets/lab/censer.glb`

**Files:**
- Create: `scripts/model_censer.py`
- Create: `public/assets/lab/censer.glb` (generated, committed — `public/assets/lab/*` is tracked)
- Create: `docs/dev-notes/2026-09-26-censer/censer-model.png` (generated preview)

The runtime contract (Task 7 reads these node names; a missing one logs a warning and the game
falls back to primitives):

| Node | Contents | Origin |
| --- | --- | --- |
| `Haft` | the snapped brass altar candlestick, grip at the bottom | the grip; up = +Y in glTF |
| `ChainAnchor` | empty, child of `Haft` | the knot where the chain is tied |
| `Head` | the thurible: bowl, pierced lid, rim, foot, three short chains, top ring | the bowl's centre; ring toward +Y |
| `CoalGlow` | emissive core, child of `Head` | the bowl's centre |
| `ChainLink` | one oval link, long axis +Y | the link's centre |

- [ ] **Step 1: Write the script**

```python
# scripts/model_censer.py — the censer flail (spec docs/superpowers/specs/2026-09-26-censer-flail-design.md §4.4).
#
# A funeral thurible knotted to a snapped brass altar candlestick. Exports
# public/assets/lab/censer.glb with the nodes game-censer.ts reads:
#   Haft (grip at origin), ChainAnchor (empty under Haft, the knot), Head (bowl
#   centred on its origin, ring up), CoalGlow (under Head), ChainLink (one link).
# Renders a preview to docs/dev-notes/2026-09-26-censer/censer-model.png and
# re-imports the GLB to assert the node contract.
#
# Run:  blender -b --factory-startup -P scripts/model_censer.py
# Metres. Blender space: Z up (glTF export turns it into +Y up).
import bpy, math, os
from mathutils import Vector

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB = os.path.join(REPO_ROOT, "public", "assets", "lab", "censer.glb")
NOTES_DIR = os.path.join(REPO_ROOT, "docs", "dev-notes", "2026-09-26-censer")
os.makedirs(NOTES_DIR, exist_ok=True)

HAFT_TOP = 0.30
HEAD_R = 0.065
REQUIRED = {"Haft", "ChainAnchor", "Head", "CoalGlow", "ChainLink"}
MAX_TRIS = 8000

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, metal, rough, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        key = "Emission Color" if "Emission Color" in b.inputs else "Emission"
        b.inputs[key].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


BRASS = mat("Brass", (0.62, 0.45, 0.18), 1.0, 0.35)
IRON = mat("Iron", (0.09, 0.085, 0.08), 0.9, 0.55)
GLOW = mat("CoalGlow", (0.05, 0.01, 0.0), 0.0, 0.9, emit=(1.0, 0.38, 0.08), strength=6.0)


def assign(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)


def cone(name, r1, r2, depth, z, verts=16, m=BRASS):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=(0, 0, z))
    o = bpy.context.object
    o.name = name
    assign(o, m)
    return o


def torus(name, major, minor, z, m=BRASS, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=20,
                                     minor_segments=8, location=(0, 0, z), rotation=rot)
    o = bpy.context.object
    o.name = name
    assign(o, m)
    return o


def join(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


# --- Haft: a snapped altar candlestick, grip at the origin ---------------------
parts = [
    cone("h_foot", 0.030, 0.018, 0.020, -0.02),                 # the knob under the fist
    cone("h_shaft", 0.013, 0.011, HAFT_TOP, HAFT_TOP / 2),
    torus("h_knop1", 0.016, 0.006, 0.10),
    torus("h_knop2", 0.017, 0.007, 0.19),
    cone("h_pan", 0.012, 0.034, 0.018, HAFT_TOP - 0.02),       # the drip pan, flaring up
]
# Snapped top: four jagged teeth where the candle cup broke off.
for i in range(4):
    a = i * math.pi / 2 + 0.3
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.006, radius2=0.0, depth=0.02 + 0.008 * (i % 2),
                                    location=(math.cos(a) * 0.024, math.sin(a) * 0.024, HAFT_TOP + 0.004))
    t = bpy.context.object
    assign(t, BRASS)
    parts.append(t)
parts.append(torus("h_knot", 0.016, 0.005, HAFT_TOP - 0.045, m=IRON))   # the chain tied under the pan
haft = join("Haft", parts)

anchor = bpy.data.objects.new("ChainAnchor", None)
bpy.context.collection.objects.link(anchor)
anchor.parent = haft
anchor.location = (0, 0, HAFT_TOP - 0.045)

# --- Head: bowl + pierced lid, centred on the origin ---------------------------
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=HEAD_R, location=(0, 0, 0))
bowl = bpy.context.object
bowl.name = "h_bowl"
assign(bowl, BRASS)
# Eight vertical slots through the upper half, so the coals show.
cutters = []
for i in range(8):
    a = i * math.pi / 4
    bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(a) * HEAD_R, math.sin(a) * HEAD_R, HEAD_R * 0.35))
    c = bpy.context.object
    c.scale = (0.03, 0.012, 0.03)
    c.rotation_euler = (0, 0, a)
    cutters.append(c)
cutter = join("h_cutter", cutters)
mod = bowl.modifiers.new("slots", 'BOOLEAN')
mod.operation = 'DIFFERENCE'
mod.object = cutter
bpy.ops.object.select_all(action='DESELECT')
bowl.select_set(True)
bpy.context.view_layer.objects.active = bowl
bpy.ops.object.modifier_apply(modifier="slots")
bpy.data.objects.remove(cutter, do_unlink=True)

rim = torus("h_rim", HEAD_R * 0.98, 0.004, 0.0)
foot = cone("h_foot_ring", HEAD_R * 0.45, HEAD_R * 0.5, 0.012, -HEAD_R * 0.98)
finial = cone("h_finial", 0.008, 0.002, 0.03, HEAD_R + 0.012)
ring = torus("h_ring", 0.014, 0.003, HEAD_R + 0.07, rot=(math.pi / 2, 0, 0))
chains = []
for i in range(3):
    a = i * 2 * math.pi / 3
    p0 = Vector((math.cos(a) * HEAD_R * 0.95, math.sin(a) * HEAD_R * 0.95, 0.0))
    p1 = Vector((0, 0, HEAD_R + 0.058))
    d = p1 - p0
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.0022, depth=d.length, location=(p0 + p1) / 2)
    s = bpy.context.object
    s.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    assign(s, IRON)
    chains.append(s)
head = join("Head", [bowl, rim, foot, finial, ring] + chains)

bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=HEAD_R * 0.55, location=(0, 0, 0))
coal = bpy.context.object
coal.name = "CoalGlow"
assign(coal, GLOW)
coal.parent = head
head.location = (0.3, 0, 0)          # beside the haft in the file; the runtime zeroes it

# --- One chain link: an oval ring, long axis +Z here (+Y in glTF) ---------------
bpy.ops.mesh.primitive_torus_add(major_radius=0.010, minor_radius=0.0025, major_segments=12,
                                 minor_segments=6, location=(0.5, 0, 0), rotation=(math.pi / 2, 0, 0))
link = bpy.context.object
link.name = "ChainLink"
link.scale = (1.0, 1.6, 1.0)
assign(link, IRON)
bpy.ops.object.select_all(action='DESELECT')
link.select_set(True)
bpy.context.view_layer.objects.active = link
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

# --- Preview render (workbench) -------------------------------------------------
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (0.25, -0.9, 0.25)
cam.rotation_euler = (math.radians(80), 0, math.radians(0))
bpy.context.scene.camera = cam
bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'
bpy.context.scene.display.shading.color_type = 'MATERIAL'
bpy.context.scene.render.resolution_x = 900
bpy.context.scene.render.resolution_y = 700
bpy.context.scene.render.filepath = os.path.join(NOTES_DIR, "censer-model.png")
bpy.ops.render.render(write_still=True)
bpy.data.objects.remove(cam, do_unlink=True)

# --- Export + verify -------------------------------------------------------------
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', export_apply=True, export_yup=True)
size = os.path.getsize(OUT_GLB)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=OUT_GLB)
new = [o for o in bpy.data.objects if o not in before]
names = {o.name.split('.')[0] for o in new}
tris = 0
for o in new:
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
missing = sorted(REQUIRED - names)
print(f"[censer] exported {OUT_GLB} ({size} bytes, {tris} tris); nodes {sorted(names)}")
if missing:
    raise SystemExit(f"[censer] FAIL: missing nodes {missing}")
if tris > MAX_TRIS:
    raise SystemExit(f"[censer] FAIL: {tris} tris > {MAX_TRIS}")
print("[censer] PASS")
```

- [ ] **Step 2: Run it**

Run: `blender -b --factory-startup -P scripts/model_censer.py`
Expected: the last lines are `[censer] exported …/public/assets/lab/censer.glb (… bytes, … tris); nodes [...]`
and `[censer] PASS`. Look at `docs/dev-notes/2026-09-26-censer/censer-model.png` yourself: a brass
candlestick with jagged top, and beside it a slotted brass bowl with three chains to a ring and an
orange core. If the preview camera misses the objects, adjust `cam.location` only; the geometry is
the contract.

- [ ] **Step 3: Commit**

```bash
git add scripts/model_censer.py public/assets/lab/censer.glb docs/dev-notes/2026-09-26-censer/censer-model.png
git commit -m "feat(censer): Blender model script + censer.glb (Haft, ChainAnchor, Head, CoalGlow, ChainLink)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The renderer-facing leaf (`game-censer.ts`) and its wiring

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-censer.ts`
- Create: `src/lab/sdf-zombie/webgpu/game-seams-censer.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-state-weapon.ts` (import ~line 28; field ~line 88; factory ~line 200)
- Modify: `src/lab/sdf-zombie/webgpu/game-weapon-leaves.ts` (`stepWeaponSlots`, ~line 260)
- Modify: `src/lab/sdf-zombie/webgpu/game-panels-leaves.ts` (the HUD phase, if deferred from Task 5)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` — imports (~lines 103, 267, 283), creation after the
  flare (~line 3737), mousedown (~line 3693), a mouseup listener (~line 3706), the start slot
  (~line 5231), `tick` (~lines 6662 and 7075), the seams list (~line 8146)

Not a recorded demo verb (like the flare): replays do not swing it. Say so in the file header.

- [ ] **Step 1: Add the weapon-slice field**

In `game-state-weapon.ts`: add `import type { CenserWeapon } from './game-censer';` beside the
`FlareHarness` import; below the `flare` field add

```ts
  /** Slot 1 (the censer flail, game-censer.ts); null until the aim rig exists. */
  censer: CenserWeapon | null;
```

and in `makeWeaponState()` below `flare: null,` add `censer: null,`.

- [ ] **Step 2: Write `game-censer.ts`**

```ts
// src/lab/sdf-zombie/webgpu/game-censer.ts
//
// WEAPON SLOT 1: THE CENSER FLAIL (spec docs/superpowers/specs/2026-09-26-censer-flail-design.md),
// lifted beside game-main.ts like game-flare.ts. The renderer-facing half ONLY:
//   censer-swing.ts  the verbs, the timing and the handle's pose
//   censer-head.ts   the rope pendulum the handle swings
//   censer-hit.ts    head motion → wound spheres
// This file puts the haft on the aim rig, the head and the chain in the WORLD
// (they swing through it, not with the camera), and hands hit events to the
// actors through ZombieActor.blast() as 'blast'-type sphere wounds.
//
// Not a recorded DemoFrame verb (like the flare): a replay does not swing it.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';
import type { ZombieActor } from './game-actor';
import { worldHitToWound, type Wound } from '../damage';
import { sdBody } from '../validate';
import { slotLowerAmount, slotReady } from './game-weapon-slots';
import { loopBlocksInput, ownsSlot } from './game-loop-leaves';
import { BEND_R_VIEW, SHOULDER_R_VIEW } from './game-weapon-leaves';
import { GOBLIN_ARM_GLB, aimArm, loadGoblinArms } from './game-arms';
import {
  cancelCenserSwing, deadzoneOffset, handlePose, hitWindow, makeCenserSwing, stepCenserSwing,
  type CenserSwing,
} from './censer-swing';
import { CENSER_HEAD, makeCenserHead, stepCenserHead, type CenserHead, type HeadWorld } from './censer-head';
import { makeStrokeHits, sweepHead, type ActorProbe, type HitEvent, type StrokeHits } from './censer-hit';

const CENSER_GLB = '/assets/lab/censer.glb';
/** The grip's rest, aim-rig (view) space: low right, like the shotgun's grip. */
export const CENSER_REST = { pos: new THREE.Vector3(0.16, -0.2, -0.34), haftTiltDeg: -35 } as const;
/** The knot's height up the primitive haft; the GLB's ChainAnchor replaces it. */
const PRIM_ANCHOR_Y = 0.26;
const CHAIN_LINKS = 12;
/** Feel numbers (spec §3.3), lerped from a tap to a full charge. */
export const CENSER_FEEL = {
  hitStopTapSec: 0.03,
  hitStopHeavySec: 0.07,
  /** dt multiplier while a hit-stop runs: near-frozen, never 0. */
  hitStopScale: 0.08,
  kickTapRad: 0.012,
  kickHeavyRad: 0.035,
  /** Reaction direction magnitude handed to blast() (it unit-normalises; 0 = no direction). */
  shoveTap: 1.5,
  shoveHeavy: 6,
  /** Charge above which a strike staggers rather than flinches. */
  staggerCharge: 0.5,
} as const;

export interface CenserDeps {
  camera: THREE.Camera;
  /** Blood for a crater (game-world-leaves3 registerBleed). */
  bleed(a: ZombieActor, wound: Wound, point: Vec3, incoming: Vec3): void;
}

export interface CenserDebug {
  phase: string;
  charge: number;
  heavy: boolean;
  strokeId: number;
  head: Vec3;
  headSpeed: number;
  hits: number;
  lastHit: { actor: number; spheres: number; speedIn: number } | null;
}

export interface CenserWeapon {
  /** A mousedown while the censer is live. True = consumed. */
  onMouseDown(button: number): boolean;
  onMouseUp(button: number): void;
  /** Once per tick, AFTER the aim rig is placed and stepWeaponSlots has run. */
  tick(dt: number): void;
  /** Holster travel from the shared slot state (stepWeaponSlots calls it). */
  updateRig(): void;
  /** This tick's dt multiplier while a hit-stop runs (1 otherwise); counts down on the unscaled dt. */
  hitStopScale(dt: number): number;
  press(): void;
  release(): void;
  setHitStop(on: boolean): void;
  debug(): CenserDebug;
}

const lerp = THREE.MathUtils.lerp;

export function createCenser(ctx: GameContext, deps: CenserDeps): CenserWeapon {
  // ---- The rig: holster travel → handle (swing pose) → haft (tilt) --------
  const rig = new THREE.Group();
  rig.name = 'censer-rig';
  ctx.weapon.aimRig!.add(rig);
  const handle = new THREE.Group();
  handle.name = 'censer-handle';
  handle.position.copy(CENSER_REST.pos);
  rig.add(handle);
  const haft = new THREE.Group();
  haft.name = 'censer-haft';
  haft.rotation.x = THREE.MathUtils.degToRad(CENSER_REST.haftTiltDeg);
  handle.add(haft);
  const anchorLocal = new THREE.Vector3(0, PRIM_ANCHOR_Y, 0);

  // Metal is black without something to reflect (the flare's note).
  const pmrem = new THREE.PMREMGenerator(ctx.boot.handle.renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const brass = new THREE.MeshStandardMaterial({ color: 0x9c7a34, metalness: 1, roughness: 0.38, envMap: env, envMapIntensity: 1.1 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2c2b2a, metalness: 0.9, roughness: 0.55, envMap: env, envMapIntensity: 0.8 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff6a1c, emissiveIntensity: 3 });

  // PRIMITIVES FIRST, GLB OVER THEM (the flare's rule): the game never waits on the model.
  const haftPrim = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.3, 12), brass);
  haftPrim.position.y = 0.15;
  haft.add(haftPrim);

  const head = new THREE.Group();
  head.name = 'censer-head';
  const headPrim = new THREE.Group();
  const coalCap = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 6), glow);
  coalCap.position.y = CENSER_HEAD.radius * 0.8;
  headPrim.add(new THREE.Mesh(new THREE.SphereGeometry(CENSER_HEAD.radius, 20, 14), brass), coalCap);
  head.add(headPrim);

  const chain = new THREE.Group();
  chain.name = 'censer-chain';
  const links: THREE.Mesh[] = [];
  const primLink = new THREE.TorusGeometry(0.01, 0.0025, 6, 10);
  for (let i = 0; i < CHAIN_LINKS; i++) {
    const m = new THREE.Mesh(primLink, iron);
    m.matrixAutoUpdate = false;
    links.push(m);
    chain.add(m);
  }
  ctx.boot.handle.scene.add(head, chain);
  if (ctx.boot.deferredApi) {
    for (const o of [rig, head, chain]) ctx.boot.deferredApi.router.register(o, 'mesh', 'level-only');
  }

  void (async () => {
    try {
      const gltf = await new GLTFLoader().loadAsync(CENSER_GLB);
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const need = (n: string): THREE.Object3D => {
        const o = root.getObjectByName(n);
        if (!o) throw new Error(`censer.glb is missing the ${n} node`);
        return o;
      };
      const haftNode = need('Haft'), anchorNode = need('ChainAnchor'), headNode = need('Head'), linkNode = need('ChainLink');
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
          const std = mat as THREE.MeshStandardMaterial;
          if (std.isMeshStandardMaterial && std.metalness > 0.5) {
            std.envMap = env; std.envMapIntensity = 1.1; std.needsUpdate = true;
          }
        }
      });
      // The knot in the haft's own frame — read BEFORE the haft is re-parented.
      anchorLocal.copy(haftNode.worldToLocal(anchorNode.getWorldPosition(new THREE.Vector3())));
      haftNode.removeFromParent();
      haftNode.position.set(0, 0, 0);
      haftNode.quaternion.identity();
      haft.add(haftNode);
      haftPrim.visible = false;
      headNode.removeFromParent();
      headNode.position.set(0, 0, 0);
      headNode.quaternion.identity();
      head.add(headNode);
      headPrim.visible = false;
      const found: THREE.Mesh[] = [];
      linkNode.traverse((o) => { if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh); });
      const lm = found[0];
      if (lm) for (const m of links) { m.geometry = lm.geometry; m.material = lm.material; }
    } catch (e) {
      console.warn('[sdf-game] censer.glb absent or unreadable — using the primitive censer', e);
    }
  })();

  // ---- The hand: a second goblin right arm, fist on the haft -----------------
  let hand: THREE.Group | null = null;
  void loadGoblinArms(GOBLIN_ARM_GLB, { env, envMapIntensity: 1.1 }).then((arms) => {
    hand = arms.right;
    hand.name = 'censer-hand';
    hand.position.set(0, 0.03, 0);
    haft.add(hand);
  }).catch((e) => console.warn('[sdf-game] censer hand: goblin-arm.glb failed', e));
  const _sh = new THREE.Vector3(), _bend = new THREE.Vector3();
  function aimHand(): void {
    if (!hand) return;
    const view = ctx.weapon.viewModelAnchor;
    view.localToWorld(_sh.copy(SHOULDER_R_VIEW));
    view.localToWorld(_bend.copy(SHOULDER_R_VIEW).add(BEND_R_VIEW));
    haft.worldToLocal(_sh);
    haft.worldToLocal(_bend);
    _bend.sub(_sh).normalize();
    aimArm(hand, _sh, _bend);
  }

  // ---- State ---------------------------------------------------------------
  let swing: CenserSwing = makeCenserSwing();
  let headSim: CenserHead | null = null;
  let hits: StrokeHits | null = null;
  let held = false;
  let hitStop = 0;
  let hitStopOn = true;
  let hitCount = 0;
  let lastHit: CenserDebug['lastHit'] = null;
  const anchorW = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  const _up = new THREE.Vector3(), _p = new THREE.Vector3(), _tan = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _roll = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);

  function anchorWorld(): Vec3 {
    const hp = handlePose(swing);
    handle.position.set(CENSER_REST.pos.x + hp[0], CENSER_REST.pos.y + hp[1], CENSER_REST.pos.z + hp[2]);
    rig.updateWorldMatrix(true, true);
    haft.localToWorld(anchorW.copy(anchorLocal));
    return [anchorW.x, anchorW.y, anchorW.z];
  }

  function probes(): ActorProbe[] {
    const out: ActorProbe[] = [];
    for (const a of ctx.world.actors) {
      const posed = a.posed();
      const c = posed.clusters.find(cc => cc.limb === 'torso')?.center;
      if (c) out.push({ id: a.id, centre: c, field: q => sdBody(q, posed) });
    }
    return out;
  }

  /** One blast() per struck actor per tick: craters raise the reaction, gouge-only batches do not. */
  function applyHits(events: readonly HitEvent[]): void {
    const charge = swing.heavy ? swing.charge : 0;
    const byActor = new Map<number, HitEvent[]>();
    for (const e of events) byActor.set(e.actorId, [...(byActor.get(e.actorId) ?? []), e]);
    for (const [id, list] of byActor) {
      const a = ctx.world.actors.find(x => x.id === id);
      if (!a) continue;
      const posed = a.posed();
      const yaw = a.pose().yaw;
      const field = (p: Vec3) => sdBody(p, posed);
      const wounds: Wound[] = [];
      let credit = 0;
      let crater: { at: Vec3; wound: Wound } | null = null;
      for (const e of list) for (const s of e.spheres) {
        const w = worldHitToWound(posed.prims, s.at, s.radius, 'blast', yaw, field);
        w.severRadius = s.severRadius;
        wounds.push(w);
        credit += s.meterCredit;
        if (s.kind === 'crater' && !crater) crater = { at: s.at, wound: w };
      }
      const dir = list[0]!.dir;
      const shove = crater ? lerp(CENSER_FEEL.shoveTap, CENSER_FEEL.shoveHeavy, charge) : 0;
      a.blast({
        wounds,
        meterCredit: credit,
        impulse: { at: crater?.at ?? list[0]!.spheres[0]!.at, vel: [dir[0] * shove, dir[1] * shove, dir[2] * shove] },
        reaction: !crater ? 'none' : charge > CENSER_FEEL.staggerCharge ? 'blast' : 'flinch',
      });
      if (!crater) continue;
      hitCount++;
      lastHit = { actor: id, spheres: wounds.length, speedIn: list[0]!.speedIn };
      deps.bleed(a, crater.wound, crater.at, dir);
      if (hitStopOn) hitStop = lerp(CENSER_FEEL.hitStopTapSec, CENSER_FEEL.hitStopHeavySec, charge);
      ctx.weapon.recoilPitch += lerp(CENSER_FEEL.kickTapRad, CENSER_FEEL.kickHeavyRad, charge);
      ctx.weapon.shotAlert = true;   // a landed blow is a noise
      ctx.telemetry.telemetry.event('censer-hit', { actor: id, charge, spheres: wounds.length });
    }
  }

  function drawHead(anchor: Vec3): void {
    const h = headSim!.pos;
    head.position.set(h[0], h[1], h[2]);
    _up.set(anchor[0] - h[0], anchor[1] - h[1], anchor[2] - h[2]);
    const span = _up.length();
    if (span > 1e-6) { _up.divideScalar(span); head.quaternion.setFromUnitVectors(Y, _up); } else _up.copy(Y);
    // The chain: links along a quadratic curve from the knot to the ring,
    // sagging by the rope's slack (straight when taut).
    const rr = CENSER_HEAD.radius * 1.3;
    const ring: Vec3 = [h[0] + _up.x * rr, h[1] + _up.y * rr, h[2] + _up.z * rr];
    const sag = Math.max(0, CENSER_HEAD.ropeLen - span) * 0.6;
    const c: Vec3 = [(anchor[0] + ring[0]) / 2, (anchor[1] + ring[1]) / 2 - sag, (anchor[2] + ring[2]) / 2];
    for (let i = 0; i < CHAIN_LINKS; i++) {
      const t = (i + 0.5) / CHAIN_LINKS, u = 1 - t;
      _p.set(
        u * u * anchor[0] + 2 * u * t * c[0] + t * t * ring[0],
        u * u * anchor[1] + 2 * u * t * c[1] + t * t * ring[1],
        u * u * anchor[2] + 2 * u * t * c[2] + t * t * ring[2],
      );
      _tan.set(
        2 * u * (c[0] - anchor[0]) + 2 * t * (ring[0] - c[0]),
        2 * u * (c[1] - anchor[1]) + 2 * t * (ring[1] - c[1]),
        2 * u * (c[2] - anchor[2]) + 2 * t * (ring[2] - c[2]),
      );
      if (_tan.lengthSq() < 1e-12) _tan.copy(Y); else _tan.normalize();
      _q.setFromUnitVectors(Y, _tan);
      _roll.setFromAxisAngle(_tan, i % 2 === 0 ? 0 : Math.PI / 2);   // alternate links cross
      _q.premultiply(_roll);
      links[i]!.matrix.compose(_p, _q, _one);
      links[i]!.matrixWorldNeedsUpdate = true;
    }
  }

  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'censer') return false;
      if (button === 0) held = true;
      return true;
    },
    onMouseUp(button) {
      if (button === 0) held = false;
    },
    tick(dt) {
      const live = ctx.weapon.slotState.live === 'censer';
      const ready = live && slotReady(ctx.weapon.slotState) && !loopBlocksInput(ctx);
      if (!live) held = false;
      if (!ready) {
        if (swing.phase !== 'idle') swing = cancelCenserSwing(swing);
      } else {
        swing = stepCenserSwing(swing, { down: held, offset: deadzoneOffset(ctx.weapon.aim) }, dt);
      }
      const anchor = anchorWorld();
      // The head re-hangs whenever it was out of frame, so a raise never
      // starts with a swing carried over from wherever it was put away.
      if (!headSim || !rig.visible) headSim = makeCenserHead(anchor);
      if (hitWindow(swing)) {
        if (!hits || hits.strokeId !== swing.strokeId) hits = makeStrokeHits(swing.strokeId, swing.heavy ? swing.charge : 0);
      } else {
        hits = null;
      }
      const ledger = hits;
      const ps = ledger ? probes() : [];
      const events: HitEvent[] = [];
      const world: HeadWorld = { floorY: ctx.player.player.pos[1], boxes: ctx.world.colliders };
      headSim = stepCenserHead(headSim, anchor, dt, world, ledger
        ? (from, to, vel) => {
          const r = sweepHead(ledger, from, to, vel, CENSER_HEAD.radius, ps);
          for (const e of r.events) events.push(e);
          return r.velScale;
        }
        : undefined);
      if (events.length > 0) applyHits(events);
      drawHead(anchor);
      aimHand();
    },
    updateRig() {
      const lower = slotLowerAmount(ctx.weapon.slotState, 'censer');
      rig.position.set(0, -0.42 * lower, 0.06 * lower);
      rig.rotation.set(THREE.MathUtils.degToRad(38) * lower, 0, 0);
      const shown = lower < 0.999 && ownsSlot(ctx, 'censer');
      rig.visible = shown;
      head.visible = shown;
      chain.visible = shown;
    },
    hitStopScale(dt) {
      if (hitStop <= 0) return 1;
      hitStop -= dt;
      return CENSER_FEEL.hitStopScale;
    },
    press() { held = true; },
    release() { held = false; },
    setHitStop(on) { hitStopOn = on; if (!on) hitStop = 0; },
    debug() {
      const h = headSim;
      return {
        phase: swing.phase,
        charge: swing.charge,
        heavy: swing.heavy,
        strokeId: swing.strokeId,
        head: h ? [h.pos[0], h.pos[1], h.pos[2]] : [0, 0, 0],
        headSpeed: h ? Math.hypot(h.vel[0], h.vel[1], h.vel[2]) : 0,
        hits: hitCount,
        lastHit,
      };
    },
  };
}
```

`deps.camera` is unused until Task 8 (the smoke). If the linter flags it, leave it: Task 8 reads it.

- [ ] **Step 3: Write the seams**

```ts
// src/lab/sdf-zombie/webgpu/game-seams-censer.ts
//
// Censer automation seams (scripts/censer-gate.mjs): drive the swing without a
// mouse, park the weapon in the dead zone, read the swing and the damage back.
import type { GameContext } from './game-context';
import { FREE_AIM } from './free-aim';

export function createCenserSeams(ctx: GameContext) {
  return {
    censer: {
      /** Hold / let go of the attack button. */
      press: () => { ctx.weapon.censer?.press(); },
      release: () => { ctx.weapon.censer?.release(); },
      /** Park the weapon in the dead zone: x, y in dead-zone units (±1 = its edge). */
      setAim: (x: number, y: number) => {
        ctx.weapon.aim = { x: x * FREE_AIM.deadzoneX, y: y * FREE_AIM.deadzoneY };
      },
      /** Off for deterministic frame counts in gates. */
      setHitStop: (on: boolean) => { ctx.weapon.censer?.setHitStop(on); },
      state: () => ctx.weapon.censer?.debug() ?? null,
      /** Live (not dead, not carve) prims on one limb of an actor — a sever readback. -1 = no actor. */
      limbAlive: (id: number, limb: string) => {
        const a = ctx.world.actors.find(q => q.id === id);
        return a ? a.drawnBody().prims.filter(p => p.limb === limb && !p.dead && p.op !== 'sub').length : -1;
      },
    },
  };
}
```

- [ ] **Step 4: Hook the holster**

In `game-weapon-leaves.ts` `stepWeaponSlots`, after `ctx.weapon.flare?.updateRig();` add:

```ts
  // Slot 1: the censer's holster travel (game-censer.ts).
  ctx.weapon.censer?.updateRig();
```

- [ ] **Step 5: Wire `game-main.ts`**

1. Imports: add `ownsSlot` to the existing `import { applyDeathCamera, createLoop, … } from './game-loop-leaves';`
   line, and add near the flare/seams imports:

```ts
import { createCenser } from './game-censer';
import { createCenserSeams } from './game-seams-censer';
```

2. Creation — directly after the `ctx.weapon.flare = createFlareHarness(ctx, { … });` statement:

```ts
  // WEAPON SLOT 1 (the censer flail, game-censer.ts): its own rig on aimRig,
  // its head and chain in the world.
  ctx.weapon.censer = createCenser(ctx, {
    camera,
    bleed: (a, w, point, incoming) => registerBleed(ctx, a, w, 'slug', { point, incoming }),
  });
```

3. Mousedown — in the canvas `mousedown` listener, directly before
   `if (ctx.weapon.flare?.onMouseDown(e.button)) return;`:

```ts
    // SLOT 1: a HELD input (tap = stroke, hold = spin), read by the tick.
    if (ctx.weapon.censer?.onMouseDown(e.button)) return;
```

4. Mouseup — after the dynamite `window.addEventListener('mouseup', …)` block:

```ts
  // The censer's release: no pointer-lock check, so letting go anywhere ends the hold.
  window.addEventListener('mouseup', (e) => ctx.weapon.censer?.onMouseUp(e.button));
```

5. Start slot — replace `ctx.weapon.slotState = makeWeaponSlotState('shotgun');` with:

```ts
  // Start on the shotgun when it is owned; a melee-only loadout (Night Train,
  // the Wake) starts with the censer in hand instead of empty hands.
  ctx.weapon.slotState = makeWeaponSlotState(
    !ownsSlot(ctx, 'shotgun') && ownsSlot(ctx, 'censer') ? 'censer' : 'shotgun');
```

6. Hit-stop — in `function tick(dt: number)`, directly after
   `if (ctx.demo.simLocked) return; …`:

```ts
    // CENSER HIT-STOP: a landed strike nearly freezes the sim for 30–70 ms
    // (game-censer.ts). Its timer counts down on the UNSCALED step.
    dt *= ctx.weapon.censer?.hitStopScale(dt) ?? 1;
```

7. The censer tick — directly after `stepWeaponSlots(ctx, dt);` in `tick`:

```ts
    // The censer, after the rig AND the holster are placed: its anchor is the
    // knot on the haft, in world space, this frame.
    ctx.weapon.censer?.tick(dt);
```

8. Seams — in the `mergeSeams(` list, after `createFireSeams(ctx),` add `createCenserSeams(ctx),`.

- [ ] **Step 6: HUD phase**

If Task 5 wrote `` `1 CENSER` ``, change it to
`` `1 CENSER ${ctx.weapon.censer?.debug().phase ?? ''}`.trimEnd() ``.

- [ ] **Step 7: Type-check and run the targeted tests**

Run: `npx tsc --noEmit && npm test -- censer game-weapon-slots game-actor game-context-coverage game-seams`
Expected: PASS. `game-context-coverage` passes because no `main()` binding was added (all state is
inside `createCenser` or on `ctx.weapon.censer`).

- [ ] **Step 8: Boot smoke test (headless)**

Start the servers (`bash -c 'source scripts/lab-servers.sh …'` per the script's own header — it
must be sourced from **bash**, not zsh), then load `/sdf-game.html?level=night-train&vhs=off`
headlessly and assert: `__sdfGame.backend === 'webgpu'`, the warm gate reaches `ready`,
`__sdfGame.censer.state().phase === 'idle'`, and zero console errors. Capture one screenshot to
`docs/dev-notes/2026-09-26-censer/boot-night-train.png` and look at it: the censer on its
candlestick in the lower right, the head hanging below it. Kill the servers you started.

- [ ] **Step 9: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-censer.ts src/lab/sdf-zombie/webgpu/game-seams-censer.ts \
  src/lab/sdf-zombie/webgpu/game-state-weapon.ts src/lab/sdf-zombie/webgpu/game-weapon-leaves.ts \
  src/lab/sdf-zombie/webgpu/game-panels-leaves.ts src/lab/sdf-zombie/webgpu/game-main.ts \
  docs/dev-notes/2026-09-26-censer/boot-night-train.png
git commit -m "feat(censer): game leaf — haft on the aim rig, world head + chain, hits via blast(), hit-stop, seams

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The incense smoke trail

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-censer.ts`

A thin trail of camera-facing puffs from the head, in the character-effects overlay (the scene
tracers use, so bodies occlude it correctly — `game-weapon-leaves.ts` `newTracerView`). The texture is
`ctx.vfx.smokeBurstTex`, which is created later in boot than the censer, so it is read lazily.

- [ ] **Step 1: Add the puffs**

In `createCenser`, after the chain is built, add:

```ts
  // ---- Incense smoke: a pooled trail of camera-facing puffs ------------------
  const PUFFS = 14;
  const SMOKE = { everySec: 0.05, lifeSec: 1.4, riseMps: 0.12, size0: 0.06, size1: 0.22, alpha: 0.35 } as const;
  const puffGeo = new THREE.PlaneGeometry(1, 1);
  const puffs = Array.from({ length: PUFFS }, () => {
    const mesh = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({
      color: 0xb8b0a4, transparent: true, opacity: 0, depthWrite: false,
    }));
    mesh.visible = false;
    mesh.frustumCulled = false;
    ctx.vfx.characterEffects.scene.add(mesh);
    return { mesh, age: Infinity, pos: new THREE.Vector3() };
  });
  let puffCursor = 0, puffClock = 0;
  function stepSmoke(dt: number, shown: boolean): void {
    const mat0 = puffs[0]!.mesh.material as THREE.MeshBasicMaterial;
    if (!mat0.map && ctx.vfx.smokeBurstTex) {
      for (const p of puffs) { const m = p.mesh.material as THREE.MeshBasicMaterial; m.map = ctx.vfx.smokeBurstTex; m.needsUpdate = true; }
    }
    puffClock += dt;
    if (shown && headSim && puffClock >= SMOKE.everySec) {
      puffClock = 0;
      const p = puffs[puffCursor++ % PUFFS]!;
      p.age = 0;
      p.pos.set(headSim.pos[0], headSim.pos[1] + CENSER_HEAD.radius * 0.6, headSim.pos[2]);
    }
    for (const p of puffs) {
      p.age += dt;
      const live = p.age < SMOKE.lifeSec;
      p.mesh.visible = live;
      if (!live) continue;
      const k = p.age / SMOKE.lifeSec;
      p.mesh.position.set(p.pos.x, p.pos.y + SMOKE.riseMps * p.age, p.pos.z);
      p.mesh.quaternion.copy(deps.camera.quaternion);
      p.mesh.scale.setScalar(lerp(SMOKE.size0, SMOKE.size1, k));
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = SMOKE.alpha * (1 - k);
    }
  }
```

`deps.camera.quaternion` is the camera's local rotation. The game's camera is a direct child of the
scene (`scene.add(camera)` in `game-main.ts`), so local = world. If that ever changes, use
`getWorldQuaternion`.

In `tick`, after `drawHead(anchor);` add `stepSmoke(dt, rig.visible);`.

- [ ] **Step 2: Type-check, capture, look**

Run: `npx tsc --noEmit`. Then boot Night Train headlessly as in Task 7 Step 8, hold the censer
(`__sdfGame.censer.press(); __sdfGame.step(90, 1/60)`), and capture
`docs/dev-notes/2026-09-26-censer/smoke-spin.png`. Measure it: the mean luminance of a 60×60 crop
around the head's screen position (`__sdfGame.worldToScreen(...head, w, h)`) must differ from the
same crop in a capture with the puffs hidden (`opacity` forced to 0 through a temporary console
call) by > 2 levels. Record both numbers in the notes. Kill what you started.

- [ ] **Step 3: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-censer.ts docs/dev-notes/2026-09-26-censer/smoke-spin.png
git commit -m "feat(censer): incense smoke trail (pooled overlay puffs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8b: Swing motion blur through the gib shutter layer (owner request, 2026-09-26)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/censer-blur.ts` (pure: censer parts → `GibBlurSubject`-compatible motion states) + `censer-blur.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-censer.ts` (expose `blurSubjects()`), `src/lab/sdf-zombie/webgpu/game-main.ts:~7686`
  (the single `ctx.gibs.shutter.select(...)` call)

The game already smears fast OPAQUE meshes: `gib-shutter-layer.ts` moves selected meshes to
`GIB_BLUR_LAYER` (10), renders a clean background without them, draws them alone, and resolves a
rotation-aware motion seed (`gib-motion-blur.ts` `planGibMotionStamps`) over the frame. It is on in
the default (legacy) route and hard-off on `?renderer=deferred`. The censer's head, chain links and
haft are exactly this kind of subject during a swing.

- [ ] **Step 1: Read the contract.** `GibBlurSubject { id, state: Chunk, mesh: THREE.Mesh, baseLayer, ageSeconds }`
  (`gib-shutter-layer.ts:73`). `gib-motion-blur.ts` reads only `state.pos/vel/quat/angVel/radius/squash/support`
  (verify with grep). Selection is by `isGibSelectedForBlur` (speed ≥ 0.12 m/s or ω ≥ 0.5 rad/s).
  `select()` must be called ONCE per frame with ALL subjects, BEFORE the base render; it puts
  everything not passed back on its base layer.
- [ ] **Step 2: Pure adapter (TDD).** `censer-blur.ts` exports
  `censerMotionState(prev: {pos, quat}, cur: {pos, quat}, dt, radius): Chunk-shaped` — velocity from
  the position delta, angular velocity from the shortest-arc quaternion delta (reuse the quaternion
  helpers in `../vec`), `squash: 0`, one origin support sphere, and the remaining `Chunk` fields
  filled with neutral values (`limb: 'torso'`, `kind: 'gob'`, `longAxis: [0,1,0]` — check `Chunk`
  for the full list). Tests: a pure translation gives the right `vel` and zero `angVel`; a 90°/s spin
  gives `|angVel| ≈ π/2`; `dt ≤ 0` gives zero motion; the shortest arc never takes the long way.
- [ ] **Step 3: Subjects from the censer.** In `game-censer.ts` keep each part's previous world
  pose and expose `blurSubjects(dt): GibBlurSubject[]` for: the head (one subject per MESH under the
  head group — layers are per-object, not inherited — all sharing the head's motion state, radius
  `CENSER_HEAD.radius`), each chain link (radius 0.01), and the haft's meshes (world motion of the
  haft, radius 0.03, including the hand/arm meshes so they smear with it). Stable ids in a range
  that cannot collide with gib ids (e.g. `1_000_000 + n`). Return `[]` when the censer is hidden,
  and only during `hitWindow` or `windup` (a resting censer never blurs). `ageSeconds`: time since
  the swing phase began (so a fresh stroke does not streak backwards).
- [ ] **Step 4: Wire it.** At `game-main.ts:~7686` pass
  `[...gibBlurSubjects(ctx), ...(ctx.weapon.censer?.blurSubjects(dt) ?? [])]` (respecting
  `GIB_BLUR_MAX_PIECES` = 64: censer subjects first, gibs fill the rest, or raise the cap if the
  layer allows — report which). Keep the `enabled` gate. Camera-parented meshes (the haft) are fine:
  layers are per object and the seed projects through the current camera.
- [ ] **Step 5: Verify headless** (the Task 7 harness): hold a charged spin and capture mid-stroke with
  blur on and with `__sdfGame.setGibBlur(false)` (or the seam in `game-seams-fx.ts` ~line 522 — check
  its name). Measure the streak: the count of pixels in a 200×200 crop around the head's screen
  position whose colour differs from the blur-off frame by > 8 levels must be > 5% of the crop.
  Save `docs/dev-notes/2026-09-26-censer/swing-blur-on.png` / `-off.png`; LOOK at them: the head and
  chain should smear along the arc, the background must show through the trail, the haft should
  smear less than the head. Check `__sdfGame.gibBlurDiagnostics()` (or equivalent) reports the
  censer pieces selected and no error.
- [ ] **Step 6: Commit** `feat(censer): swing motion blur through the gib shutter layer`.

---

### Task 9: The in-game gate (`scripts/censer-gate.mjs`) and first tuning pass

**Files:**
- Create: `scripts/censer-gate.mjs`
- Create: `docs/dev-notes/2026-09-26-censer/NOTES.md`
- Possibly modify (tuning only): `CENSER_REST` in `game-censer.ts`, `CENSER_HEAD.ropeLen`,
  `CENSER_HIT.severMul` / `heavy.craterR`

- [ ] **Step 1: Write the gate**

```js
// scripts/censer-gate.mjs — the censer flail lands, carves and severs in the game
// (Task 9 of docs/superpowers/plans/2026-09-26-censer-flail.md).
//
// Headless gate on /sdf-game.html (the sandbox rooms; zombies frozen in place).
// The player stands DIST m from a zombie, the weapon parked in the dead zone
// with __sdfGame.censer.setAim, and strokes are driven with press/step/release.
// Asserts:
//   1. a tap from each dead-zone side (high, low, right, left) lands >= 1 new
//      wound on a fresh zombie, and at least one tap GOUGED (>= 2 wounds) with
//      its trail running the stroke's way on screen (dot >= 0.3);
//   2. one full-charge overhead slam to the neck severs the head;
//   3. three taps to an upper arm kill prims on that arm (a sever);
//   4. negative control: a tap with nothing in reach adds no wounds anywhere;
//   5. zero console errors / exceptions.
// Shoots each stroke mid-swing and each result into OUT.
//
// Usage (vite + a WebGPU Chrome already listening, e.g. scripts/lab-servers.sh):
//   node scripts/censer-gate.mjs <vitePort> <cdpPort>
// Env: OUT (docs/dev-notes/2026-09-26-censer), DIST (0.95), ROOM (default: the room with most zombies).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5271);
const CDP = Number(process.argv[3] ?? 9271);
const OUT = process.env.OUT ?? 'docs/dev-notes/2026-09-26-censer';
const DIST = Number(process.env.DIST ?? 0.95);
const EYE = 1.62;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`PASS: ${msg}`);
function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
}

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
});
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 60000,
    `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
mkdirSync(OUT, { recursive: true });
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  console.log(`  shot ${file}`);
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?seed=1&vhs=off` });

let backend = null;
for (let i = 0; i < 240 && !backend; i++) {
  await sleep(500);
  backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
}
if (backend !== 'webgpu') fail(`backend ${backend}, expected webgpu`);
for (let i = 0; i < 240; i++) {
  if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') === 'ready') break;
  await sleep(500);
}
if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') !== 'ready') fail('warm gate never reached ready');
await evaluate('__sdfGame.setLoopRunning(false)');
for (const p of ['woundPanel', 'gooPanel', 'vhsPanel']) {
  await evaluate(`typeof __sdfGame.${p} === "function" ? (__sdfGame.${p}(false), 1) : 0`);
}
await evaluate('__sdfGame.freeze(true)');
await evaluate('__sdfGame.censer.setHitStop(false)');   // frame counts stay deterministic
const sel = await evaluate(`__sdfGame.selectSlot('censer')`);
if (!sel?.ok) fail(`selectSlot('censer') refused: ${JSON.stringify(sel)}`);
await evaluate('__sdfGame.step(30, 1 / 60)');            // the raise

// --- Pick the room with the most zombies; one fresh zombie per case.
const zombies = (await evaluate('__sdfGame.actorList()')).filter((a) => a.kind === 'zombie');
const byRoom = new Map();
for (const z of zombies) byRoom.set(z.room, [...(byRoom.get(z.room) ?? []), z]);
const ROOM = process.env.ROOM ? Number(process.env.ROOM)
  : [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
const pool = byRoom.get(ROOM) ?? [];
if (pool.length < 6) fail(`room ${ROOM} has ${pool.length} zombies; the gate needs 6`);
await evaluate(`__sdfGame.teleport(${ROOM}); __sdfGame.step(2, 1 / 60);`);
const centre = await evaluate('__sdfGame.playerPos()');
console.log(`room ${ROOM}: ${pool.length} zombies; DIST ${DIST}`);
await shot('censer-idle');

async function stage(id, limb, dist) {
  const c = await evaluate(`__sdfGame.actorLimbCentre(${id}, ${JSON.stringify(limb)})`);
  if (!c) fail(`zombie ${id} has no live ${limb}`);
  const dx = centre[0] - c[0], dz = centre[2] - c[2], l = Math.hypot(dx, dz) || 1;
  const x = c[0] + (dx / l) * dist, z = c[2] + (dz / l) * dist;
  const yaw = Math.atan2(c[0] - x, -(c[2] - z));
  const pitch = Math.atan2(c[1] - EYE, dist);
  await evaluate(`__sdfGame.placePlayer({ x: ${x}, z: ${z}, yaw: ${yaw}, pitch: ${pitch} })`);
  await evaluate('__sdfGame.step(20, 1 / 60)');         // the head settles under the new pose
  return { yaw, x, z };
}
const wounds = (id) => evaluate(`__sdfGame.actorWounds(${id})`);
const totalWounds = () => evaluate('__sdfGame.actorList().reduce((n, a) => n + __sdfGame.actorWounds(a.id).length, 0)');
const settle = () => evaluate('__sdfGame.step(40, 1 / 60)');
async function tap([ox, oy], name) {
  await evaluate(`__sdfGame.censer.setAim(${ox}, ${oy}); __sdfGame.censer.press(); __sdfGame.step(3, 1 / 60); __sdfGame.censer.release();`);
  await evaluate('__sdfGame.step(6, 1 / 60)');
  if (name) await shot(name);
}
async function charged([ox, oy], name) {
  await evaluate(`__sdfGame.censer.setAim(${ox}, ${oy}); __sdfGame.censer.press(); __sdfGame.step(90, 1 / 60);`);
  if (name) await shot(`${name}-spin`);
  await evaluate('__sdfGame.censer.release(); __sdfGame.step(8, 1 / 60);');
  if (name) await shot(`${name}-strike`);
}
const state = () => evaluate('__sdfGame.censer.state()');

// --- 1. Taps from the four sides.
const SIDES = [['high', [0, 1], [0, -1]], ['low', [0, -1], [0, 1]], ['right', [1, 0], [-1, 0]], ['left', [-1, 0], [1, 0]]];
let gouged = 0, aligned = 0;
for (let i = 0; i < SIDES.length; i++) {
  const [name, off, travel] = SIDES[i];
  const z = pool[i];
  const { yaw } = await stage(z.id, 'torso', DIST);
  const before = (await wounds(z.id)).length;
  await tap(off, `tap-${name}-mid`);
  await settle();
  const fresh = (await wounds(z.id)).slice(before);
  const st = await state();
  console.log(`tap ${name}: zombie ${z.id} +${fresh.length} wounds; head speed ${st.headSpeed.toFixed(2)}; last hit ${JSON.stringify(st.lastHit)}`);
  await shot(`tap-${name}-wound`);
  if (fresh.length < 1) fail(`tap ${name} landed no wound (DIST ${DIST} — tune CENSER_REST / ropeLen, see NOTES)`);
  if (fresh.length >= 2) {
    gouged++;
    const a = fresh[0].pos, b = fresh[fresh.length - 1].pos;
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const sx = d[0] * Math.cos(yaw) + d[2] * Math.sin(yaw), sy = d[1];
    const m = Math.hypot(sx, sy) || 1;
    const dot = (sx * travel[0] + sy * travel[1]) / m;
    console.log(`  gouge on screen (${(sx / m).toFixed(2)}, ${(sy / m).toFixed(2)}) vs stroke (${travel}) → dot ${dot.toFixed(2)}`);
    if (dot >= 0.3) aligned++;
  }
}
if (gouged === 0) fail('no tap gouged — every hit was a single crater');
if (aligned === 0) fail("no gouge ran the stroke's way");
pass(`taps land from all four sides; ${aligned}/${gouged} gouges run the stroke's way`);

// --- 2. A full-charge overhead slam to the neck.
{
  const z = pool[4];
  await stage(z.id, 'head', DIST);
  await charged([0, 1], 'slam');
  await settle();
  const alive = await evaluate(`__sdfGame.censer.limbAlive(${z.id}, 'head')`);
  console.log(`slam: head prims alive ${alive}; last hit ${JSON.stringify((await state()).lastHit)}`);
  await shot('slam-after');
  if (alive !== 0) fail(`a full-charge slam to the neck left ${alive} head prims alive`);
  pass('a full-charge slam severs the head');
}

// --- 3. Three taps to an upper arm.
{
  const z = pool[5];
  const alive0 = await evaluate(`__sdfGame.censer.limbAlive(${z.id}, 'armR')`);
  await stage(z.id, 'armR', DIST);
  for (let k = 0; k < 3; k++) { await tap([0, 0], k === 2 ? 'arm-third-tap' : null); await settle(); }
  const alive1 = await evaluate(`__sdfGame.censer.limbAlive(${z.id}, 'armR')`);
  console.log(`arm: armR prims alive ${alive0} → ${alive1}`);
  await shot('arm-after');
  if (!(alive1 < alive0)) fail(`three taps to the arm severed nothing (${alive0} → ${alive1})`);
  pass('three taps sever the arm');
}

// --- 4. Negative control: stand where nothing is within 1.8 m, tap.
{
  const all = await evaluate('__sdfGame.actorList()');
  let placed = false;
  for (const z of pool) {
    const s = await stage(z.id, 'torso', 3.0);
    const clear = all.every((a) => Math.hypot(a.pos[0] - s.x, a.pos[2] - s.z) > 1.8);
    if (clear) { placed = true; break; }
  }
  if (!placed) fail('no clear spot 3 m from a zombie for the negative control');
  const before = await totalWounds();
  await tap([0, 0], 'negative-mid');
  await settle();
  const after = await totalWounds();
  if (after !== before) fail(`a tap at nothing added ${after - before} wounds`);
  pass('a tap at nothing adds no wounds');
}

// --- 5. Console.
const errors = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errors.length) fail(`${errors.length} console errors: ${errors.slice(0, 3).map((e) => e.text).join(' | ')}`);
pass('no console errors');
ws.close();
process.exit(0);
```

- [ ] **Step 2: Run it**

Start the lab servers (bash), then run: `node scripts/censer-gate.mjs <vitePort> <cdpPort>`.
Expected on a first run: it may FAIL at a reach or sever check. That is the tuning loop, not a
bug to hide:

- **"landed no wound":** look at `tap-*-mid.png` and the printed head position. Adjust `DIST`
  first (the reach is ~1.6 m from the eye to the head's far edge; the torso surface is ~0.2 m in
  front of the zombie's centre). If the head never reaches forward, raise `CENSER_SWING.strokeReach`
  or `CENSER_HEAD.ropeLen` by 5 cm steps. Record every change.
- **"slam … left N head prims alive":** raise `CENSER_HIT.severMul` in 0.1 steps (≤ 1.6), then
  `CENSER_HIT.heavy.craterR` in 0.01 steps (≤ 0.14). Re-run `npm test -- censer-hit` after each
  change (the tests read the constants, so they follow).
- **"three taps … severed nothing":** the same, with `CENSER_HIT.tap.craterR` (≤ 0.08).

Stop when the gate passes, or after five tuning rounds. If it still fails, stop and report the
numbers — don't loosen the gate.

- [ ] **Step 3: Look at the photos**

Open every PNG the gate wrote. For each, note in NOTES.md what you see: the stroke's direction,
whether the head and chain read against the zombie, whether the crater and gouge read as a blunt
furrow and not as a round shotgun crater. Measure one number per wound close-up: the mean red
channel minus the mean green channel in a 40×40 crop centred on the wound's screen position
(`__sdfGame.worldToScreen`) against the same crop before the hit. A wound that reads should raise
it by > 10.

- [ ] **Step 4: Write the notes**

`docs/dev-notes/2026-09-26-censer/NOTES.md`: the gate command and its PASS/FAIL output, every
tuning change (constant, old → new, why), the per-case wound counts and head speeds, the
red-minus-green numbers, the photo list with one line each, and the open feel questions for the
owner (swing timing, reach, hit-stop length, whether taps should gouge).

- [ ] **Step 5: Commit**

```bash
git add scripts/censer-gate.mjs docs/dev-notes/2026-09-26-censer/ src/lab/sdf-zombie/webgpu/censer-*.ts src/lab/sdf-zombie/webgpu/game-censer.ts
git commit -m "test(censer): in-game gate — four-side taps + gouge direction, charged decap, arm sever, negative control; tuning notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Status board, docs and the owner's playtest

**Files:**
- Modify: `TASKS.md` (the *Censer flail* section)
- Modify: `docs/game/levels/00-the-wake/tasks.md` (W-B4)
- Modify: `docs/superpowers/specs/2026-09-26-censer-flail-design.md` (status line)

- [ ] **Step 1: Update the boards**

In `TASKS.md`, change the censer row to done-pending-playtest, linking this plan, the gate command
and the notes. Keep the separate *severed limbs as physical debris* row open. In the Wake's
`tasks.md`, mark W-B4 `[~]` with *"censer built; owner playtest pending"*. In the spec, set
**Status:** to *"v1 built (plan 2026-09-26-censer-flail); owner playtest pending"*.

- [ ] **Step 2: Hand the feel to the owner**

Don't claim the feel is right. List what only play can judge (timing, reach, hit-stop, the tap
gouge, the four-way direction read) and the console knobs to try, e.g.
`__sdfGame.censer.setHitStop(false)`. Mention that `CENSER_SWING`, `CENSER_HEAD`, `CENSER_HIT` and
`CENSER_FEEL` are the only tuning tables.

- [ ] **Step 3: Commit**

```bash
git add TASKS.md docs/game/levels/00-the-wake/tasks.md docs/superpowers/specs/2026-09-26-censer-flail-design.md
git commit -m "docs: censer flail v1 — status, W-B4, playtest hand-off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Later (not in this plan)

From the spec's §5, in order: embers on charged strikes (`burn` wounds), the censer as a light
(after the dynamic-light work), the spin as a fend zone, **severed limbs as physical debris you can
knock about** (its own TASKS row), a simulated link chain, and world dents. Also: raising
`MAX_WOUNDS` from 16 if gouges evict older wounds too soon in play (a shader constant as well —
`march.glsl.ts` and the WGSL wound rows — so measure with `scripts/sdf-game-melee-bench.sh`), and
recording the censer's input in `DemoFrame` so replays swing it.
