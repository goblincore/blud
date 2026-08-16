# SDF Lab Gore-Feel Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lab gibbing feel like the game's playtested ChunkSystem — many small tumbling chunks with gooey blood trails that topple and lie flat — plus wound-driven limb detachment and a rim-containment fix that stops wounds welding limbs together.

**Architecture:** Pure deterministic modules first (quaternion math in `vec.ts`, a 3D chunk stepper in `gib-chunks.ts`, per-prim splitting in `sever.ts`, droplet physics in `blood-sim.ts`, connectivity in `connectivity.ts`), then the two renderer paths consume them through thin views. Blood tuning constants are imported from the game's `src/game/gibs/tuning.ts` — never copied. Shader changes land in BOTH `march.wgsl.ts` and `march.glsl.ts`.

**Tech Stack:** TypeScript, vitest, three (WebGL lab) / three/webgpu (WebGPU lab — NEVER import plain `three` in `src/lab/sdf-zombie/webgpu/**`, it double-bundles three and breaks every material).

**Spec:** `docs/superpowers/specs/2026-08-16-sdf-lab-gore-feel-design.md`

**Ground rules for every task:**
- Worktree has no `node_modules` — run `ln -sfn /Users/donny/Projects/blud/node_modules node_modules` once if missing.
- `npx tsc --noEmit` must pass before every commit (repo has `noUncheckedIndexedAccess: true` — index access needs `!` or guards).
- Run the full suite `npm test` before each commit; it must stay green (854+ tests).
- WGSL bodies must avoid reserved identifiers (`meta, type, filter, set, sample, pass, target, template, new, null, use, where, while, write` — the lint test in `march.wgsl.test.ts` enforces this).

---

### Task 1: Quaternion helpers in vec.ts

**Files:**
- Modify: `src/lab/sdf-zombie/vec.ts`
- Test: `src/lab/sdf-zombie/vec.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `src/lab/sdf-zombie/vec.test.ts`:

```ts
import {
  qIdentity, qFromAxisAngle, qMul, qNormalize, qRotate, type Quat,
} from './vec';

describe('quaternions', () => {
  it('identity rotates nothing', () => {
    expect(qRotate(qIdentity(), [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('rotates 90 degrees about y', () => {
    const q = qFromAxisAngle([0, 1, 0], Math.PI / 2);
    const v = qRotate(q, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 6);
    expect(v[1]).toBeCloseTo(0, 6);
    expect(v[2]).toBeCloseTo(-1, 6);
  });

  it('composes: qMul(a, b) applies b then a', () => {
    const a = qFromAxisAngle([0, 1, 0], Math.PI / 2);
    const b = qFromAxisAngle([1, 0, 0], Math.PI / 2);
    const v = qRotate(qMul(a, b), [0, 1, 0]);
    const expected = qRotate(a, qRotate(b, [0, 1, 0]));
    expect(v[0]).toBeCloseTo(expected[0], 6);
    expect(v[1]).toBeCloseTo(expected[1], 6);
    expect(v[2]).toBeCloseTo(expected[2], 6);
  });

  it('normalize returns a unit quaternion', () => {
    const q = qNormalize([1, 2, 3, 4]);
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    expect(n).toBeCloseTo(1, 6);
  });

  it('rotation preserves length', () => {
    const q = qFromAxisAngle([0.3, 0.8, -0.5], 1.234);
    const v = qRotate(q, [2, -1, 0.5]);
    expect(Math.hypot(...v)).toBeCloseTo(Math.hypot(2, -1, 0.5), 6);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lab/sdf-zombie/vec.test.ts` — expect FAIL (no export `qIdentity`).

- [ ] **Step 3: Implement** — append to `src/lab/sdf-zombie/vec.ts`:

```ts
/** Unit quaternion as [x, y, z, w]. */
export type Quat = [number, number, number, number];

export const qIdentity = (): Quat => [0, 0, 0, 1];

export function qFromAxisAngle(axis: Vec3, angle: number): Quat {
  const a = normalize(axis);
  const h = angle / 2;
  const s = Math.sin(h);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)];
}

/** Hamilton product — qMul(a, b) rotates by b FIRST, then a. */
export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotate v by unit quaternion q: v + 2w(u×v) + 2(u×(u×v)). */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(v, add(scale(t, q[3]), cross(u, t)));
}
```

- [ ] **Step 4: Verify pass** — `npx vitest run src/lab/sdf-zombie/vec.test.ts` — expect PASS.
- [ ] **Step 5: Commit** — `git add src/lab/sdf-zombie/vec.ts src/lab/sdf-zombie/vec.test.ts && git commit -m "feat(sdf-lab): quaternion helpers in vec.ts"`

---

### Task 2: 3D chunk stepper — tumble, game bounce, topple

**Files:**
- Rewrite: `src/lab/sdf-zombie/gib-chunks.ts`
- Rewrite test: `src/lab/sdf-zombie/gib-chunks.test.ts`

The old `Chunk` had yaw-only `{ spin, angle }` — that is WHY landed limbs stand
upright (no yaw can tip a vertical limb). The new state carries a quaternion +
3-axis angular velocity, plus the chunk's local long axis so a grounded chunk
can be eased flat ("topple").

- [ ] **Step 1: Write the failing tests** — REPLACE `src/lab/sdf-zombie/gib-chunks.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import {
  makeChunk, stepChunk, chunkPoint, squashFactors, type Chunk,
} from './gib-chunks';
import { qRotate, qFromAxisAngle } from './vec';
import type { Vec3 } from './types';

const rng = () => 0.5; // deterministic spawn

function settle(c: Chunk, seconds: number): Chunk {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) c = stepChunk(c, dt);
  return c;
}

describe('makeChunk', () => {
  it('spawns with a unit quaternion and bounded tumble', () => {
    const c = makeChunk('armL', [0, 1, 0], [2, 3, 1], 0.2, [0, 1, 0], rng);
    expect(Math.hypot(...c.quat)).toBeCloseTo(1, 6);
    for (const w of c.angVel) expect(Math.abs(w)).toBeLessThanOrEqual(9);
  });
});

describe('stepChunk', () => {
  it('integrates orientation from angular velocity', () => {
    const c = makeChunk('armL', [0, 5, 0], [0, 0, 0], 0.2, [0, 1, 0], rng);
    const c2 = { ...c, angVel: [0, Math.PI, 0] as Vec3 };
    const after = stepChunk(c2, 0.5); // half a half-turn about y
    const v = qRotate(after.quat, [1, 0, 0]);
    // Rotated ~90deg from where quat started; just assert it moved substantially.
    const before = qRotate(c2.quat, [1, 0, 0]);
    expect(Math.abs(v[0] - before[0]) + Math.abs(v[2] - before[2])).toBeGreaterThan(0.5);
  });

  it('bounces with the game restitution', () => {
    let c = makeChunk('armL', [0, 0.5, 0], [0, -4, 0], 0.2, [0, 1, 0], rng);
    // Drop until first bounce.
    let bounced: Chunk | null = null;
    for (let i = 0; i < 300; i++) {
      const next = stepChunk(c, 1 / 60);
      if (next.vel[1] > 0 && c.vel[1] < 0) { bounced = next; break; }
      c = next;
    }
    expect(bounced).not.toBeNull();
    // restitution 0.55 of impact speed, within integration slop
    expect(bounced!.vel[1]).toBeGreaterThan(0.3);
  });

  it('topples: a vertical limb ends lying flat', () => {
    // Long axis local y, spawned upright, at rest on the floor.
    let c = makeChunk('legL', [0, 0.2, 0], [0, 0, 0], 0.2, [0, 1, 0], rng);
    c = { ...c, angVel: [0, 0, 0] as Vec3 };
    c = settle(c, 3);
    const worldLong = qRotate(c.quat, c.longAxis);
    // Lying flat = long axis within ~15deg of horizontal.
    expect(Math.abs(worldLong[1])).toBeLessThan(0.26);
  });

  it('does not topple while still flying', () => {
    let c = makeChunk('legL', [0, 8, 0], [0, 4, 0], 0.2, [0, 1, 0], rng);
    c = { ...c, angVel: [0, 0, 0] as Vec3 };
    const after = stepChunk(c, 1 / 60);
    const before = qRotate(c.quat, c.longAxis);
    const now = qRotate(after.quat, c.longAxis);
    expect(now[1]).toBeCloseTo(before[1], 5);
  });

  it('recovers from non-finite state', () => {
    const c = makeChunk('armL', [0, 1, 0], [NaN, 0, 0], 0.2, [0, 1, 0], rng);
    const after = stepChunk(c, 1 / 60);
    expect(after.vel.every(Number.isFinite)).toBe(true);
  });
});

describe('chunkPoint / squashFactors', () => {
  it('rotates locals by the chunk quat then squashes in world axes', () => {
    const base = makeChunk('armL', [1, 2, 3], [0, 0, 0], 0.2, [0, 1, 0], rng);
    const c: Chunk = { ...base, quat: qFromAxisAngle([0, 1, 0], Math.PI / 2), squash: 0 };
    const { sx, sy, sz } = squashFactors(c);
    expect([sx, sy, sz]).toEqual([1, 1, 1]);
    const p = chunkPoint(c, [1, 0, 0], sx, sy, sz);
    expect(p[0]).toBeCloseTo(1, 5);
    expect(p[1]).toBeCloseTo(2, 5);
    expect(p[2]).toBeCloseTo(3 - 1, 5);
  });

  it('squash flattens y and bulges xz', () => {
    const base = makeChunk('armL', [0, 0, 0], [0, 0, 0], 0.2, [0, 1, 0], rng);
    const c: Chunk = { ...base, squash: 1 };
    const { sx, sy, sz } = squashFactors(c);
    expect(sx).toBeCloseTo(1.35, 5);
    expect(sy).toBeCloseTo(0.5, 5);
    expect(sz).toBeCloseTo(1.35, 5);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lab/sdf-zombie/gib-chunks.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** — REPLACE `src/lab/sdf-zombie/gib-chunks.ts` with:

```ts
// src/lab/sdf-zombie/gib-chunks.ts
//
// Hand-rolled deterministic chunk physics. Deliberately NOT Rapier: the game's
// cosmetic ChunkSystem uses Rapier, but the lab wants a stepper whose every
// constant is a knob and whose output is pure state-in/state-out. The game's
// playtested Rapier values are the tuning TARGETS here (restitution 0.55,
// tumble +/-9 rad/s per axis), not a dependency.
import type { LimbId, Vec3 } from './types';
import {
  add, cross, dot, len, normalize, scale,
  qFromAxisAngle, qIdentity, qMul, qNormalize, qRotate, type Quat,
} from './vec';

const GRAVITY = -9.8;
/** Game ChunkSystem capsule restitution (chunks skip off floors). */
const RESTITUTION = 0.55;
/** Horizontal + angular velocity multiplier while in floor contact. */
const FLOOR_FRICTION = 0.72;
const AIR_DRAG = 0.006;
/** Squash decays back to zero at this rate per second. */
const SQUASH_RELAX = 5.5;
/** Spawn tumble amplitude: (rng-0.5)*2*TUMBLE = +/-9 rad/s, the game's angvel. */
const TUMBLE = 9;
/** Below this speed a grounded chunk starts easing flat. */
const TOPPLE_SPEED = 0.6;
/** Radians/sec the long axis eases toward horizontal (~90deg in 0.4s). */
const TOPPLE_RATE = 4.0;

export interface Chunk {
  limb: LimbId;
  pos: Vec3;
  vel: Vec3;
  radius: number;
  /** 0 = round, 1 = fully flattened. Drives non-uniform scale in the shader. */
  squash: number;
  /** Orientation, unit quaternion [x,y,z,w]. */
  quat: Quat;
  /** Angular velocity, rad/s about each world axis. */
  angVel: Vec3;
  /** Chunk-LOCAL long axis (unit). The topple aligns this with the floor. */
  longAxis: Vec3;
}

export function makeChunk(
  limb: LimbId, pos: Vec3, vel: Vec3, radius: number,
  longAxis: Vec3, rng: () => number = Math.random,
): Chunk {
  // Tumble proportional-ish to being launched at all; flat amplitude matches
  // the game ChunkSystem's setAngvel((rand-0.5)*18) = +/-9 rad/s.
  const angVel: Vec3 = [
    (rng() - 0.5) * 2 * TUMBLE,
    (rng() - 0.5) * 2 * TUMBLE,
    (rng() - 0.5) * 2 * TUMBLE,
  ];
  return {
    limb, pos, vel, radius, squash: 0,
    quat: qIdentity(), angVel, longAxis: normalize(longAxis),
  };
}

export function stepChunk(c: Chunk, dt: number): Chunk {
  let [x, y, z] = c.pos;
  let [vx, vy, vz] = c.vel;
  let { squash } = c;
  let quat = c.quat;
  let angVel = c.angVel;

  vy += GRAVITY * dt;
  const drag = 1 - AIR_DRAG;
  vx *= drag; vy *= drag; vz *= drag;

  x += vx * dt; y += vy * dt; z += vz * dt;

  // Integrate orientation from angular velocity.
  const w = len(angVel);
  if (w > 1e-6) {
    quat = qNormalize(qMul(qFromAxisAngle(scale(angVel, 1 / w), w * dt), quat));
  }

  let grounded = false;
  if (y < c.radius) {
    y = c.radius;
    grounded = true;
    if (vy < 0) {
      // Squash scales with impact speed — this is what sells wetness.
      squash = Math.min(1, squash + Math.min(Math.abs(vy) * 0.16, 0.9));
      vy = -vy * RESTITUTION;
      if (Math.abs(vy) < 0.35) vy = 0;
    }
    vx *= FLOOR_FRICTION; vz *= FLOOR_FRICTION;
    angVel = scale(angVel, FLOOR_FRICTION);
    if (len(angVel) < 0.05) angVel = [0, 0, 0];
  }

  // Topple: a grounded, slow chunk eases its long axis toward horizontal, so
  // limbs lie flat instead of standing on end. Handcrafted substitute for a
  // collision mesh; deterministic and tunable.
  const speed = Math.hypot(vx, vy, vz);
  if (grounded && speed < TOPPLE_SPEED) {
    const worldLong = qRotate(quat, c.longAxis);
    const horizLen = Math.hypot(worldLong[0], worldLong[2]);
    // A perfectly vertical axis has no horizontal shadow to fall toward — give
    // it a nudge direction deterministically from the quat's x component sign.
    const target: Vec3 = horizLen < 1e-3
      ? [quat[0] >= 0 ? 1 : -1, 0, 0]
      : normalize([worldLong[0], 0, worldLong[2]]);
    const cosA = Math.min(1, Math.max(-1, dot(worldLong, target)));
    const angle = Math.acos(cosA);
    if (angle > 0.01) {
      const rawAxis = cross(worldLong, target);
      const axis = len(rawAxis) < 1e-6 ? ([0, 0, 1] as Vec3) : normalize(rawAxis);
      const step = Math.min(angle, TOPPLE_RATE * dt);
      quat = qNormalize(qMul(qFromAxisAngle(axis, step), quat));
    }
  }

  squash = Math.max(0, squash - SQUASH_RELAX * dt);

  const out: Chunk = { ...c, pos: [x, y, z], vel: [vx, vy, vz], squash, quat, angVel };
  return finite(out) ? out : {
    ...c, vel: [0, 0, 0], angVel: [0, 0, 0], squash: 0,
  };
}

/** Squash factors: flatten y, bulge xz — applied in WORLD axes after rotation. */
export function squashFactors(c: Chunk): { sx: number; sy: number; sz: number } {
  const s = Math.min(1, Math.max(0, c.squash));
  return { sx: 1 + s * 0.35, sy: 1 - s * 0.5, sz: 1 + s * 0.35 };
}

/**
 * World position of a chunk-local point: rotate by the chunk quat, squash in
 * world axes, translate to the chunk. THE one transform both renderer paths'
 * apply() must use — hand-rolling it twice is how the paths drift.
 */
export function chunkPoint(
  c: Chunk, local: Vec3, sx: number, sy: number, sz: number,
): Vec3 {
  const r = qRotate(c.quat, local);
  return [c.pos[0] + r[0] * sx, c.pos[1] + r[1] * sy, c.pos[2] + r[2] * sz];
}

function finite(c: Chunk): boolean {
  return [...c.pos, ...c.vel, ...c.angVel, ...c.quat, c.squash]
    .every(n => Number.isFinite(n) && Math.abs(n) < 1e6);
}
```

- [ ] **Step 4: Run the module tests** — `npx vitest run src/lab/sdf-zombie/gib-chunks.test.ts` — expect PASS. The two lab-mains and chunk views will NOT compile yet (old `angle`/`spin` fields) — that is Task 5/9 work; `npx tsc --noEmit` failures in those files are expected until Task 5 and Task 9 land. Do NOT commit tsc-broken code: Task 2, 5 and 9 land as one commit chain in the same working tree, so commit here ONLY `gib-chunks.ts` + its test with `--no-verify` if a hook runs tsc, or simply proceed to Task 5 and commit together if the repo hooks block. Preferred: proceed, and make the Task 5 commit include this file.
- [ ] **Step 5: Commit (may be folded into Task 5's commit if tsc gates)** — `git add src/lab/sdf-zombie/gib-chunks.ts src/lab/sdf-zombie/gib-chunks.test.ts && git commit -m "feat(sdf-lab): 3D chunk stepper — quaternion tumble, game bounce, topple"`

---

### Task 3: Per-prim gib splitting in sever.ts

**Files:**
- Modify: `src/lab/sdf-zombie/sever.ts`
- Test: `src/lab/sdf-zombie/sever.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `src/lab/sdf-zombie/sever.test.ts` (the file already imports `buildBody`, `ZOMBIE`):

```ts
import { gibAllPieces } from './sever';

describe('gibAllPieces', () => {
  const body2 = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const torso = body2.clusters.find(c => c.limb === 'torso')!;

  it('splits every non-head cluster into one piece per add-prim', () => {
    const { chunks } = gibAllPieces(body2, torso.center);
    for (const cl of body2.clusters) {
      const pieces = chunks.filter(g => g.limb === cl.limb);
      const addPrims = body2.prims
        .slice(cl.start, cl.start + cl.count)
        .filter(p => p.op !== 'sub');
      if (cl.limb === 'head') {
        expect(pieces).toHaveLength(1); // head stays whole (face carves)
      } else {
        expect(pieces).toHaveLength(addPrims.length);
        for (const piece of pieces) expect(piece.prims).toHaveLength(1);
      }
    }
  });

  it('pieces exactly partition each split cluster (no prim lost or doubled)', () => {
    const { chunks } = gibAllPieces(body2, torso.center);
    const armPrims = body2.prims.filter(p => p.limb === 'armL' && p.op !== 'sub');
    const pieces = chunks.filter(g => g.limb === 'armL').flatMap(g => g.prims);
    expect(pieces).toHaveLength(armPrims.length);
    for (const p of armPrims) expect(pieces).toContain(p);
  });

  it('marks every cluster dead, like gibAll', () => {
    const { body: after } = gibAllPieces(body2, torso.center);
    expect(after.clusters.every(c => !c.alive)).toBe(true);
  });

  it('gives every piece at least one torn point, at joints or the attach end', () => {
    const { chunks } = gibAllPieces(body2, torso.center);
    for (const g of chunks) {
      expect(g.tornAt.length).toBeGreaterThanOrEqual(1);
      expect(g.tornAt.length).toBeLessThanOrEqual(2);
    }
  });

  it('piece origins sit at their prim midpoints', () => {
    const { chunks } = gibAllPieces(body2, torso.center);
    const piece = chunks.find(g => g.limb === 'legR')!;
    const p = piece.prims[0]!;
    expect(piece.origin[0]).toBeCloseTo((p.a[0] + p.b[0]) / 2, 6);
    expect(piece.origin[1]).toBeCloseTo((p.a[1] + p.b[1]) / 2, 6);
  });
});
```

- [ ] **Step 2: Verify failure** — `npx vitest run src/lab/sdf-zombie/sever.test.ts` — expect FAIL (no `gibAllPieces`).

- [ ] **Step 3: Implement** — in `src/lab/sdf-zombie/sever.ts`, first extend `ChunkGroup`:

```ts
export interface ChunkGroup {
  limb: LimbId;
  prims: Primitive[];
  /** World-space centre at the moment of detachment. */
  origin: Vec3;
  /** World points where this piece tore away (joints/attachment) — torn-end wounds. */
  tornAt: Vec3[];
}
```

Then fix the two existing constructors of `ChunkGroup` to satisfy the new field:
in `severLimb`, the empty-return becomes `chunk: { limb, prims: [], origin: [0, 0, 0], tornAt: [] }`,
and the real return's chunk gains `tornAt: []` (the caller computes the single
sever torn point via `attachPoint` today and passes it separately — leave that
flow alone; Task 5 accepts both). In `gibAll`, each pushed group gains `tornAt: []`.

Append the splitter:

```ts
/** Two endpoints closer than this are the same joint (limb chains touch). */
const JOINT_EPS = 0.06;

/**
 * Blows the body apart into PER-PRIMITIVE pieces — "lots of small chunks".
 *
 * Non-head clusters emit one piece per additive prim; the head stays whole
 * because its face carves and skull sphere don't survive splitting (and the
 * intact bouncing head is a Blood signature). Same alive-flag mechanism as
 * gibAll: nothing is removed or reordered, so the fold-order invariant holds.
 *
 * Each piece's tornAt lists the world points where it tore away: every
 * endpoint it shared with a neighbouring prim of the same cluster (the joint
 * chain), or — for the piece nearest the torso — its attachment end.
 */
export function gibAllPieces(
  body: BuildResult, torsoCentre: Vec3,
): { body: BuildResult; chunks: ChunkGroup[] } {
  const chunks: ChunkGroup[] = [];
  for (const c of body.clusters) {
    if (!c.alive) continue;
    const prims = body.prims.slice(c.start, c.start + c.count);
    if (c.limb === 'head') {
      // Whole head; torn at its closest endpoint to the torso (the neck).
      let neck: Vec3 = prims[0]!.a;
      let best = Infinity;
      for (const p of prims) {
        if (p.op === 'sub') continue;
        for (const e of [p.a, p.b]) {
          const d = len(sub(e, torsoCentre));
          if (d < best) { best = d; neck = e; }
        }
      }
      chunks.push({ limb: c.limb, prims, origin: c.center, tornAt: [neck] });
      continue;
    }
    const adds = prims.filter(p => p.op !== 'sub');
    for (const p of adds) {
      const tornAt: Vec3[] = [];
      for (const e of [p.a, p.b]) {
        const isJoint = adds.some(q => q !== p &&
          (len(sub(q.a, e)) < JOINT_EPS || len(sub(q.b, e)) < JOINT_EPS));
        if (isJoint) tornAt.push(e);
      }
      if (tornAt.length === 0) {
        // A single-prim cluster (or an isolated prim): torn where it met the body.
        tornAt.push(len(sub(p.a, torsoCentre)) < len(sub(p.b, torsoCentre)) ? p.a : p.b);
      }
      const origin: Vec3 = [
        (p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2,
      ];
      chunks.push({ limb: c.limb, prims: [p], origin, tornAt: tornAt.slice(0, 2) });
    }
  }
  return {
    body: { ...body, clusters: body.clusters.map(c => ({ ...c, alive: false })) },
    chunks,
  };
}
```

- [ ] **Step 4: Verify** — `npx vitest run src/lab/sdf-zombie/sever.test.ts` — expect PASS. `npx tsc --noEmit` — the `chunk.tornAt` additions must not break `lab-main` callers (they read `.prims`/`.origin` only — verify with `grep -n "\.tornAt" src/lab/sdf-zombie/lab-main.ts src/lab/sdf-zombie/webgpu/lab-main.ts`).
- [ ] **Step 5: Commit** — `git add src/lab/sdf-zombie/sever.ts src/lab/sdf-zombie/sever.test.ts && git commit -m "feat(sdf-lab): per-prim gib splitting with joint torn-points"`

---

### Task 4: Rim containment — stop wounds welding limbs together

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (APPLY_WOUNDS)
- Modify: `src/lab/sdf-zombie/march.glsl.ts` (the same rim lines)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` (append)

The everted rim `d = d - exp(-x*x) * depth * splay` subtracts (adds material)
ANYWHERE in its spherical shell — including the empty space between an arm and
the torso, which welds them together at default settings. Displacement of
amplitude A can only legitimately move flesh whose pre-wound field value is
within ~A of the surface, so gate the term on `dIn`.

- [ ] **Step 1: Write the failing tripwire test** — append inside the `describe('ported features reach the entry point')` block of `march.wgsl.test.ts`:

```ts
  it('gates the everted rim on surface locality (no limb welding)', () => {
    const applyWounds = HELPERS.find(h => declaredName(h) === 'applyWounds')!;
    expect(applyWounds).toContain('rimLocal');
    expect(applyWounds).toMatch(/smoothstep\([^)]*dIn\)/);
  });
```

- [ ] **Step 2: Verify failure** — `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` — expect 1 FAIL.

- [ ] **Step 3: Edit the WGSL** — in `march.wgsl.ts` `APPLY_WOUNDS`, replace:

```wgsl
    let x = (r - depth * woundCfg.w) / max(depth * woundCfg2.x, 1e-4);
    d = d - exp(-x * x) * depth * woundCfg.z * select(1.0, 0.25, isBurn);
```

with:

```wgsl
    let x = (r - depth * woundCfg.w) / max(depth * woundCfg2.x, 1e-4);
    let amp = depth * woundCfg.z * select(1.0, 0.25, isBurn);
    // Surface locality: a bulge of amplitude amp can only displace flesh that
    // was already within ~amp of the pre-wound surface. Ungated, the shell
    // adds material in EMPTY space and welds separate limbs together.
    let rimLocal = 1.0 - smoothstep(amp * 0.5, amp * 1.2, dIn);
    d = d - exp(-x * x) * amp * rimLocal;
```

- [ ] **Step 4: Edit the GLSL** — in `march.glsl.ts`, find the rim lines inside its wound loop (same structure: `float x = (r - depth * uWoundRimOffset) / max(depth * uWoundRimWidth, 1e-4);` followed by the `d -= exp(-x*x) * depth * uWoundRimSplay * ...` line — exact uniform names may differ; locate with `grep -n "exp(-x \* x)" src/lab/sdf-zombie/march.glsl.ts`) and apply the identical gating: compute `float amp = <existing amplitude expression>;`, `float rimLocal = 1.0 - smoothstep(amp * 0.5, amp * 1.2, dIn);` (the GLSL's pre-wound field parameter — check the function signature; if the parameter is named differently, e.g. `d0`, use that name), multiply the subtraction by `rimLocal`.
- [ ] **Step 5: Verify** — `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` PASS; `npm test` all green; `npx tsc --noEmit` clean.
- [ ] **Step 6: Visual check (if a browser is available; otherwise defer to Task 10)** — dev server, `/sdf-lab-webgpu.html`, `__sdfLab.stampWounds(6)`: the shoulder/torso must not balloon into one mass; wound lips still read.
- [ ] **Step 7: Commit** — `git add -A src/lab/sdf-zombie && git commit -m "fix(sdf-lab): everted rim gated on surface locality — no more limb welding"`

---

### Task 5: Chunk views — quat transform + multi-torn ends (both paths)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (`createChunkGpuView`)
- Modify: `src/lab/sdf-zombie/zombie.ts` (`createChunkView`)
- Modify (compile-fix only): both `lab-main.ts` call sites (full rewiring is Task 9)

Both views' `apply()` currently hand-roll yaw-only rotation (`cos/sin` on xz)
and take a single `tornAt?: Vec3`. They move to the shared `chunkPoint` /
`squashFactors` helpers and `tornAt?: Vec3[]`.

- [ ] **Step 1: WebGPU view** — in `createChunkGpuView`:
  - Signature: `tornAt?: Vec3` → `tornAt?: Vec3[]`.
  - Imports: add `chunkPoint, squashFactors` to the existing `from '../gib-chunks'` import.
  - Replace `const tornLocal: Vec3 | null = tornAt ? vsub(tornAt, chunk.pos) : null;` with:

```ts
  const tornLocals: Vec3[] = (tornAt ?? []).map(t => vsub(t, chunk.pos));
```

  - Replace `const tornRadius = tornLocal ? tornEndRadius(local, tornLocal) : 0;` with:

```ts
  const tornRadii = tornLocals.map(t => tornEndRadius(local, t));
```

  - Replace the whole body of `apply(c)` with:

```ts
  function apply(c: Chunk): { sx: number; sy: number; sz: number } {
    const { sx, sy, sz } = squashFactors(c);
    local.forEach((p, i) => {
      const o = i * PRIM_STRIDE;
      packed.primA.set(chunkPoint(c, p.a, sx, sy, sz), o);
      packed.primB.set(chunkPoint(c, p.b, sx, sy, sz), o);
      // Squash multiplies the world-axis ellipsoid scale. Approximation: the
      // authored per-axis scale does not rotate with the chunk (the yaw-only
      // version had the same limitation) — limb prims are near-uniform so this
      // never shows.
      packed.primScale.set([p.scale[0] * sx, p.scale[1] * sy, p.scale[2] * sz,
        p.op === 'sub' ? 1 : 0], o);
    });
    packed.clusterBounds.set([c.pos[0], c.pos[1], c.pos[2], extent * Math.max(sx, sy, sz)], 0);

    writeRow(ROW_PRIM_A, packed.primA, MAX_PRIMS);
    writeRow(ROW_PRIM_B, packed.primB, MAX_PRIMS);
    writeRow(ROW_PRIM_SCALE, packed.primScale, MAX_PRIMS);
    writeRow(ROW_CLUSTER_BOUNDS, packed.clusterBounds, 1);

    if (tornLocals.length > 0) {
      // Torn ends ride the same rotate-then-squash transform as the prims, so
      // they stay welded to the stumps as the piece tumbles.
      const ats = tornLocals.map(t => chunkPoint(c, t, sx, sy, sz));
      u.woundCfg.value.x = writeWounds(
        texels, ats, tornRadii, ats.map(() => 1), ats.map(() => 0));
    } else {
      u.woundCfg.value.x = 0;
    }

    if (u.faceCfg.value.x > 0.5) u.headCentre.value.set(c.pos[0], c.pos[1], c.pos[2]);

    dataTex.needsUpdate = true;
    return { sx, sy, sz };
  }
```

  - After `const firstApply = apply(chunk);`: DELETE `mesh.rotation.y = chunk.angle;` and in `update()` DELETE `mesh.rotation.y = c.angle;`. The proxy box stays axis-aligned — its size (`extent * 2 * 1.4 + ...`) already covers every orientation of the rotated field, and rotating the box while squash acts in world axes would under-cover.

- [ ] **Step 2: WebGL view** — mirror the same changes in `zombie.ts` `createChunkView`: `tornAt?: Vec3[]`, `tornLocals`/`tornRadii` (there `tornRadius = extent * 0.55` was already replaced by `tornEndRadius` — now the list form), apply() rewritten on `chunkPoint`/`squashFactors` writing `material.uniforms.uWound!.value` / `uWoundMeta!.value` Float32Arrays: slot i gets `w.set([at[0], at[1], at[2], tornRadii[i]!], i * 4)` and `m.set([1, 0, 0, 0], i * 4)`, `material.uniforms.uWoundCount!.value = tornLocals.length;`. Delete the mesh yaw rotation lines.
- [ ] **Step 3: Compile-fix the two lab-mains minimally** (full wiring is Task 9): every `createChunk*View(state, prims, u, tornAtVec)` call site wraps the arg: `tornAtVec ? [tornAtVec] : undefined` → pass as `Vec3[]`; every `makeChunk(limb, origin, v, radius)` gains a `longAxis` argument — compute the piece's long axis from its prims:

```ts
  function primsLongAxis(prims: typeof current.prims, origin: Vec3): Vec3 {
    // Longest chord among endpoints, in chunk-local space.
    let best: Vec3 = [0, 1, 0]; let bestLen = 0;
    for (const p of prims) {
      if (p.op === 'sub') continue;
      const d: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
      const l = Math.hypot(...d);
      if (l > bestLen) { bestLen = l; best = d; }
    }
    return bestLen < 1e-6 ? [0, 1, 0] : [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen];
  }
```

  (add this helper to BOTH lab-mains near `attachPoint`), and the spawn call becomes `makeChunk(limb, origin, v, chunkExtent(prims, origin), primsLongAxis(prims, origin))`.
- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean; `npm test` green.
- [ ] **Step 5: Manual sanity (browser if available)** — sever an arm in `/sdf-lab-webgpu.html` (key 3): the chunk tumbles in 3D and ends LYING FLAT; torn end stays welded through the tumble.
- [ ] **Step 6: Commit** — `git add -A src/lab/sdf-zombie && git commit -m "feat(sdf-lab): chunk views on the shared quat transform, multi-torn ends"` (fold in Task 2's files if they were held back).

---

### Task 6: blood-sim.ts — pure droplet/trail/splat simulation

**Files:**
- Create: `src/lab/sdf-zombie/blood-sim.ts`
- Test: `src/lab/sdf-zombie/blood-sim.test.ts`

Pure data + seeded RNG; NO three import. Constants come from the game —
`import { BLOOD_TRAIL, GIB_BURST, BLOOD_SPLAT } from '../../game/gibs/tuning';`
(pure data module; this import is the lab/game convergence the spec wants —
do NOT copy the numbers).

- [ ] **Step 1: Write the failing tests** — create `src/lab/sdf-zombie/blood-sim.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createBloodSim, burst, emitTrails, stepBlood } from './blood-sim';
import { BLOOD_TRAIL, GIB_BURST } from '../../game/gibs/tuning';

function seeded(seed = 1): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

describe('blood-sim', () => {
  it('burst spawns GIB_BURST.count droplets inside the game speed band', () => {
    const sim = createBloodSim();
    burst(sim, [0, 1, 0], seeded());
    expect(sim.droplets).toHaveLength(GIB_BURST.count);
    for (const d of sim.droplets) {
      const speed = Math.hypot(...d.vel);
      expect(speed).toBeGreaterThanOrEqual(GIB_BURST.speedMin * 0.9);
      expect(speed).toBeLessThanOrEqual(GIB_BURST.speedMax * 1.8); // + up-bias
      expect(d.life).toBeCloseTo(GIB_BURST.lifetimeSec, 5);
    }
  });

  it('trails emit at BLOOD_TRAIL.emitHz per source with 1/256 vel inheritance', () => {
    const sim = createBloodSim();
    const src = [{ id: 1, pos: [0, 2, 0] as [number, number, number], vel: [256, 0, 0] as [number, number, number] }];
    emitTrails(sim, src, 1.0, seeded()); // one full second
    expect(sim.droplets.length).toBe(Math.floor(BLOOD_TRAIL.emitHz));
    expect(sim.droplets[0]!.vel[0]).toBeCloseTo(256 * BLOOD_TRAIL.velScale, 3);
  });

  it('droplets fall, die on the floor, and stamp splats', () => {
    const sim = createBloodSim();
    burst(sim, [0, 0.5, 0], seeded());
    for (let i = 0; i < 600; i++) stepBlood(sim, 1 / 60, seeded(7));
    expect(sim.droplets).toHaveLength(0);
    expect(sim.splats.length).toBeGreaterThanOrEqual(GIB_BURST.count);
  });

  it('is deterministic under a fixed seed', () => {
    const a = createBloodSim(); const b = createBloodSim();
    burst(a, [0, 1, 0], seeded(42)); burst(b, [0, 1, 0], seeded(42));
    for (let i = 0; i < 60; i++) { stepBlood(a, 1 / 60, seeded(5)); stepBlood(b, 1 / 60, seeded(5)); }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('caps droplets and splats FIFO', () => {
    const sim = createBloodSim();
    for (let i = 0; i < 100; i++) burst(sim, [0, 1, 0], seeded(i + 1));
    expect(sim.droplets.length).toBeLessThanOrEqual(600);
    for (let i = 0; i < 2000; i++) stepBlood(sim, 1 / 60, seeded(9));
    expect(sim.splats.length).toBeLessThanOrEqual(256);
  });
});
```

- [ ] **Step 2: Verify failure** — `npx vitest run src/lab/sdf-zombie/blood-sim.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/lab/sdf-zombie/blood-sim.ts`:

```ts
// src/lab/sdf-zombie/blood-sim.ts
//
// Pure droplet simulation for the lab's gib blood: FX_13-style burst at the
// gib instant, FX_27-style trails behind flying chunks, splat stamps on
// settle. All tuning comes from the GAME's playtested constants — imported,
// never copied, so the lab and game cannot drift (X1 follow-up: converge the
// lab on Blud's own gib logic). No three import: renderer views live per path.
import type { Vec3 } from './types';
import { BLOOD_TRAIL, GIB_BURST, BLOOD_SPLAT } from '../../game/gibs/tuning';

const MAX_DROPLETS = 600;
const MAX_SPLATS = 256;

export interface Droplet {
  pos: Vec3;
  vel: Vec3;
  age: number;
  life: number;
  size: number;
}

export interface Splat { pos: Vec3; size: number; yaw: number }

export interface BloodSim {
  droplets: Droplet[];
  splats: Splat[];
  /** Per-source emission clocks, keyed by chunk id. */
  clocks: Record<number, number>;
}

export function createBloodSim(): BloodSim {
  return { droplets: [], splats: [], clocks: {} };
}

function push(sim: BloodSim, d: Droplet): void {
  sim.droplets.push(d);
  while (sim.droplets.length > MAX_DROPLETS) sim.droplets.shift();
}

/** FX_13-style radial spray at a gib/sever instant. */
export function burst(sim: BloodSim, origin: Vec3, rng: () => number): void {
  for (let i = 0; i < GIB_BURST.count; i++) {
    const theta = rng() * Math.PI * 2;
    const speed = GIB_BURST.speedMin + rng() * (GIB_BURST.speedMax - GIB_BURST.speedMin);
    const up = 0.4 + rng() * 0.8;
    push(sim, {
      pos: [origin[0], origin[1], origin[2]],
      vel: [Math.cos(theta) * speed, up * speed * 0.6, Math.sin(theta) * speed],
      age: 0,
      life: GIB_BURST.lifetimeSec,
      size: 0.05 + rng() * 0.05,
    });
  }
}

export interface TrailSource { id: number; pos: Vec3; vel: Vec3 }

/** FX_27-style droplet trails behind flying chunks: 20 Hz, 1/256 inheritance. */
export function emitTrails(
  sim: BloodSim, sources: TrailSource[], dt: number, rng: () => number,
): void {
  const period = 1 / BLOOD_TRAIL.emitHz;
  const live = new Set<number>();
  for (const s of sources) {
    live.add(s.id);
    let clock = (sim.clocks[s.id] ?? 0) + dt;
    while (clock >= period) {
      clock -= period;
      push(sim, {
        pos: [s.pos[0], s.pos[1], s.pos[2]],
        vel: [
          s.vel[0] * BLOOD_TRAIL.velScale + (rng() - 0.5) * 0.4,
          s.vel[1] * BLOOD_TRAIL.velScale + (rng() - 0.5) * 0.4,
          s.vel[2] * BLOOD_TRAIL.velScale + (rng() - 0.5) * 0.4,
        ],
        age: 0,
        life: BLOOD_TRAIL.lifetimeSec,
        size: BLOOD_TRAIL.size * (0.7 + rng() * 0.6),
      });
    }
    sim.clocks[s.id] = clock;
  }
  for (const key of Object.keys(sim.clocks)) {
    if (!live.has(Number(key))) delete sim.clocks[Number(key)];
  }
}

function stamp(sim: BloodSim, at: Vec3, rng: () => number): void {
  const ox = (rng() - 0.5) * 2 * BLOOD_SPLAT.spreadM;
  const oz = (rng() - 0.5) * 2 * BLOOD_SPLAT.spreadM;
  sim.splats.push({ pos: [at[0] + ox, 0, at[2] + oz], size: 0.12 + rng() * 0.18, yaw: rng() * Math.PI * 2 });
  // Raised second-pool chance, same knob the game uses (0xB000 / 0x10000).
  if (rng() < BLOOD_SPLAT.secondChance / 0x10000) {
    sim.splats.push({
      pos: [at[0] - ox * 0.6, 0, at[2] - oz * 0.6],
      size: 0.1 + rng() * 0.12, yaw: rng() * Math.PI * 2,
    });
  }
  while (sim.splats.length > MAX_SPLATS) sim.splats.shift();
}

/** Integrate droplets; floor hits and expiry both stamp splats (cascade). */
export function stepBlood(sim: BloodSim, dt: number, rng: () => number): void {
  const drag = Math.max(0, 1 - BLOOD_TRAIL.airdrag * dt);
  for (let i = sim.droplets.length - 1; i >= 0; i--) {
    const d = sim.droplets[i]!;
    d.vel[1] -= BLOOD_TRAIL.gravity * dt;
    d.vel[0] *= drag; d.vel[1] *= drag; d.vel[2] *= drag;
    d.pos[0] += d.vel[0] * dt; d.pos[1] += d.vel[1] * dt; d.pos[2] += d.vel[2] * dt;
    d.age += dt;
    if (d.pos[1] <= 0.01 || d.age >= d.life) {
      stamp(sim, d.pos, rng);
      sim.droplets.splice(i, 1);
    }
  }
}
```

- [ ] **Step 4: Verify** — `npx vitest run src/lab/sdf-zombie/blood-sim.test.ts` PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add src/lab/sdf-zombie/blood-sim.ts src/lab/sdf-zombie/blood-sim.test.ts && git commit -m "feat(sdf-lab): pure blood droplet sim on the game's playtested constants"`

---

### Task 7: Gooey droplet + splat renderer views (both paths)

**Files:**
- Create: `src/lab/sdf-zombie/blood-view.ts` (WebGL — imports `three`)
- Create: `src/lab/sdf-zombie/webgpu/blood-view-gpu.ts` (WebGPU — imports `three/webgpu` ONLY)

No unit tests (pure rendering); verified visually in Task 10. Both files are
near-twins — the import line and material class differ. The gooey look comes
from a procedurally-drawn droplet texture (radial red with an off-centre
specular glint and darkened rim — reads wet/latex against the
`henenlotter-latex` preset) plus velocity-stretch on the billboard.

- [ ] **Step 1: WebGL view** — create `src/lab/sdf-zombie/blood-view.ts`:

```ts
// src/lab/sdf-zombie/blood-view.ts
//
// Instanced billboard renderer for blood-sim: gooey specular droplets +
// flat floor splats. WebGL twin; webgpu/blood-view-gpu.ts mirrors it with
// three/webgpu imports. Keep the two in the same shape.
import * as THREE from 'three';
import type { BloodSim } from './blood-sim';

const MAX_DROPLETS = 600;
const MAX_SPLATS = 256;

/** Radial red droplet with an off-centre white glint and darker rim — the
 *  specular "gooey latex" read, baked into a texture so both renderer paths
 *  look identical with zero custom shader. */
function dropletTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(190, 16, 28, 1)');
  grad.addColorStop(0.55, 'rgba(140, 10, 24, 1)');
  grad.addColorStop(0.85, 'rgba(70, 4, 12, 1)');
  grad.addColorStop(1, 'rgba(40, 2, 8, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // Specular glint, offset up-left like the lab's key light.
  const glint = g.createRadialGradient(24, 22, 0, 24, 22, 9);
  glint.addColorStop(0, 'rgba(255, 235, 235, 0.95)');
  glint.addColorStop(0.5, 'rgba(255, 200, 205, 0.35)');
  glint.addColorStop(1, 'rgba(255, 200, 205, 0)');
  g.fillStyle = glint;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function splatTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(90, 6, 14, 0.95)');
  grad.addColorStop(0.7, 'rgba(60, 4, 10, 0.8)');
  grad.addColorStop(1, 'rgba(40, 2, 8, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface BloodView {
  objects: THREE.Object3D[];
  /** Re-pose every instance from sim state; call once per frame. */
  sync(sim: BloodSim, camera: THREE.Camera): void;
  dispose(): void;
}

export function createBloodView(): BloodView {
  const dropGeom = new THREE.PlaneGeometry(1, 1);
  const drops = new THREE.InstancedMesh(
    dropGeom,
    new THREE.MeshBasicMaterial({ map: dropletTexture(), transparent: true, depthWrite: false }),
    MAX_DROPLETS,
  );
  drops.frustumCulled = false;
  const splatGeom = new THREE.PlaneGeometry(1, 1);
  const splats = new THREE.InstancedMesh(
    splatGeom,
    new THREE.MeshBasicMaterial({ map: splatTexture(), transparent: true, depthWrite: false }),
    MAX_SPLATS,
  );
  splats.frustumCulled = false;

  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const camInv = new THREE.Quaternion();
  const vCam = new THREE.Vector3();

  function sync(sim: BloodSim, camera: THREE.Camera): void {
    camInv.copy(camera.quaternion).invert();
    for (let i = 0; i < MAX_DROPLETS; i++) {
      const d = sim.droplets[i];
      if (!d) { m.makeScale(0, 0, 0); drops.setMatrixAt(i, m); continue; }
      p.set(d.pos[0], d.pos[1], d.pos[2]);
      // Billboard, then roll in screen space so the stretch follows velocity.
      vCam.set(d.vel[0], d.vel[1], d.vel[2]).applyQuaternion(camInv);
      const speed = Math.hypot(d.vel[0], d.vel[1], d.vel[2]);
      const stretch = 1 + Math.min(speed * 0.18, 1.4);
      roll.setFromAxisAngle(zAxis, Math.atan2(vCam.y, vCam.x));
      q.copy(camera.quaternion).multiply(roll);
      s.set(d.size * stretch, d.size, 1);
      m.compose(p, q, s);
      drops.setMatrixAt(i, m);
    }
    drops.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < MAX_SPLATS; i++) {
      const sp = sim.splats[i];
      if (!sp) { m.makeScale(0, 0, 0); splats.setMatrixAt(i, m); continue; }
      p.set(sp.pos[0], 0.005 + i * 0.0001, sp.pos[2]); // tiny y-ladder beats z-fight
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      roll.setFromAxisAngle(zAxis, sp.yaw);
      q.multiply(roll);
      s.set(sp.size, sp.size, 1);
      m.compose(p, q, s);
      splats.setMatrixAt(i, m);
    }
    splats.instanceMatrix.needsUpdate = true;
  }

  return {
    objects: [drops, splats],
    sync,
    dispose() {
      for (const o of [drops, splats]) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    },
  };
}
```

- [ ] **Step 2: WebGPU view** — create `src/lab/sdf-zombie/webgpu/blood-view-gpu.ts` as an exact copy of Step 1's file with TWO changes: the header comment names the twin relationship the other way, and the import becomes `import * as THREE from 'three/webgpu';`. Everything else is identical (InstancedMesh + MeshBasicMaterial + CanvasTexture all exist on the webgpu build).
- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean (both files compile; nothing consumes them yet).
- [ ] **Step 4: Commit** — `git add src/lab/sdf-zombie/blood-view.ts src/lab/sdf-zombie/webgpu/blood-view-gpu.ts && git commit -m "feat(sdf-lab): gooey instanced droplet/splat views for both renderer paths"`

---

### Task 8: Connectivity — wound-driven limb detachment

**Files:**
- Create: `src/lab/sdf-zombie/connectivity.ts`
- Test: `src/lab/sdf-zombie/connectivity.test.ts`

- [ ] **Step 1: Write the failing tests** — create `src/lab/sdf-zombie/connectivity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cutLimbs } from './connectivity';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { worldHitToWound, woundWorldPos } from './damage';
import type { Wound } from './damage';
import type { Vec3 } from './types';

const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
const torso = body.clusters.find(c => c.limb === 'torso')!;

/** The armL attachment endpoint: nearest armL endpoint to the torso centre. */
function armRoot(): Vec3 {
  const arm = body.clusters.find(c => c.limb === 'armL')!;
  const prims = body.prims.slice(arm.start, arm.start + arm.count);
  let best: Vec3 = prims[0]!.a; let bd = Infinity;
  for (const p of prims) for (const e of [p.a, p.b]) {
    const d = Math.hypot(e[0] - torso.center[0], e[1] - torso.center[1], e[2] - torso.center[2]);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function woundAt(at: Vec3, radius: number, type: 'blast' | 'burn' = 'blast'): Wound {
  return worldHitToWound(body.prims, at, radius, type);
}

describe('cutLimbs', () => {
  it('detaches a limb whose neck a big blast engulfs', () => {
    const root = armRoot();
    // Radius comfortably above neck girth (~0.06) plus the sample offset.
    const wounds = [woundAt(root, 0.16)];
    expect(cutLimbs(body, wounds, torso.center)).toContain('armL');
  });

  it('does not detach on a nick (small wound near the neck)', () => {
    const root = armRoot();
    const wounds = [woundAt([root[0] + 0.05, root[1], root[2]], 0.055)];
    expect(cutLimbs(body, wounds, torso.center)).not.toContain('armL');
  });

  it('never detaches from burns', () => {
    const root = armRoot();
    const wounds = [woundAt(root, 0.2, 'burn')];
    expect(cutLimbs(body, wounds, torso.center)).toHaveLength(0);
  });

  it('ignores dead clusters and the torso', () => {
    const dead = {
      ...body,
      clusters: body.clusters.map(c => c.limb === 'armL' ? { ...c, alive: false } : c),
    };
    const wounds = [woundAt(armRoot(), 0.2)];
    expect(cutLimbs(dead, wounds, torso.center)).not.toContain('armL');
    expect(cutLimbs(dead, wounds, torso.center)).not.toContain('torso');
  });

  it('wound placement resolves through woundWorldPos (sanity)', () => {
    const root = armRoot();
    const w = woundAt(root, 0.16);
    const back = woundWorldPos(body.prims, w);
    expect(Math.hypot(back[0] - root[0], back[1] - root[1], back[2] - root[2]))
      .toBeLessThan(0.05);
  });
});
```

NOTE: `worldHitToWound`'s exact signature is `(prims, hitWorld, radius, type)` —
verify against `src/lab/sdf-zombie/damage.ts` before running; if the argument
order differs, adapt the test helper (NOT the module under test).

- [ ] **Step 2: Verify failure** — `npx vitest run src/lab/sdf-zombie/connectivity.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/lab/sdf-zombie/connectivity.ts`:

```ts
// src/lab/sdf-zombie/connectivity.ts
//
// Wound-driven limb detachment: "visually cut => actually cut". After each
// wound lands, every live non-torso limb checks whether any blast/pellet
// wound's carve sphere fully engulfs its attachment neck's cross-section.
// Pure sphere math against the wound list — no field evaluation, deterministic,
// conservative (a nick can never fire).
import type { BuildResult } from './build-body';
import type { LimbId, Primitive, Vec3 } from './types';
import { woundWorldPos, type Wound } from './damage';
import { add, len, normalize, scale, sub } from './vec';

/** Samples along the attachment neck. */
const NECK_SAMPLES = 4;
/** How far past the limb root, toward the torso, the neck extends (m). */
const NECK_LEN = 0.1;

/** Girth at the limb root: radius of the nearest add-prim endpoint. */
function rootGirth(prims: Primitive[], root: Vec3): number {
  let best = Infinity; let girth = 0.05;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    const g = p.radius * Math.min(p.scale[0], p.scale[1], p.scale[2]);
    for (const e of [p.a, p.b]) {
      const d = len(sub(e, root));
      if (d < best) { best = d; girth = g; }
    }
  }
  return girth;
}

/**
 * Limbs whose attachment neck is fully carved through by the wounds.
 * The neck runs from the limb's closest endpoint to the torso centre,
 * NECK_LEN toward the torso. A sample is cut when a single blast/pellet
 * wound sphere covers the whole local cross-section:
 * dist(sample, wound) + girth < wound.radius (the shader's carve depth).
 */
export function cutLimbs(
  body: BuildResult, wounds: Wound[], torsoCentre: Vec3,
): LimbId[] {
  const carves = wounds.filter(w => w.type !== 'burn');
  if (carves.length === 0) return [];
  const out: LimbId[] = [];

  for (const c of body.clusters) {
    if (!c.alive || c.limb === 'torso') continue;
    const prims = body.prims.slice(c.start, c.start + c.count);

    let root: Vec3 | null = null; let bd = Infinity;
    for (const p of prims) {
      if (p.op === 'sub') continue;
      for (const e of [p.a, p.b]) {
        const d = len(sub(e, torsoCentre));
        if (d < bd) { bd = d; root = e; }
      }
    }
    if (!root) continue;

    const girth = rootGirth(prims, root);
    const dir = normalize(sub(torsoCentre, root));

    let cut = false;
    for (let k = 0; k < NECK_SAMPLES && !cut; k++) {
      const sample = add(root, scale(dir, (k / (NECK_SAMPLES - 1)) * NECK_LEN));
      for (const w of carves) {
        const centre = woundWorldPos(body.prims, w);
        if (len(sub(sample, centre)) + girth < w.radius) { cut = true; break; }
      }
    }
    if (cut) out.push(c.limb);
  }
  return out;
}
```

NOTE: verify `woundWorldPos(prims, wound)` signature against `damage.ts`; adapt
the call if it differs (it is the same helper `refreshWounds` uses in both
lab-mains).

- [ ] **Step 4: Verify** — `npx vitest run src/lab/sdf-zombie/connectivity.test.ts` PASS; `npx tsc --noEmit` clean; `npm test` green.
- [ ] **Step 5: Commit** — `git add src/lab/sdf-zombie/connectivity.ts src/lab/sdf-zombie/connectivity.test.ts && git commit -m "feat(sdf-lab): connectivity check — carved-through limbs report as cut"`

---

### Task 9: Wire it all into both lab-mains

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`
- Modify: `src/lab/sdf-zombie/lab-main.ts`

Mirror every change in BOTH labs. The WebGPU one nests everything inside
`async function main()`; the WebGL one is top-level — same edits, different
nesting. Anchors below are from the WebGPU file; find the same code by name in
the WebGL file.

- [ ] **Step 1: Imports** — WebGPU lab-main: extend `from '../sever'` to `{ severLimb, gibAll, gibAllPieces }`; add `import { createBloodSim, burst, emitTrails, stepBlood } from '../blood-sim';`, `import { createBloodView } from './blood-view-gpu';`, `import { cutLimbs } from '../connectivity';`. WebGL lab-main: same with `'./sever'`, `'./blood-sim'`, `'./blood-view'`, `'./connectivity'`.

- [ ] **Step 2: Blood state + view** — near the `chunks` array declaration (`const chunks: { state: Chunk; view: ChunkGpuView }[] = [];`):

```ts
  const bloodSim = createBloodSim();
  const bloodView = createBloodView();
  for (const o of bloodView.objects) scene.add(o);
  let nextChunkId = 1;
```

  and widen the chunk record to carry an id: `const chunks: { id: number; state: Chunk; view: ChunkGpuView }[] = [];` (WebGL: `ChunkView`).

- [ ] **Step 3: spawnChunk** — replace the body so it seeds tumble + long axis, registers the id, and sprays a burst at the tear:

```ts
  function spawnChunk(
    limb: LimbId, origin: Vec3, prims: typeof current.prims,
    vel?: Vec3, tornAt?: Vec3[],
  ) {
    if (prims.length === 0) return;
    const v: Vec3 = vel ?? [
      (Math.random() - 0.5) * 3.2,
      1.8 + Math.random() * 2.2,
      (Math.random() - 0.5) * 3.2,
    ];
    const state = makeChunk(
      limb, origin, v, chunkExtent(prims, origin), primsLongAxis(prims, origin));
    const chunkView = createChunkGpuView(state, prims, u, tornAt);
    chunkView.object.layers.set(SDF_LAYER);
    scene.add(chunkView.object);
    chunks.push({ id: nextChunkId++, state, view: chunkView });
    burst(bloodSim, origin, Math.random);

    while (chunks.length > MAX_CHUNKS) {
      const oldest = chunks.shift();
      if (!oldest) break;
      scene.remove(oldest.view.object);
      oldest.view.dispose();
    }
  }
```

  (WebGL lab: `createChunkView(state, prims, material-template-args..., tornAt)` — keep its existing extra args, only the tornAt type and makeChunk call change.)
  Also add the `primsLongAxis` helper from Task 5 Step 3 next to `attachPoint` if not already there, and raise `const MAX_CHUNKS = 24;` to `const MAX_CHUNKS = 40;` in both labs (a per-prim gib is ~15 pieces; two full gibs should coexist).

- [ ] **Step 4: gibEverything on pieces** — replace `const { body: next, chunks: groups } = gibAll(current);` with `const { body: next, chunks: groups } = gibAllPieces(current, centre);` and the spawn loop's last line with `spawnChunk(g.limb, g.origin, g.prims, vel, g.tornAt);`. `gibAll` stays exported (tests use it). The single-limb SEVER path keeps its `attachPoint` flow but wraps it: `spawnChunk(limb, chunk.origin, chunk.prims, undefined, [attachPoint(chunk.prims, torsoCentre())]);`

- [ ] **Step 5: Detachment on shoot** — in the `pointerup` shoot handler, after `refreshWounds();` add:

```ts
    // Wound-driven detachment: a carve that disconnects a limb severs it for
    // real — same path as the keyboard sever.
    for (const limb of cutLimbs(current, wounds, torsoCentre())) {
      const { body: next, chunk, stumpWound } = severLimb(current, limb);
      if (chunk.prims.length === 0) continue;
      current = next;
      if (stumpWound) wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
      spawnChunk(limb, chunk.origin, chunk.prims, undefined,
        [attachPoint(chunk.prims, torsoCentre())]);
      view.update(current);
      refreshWounds();
      rebind();
    }
```

  (WebGL lab: identical logic with its own view/rebind names — read the file's existing keydown sever block and mirror it exactly; it is the same five statements.)

- [ ] **Step 6: Frame loop** — right after the chunk stepping loop (`c.state = stepChunk(c.state, Math.min(dt, 1 / 30));`):

```ts
    const bdt = Math.min(dt, 1 / 30);
    emitTrails(
      bloodSim,
      chunks.map(c => ({ id: c.id, pos: c.state.pos, vel: c.state.vel })),
      bdt, Math.random);
    stepBlood(bloodSim, bdt, Math.random);
    bloodView.sync(bloodSim, camera);
```

  (WebGL lab: its loop stepped chunks with raw `dt` — clamp it there too: `stepChunk(c.state, Math.min(dt, 1 / 30))`.)

- [ ] **Step 7: Verify** — `npx tsc --noEmit` clean; `npm test` green (854 + new).
- [ ] **Step 8: Commit** — `git add -A src/lab/sdf-zombie && git commit -m "feat(sdf-lab): wire 3D chunks, per-prim gibs, blood trails and wound detachment into both labs"`

---

### Task 10: Verification, TASKS.md, wrap

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Full suite + typecheck** — `npm test` and `npx tsc --noEmit`; both clean.
- [ ] **Step 2: Visual verification (browser)** — dev server → `/sdf-lab-webgpu.html`, then the same on `/sdf-lab.html` (navigate the SAME tab — two live GPU contexts starve each other):
  1. `window.__sdfLab.gibEverything()` → ~15 small pieces tumble in 3D with visible droplet trails, land, topple, and LIE FLAT; splats accumulate on the floor.
  2. Sever an arm (key 3, or `__sdfLab` on webgpu) → one whole-arm chunk with a torn end that stays welded while tumbling; burst spray at the tear.
  3. Shoot the same shoulder with shift-click blasts at DEFAULT damage sliders until the carve disconnects → the arm auto-severs and falls (acceptance test from the spec).
  4. `__sdfLab.stampWounds(6)` → no limb-welding, wound lips still read, no white blow-out.
  Screenshot each state. rAF pauses when the pane hides — drive via `window.__sdfLab` and `javascript_tool`, not keyboard, and remember a small drag stops autoSpin.
- [ ] **Step 3: TASKS.md** — under the X1 side-quest block, collapse/append (≤2 lines per row):

```markdown
- `X1.19` [x] Gore-feel pass — per-prim gib pieces, 3D tumble + topple (no more
  standing limbs), gooey blood trails/splats on the game's tuning constants,
  wound-driven limb detachment, rim locality (no limb welding). Spec:
  docs/superpowers/specs/2026-08-16-sdf-lab-gore-feel-design.md
```

  (renumber if X1.19 is taken; check `grep -n "X1.19" TASKS.md`.)
- [ ] **Step 4: Commit** — `git add TASKS.md && git commit -m "docs(tasks): X1.19 gore-feel pass landed"`

---

## Self-review notes (already applied)

- Spec §1–§6 → Tasks 3/2/6+7/8/4/10 respectively; §2's shared-transform
  requirement is Task 2's `chunkPoint` + Task 5 consuming it in both views.
- Type threads: `Chunk` (Task 2) is consumed by Tasks 5/9; `ChunkGroup.tornAt`
  (Task 3) by Tasks 5/9; `BloodSim` (Task 6) by Tasks 7/9; `cutLimbs` (Task 8)
  by Task 9. Signatures quoted consistently.
- Known judgment calls an implementer may hit: exact `worldHitToWound` /
  `woundWorldPos` signatures (verify in damage.ts — flagged in Task 8), the
  GLSL rim parameter name (flagged in Task 4), and the WebGL lab's
  top-level-vs-main() nesting (flagged in Task 9). In each case: adapt the
  call site, never the tested module.
