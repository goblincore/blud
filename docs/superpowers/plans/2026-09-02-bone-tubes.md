# Bones as instanced tubes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the skeleton out of the marched field: draw every posed bone prim as one instanced analytic tube in the polygonal pass, hidden under flesh and revealed in cavities by the existing composite depth test, so the wound-zone bone fold is deleted.

**Architecture:** A unit tube mesh with `(t, theta)` vertices is instanced once per bone; per-instance attributes are the posed prim's `a, b, c, r1, r2, scale, orient`; a TSL vertex program sweeps the same bent-cone curve `sdPrim` uses. `packBody` gains a `packBones` flag (default true = today's layout) that the game flips off when the bone mesh is on. Organs stay in the field untouched.

**Tech Stack:** TypeScript, three 0.185 `three/webgpu` + `three/tsl` (`InstancedBufferGeometry`, `InstancedBufferAttribute`, `attribute()`, `MeshBasicNodeMaterial` with `positionNode`/`normalNode`/`colorNode`), vitest, `scripts/perf-r2-parity.mjs` for the A/B reel, `__sdfGame.boneEvals()` for the counter gate.

**Spec:** [docs/superpowers/specs/2026-09-02-bone-tubes-design.md](../specs/2026-09-02-bone-tubes-design.md) · **Branch:** `claude/bone-tubes`

---

## Deviations from the spec, decided while planning

1. **No lab wiring.** `lab-main.ts` has no bone toggle to hang it on; the A/B reel runs on the GAME page through `perf-r2-parity.mjs --on "__sdfGame.setBoneMesh(true)" --off "__sdfGame.setBoneMesh(false)"`, which is the same harness the spec names.
2. **Containment stays a reported build error** (it already is: `validateBody` → `checkBoneContainment` → `BuildResult.errors`). The plan only rewrites the message to say why it matters now (bone through skin), and the game page logs `errors` at spawn so a breach is visible in the console.
3. **The instancer owns a small uniform set** (light + spot + bone colour) that the game copies into in the same loop that already rewrites every actor's spot uniforms each frame (`game-main.ts:517-524`), rather than borrowing an actor's nodes (actors may not exist when the instancer is built).
4. **Per-instance data rides `InstancedBufferAttribute`s on an `InstancedBufferGeometry`** read with TSL `attribute('iA','vec3')` etc.; not `InstancedMesh.instanceMatrix`, since a tube needs seven fields, not one matrix. `shell-hull-outer.ts` is the repo's instancing precedent for the mesh/material plumbing.

## File structure

| file | responsibility |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/bone-tube-geom.ts` | **Create.** Unit tube geometry builder (`(t, theta)` verts, caps) + `tubePoint(prim, t, theta)` CPU mirror of the vertex program + `boneInstanceOf(prim)` (a, b, c, r1, r2, scale, orient quat) — the single source of the tube's shape. |
| `src/lab/sdf-zombie/webgpu/bone-tube-geom.test.ts` | **Create.** Tube points sit on the field's zero level (|sdPrimitive| < 1 mm) for straight, bent, sphere, scaled and oriented prims. |
| `src/lab/sdf-zombie/webgpu/bone-instancer.ts` | **Create.** `createBoneInstancer(max)`: geometry + instanced attributes + material (WGSL vertex sweep, lighting), `update(prims)`, `object`, `uniforms`, `count`, `overflowed`; pure `packBoneInstances(prims, arrays, max)`. |
| `src/lab/sdf-zombie/webgpu/bone-instancer.test.ts` | **Create.** Packing: filters organs/dead/dead-cluster, includes chunk bones, overflow flagged; WGSL parse contract. |
| `src/lab/sdf-zombie/pack.ts` | **Modify.** `PackOpts.packBones` (default true); when false, `op === 'bone'` rows are skipped and `boneCount` counts organs only. |
| `src/lab/sdf-zombie/pack.test.ts` | **Modify.** The three pack assertions from spec §8. |
| `src/lab/sdf-zombie/webgpu/march.wgsl.ts` | **Modify.** Remove the `isBone` albedo branch and its wetness select; comments on `applyBones`/gate say "organs (and bones only when packBones)". |
| `src/lab/sdf-zombie/validate.ts` | **Modify.** `checkBoneContainment` message. |
| `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` | **Modify.** `GpuViewOpts.packBones` + `setPackBones(on)` on both views; `ChunkGpuView.posedBones()`; chunk bone rows gated the same way. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | **Modify.** Create the instancer, feed it per frame, `setBoneMesh` seam + getter, log build errors. |
| `scripts/bone-tubes-reel.sh` | **Create.** The three A/B captures + the counter gate. |
| `docs/dev-notes/2026-09-02-bone-tubes/notes.md` | **Create.** Numbers, captures, verdict. |
| `TASKS.md` | **Modify.** Status row. |

---

### Task 1: Tube geometry + the CPU mirror, pinned to the field

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/bone-tube-geom.ts`
- Test: `src/lab/sdf-zombie/webgpu/bone-tube-geom.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/bone-tube-geom.test.ts
import { describe, expect, it } from 'vitest';
import type { Primitive } from '../types';
import { sdPrimitive } from '../validate';
import { qFromAxisAngle } from '../vec';
import { boneInstanceOf, tubePoint, buildTubeGeometry, TUBE_RINGS, TUBE_SEGS } from './bone-tube-geom';

const base = (over: Partial<Primitive>): Primitive => ({
  a: [0, 0, 0], b: [0, 0.2, 0], radius: 0.02, scale: [1, 1, 1], blendK: 0,
  limb: 'torso', cluster: 1, op: 'bone', ...over,
});

const CASES: [string, Primitive][] = [
  ['straight capsule', base({})],
  ['round cone (radiusB)', base({ radiusB: 0.008 })],
  ['bent rib', base({ b: [0.12, 0.05, 0.02], bend: [0.03, 0.0, 0.04] })],
  ['skull sphere (a == b)', base({ b: [0, 0, 0], radius: 0.06 })],
  ['scaled (wide/deep)', base({ scale: [1.4, 1, 0.7] })],
  ['oriented skull sphere', base({ b: [0, 0, 0], radius: 0.05, orient: qFromAxisAngle([0, 1, 0], 0.7) })],
  ['bent + tapered + scaled', base({ b: [0.1, 0.1, 0], bend: [0, 0.02, 0.03], radiusB: 0.01, scale: [1.2, 0.9, 1] })],
];

describe('tubePoint lies on the field zero level', () => {
  for (const [name, prim] of CASES) {
    it(name, () => {
      let worst = 0;
      for (let i = 0; i <= TUBE_RINGS; i++) for (let j = 0; j < TUBE_SEGS; j++) {
        const t = i / TUBE_RINGS, theta = (j / TUBE_SEGS) * Math.PI * 2;
        const p = tubePoint(prim, t, theta);
        worst = Math.max(worst, Math.abs(sdPrimitive(p, prim)));
      }
      // caps: pole and a mid-latitude ring at both ends
      for (const end of [0, 1]) for (const lat of [0.25, 0.5, 0.9]) for (let j = 0; j < TUBE_SEGS; j++) {
        const p = tubePoint(prim, end, (j / TUBE_SEGS) * Math.PI * 2, lat);
        worst = Math.max(worst, Math.abs(sdPrimitive(p, prim)));
      }
      expect(worst).toBeLessThan(0.001);
    });
  }
});

describe('boneInstanceOf', () => {
  it('fills c with the bend control point and r2 with radiusB, defaults otherwise', () => {
    const s = boneInstanceOf(base({ b: [0.1, 0, 0], bend: [0, 0.02, 0], radiusB: 0.01 }));
    expect(s.c).toEqual([0.05, 0.02, 0]);
    expect(s.r1).toBe(0.02); expect(s.r2).toBe(0.01);
    const d = boneInstanceOf(base({}));
    expect(d.c).toEqual([0, 0.1, 0]); expect(d.r2).toBe(0.02);
    expect(d.orient).toEqual([0, 0, 0, 1]);
  });
});

describe('buildTubeGeometry', () => {
  it('emits (rings+1)*segs body verts plus two caps, indexed, with t/theta/cap attributes', () => {
    const g = buildTubeGeometry();
    const n = g.getAttribute('position').count;
    expect(n).toBe((TUBE_RINGS + 1) * TUBE_SEGS + 2 * (4 * TUBE_SEGS + 1));
    expect(g.getAttribute('tubeT').count).toBe(n);
    expect(g.getAttribute('tubeTheta').count).toBe(n);
    expect(g.getAttribute('tubeLat').count).toBe(n);
    expect(g.index!.count % 3).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/bone-tube-geom.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

The shape contract, mirrored from `validate.ts sdPrimitive` (lines 85-130): rotate by `orient` about the prim midpoint, divide by `scale`, curve = quadratic Bézier through `a, c, b` (straight when `bend` is undefined, `c` = midpoint), radius = `mix(r1, r2, t)`, then multiply by `scale`. The tube surface is that curve swept by a circle of the local radius. For `a == b` the whole thing is a sphere and only the caps exist.

```ts
// src/lab/sdf-zombie/webgpu/bone-tube-geom.ts
//
// The bone tube: ONE unit mesh parameterised by (t along the bone, theta around
// it, lat on the caps), instanced per posed bone prim by bone-instancer.ts.
// tubePoint() is the CPU twin of the vertex program and the spec's honesty
// check: bone-tube-geom.test.ts pins every tube vertex to |sdPrimitive| < 1 mm
// for straight, bent, tapered, scaled, oriented and sphere prims. The maths
// mirrors validate.ts sdPrimitive (orient about the midpoint, scale, bend
// control point, radius lerp) — change one, change both.
import * as THREE from 'three/webgpu';
import type { Primitive, Quat, Vec3 } from '../types';
import { add, bendCtrl, cross, normalize, scale as vscale, sub, qRotate } from '../vec';

export const TUBE_RINGS = 24;
export const TUBE_SEGS = 12;
/** Cap latitude rings (pole excluded). */
export const CAP_LATS = 4;

export interface BoneInstance {
  a: Vec3; b: Vec3; c: Vec3; r1: number; r2: number; scale: Vec3; orient: Quat;
}

export function boneInstanceOf(p: Primitive): BoneInstance {
  return {
    a: p.a, b: p.b,
    c: bendCtrl(p.a, p.b, p.bend),
    r1: p.radius, r2: p.radiusB ?? p.radius,
    scale: p.scale,
    orient: p.orient ?? [0, 0, 0, 1],
  };
}

const rotAboutMid = (q: Quat, mid: Vec3, x: Vec3): Vec3 => add(mid, qRotate(q, sub(x, mid)));

/**
 * A point on the tube surface. t in [0,1] along the bone, theta around it.
 * lat (0..1, optional) selects a cap point instead: 0 = the ring at the end,
 * 1 = the pole; caps are hemispheres of the end radius about the curve's end.
 * Mirrors the vertex program in bone-instancer.ts EXACTLY.
 */
export function tubePoint(prim: Primitive, t: number, theta: number, lat?: number): Vec3 {
  const s = boneInstanceOf(prim);
  const inv: Vec3 = [1 / s.scale[0], 1 / s.scale[1], 1 / s.scale[2]];
  const mul = (v: Vec3, m: Vec3): Vec3 => [v[0] * m[0], v[1] * m[1], v[2] * m[2]];
  // orient rotates the prim's own frame about its midpoint (sdPrimitive applies the
  // conjugate to the query point; rotating the prim by q is the same surface).
  const mid = vscale(add(s.a, s.b), 0.5);
  const A = mul(rotAboutMid(s.orient, mid, s.a), inv);
  const B = mul(rotAboutMid(s.orient, mid, s.b), inv);
  const C = mul(rotAboutMid(s.orient, mid, s.c), inv);
  const sphere = Math.hypot(...sub(B, A)) < 1e-9;
  const bez = (u: number): Vec3 => {
    const w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
    return [A[0] * w0 + C[0] * w1 + B[0] * w2, A[1] * w0 + C[1] * w1 + B[1] * w2, A[2] * w0 + C[2] * w1 + B[2] * w2];
  };
  const tangent = (u: number): Vec3 => {
    if (sphere) return [0, 1, 0];
    const d: Vec3 = [
      2 * (1 - u) * (C[0] - A[0]) + 2 * u * (B[0] - C[0]),
      2 * (1 - u) * (C[1] - A[1]) + 2 * u * (B[1] - C[1]),
      2 * (1 - u) * (C[2] - A[2]) + 2 * u * (B[2] - C[2])];
    return normalize(d);
  };
  const frame = (tan: Vec3): { u: Vec3; v: Vec3 } => {
    // a fixed reference so the ring never twists along the bone
    const ref: Vec3 = Math.abs(tan[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = normalize(cross(ref, tan));
    return { u, v: cross(tan, u) };
  };
  const r = s.r1 + (s.r2 - s.r1) * t;
  const centre = bez(t);
  const tan = tangent(t);
  const { u, v } = frame(tan);
  let q: Vec3;
  if (lat === undefined) {
    q = add(centre, add(vscale(u, r * Math.cos(theta)), vscale(v, r * Math.sin(theta))));
  } else {
    const out = t < 0.5 ? vscale(tan, -1) : tan;   // cap points away from the body
    const ring = Math.cos(lat * Math.PI / 2), rise = Math.sin(lat * Math.PI / 2);
    q = add(centre, add(add(vscale(u, r * ring * Math.cos(theta)), vscale(v, r * ring * Math.sin(theta))), vscale(out, r * rise)));
  }
  return mul(q, s.scale);
}

/**
 * The unit mesh: body rings then two caps. Attributes: tubeT (f32), tubeTheta
 * (f32), tubeLat (f32, -1 = body vertex). Positions are placeholders — the
 * vertex program ignores them and rebuilds from the instance.
 */
export function buildTubeGeometry(): THREE.BufferGeometry {
  const T: number[] = [], TH: number[] = [], LAT: number[] = [], idx: number[] = [];
  const push = (t: number, th: number, lat: number) => { T.push(t); TH.push(th); LAT.push(lat); return T.length - 1; };
  // body
  for (let i = 0; i <= TUBE_RINGS; i++) for (let j = 0; j < TUBE_SEGS; j++) push(i / TUBE_RINGS, (j / TUBE_SEGS) * Math.PI * 2, -1);
  const body = (i: number, j: number) => i * TUBE_SEGS + (j % TUBE_SEGS);
  for (let i = 0; i < TUBE_RINGS; i++) for (let j = 0; j < TUBE_SEGS; j++) {
    idx.push(body(i, j), body(i + 1, j), body(i + 1, j + 1), body(i, j), body(i + 1, j + 1), body(i, j + 1));
  }
  // caps: CAP_LATS rings (lat = k/(CAP_LATS+1), k=1..CAP_LATS) + a pole, at t = 0 and t = 1
  for (const end of [0, 1]) {
    const endRing = (j: number) => body(end === 0 ? 0 : TUBE_RINGS, j);
    const rings: number[][] = [];
    for (let k = 1; k <= CAP_LATS; k++) {
      const ring: number[] = [];
      for (let j = 0; j < TUBE_SEGS; j++) ring.push(push(end, (j / TUBE_SEGS) * Math.PI * 2, k / (CAP_LATS + 1)));
      rings.push(ring);
    }
    const pole = push(end, 0, 1);
    const prev = (j: number) => endRing(j);
    let prevRing: (j: number) => number = prev;
    for (const ring of rings) {
      const cur = (j: number) => ring[j % TUBE_SEGS]!;
      for (let j = 0; j < TUBE_SEGS; j++) {
        if (end === 0) idx.push(prevRing(j), cur(j + 1), cur(j), prevRing(j), prevRing(j + 1), cur(j + 1));
        else idx.push(prevRing(j), cur(j), cur(j + 1), prevRing(j), cur(j + 1), prevRing(j + 1));
      }
      prevRing = cur;
    }
    for (let j = 0; j < TUBE_SEGS; j++) {
      if (end === 0) idx.push(prevRing(j), pole, prevRing(j + 1));
      else idx.push(prevRing(j), prevRing(j + 1), pole);
    }
  }
  const g = new THREE.BufferGeometry();
  const n = T.length;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('tubeT', new THREE.BufferAttribute(new Float32Array(T), 1));
  g.setAttribute('tubeTheta', new THREE.BufferAttribute(new Float32Array(TH), 1));
  g.setAttribute('tubeLat', new THREE.BufferAttribute(new Float32Array(LAT), 1));
  g.setIndex(idx);
  return g;
}
```

Implementer notes: `qRotate` exists in `vec.ts` (used by `damage.ts frame()`); confirm its argument order `(q, v)`. If a cap or scaled case fails by more than 1 mm, the culprit is almost always the orient convention — `sdPrimitive` rotates the QUERY by the conjugate about the midpoint, which equals rotating the PRIM by `q`; do not "fix" it by also rotating the scale. Winding: the test does not check it; Task 2's page check does (BackSide would show the tube inside-out under a plain colour).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/bone-tube-geom.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/bone-tube-geom.ts src/lab/sdf-zombie/webgpu/bone-tube-geom.test.ts
git commit -m "bones: tube geometry + CPU mirror, pinned to |sdPrimitive| < 1 mm on seven prim shapes"
```

---

### Task 2: The bone instancer — packing, WGSL vertex sweep, material

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/bone-instancer.ts`
- Test: `src/lab/sdf-zombie/webgpu/bone-instancer.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/bone-instancer.test.ts
import { describe, expect, it } from 'vitest';
import type { Primitive } from '../types';
import { packBoneInstances, INSTANCE_FLOATS, BONE_VERTEX_WGSL, BONE_SHADE_WGSL, boneInstanceArrays } from './bone-instancer';

const bone = (over: Partial<Primitive>): Primitive => ({
  a: [0, 0, 0], b: [0, 0.2, 0], radius: 0.02, scale: [1, 1, 1], blendK: 0,
  limb: 'torso', cluster: 1, op: 'bone', ...over,
});

describe('packBoneInstances', () => {
  it('packs bones only: organs, dead prims and dead clusters are skipped', () => {
    const arrays = boneInstanceArrays(8);
    const alive = [true, true, false];
    const n = packBoneInstances([
      bone({}),
      bone({ op: 'organ' }),
      bone({ dead: true }),
      bone({ cluster: 2 }),               // dead cluster
      bone({ b: [0.1, 0, 0], bend: [0, 0.02, 0], radiusB: 0.01, scale: [1.2, 1, 1] }),
    ], alive, arrays, 8);
    expect(n).toBe(2);
    // second instance: a, b, c, r, scale
    const o = INSTANCE_FLOATS;
    expect(Array.from(arrays.ab.subarray(o * 1, o * 1 + 6))).toEqual([0, 0, 0, 0.1, 0, 0]);
    expect(Array.from(arrays.ab.subarray(o * 1 + 6, o * 1 + 9))).toEqual([0.05, 0.02, 0]);
    expect(Array.from(arrays.ab.subarray(o * 1 + 9, o * 1 + 11))).toEqual([0.02, 0.01]);
    expect(Array.from(arrays.ab.subarray(o * 1 + 11, o * 1 + 14))).toEqual([1.2, 1, 1]);
    expect(Array.from(arrays.ab.subarray(o * 1 + 14, o * 1 + 18))).toEqual([0, 0, 0, 1]);
  });
  it('clamps at capacity and reports overflow', () => {
    const arrays = boneInstanceArrays(2);
    const n = packBoneInstances([bone({}), bone({}), bone({})], [true, true], arrays, 2);
    expect(n).toBe(2);
    expect(arrays.overflowed).toBe(true);
  });
  it('a chunk bone list (cluster 0, no alive table) packs by passing alive undefined', () => {
    const arrays = boneInstanceArrays(4);
    expect(packBoneInstances([bone({ cluster: 0 })], undefined, arrays, 4)).toBe(1);
  });
});

describe('WGSL parse contract', () => {
  for (const [name, src] of Object.entries({ BONE_VERTEX_WGSL, BONE_SHADE_WGSL })) {
    it(`${name} starts with fn and has no colon-in-comment in its signature`, () => {
      expect(src.startsWith('fn ')).toBe(true);
      const sig = src.slice(src.indexOf('('), src.indexOf(') ->') + 1);
      for (const line of sig.split('\n')) {
        const c = line.indexOf('//');
        if (c >= 0) expect(line.slice(c)).not.toMatch(/\w\s*:\s*\w/);
      }
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/bone-instancer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Instance layout is ONE interleaved float array of `INSTANCE_FLOATS = 18` per bone: `a(3) b(3) c(3) r1 r2 scale(3) orient(4)`, exposed to the shader as five `InstancedBufferAttribute` views over one `InterleavedBuffer`. (Interleaving keeps packing a single loop; `InstancedInterleavedBuffer` + `InterleavedBufferAttribute` is what three provides for exactly this.)

```ts
// src/lab/sdf-zombie/webgpu/bone-instancer.ts
//
// Bones as instanced tubes (spec 2026-09-02-bone-tubes-design.md). One unit
// tube (bone-tube-geom.ts) drawn once per posed bone prim, in the POLYGONAL
// pass on the default layer with depth write on. The SDF composite's depth
// test then hides bone under flesh and reveals it in cavities — no gate, no
// mask. The vertex program is the twin of tubePoint(); keep them in step.
import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  wgslFn, uniform, attribute, positionWorld, cameraPosition, vec3, vec4, float,
} from 'three/tsl';
import type { Primitive } from '../types';
import { boneInstanceOf, buildTubeGeometry } from './bone-tube-geom';

export const INSTANCE_FLOATS = 18;

export interface BoneInstanceArrays {
  ab: Float32Array;           // INSTANCE_FLOATS per instance
  overflowed: boolean;
}
export function boneInstanceArrays(max: number): BoneInstanceArrays {
  return { ab: new Float32Array(max * INSTANCE_FLOATS), overflowed: false };
}

/**
 * Pack posed bone prims into the instance array. `alive` is the body's
 * cluster-alive table (undefined for chunk lists, whose bones are all live).
 * Same filter as packBody's bone rows: op 'bone' only, not dead, cluster alive.
 */
export function packBoneInstances(
  prims: readonly Primitive[], alive: readonly boolean[] | undefined,
  out: BoneInstanceArrays, max: number,
): number {
  let n = 0;
  out.overflowed = false;
  for (const p of prims) {
    if (p.op !== 'bone' || p.dead) continue;
    if (alive && !alive[p.cluster]) continue;
    if (n >= max) { out.overflowed = true; break; }
    const s = boneInstanceOf(p);
    const o = n * INSTANCE_FLOATS;
    out.ab.set(s.a, o); out.ab.set(s.b, o + 3); out.ab.set(s.c, o + 6);
    out.ab[o + 9] = s.r1; out.ab[o + 10] = s.r2;
    out.ab.set(s.scale, o + 11); out.ab.set(s.orient, o + 14);
    n++;
  }
  return n;
}

/** Vertex sweep — the WGSL twin of tubePoint(). Returns world position in
 *  xyz; the normal is recomputed by boneNormal from the same inputs. */
export const BONE_VERTEX_WGSL = /* wgsl */ `fn boneVertex(t: f32, theta: f32, lat: f32, iA: vec3<f32>, iB: vec3<f32>, iC: vec3<f32>, iR: vec2<f32>, iScale: vec3<f32>, iQ: vec4<f32>, wantNormal: f32) -> vec3<f32> {
  let inv = 1.0 / iScale;
  let mid = (iA + iB) * 0.5;
  let A = qRotB(iQ, iA - mid) * inv + mid * inv;
  let B = qRotB(iQ, iB - mid) * inv + mid * inv;
  let C = qRotB(iQ, iC - mid) * inv + mid * inv;
  let sphere = dot(B - A, B - A) < 1e-18;
  let w0 = (1.0 - t) * (1.0 - t);
  let w1 = 2.0 * t * (1.0 - t);
  let w2 = t * t;
  let centre = A * w0 + C * w1 + B * w2;
  var tan = vec3<f32>(0.0, 1.0, 0.0);
  if (!sphere) {
    tan = normalize(2.0 * (1.0 - t) * (C - A) + 2.0 * t * (B - C));
  }
  let ref = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(tan.y) < 0.9);
  let u = normalize(cross(ref, tan));
  let v = cross(tan, u);
  let r = mix(iR.x, iR.y, t);
  var q = vec3<f32>(0.0);
  var nrm = vec3<f32>(0.0);
  if (lat < 0.0) {
    let ring = u * cos(theta) + v * sin(theta);
    q = centre + ring * r;
    nrm = ring;
  } else {
    let outDir = select(tan, -tan, t < 0.5);
    let ringW = cos(lat * 1.5707963);
    let rise = sin(lat * 1.5707963);
    let dir = (u * cos(theta) + v * sin(theta)) * ringW + outDir * rise;
    q = centre + dir * r;
    nrm = dir;
  }
  if (wantNormal > 0.5) {
    // normal of a scaled surface: n' = normalize(n / scale)
    return normalize(nrm * inv);
  }
  return q * iScale;
}
fn qRotB(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}`;

/** Lambert key + flashlight cone, the march's own formula (march.wgsl.ts
 *  ~2253-2290) on the same uniform values, minus wetness/scatter. */
export const BONE_SHADE_WGSL = /* wgsl */ `fn boneShade(p: vec3<f32>, n: vec3<f32>, camPos: vec3<f32>, boneColor: vec3<f32>, lightDir: vec3<f32>, keyColor: vec3<f32>, lightCfg: vec2<f32>, spotPos: vec3<f32>, spotAxis: vec3<f32>, spotCfg: vec4<f32>, spotCfg2: vec4<f32>, spotColor: vec3<f32>) -> vec3<f32> {
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
    L = normalize(mix(L, Ls, clamp(beam, 0.0, 1.0)));
    keyC = mix(keyColor, spotColor, clamp(beam, 0.0, 1.0));
    keyI = lightCfg.x * spotCfg2.z + beam * spotCfg2.x;
  }
  let V = normalize(camPos - p);
  let ndl = max(dot(n, L), 0.0);
  let H = normalize(L + V);
  let spec = pow(max(dot(n, H), 0.0), 24.0) * 0.12;
  let amb = lightCfg.y * keyColor;
  return boneColor * (amb + keyI * keyC * ndl) + keyC * keyI * spec;
}`;

export interface BoneInstancer {
  object: THREE.Mesh;
  uniforms: {
    boneColor: ReturnType<typeof uniform>; lightDir: ReturnType<typeof uniform>;
    keyColor: ReturnType<typeof uniform>; lightCfg: ReturnType<typeof uniform>;
    spotPos: ReturnType<typeof uniform>; spotAxis: ReturnType<typeof uniform>;
    spotCfg: ReturnType<typeof uniform>; spotCfg2: ReturnType<typeof uniform>;
    spotColor: ReturnType<typeof uniform>;
  };
  /** Replace this frame's bone set. Each entry is a posed prim list + its
   *  cluster-alive table (undefined for chunks). */
  update(sources: ReadonlyArray<{ prims: readonly Primitive[]; alive?: readonly boolean[] }>): void;
  readonly count: number;
  readonly overflowed: boolean;
  dispose(): void;
}

export function createBoneInstancer(max = 256): BoneInstancer {
  const base = buildTubeGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(base.getIndex());
  for (const name of ['position', 'tubeT', 'tubeTheta', 'tubeLat']) geo.setAttribute(name, base.getAttribute(name));
  const arrays = boneInstanceArrays(max);
  const ib = new THREE.InstancedInterleavedBuffer(arrays.ab, INSTANCE_FLOATS, 1);
  ib.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(ib, 3, 0));
  geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(ib, 3, 3));
  geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(ib, 3, 6));
  geo.setAttribute('iR', new THREE.InterleavedBufferAttribute(ib, 2, 9));
  geo.setAttribute('iScale', new THREE.InterleavedBufferAttribute(ib, 3, 11));
  geo.setAttribute('iQ', new THREE.InterleavedBufferAttribute(ib, 4, 14));
  geo.instanceCount = 0;

  const u = {
    boneColor: uniform(new THREE.Color(0.93, 0.89, 0.80)),
    lightDir: uniform(new THREE.Vector3(0.3, 0.8, 0.5)),
    keyColor: uniform(new THREE.Color(1, 0.95, 0.9)),
    lightCfg: uniform(new THREE.Vector2(2.4, 0.06)),
    spotPos: uniform(new THREE.Vector3()),
    spotAxis: uniform(new THREE.Vector3(0, 0, -1)),
    spotCfg: uniform(new THREE.Vector4(0, 0.93, 0.80, 16)),
    spotCfg2: uniform(new THREE.Vector4(4, 0.35, 0, 0)),
    spotColor: uniform(new THREE.Color(0.94, 0.96, 1.0)),
  };

  const vert = wgslFn(BONE_VERTEX_WGSL);
  const shade = wgslFn(BONE_SHADE_WGSL);
  const args = {
    t: attribute('tubeT', 'float'), theta: attribute('tubeTheta', 'float'), lat: attribute('tubeLat', 'float'),
    iA: attribute('iA', 'vec3'), iB: attribute('iB', 'vec3'), iC: attribute('iC', 'vec3'),
    iR: attribute('iR', 'vec2'), iScale: attribute('iScale', 'vec3'), iQ: attribute('iQ', 'vec4'),
  };
  const material = new MeshBasicNodeMaterial();
  material.positionNode = vert({ ...args, wantNormal: float(0) }) as never;
  material.normalNode = vert({ ...args, wantNormal: float(1) }) as never;
  material.colorNode = vec4(shade({
    p: positionWorld, n: material.normalNode, camPos: cameraPosition,
    boneColor: u.boneColor, lightDir: u.lightDir, keyColor: u.keyColor, lightCfg: u.lightCfg,
    spotPos: u.spotPos, spotAxis: u.spotAxis, spotCfg: u.spotCfg, spotCfg2: u.spotCfg2, spotColor: u.spotColor,
  }) as never, 1.0);
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.FrontSide;

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;   // instances are in world space; the mesh sits at the origin
  let count = 0;

  return {
    object: mesh,
    uniforms: u,
    update(sources) {
      let n = 0;
      arrays.overflowed = false;
      for (const s of sources) {
        const room = max - n;
        if (room <= 0) { arrays.overflowed = true; break; }
        const sub = boneInstanceArrays(0);
        sub.ab = arrays.ab.subarray(n * INSTANCE_FLOATS);
        n += packBoneInstances(s.prims, s.alive, sub, room);
        if (sub.overflowed) arrays.overflowed = true;
      }
      count = n;
      geo.instanceCount = n;
      ib.needsUpdate = true;
      mesh.visible = n > 0;
    },
    get count() { return count; },
    get overflowed() { return arrays.overflowed; },
    dispose() { geo.dispose(); base.dispose(); material.dispose(); },
  };
}
```

Implementer notes:
- `wgslFn` args are POSITIONAL against the WGSL signature when passed as an array, and by NAME when passed as an object (the repo's `createMarchMaterial` passes an object). Keep the object form and the exact parameter names.
- `normalNode` expects a world-space normal for `MeshBasicNodeMaterial`? It expects VIEW-space by default in three's lighting model, but `MeshBasicNodeMaterial` with a custom `colorNode` does not use it; we only feed it into our own `boneShade`. Do NOT rely on three's lights.
- If `attribute('iA','vec3')` fails to bind to the interleaved instanced attribute at pipeline creation, fall back to six plain `THREE.InstancedBufferAttribute`s over separate arrays (`packBoneInstances` writes into one array; split it in `update`). Note which form shipped.
- The mesh must render into the GAME's polygonal pass: it lives on layer 0 (default), which `sdf-layer.ts` pass 1 draws (`camera.layers.disable(SDF_LAYER)` only).

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/bone-instancer.test.ts && npx tsc --noEmit`
Expected: PASS (5 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/bone-instancer.ts src/lab/sdf-zombie/webgpu/bone-instancer.test.ts
git commit -m "bones: instancer — interleaved instance buffer, WGSL tube sweep, march-parity lighting"
```

---

### Task 3: `packBones` on the pack, the shader's dead bone branch, the containment message

**Files:**
- Modify: `src/lab/sdf-zombie/pack.ts` (PackOpts ~124-135; bone rows ~240-262)
- Modify: `src/lab/sdf-zombie/pack.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (~1011-1022 applyBones comment; ~1160 gate comment; ~2028-2050 shading; ~2308 wetness)
- Modify: `src/lab/sdf-zombie/validate.ts` (~521-535)

- [ ] **Step 1: Write the failing pack tests** (append to `pack.test.ts`; use its existing zombie/body fixture helper — grep the file for how it builds a body with bonePrims, and reuse it)

```ts
describe('packBones (bone tubes)', () => {
  it('default packs bones and organs exactly as before', () => {
    const body = bodyWithBonesAndOrgans();   // the file's existing fixture helper
    const a = packBody(body);
    const b = packBody(body, undefined, { packBones: true });
    expect(a.boneCount).toBe(b.boneCount);
    expect(Array.from(a.primScale)).toEqual(Array.from(b.primScale));
  });
  it('packBones:false skips bone rows, keeps organs, and boneCount counts organs', () => {
    const body = bodyWithBonesAndOrgans();
    const organs = (body.bonePrims ?? []).filter(p => p.op === 'organ' && body.clusters[p.cluster]?.alive).length;
    const p = packBody(body, undefined, { packBones: false });
    expect(p.boneCount).toBe(organs);
    for (let i = body.prims.length; i < body.prims.length + p.boneCount; i++) {
      expect(p.primScale[i * 4 + 3]).toBe(W_ORGAN);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/pack.test.ts -t packBones`
Expected: FAIL — `packBones` unknown / boneCount unchanged.

- [ ] **Step 3: Implement the pack flag**

In `PackOpts` add:

```ts
  /**
   * Write bone rows (op 'bone') into the inside-flesh array. Default TRUE —
   * the shipped layout. The bone-tubes renderer sets it FALSE: bones are
   * drawn as instanced tubes instead, so the wound-zone fold sees ORGANS only
   * and boneCount counts organs. Byte-identical rows when true.
   */
  packBones?: boolean;
```

and in the bone loop:

```ts
  const packBones = opts.packBones ?? true;
  (body.bonePrims ?? []).forEach((b, j) => {
    if (!body.clusters[b.cluster]?.alive) return;
    if (!packBones && b.op === 'bone') return;
    writePrim(b, body.prims.length + boneCount,
      b.dead ? W_DEAD : b.op === 'organ' ? W_ORGAN : W_BONE, restBones[j]);
    boneCount++;
  });
```

- [ ] **Step 4: Shader** — in `march.wgsl.ts`:

Remove the `isBone` albedo block (~2032-2043) and the `select(1.0, 0.25, isBone)` factor from the wetness line (~2308), leaving the organ branch intact. Update the comment above `APPLY_BONES` and at the gate to read: "the inside-flesh array: ORGANS, plus bones only when packBones is on (the shipped default until bone tubes ship)". Do not touch the loop or the gate.

Run the march contract tests: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl` — if any test greps for `isBone`, update it to assert the branch is GONE.

- [ ] **Step 5: Containment message** — in `validate.ts checkBoneContainment` replace the message tail with:

```ts
        `${BONE_CONTAINMENT_MARGIN}m inside the flesh — bone tubes are hidden by the ` +
        `flesh DEPTH alone, so a breaching bone shows through intact skin`);
```

- [ ] **Step 6: Run everything**

Run: `npx tsc --noEmit && npx vitest run src/lab`
Expected: clean and green.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/pack.ts src/lab/sdf-zombie/pack.test.ts src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/validate.ts
git commit -m "pack: packBones flag (default on); march drops the dead bone-albedo branch; containment message says why"
```

---

### Task 4: Views — `packBones` plumbing and `posedBones()` on chunks

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (`GpuViewOpts` ~1055; `createZombieGpuView` `upload()` ~1117-1170; `ChunkGpuView` ~1372; chunk `update()` bone rows ~1500-1520; `reset()` ~1552-1590)
- Test: `src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts` (or the nearest existing view test file — grep for `createChunkGpuView(` in tests)

- [ ] **Step 1: Write the failing test**

```ts
describe('bone tubes plumbing', () => {
  it('chunk view exposes posedBones in world space with squash applied, and skips bone rows when packBones is off', () => {
    const chunk = makeChunk('armL', [1, 2, 3], [0, 0, 0], 0.2, [0, 1, 0], () => 0.5, 'limb');
    const bone: Primitive = { a: [1, 2, 3], b: [1, 2.2, 3], radius: 0.02, scale: [1, 1, 1], blendK: 0, limb: 'armL', cluster: 2, op: 'bone' };
    const view = createChunkGpuView(chunk, [/* one flesh prim */ { ...bone, op: 'add', radius: 0.05 }], defaultUniforms(blankFaceTexture()), undefined, undefined, undefined, [bone]);
    view.setPackBones(false);
    view.update(chunk);
    const pb = view.posedBones();
    expect(pb.length).toBe(1);
    expect(pb[0]!.op).toBe('bone');
    // a is recentred on the chunk origin then re-placed at chunk.pos: identity at spawn
    expect(pb[0]!.a.map(v => +v.toFixed(6))).toEqual([1, 2, 3]);
    expect(view.uniforms.counts2.value.x).toBe(0);   // no bone rows
    view.setPackBones(true);
    view.update(chunk);
    expect(view.uniforms.counts2.value.x).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/zombie-gpu -t "bone tubes plumbing"`
Expected: FAIL — `setPackBones`/`posedBones` missing.

- [ ] **Step 3: Implement**

`GpuViewOpts`: add `packBones?: boolean` (default true). `createZombieGpuView`: keep `let packBones = opts.packBones ?? true;` and pass `{ packBones }` as the third arg of `packBody(next, rest, { packBones })` in `upload()`; add `setPackBones(on: boolean) { packBones = on; }` to the returned view and to the `ZombieGpuView` interface with a doc line. `counts2.x` already comes from `p.boneCount`, so it becomes the organ count automatically.

`createChunkGpuView`: same `packBones` local + `setPackBones`; in `reset()` pass `{ singleGroup: true, packBones }` to `packBody`; in `update()`'s per-frame bone-row loop, skip `p.op === 'bone'` rows when `!packBones` (organs still rewritten). Add:

```ts
    /** This frame's bone prims in WORLD space with the chunk's rotation + squash
     *  applied — what the bone instancer draws (bone-tubes spec §7). */
    posedBones(): Primitive[] {
      const { sx, sy, sz } = squashFactors(current);
      return localBones.filter(p => p.op === 'bone').map(p => ({
        ...p,
        a: chunkPoint(current, p.a, sx, sy, sz),
        b: chunkPoint(current, p.b, sx, sy, sz),
        scale: [p.scale[0] * sx, p.scale[1] * sy, p.scale[2] * sz] as Vec3,
        // bend rides the endpoints: recompute its control displacement in world
        bend: p.bend ? sub(chunkPoint(current, bendCtrl(p.a, p.b, p.bend), sx, sy, sz),
                           bendCtrl(chunkPoint(current, p.a, sx, sy, sz), chunkPoint(current, p.b, sx, sy, sz))) : undefined,
      }));
    },
```

where `current` is the chunk state the view last received in `update()`/`reset()` (add a `let current: Chunk` if the file does not keep one). Add `posedBones(): Primitive[]` and `setPackBones(on: boolean): void` to `ChunkGpuView`.

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/zombie-gpu && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts
git commit -m "views: packBones plumbing on body and chunk views; chunk posedBones() for the instancer"
```

---

### Task 5: Game wiring, the seam, and the first look on the page

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (instancer creation near `createOuterHull()` ~659; per-frame feed after actors step ~1685 and chunks step ~1811; flashlight uniform loop ~517-524; seam object ~2650)

- [ ] **Step 1: Wire it**

Near the outer hull creation:

```ts
  const boneInstancer = createBoneInstancer(256);
  boneInstancer.object.layers.set(0);          // the polygonal pass draws layer 0
  scene.add(boneInstancer.object);
  let boneMesh = false;                        // ships OFF until the owner's gate
  function applyBoneMesh(on: boolean) {
    boneMesh = on;
    boneInstancer.object.visible = on;
    for (const a of actors) a.view.setPackBones(!on);
    for (const c of liveChunks) c.view.setPackBones(!on);
  }
```

In the flashlight loop (`for (const a of actors) { a.view.uniforms.spotPos... }`) also copy into the instancer once per frame:

```ts
      boneInstancer.uniforms.spotPos.value.copy(flashlight.spot.position);
      boneInstancer.uniforms.spotAxis.value.copy(sAxis);
      boneInstancer.uniforms.spotCfg.value.set(spotOn, cosInner, cosOuter, flashlight.spot.distance);
      boneInstancer.uniforms.spotColor.value.copy(flashlight.spot.color);
      boneInstancer.uniforms.spotCfg2.value.set(beamTuning.gain, beamTuning.shoulder, beamTuning.keyFloor, 0);
```

and once at boot, after the light preset is applied to the first view, copy `lightDir`, `keyColor`, `lightCfg`, `boneColor` from `actors[0].view.uniforms` (or from the preset object directly) into `boneInstancer.uniforms`.

After actors and chunks have stepped for the frame (just before `sdfLayer.render` is called):

```ts
      if (boneMesh) {
        boneInstancer.update([
          ...actors.map(a => { const p = a.posed(); return { prims: p.bonePrims ?? [], alive: p.clusters.map(c => c.alive) }; }),
          ...liveChunks.map(c => ({ prims: c.view.posedBones() })),
        ]);
      }
```

New views (actor spawn, chunk spawn) call `view.setPackBones(!boneMesh)` right after creation. Seams on `__sdfGame`:

```ts
    setBoneMesh: (on: boolean) => applyBoneMesh(on),
    get boneMesh() { return boneMesh; },
    boneTubes: () => ({ count: boneInstancer.count, overflowed: boneInstancer.overflowed }),
```

Log build errors at actor spawn: `if (body.errors.length) console.warn('[blud] body errors', body.errors);` next to where the zombie body is built.

- [ ] **Step 2: tsc + suite**

Run: `npx tsc --noEmit && npx vitest run src/lab`
Expected: clean, green.

- [ ] **Step 3: Boot and look**

Start the dev server and open `http://localhost:<port>/sdf-game.html`. In the console:

```js
__sdfGame.setBoneMesh(true); __sdfGame.boneTubes()
```

Expected: `count` ≈ 17–25 per live zombie on screen (zombie: 23 authored bones minus none; goblin 3 + derived), `overflowed: false`. Then `__sdfGame.aimSurface(); __sdfGame.fireSlug()` at a torso: ribs/sternum visible inside the crater, NOT visible through intact skin anywhere. Toggle `setBoneMesh(false)` and compare: the same bones through the field. If the tube shows inside-out (dark, facing away) the index winding is reversed — flip the two triangle orders in `buildTubeGeometry` and re-run Task 1's tests (they do not test winding; this page check does).

If bone shows through intact skin anywhere on the zombie, STOP and report the location: that is a containment breach and a gate failure by spec §8.

- [ ] **Step 4: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game: bone instancer wired — setBoneMesh seam (ships off), per-frame feed from actors and chunks"
```

---

### Task 6: The reel, the counter gate, notes, TASKS

**Files:**
- Create: `scripts/bone-tubes-reel.sh`
- Create: `docs/dev-notes/2026-09-02-bone-tubes/notes.md`
- Modify: `TASKS.md`

- [ ] **Step 1: The reel script**

```bash
#!/usr/bin/env bash
# scripts/bone-tubes-reel.sh — the owner's three A/B captures (spec §8): field bones
# (off) vs tube bones (on) on the same frozen game scene, via perf-r2-parity.mjs.
# Usage: scripts/bone-tubes-reel.sh <outDir>
set -euo pipefail
OUT=${1:?outDir}
export LAB_VITE_PORT=${LAB_VITE_PORT:-5299} LAB_CDP_PORT=${LAB_CDP_PORT:-9299}
ON="__sdfGame.setBoneMesh(true)"; OFF="__sdfGame.setBoneMesh(false)"
# 1. torso crater: ribs + sternum
scripts/perf-r2-parity.sh capture "$OUT/1-torso" --room 3 --on "$ON" --off "$OFF" \
  --pre "__sdfGame.aimSurface(); __sdfGame.fireSlug()"
# 2. head shot: cranium + jaw  (aimHead is a seam to add if aimSurface cannot target the head: aim at the head cluster centre)
scripts/perf-r2-parity.sh capture "$OUT/2-head" --room 3 --on "$ON" --off "$OFF" \
  --pre "__sdfGame.aimHead(); __sdfGame.fireSlug()"
# 3. severed arm chunk on the floor
scripts/perf-r2-parity.sh capture "$OUT/3-chunk" --room 3 --on "$ON" --off "$OFF" \
  --pre "__sdfGame.aimSurface('armL'); __sdfGame.fireSlug(); __sdfGame.fireSlug(); await new Promise(r=>setTimeout(r, 1500))"
echo "reel in $OUT — a-*.png = tubes, b-*.png = field; the owner's eye is the gate; ANY bone through intact skin fails"
```

If `aimSurface` takes no limb argument today, add an optional `limb` parameter (aim at that cluster's centre via the same CPU-field march it uses) and an `aimHead()` alias — both are small additions beside the existing seam in `game-main.ts`.

- [ ] **Step 2: Run the reel and the counter**

```bash
scripts/bone-tubes-reel.sh docs/dev-notes/2026-09-02-bone-tubes/reel
node scripts/sdf-game-organs-boneevals.mjs   # the organs note's 12-slug recipe; run with setBoneMesh(true) and (false)
```

The counter run must report bone capsule evaluations at ZERO with tubes on (only organ prims remain in the array — read the note's `bonesTotal` and divide by the organ share, or add a `setBoneMesh(true)` leg to the script if it lacks one). Record both legs.

- [ ] **Step 3: Notes**

```markdown
# Bone tubes — notes

**Date:** 2026-09-02 · **Spec:** ../../superpowers/specs/2026-09-02-bone-tubes-design.md · **Plan:** ../../superpowers/plans/2026-09-02-bone-tubes.md · **Branch:** claude/bone-tubes

## What was built
<instancer, packBones, views, seams; which instanced-attribute form shipped (interleaved or split); any winding flip>

## Tube-vs-field agreement
<Task 1 worst |sdPrimitive| per case, from the test output>

## Counter gate (12-slug recipe, `__sdfGame.boneEvals()`)
| leg | bonesTotal | meanPerPayingRay | paying px |
| --- | --- | --- | --- |
| field bones (off) | | | |
| tubes (on) — organs only remain | | | |

## Reel (owner judges)
1-torso / 2-head / 3-chunk: a-1 (tubes) vs b-1 (field), changed-pixel %, hot cells.
Bone through intact skin anywhere: <none seen / WHERE>.

## Verdict
_pending owner_
```

- [ ] **Step 4: TASKS row** — replace the BONE TUBES paragraph's status with: built, counter numbers, reel captured, **awaiting owner verdict**, seams (`__sdfGame.setBoneMesh / boneTubes`), default OFF.

- [ ] **Step 5: Commit and checkpoint**

```bash
git add scripts/bone-tubes-reel.sh docs/dev-notes/2026-09-02-bone-tubes TASKS.md src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "bones: reel script, counter gate numbers, notes — awaiting owner verdict"
source ~/.claude/hooks/dualmem-env.sh
~/go/bin/dualmem checkpoint --task "bone tubes (skeleton out of the field)" --status in_progress --files "src/lab/sdf-zombie/webgpu/bone-instancer.ts,src/lab/sdf-zombie/webgpu/bone-tube-geom.ts,src/lab/sdf-zombie/pack.ts,src/lab/sdf-zombie/webgpu/game-main.ts" --done "built; counter <numbers>; reel captured" --remaining "owner look verdict; flip default ON if pass"
```

- [ ] **Step 6: Stop.** The owner judges the reel and decides whether `boneMesh` ships ON.

---

## Dispatch notes

- Four dispatch tasks, `model: kimi/k3:high`, `harness: pi`, `status: pending`, `base_branch: claude/bone-tubes`, `max_runtime: 90m`, `allowed_tools: Edit,Write,Bash,Read,Glob,Grep`.
- **Parallelism:** dispatch A = plan Task 1 + 2 (new files only); dispatch B = plan Task 3 + 4 (pack, shader, validate, views) — A and B touch disjoint files and run in PARALLEL with `depends_on: []`. Dispatch C = Task 5 (`depends_on: [A, B]`). Dispatch D = Task 6 (`depends_on: [C]`).
- `kimi/k3` has vision: in C and D the agent must `Read` its captures and say in one sentence what it saw; never paraphrase the expectation.
- Every dispatch ends with `npx tsc --noEmit && npx vitest run src/lab` output pasted verbatim.

## Self-review against the spec

- §3 data flow → Tasks 2 (instancer), 3 (pack skip), 4 (views), 5 (feed). ✔
- §4 tube: rings/segs/caps, per-instance fields, vertex sweep in scaled space with orient, normal via 1/scale, own material with the march's key+spot formula, no stain → Tasks 1, 2. ✔
- §5 slot + soundness + half-rate → Task 5 (layer 0, pass 1), Task 3 (containment message; already an error). ✔
- §6 field/pack changes: packBones flag, organs stay, isBone branch removed, counters → Task 3. ✔
- §7 chunks (`posedBones`), stumps (unchanged filter), one instancer per page, seam, lab → Tasks 4, 5; lab dropped per deviation 1. ✔
- §8 gates + tests: pack (3 assertions), instancer packing + overflow, tube CPU mirror < 1 mm, containment message, WGSL parse → Tasks 1–3; reel + counter → Task 6. ✔
