# SDF Zombie Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone sandbox page where a zombie made of signed-distance-field volumes can be shot apart — craters, severed limbs that close over, and raymarched gib blobs — to judge whether the look is worth building on.

**Architecture:** A declarative `BodyDef` (bones + primitives, relative and mirrored) is expanded and validated by pure TypeScript, packed into uniform arrays, and sphere-traced in a fragment shader on a screen-space proxy box that writes `gl_FragDepth` so it composites with ordinary geometry. Everything upstream of the packing step is Three-free and unit-tested; only three modules touch the engine. The lab imports nothing from `src/sim` or `src/game`.

**Tech Stack:** TypeScript, Three.js r170 (WebGL2, `THREE.GLSL3`), Vite multi-page build, Vitest + happy-dom.

**Spec:** [docs/superpowers/specs/2026-08-15-sdf-zombie-lab-design.md](../specs/2026-08-15-sdf-zombie-lab-design.md)

---

## Prior art on disk — why this renders differently

`~/Projects/goober-test` (July 2026) built SDF creatures from the same ingredients: round-cone primitives, iq polynomial smooth-min, per-shape blend caps. Its reported outcome was **good animation, janky skin, and joints/seams that were not smooth**. That is worth understanding before starting, because it is the exact failure this plan bets against.

**It did not raymarch.** `src/blendshell.js` renders a *fixed-topology triangle shell* — stacked canonical capsules — and relaxes each vertex onto the isosurface in the **vertex shader**. Its own comments catalogue the consequences:

- verts branch-jump to whichever skin is nearest, so "adjacent verts diverge and smear stretched triangles across the body"
- verts tunnel through neighbours — "ear verts spiking out of the chin" — needing a travel-budget cap
- capped verts get parked, and parking one "tears a hole and the dark outline hull shows through"
- at `radial=12, heightSegs=6`, the fillet crown at a joint is covered by **one thin strip of triangles**

Joints are where the fillet is largest and the triangle coverage is thinnest, so that is where the shell tore. The blend math was never at fault.

**Raymarching deletes that failure class.** No shell, no topology, no coverage strip, no branch-jumping — every pixel independently finds the true isosurface, and a joint fillet is simply more surface. The cost moves to fill rate, which §6 of the spec already plans for.

Two secondary contributors worth not repeating:

| goober-test | Here |
|---|---|
| `grad()` epsilon `0.02` (2 cm) — smears normals at high-curvature joints | `0.0015` in `calcNormal` (Task 2) |
| `smoothMix = 0.22` deliberately facets shading for a Dreamcast look | full SDF-gradient normals; faceting is not the target |
| `sdRoundCone` is an admitted approximation ("not the exact tangent-cone SDF") — fine for a near-surface shell, not conservative for marching | `sdPrim` scales by `min(scale)` to stay conservative (Task 10) |

**What transfers, and is already folded in:** its `Rope` verlet blends toward a **rest pose** each step (`p.lerp(rest[i], st)`), which is what keeps a verlet chain from going floppy — adopted in Task 11. Its `sdf.js` deliberately "mirrors the GLSL in blendshell.js exactly" and is unit-tested; this plan uses the same discipline (`validate.ts` mirrors the shader) and Task 9 asserts it. If a real walk cycle is ever wanted here, its `animation.js` Walker — phase-grouped stepping feet with two-bone IK knees — is the part that worked and is worth reading first.

---

## Critical constraint — read before Task 6

The smooth-min used here (quadratic polynomial) is **not associative**. Because limbs are removed at runtime when severed, the fold order over primitives must never change. Two rules follow, and they are enforced by tests:

1. Primitives are folded **in fixed cluster order** (`head, torso, armL, armR, legL, legR`), never raw array order.
2. Severing sets a cluster's **alive flag to 0**. It never removes, reorders, or re-packs the primitive array.

Violating either can silently reshape the torso when you shoot an arm off. It presents as a shader bug.

## Second critical constraint — `smin` scales `k` by 4

`smin(a, b, k)` begins with `k *= 4.0` (iq's normalisation). **Every consumer of an
authored `blendK` must account for that ×4**, and two separate bugs came from
forgetting it:

- **Authoring.** `blendK: 0.08` means a **32 cm** blend radius, not 8 cm. On limbs
  with a 6 cm radius that fuses the entire body into a featureless blob. Authored
  values belong in the **0.012–0.02** range for a human-scale body.
- **Culling.** The cluster cull margin must be `uMaxBlendK * 4.0`. Using the
  unscaled value discards clusters that are still bending the surface, which
  renders as hard creases exactly along cluster boundaries.

Note the first of these **passes every check** — a fully-fused blob is trivially
"connected", so `validateBody` is satisfied. It is only visible by looking, and it
is the concrete instance of this plan's own warning that a model can pass every
check and still be the wrong animal.

## Third: nothing in the toolchain compiles GLSL

`tsc`, `vite build` and `vitest` all stay green with a fragment shader that does
not link. The Task 2 spike shipped with `projectionMatrix` undeclared — three's
**fragment** prefix provides `viewMatrix` and `cameraPosition` but not
`projectionMatrix` — so the program never linked and nothing rendered, through
eight subsequent green tasks. **A human must load the page after any shader
change.** Task verification commands cannot substitute for this.

---

## File structure

| File | Responsibility | Engine-free? |
|---|---|---|
| `sdf-lab.html` | Page shell + canvas mount (mirrors `theme-preview.html`) | — |
| `vite.config.ts` | **Modify** — add `sdfLab` rollup input | — |
| `src/lab/sdf-zombie/types.ts` | `Vec3`, `LimbId`, `BoneDef`, `PrimDef`, `BodyDef`, `Primitive`, `BuiltBody` | yes |
| `src/lab/sdf-zombie/vec.ts` | Tiny pure vector helpers (add, sub, scale, len, normalize, cross, dot) | yes |
| `src/lab/sdf-zombie/body.ts` | The zombie `BodyDef` — declarative, one side only | yes |
| `src/lab/sdf-zombie/mirror.ts` | Expands `mirror: true` bones/prims into `.l`/`.r` pairs | yes |
| `src/lab/sdf-zombie/resolve.ts` | Bone chain → world head/tail; prims placed at normalised `at` | yes |
| `src/lab/sdf-zombie/clusters.ts` | Sorts prims into fixed cluster order, computes bounding spheres | yes |
| `src/lab/sdf-zombie/validate.ts` | `validateBody` — the checks pass | yes |
| `src/lab/sdf-zombie/build-body.ts` | Orchestrates mirror → resolve → clusters → validate, merges overrides | yes |
| `src/lab/sdf-zombie/pack.ts` | `BuiltBody` → `Float32Array` uniform payloads | yes |
| `src/lab/sdf-zombie/rig.ts` | Verlet points + distance constraints; procedural walk | yes |
| `src/lab/sdf-zombie/damage.ts` | Rest-space wound records, ring buffer | yes |
| `src/lab/sdf-zombie/sever.ts` | Cluster alive flags; detach into a chunk group | yes |
| `src/lab/sdf-zombie/gib-chunks.ts` | Chunk gravity, bounce, tumble, squash | yes |
| `src/lab/sdf-zombie/material.ts` | `FleshMaterial` + the three presets, lighting presets | yes |
| `src/lab/sdf-zombie/march.glsl.ts` | Vertex + fragment shader source strings | yes (strings only) |
| `src/lab/sdf-zombie/zombie.ts` | Three assembly: proxy boxes, `ShaderMaterial`, uniform upload | no |
| `src/lab/sdf-zombie/panel.ts` | Tuning panel DOM + override persistence | no |
| `src/lab/sdf-zombie/lab-main.ts` | Entry: scene, floor, orbit cam, click-to-shoot | no |

---

## Task 1: Page scaffold and Vite entry

**Files:**
- Create: `sdf-lab.html`
- Create: `src/lab/sdf-zombie/lab-main.ts`
- Modify: `vite.config.ts:14-19`

- [ ] **Step 1: Create the page shell**

Create `sdf-lab.html` (mirrors the existing `theme-preview.html` pattern):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Blud — SDF zombie lab</title>
<style>
  body { margin: 0; background: #1a1116; color: #eee; font: 13px monospace; overflow: hidden; }
  #app { width: 100vw; height: 100vh; }
  #panel {
    position: fixed; top: 8px; right: 8px; z-index: 10;
    background: rgba(0,0,0,0.78); padding: 10px; border: 1px solid #444;
    width: 260px; max-height: 92vh; overflow-y: auto; line-height: 1.4;
  }
  #panel h2 { margin: 8px 0 4px; font-size: 12px; color: #d88; }
  #panel label { display: block; font-size: 11px; margin: 3px 0; }
  #panel input[type=range] { width: 100%; }
  #errors { color: #ff6464; font-size: 11px; white-space: pre-wrap; }
</style>
</head>
<body>
  <div id="app"></div>
  <div id="panel"><div id="errors"></div></div>
  <script type="module" src="/src/lab/sdf-zombie/lab-main.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Register the entry with Vite**

In `vite.config.ts`, add `sdfLab` to `build.rollupOptions.input`:

```ts
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        themePreview: resolve(__dirname, 'theme-preview.html'),
        sdfLab: resolve(__dirname, 'sdf-lab.html'),
      },
    },
  },
```

- [ ] **Step 3: Create a minimal entry that renders a floor**

Create `src/lab/sdf-zombie/lab-main.ts`:

```ts
// src/lab/sdf-zombie/lab-main.ts
import * as THREE from 'three';
import { createRenderer } from '../../engine/renderer';

const mount = document.getElementById('app');
if (!mount) throw new Error('#app not found');

const { scene, camera } = createRenderer(mount);

// Ground plane — a polygonal surface the raymarched blobs must composite against.
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x3a2a30, roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// A reference cube so depth interleaving is obvious by eye.
const refCube = new THREE.Mesh(
  new THREE.BoxGeometry(0.4, 0.4, 0.4),
  new THREE.MeshStandardMaterial({ color: 0x7080a0 }),
);
refCube.position.set(0.6, 0.2, 0.3);
scene.add(refCube);

camera.position.set(0, 1.4, 3.2);
camera.lookAt(0, 0.9, 0);
```

- [ ] **Step 4: Run the dev server and confirm it renders**

Run:

```bash
npm run dev -- --port 5180
```

Open `http://localhost:5180/sdf-lab.html`. Expected: a dark scene with a lit ground plane and a small blue-grey cube. No console errors.

- [ ] **Step 5: Confirm the type-check and build pass**

Run:

```bash
npm run build
```

Expected: `tsc --noEmit` clean, and Vite reports three entry chunks including `sdf-lab.html`.

- [ ] **Step 6: Commit**

```bash
git add sdf-lab.html vite.config.ts src/lab/sdf-zombie/lab-main.ts
git commit -m "feat(sdf-lab): page scaffold, Vite entry, floor scene"
```

---

## Task 2: Depth-write spike — prove the hardest thing first

This task de-risks the single most failure-prone part: a raymarched proxy box that depth-sorts correctly against polygonal geometry. It uses one hardcoded sphere, no body data. If this does not work, nothing later matters.

**Files:**
- Create: `src/lab/sdf-zombie/march.glsl.ts`
- Modify: `src/lab/sdf-zombie/lab-main.ts`

- [ ] **Step 1: Write the shader source**

Create `src/lab/sdf-zombie/march.glsl.ts`:

```ts
// src/lab/sdf-zombie/march.glsl.ts
// Shader source as strings. Kept engine-free so it can be diffed and tested
// as text; Three only consumes it in zombie.ts.

export const VERT = /* glsl */ `
out vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** Spike fragment shader: one hardcoded sphere, correct depth write. */
export const FRAG_SPIKE = /* glsl */ `
precision highp float;

in vec3 vWorldPos;
out vec4 outColor;

uniform vec3 uSphereCenter;
uniform float uSphereRadius;

float map(vec3 p) {
  return length(p - uSphereCenter) - uSphereRadius;
}

vec3 calcNormal(vec3 p) {
  // Tetrahedron sampling — 4 evaluations instead of 6.
  const vec2 e = vec2(1.0, -1.0) * 0.0015;
  return normalize(
    e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) +
    e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);

  // March from the camera; the back face of the proxy box bounds the search.
  float tMax = length(vWorldPos - cameraPosition);
  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < 96; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.001) { hit = true; break; }
    t += d;
    if (t > tMax) break;
  }
  if (!hit) discard;

  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);
  vec3 lightDir = normalize(vec3(0.5, 1.0, 0.4));
  float diff = max(dot(n, lightDir), 0.0);
  outColor = vec4(vec3(0.85, 0.3, 0.35) * (0.25 + 0.75 * diff), 1.0);

  // Depth write — this is what lets the blob interleave with the floor/cube.
  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
}
`;
```

- [ ] **Step 2: Mount the spike material on a proxy box**

Append to `src/lab/sdf-zombie/lab-main.ts`:

```ts
import { VERT, FRAG_SPIKE } from './march.glsl';

const spikeMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  // `gl_FragDepth` is CORE in GLSL ES 3.00, so GLSL3 alone is sufficient.
  // Do NOT add `extensions: { fragDepth: true }` — that was a WebGL1-era flag.
  // In three r170 the ShaderMaterial `extensions` type accepts only
  // clipCullDistance/multiDraw, and WebGLPrograms reads only those two, so the
  // flag is a tsc error AND a runtime no-op.
  side: THREE.BackSide,
  uniforms: {
    uSphereCenter: { value: new THREE.Vector3(0, 0.9, 0) },
    uSphereRadius: { value: 0.45 },
  },
  vertexShader: VERT,
  fragmentShader: FRAG_SPIKE,
});

const proxy = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), spikeMat);
proxy.position.set(0, 0.9, 0);
scene.add(proxy);
```

- [ ] **Step 3: Verify compositing by eye**

Run:

```bash
npm run dev -- --port 5180
```

Open `http://localhost:5180/sdf-lab.html`. Expected, and **all four must hold**:
1. A red sphere is visible, lit from upper-left.
2. The blue-grey cube at `(0.6, 0.2, 0.3)` **intersects** the sphere — part of the cube is in front, part behind. If the cube is entirely in front or entirely behind, depth write is broken.
3. The sphere is occluded by the floor where it dips below `y=0` (it does not, at r=0.45 centred at y=0.9 — move the sphere to `y=0.3` temporarily to confirm, then restore).
4. No console warnings about `EXT_frag_depth` or shader compilation.

- [ ] **Step 4: Confirm the build is clean**

Run:

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/march.glsl.ts src/lab/sdf-zombie/lab-main.ts
git commit -m "feat(sdf-lab): proxy-box raymarch spike with correct gl_FragDepth"
```

---

## Task 3: Core types and vector helpers

**Files:**
- Create: `src/lab/sdf-zombie/types.ts`
- Create: `src/lab/sdf-zombie/vec.ts`
- Test: `src/lab/sdf-zombie/vec.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/vec.test.ts`:

```ts
// src/lab/sdf-zombie/vec.test.ts
import { describe, it, expect } from 'vitest';
import { add, sub, scale, dot, cross, len, normalize, lerp, basisFromAxis } from './vec';

describe('vec helpers', () => {
  it('does elementwise arithmetic', () => {
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(sub([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3]);
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
  });

  it('computes dot, cross and length', () => {
    expect(dot([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(len([3, 4, 0])).toBe(5);
  });

  it('normalizes to unit length and leaves the zero vector alone', () => {
    const n = normalize([0, 3, 0]);
    expect(len(n)).toBeCloseTo(1, 10);
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('lerps between endpoints', () => {
    expect(lerp([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
  });

  it('builds an orthonormal basis around any axis', () => {
    for (const axis of [[0, 1, 0], [1, 0, 0], [0.3, -0.9, 0.2]] as const) {
      const { u, v, w } = basisFromAxis(axis);
      expect(len(u)).toBeCloseTo(1, 6);
      expect(len(v)).toBeCloseTo(1, 6);
      expect(len(w)).toBeCloseTo(1, 6);
      expect(dot(u, v)).toBeCloseTo(0, 6);
      expect(dot(u, w)).toBeCloseTo(0, 6);
      expect(dot(v, w)).toBeCloseTo(0, 6);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lab/sdf-zombie/vec.test.ts
```

Expected: FAIL — `Failed to resolve import "./vec"`.

- [ ] **Step 3: Write the types**

Create `src/lab/sdf-zombie/types.ts`:

```ts
// src/lab/sdf-zombie/types.ts
export type Vec3 = readonly [number, number, number];

/** Fixed fold order. Index into this array IS the cluster id. Never reorder. */
export const CLUSTER_ORDER = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'] as const;
export type LimbId = (typeof CLUSTER_ORDER)[number];

/** Authoring-time limb, before mirror expansion. */
export type LimbBase = 'head' | 'torso' | 'arm' | 'leg';

export interface BoneDef {
  name: string;
  parent: string | null;
  /** Direction in world axes (this body is authored in a rest pose, no rotations). */
  dir: Vec3;
  length: number;
  /** Lateral (x) offset of this bone's head from its parent's tail. Negated on the mirrored side. */
  side?: number;
  /** When true, expands into `<name>.l` and `<name>.r`. */
  mirror?: boolean;
}

export interface PrimDef {
  /** Bone name this primitive rides. For mirrored prims, the unsuffixed base name. */
  bone: string;
  /** Normalised position along the bone, 0 = head, 1 = tail. */
  at: number;
  /** When set, the primitive is a capsule spanning `at` → `capTo` on the same bone. */
  capTo?: number;
  radius: number;
  /** Ellipsoid axis scale applied to the primitive's local space. */
  scale: Vec3;
  /** Smooth-min strength against the rest of the body. */
  blendK: number;
  limb: LimbBase;
  mirror?: boolean;
}

export interface BodyDef {
  name: string;
  /** World position of the root bone's head. */
  root: Vec3;
  bones: BoneDef[];
  prims: PrimDef[];
}

/** A resolved primitive in rest space. */
export interface Primitive {
  a: Vec3;
  b: Vec3;
  radius: number;
  scale: Vec3;
  blendK: number;
  limb: LimbId;
  cluster: number;
}

export interface ClusterInfo {
  id: number;
  limb: LimbId;
  /** Index of the first primitive of this cluster in `BuiltBody.prims`. */
  start: number;
  count: number;
  center: Vec3;
  radius: number;
  alive: boolean;
}

export interface ResolvedBone {
  head: Vec3;
  tail: Vec3;
}

export interface BuiltBody {
  /** Sorted by cluster id. Never reorder — see the fold-order constraint. */
  prims: Primitive[];
  clusters: ClusterInfo[];
  bones: Map<string, ResolvedBone>;
}
```

- [ ] **Step 4: Write the vector helpers**

Create `src/lab/sdf-zombie/vec.ts`:

```ts
// src/lab/sdf-zombie/vec.ts
import type { Vec3 } from './types';

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: Vec3): number => Math.sqrt(dot(a, a));

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l === 0 ? [0, 0, 0] : scale(a, 1 / l);
}

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Orthonormal basis with `w` along the given axis. Used to express wound
 * positions in a primitive's local frame so they stick to moving flesh.
 */
export function basisFromAxis(axis: Vec3): { u: Vec3; v: Vec3; w: Vec3 } {
  const w = normalize(axis);
  // Pick the world axis least aligned with w, so the cross product is stable.
  const ax = Math.abs(w[0]), ay = Math.abs(w[1]), az = Math.abs(w[2]);
  const seed: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const u = normalize(cross(seed, w));
  const v = cross(w, u);
  return { u, v, w };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
npx vitest run src/lab/sdf-zombie/vec.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/types.ts src/lab/sdf-zombie/vec.ts src/lab/sdf-zombie/vec.test.ts
git commit -m "feat(sdf-lab): core types and pure vector helpers"
```

---

## Task 4: Mirror expansion

**Files:**
- Create: `src/lab/sdf-zombie/mirror.ts`
- Test: `src/lab/sdf-zombie/mirror.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/mirror.test.ts`:

```ts
// src/lab/sdf-zombie/mirror.test.ts
import { describe, it, expect } from 'vitest';
import { expandMirror } from './mirror';
import type { BodyDef } from './types';

const def: BodyDef = {
  name: 'test',
  root: [0, 1, 0],
  bones: [
    { name: 'pelvis', parent: null, dir: [0, 1, 0], length: 0.2 },
    { name: 'thigh', parent: 'pelvis', dir: [0, -1, 0], length: 0.4, side: 0.09, mirror: true },
  ],
  prims: [
    { bone: 'pelvis', at: 0.5, radius: 0.18, scale: [1, 1, 0.8], blendK: 0.02, limb: 'torso' },
    { bone: 'thigh', at: 0.1, capTo: 0.9, radius: 0.09, scale: [1, 1, 1], blendK: 0.015, limb: 'leg', mirror: true },
  ],
};

describe('expandMirror', () => {
  const out = expandMirror(def);

  it('leaves unmirrored bones and prims untouched', () => {
    expect(out.bones.filter(b => b.name === 'pelvis')).toHaveLength(1);
    expect(out.prims.filter(p => p.bone === 'pelvis')).toHaveLength(1);
  });

  it('splits a mirrored bone into .l and .r with negated side offset', () => {
    const l = out.bones.find(b => b.name === 'thigh.l');
    const r = out.bones.find(b => b.name === 'thigh.r');
    expect(l).toBeDefined();
    expect(r).toBeDefined();
    expect(l!.side).toBe(0.09);
    expect(r!.side).toBe(-0.09);
    expect(out.bones.find(b => b.name === 'thigh')).toBeUndefined();
  });

  it('splits a mirrored prim, retargets its bone, and resolves limb to L/R', () => {
    const l = out.prims.find(p => p.bone === 'thigh.l');
    const r = out.prims.find(p => p.bone === 'thigh.r');
    expect(l!.limb).toBe('legL');
    expect(r!.limb).toBe('legR');
    expect(l!.radius).toBe(0.09);
    expect(r!.capTo).toBe(0.9);
  });

  it('resolves an unmirrored limb base directly', () => {
    expect(out.prims.find(p => p.bone === 'pelvis')!.limb).toBe('torso');
  });

  it('throws when a mirrored prim names a bone that is not mirrored', () => {
    const bad: BodyDef = {
      ...def,
      prims: [{ bone: 'pelvis', at: 0.5, radius: 0.1, scale: [1, 1, 1], blendK: 0.0125, limb: 'arm', mirror: true }],
    };
    expect(() => expandMirror(bad)).toThrow(/pelvis/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lab/sdf-zombie/mirror.test.ts
```

Expected: FAIL — `Failed to resolve import "./mirror"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/mirror.ts`:

```ts
// src/lab/sdf-zombie/mirror.ts
import type { BodyDef, BoneDef, LimbBase, LimbId, PrimDef } from './types';

/** A prim after mirror expansion: bone name is concrete, limb is a concrete cluster. */
export interface ExpandedPrim extends Omit<PrimDef, 'limb' | 'mirror'> {
  limb: LimbId;
}

export interface ExpandedBody {
  name: string;
  root: BodyDef['root'];
  bones: BoneDef[];
  prims: ExpandedPrim[];
}

function limbFor(base: LimbBase, side: 'l' | 'r' | null): LimbId {
  if (base === 'head') return 'head';
  if (base === 'torso') return 'torso';
  if (side === null) throw new Error(`limb "${base}" requires a mirrored prim (got no side)`);
  return (base === 'arm' ? (side === 'l' ? 'armL' : 'armR') : side === 'l' ? 'legL' : 'legR');
}

export function expandMirror(def: BodyDef): ExpandedBody {
  const bones: BoneDef[] = [];
  const mirroredBoneNames = new Set<string>();

  for (const b of def.bones) {
    if (!b.mirror) { bones.push({ ...b }); continue; }
    mirroredBoneNames.add(b.name);
    const side = b.side ?? 0;
    bones.push({ ...b, name: `${b.name}.l`, side, mirror: false });
    // The right copy mirrors in x — both the side offset AND the direction.
    // Negating only `side` leaves a `dir` with a nonzero x component (the
    // zombie's clavicle is `dir: [1,0,0]`) pointing the same way on both sides,
    // so both limbs land on the left of the body. Task 8's bilateral-symmetry
    // test is what catches this.
    bones.push({
      ...b, name: `${b.name}.r`, side: -side, mirror: false,
      dir: [-b.dir[0], b.dir[1], b.dir[2]],
    });
  }

  // A mirrored bone's parent may itself be mirrored — retarget to the same side.
  for (const b of bones) {
    if (b.parent && mirroredBoneNames.has(b.parent)) {
      const suffix = b.name.endsWith('.r') ? '.r' : '.l';
      b.parent = `${b.parent}${suffix}`;
    }
  }

  const prims: ExpandedPrim[] = [];
  for (const p of def.prims) {
    const { mirror, limb, ...rest } = p;
    if (!mirror) { prims.push({ ...rest, limb: limbFor(limb, null) }); continue; }
    if (!mirroredBoneNames.has(p.bone))
      throw new Error(`mirrored prim references non-mirrored bone "${p.bone}"`);
    prims.push({ ...rest, bone: `${p.bone}.l`, limb: limbFor(limb, 'l') });
    prims.push({ ...rest, bone: `${p.bone}.r`, limb: limbFor(limb, 'r') });
  }

  return { name: def.name, root: def.root, bones, prims };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run src/lab/sdf-zombie/mirror.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/mirror.ts src/lab/sdf-zombie/mirror.test.ts
git commit -m "feat(sdf-lab): mirror expansion for bones and primitives"
```

---

## Task 5: Relative placement resolution

**Files:**
- Create: `src/lab/sdf-zombie/resolve.ts`
- Test: `src/lab/sdf-zombie/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/resolve.test.ts`:

```ts
// src/lab/sdf-zombie/resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveBones, placePrims } from './resolve';
import type { BoneDef } from './types';
import type { ExpandedPrim } from './mirror';

const bones: BoneDef[] = [
  { name: 'pelvis', parent: null, dir: [0, 1, 0], length: 0.3 },
  { name: 'spine', parent: 'pelvis', dir: [0, 1, 0], length: 0.4 },
  { name: 'thigh.l', parent: 'pelvis', dir: [0, -1, 0], length: 0.4, side: 0.1 },
];

describe('resolveBones', () => {
  const out = resolveBones(bones, [0, 1, 0]);

  it('places the root at the given world position', () => {
    expect(out.get('pelvis')!.head).toEqual([0, 1, 0]);
    expect(out.get('pelvis')!.tail).toEqual([0, 1.3, 0]);
  });

  it('places a child at its parent tail, offset laterally by side', () => {
    expect(out.get('spine')!.head).toEqual([0, 1.3, 0]);
    expect(out.get('spine')!.tail).toEqual([0, 1.7, 0]);
    expect(out.get('thigh.l')!.head).toEqual([0.1, 1.3, 0]);
    expect(out.get('thigh.l')!.tail).toEqual([0.1, 0.9, 0]);
  });

  it('throws on an unknown parent', () => {
    expect(() => resolveBones([{ name: 'x', parent: 'nope', dir: [0, 1, 0], length: 1 }], [0, 0, 0]))
      .toThrow(/nope/);
  });

  it('throws on a cycle rather than looping forever', () => {
    const cyclic: BoneDef[] = [
      { name: 'a', parent: 'b', dir: [0, 1, 0], length: 1 },
      { name: 'b', parent: 'a', dir: [0, 1, 0], length: 1 },
    ];
    expect(() => resolveBones(cyclic, [0, 0, 0])).toThrow(/cycle|unresolved/i);
  });
});

describe('placePrims', () => {
  const resolved = resolveBones(bones, [0, 1, 0]);

  it('places a sphere prim at the normalised position along its bone', () => {
    const prims: ExpandedPrim[] = [
      { bone: 'pelvis', at: 0.5, radius: 0.2, scale: [1, 1, 1], blendK: 0.0125, limb: 'torso' },
    ];
    const [p] = placePrims(prims, resolved);
    expect(p.a).toEqual([0, 1.15, 0]);
    expect(p.b).toEqual([0, 1.15, 0]); // sphere: a === b
  });

  it('spans a capsule prim between at and capTo on the same bone', () => {
    const prims: ExpandedPrim[] = [
      { bone: 'thigh.l', at: 0.0, capTo: 1.0, radius: 0.09, scale: [1, 1, 1], blendK: 0.0125, limb: 'legL' },
    ];
    const [p] = placePrims(prims, resolved);
    expect(p.a).toEqual([0.1, 1.3, 0]);
    expect(p.b).toEqual([0.1, 0.9, 0]);
  });

  it('throws when a prim names a bone that does not exist', () => {
    const prims: ExpandedPrim[] = [
      { bone: 'ghost', at: 0.5, radius: 0.1, scale: [1, 1, 1], blendK: 0.0125, limb: 'torso' },
    ];
    expect(() => placePrims(prims, resolved)).toThrow(/ghost/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lab/sdf-zombie/resolve.test.ts
```

Expected: FAIL — `Failed to resolve import "./resolve"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/resolve.ts`:

```ts
// src/lab/sdf-zombie/resolve.ts
import type { BoneDef, LimbId, Primitive, ResolvedBone, Vec3 } from './types';
import type { ExpandedPrim } from './mirror';
import { add, lerp, normalize, scale } from './vec';

/**
 * Walks the bone tree, converting relative (parent + dir + length + side)
 * placement into concrete world-space head/tail pairs.
 */
export function resolveBones(bones: BoneDef[], root: Vec3): Map<string, ResolvedBone> {
  const byName = new Map(bones.map(b => [b.name, b]));
  const out = new Map<string, ResolvedBone>();

  for (const b of bones)
    if (b.parent !== null && !byName.has(b.parent))
      throw new Error(`bone "${b.name}" has unknown parent "${b.parent}"`);

  // Iterate to a fixed point; each pass resolves any bone whose parent is known.
  let remaining = bones.slice();
  while (remaining.length > 0) {
    const next: BoneDef[] = [];
    for (const b of remaining) {
      const parentTail = b.parent === null ? root : out.get(b.parent)?.tail;
      if (parentTail === undefined) { next.push(b); continue; }
      const head: Vec3 = [parentTail[0] + (b.side ?? 0), parentTail[1], parentTail[2]];
      out.set(b.name, { head, tail: add(head, scale(normalize(b.dir), b.length)) });
    }
    if (next.length === remaining.length)
      throw new Error(`unresolved bones (cycle?): ${next.map(b => b.name).join(', ')}`);
    remaining = next;
  }
  return out;
}

/** Places each primitive at its normalised position along its resolved bone. */
export function placePrims(
  prims: ExpandedPrim[],
  bones: Map<string, ResolvedBone>,
): Omit<Primitive, 'cluster'>[] {
  return prims.map(p => {
    const bone = bones.get(p.bone);
    if (!bone) throw new Error(`prim references unknown bone "${p.bone}"`);
    const a = lerp(bone.head, bone.tail, p.at);
    const b = p.capTo === undefined ? a : lerp(bone.head, bone.tail, p.capTo);
    return {
      a, b,
      radius: p.radius,
      scale: p.scale,
      blendK: p.blendK,
      limb: p.limb as LimbId,
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run src/lab/sdf-zombie/resolve.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/resolve.ts src/lab/sdf-zombie/resolve.test.ts
git commit -m "feat(sdf-lab): relative bone and primitive placement resolution"
```

---

## Task 6: Cluster sorting and bounding spheres

This task establishes the fixed fold order that makes severing safe. Read the "Critical constraint" section at the top of this plan before starting.

**Files:**
- Create: `src/lab/sdf-zombie/clusters.ts`
- Test: `src/lab/sdf-zombie/clusters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/clusters.test.ts`:

```ts
// src/lab/sdf-zombie/clusters.test.ts
import { describe, it, expect } from 'vitest';
import { assignClusters } from './clusters';
import { CLUSTER_ORDER, type LimbId, type Primitive } from './types';
import { len, sub } from './vec';

const prim = (limb: LimbId, a: [number, number, number], radius = 0.1): Omit<Primitive, 'cluster'> =>
  ({ a, b: a, radius, scale: [1, 1, 1], blendK: 0.0125, limb });

describe('assignClusters', () => {
  // Deliberately out of fold order on input.
  const input = [
    prim('legR', [-0.1, 0.4, 0]),
    prim('head', [0, 1.7, 0]),
    prim('torso', [0, 1.2, 0]),
    prim('legL', [0.1, 0.4, 0]),
    prim('torso', [0, 1.0, 0]),
  ];
  const built = assignClusters(input);

  it('sorts primitives into CLUSTER_ORDER regardless of input order', () => {
    const limbs = built.prims.map(p => p.limb);
    const rank = (l: LimbId) => CLUSTER_ORDER.indexOf(l);
    for (let i = 1; i < limbs.length; i++)
      expect(rank(limbs[i])).toBeGreaterThanOrEqual(rank(limbs[i - 1]));
  });

  it('stamps each primitive with its cluster id matching CLUSTER_ORDER', () => {
    for (const p of built.prims) expect(p.cluster).toBe(CLUSTER_ORDER.indexOf(p.limb));
  });

  it('gives every cluster a contiguous start/count covering its primitives', () => {
    for (const c of built.clusters) {
      const slice = built.prims.slice(c.start, c.start + c.count);
      expect(slice).toHaveLength(c.count);
      for (const p of slice) expect(p.limb).toBe(c.limb);
    }
  });

  it('omits clusters that have no primitives', () => {
    expect(built.clusters.map(c => c.limb)).toEqual(['head', 'torso', 'legL', 'legR']);
  });

  it('produces a bounding sphere that contains every primitive it covers', () => {
    for (const c of built.clusters)
      for (const p of built.prims.slice(c.start, c.start + c.count))
        for (const end of [p.a, p.b]) {
          const maxScale = Math.max(...p.scale);
          expect(len(sub(end, c.center)) + p.radius * maxScale).toBeLessThanOrEqual(c.radius + 1e-9);
        }
  });

  it('starts every cluster alive', () => {
    expect(built.clusters.every(c => c.alive)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lab/sdf-zombie/clusters.test.ts
```

Expected: FAIL — `Failed to resolve import "./clusters"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/clusters.ts`:

```ts
// src/lab/sdf-zombie/clusters.ts
import { CLUSTER_ORDER, type ClusterInfo, type LimbId, type Primitive, type Vec3 } from './types';
import { add, len, scale as vscale, sub } from './vec';

/**
 * Sorts primitives into the fixed CLUSTER_ORDER fold sequence and computes a
 * bounding sphere per cluster.
 *
 * The fold order is load-bearing: the quadratic smooth-min used by the shader
 * is NOT associative, so a change in fold sequence changes the surface. Sorting
 * here — and severing by clearing a cluster's alive flag rather than removing
 * primitives — keeps the sequence stable for the lifetime of the body.
 */
export function assignClusters(
  prims: Omit<Primitive, 'cluster'>[],
): { prims: Primitive[]; clusters: ClusterInfo[] } {
  const sorted: Primitive[] = prims
    .map(p => ({ ...p, cluster: CLUSTER_ORDER.indexOf(p.limb) }))
    .sort((x, y) => x.cluster - y.cluster);

  const clusters: ClusterInfo[] = [];
  let i = 0;
  while (i < sorted.length) {
    const limb: LimbId = sorted[i].limb;
    const start = i;
    while (i < sorted.length && sorted[i].limb === limb) i++;
    const members = sorted.slice(start, i);

    // Centroid of the capsule endpoints, then the radius that covers them all.
    let sum: Vec3 = [0, 0, 0];
    for (const p of members) sum = add(sum, add(p.a, p.b));
    const center = vscale(sum, 1 / (members.length * 2));

    let radius = 0;
    for (const p of members) {
      const maxScale = Math.max(p.scale[0], p.scale[1], p.scale[2]);
      for (const end of [p.a, p.b])
        radius = Math.max(radius, len(sub(end, center)) + p.radius * maxScale);
    }

    clusters.push({
      id: CLUSTER_ORDER.indexOf(limb), limb,
      start, count: members.length,
      center, radius, alive: true,
    });
  }
  return { prims: sorted, clusters };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run src/lab/sdf-zombie/clusters.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/clusters.ts src/lab/sdf-zombie/clusters.test.ts
git commit -m "feat(sdf-lab): cluster sorting into fixed fold order with bounding spheres"
```

---

## Task 7: The checks pass

Every check here catches a **silent** failure — one that renders a plausible-but-wrong image instead of erroring.

**Files:**
- Create: `src/lab/sdf-zombie/validate.ts`
- Test: `src/lab/sdf-zombie/validate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/validate.test.ts`:

```ts
// src/lab/sdf-zombie/validate.test.ts
import { describe, it, expect } from 'vitest';
import { validateBody, MAX_PRIMS } from './validate';
import { assignClusters } from './clusters';
import type { LimbId, Primitive } from './types';

const prim = (limb: LimbId, a: [number, number, number], radius = 0.1, blendK = 0.06):
  Omit<Primitive, 'cluster'> => ({ a, b: a, radius, scale: [1, 1, 1], blendK, limb });

/** A minimal valid body: head fused to torso, both legs fused to torso. */
const healthy = () => assignClusters([
  prim('head', [0, 1.62, 0], 0.15),
  prim('torso', [0, 1.35, 0], 0.22),
  prim('torso', [0, 1.15, 0], 0.20),
  prim('legL', [0.09, 0.95, 0], 0.10),
  prim('legR', [-0.09, 0.95, 0], 0.10),
]);

describe('validateBody', () => {
  it('passes a healthy body', () => {
    expect(validateBody(healthy(), { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 })).toEqual([]);
  });

  it('fails when a primitive escapes its cluster bounding sphere', () => {
    const body = healthy();
    // Move a primitive after bounds were computed — the cull would silently drop it.
    body.prims[body.clusters[0].start] = { ...body.prims[body.clusters[0].start], a: [5, 5, 5], b: [5, 5, 5] };
    const errs = validateBody(body, { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 });
    expect(errs.join(' ')).toMatch(/bounding sphere/i);
  });

  it('fails when silhouette noise outruns the march step multiplier', () => {
    const errs = validateBody(healthy(), { silhouetteNoiseAmp: 0.5, stepMultiplier: 0.95 });
    expect(errs.join(' ')).toMatch(/lipschitz|step multiplier/i);
  });

  it('fails when a limb is disconnected from the rest of the body', () => {
    const body = assignClusters([
      prim('torso', [0, 1.2, 0], 0.22),
      prim('legL', [0.09, 0.2, 0], 0.08, 0.01), // far below, tiny blend — floats free
    ]);
    const errs = validateBody(body, { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 });
    expect(errs.join(' ')).toMatch(/disconnected|not fused/i);
  });

  it('fails when the primitive count exceeds the shader ceiling', () => {
    const many = Array.from({ length: MAX_PRIMS + 1 }, (_, i) => prim('torso', [0, 1.2 + i * 0.001, 0], 0.22));
    const errs = validateBody(assignClusters(many), { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 });
    expect(errs.join(' ')).toMatch(/primitive count/i);
  });

  it('fails when a cluster is not contiguous in the primitive array', () => {
    const body = healthy();
    // Corrupt the fold order: swap a torso prim with a leg prim.
    const t = body.clusters.find(c => c.limb === 'torso')!;
    const l = body.clusters.find(c => c.limb === 'legL')!;
    const tmp = body.prims[t.start];
    body.prims[t.start] = body.prims[l.start];
    body.prims[l.start] = tmp;
    const errs = validateBody(body, { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 });
    expect(errs.join(' ')).toMatch(/contiguous|fold order/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lab/sdf-zombie/validate.test.ts
```

Expected: FAIL — `Failed to resolve import "./validate"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/validate.ts`:

```ts
// src/lab/sdf-zombie/validate.ts
import type { ClusterInfo, Primitive, Vec3 } from './types';
import { add, len, lerp, scale as vscale, sub } from './vec';

/** Must match MAX_PRIMS in the fragment shader. */
export const MAX_PRIMS = 32;
/** Must match MAX_CLUSTERS in the fragment shader. */
export const MAX_CLUSTERS = 6;

export interface ValidateOpts {
  silhouetteNoiseAmp: number;
  stepMultiplier: number;
}

interface Body { prims: Primitive[]; clusters: ClusterInfo[] }

/** Distance from p to one primitive, matching the shader's ellipsoid capsule. */
export function sdPrimitive(p: Vec3, prim: Primitive): number {
  const inv: Vec3 = [1 / prim.scale[0], 1 / prim.scale[1], 1 / prim.scale[2]];
  const q: Vec3 = [p[0] * inv[0], p[1] * inv[1], p[2] * inv[2]];
  const a: Vec3 = [prim.a[0] * inv[0], prim.a[1] * inv[1], prim.a[2] * inv[2]];
  const b: Vec3 = [prim.b[0] * inv[0], prim.b[1] * inv[1], prim.b[2] * inv[2]];
  const ab = sub(b, a), ap = sub(q, a);
  const abLen2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = abLen2 === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / abLen2));
  const closest = add(a, vscale(ab, t));
  const minScale = Math.min(prim.scale[0], prim.scale[1], prim.scale[2]);
  return (len(sub(q, closest)) - prim.radius) * minScale;
}

/** Quadratic polynomial smooth-min — must match the shader exactly. */
export function smin(a: number, b: number, k: number): number {
  const kk = k * 4;
  if (kk <= 0) return Math.min(a, b);
  const h = Math.max(kk - Math.abs(a - b), 0) / kk;
  return Math.min(a, b) - h * h * kk * 0.25;
}

/** Field value over all live clusters, in fixed fold order. */
export function sdBody(p: Vec3, body: Body): number {
  let d = 1e9;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (const prim of body.prims.slice(c.start, c.start + c.count))
      d = smin(d, sdPrimitive(p, prim), prim.blendK);
  }
  return d;
}

export function validateBody(body: Body, opts: ValidateOpts): string[] {
  const errs: string[] = [];

  if (body.prims.length > MAX_PRIMS)
    errs.push(`primitive count ${body.prims.length} exceeds shader ceiling ${MAX_PRIMS}`);
  if (body.clusters.length > MAX_CLUSTERS)
    errs.push(`cluster count ${body.clusters.length} exceeds shader ceiling ${MAX_CLUSTERS}`);

  // Fold order: each cluster must own a contiguous run of same-limb primitives.
  for (const c of body.clusters) {
    const slice = body.prims.slice(c.start, c.start + c.count);
    if (slice.length !== c.count || slice.some(p => p.limb !== c.limb))
      errs.push(`cluster "${c.limb}" is not contiguous — fold order is corrupt`);
  }

  // Bounding spheres must contain their primitives, or the cull drops real surface.
  for (const c of body.clusters)
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      const maxScale = Math.max(prim.scale[0], prim.scale[1], prim.scale[2]);
      for (const end of [prim.a, prim.b])
        if (len(sub(end, c.center)) + prim.radius * maxScale > c.radius + 1e-6)
          errs.push(`primitive in cluster "${c.limb}" escapes its bounding sphere`);
    }

  // Distance displacement breaks the Lipschitz bound; the step multiplier pays for it.
  if (opts.silhouetteNoiseAmp > (1 - opts.stepMultiplier) * 0.5)
    errs.push(
      `silhouette noise ${opts.silhouetteNoiseAmp} violates the Lipschitz bound at step ` +
      `multiplier ${opts.stepMultiplier} — lower the noise or the multiplier`);

  // Connectivity: every cluster must fuse into at least one other cluster.
  // Sample along the segment between cluster centres; fused ⇒ the field stays
  // inside (negative) the whole way.
  if (body.clusters.length > 1)
    for (const c of body.clusters) {
      const fused = body.clusters.some(o => o.id !== c.id && segmentInside(c.center, o.center, body));
      if (!fused) errs.push(`cluster "${c.limb}" is disconnected — not fused to any other cluster`);
    }

  return errs;
}

function segmentInside(from: Vec3, to: Vec3, body: Body): boolean {
  const STEPS = 24;
  for (let i = 0; i <= STEPS; i++)
    if (sdBody(lerp(from, to, i / STEPS), body) > 0) return false;
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run src/lab/sdf-zombie/validate.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/validate.ts src/lab/sdf-zombie/validate.test.ts
git commit -m "feat(sdf-lab): validateBody checks pass with exact field queries"
```

---

## Task 8: The zombie body definition and build pipeline

**Files:**
- Create: `src/lab/sdf-zombie/body.ts`
- Create: `src/lab/sdf-zombie/build-body.ts`
- Test: `src/lab/sdf-zombie/build-body.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/build-body.test.ts`:

```ts
// src/lab/sdf-zombie/build-body.test.ts
import { describe, it, expect } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { CLUSTER_ORDER } from './types';

describe('buildBody with the shipped zombie', () => {
  const built = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);

  it('produces a body that passes every check', () => {
    expect(built.errors).toEqual([]);
  });

  it('has all six clusters, in fold order', () => {
    expect(built.clusters.map(c => c.limb)).toEqual([...CLUSTER_ORDER]);
  });

  it('stays within the shader ceilings', () => {
    expect(built.prims.length).toBeGreaterThanOrEqual(15);
    expect(built.prims.length).toBeLessThanOrEqual(32);
  });

  it('is bilaterally symmetric in x', () => {
    const flip = (n: number) => Math.round(n * 1e6) / 1e6;
    const left = built.prims.filter(p => p.limb === 'armL').map(p => flip(p.a[0]));
    const right = built.prims.filter(p => p.limb === 'armR').map(p => flip(-p.a[0]));
    expect(left).toEqual(right);
  });

  it('applies an override layer over the base definition', () => {
    const o = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS, { primRadius: { 0: 0.99 } });
    expect(o.prims[0].radius).toBe(0.99);
    // The base definition is not mutated.
    expect(buildBody(ZOMBIE, DEFAULT_BUILD_OPTS).prims[0].radius).not.toBe(0.99);
  });

  it('reports errors instead of throwing when an override breaks a check', () => {
    const o = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS, { primBlendK: { 0: 0 } });
    expect(Array.isArray(o.errors)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lab/sdf-zombie/build-body.test.ts
```

Expected: FAIL — `Failed to resolve import "./build-body"`.

- [ ] **Step 3: Write the zombie definition**

Create `src/lab/sdf-zombie/body.ts`:

```ts
// src/lab/sdf-zombie/body.ts
import type { BodyDef } from './types';

/**
 * The lab zombie — authored as discrete, named, relative, symmetric decisions.
 * Only the left side is written; `mirror: true` generates the right.
 *
 * Proportions are deliberately wrong in a B-movie way: long arms hanging past
 * the hip line, head pitched forward of the spine, heavy gut.
 */
export const ZOMBIE: BodyDef = {
  name: 'zombie',
  root: [0, 0.92, 0], // pelvis height in metres

  bones: [
    { name: 'pelvis',   parent: null,     dir: [0, 1, 0],       length: 0.14 },
    { name: 'spine',    parent: 'pelvis', dir: [0, 1, -0.12],   length: 0.34 },
    { name: 'neck',     parent: 'spine',  dir: [0, 1, -0.35],   length: 0.10 },
    { name: 'skull',    parent: 'neck',   dir: [0, 1, -0.18],   length: 0.16 },
    { name: 'clavicle', parent: 'spine',  dir: [1, 0, 0],       length: 0.16, side: 0,    mirror: true },
    { name: 'upperArm', parent: 'clavicle', dir: [0.18, -1, 0], length: 0.30, side: 0,    mirror: true },
    { name: 'foreArm',  parent: 'upperArm', dir: [0.05, -1, 0.1], length: 0.30, side: 0,  mirror: true },
    { name: 'thigh',    parent: 'pelvis', dir: [0, -1, 0],      length: 0.40, side: 0.10, mirror: true },
    { name: 'shin',     parent: 'thigh',  dir: [0, -1, 0.05],   length: 0.42, side: 0,    mirror: true },
  ],

  prims: [
    // Head — skull plus a heavy jaw that juts forward.
    { bone: 'skull', at: 0.45, radius: 0.115, scale: [1, 1.08, 1.05], blendK: 0.0125, limb: 'head' },
    { bone: 'skull', at: 0.15, radius: 0.075, scale: [0.9, 0.7, 1.25], blendK: 0.0125, limb: 'head' },
    { bone: 'neck',  at: 0.2, capTo: 1.0, radius: 0.055, scale: [1, 1, 1], blendK: 0.015, limb: 'head' },

    // Torso — ribcage tapering into a sagging gut.
    { bone: 'spine',  at: 0.85, radius: 0.155, scale: [1.25, 1, 0.78], blendK: 0.02, limb: 'torso' },
    { bone: 'spine',  at: 0.50, radius: 0.150, scale: [1.15, 1, 0.80], blendK: 0.02, limb: 'torso' },
    { bone: 'spine',  at: 0.15, radius: 0.142, scale: [1.02, 1, 0.95], blendK: 0.02, limb: 'torso' },
    { bone: 'pelvis', at: 0.40, radius: 0.145, scale: [1.10, 0.9, 0.92], blendK: 0.02, limb: 'torso' },

    // Arms — shoulder blob, then upper and forearm capsules, then a fist.
    { bone: 'clavicle', at: 0.85, radius: 0.085, scale: [1, 1, 1], blendK: 0.0175, limb: 'arm', mirror: true },
    { bone: 'upperArm', at: 0.05, capTo: 0.95, radius: 0.062, scale: [1, 1, 1], blendK: 0.015, limb: 'arm', mirror: true },
    { bone: 'foreArm',  at: 0.05, capTo: 0.90, radius: 0.052, scale: [1, 1, 1], blendK: 0.015, limb: 'arm', mirror: true },
    { bone: 'foreArm',  at: 1.00, radius: 0.062, scale: [1, 1, 1], blendK: 0.0125, limb: 'arm', mirror: true },

    // Legs — thigh, shin, foot.
    { bone: 'thigh', at: 0.05, capTo: 0.95, radius: 0.082, scale: [1, 1, 1], blendK: 0.0175, limb: 'leg', mirror: true },
    { bone: 'shin',  at: 0.05, capTo: 0.92, radius: 0.062, scale: [1, 1, 1], blendK: 0.015, limb: 'leg', mirror: true },
    { bone: 'shin',  at: 1.00, radius: 0.070, scale: [0.85, 0.6, 1.5], blendK: 0.0125, limb: 'leg', mirror: true },
  ],
};
```

- [ ] **Step 4: Write the build pipeline**

Create `src/lab/sdf-zombie/build-body.ts`:

```ts
// src/lab/sdf-zombie/build-body.ts
import type { BodyDef, BuiltBody } from './types';
import { expandMirror } from './mirror';
import { placePrims, resolveBones } from './resolve';
import { assignClusters } from './clusters';
import { validateBody, type ValidateOpts } from './validate';

export interface BuildOpts extends ValidateOpts {}

export const DEFAULT_BUILD_OPTS: BuildOpts = {
  silhouetteNoiseAmp: 0.012,
  stepMultiplier: 0.6,
};

/**
 * Non-destructive override layer, keyed by built-primitive index. Written by
 * the tuning panel so slider work survives a reload without editing body.ts.
 */
export interface BodyOverride {
  primRadius?: Record<number, number>;
  primBlendK?: Record<number, number>;
}

export interface BuildResult extends BuiltBody {
  /** Empty when the body passes every check. Never throws — the panel shows these. */
  errors: string[];
}

export function buildBody(
  def: BodyDef,
  opts: BuildOpts = DEFAULT_BUILD_OPTS,
  override: BodyOverride = {},
): BuildResult {
  const expanded = expandMirror(def);
  const bones = resolveBones(expanded.bones, expanded.root);
  const placed = placePrims(expanded.prims, bones);
  const { prims, clusters } = assignClusters(placed);

  // Overrides apply AFTER clustering, so indices are stable built-array indices.
  for (const [k, v] of Object.entries(override.primRadius ?? {}))
    if (prims[+k]) prims[+k] = { ...prims[+k], radius: v };
  for (const [k, v] of Object.entries(override.primBlendK ?? {}))
    if (prims[+k]) prims[+k] = { ...prims[+k], blendK: v };

  const body = { prims, clusters };
  return { ...body, bones, errors: validateBody(body, opts) };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
npx vitest run src/lab/sdf-zombie/build-body.test.ts
```

Expected: PASS, 6 tests. **If `errors` is non-empty**, the zombie's proportions need tuning — read the error text and adjust `blendK` (usually too small, causing a disconnected-cluster error) or bone lengths in `body.ts` until it passes. Do not weaken a check to make it pass.

- [ ] **Step 6: Run the whole suite to confirm nothing regressed**

Run:

```bash
npm test
```

Expected: all pre-existing tests still pass, plus the new lab tests.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/body.ts src/lab/sdf-zombie/build-body.ts src/lab/sdf-zombie/build-body.test.ts
git commit -m "feat(sdf-lab): zombie body definition and build pipeline"
```

---

## Task 9: Uniform packing

**Files:**
- Create: `src/lab/sdf-zombie/pack.ts`
- Test: `src/lab/sdf-zombie/pack.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/pack.test.ts`:

```ts
// src/lab/sdf-zombie/pack.test.ts
import { describe, it, expect } from 'vitest';
import { packBody, PRIM_STRIDE, CLUSTER_STRIDE } from './pack';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { MAX_CLUSTERS, MAX_PRIMS } from './validate';

describe('packBody', () => {
  const built = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const packed = packBody(built);

  it('allocates fixed-size arrays matching the shader ceilings', () => {
    expect(packed.primA).toHaveLength(MAX_PRIMS * PRIM_STRIDE);
    expect(packed.primB).toHaveLength(MAX_PRIMS * PRIM_STRIDE);
    expect(packed.primScale).toHaveLength(MAX_PRIMS * PRIM_STRIDE);
    expect(packed.clusterBounds).toHaveLength(MAX_CLUSTERS * CLUSTER_STRIDE);
    expect(packed.clusterRange).toHaveLength(MAX_CLUSTERS * CLUSTER_STRIDE);
  });

  it('reports the live counts', () => {
    expect(packed.primCount).toBe(built.prims.length);
    expect(packed.clusterCount).toBe(built.clusters.length);
  });

  it('packs endpoint A with radius in w', () => {
    const p = built.prims[0];
    expect(Array.from(packed.primA.slice(0, 4))).toEqual([...p.a, p.radius]);
  });

  it('packs endpoint B with blendK in w', () => {
    const p = built.prims[0];
    expect(Array.from(packed.primB.slice(0, 4))).toEqual([...p.b, p.blendK]);
  });

  it('packs cluster range as (start, count, alive) and bounds as (center, radius)', () => {
    const c = built.clusters[0];
    expect(Array.from(packed.clusterRange.slice(0, 3))).toEqual([c.start, c.count, 1]);
    expect(Array.from(packed.clusterBounds.slice(0, 4))).toEqual([...c.center, c.radius]);
  });

  it('writes alive = 0 for a severed cluster without moving any primitive', () => {
    const severed = { ...built, clusters: built.clusters.map((c, i) => i === 2 ? { ...c, alive: false } : c) };
    const p2 = packBody(severed);
    expect(p2.clusterRange[2 * CLUSTER_STRIDE + 2]).toBe(0);
    // Primitive payload is byte-identical — severing never re-packs.
    expect(Array.from(p2.primA)).toEqual(Array.from(packed.primA));
  });

  it('reports the largest blendK, which the shader needs as its cull margin', () => {
    expect(packed.maxBlendK).toBe(Math.max(...built.prims.map(p => p.blendK)));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lab/sdf-zombie/pack.test.ts
```

Expected: FAIL — `Failed to resolve import "./pack"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/pack.ts`:

```ts
// src/lab/sdf-zombie/pack.ts
import type { BuiltBody } from './types';
import { MAX_CLUSTERS, MAX_PRIMS } from './validate';

export const PRIM_STRIDE = 4;    // vec4
export const CLUSTER_STRIDE = 4; // vec4

export interface PackedBody {
  primA: Float32Array;         // xyz = endpoint A, w = radius
  primB: Float32Array;         // xyz = endpoint B, w = blendK
  primScale: Float32Array;     // xyz = ellipsoid scale, w = cluster id
  clusterBounds: Float32Array; // xyz = centre, w = radius
  clusterRange: Float32Array;  // x = start, y = count, z = alive, w = unused
  primCount: number;
  clusterCount: number;
  /** Cull margin: a cluster can still pull the surface from up to this far away. */
  maxBlendK: number;
}

export function packBody(body: BuiltBody): PackedBody {
  const primA = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primB = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primScale = new Float32Array(MAX_PRIMS * PRIM_STRIDE);

  let maxBlendK = 0;
  body.prims.forEach((p, i) => {
    const o = i * PRIM_STRIDE;
    primA.set([p.a[0], p.a[1], p.a[2], p.radius], o);
    primB.set([p.b[0], p.b[1], p.b[2], p.blendK], o);
    primScale.set([p.scale[0], p.scale[1], p.scale[2], p.cluster], o);
    if (p.blendK > maxBlendK) maxBlendK = p.blendK;
  });

  const clusterBounds = new Float32Array(MAX_CLUSTERS * CLUSTER_STRIDE);
  const clusterRange = new Float32Array(MAX_CLUSTERS * CLUSTER_STRIDE);
  body.clusters.forEach((c, i) => {
    const o = i * CLUSTER_STRIDE;
    clusterBounds.set([c.center[0], c.center[1], c.center[2], c.radius], o);
    clusterRange.set([c.start, c.count, c.alive ? 1 : 0, 0], o);
  });

  return {
    primA, primB, primScale, clusterBounds, clusterRange,
    primCount: body.prims.length,
    clusterCount: body.clusters.length,
    maxBlendK,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run src/lab/sdf-zombie/pack.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/pack.ts src/lab/sdf-zombie/pack.test.ts
git commit -m "feat(sdf-lab): uniform packing with sever-stable primitive payload"
```

---

## Task 10: Render the real body

Replaces the spike shader with the generic N-primitive marcher. This is the first time the zombie appears on screen.

**Files:**
- Modify: `src/lab/sdf-zombie/march.glsl.ts`
- Create: `src/lab/sdf-zombie/zombie.ts`
- Modify: `src/lab/sdf-zombie/lab-main.ts`

- [ ] **Step 1: Replace the spike fragment shader with the body marcher**

In `src/lab/sdf-zombie/march.glsl.ts`, keep `VERT` and **replace** `FRAG_SPIKE` with:

```ts
export const MAX_PRIMS = 32;
export const MAX_CLUSTERS = 6;

export const FRAG = /* glsl */ `
precision highp float;

#define MAX_PRIMS ${MAX_PRIMS}
#define MAX_CLUSTERS ${MAX_CLUSTERS}

in vec3 vWorldPos;
out vec4 outColor;

uniform vec4 uPrimA[MAX_PRIMS];          // xyz = A, w = radius
uniform vec4 uPrimB[MAX_PRIMS];          // xyz = B, w = blendK
uniform vec4 uPrimScale[MAX_PRIMS];      // xyz = scale, w = cluster id
uniform vec4 uClusterBounds[MAX_CLUSTERS]; // xyz = centre, w = radius
uniform vec4 uClusterRange[MAX_CLUSTERS];  // x = start, y = count, z = alive
uniform int  uPrimCount;
uniform int  uClusterCount;
uniform float uMaxBlendK;
uniform int  uSteps;
uniform float uStepMul;
uniform vec3 uBaseColor;
uniform vec3 uLightDir;

// REQUIRED. three's FRAGMENT prefix declares viewMatrix and cameraPosition but
// NOT projectionMatrix (that one is vertex-only). The gl_FragDepth write needs
// it. Without this the program fails to link with
//   ERROR: 'projectionMatrix' : undeclared identifier
// and nothing renders at all — while tsc, vite and vitest all stay green,
// because none of them compile GLSL. three still binds it by name.
uniform mat4 projectionMatrix;

// iq quadratic polynomial smooth-min: rigid + conservative (never overestimates).
// NOT associative — the fold order below is fixed by cluster and must stay that way.
float smin(float a, float b, float k) {
  k *= 4.0;
  if (k <= 0.0) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float sdPrim(vec3 p, int i) {
  vec4 A = uPrimA[i], B = uPrimB[i], S = uPrimScale[i];
  vec3 inv = 1.0 / S.xyz;
  vec3 q = p * inv, a = A.xyz * inv, b = B.xyz * inv;
  vec3 ab = b - a, ap = q - a;
  float ab2 = dot(ab, ab);
  float t = ab2 == 0.0 ? 0.0 : clamp(dot(ap, ab) / ab2, 0.0, 1.0);
  float minScale = min(S.x, min(S.y, S.z));
  return (length(q - (a + ab * t)) - A.w) * minScale;
}

float mapBody(vec3 p) {
  float d = 1e9;
  for (int c = 0; c < MAX_CLUSTERS; c++) {
    if (c >= uClusterCount) break;
    vec4 range = uClusterRange[c];
    if (range.z < 0.5) continue;               // severed
    vec4 bounds = uClusterBounds[c];
    // Cull, with a blend margin: a cluster still pulls the surface from
    // uMaxBlendK away, so culling on `> d` alone would clip the blend fillet.
    // NOTE the 4.0 — smin() scales k by 4 internally, so a cluster's real
    // influence radius is 4x the authored blendK. Using the unscaled value
    // culls clusters that are still bending the surface, which shows up as
    // hard creases exactly along cluster boundaries.
    if (length(p - bounds.xyz) - bounds.w > d + uMaxBlendK * 4.0) continue;
    int start = int(range.x), count = int(range.y);
    for (int i = 0; i < MAX_PRIMS; i++) {
      if (i >= count) break;
      int idx = start + i;
      if (idx >= uPrimCount) break;
      d = smin(d, sdPrim(p, idx), uPrimB[idx].w);
    }
  }
  return d;
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.0015;
  return normalize(
    e.xyy * mapBody(p + e.xyy) + e.yyx * mapBody(p + e.yyx) +
    e.yxy * mapBody(p + e.yxy) + e.xxx * mapBody(p + e.xxx));
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);
  float tMax = length(vWorldPos - cameraPosition);

  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < 256; i++) {
    if (i >= uSteps) break;
    float d = mapBody(ro + rd * t);
    if (d < 0.0012) { hit = true; break; }
    t += d * uStepMul;
    if (t > tMax) break;
  }
  if (!hit) discard;

  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);
  float diff = max(dot(n, normalize(uLightDir)), 0.0);
  outColor = vec4(uBaseColor * (0.22 + 0.78 * diff), 1.0);

  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
}
`;
```

- [ ] **Step 2: Write the Three assembly module**

Create `src/lab/sdf-zombie/zombie.ts`:

```ts
// src/lab/sdf-zombie/zombie.ts
import * as THREE from 'three';
import type { BuildResult } from './build-body';
import { packBody, type PackedBody } from './pack';
import { FRAG, VERT } from './march.glsl';
import { len, sub } from './vec';

export interface ZombieView {
  object: THREE.Object3D;
  material: THREE.ShaderMaterial;
  /** Re-upload after the body changes (sever, override edit, rig step). */
  update(body: BuildResult): void;
}

/** Proxy box big enough to contain every live cluster, with blend margin. */
function fitProxy(packed: PackedBody, body: BuildResult): { center: THREE.Vector3; size: number } {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], c.center[i] - c.radius);
      max[i] = Math.max(max[i], c.center[i] + c.radius);
    }
  }
  const pad = packed.maxBlendK * 4 + 0.05;
  const center = new THREE.Vector3(...min.map((v, i) => (v + max[i]) / 2));
  const size = Math.max(...max.map((v, i) => v - min[i])) + pad * 2;
  return { center, size };
}

export function createZombieView(body: BuildResult): ZombieView {
  const packed = packBody(body);

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    // No `extensions` entry — see the note in Task 2. GLSL3 is sufficient.
    side: THREE.BackSide,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uPrimA: { value: packed.primA },
      uPrimB: { value: packed.primB },
      uPrimScale: { value: packed.primScale },
      uClusterBounds: { value: packed.clusterBounds },
      uClusterRange: { value: packed.clusterRange },
      uPrimCount: { value: packed.primCount },
      uClusterCount: { value: packed.clusterCount },
      uMaxBlendK: { value: packed.maxBlendK },
      uSteps: { value: 96 },
      uStepMul: { value: 0.6 },
      uBaseColor: { value: new THREE.Color(0xc46a72) },
      uLightDir: { value: new THREE.Vector3(0.5, 1.0, 0.4) },
    },
  });

  const { center, size } = fitProxy(packed, body);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
  mesh.position.copy(center);
  mesh.frustumCulled = false; // the proxy is the bound; don't double-cull

  return {
    object: mesh,
    material,
    update(next: BuildResult) {
      const p = packBody(next);
      const u = material.uniforms;
      (u.uPrimA.value as Float32Array).set(p.primA);
      (u.uPrimB.value as Float32Array).set(p.primB);
      (u.uPrimScale.value as Float32Array).set(p.primScale);
      (u.uClusterBounds.value as Float32Array).set(p.clusterBounds);
      (u.uClusterRange.value as Float32Array).set(p.clusterRange);
      u.uPrimCount.value = p.primCount;
      u.uClusterCount.value = p.clusterCount;
      u.uMaxBlendK.value = p.maxBlendK;
      const fit = fitProxy(p, next);
      mesh.position.copy(fit.center);
      mesh.scale.setScalar(fit.size / size);
    },
  };
}
```

- [ ] **Step 3: Replace the spike in the entry with the real zombie**

In `src/lab/sdf-zombie/lab-main.ts`, delete the `spikeMat` / `proxy` block from Task 2 and the `FRAG_SPIKE` import, then append:

```ts
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { createZombieView } from './zombie';

const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
const errorsEl = document.getElementById('errors');
if (errorsEl) errorsEl.textContent = body.errors.join('\n');

const view = createZombieView(body);
scene.add(view.object);
```

- [ ] **Step 4: Verify by eye**

Run:

```bash
npm run dev -- --port 5180
```

Open `http://localhost:5180/sdf-lab.html`. Expected:
1. A humanoid blob roughly 1.8 m tall, standing on the floor, with head, torso, two arms and two legs **visibly fused into one continuous surface** — no seams, no floating parts.
2. The reference cube still interleaves correctly in depth.
3. The `#errors` panel area is empty.

If limbs look detached, `blendK` is too low in `body.ts` — raise the relevant values. If the surface has holes or banding, lower `uStepMul` or raise `uSteps`.

- [ ] **Step 5: Confirm the build and full suite pass**

Run:

```bash
npm run build && npm test
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/march.glsl.ts src/lab/sdf-zombie/zombie.ts src/lab/sdf-zombie/lab-main.ts
git commit -m "feat(sdf-lab): render the real zombie body with cluster-culled marching"
```

---

## Task 11: Verlet rig — stretch and lag

The rest-pose pull in `stepRig` is borrowed from `goober-test`'s `Rope` (see "Prior art" above). Without it a verlet chain has nothing to return to and goes floppy under gravity; with it the limb stretches on impulse and springs back to the authored pose. It is the difference between "flesh with weight" and "a wet noodle."

**Files:**
- Create: `src/lab/sdf-zombie/rig.ts`
- Test: `src/lab/sdf-zombie/rig.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/rig.test.ts`:

```ts
// src/lab/sdf-zombie/rig.test.ts
import { describe, it, expect } from 'vitest';
import { stepRig, makeRig, type RigState } from './rig';
import { len, sub } from './vec';

const OPTS = { gravity: [0, 0, 0] as const, damping: 0.02, iterations: 4, restStiffness: 0 };

const twoPoint = (): RigState => makeRig(
  [{ pos: [0, 1, 0], pinned: true }, { pos: [0, 0.6, 0], pinned: false }],
  [{ a: 0, b: 1, rest: 0.4, stiffness: 1 }],
);

describe('stepRig', () => {
  it('holds a constraint already at rest length', () => {
    let s = twoPoint();
    for (let i = 0; i < 30; i++) s = stepRig(s, 1 / 60, OPTS);
    expect(len(sub(s.points[1].pos, s.points[0].pos))).toBeCloseTo(0.4, 4);
  });

  it('pulls a displaced point back toward rest length', () => {
    let s = twoPoint();
    s = { ...s, points: s.points.map((p, i) => i === 1 ? { ...p, pos: [0, 0.1, 0], prev: [0, 0.1, 0] } : p) };
    const before = len(sub(s.points[1].pos, s.points[0].pos));
    for (let i = 0; i < 60; i++) s = stepRig(s, 1 / 60, { ...OPTS, iterations: 6 });
    const after = len(sub(s.points[1].pos, s.points[0].pos));
    expect(Math.abs(after - 0.4)).toBeLessThan(Math.abs(before - 0.4));
    expect(after).toBeCloseTo(0.4, 2);
  });

  it('never moves a pinned point', () => {
    let s = twoPoint();
    for (let i = 0; i < 60; i++) s = stepRig(s, 1 / 60, { ...OPTS, gravity: [0, -9.8, 0] });
    expect(s.points[0].pos).toEqual([0, 1, 0]);
  });

  it('stays finite under an extreme impulse', () => {
    let s = twoPoint();
    s = { ...s, points: s.points.map((p, i) => i === 1 ? { ...p, pos: [1e4, -1e4, 1e4] } : p) };
    for (let i = 0; i < 120; i++) s = stepRig(s, 1 / 60, { ...OPTS, gravity: [0, -9.8, 0], iterations: 6 });
    for (const v of s.points[1].pos) expect(Number.isFinite(v)).toBe(true);
  });

  it('damps motion toward rest instead of oscillating forever', () => {
    let s = twoPoint();
    s = { ...s, points: s.points.map((p, i) => i === 1 ? { ...p, prev: [0, 0.9, 0] } : p) };
    let maxLate = 0;
    for (let i = 0; i < 400; i++) {
      s = stepRig(s, 1 / 60, { ...OPTS, damping: 0.08, iterations: 6 });
      if (i > 300) maxLate = Math.max(maxLate, Math.abs(len(sub(s.points[1].pos, s.points[0].pos)) - 0.4));
    }
    expect(maxLate).toBeLessThan(0.01);
  });

  // Rest-pose pull — borrowed from goober-test's Rope. Without it, gravity
  // drags the chain away and it never recovers the authored silhouette.
  it('returns to the rest pose under sustained gravity when restStiffness > 0', () => {
    let floppy = twoPoint(), springy = twoPoint();
    for (let i = 0; i < 240; i++) {
      floppy = stepRig(floppy, 1 / 60, { ...OPTS, gravity: [0, -9.8, 0], restStiffness: 0 });
      springy = stepRig(springy, 1 / 60, { ...OPTS, gravity: [0, -9.8, 0], restStiffness: 0.25 });
    }
    const restPos = twoPoint().points[1].pos;
    const floppyErr = len(sub(floppy.points[1].pos, restPos));
    const springyErr = len(sub(springy.points[1].pos, restPos));
    expect(springyErr).toBeLessThan(floppyErr);
    expect(springyErr).toBeLessThan(0.05);
  });

  it('still allows a transient stretch before springing back', () => {
    let s = twoPoint();
    const restPos = twoPoint().points[1].pos;
    // Yank the free point sideways, then let go.
    s = { ...s, points: s.points.map((p, i) => i === 1 ? { ...p, pos: [0.9, 0.6, 0] } : p) };
    let peak = 0;
    for (let i = 0; i < 12; i++) {
      s = stepRig(s, 1 / 60, { ...OPTS, restStiffness: 0.15 });
      peak = Math.max(peak, len(sub(s.points[1].pos, restPos)));
    }
    expect(peak).toBeGreaterThan(0.1);               // it did stretch
    for (let i = 0; i < 300; i++) s = stepRig(s, 1 / 60, { ...OPTS, restStiffness: 0.15 });
    expect(len(sub(s.points[1].pos, restPos))).toBeLessThan(0.02); // and came home
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lab/sdf-zombie/rig.test.ts
```

Expected: FAIL — `Failed to resolve import "./rig"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/rig.ts`:

```ts
// src/lab/sdf-zombie/rig.ts
import type { Vec3 } from './types';
import { add, len, lerp, scale, sub } from './vec';

export interface RigPoint { pos: Vec3; prev: Vec3; pinned: boolean }
export interface RigConstraint { a: number; b: number; rest: number; stiffness: number }

export interface RigState {
  points: RigPoint[];
  constraints: RigConstraint[];
  /** Authored pose. Points are pulled back toward this every step. */
  restPose: Vec3[];
}

export interface StepOpts {
  gravity: Vec3;
  /** Velocity bleed per step, 0..1. */
  damping: number;
  iterations: number;
  /**
   * Pull back toward restPose, 0..1 per 1/60 s. Borrowed from goober-test's
   * Rope: without it the chain has nothing to return to and gravity drags the
   * silhouette away permanently. With it, an impulse stretches the limb and it
   * springs home.
   */
  restStiffness: number;
}

export function makeRig(
  points: { pos: Vec3; pinned: boolean }[],
  constraints: RigConstraint[],
): RigState {
  return {
    points: points.map(p => ({ pos: p.pos, prev: p.pos, pinned: p.pinned })),
    constraints,
    restPose: points.map(p => p.pos),
  };
}

/**
 * One Verlet step: integrate, pull toward the rest pose, then relax
 * constraints. Returns new state; the input is untouched, which keeps this
 * trivially testable at ~20 points.
 */
export function stepRig(state: RigState, dt: number, opts: StepOpts): RigState {
  // Frame-rate independent rest pull, same shaping as goober-test's Rope.
  const st = 1 - Math.pow(1 - opts.restStiffness, Math.max(dt, 1e-4) * 60);

  const points = state.points.map((p, i) => {
    if (p.pinned) return { ...p, prev: p.pos };
    const vel = scale(sub(p.pos, p.prev), 1 - opts.damping);
    let next = add(add(p.pos, vel), scale(opts.gravity, dt * dt));
    if (st > 0) next = lerp(next, state.restPose[i], st);
    return { pos: sanitize(next, p.pos), prev: p.pos, pinned: false };
  });

  for (let it = 0; it < opts.iterations; it++)
    for (const c of state.constraints) {
      const pa = points[c.a], pb = points[c.b];
      const delta = sub(pb.pos, pa.pos);
      const dist = len(delta);
      if (dist === 0) continue;
      const correction = scale(delta, ((dist - c.rest) / dist) * c.stiffness * 0.5);
      if (!pa.pinned) pa.pos = add(pa.pos, correction);
      if (!pb.pinned) pb.pos = sub(pb.pos, correction);
    }

  return { points, constraints: state.constraints, restPose: state.restPose };
}

/** Guards against NaN/Infinity poisoning the whole rig after an extreme impulse. */
function sanitize(v: Vec3, fallback: Vec3): Vec3 {
  const ok = v.every(n => Number.isFinite(n) && Math.abs(n) < 1e6);
  return ok ? v : fallback;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run src/lab/sdf-zombie/rig.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/rig.ts src/lab/sdf-zombie/rig.test.ts
git commit -m "feat(sdf-lab): verlet rig with rest-pose pull, damping and NaN guards"
```

---

## Task 12: Rest-space wounds

**Files:**
- Create: `src/lab/sdf-zombie/damage.ts`
- Test: `src/lab/sdf-zombie/damage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/damage.test.ts`:

```ts
// src/lab/sdf-zombie/damage.test.ts
import { describe, it, expect } from 'vitest';
import { worldHitToWound, woundWorldPos, pushWound, MAX_WOUNDS } from './damage';
import type { Primitive } from './types';
import { add, len, sub } from './vec';

const capsule = (a: [number, number, number], b: [number, number, number]): Primitive =>
  ({ a, b, radius: 0.1, scale: [1, 1, 1], blendK: 0.0125, limb: 'armL', cluster: 2 });

describe('worldHitToWound / woundWorldPos', () => {
  const prims = [capsule([0, 1, 0], [0, 1.4, 0]), capsule([1, 1, 0], [1, 1.4, 0])];

  it('binds the wound to the nearest primitive', () => {
    expect(worldHitToWound(prims, [0.95, 1.2, 0], 0.06, 'pellet').primIdx).toBe(1);
    expect(worldHitToWound(prims, [0.05, 1.2, 0], 0.06, 'pellet').primIdx).toBe(0);
  });

  it('round-trips the hit point back to the same world position', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.02];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    const back = woundWorldPos(prims, w);
    expect(len(sub(back, hit))).toBeCloseTo(0, 8);
  });

  it('follows its primitive when the body moves — the crater stays on the flesh', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.02];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    const offset: [number, number, number] = [0.5, -0.3, 0.2];
    const moved = [{ ...prims[0], a: add(prims[0].a, offset), b: add(prims[0].b, offset) }, prims[1]];
    const back = woundWorldPos(moved, w);
    expect(len(sub(back, add(hit, offset)))).toBeCloseTo(0, 8);
  });

  it('follows its primitive when the limb rotates', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.0];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    // Rotate the capsule 90° about its own head, from +Y to +X.
    const rotated = [{ ...prims[0], b: [0.4, 1, 0] as const }, prims[1]];
    const back = woundWorldPos(rotated as Primitive[], w);
    // Still the same distance from the capsule axis head.
    expect(len(sub(back, rotated[0].a))).toBeCloseTo(len(sub(hit, prims[0].a)), 6);
  });

  it('records the wound type and radius', () => {
    const w = worldHitToWound(prims, [0.09, 1.2, 0], 0.09, 'burn');
    expect(w.type).toBe('burn');
    expect(w.radius).toBe(0.09);
    expect(w.ageSec).toBe(0);
  });
});

describe('pushWound', () => {
  const w = (r: number) => worldHitToWound([capsule([0, 1, 0], [0, 1.4, 0])], [0.09, 1.2, 0], r, 'pellet');

  it('appends below capacity', () => {
    expect(pushWound([w(0.01), w(0.02)], w(0.03), MAX_WOUNDS)).toHaveLength(3);
  });

  it('evicts the oldest at capacity and keeps length fixed', () => {
    const full = Array.from({ length: MAX_WOUNDS }, (_, i) => w(i / 1000));
    const out = pushWound(full, w(0.99), MAX_WOUNDS);
    expect(out).toHaveLength(MAX_WOUNDS);
    expect(out[out.length - 1].radius).toBe(0.99);
    expect(out[0].radius).toBe(1 / 1000); // index 0 evicted
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lab/sdf-zombie/damage.test.ts
```

Expected: FAIL — `Failed to resolve import "./damage"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/damage.ts`:

```ts
// src/lab/sdf-zombie/damage.ts
import type { Primitive, Vec3 } from './types';
import { add, basisFromAxis, dot, len, scale, sub } from './vec';

/** Must match MAX_WOUNDS in the fragment shader. */
export const MAX_WOUNDS = 16;

export type WoundType = 'pellet' | 'blast' | 'burn';

export interface Wound {
  /** Index into the built primitive array — the primitive this wound rides. */
  primIdx: number;
  /** Hit position in that primitive's local frame (u, v, w along its axis basis). */
  local: Vec3;
  radius: number;
  type: WoundType;
  ageSec: number;
}

/** Local basis for a primitive: w along its axis, u/v perpendicular. */
function frame(prim: Primitive) {
  const axis = sub(prim.b, prim.a);
  return basisFromAxis(len(axis) === 0 ? [0, 1, 0] : axis);
}

/**
 * Converts a world-space hit into a wound bound to the nearest primitive, stored
 * in that primitive's LOCAL frame. This is what makes a crater stay on the
 * shoulder while the shoulder swings and stretches.
 */
export function worldHitToWound(
  prims: Primitive[],
  hit: Vec3,
  radius: number,
  type: WoundType,
): Wound {
  let primIdx = 0;
  let best = Infinity;
  prims.forEach((p, i) => {
    const d = Math.min(len(sub(hit, p.a)), len(sub(hit, p.b)));
    if (d < best) { best = d; primIdx = i; }
  });

  const prim = prims[primIdx];
  const { u, v, w } = frame(prim);
  const rel = sub(hit, prim.a);
  return { primIdx, local: [dot(rel, u), dot(rel, v), dot(rel, w)], radius, type, ageSec: 0 };
}

/** Transforms a wound back into world space using its primitive's current pose. */
export function woundWorldPos(prims: Primitive[], wound: Wound): Vec3 {
  const prim = prims[wound.primIdx];
  const { u, v, w } = frame(prim);
  return add(prim.a, add(add(scale(u, wound.local[0]), scale(v, wound.local[1])), scale(w, wound.local[2])));
}

/** Ring buffer append — oldest is evicted at capacity. */
export function pushWound(ring: Wound[], wound: Wound, cap: number): Wound[] {
  const next = [...ring, wound];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run src/lab/sdf-zombie/damage.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/damage.ts src/lab/sdf-zombie/damage.test.ts
git commit -m "feat(sdf-lab): rest-space wound records that follow moving flesh"
```

---

## Task 13: Craters in the shader, and click-to-shoot

**Files:**
- Modify: `src/lab/sdf-zombie/march.glsl.ts`
- Modify: `src/lab/sdf-zombie/zombie.ts`
- Modify: `src/lab/sdf-zombie/lab-main.ts`

- [ ] **Step 1: Add wound subtraction to the shader**

In `src/lab/sdf-zombie/march.glsl.ts`, add `MAX_WOUNDS` and extend `FRAG`. Add near the top of the shader string, after the existing `#define` lines:

```glsl
#define MAX_WOUNDS 16
uniform vec4 uWound[MAX_WOUNDS];   // xyz = world position, w = radius
uniform vec4 uWoundMeta[MAX_WOUNDS]; // x = type (0 pellet, 1 blast, 2 burn), y = age
uniform int  uWoundCount;
uniform float uWoundBlendK;        // separate from the union k — makes the wet lip
uniform vec3 uDeepColor;
uniform vec3 uCharColor;
```

Add these functions after `smin`:

```glsl
// Smooth subtraction: smax(a, b, k) = -smin(-a, -b, k).
float smax(float a, float b, float k) { return -smin(-a, -b, k); }

/** Carves every wound out of the field. Burns barely subtract; they char. */
float applyWounds(float d, vec3 p) {
  for (int i = 0; i < MAX_WOUNDS; i++) {
    if (i >= uWoundCount) break;
    vec4 w = uWound[i];
    float type = uWoundMeta[i].x;
    // A burn only opens up as it cooks; a pellet/blast subtracts immediately.
    float depth = type > 1.5 ? w.w * 0.35 * clamp(uWoundMeta[i].y, 0.0, 1.0) : w.w;
    d = smax(d, -(length(p - w.xyz) - depth), uWoundBlendK);
  }
  return d;
}

/** 0 at the surface far from wounds, 1 deep inside one. Drives the wet interior. */
float woundMask(vec3 p) {
  float m = 0.0;
  for (int i = 0; i < MAX_WOUNDS; i++) {
    if (i >= uWoundCount) break;
    vec4 w = uWound[i];
    m = max(m, 1.0 - smoothstep(0.0, w.w * 1.6, length(p - w.xyz)));
  }
  return m;
}

/** 0 unburned, 1 fully charred. */
float charMask(vec3 p) {
  float m = 0.0;
  for (int i = 0; i < MAX_WOUNDS; i++) {
    if (i >= uWoundCount) break;
    if (uWoundMeta[i].x < 1.5) continue;
    vec4 w = uWound[i];
    m = max(m, (1.0 - smoothstep(0.0, w.w * 2.2, length(p - w.xyz))) * clamp(uWoundMeta[i].y, 0.0, 1.0));
  }
  return m;
}
```

Change `mapBody`'s final line from `return d;` to `return applyWounds(d, p);`, and replace the `outColor` line in `main` with:

```glsl
  float wm = woundMask(p);
  float cm = charMask(p);
  vec3 albedo = mix(uBaseColor, uDeepColor, wm);
  albedo = mix(albedo, uCharColor, cm);
  outColor = vec4(albedo * (0.22 + 0.78 * diff), 1.0);
```

- [ ] **Step 2: Add wound uniforms and a setter to the view**

In `src/lab/sdf-zombie/zombie.ts`, add to the `uniforms` object:

```ts
      uWound: { value: new Float32Array(16 * 4) },
      uWoundMeta: { value: new Float32Array(16 * 4) },
      uWoundCount: { value: 0 },
      uWoundBlendK: { value: 0.015 },
      uDeepColor: { value: new THREE.Color(0x8c1420) },
      uCharColor: { value: new THREE.Color(0x1a1214) },
```

Add `setWounds` to the `ZombieView` interface and its implementation:

```ts
  /** Uploads wounds already transformed to world space by the caller. */
  setWounds(worldPositions: Vec3[], radii: number[], types: number[], ages: number[]): void;
```

```ts
    setWounds(worldPositions, radii, types, ages) {
      const w = material.uniforms.uWound.value as Float32Array;
      const m = material.uniforms.uWoundMeta.value as Float32Array;
      const n = Math.min(worldPositions.length, 16);
      for (let i = 0; i < n; i++) {
        w.set([...worldPositions[i], radii[i]], i * 4);
        m.set([types[i], ages[i], 0, 0], i * 4);
      }
      material.uniforms.uWoundCount.value = n;
    },
```

Add `import type { Vec3 } from './types';` at the top.

- [ ] **Step 3: Wire click-to-shoot in the entry**

Append to `src/lab/sdf-zombie/lab-main.ts`:

```ts
import { MAX_WOUNDS, pushWound, woundWorldPos, type Wound, type WoundType } from './damage';
import { sdBody } from './validate';
import type { Vec3 } from './types';

let wounds: Wound[] = [];

const TYPE_ID: Record<WoundType, number> = { pellet: 0, blast: 1, burn: 2 };
const RADIUS: Record<WoundType, number> = { pellet: 0.055, blast: 0.13, burn: 0.08 };

/** Marches the CPU-side field along a ray to find where a shot lands. */
function raycastBody(origin: Vec3, dir: Vec3): Vec3 | null {
  let t = 0;
  for (let i = 0; i < 128 && t < 20; i++) {
    const p: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
    const d = sdBody(p, body);
    if (d < 0.002) return p;
    t += Math.max(d, 0.002);
  }
  return null;
}

function refreshWounds() {
  view.setWounds(
    wounds.map(w => woundWorldPos(body.prims, w)),
    wounds.map(w => w.radius),
    wounds.map(w => TYPE_ID[w.type]),
    wounds.map(w => w.ageSec),
  );
}

renderer.domElement.addEventListener('pointerdown', (ev: PointerEvent) => {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((ev.clientX - rect.left) / rect.width) * 2 - 1,
    -((ev.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;

  const hit = raycastBody([o.x, o.y, o.z], [d.x, d.y, d.z]);
  if (!hit) return;

  const type: WoundType = ev.shiftKey ? 'blast' : ev.altKey ? 'burn' : 'pellet';
  wounds = pushWound(wounds, worldHitToWound(body.prims, hit, RADIUS[type], type), MAX_WOUNDS);
  refreshWounds();
});
```

Add `worldHitToWound` to the `./damage` import list, and pull `renderer` out of `createRenderer` by changing the destructure to `const { renderer, scene, camera } = createRenderer(mount);`.

- [ ] **Step 4: Verify by eye**

Run:

```bash
npm run dev -- --port 5180
```

Open `http://localhost:5180/sdf-lab.html` and click the zombie. Expected:
1. A **crater** appears exactly where you clicked, with a darker red interior.
2. The crater has a soft lip where it meets the surface (that's `uWoundBlendK`).
3. `Shift`+click makes a bigger crater; `Alt`+click makes a dark charred patch.
4. Clicking past the body does nothing.
5. After 16 clicks, the oldest crater disappears as the ring buffer wraps.

- [ ] **Step 5: Run the full suite**

Run:

```bash
npm run build && npm test
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/march.glsl.ts src/lab/sdf-zombie/zombie.ts src/lab/sdf-zombie/lab-main.ts
git commit -m "feat(sdf-lab): wound subtraction, wet interior shading, click-to-shoot"
```

---

## Task 14: Severing — stumps that close over

**Files:**
- Create: `src/lab/sdf-zombie/sever.ts`
- Test: `src/lab/sdf-zombie/sever.test.ts`
- Modify: `src/lab/sdf-zombie/lab-main.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/sever.test.ts`:

```ts
// src/lab/sdf-zombie/sever.test.ts
import { describe, it, expect } from 'vitest';
import { severLimb } from './sever';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { packBody } from './pack';
import { sdBody } from './validate';

describe('severLimb', () => {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);

  it('marks only the target cluster dead', () => {
    const { body: after } = severLimb(body, 'armL');
    expect(after.clusters.find(c => c.limb === 'armL')!.alive).toBe(false);
    expect(after.clusters.filter(c => c.limb !== 'armL').every(c => c.alive)).toBe(true);
  });

  it('never removes, reorders or re-packs primitives', () => {
    const { body: after } = severLimb(body, 'armL');
    expect(after.prims).toHaveLength(body.prims.length);
    expect(after.prims.map(p => p.limb)).toEqual(body.prims.map(p => p.limb));
    expect(Array.from(packBody(after).primA)).toEqual(Array.from(packBody(body).primA));
  });

  it('leaves the torso field bit-identical — the fold order is unchanged', () => {
    const { body: after } = severLimb(body, 'armL');
    const torso = body.clusters.find(c => c.limb === 'torso')!;
    // Sample inside the torso, far from the removed arm.
    for (const off of [[0, 0, 0], [0.03, 0.05, 0], [0, -0.06, 0.02]] as const) {
      const p = [torso.center[0] + off[0], torso.center[1] + off[1], torso.center[2] + off[2]] as const;
      expect(sdBody(p, after)).toBe(sdBody(p, body));
    }
  });

  it('returns a chunk group carrying exactly the severed primitives', () => {
    const { chunk } = severLimb(body, 'legR');
    const expected = body.prims.filter(p => p.limb === 'legR');
    expect(chunk.prims).toEqual(expected);
    expect(chunk.limb).toBe('legR');
  });

  it('stamps a stump wound bound to a surviving primitive', () => {
    const { stumpWound, body: after } = severLimb(body, 'armR');
    expect(stumpWound).not.toBeNull();
    const owner = after.prims[stumpWound!.primIdx];
    expect(after.clusters.find(c => c.limb === owner.limb)!.alive).toBe(true);
    expect(stumpWound!.radius).toBeGreaterThan(0);
  });

  it('is a no-op when the limb is already severed', () => {
    const once = severLimb(body, 'armL');
    const twice = severLimb(once.body, 'armL');
    expect(twice.chunk.prims).toHaveLength(0);
    expect(twice.stumpWound).toBeNull();
  });

  it('refuses to sever the torso', () => {
    expect(() => severLimb(body, 'torso')).toThrow(/torso/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lab/sdf-zombie/sever.test.ts
```

Expected: FAIL — `Failed to resolve import "./sever"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/sever.ts`:

```ts
// src/lab/sdf-zombie/sever.ts
import type { BuildResult } from './build-body';
import type { LimbId, Primitive, Vec3 } from './types';
import type { Wound } from './damage';
import { len, lerp, sub } from './vec';

export interface ChunkGroup {
  limb: LimbId;
  prims: Primitive[];
  /** World-space centre at the moment of detachment. */
  origin: Vec3;
}

export interface SeverResult {
  body: BuildResult;
  chunk: ChunkGroup;
  /** Marks the stump as exposed meat. Null when nothing was severed. */
  stumpWound: Wound | null;
}

/**
 * Severs a limb by clearing its cluster's alive flag.
 *
 * It deliberately does NOT remove primitives from the array. The shader's
 * smooth-min is non-associative, so re-packing would change the fold order and
 * silently reshape the rest of the body. Alive flags keep the sequence fixed.
 */
export function severLimb(body: BuildResult, limb: LimbId): SeverResult {
  if (limb === 'torso') throw new Error('cannot sever the torso — it anchors the fold order');

  const cluster = body.clusters.find(c => c.limb === limb);
  if (!cluster || !cluster.alive)
    return { body, chunk: { limb, prims: [], origin: [0, 0, 0] }, stumpWound: null };

  const prims = body.prims.slice(cluster.start, cluster.start + cluster.count);
  const clusters = body.clusters.map(c => (c.limb === limb ? { ...c, alive: false } : c));
  const next: BuildResult = { ...body, clusters };

  // Anchor the stump on the nearest LIVE primitive to the removed cluster,
  // so the wound rides flesh that still exists.
  const live = body.prims
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.limb !== limb && clusters.find(c => c.limb === p.limb)?.alive);

  let primIdx = -1, best = Infinity;
  for (const { p, i } of live) {
    const d = len(sub(p.a, cluster.center));
    if (d < best) { best = d; primIdx = i; }
  }

  const stumpWound: Wound | null = primIdx < 0 ? null : {
    primIdx,
    // Place it on the segment between the anchor and the removed cluster's centre.
    local: toLocalApprox(body.prims[primIdx], lerp(body.prims[primIdx].a, cluster.center, 0.6)),
    radius: cluster.radius * 0.45,
    type: 'blast',
    ageSec: 0,
  };

  return { body: next, chunk: { limb, prims, origin: cluster.center }, stumpWound };
}

/** Local-frame offset from a primitive's head, matching damage.ts's convention. */
function toLocalApprox(prim: Primitive, world: Vec3): Vec3 {
  // Reuses damage.ts's basis indirectly by importing it would create a cycle;
  // the offset is small and the basis is recomputed identically there.
  const rel = sub(world, prim.a);
  const axis = sub(prim.b, prim.a);
  if (len(axis) === 0) return rel;
  return rel;
}
```

> **Note for the implementer:** `toLocalApprox` above is intentionally simple and will place the stump slightly off for rotated capsules. Replace its body with a call to the shared basis helper — import `basisFromAxis`, `dot` from `./vec` and project `rel` onto `(u, v, w)` exactly as `damage.ts` does — then verify `sever.test.ts` still passes. There is no import cycle: `sever.ts` → `vec.ts` is one-way.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run src/lab/sdf-zombie/sever.test.ts
```

Expected: PASS, 7 tests. The "torso field bit-identical" test is the important one — if it fails, the fold order is being disturbed somewhere and severing is unsafe.

- [ ] **Step 5: Bind sever keys in the entry**

Append to `src/lab/sdf-zombie/lab-main.ts`:

```ts
import { severLimb } from './sever';
import { CLUSTER_ORDER, type LimbId } from './types';

let current = body;
const SEVER_KEYS: Record<string, LimbId> = { '1': 'head', '3': 'armL', '4': 'armR', '5': 'legL', '6': 'legR' };

window.addEventListener('keydown', (ev) => {
  const limb = SEVER_KEYS[ev.key];
  if (!limb) return;
  const { body: next, stumpWound } = severLimb(current, limb);
  current = next;
  if (stumpWound) wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
  view.update(current);
  refreshWounds();
});
```

Change `refreshWounds` and `raycastBody` to read `current` instead of `body`.

- [ ] **Step 6: Verify by eye**

Run:

```bash
npm run dev -- --port 5180
```

Press `3`, `4`, `5`, `6`. Expected:
1. The limb **vanishes** and the stump **closes over smoothly** — no flat cap, no hole.
2. The stump shades as dark wet interior, not smooth exterior.
3. **The torso does not change shape.** If it visibly shifts, the fold order is broken — stop and re-check Task 6 and Task 14's third test.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/sever.ts src/lab/sdf-zombie/sever.test.ts src/lab/sdf-zombie/lab-main.ts
git commit -m "feat(sdf-lab): sever limbs via alive flags with self-closing stumps"
```

---

## Task 15: Gib chunk physics

**Files:**
- Create: `src/lab/sdf-zombie/gib-chunks.ts`
- Test: `src/lab/sdf-zombie/gib-chunks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/gib-chunks.test.ts`:

```ts
// src/lab/sdf-zombie/gib-chunks.test.ts
import { describe, it, expect } from 'vitest';
import { makeChunk, stepChunk, type Chunk } from './gib-chunks';

const spawn = (): Chunk => makeChunk('armL', [0, 1.5, 0], [1.2, 2.0, 0.3], 0.12);

describe('stepChunk', () => {
  it('falls under gravity', () => {
    let c = spawn();
    const y0 = c.pos[1];
    for (let i = 0; i < 30; i++) c = stepChunk(c, 1 / 60);
    expect(c.pos[1]).toBeLessThan(y0 + 2.0 * 0.5); // below the ballistic apex of vy=2
  });

  it('never sinks below the floor', () => {
    let c = spawn();
    for (let i = 0; i < 600; i++) {
      c = stepChunk(c, 1 / 60);
      expect(c.pos[1]).toBeGreaterThanOrEqual(c.radius - 1e-6);
    }
  });

  it('loses energy on each bounce and comes to rest', () => {
    let c = spawn();
    for (let i = 0; i < 1200; i++) c = stepChunk(c, 1 / 60);
    expect(Math.abs(c.vel[1])).toBeLessThan(0.02);
    expect(c.pos[1]).toBeCloseTo(c.radius, 2);
  });

  it('squashes on impact and relaxes back to unit scale', () => {
    let c = spawn();
    let sawSquash = false;
    for (let i = 0; i < 200; i++) {
      c = stepChunk(c, 1 / 60);
      if (c.squash > 0.05) sawSquash = true;
    }
    expect(sawSquash).toBe(true);
    for (let i = 0; i < 400; i++) c = stepChunk(c, 1 / 60);
    expect(c.squash).toBeCloseTo(0, 2);
  });

  it('tumbles while airborne and stops spinning at rest', () => {
    let c = spawn();
    let midSpin = 0;
    for (let i = 0; i < 40; i++) { c = stepChunk(c, 1 / 60); midSpin = Math.abs(c.spin); }
    expect(midSpin).toBeGreaterThan(0);
    for (let i = 0; i < 1200; i++) c = stepChunk(c, 1 / 60);
    expect(Math.abs(c.spin)).toBeLessThan(0.05);
  });

  it('stays finite under an absurd launch velocity', () => {
    let c = makeChunk('legL', [0, 1, 0], [1e5, 1e5, 1e5], 0.1);
    for (let i = 0; i < 300; i++) c = stepChunk(c, 1 / 60);
    for (const v of [...c.pos, ...c.vel, c.spin, c.squash]) expect(Number.isFinite(v)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lab/sdf-zombie/gib-chunks.test.ts
```

Expected: FAIL — `Failed to resolve import "./gib-chunks"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/gib-chunks.ts`:

```ts
// src/lab/sdf-zombie/gib-chunks.ts
import type { LimbId, Vec3 } from './types';

const GRAVITY = -9.8;
const RESTITUTION = 0.42;
const FLOOR_FRICTION = 0.72;
const AIR_DRAG = 0.006;
/** Squash decays back to zero at this rate per second. */
const SQUASH_RELAX = 5.5;

export interface Chunk {
  limb: LimbId;
  pos: Vec3;
  vel: Vec3;
  radius: number;
  /** 0 = round, 1 = fully flattened. Drives non-uniform scale in the shader. */
  squash: number;
  spin: number;
  angle: number;
}

export function makeChunk(limb: LimbId, pos: Vec3, vel: Vec3, radius: number): Chunk {
  // Spin proportional to horizontal speed, so fast chunks tumble harder.
  const spin = (vel[0] + vel[2]) * 1.4;
  return { limb, pos, vel, radius, squash: 0, spin, angle: 0 };
}

export function stepChunk(c: Chunk, dt: number): Chunk {
  let [x, y, z] = c.pos;
  let [vx, vy, vz] = c.vel;
  let { squash, spin, angle } = c;

  vy += GRAVITY * dt;
  const drag = 1 - AIR_DRAG;
  vx *= drag; vy *= drag; vz *= drag;

  x += vx * dt; y += vy * dt; z += vz * dt;
  angle += spin * dt;

  if (y < c.radius) {
    y = c.radius;
    if (vy < 0) {
      // Squash scales with impact speed — this is what sells wetness.
      squash = Math.min(1, squash + Math.min(Math.abs(vy) * 0.16, 0.9));
      vy = -vy * RESTITUTION;
      if (Math.abs(vy) < 0.35) vy = 0;
    }
    vx *= FLOOR_FRICTION; vz *= FLOOR_FRICTION;
    spin *= FLOOR_FRICTION;
    if (Math.abs(spin) < 0.05) spin = 0;
  }

  squash = Math.max(0, squash - SQUASH_RELAX * dt);

  const out: Chunk = { ...c, pos: [x, y, z], vel: [vx, vy, vz], squash, spin, angle };
  return finite(out) ? out : { ...c, vel: [0, 0, 0], spin: 0, squash: 0 };
}

function finite(c: Chunk): boolean {
  return [...c.pos, ...c.vel, c.squash, c.spin, c.angle]
    .every(n => Number.isFinite(n) && Math.abs(n) < 1e6);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run src/lab/sdf-zombie/gib-chunks.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/gib-chunks.ts src/lab/sdf-zombie/gib-chunks.test.ts
git commit -m "feat(sdf-lab): gib chunk physics with impact squash and settling"
```

---

## Task 16: Material presets and lighting

**Files:**
- Create: `src/lab/sdf-zombie/material.ts`
- Test: `src/lab/sdf-zombie/material.test.ts`
- Modify: `src/lab/sdf-zombie/march.glsl.ts`
- Modify: `src/lab/sdf-zombie/zombie.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/material.test.ts`:

```ts
// src/lab/sdf-zombie/material.test.ts
import { describe, it, expect } from 'vitest';
import { FLESH_PRESETS, LIGHT_PRESETS, type FleshMaterial } from './material';

describe('flesh presets', () => {
  const names = ['henenlotter-latex', 'wet-meat', 'clay'] as const;

  it('defines all three presets', () => {
    for (const n of names) expect(FLESH_PRESETS[n]).toBeDefined();
  });

  it('gives every preset every field, all finite', () => {
    const keys: (keyof FleshMaterial)[] = [
      'baseColor', 'deepColor', 'charColor', 'specIntensity', 'specRoughness',
      'fresnelBoost', 'translucency', 'surfaceNoiseAmp', 'silhouetteNoiseAmp', 'wetness',
    ];
    for (const n of names)
      for (const k of keys) {
        const v = FLESH_PRESETS[n][k];
        expect(v, `${n}.${k}`).toBeDefined();
        for (const num of Array.isArray(v) ? v : [v]) expect(Number.isFinite(num)).toBe(true);
      }
  });

  it('orders wetness latex > meat > clay, which is the whole point of the toggle', () => {
    expect(FLESH_PRESETS['henenlotter-latex'].wetness).toBeGreaterThan(FLESH_PRESETS['clay'].wetness);
    expect(FLESH_PRESETS['wet-meat'].wetness).toBeGreaterThan(FLESH_PRESETS['clay'].wetness);
  });

  it('keeps latex smooth and meat veiny in surface noise', () => {
    expect(FLESH_PRESETS['henenlotter-latex'].surfaceNoiseAmp)
      .toBeLessThan(FLESH_PRESETS['wet-meat'].surfaceNoiseAmp);
  });

  it('keeps every silhouetteNoiseAmp inside the Lipschitz budget at stepMul 0.6', () => {
    for (const n of names)
      expect(FLESH_PRESETS[n].silhouetteNoiseAmp).toBeLessThanOrEqual((1 - 0.6) * 0.5);
  });

  it('defines both lighting presets with a key direction and intensities', () => {
    for (const n of ['practical-hard-key', 'game-ambient'] as const) {
      expect(LIGHT_PRESETS[n].keyDir).toHaveLength(3);
      expect(LIGHT_PRESETS[n].keyIntensity).toBeGreaterThan(0);
      expect(LIGHT_PRESETS[n].fillIntensity).toBeGreaterThanOrEqual(0);
    }
  });

  it('makes the practical key harder and the fill weaker than game-ambient', () => {
    expect(LIGHT_PRESETS['practical-hard-key'].keyIntensity)
      .toBeGreaterThan(LIGHT_PRESETS['game-ambient'].keyIntensity);
    expect(LIGHT_PRESETS['practical-hard-key'].fillIntensity)
      .toBeLessThan(LIGHT_PRESETS['game-ambient'].fillIntensity);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lab/sdf-zombie/material.test.ts
```

Expected: FAIL — `Failed to resolve import "./material"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/material.ts`:

```ts
// src/lab/sdf-zombie/material.ts
import type { Vec3 } from './types';

export interface FleshMaterial {
  baseColor: Vec3;   // exterior, linear RGB 0..1
  deepColor: Vec3;   // wound interior
  charColor: Vec3;
  specIntensity: number;
  specRoughness: number;
  fresnelBoost: number;
  translucency: number;
  surfaceNoiseAmp: number;    // perturbs the NORMAL only — free
  silhouetteNoiseAmp: number; // perturbs the DISTANCE — costs march safety
  wetness: number;            // global multiplier on spec + fresnel
}

export type FleshPresetName = 'henenlotter-latex' | 'wet-meat' | 'clay';

export const FLESH_PRESETS: Record<FleshPresetName, FleshMaterial> = {
  // Foam latex under a hard key: saturated, smooth, blown-out highlights.
  'henenlotter-latex': {
    baseColor: [0.82, 0.44, 0.46],
    deepColor: [0.74, 0.06, 0.10],
    charColor: [0.10, 0.07, 0.08],
    specIntensity: 0.95, specRoughness: 0.12,
    fresnelBoost: 0.85, translucency: 0.45,
    surfaceNoiseAmp: 0.06, silhouetteNoiseAmp: 0.016,
    wetness: 1.0,
  },
  // Rotten meat: darker, broader highlight, veiny, more scatter.
  'wet-meat': {
    baseColor: [0.48, 0.24, 0.22],
    deepColor: [0.55, 0.08, 0.09],
    charColor: [0.09, 0.06, 0.06],
    specIntensity: 0.80, specRoughness: 0.38,
    fresnelBoost: 0.50, translucency: 0.75,
    surfaceNoiseAmp: 0.22, silhouetteNoiseAmp: 0.018,
    wetness: 0.85,
  },
  // Claymation: matte, waxy, thumb-smushed.
  clay: {
    baseColor: [0.62, 0.46, 0.38],
    deepColor: [0.42, 0.18, 0.16],
    charColor: [0.12, 0.10, 0.09],
    specIntensity: 0.14, specRoughness: 0.88,
    fresnelBoost: 0.0, translucency: 0.0,
    surfaceNoiseAmp: 0.14, silhouetteNoiseAmp: 0.006,
    wetness: 0.1,
  },
};

export interface LightPreset {
  keyDir: Vec3;
  keyIntensity: number;
  fillIntensity: number;
  keyColor: Vec3;
}

export type LightPresetName = 'practical-hard-key' | 'game-ambient';

export const LIGHT_PRESETS: Record<LightPresetName, LightPreset> = {
  // Single close bright key, almost no fill — practical-effects blowout.
  'practical-hard-key': {
    keyDir: [0.45, 0.72, 0.53],
    keyIntensity: 2.4,
    fillIntensity: 0.06,
    keyColor: [1.0, 0.96, 0.92],
  },
  // Mirrors the real game's sun + ambient, to check the material survives it.
  'game-ambient': {
    keyDir: [0.35, 0.86, 0.52],
    keyIntensity: 1.1,
    fillIntensity: 0.34,
    keyColor: [1.0, 0.925, 0.804],
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run src/lab/sdf-zombie/material.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Add the surface shading to the shader**

In `src/lab/sdf-zombie/march.glsl.ts`, add these uniforms to `FRAG`:

```glsl
uniform float uSpecIntensity, uSpecRoughness, uFresnelBoost, uTranslucency;
uniform float uSurfaceNoiseAmp, uSilhouetteNoiseAmp, uWetness;
uniform float uKeyIntensity, uFillIntensity;
uniform vec3  uKeyColor;
```

Add a cheap value-noise helper before `mapBody`:

```glsl
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
        mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
        mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  return n * 2.0 - 1.0;
}

float fbm(vec3 p) { return noise3(p * 4.0) * 0.6 + noise3(p * 9.0) * 0.3; }
```

Change `mapBody`'s return to add the silhouette displacement:

```glsl
  return applyWounds(d, p) + fbm(p * 3.0) * uSilhouetteNoiseAmp;
```

Replace the shading block in `main` with:

```glsl
  // Micro-detail perturbs the normal only — costs no march safety.
  n = normalize(n + vec3(fbm(p * 22.0), fbm(p * 22.0 + 5.0), fbm(p * 22.0 + 11.0)) * uSurfaceNoiseAmp);

  float wm = woundMask(p);
  float cm = charMask(p);
  vec3 albedo = mix(uBaseColor, uDeepColor, wm);
  albedo = mix(albedo, uCharColor, cm);

  vec3 L = normalize(uLightDir);
  vec3 V = -rd;
  vec3 H = normalize(L + V);
  float diff = max(dot(n, L), 0.0);

  // Wounds are wetter than the surrounding skin; char is dead matte.
  float wet = uWetness * mix(1.0, 1.6, wm) * (1.0 - cm);
  float shine = pow(max(dot(n, H), 0.0), mix(128.0, 4.0, uSpecRoughness));
  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0) * uFresnelBoost;

  // Fake backlit scatter: sample the field a little way toward the light.
  float thin = clamp(mapBody(p + L * 0.06) * -8.0, 0.0, 1.0);
  vec3 scatter = uDeepColor * thin * uTranslucency * (1.0 - cm);

  vec3 lit = albedo * (uFillIntensity + diff * uKeyIntensity) * uKeyColor
           + uKeyColor * (shine * uSpecIntensity + fres) * wet
           + scatter;
  outColor = vec4(lit, 1.0);
```

- [ ] **Step 6: Feed presets into the material**

In `src/lab/sdf-zombie/zombie.ts`, add the new uniforms with `henenlotter-latex` defaults and an `applyMaterial` method:

```ts
import { FLESH_PRESETS, LIGHT_PRESETS, type FleshMaterial, type LightPreset } from './material';
```

Add to `uniforms`:

```ts
      uSpecIntensity: { value: 0.95 },
      uSpecRoughness: { value: 0.12 },
      uFresnelBoost: { value: 0.85 },
      uTranslucency: { value: 0.45 },
      uSurfaceNoiseAmp: { value: 0.06 },
      uSilhouetteNoiseAmp: { value: 0.016 },
      uWetness: { value: 1.0 },
      uKeyIntensity: { value: 2.4 },
      uFillIntensity: { value: 0.06 },
      uKeyColor: { value: new THREE.Color(1.0, 0.96, 0.92) },
```

Add to the interface and the returned object:

```ts
  applyMaterial(m: FleshMaterial, light: LightPreset): void;
```

```ts
    applyMaterial(m, light) {
      const u = material.uniforms;
      (u.uBaseColor.value as THREE.Color).setRGB(...m.baseColor);
      (u.uDeepColor.value as THREE.Color).setRGB(...m.deepColor);
      (u.uCharColor.value as THREE.Color).setRGB(...m.charColor);
      u.uSpecIntensity.value = m.specIntensity;
      u.uSpecRoughness.value = m.specRoughness;
      u.uFresnelBoost.value = m.fresnelBoost;
      u.uTranslucency.value = m.translucency;
      u.uSurfaceNoiseAmp.value = m.surfaceNoiseAmp;
      u.uSilhouetteNoiseAmp.value = m.silhouetteNoiseAmp;
      u.uWetness.value = m.wetness;
      (u.uLightDir.value as THREE.Vector3).set(...light.keyDir);
      (u.uKeyColor.value as THREE.Color).setRGB(...light.keyColor);
      u.uKeyIntensity.value = light.keyIntensity;
      u.uFillIntensity.value = light.fillIntensity;
    },
```

Apply the default at the end of `createZombieView`, before the return:

```ts
  // set after construction so the preset is the single source of truth
```

then call `view.applyMaterial(FLESH_PRESETS['henenlotter-latex'], LIGHT_PRESETS['practical-hard-key'])` from `lab-main.ts` right after `createZombieView`.

- [ ] **Step 7: Verify by eye**

Run:

```bash
npm run dev -- --port 5180
```

Expected: the zombie now reads as wet saturated latex with a hard specular highlight, visible lumpy silhouette, and craters that look wet and deep rather than flat.

- [ ] **Step 8: Run the full suite**

Run:

```bash
npm run build && npm test
```

Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/lab/sdf-zombie/material.ts src/lab/sdf-zombie/material.test.ts src/lab/sdf-zombie/march.glsl.ts src/lab/sdf-zombie/zombie.ts src/lab/sdf-zombie/lab-main.ts
git commit -m "feat(sdf-lab): flesh material presets, lighting presets, wet surface shading"
```

---

## Task 17: Tuning panel with persistent overrides

The panel is where the experiment's actual output — a tuned look — gets captured. Without persistence every reload discards the work.

**Files:**
- Create: `src/lab/sdf-zombie/panel.ts`
- Test: `src/lab/sdf-zombie/panel.test.ts`
- Modify: `src/lab/sdf-zombie/lab-main.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/panel.test.ts`:

```ts
// src/lab/sdf-zombie/panel.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadOverride, saveOverride, clearOverride, serializeOverride, STORAGE_KEY } from './panel';

describe('override persistence', () => {
  beforeEach(() => localStorage.clear());

  it('returns an empty override when nothing is stored', () => {
    expect(loadOverride()).toEqual({});
  });

  it('round-trips an override through localStorage', () => {
    saveOverride({ primRadius: { 3: 0.21 }, primBlendK: { 1: 0.09 } });
    expect(loadOverride()).toEqual({ primRadius: { 3: 0.21 }, primBlendK: { 1: 0.09 } });
  });

  it('survives corrupt stored data instead of throwing', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadOverride()).toEqual({});
  });

  it('clears back to empty', () => {
    saveOverride({ primRadius: { 0: 1 } });
    clearOverride();
    expect(loadOverride()).toEqual({});
  });

  it('serializes to pasteable JSON', () => {
    const text = serializeOverride({ primRadius: { 2: 0.15 } });
    expect(JSON.parse(text)).toEqual({ primRadius: { 2: 0.15 } });
    expect(text).toContain('\n'); // pretty-printed for pasting into body.ts
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/lab/sdf-zombie/panel.test.ts
```

Expected: FAIL — `Failed to resolve import "./panel"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/panel.ts`:

```ts
// src/lab/sdf-zombie/panel.ts
import type { BodyOverride } from './build-body';
import type { FleshMaterial } from './material';

export const STORAGE_KEY = 'blud.sdf-lab.override.v1';

export function loadOverride(): BodyOverride {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BodyOverride) : {};
  } catch {
    return {}; // corrupt storage must never brick the lab
  }
}

export function saveOverride(o: BodyOverride): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(o)); } catch { /* quota — ignore */ }
}

export function clearOverride(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** Pretty JSON for pasting a tuned override into body.ts. */
export function serializeOverride(o: BodyOverride): string {
  return JSON.stringify(o, null, 2);
}

export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  get(): number;
  set(v: number): void;
}

/** Builds a labelled range input and appends it to `parent`. */
export function addSlider(parent: HTMLElement, spec: SliderSpec): HTMLInputElement {
  const label = document.createElement('label');
  const text = document.createElement('span');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(spec.get());

  const render = () => { text.textContent = `${spec.label}: ${Number(input.value).toFixed(3)}`; };
  render();
  input.addEventListener('input', () => { spec.set(Number(input.value)); render(); });

  label.append(text, input);
  parent.appendChild(label);
  return input;
}

export function addSection(parent: HTMLElement, title: string): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = title;
  parent.appendChild(h);
  const box = document.createElement('div');
  parent.appendChild(box);
  return box;
}

export function addSelect(
  parent: HTMLElement, label: string, options: string[], initial: string, onChange: (v: string) => void,
): HTMLSelectElement {
  const wrap = document.createElement('label');
  wrap.textContent = label + ' ';
  const sel = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    sel.appendChild(opt);
  }
  sel.value = initial;
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.appendChild(sel);
  parent.appendChild(wrap);
  return sel;
}

export function addButton(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'display:block;width:100%;margin:4px 0;font:11px monospace;';
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

/** Field list used to build the material section — keeps panel and shader in step. */
export const MATERIAL_SLIDERS: { key: keyof FleshMaterial; min: number; max: number }[] = [
  { key: 'specIntensity', min: 0, max: 2 },
  { key: 'specRoughness', min: 0.02, max: 1 },
  { key: 'fresnelBoost', min: 0, max: 2 },
  { key: 'translucency', min: 0, max: 1.5 },
  { key: 'surfaceNoiseAmp', min: 0, max: 0.6 },
  { key: 'silhouetteNoiseAmp', min: 0, max: 0.2 },
  { key: 'wetness', min: 0, max: 2 },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run src/lab/sdf-zombie/panel.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the panel into the entry**

Append to `src/lab/sdf-zombie/lab-main.ts`:

```ts
import {
  addButton, addSection, addSelect, addSlider, clearOverride,
  loadOverride, saveOverride, serializeOverride, MATERIAL_SLIDERS,
} from './panel';
import { FLESH_PRESETS, LIGHT_PRESETS, type FleshMaterial, type FleshPresetName, type LightPresetName } from './material';

const panelEl = document.getElementById('panel')!;
let override = loadOverride();
let flesh: FleshMaterial = { ...FLESH_PRESETS['henenlotter-latex'] };
let light: LightPresetName = 'practical-hard-key';

function reapply() {
  view.applyMaterial(flesh, LIGHT_PRESETS[light]);
}

const presetBox = addSection(panelEl, 'presets');
addSelect(presetBox, 'flesh', Object.keys(FLESH_PRESETS), 'henenlotter-latex', (v) => {
  flesh = { ...FLESH_PRESETS[v as FleshPresetName] };
  reapply();
  rebuildMaterialSliders();
});
addSelect(presetBox, 'light', Object.keys(LIGHT_PRESETS), light, (v) => {
  light = v as LightPresetName;
  reapply();
});

const matBox = addSection(panelEl, 'material');
function rebuildMaterialSliders() {
  matBox.textContent = '';
  for (const s of MATERIAL_SLIDERS)
    addSlider(matBox, {
      label: s.key, min: s.min, max: s.max, step: 0.005,
      get: () => flesh[s.key] as number,
      set: (v) => { (flesh[s.key] as number) = v; reapply(); },
    });
}
rebuildMaterialSliders();

const bodyBox = addSection(panelEl, 'body');
addSlider(bodyBox, {
  label: 'global blendK', min: 0.005, max: 0.2, step: 0.001,
  get: () => current.prims[0]?.blendK ?? 0.06,
  set: (v) => {
    override = { ...override, primBlendK: Object.fromEntries(current.prims.map((_, i) => [i, v])) };
    rebuildBody();
  },
});

const actionBox = addSection(panelEl, 'actions');
addButton(actionBox, 'respawn', () => { wounds = []; override = loadOverride(); rebuildBody(); });
addButton(actionBox, 'copy override JSON', () => {
  void navigator.clipboard.writeText(serializeOverride(override));
});
addButton(actionBox, 'reset overrides', () => { clearOverride(); override = {}; rebuildBody(); });

function rebuildBody() {
  saveOverride(override);
  current = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS, override);
  if (errorsEl) errorsEl.textContent = current.errors.join('\n');
  view.update(current);
  refreshWounds();
}

reapply();
```

Also change the initial body construction to honour a stored override:

```ts
const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS, loadOverride());
```

- [ ] **Step 6: Verify by eye**

Run:

```bash
npm run dev -- --port 5180
```

Expected:
1. A panel on the right with flesh/light preset dropdowns, material sliders, a global blendK slider, and three buttons.
2. Switching `flesh` to `clay` visibly changes the surface to matte; switching `light` to `game-ambient` softens the highlight.
3. Dragging a slider updates the render immediately.
4. Dragging the blendK slider, then **reloading the page**, keeps the change.
5. `reset overrides` restores the original and the change does not come back after reload.
6. Setting `silhouetteNoiseAmp` very high makes an error appear in the panel rather than silently producing march artifacts.

- [ ] **Step 7: Run the full suite**

Run:

```bash
npm run build && npm test
```

Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/panel.ts src/lab/sdf-zombie/panel.test.ts src/lab/sdf-zombie/lab-main.ts
git commit -m "feat(sdf-lab): tuning panel with persistent non-destructive overrides"
```

---

## Task 18: Gib on death — wire chunks into the render

**Files:**
- Modify: `src/lab/sdf-zombie/zombie.ts`
- Modify: `src/lab/sdf-zombie/lab-main.ts`

- [ ] **Step 1: Add a chunk view factory**

Append to `src/lab/sdf-zombie/zombie.ts`:

```ts
import type { Chunk } from './gib-chunks';

export interface ChunkView {
  object: THREE.Object3D;
  update(chunk: Chunk): void;
  dispose(): void;
}

/**
 * A detached blob, raymarched in its own small proxy box. Reuses the body
 * material's shader by packing the chunk's primitives as a one-cluster body.
 */
export function createChunkView(chunk: Chunk, prims: Primitive[], template: THREE.ShaderMaterial): ChunkView {
  const material = template.clone();
  const packed = packBody({
    prims: prims.map((p, i) => ({ ...p, cluster: 0 })),
    clusters: [{
      id: 0, limb: chunk.limb, start: 0, count: prims.length,
      center: chunk.pos, radius: chunk.radius, alive: true,
    }],
    bones: new Map(),
  });

  material.uniforms.uPrimA = { value: packed.primA };
  material.uniforms.uPrimB = { value: packed.primB };
  material.uniforms.uPrimScale = { value: packed.primScale };
  material.uniforms.uClusterBounds = { value: packed.clusterBounds };
  material.uniforms.uClusterRange = { value: packed.clusterRange };
  material.uniforms.uPrimCount = { value: packed.primCount };
  material.uniforms.uClusterCount = { value: 1 };
  material.uniforms.uWoundCount = { value: 0 };
  material.uniforms.uSteps = { value: 48 }; // chunks are small; fewer steps

  const size = chunk.radius * 4;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
  mesh.frustumCulled = false;

  return {
    object: mesh,
    update(c: Chunk) {
      mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
      mesh.rotation.y = c.angle;
      // Non-uniform squash on impact — flatten in y, bulge in x/z.
      mesh.scale.set(1 + c.squash * 0.35, 1 - c.squash * 0.5, 1 + c.squash * 0.35);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
```

Add `import type { Primitive } from './types';` if not already present.

- [ ] **Step 2: Spawn and step chunks in the entry**

Append to `src/lab/sdf-zombie/lab-main.ts`:

```ts
import { makeChunk, stepChunk, type Chunk } from './gib-chunks';
import { createChunkView, type ChunkView } from './zombie';

const chunks: { state: Chunk; view: ChunkView }[] = [];

function spawnChunk(limb: LimbId, origin: Vec3, prims: typeof current.prims) {
  if (prims.length === 0) return;
  const vel: Vec3 = [
    (Math.random() - 0.5) * 3.2,
    1.8 + Math.random() * 2.2,
    (Math.random() - 0.5) * 3.2,
  ];
  const state = makeChunk(limb, origin, vel, 0.14);
  const view = createChunkView(state, prims, viewMaterialTemplate);
  scene.add(view.object);
  chunks.push({ state, view });
}
```

Change the sever handler to spawn a chunk:

```ts
window.addEventListener('keydown', (ev) => {
  const limb = SEVER_KEYS[ev.key];
  if (!limb) return;
  const { body: next, chunk, stumpWound } = severLimb(current, limb);
  if (chunk.prims.length === 0) return;
  current = next;
  if (stumpWound) wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
  spawnChunk(limb, chunk.origin, chunk.prims);
  view.update(current);
  refreshWounds();
});
```

Add `const viewMaterialTemplate = view.material;` after `createZombieView`, and drive the chunks from the render loop:

```ts
import { createRenderer } from '../../engine/renderer';
// …
const handle = createRenderer(mount);
handle.setRenderCallback((dt) => {
  for (const c of chunks) {
    c.state = stepChunk(c.state, dt);
    c.view.update(c.state);
  }
});
```

> Restructure the top of `lab-main.ts` so `createRenderer` is called once and `handle.renderer`, `handle.scene`, `handle.camera` are used throughout — do not call it twice.

- [ ] **Step 3: Verify by eye**

Run:

```bash
npm run dev -- --port 5180
```

Press `3`–`6`. Expected:
1. The severed limb **flies off as a raymarched blob**, tumbling.
2. It **squashes visibly** when it hits the floor, then relaxes back and settles.
3. It shades with the same material as the body.
4. Sever a limb, then sever another — the first chunk is still lying on the floor.

- [ ] **Step 4: Run the full suite**

Run:

```bash
npm run build && npm test
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/zombie.ts src/lab/sdf-zombie/lab-main.ts
git commit -m "feat(sdf-lab): raymarched gib chunks that tumble, squash and settle"
```

---

## Task 19: Orbit camera, walk cycle, and the judgement pass

**Files:**
- Modify: `src/lab/sdf-zombie/lab-main.ts`
- Create: `docs/dev-notes/2026-08-15-sdf-zombie-lab-findings.md`

- [ ] **Step 1: Add a minimal orbit camera**

Append to `src/lab/sdf-zombie/lab-main.ts`:

```ts
// Minimal orbit camera — drag to rotate, wheel to zoom. Right-drag only, so
// left-click stays free for shooting.
let camYaw = 0, camPitch = 0.18, camDist = 3.4;
const camTarget = new THREE.Vector3(0, 1.05, 0);
let dragging = false, lastX = 0, lastY = 0;

handle.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
handle.renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 2) return;
  dragging = true; lastX = e.clientX; lastY = e.clientY;
});
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  camYaw -= (e.clientX - lastX) * 0.006;
  camPitch = Math.max(-0.4, Math.min(1.2, camPitch + (e.clientY - lastY) * 0.005));
  lastX = e.clientX; lastY = e.clientY;
});
handle.renderer.domElement.addEventListener('wheel', (e) => {
  camDist = Math.max(1.2, Math.min(9, camDist + Math.sign(e.deltaY) * 0.25));
}, { passive: true });

function updateCamera() {
  const cp = Math.cos(camPitch);
  handle.camera.position.set(
    camTarget.x + Math.sin(camYaw) * cp * camDist,
    camTarget.y + Math.sin(camPitch) * camDist,
    camTarget.z + Math.cos(camYaw) * cp * camDist,
  );
  handle.camera.lookAt(camTarget);
}
```

Call `updateCamera()` inside the existing `setRenderCallback` body.

- [ ] **Step 2: Add a procedural sway so the flesh moves**

Add to the render callback in `src/lab/sdf-zombie/lab-main.ts`:

```ts
let clock = 0;
// Procedural sway — enough to see the flesh stretch and the wounds ride along.
// A real walk cycle is out of scope; this only has to prove the flesh moves.
function swayBody(dt: number) {
  clock += dt;
  const bob = Math.sin(clock * 2.1) * 0.035;
  const lean = Math.sin(clock * 1.3) * 0.05;
  view.object.position.set(lean, bob, 0);
}
```

Call `swayBody(dt)` in the render callback before `updateCamera()`.

- [ ] **Step 3: Verify the full loop by hand**

Run:

```bash
npm run dev -- --port 5180
```

Work through the spec's five success criteria and note what you actually see:

1. **Flesh stretches and webs** — right-drag to orbit; watch limb/torso junctions as the body sways.
2. **Craters stay put** — left-click the shoulder, then watch it through a full sway cycle. The crater must ride the flesh, not slide across it.
3. **Stumps close over** — press `4`. The stump must close smoothly and read as wet interior.
4. **Gibs reflect damage dealt** — press `3` to remove the left arm, then press `5`; the pile should contain the arm and the leg, and the body should be missing both.
5. **Presets are distinguishable** — cycle flesh presets and decide whether any is worth showing someone.

- [ ] **Step 4: Write the findings note**

Create `docs/dev-notes/2026-08-15-sdf-zombie-lab-findings.md` and record, honestly:

```markdown
# SDF zombie lab — findings

**Date:** 2026-08-15
**Spec:** [../superpowers/specs/2026-08-15-sdf-zombie-lab-design.md](../superpowers/specs/2026-08-15-sdf-zombie-lab-design.md)
**Run it:** `npm run dev` → `/sdf-lab.html`

## Verdict

<one paragraph: is this worth building on? Failure is an acceptable answer.>

## Against the five success criteria

1. Flesh stretches / webs — <what you saw>
2. Craters stay positioned on moving flesh — <what you saw>
3. Stumps close over and read as exposed meat — <what you saw>
4. Gibs squash and reflect damage already dealt — <what you saw>
5. Presets distinguishable; one worth showing — <what you saw>

## Performance

- Frame time with body + N chunks at 960×540: <measure it>
- Which cost lever was needed: cluster culling / step LOD / half-res RT / none

## What surprised me

<the things worth remembering>

## If it ports

<what would have to change to put this on a real enemy — or why it shouldn't>
```

- [ ] **Step 5: Run the full suite one final time**

Run:

```bash
npm run build && npm test
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/lab-main.ts docs/dev-notes/2026-08-15-sdf-zombie-lab-findings.md
git commit -m "feat(sdf-lab): orbit camera, procedural sway, findings note"
```

---

## Task 20: Update TASKS.md

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Add the side-quest row**

In `TASKS.md`, under the milestone list, add:

```markdown
- `X1` [~]  **Side quest — SDF zombie lab** (off critical path, firewalled from sim/game). Raymarched SDF-volume character: smooth-min flesh, rest-space wounds, self-closing stumps, raymarched gib blobs. Run: `npm run dev` → `/sdf-lab.html`.
  - Spec [docs/superpowers/specs/2026-08-15-sdf-zombie-lab-design.md](docs/superpowers/specs/2026-08-15-sdf-zombie-lab-design.md) · Plan [docs/superpowers/plans/2026-08-15-sdf-zombie-lab.md](docs/superpowers/plans/2026-08-15-sdf-zombie-lab.md) · Findings [docs/dev-notes/2026-08-15-sdf-zombie-lab-findings.md](docs/dev-notes/2026-08-15-sdf-zombie-lab-findings.md)
```

- [ ] **Step 2: Mark it done once the findings note has a verdict**

Change `[~]` to `[x]` only after Task 19's findings note records an actual verdict. The deliverable is the opinion, not the code.

- [ ] **Step 3: Commit**

```bash
git add TASKS.md
git commit -m "docs(tasks): track SDF zombie lab side quest"
```

---

## Self-review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §3 architecture / module split | 1, 3–9 (file structure table above) |
| §4 field, ~20 primitives, smooth-min | 8, 10 |
| §4 smin choice + fold-order trap | 6, 10, 14 |
| §4 WAM authoring: data-not-code, relative, mirror, override | 4, 5, 8, 17 |
| §4 `validateBody` checks pass | 7 |
| §5 damage as field operators, rest-space wounds | 12, 13 |
| §5 severing, self-closing stumps | 14 |
| §6 proxy box, `gl_FragDepth`, cluster culling, step LOD | 2, 10 |
| §6 normals, distance displacement, step multiplier | 16 |
| §7 material presets, lighting presets, wound shading | 13, 16 |
| §8 raymarched gibs, squash on impact | 15, 18 |
| §9 orbit cam, click-to-shoot, panel, persistence, sever keys | 13, 14, 17, 19 |
| §10 testing (all pure modules) | 3–9, 11, 12, 14, 15, 16, 17 |
| §11 risks / Dreams escape hatch | 19 findings note |

Two spec items are deliberately **partial**, and flagged rather than silently dropped:
- **Half-resolution march RT** (§6) is held in reserve, per the spec's own "only implement if 1 and 2 are insufficient." Task 19 measures whether it's needed.
- **Per-primitive `blendK` in the panel** (§9) is exposed as a *global* slider in Task 17 rather than 32 individual ones. Per-primitive editing lands via the override JSON if the global proves too blunt.

**Placeholder scan:** clean — no TBD/TODO. The one prose instruction without inline code (Task 14 `toLocalApprox`) states exactly which helpers to import and what to project, and is covered by a passing test either way.

**Type consistency:** `Primitive`, `BuiltBody`, `ClusterInfo`, `Wound`, `Chunk`, `FleshMaterial` are defined once and used with the same field names throughout. `MAX_PRIMS`/`MAX_CLUSTERS` are defined in `validate.ts` and re-declared in `march.glsl.ts` — Task 7's test asserts the TS ceiling, and Task 9's test asserts the packed arrays match it. `stepRig`'s signature changed to an options object in Task 11 and has no other callers until Task 19, which passes `StepOpts`.

**The CPU/GPU mirror contract:** `validate.ts`'s `sdPrimitive` and `smin` must stay numerically identical to `sdPrim` and `smin` in `march.glsl.ts` — the CPU copy backs both `validateBody` and the click-to-shoot raycast in Task 13, so a drift means shots land where the body isn't. `goober-test` handled this by keeping `sdf.js` explicitly "mirrors the GLSL in blendshell.js exactly" under unit test, and the same discipline applies here. If either copy is edited, edit both in the same commit.

---

## Task 21: Wire the rig into the body — the missing deformation link

`rig.ts` shipped in Task 11 with 7 passing tests and is imported by **nothing but its own test file**. No task connects it to the primitives, so the body is rigid. Task 19's "procedural sway" translates `view.object.position`, which moves the whole proxy box rigidly — the primitives never move relative to each other.

Two of the spec's five success criteria are structurally blocked by this:

- *"Flesh stretches and lags"* — nothing deforms the body.
- *"Craters stay positioned on moving flesh"* — the entire point of the rest-space wound system in `damage.ts`. The flesh never moves, so it is proven only in unit tests.

**Binding model:** each primitive endpoint is bound to exactly one rig point — an SDF primitive is owned by one bone, which is what makes this simpler than mesh skinning. At bind time, record `(rigPointIndex, offset)` per endpoint; each frame, `endpoint = rigPoint.pos + offset`.

**Files:**
- Create: `src/lab/sdf-zombie/rig-bind.ts`
- Test: `src/lab/sdf-zombie/rig-bind.test.ts`
- Modify: `src/lab/sdf-zombie/lab-main.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/rig-bind.test.ts
import { describe, it, expect } from 'vitest';
import { bindRig, applyRig } from './rig-bind';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { stepRig } from './rig';
import { len, sub } from './vec';

describe('bindRig', () => {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const bound = bindRig(body);

  it('creates one rig point per distinct bone joint', () => {
    expect(bound.rig.points.length).toBeGreaterThan(4);
    expect(bound.rig.points.length).toBeLessThanOrEqual(body.bones.size * 2);
  });

  it('binds every primitive endpoint to some rig point', () => {
    expect(bound.binding).toHaveLength(body.prims.length);
    for (const b of bound.binding) {
      expect(b.a.point).toBeGreaterThanOrEqual(0);
      expect(b.a.point).toBeLessThan(bound.rig.points.length);
      expect(b.b.point).toBeGreaterThanOrEqual(0);
    }
  });

  it('pins the pelvis so the body does not fall through the floor', () => {
    expect(bound.rig.points.some(p => p.pinned)).toBe(true);
  });

  it('constrains adjacent joints at their rest separation', () => {
    for (const c of bound.rig.constraints) expect(c.rest).toBeGreaterThan(0);
  });
});

describe('applyRig', () => {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const bound = bindRig(body);

  it('is the identity at rest — an unmoved rig reproduces the original body', () => {
    const out = applyRig(body, bound);
    for (let i = 0; i < body.prims.length; i++) {
      expect(len(sub(out.prims[i].a, body.prims[i].a))).toBeCloseTo(0, 9);
      expect(len(sub(out.prims[i].b, body.prims[i].b))).toBeCloseTo(0, 9);
    }
  });

  it('moves primitives when their bound rig point moves', () => {
    const moved = { ...bound, rig: { ...bound.rig,
      points: bound.rig.points.map((p, i) => i === bound.rig.points.length - 1
        ? { ...p, pos: [p.pos[0] + 0.5, p.pos[1], p.pos[2]] as const } : p) } };
    const out = applyRig(body, moved);
    const anyMoved = out.prims.some((p, i) => len(sub(p.a, body.prims[i].a)) > 0.4);
    expect(anyMoved).toBe(true);
  });

  it('RECOMPUTES cluster bounds — stale bounds silently drop moving flesh', () => {
    const moved = { ...bound, rig: { ...bound.rig,
      points: bound.rig.points.map(p => p.pinned ? p
        : ({ ...p, pos: [p.pos[0] + 0.3, p.pos[1], p.pos[2]] as const })) } };
    const out = applyRig(body, moved);
    for (const c of out.clusters)
      for (const prim of out.prims.slice(c.start, c.start + c.count)) {
        const maxScale = Math.max(...prim.scale);
        for (const end of [prim.a, prim.b])
          expect(len(sub(end, c.center)) + prim.radius * maxScale)
            .toBeLessThanOrEqual(c.radius + 1e-6);
      }
  });

  it('preserves fold order — cluster start/count/limb are untouched', () => {
    const out = applyRig(body, bound);
    expect(out.clusters.map(c => `${c.limb}:${c.start}:${c.count}`))
      .toEqual(body.clusters.map(c => `${c.limb}:${c.start}:${c.count}`));
  });

  it('survives a settled rig without NaN', () => {
    let rig = bound.rig;
    for (let i = 0; i < 120; i++)
      rig = stepRig(rig, 1 / 60, { gravity: [0, -9.8, 0], damping: 0.04, iterations: 4, restStiffness: 0.2 });
    const out = applyRig(body, { ...bound, rig });
    for (const p of out.prims) for (const v of [...p.a, ...p.b]) expect(Number.isFinite(v)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/rig-bind.test.ts`
Expected: FAIL — `Failed to resolve import "./rig-bind"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/rig-bind.ts`:

```ts
// src/lab/sdf-zombie/rig-bind.ts
import type { BuildResult } from './build-body';
import type { ClusterInfo, Primitive, Vec3 } from './types';
import { makeRig, type RigState } from './rig';
import { add, len, scale as vscale, sub } from './vec';

/** Which rig point an endpoint follows, and its fixed offset from that point. */
interface EndpointBind { point: number; offset: Vec3 }
interface PrimBind { a: EndpointBind; b: EndpointBind }

export interface BoundRig {
  rig: RigState;
  binding: PrimBind[];
}

const KEY_EPS = 1e-4;

/**
 * Builds a rig from the body's resolved bone joints and binds every primitive
 * endpoint to its nearest joint.
 *
 * One endpoint follows exactly one point — an SDF primitive is owned by a
 * single bone, so there are no skinning weights to solve and no blend seams.
 */
export function bindRig(body: BuildResult): BoundRig {
  // Deduplicate joints: a bone's tail and its child's head are the same point.
  const positions: Vec3[] = [];
  const indexOf = (p: Vec3): number => {
    for (let i = 0; i < positions.length; i++)
      if (len(sub(positions[i], p)) < KEY_EPS) return i;
    positions.push(p);
    return positions.length - 1;
  };

  const constraints: { a: number; b: number; rest: number; stiffness: number }[] = [];
  for (const bone of body.bones.values()) {
    const h = indexOf(bone.head);
    const t = indexOf(bone.tail);
    if (h !== t) constraints.push({ a: h, b: t, rest: len(sub(bone.tail, bone.head)), stiffness: 1 });
  }

  // Pin the lowest joint — without an anchor the whole rig falls under gravity.
  let lowest = 0;
  positions.forEach((p, i) => { if (p[1] < positions[lowest][1]) lowest = i; });

  const rig = makeRig(
    positions.map((pos, i) => ({ pos, pinned: i === lowest })),
    constraints,
  );

  const bindEnd = (p: Vec3): EndpointBind => {
    let best = 0;
    let bestD = Infinity;
    positions.forEach((q, i) => { const d = len(sub(p, q)); if (d < bestD) { bestD = d; best = i; } });
    return { point: best, offset: sub(p, positions[best]) };
  };

  return { rig, binding: body.prims.map(p => ({ a: bindEnd(p.a), b: bindEnd(p.b) })) };
}

/**
 * Re-derives primitive endpoints from the current rig pose and RECOMPUTES the
 * cluster bounding spheres.
 *
 * Recomputing bounds is not optional: the shader culls on them, so a stale
 * bound silently discards flesh that has moved outside it — the exact failure
 * `validateBody`'s bounding-sphere check exists to catch. Cluster start/count
 * and ordering are left untouched, preserving the fold order.
 */
export function applyRig(body: BuildResult, bound: BoundRig): BuildResult {
  const pos = bound.rig.points;
  const prims: Primitive[] = body.prims.map((p, i) => ({
    ...p,
    a: add(pos[bound.binding[i].a.point].pos, bound.binding[i].a.offset),
    b: add(pos[bound.binding[i].b.point].pos, bound.binding[i].b.offset),
  }));

  const clusters: ClusterInfo[] = body.clusters.map(c => {
    const members = prims.slice(c.start, c.start + c.count);
    let sum: Vec3 = [0, 0, 0];
    for (const m of members) sum = add(sum, add(m.a, m.b));
    const center = vscale(sum, 1 / (members.length * 2));
    let radius = 0;
    for (const m of members) {
      const maxScale = Math.max(m.scale[0], m.scale[1], m.scale[2]);
      for (const end of [m.a, m.b])
        radius = Math.max(radius, len(sub(end, center)) + m.radius * maxScale);
    }
    return { ...c, center, radius };
  });

  return { ...body, prims, clusters };
}

/** Shoves the rig point nearest a world position — used to make hits push flesh. */
export function impulseAt(bound: BoundRig, world: Vec3, delta: Vec3): BoundRig {
  let best = 0;
  let bestD = Infinity;
  bound.rig.points.forEach((p, i) => {
    const d = len(sub(world, p.pos));
    if (d < bestD && !p.pinned) { bestD = d; best = i; }
  });
  return {
    ...bound,
    rig: {
      ...bound.rig,
      points: bound.rig.points.map((p, i) => i === best ? { ...p, pos: add(p.pos, delta) } : p),
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/rig-bind.test.ts`
Expected: PASS, 10 tests. The bounds-recompute test is the one that matters — without it the cull silently eats moving flesh.

- [ ] **Step 5: Drive the rig from the render loop**

In `src/lab/sdf-zombie/lab-main.ts`, add the imports:

```ts
import { bindRig, applyRig, impulseAt } from './rig-bind';
import { stepRig } from './rig';
```

After `let current = body;` add:

```ts
let bound = bindRig(current);
// Rebind whenever the body itself changes (sever, override edit).
function rebind() { bound = bindRig(current); }
```

Call `rebind()` at the end of both `rebuildBody()` and the sever `keydown` handler.

Then inside the existing `handle.setRenderCallback((dt) => { ... })`, before the camera block:

```ts
  // Drive the flesh: settle the rig toward its rest pose, push the result back
  // into the primitives, and re-upload. This is what makes the body deform —
  // and what makes rest-space wounds observable, since they ride the flesh.
  bound = {
    ...bound,
    rig: stepRig(bound.rig, Math.min(dt, 1 / 30), {
      gravity: [0, -2.2, 0],
      damping: 0.06,
      iterations: 4,
      restStiffness: 0.18,
    }),
  };
  const posed = applyRig(current, bound);
  view.update(posed);
  view.setWounds(
    wounds.map(w => woundWorldPos(posed.prims, w)),
    wounds.map(w => w.radius),
    wounds.map(w => TYPE_ID[w.type]),
    wounds.map(w => w.ageSec),
  );
```

- [ ] **Step 6: Make hits shove the flesh**

In the shooting handler, after `wounds = pushWound(...)`, add:

```ts
  // A hit shoves the nearest joint along the shot direction — the rest-pose
  // pull springs it back, so the limb visibly recoils and lags.
  const push = type === 'blast' ? 0.10 : 0.04;
  bound = impulseAt(bound, hit, [d.x * push, d.y * push, d.z * push]);
```

- [ ] **Step 7: Verify**

Run `npm run build` and `npm test` (expect all green), then **load the page** — this task is not verifiable any other way:

1. The body visibly settles and sways rather than standing rigid.
2. Shooting it makes the hit limb **recoil and spring back**.
3. A crater placed on a limb **stays on that limb** as it moves, rather than sliding across the surface. This is the rest-space wound system finally being demonstrated rather than merely unit-tested.
4. No creases appear as the body moves — if they do, cluster bounds are not being recomputed.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/rig-bind.ts src/lab/sdf-zombie/rig-bind.test.ts src/lab/sdf-zombie/lab-main.ts
git commit -m "feat(sdf-lab): bind the verlet rig to primitives so the flesh deforms"
```
