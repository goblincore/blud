# Ring-fit (`blob:rings`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `npm run blob:rings -- <name>`, which measures a `.blob` body against a skinned reference GLB and suggests better `r` / `r2` / `deep` / `offset` for each existing primitive, worst-first, naming the `.blob` line.

**Architecture:** Read the reference GLB's skin, assign each vertex to its dominant joint, map joints to our bones through an explicit table, align with one global uniform scale plus a per-bone *rigid* transform (which makes limb fitting pose-independent), then evaluate `sdBody` at every reference vertex. The signed distance *is* the error in metres with blending already folded in. Bin those residuals per primitive by angle around the bone and position along it, and read the fix off the first few Fourier terms.

**Tech Stack:** TypeScript, vitest, `tsx` for the CLI. No new dependencies. Builds on `parseGlb` (`silhouette.ts`), `sdBody` / `nearestPrim` / `sdPrimitive` (`validate.ts`), `buildBody` (`build-body.ts`), and `vec.ts`.

**Spec:** [`docs/superpowers/specs/2026-08-26-blob-ring-fit-design.md`](../specs/2026-08-26-blob-ring-fit-design.md). Read it before starting.

---

## Facts established before this plan was written

Do not re-derive these; they were checked against the files.

- `Primitive` (in `types.ts`) carries `a`, `b` (world endpoints), `bone?` (concrete, e.g. `thigh.l`), `src?` (**1-based `.blob` line number**), `radius`, `radiusB?`, `scale: Vec3`, `blendK`, `limb`, `cluster`, and optional `orient`, `bend`, `shell`, `op`, `dead`.
- `scale` is `[wide, tall, deep]` (`blob-compile.ts:284`) and is applied in **world axes** — `sdPrimitive` divides world coordinates by `scale` after an optional `orient` rotation about the prim midpoint. So `wide` scales world x and `deep` scales world z.
- `ResolvedBone` is `{ head: Vec3; tail: Vec3 }`. `BuiltBody` is `{ prims, clusters, bones: Map<string, ResolvedBone> }` and structurally satisfies the `Body` that `sdBody` takes.
- `vec.ts` exports `add`, `sub`, `scale`, `dot`, `len`, `cross`, `normalize`, `lerp`, `basisFromAxis`.
- **Do not reuse `basisFromAxis`.** It seeds from the world axis *least aligned* with the bone, so its roll depends on bone direction. We need a basis whose first vector tracks world x, or the `cos 2θ` term will not map to `deep`.
- The reference rig chain is `Hips -> Spine02 -> Spine01 -> Spine -> {LeftShoulder, RightShoulder, neck}`. **`Spine02` is the lowest spine joint, `Spine` the highest** — the reverse of what the numbering suggests.
- `mouse.glb` scene root is `Armature` (uniform scale 0.01); the mesh node `char1` is its child with an identity transform. Joints sit under `Armature` too.
- `package.json` scripts already include `"blob:measure": "tsx scripts/blob-measure.ts"`. Follow that pattern.

## File structure

| File | Responsibility |
|---|---|
| `src/lab/sdf-zombie/ref-skin.ts` (create) | Parse a skinned GLB into `{ joint, position }[]` in one common space. Dominant-joint assignment. Nothing about our body. |
| `src/lab/sdf-zombie/ref-align.ts` (create) | The joint→bone table, the ring basis, global scale, per-bone rigid transform. Nothing about primitives. |
| `src/lab/sdf-zombie/ring-fit.ts` (create) | Residual binning, blend-dominated fraction, Fourier decomposition, per-prim suggestions, mirror merge. The real logic. |
| `scripts/blob-rings.ts` (create) | CLI: resolve the reference, wire the three modules, format the report. Thin. |
| `package.json` (modify) | Add the `blob:rings` script. |

Tests sit beside each module as `*.test.ts`, matching the directory's existing convention.

---

### Task 1: `ref-skin.ts` — read a skinned GLB

**Files:**
- Create: `src/lab/sdf-zombie/ref-skin.ts`
- Test: `src/lab/sdf-zombie/ref-skin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/ref-skin.test.ts`. The helper builds a minimal GLB in memory so the test needs no fixture file.

```ts
import { describe, it, expect } from 'vitest';
import { readRefSkin, MIN_DOMINANT_WEIGHT } from './ref-skin';

/** Pack a glTF JSON object plus a binary chunk into GLB container bytes. */
function makeGlb(json: unknown, bin: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  let jsonBytes = enc.encode(JSON.stringify(json));
  const padTo4 = (b: Uint8Array, filler: number) => {
    const pad = (4 - (b.length % 4)) % 4;
    if (pad === 0) return b;
    const out = new Uint8Array(b.length + pad);
    out.set(b); out.fill(filler, b.length);
    return out;
  };
  jsonBytes = padTo4(jsonBytes, 0x20);
  const binBytes = padTo4(bin, 0);
  const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binOff = 20 + jsonBytes.length;
  dv.setUint32(binOff, binBytes.length, true); dv.setUint32(binOff + 4, 0x004e4942, true);
  out.set(binBytes, binOff + 8);
  return out;
}

/**
 * Two joints under a root scaled 2x. Three vertices: two clearly owned by
 * joint 0 and joint 1, and one split 0.5/0.5 which must be DROPPED.
 */
function twoJointGlb(): Uint8Array {
  const pos = new Float32Array([1, 0, 0,  0, 1, 0,  0, 0, 1]);
  const joints = new Uint8Array([0,0,0,0,  1,0,0,0,  0,1,0,0]);
  const weights = new Float32Array([1,0,0,0,  0.8,0.2,0,0,  0.5,0.5,0,0]);
  const parts = [new Uint8Array(pos.buffer), joints, new Uint8Array(weights.buffer)];
  let off = 0; const offs: number[] = [];
  for (const p of parts) { offs.push(off); off += p.length + ((4 - (p.length % 4)) % 4); }
  const bin = new Uint8Array(off);
  parts.forEach((p, i) => bin.set(p, offs[i]!));
  return makeGlb({
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }], scene: 0,
    nodes: [
      { name: 'Root', scale: [2, 2, 2], children: [1, 2, 3] },
      { name: 'A', translation: [0, 0, 0] },
      { name: 'B', translation: [0, 3, 0] },
      { name: 'MeshNode', mesh: 0, skin: 0 },
    ],
    skins: [{ joints: [1, 2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: offs[0], byteLength: pos.byteLength },
      { buffer: 0, byteOffset: offs[1], byteLength: joints.byteLength },
      { buffer: 0, byteOffset: offs[2], byteLength: weights.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5121, count: 3, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
    ],
  }, bin);
}

describe('readRefSkin', () => {
  it('assigns each vertex to its dominant joint and drops ambiguous ones', () => {
    const skin = readRefSkin(twoJointGlb());
    expect(skin.total).toBe(3);
    expect(skin.dropped).toBe(1);              // the 0.5/0.5 vertex
    expect(skin.verts).toHaveLength(2);
    expect(skin.verts.map((v) => v.joint)).toEqual(['A', 'B']);
  });

  it('returns positions and joints in one common space, root scale applied', () => {
    const skin = readRefSkin(twoJointGlb());
    // POSITION [1,0,0] under a root scaled 2x.
    expect(skin.verts[0]!.position).toEqual([2, 0, 0]);
    // Joint B translates [0,3,0] under the same 2x root.
    expect(skin.jointWorld.get('B')).toEqual([0, 6, 0]);
  });

  it('exposes the dominant-weight threshold it used', () => {
    expect(MIN_DOMINANT_WEIGHT).toBe(0.6);
  });

  it('refuses a non-uniform node scale rather than shearing the measurement', () => {
    const json = JSON.parse(JSON.stringify({
      asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0,
      nodes: [
        { name: 'Root', scale: [2, 3, 2], children: [1, 2, 3] },
        { name: 'A' }, { name: 'B', translation: [0, 3, 0] },
        { name: 'MeshNode', mesh: 0, skin: 0 },
      ],
      skins: [{ joints: [1, 2] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }],
      buffers: [{ byteLength: 4 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 0, type: 'VEC3' }],
    }));
    expect(() => readRefSkin(makeGlb(json, new Uint8Array(4)))).toThrow(/non-uniform/i);
  });

  it('refuses an unskinned GLB by name', () => {
    const bare = makeGlb({
      asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0,
      nodes: [{ name: 'N', mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ byteLength: 12 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }],
    }, new Uint8Array(12));
    expect(() => readRefSkin(bare)).toThrow(/no skin/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/ref-skin.test.ts`
Expected: FAIL — `Failed to resolve import "./ref-skin"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/ref-skin.ts`:

```ts
// src/lab/sdf-zombie/ref-skin.ts
//
// Read a SKINNED reference GLB into per-vertex (dominant joint, position)
// pairs, with joint positions in the same space.
//
// WHY DOMINANT JOINT AND NOT THE FULL WEIGHT SET. We are attributing surface
// to a body part so a primitive can be fitted to it. A vertex weighted
// 0.5/0.5 across the elbow belongs to neither bone's surface in any useful
// sense; averaging it into both would pull both radii toward the joint. It is
// DROPPED and counted, so a bone whose sample is thin reads as thin in the
// report instead of yielding a confident number off forty points.
//
// This module knows nothing about .blob bodies. It is the reference side only.
import type { Vec3 } from './types';
import { parseGlb } from './silhouette';

/** Below this top weight a vertex sits in a joint blend and is dropped. */
export const MIN_DOMINANT_WEIGHT = 0.6;

export interface RefVertex {
  /** Name of the joint node carrying this vertex's largest weight. */
  joint: string;
  position: Vec3;
}

export interface RefSkin {
  verts: RefVertex[];
  /** Bind-pose world position of every joint, by node name. */
  jointWorld: Map<string, Vec3>;
  /** Vertices seen, including dropped ones. */
  total: number;
  /** Vertices dropped for a top weight below MIN_DOMINANT_WEIGHT. */
  dropped: number;
}

type Mat4 = number[]; // column-major, 16 entries, glTF convention

const IDENTITY: Mat4 = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}

function trs(node: { translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; name?: string }): Mat4 {
  if (node.matrix) return node.matrix.slice();
  // A NON-UNIFORM node scale would shear the ring measurement: the two
  // cross-section axes would carry different units and the cos-2-theta term
  // would read as anisotropy that is not in the model. Refuse rather than
  // report a confident wrong number.
  if (node.scale) {
    const [sx, sy, sz] = node.scale as [number, number, number];
    const spread = Math.max(sx, sy, sz) - Math.min(sx, sy, sz);
    if (spread > 1e-6 * Math.max(Math.abs(sx), 1)) {
      throw new Error(
        `node ${node.name ?? '?'} has a non-uniform scale [${sx}, ${sy}, ${sz}] — unsupported (see the spec)`,
      );
    }
  }
  const [x, y, z, w] = (node.rotation ?? [0, 0, 0, 1]) as [number, number, number, number];
  const [sx, sy, sz] = (node.scale ?? [1, 1, 1]) as [number, number, number];
  const [tx, ty, tz] = (node.translation ?? [0, 0, 0]) as [number, number, number];
  // Rotation matrix from the unit quaternion, then column-scaled.
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w),     2 * (x * z - y * w),
    2 * (x * y - z * w),     1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w),     2 * (y * z - x * w),     1 - 2 * (x * x + y * y),
  ];
  return [
    r[0]! * sx, r[1]! * sx, r[2]! * sx, 0,
    r[3]! * sy, r[4]! * sy, r[5]! * sy, 0,
    r[6]! * sz, r[7]! * sz, r[8]! * sz, 0,
    tx, ty, tz, 1,
  ];
}

function apply(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]!  * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]!  * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** Read an accessor into a flat number array, honouring byteStride. */
function readAccessor(gltf: any, bin: Uint8Array, index: number): number[] {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const n = COMPONENTS[acc.type]!;
  const width = BYTES[acc.componentType]!;
  const stride: number = view.byteStride ?? n * width;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out: number[] = [];
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < n; c++) {
      const at = base + i * stride + c * width;
      switch (acc.componentType) {
        case 5126: out.push(dv.getFloat32(at, true)); break;
        case 5125: out.push(dv.getUint32(at, true)); break;
        case 5123: out.push(dv.getUint16(at, true)); break;
        case 5121: out.push(dv.getUint8(at)); break;
        case 5122: out.push(dv.getInt16(at, true)); break;
        case 5120: out.push(dv.getInt8(at)); break;
        default: throw new Error(`unsupported componentType ${acc.componentType}`);
      }
    }
  }
  // A normalised integer weight is stored 0..MAX; rescale so weights sum to 1.
  if (acc.normalized && acc.componentType !== 5126) {
    const max = acc.componentType === 5121 ? 255 : acc.componentType === 5123 ? 65535 : 1;
    return out.map((v) => v / max);
  }
  return out;
}

export function readRefSkin(bytes: Uint8Array): RefSkin {
  const { json, bin } = parseGlb(bytes);
  const gltf = json as any;
  if (!bin) throw new Error('GLB has no BIN chunk');
  if (!gltf.skins?.length) throw new Error('reference GLB has no skin — unsupported (see the spec)');

  // World matrix per node, by walking the scene roots down.
  const world = new Map<number, Mat4>();
  const roots: number[] = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? [0];
  const walk = (i: number, parent: Mat4) => {
    const m = mul(parent, trs(gltf.nodes[i]));
    world.set(i, m);
    for (const c of gltf.nodes[i].children ?? []) walk(c, m);
  };
  for (const r of roots) walk(r, IDENTITY);

  const skin = gltf.skins[0];
  const jointNames: string[] = skin.joints.map((j: number) => gltf.nodes[j].name ?? `joint${j}`);
  const jointWorld = new Map<string, Vec3>();
  skin.joints.forEach((j: number, k: number) => {
    jointWorld.set(jointNames[k]!, apply(world.get(j) ?? IDENTITY, [0, 0, 0]));
  });

  // The mesh node carrying this skin.
  const meshNodeIndex: number = gltf.nodes.findIndex((n: any) => n.skin === 0 && n.mesh !== undefined);
  if (meshNodeIndex < 0) throw new Error('no mesh node references skin 0');
  const meshWorld = world.get(meshNodeIndex) ?? IDENTITY;
  const prim = gltf.meshes[gltf.nodes[meshNodeIndex].mesh].primitives[0];

  const pos = readAccessor(gltf, bin, prim.attributes.POSITION);
  const jt = readAccessor(gltf, bin, prim.attributes.JOINTS_0);
  const wt = readAccessor(gltf, bin, prim.attributes.WEIGHTS_0);

  const verts: RefVertex[] = [];
  let dropped = 0;
  const total = pos.length / 3;
  for (let i = 0; i < total; i++) {
    let bestW = -1, bestJ = 0;
    for (let c = 0; c < 4; c++) {
      const w = wt[i * 4 + c]!;
      if (w > bestW) { bestW = w; bestJ = jt[i * 4 + c]!; }
    }
    if (bestW < MIN_DOMINANT_WEIGHT) { dropped++; continue; }
    verts.push({
      joint: jointNames[bestJ] ?? `joint${bestJ}`,
      position: apply(meshWorld, [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!]),
    });
  }
  return { verts, jointWorld, total, dropped };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/ref-skin.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify against the real reference**

Run:
```bash
npx tsx -e "import{readFileSync}from'node:fs';import{readRefSkin}from'./src/lab/sdf-zombie/ref-skin';const s=readRefSkin(new Uint8Array(readFileSync('docs/dev-notes/refs/mouse-mesh/mouse.glb')));console.log(s.total,s.dropped,s.verts.length,s.jointWorld.get('Hips'));"
```
Expected: total `32260`, dropped a nonzero minority, and a `Hips` position around `[0.004, 0.50, -0.08]` (metres — the `Armature` node's 0.01 scale is applied). If `Hips` comes back near `50`, the root transform is not being applied and Step 3 is wrong.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/ref-skin.ts src/lab/sdf-zombie/ref-skin.test.ts
git commit -m "feat(ring-fit): read a skinned reference GLB into dominant-joint vertices"
```

---

### Task 2: `ref-align.ts` — the joint→bone table

**Files:**
- Create: `src/lab/sdf-zombie/ref-align.ts`
- Test: `src/lab/sdf-zombie/ref-align.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/ref-align.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BONE_MAP, groupByBone } from './ref-align';
import type { RefSkin } from './ref-skin';

describe('BONE_MAP', () => {
  it('maps the spine in chain order, lowest joint first', () => {
    // Reference chain: Hips -> Spine02 -> Spine01 -> Spine -> shoulders/neck.
    // The numbering is misleading; this pins the real order.
    expect(BONE_MAP['spine1']!.head).toBe('Spine02');
    expect(BONE_MAP['chest']!.head).toBe('Spine01');
    expect(BONE_MAP['spine2']!.head).toBe('Spine');
    expect(BONE_MAP['spine2']!.tail).toBe('neck');
  });

  it('gives the foot both the ankle and the toe', () => {
    expect(BONE_MAP['foot.l']!.claims).toEqual(['LeftFoot', 'LeftToeBase']);
  });

  it('does not map hands or head joints', () => {
    const claimed = new Set(Object.values(BONE_MAP).flatMap((e) => e.claims));
    for (const j of ['LeftHand', 'RightHand', 'Head', 'head_end', 'headfront'])
      expect(claimed.has(j)).toBe(false);
  });

  it('mirrors every arm and leg bone', () => {
    for (const b of ['clavicle', 'upperarm', 'forearm', 'thigh', 'shin', 'foot']) {
      expect(BONE_MAP[`${b}.l`]).toBeDefined();
      expect(BONE_MAP[`${b}.r`]).toBeDefined();
    }
  });
});

describe('groupByBone', () => {
  const skin: RefSkin = {
    verts: [
      { joint: 'Hips', position: [0, 0, 0] },
      { joint: 'Hips', position: [1, 0, 0] },
      { joint: 'LeftToeBase', position: [0, 1, 0] },
      { joint: 'LeftHand', position: [0, 0, 1] },
      { joint: 'Nonsense', position: [2, 2, 2] },
    ],
    jointWorld: new Map(), total: 5, dropped: 0,
  };

  it('groups claimed joints under their bone', () => {
    const { byBone } = groupByBone(skin);
    expect(byBone.get('pelvis')).toHaveLength(2);
    expect(byBone.get('foot.l')).toHaveLength(1);   // the toe claims into foot
  });

  it('reports unmapped joints by name with a count, and never guesses', () => {
    const { unmapped } = groupByBone(skin);
    expect(unmapped.get('LeftHand')).toBe(1);
    expect(unmapped.get('Nonsense')).toBe(1);
    expect([...byBoneNames(skin)]).not.toContain('hand.l');
  });
});

function byBoneNames(skin: RefSkin): Set<string> {
  return new Set(groupByBone(skin).byBone.keys());
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/ref-align.test.ts`
Expected: FAIL — `Failed to resolve import "./ref-align"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/ref-align.ts` with just the table and grouping for now (the geometry lands in Task 3):

```ts
// src/lab/sdf-zombie/ref-align.ts
//
// Bring a reference skin into the .blob body's space: which reference joint
// corresponds to which of our bones, one measured global scale, and a
// per-bone RIGID transform.
//
// WHY RIGID PER BONE UNDER ONE GLOBAL SCALE. Rigid alignment makes limb
// fitting POSE-INDEPENDENT — the mouse mesh's T-posed arm and the .blob's
// 47-degree arm produce the same forearm rings, because each is measured in
// its own bone's frame. Refusing a PER-BONE scale keeps proportion errors
// visible: a bone of the wrong length shows up as residual piling up at one
// end instead of being quietly normalised away.
import type { Vec3 } from './types';
import type { RefSkin } from './ref-skin';

export interface BoneMapEntry {
  /** Reference joint at this bone's head. */
  head: string;
  /** Reference joint at this bone's tail. */
  tail: string;
  /** Reference joints whose vertices belong to this bone. */
  claims: string[];
}

/**
 * Our bone name -> reference rig joints. Written down, never inferred from
 * names.
 *
 * THE SPINE NAMES ARE COUNTER-INTUITIVE AND WERE VERIFIED AGAINST THE FILE.
 * The reference chain runs Hips -> Spine02 -> Spine01 -> Spine ->
 * {LeftShoulder, RightShoulder, neck}, so Spine02 is the LOWEST spine joint
 * and Spine the HIGHEST. An early draft had this inverted, which would have
 * attributed every torso vertex to the wrong bone while looking entirely
 * plausible. Do not "fix" it back.
 *
 * hand/finger bones are deliberately absent: the reference ends each arm at a
 * single LeftHand joint while the .blob models a hand plus four fingers, so
 * there is no sane attribution across the mismatch. skull is absent because
 * head prims are offset-positioned features plus a face block — use
 * scripts/head-profile.ts.
 */
function side(l: string, r: string) {
  return { l, r };
}

export const BONE_MAP: Record<string, BoneMapEntry> = (() => {
  const m: Record<string, BoneMapEntry> = {
    pelvis: { head: 'Hips',    tail: 'Spine02', claims: ['Hips'] },
    spine1: { head: 'Spine02', tail: 'Spine01', claims: ['Spine02'] },
    chest:  { head: 'Spine01', tail: 'Spine',   claims: ['Spine01'] },
    spine2: { head: 'Spine',   tail: 'neck',    claims: ['Spine'] },
    neck:   { head: 'neck',    tail: 'Head',    claims: ['neck'] },
  };
  const limbs: Array<[string, (s: 'Left' | 'Right') => BoneMapEntry]> = [
    ['clavicle', (s) => ({ head: `${s}Shoulder`, tail: `${s}Arm`,     claims: [`${s}Shoulder`] })],
    ['upperarm', (s) => ({ head: `${s}Arm`,      tail: `${s}ForeArm`, claims: [`${s}Arm`] })],
    ['forearm',  (s) => ({ head: `${s}ForeArm`,  tail: `${s}Hand`,    claims: [`${s}ForeArm`] })],
    ['thigh',    (s) => ({ head: `${s}UpLeg`,    tail: `${s}Leg`,     claims: [`${s}UpLeg`] })],
    ['shin',     (s) => ({ head: `${s}Leg`,      tail: `${s}Foot`,    claims: [`${s}Leg`] })],
    ['foot',     (s) => ({ head: `${s}Foot`,     tail: `${s}ToeBase`, claims: [`${s}Foot`, `${s}ToeBase`] })],
  ];
  for (const [name, make] of limbs) {
    m[`${name}.l`] = make('Left');
    m[`${name}.r`] = make('Right');
  }
  void side;
  return m;
})();

/** Reference joint name -> our bone name, derived from BONE_MAP's claims. */
const CLAIMED: Map<string, string> = new Map(
  Object.entries(BONE_MAP).flatMap(([bone, e]) => e.claims.map((j) => [j, bone] as [string, string])),
);

export interface Grouped {
  /** Our bone name -> the reference positions claimed by it. */
  byBone: Map<string, Vec3[]>;
  /** Reference joint name -> vertex count, for joints no bone claims. */
  unmapped: Map<string, number>;
}

export function groupByBone(skin: RefSkin): Grouped {
  const byBone = new Map<string, Vec3[]>();
  const unmapped = new Map<string, number>();
  for (const v of skin.verts) {
    const bone = CLAIMED.get(v.joint);
    if (bone === undefined) {
      unmapped.set(v.joint, (unmapped.get(v.joint) ?? 0) + 1);
      continue;
    }
    let list = byBone.get(bone);
    if (list === undefined) { list = []; byBone.set(bone, list); }
    list.push(v.position);
  }
  return { byBone, unmapped };
}
```

Delete the unused `side` helper and its `void side;` line if the linter objects — it exists only to keep the table readable and is not referenced.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/ref-align.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/ref-align.ts src/lab/sdf-zombie/ref-align.test.ts
git commit -m "feat(ring-fit): explicit reference-joint to bone table with verified spine order"
```

---

### Task 3: `ref-align.ts` — ring basis, global scale, per-bone rigid transform

**Files:**
- Modify: `src/lab/sdf-zombie/ref-align.ts` (append)
- Test: `src/lab/sdf-zombie/ref-align.test.ts` (append)

**Background you need:** `sdPrimitive` applies `scale` (`[wide, tall, deep]`) in **world axes**. So the ring basis cannot use an arbitrary roll — its two vectors must line up with world axes or the `cos 2θ` term will not tell you which scale component to change. The rule: drop the world axis most aligned with the bone (that one runs *along* the prim and does not shape the cross-section), hold the first of the two remaining, solve the second.

| bone runs along | dropped | held | solved |
|---|---|---|---|
| y — torso, spine, limbs | `tall` | `wide` | `deep` |
| x — `clavicle` (`dir=side`) | `wide` | `tall` | `deep` |
| z — `foot` (`dir=fwd`) | `deep` | `wide` | `tall` |

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/ref-align.test.ts`:

```ts
import { ringBasis, toLocal, fromLocal, globalScale, SCALE_AXIS_NAMES } from './ref-align';

describe('ringBasis', () => {
  it('picks held/solved axes from the bone direction', () => {
    expect(ringBasis([0,0,0], [0,1,0]).heldAxis).toBe(0);    // y-bone: hold wide
    expect(ringBasis([0,0,0], [0,1,0]).solvedAxis).toBe(2);  //         solve deep
    expect(ringBasis([0,0,0], [1,0,0]).heldAxis).toBe(1);    // x-bone: hold tall
    expect(ringBasis([0,0,0], [1,0,0]).solvedAxis).toBe(2);  //         solve deep
    expect(ringBasis([0,0,0], [0,0,1]).heldAxis).toBe(0);    // z-bone: hold wide
    expect(ringBasis([0,0,0], [0,0,1]).solvedAxis).toBe(1);  //         solve tall
  });

  it('names the axes for the report', () => {
    expect(SCALE_AXIS_NAMES).toEqual(['wide', 'tall', 'deep']);
  });

  it('is orthonormal', () => {
    const b = ringBasis([0, 0, 0], [0.3, 1, 0.2]);
    const d = (p: readonly number[], q: readonly number[]) => p[0]!*q[0]! + p[1]!*q[1]! + p[2]!*q[2]!;
    expect(d(b.e1, b.e2)).toBeCloseTo(0, 10);
    expect(d(b.e1, b.u)).toBeCloseTo(0, 10);
    expect(d(b.e2, b.u)).toBeCloseTo(0, 10);
    expect(d(b.e1, b.e1)).toBeCloseTo(1, 10);
  });
});

describe('pose independence', () => {
  it('gives identical bone-local coordinates for two differently-posed bones', () => {
    // Same bone, two poses: straight up, and rotated 90 degrees onto world x.
    const up = ringBasis([0, 0, 0], [0, 1, 0]);
    const out = ringBasis([0.4, 0.9, 0], [1.4, 0.9, 0]);

    // A point on the surface of the "up" pose.
    const p: [number, number, number] = [0.1, 0.5, 0.02];
    const local = toLocal(p, up);

    // Placed into the other pose and read back, the locals must match exactly.
    const q = fromLocal(local, out);
    const back = toLocal(q, out);
    expect(back.x1).toBeCloseTo(local.x1, 12);
    expect(back.x2).toBeCloseTo(local.x2, 12);
    expect(back.along).toBeCloseTo(local.along, 12);
  });
});

describe('globalScale', () => {
  it('takes the median ratio and names the bone furthest from it', () => {
    const ref = new Map([
      ['a', { head: [0,0,0] as const, tail: [0,100,0] as const }],
      ['b', { head: [0,0,0] as const, tail: [0,100,0] as const }],
      ['c', { head: [0,0,0] as const, tail: [0,100,0] as const }],
    ]);
    const ours = new Map([
      ['a', { head: [0,0,0] as const, tail: [0,1,0] as const }],   // ratio 0.01
      ['b', { head: [0,0,0] as const, tail: [0,1,0] as const }],   // ratio 0.01
      ['c', { head: [0,0,0] as const, tail: [0,2,0] as const }],   // ratio 0.02
    ]);
    const g = globalScale(ref as never, ours as never);
    expect(g.scale).toBeCloseTo(0.01, 12);
    expect(g.worstBone).toBe('c');
    expect(g.n).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/ref-align.test.ts`
Expected: FAIL — `ringBasis is not exported` / not defined.

- [ ] **Step 3: Write the implementation**

Append to `src/lab/sdf-zombie/ref-align.ts`:

```ts
import { add, cross, dot, len, normalize, scale as vscale, sub } from './vec';
import type { ResolvedBone } from './types';

/** Index order of Primitive.scale. */
export const SCALE_AXIS_NAMES = ['wide', 'tall', 'deep'] as const;

export interface RingBasis {
  origin: Vec3;
  /** Cross-section axis whose scale component is HELD at its authored value. */
  e1: Vec3;
  /** Cross-section axis whose scale component is SOLVED alongside r. */
  e2: Vec3;
  /** Along the bone, head -> tail. */
  u: Vec3;
  length: number;
  /** Index into Primitive.scale for e1. */
  heldAxis: 0 | 1 | 2;
  /** Index into Primitive.scale for e2. */
  solvedAxis: 0 | 1 | 2;
}

const WORLD: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/**
 * Orthonormal frame for measuring a ring around a bone.
 *
 * NOT vec.ts's basisFromAxis: that seeds from the world axis LEAST aligned
 * with the bone, so its roll turns as the bone turns. Primitive.scale is
 * applied in WORLD axes, so the cross-section axes must track world axes or
 * the cos-2-theta term cannot be attributed to a scale component.
 */
export function ringBasis(head: Vec3, tail: Vec3): RingBasis {
  const d = sub(tail, head);
  const length = len(d);
  const u = length === 0 ? ([0, 1, 0] as Vec3) : normalize(d);

  // Drop the world axis most aligned with the bone; hold the first survivor,
  // solve the second.
  let drop: 0 | 1 | 2 = 0;
  for (const i of [1, 2] as const) if (Math.abs(u[i]) > Math.abs(u[drop])) drop = i;
  const rest = ([0, 1, 2] as const).filter((i) => i !== drop) as [0 | 1 | 2, 0 | 1 | 2];
  const [heldAxis, solvedAxis] = rest;

  const seed = WORLD[heldAxis]!;
  const e1 = normalize(sub(seed, vscale(u, dot(seed, u))));
  const e2 = cross(u, e1);
  return { origin: head, e1, e2, u, length, heldAxis, solvedAxis };
}

export interface Local { x1: number; x2: number; along: number }

export function toLocal(p: Vec3, b: RingBasis): Local {
  const v = sub(p, b.origin);
  return { x1: dot(v, b.e1), x2: dot(v, b.e2), along: dot(v, b.u) };
}

export function fromLocal(l: Local, b: RingBasis): Vec3 {
  return add(b.origin, add(vscale(b.e1, l.x1), add(vscale(b.e2, l.x2), vscale(b.u, l.along))));
}

export interface GlobalScale {
  /** Multiply reference lengths by this to reach our metres. */
  scale: number;
  /** 100 * (max - min) / median across mapped bones. */
  spreadPct: number;
  /** Bone whose ratio is furthest from the median — read this before trusting the fit. */
  worstBone: string;
  n: number;
}

/**
 * ONE uniform scale for the whole figure, from the median of per-bone length
 * ratios. Deliberately not per bone: a per-bone scale would normalise away a
 * bone of the wrong LENGTH, which is a `len=` edit we want to stay visible.
 */
export function globalScale(
  refBones: Map<string, { head: Vec3; tail: Vec3 }>,
  ourBones: Map<string, ResolvedBone>,
): GlobalScale {
  const ratios: Array<{ bone: string; r: number }> = [];
  for (const bone of Object.keys(BONE_MAP)) {
    const ref = refBones.get(bone), our = ourBones.get(bone);
    if (!ref || !our) continue;
    const refLen = len(sub(ref.tail, ref.head));
    const ourLen = len(sub(our.tail, our.head));
    if (refLen < 1e-9 || ourLen < 1e-9) continue;
    ratios.push({ bone, r: ourLen / refLen });
  }
  if (ratios.length === 0) throw new Error('no bone appears in both the reference and the body');
  const sorted = [...ratios].sort((a, b) => a.r - b.r);
  const mid = sorted[Math.floor((sorted.length - 1) / 2)]!.r;
  const median = sorted.length % 2 === 1
    ? mid
    : (mid + sorted[Math.floor(sorted.length / 2)]!.r) / 2;
  const worst = ratios.reduce((w, c) => (Math.abs(c.r - median) > Math.abs(w.r - median) ? c : w));
  return {
    scale: median,
    spreadPct: 100 * (sorted[sorted.length - 1]!.r - sorted[0]!.r) / median,
    worstBone: worst.bone,
    n: ratios.length,
  };
}

/**
 * Reference point -> our body's space: scale the bone-local coordinates by the
 * ONE global scale, then rebuild them in our bone's frame. Rotation and
 * translation are absorbed here, which is what makes the fit pose-independent;
 * `along` is NOT renormalised, so a bone of the wrong length still shows.
 */
export function refToBody(p: Vec3, refB: RingBasis, ourB: RingBasis, s: number): Vec3 {
  const l = toLocal(p, refB);
  return fromLocal({ x1: l.x1 * s, x2: l.x2 * s, along: l.along * s }, ourB);
}

/** Reference bone head/tail from joint world positions, via BONE_MAP. */
export function refBones(jointWorld: Map<string, Vec3>): Map<string, { head: Vec3; tail: Vec3 }> {
  const out = new Map<string, { head: Vec3; tail: Vec3 }>();
  for (const [bone, e] of Object.entries(BONE_MAP)) {
    const head = jointWorld.get(e.head), tail = jointWorld.get(e.tail);
    if (head && tail) out.set(bone, { head, tail });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/ref-align.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/ref-align.ts src/lab/sdf-zombie/ref-align.test.ts
git commit -m "feat(ring-fit): pose-independent bone-local frames and one measured global scale"
```

---

### Task 4: `ring-fit.ts` — project a point onto the body surface

This is the test instrument for every later task: it lets us synthesise a "reference" from a known body, so the fitter can be checked against ground truth without a GLB.

**Files:**
- Create: `src/lab/sdf-zombie/ring-fit.ts`
- Test: `src/lab/sdf-zombie/ring-fit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/ring-fit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { projectToSurface, sampleBodySurface } from './ring-fit';
import { sdBody } from './validate';
import type { Primitive, ClusterInfo } from './types';

/**
 * One upright capsule, radius 0.1, from y=0 to y=1.
 *
 * ClusterInfo requires id/limb/center/radius as well as start/count/alive —
 * write the whole literal rather than casting a subset, so a future field
 * addition breaks here loudly instead of being silently cast away.
 */
function oneCapsule(scale: [number, number, number] = [1, 1, 1]): {
  prims: Primitive[]; clusters: ClusterInfo[];
} {
  const prims: Primitive[] = [{
    a: [0, 0, 0], b: [0, 1, 0], radius: 0.1, scale,
    blendK: 0.01, limb: 'torso', cluster: 0, bone: 'spine1', src: 42,
  }];
  const clusters: ClusterInfo[] = [
    { id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0.5, 0], radius: 1, alive: true },
  ];
  return { prims, clusters };
}

describe('projectToSurface', () => {
  it('lands a point on the zero level set', () => {
    const body = oneCapsule();
    const q = projectToSurface([0.4, 0.5, 0], body);
    expect(Math.abs(sdBody(q, body))).toBeLessThan(1e-6);
  });

  it('converges from inside as well as outside', () => {
    const body = oneCapsule();
    const q = projectToSurface([0.01, 0.5, 0], body);
    expect(Math.abs(sdBody(q, body))).toBeLessThan(1e-6);
  });
});

describe('sampleBodySurface', () => {
  it('returns points on the surface, grouped by the bone they came from', () => {
    const body = oneCapsule();
    const byBone = sampleBodySurface(body, 200);
    const pts = byBone.get('spine1')!;
    expect(pts.length).toBeGreaterThan(100);
    for (const p of pts) expect(Math.abs(sdBody(p, body))).toBeLessThan(1e-5);
  });

  it('reflects anisotropy — a deep=2 capsule reaches twice as far in z', () => {
    const byBone = sampleBodySurface(oneCapsule([1, 1, 2]), 400);
    const pts = byBone.get('spine1')!;
    const maxX = Math.max(...pts.map((p) => Math.abs(p[0])));
    const maxZ = Math.max(...pts.map((p) => Math.abs(p[2])));
    expect(maxZ / maxX).toBeGreaterThan(1.7);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/ring-fit.test.ts`
Expected: FAIL — `Failed to resolve import "./ring-fit"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/ring-fit.ts`:

```ts
// src/lab/sdf-zombie/ring-fit.ts
//
// Fit existing .blob primitives to a reference surface by reading the SIGNED
// RESIDUAL OF OUR OWN FIELD at reference points.
//
// WHY THE RESIDUAL AND NOT THE RING OUTLINE DIRECTLY. Primitives smooth-union,
// and smin(a, b) < min(a, b), so the union surface is always FATTER than any
// single primitive. Reading a measured ring straight onto a prim's `r`
// systematically over-fattens — which is visible being corrected by hand all
// through mouse.blob's comments. sdBody IS the blended field, so its value at
// a reference point is the error with blending already folded in.
import type { ClusterInfo, Primitive, Vec3 } from './types';
import { sdBody, sdPrimitive } from './validate';
import { add, len, normalize, scale as vscale, sub } from './vec';

interface Body { prims: Primitive[]; clusters: ClusterInfo[] }

/** Central-difference gradient of sdBody, normalised. */
function gradient(p: Vec3, body: Body, h = 1e-4): Vec3 {
  const g: Vec3 = [
    sdBody([p[0] + h, p[1], p[2]], body) - sdBody([p[0] - h, p[1], p[2]], body),
    sdBody([p[0], p[1] + h, p[2]], body) - sdBody([p[0], p[1] - h, p[2]], body),
    sdBody([p[0], p[1], p[2] + h], body) - sdBody([p[0], p[1], p[2] - h], body),
  ];
  return len(g) < 1e-12 ? [0, 1, 0] : normalize(g);
}

/**
 * Newton-step a point onto sdBody == 0. Converges from either side; the field
 * is not a true distance for anisotropic prims (it under-reports by minScale),
 * so this iterates rather than taking one step.
 */
export function projectToSurface(p: Vec3, body: Body, steps = 24): Vec3 {
  let q = p;
  for (let i = 0; i < steps; i++) {
    const d = sdBody(q, body);
    if (Math.abs(d) < 1e-9) break;
    q = sub(q, vscale(gradient(q, body), d));
  }
  return q;
}

/**
 * Synthesise a reference-shaped point set FROM a body: sample each primitive's
 * own surface, then project onto the blended body. Test instrument, and the
 * only way to check the fitter against ground truth without a GLB.
 */
export function sampleBodySurface(body: Body, perPrim = 200): Map<string, Vec3[]> {
  const out = new Map<string, Vec3[]>();
  for (const prim of body.prims) {
    if (prim.dead || prim.op === 'sub' || prim.op === 'groove') continue;
    const bone = prim.bone ?? 'unknown';
    let list = out.get(bone);
    if (list === undefined) { list = []; out.set(bone, list); }
    const axis = sub(prim.b, prim.a);
    const axisLen = len(axis);
    for (let i = 0; i < perPrim; i++) {
      // Deterministic spiral over the prim's own surface: no Math.random, so
      // a failing test reproduces exactly.
      const t = perPrim === 1 ? 0.5 : i / (perPrim - 1);
      const theta = i * 2.399963229728653; // golden angle, in radians
      const along = add(prim.a, vscale(axis, axisLen === 0 ? 0 : t));
      const r = prim.radius + ((prim.radiusB ?? prim.radius) - prim.radius) * t;
      // Push out along a world-axis ring, scaled by the prim's own anisotropy.
      const seed: Vec3 = [Math.cos(theta) * prim.scale[0], 0, Math.sin(theta) * prim.scale[2]];
      const p = add(along, vscale(seed, r * 1.4));
      const q = projectToSurface(p, body);
      if (Math.abs(sdBody(q, body)) < 1e-6) list.push(q);
    }
  }
  return out;
}

/** Nearest and second-nearest add-primitive indices, mirroring nearestPrim's skips. */
export function twoNearestPrims(p: Vec3, body: Body): { first: number; firstD: number; secondD: number } {
  let first = -1, firstD = Infinity, secondD = Infinity;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (let i = c.start; i < c.start + c.count; i++) {
      const prim = body.prims[i]!;
      if (prim.op === 'sub' || prim.op === 'groove' || prim.dead) continue;
      const d = sdPrimitive(p, prim);
      if (d < firstD) { secondD = firstD; firstD = d; first = i; }
      else if (d < secondD) { secondD = d; }
    }
  }
  return { first, firstD, secondD };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/ring-fit.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/ring-fit.ts src/lab/sdf-zombie/ring-fit.test.ts
git commit -m "feat(ring-fit): surface projection and body-surface sampling (ground-truth instrument)"
```

---

### Task 5: `ring-fit.ts` — bin residuals per primitive

**Files:**
- Modify: `src/lab/sdf-zombie/ring-fit.ts` (append)
- Test: `src/lab/sdf-zombie/ring-fit.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/ring-fit.test.ts`:

```ts
import { binResiduals, sampleBodySurface as sample } from './ring-fit';
import { ringBasis } from './ref-align';
import type { ResolvedBone } from './types';

/** Two blended capsules stacked on one bone — exercises the blend seam. */
function twoCapsules(radius0 = 0.1) {
  const prims: Primitive[] = [
    { a: [0, 0.0, 0], b: [0, 0.5, 0], radius: radius0, scale: [1, 1, 1],
      blendK: 0.03, limb: 'torso', cluster: 0, bone: 'spine1', src: 10 },
    { a: [0, 0.5, 0], b: [0, 1.0, 0], radius: 0.09, scale: [1, 1, 1],
      blendK: 0.03, limb: 'torso', cluster: 0, bone: 'spine1', src: 11 },
  ];
  const clusters: ClusterInfo[] = [
    { id: 0, limb: 'torso', start: 0, count: 2, center: [0, 0.5, 0], radius: 1, alive: true },
  ];
  const bones = new Map<string, ResolvedBone>([['spine1', { head: [0, 0, 0], tail: [0, 1, 0] }]]);
  return { prims, clusters, bones };
}

describe('binResiduals', () => {
  it('reports near-zero residual when the body IS the reference', () => {
    const body = twoCapsules();
    const bins = binResiduals(sample(body, 300), body, body.bones);
    for (const bin of bins.values()) {
      const meanAbs = bin.samples.reduce((s, x) => s + Math.abs(x.d), 0) / bin.samples.length;
      expect(meanAbs).toBeLessThan(1e-4);
    }
  });

  it('reports a proud body as negative residual', () => {
    const ref = sample(twoCapsules(0.10), 300);      // reference at r=0.10
    const fat = twoCapsules(0.12);                    // ours is 20mm fatter
    const bins = binResiduals(ref, fat, fat.bones);
    const bin = bins.get(0)!;
    const mean = bin.samples.reduce((s, x) => s + x.d, 0) / bin.samples.length;
    expect(mean).toBeLessThan(-0.005);                // negative == proud
  });

  it('flags the blend seam', () => {
    const body = twoCapsules();
    const bins = binResiduals(sample(body, 400), body, body.bones);
    // Both prims sit within blendK of each other at y=0.5, so neither should
    // report a zero blend-dominated fraction.
    expect(bins.get(0)!.blendDominated).toBeGreaterThan(0);
    expect(bins.get(0)!.blendDominated).toBeLessThan(1);
  });

  it('bins theta in the basis that ringBasis defines', () => {
    const body = twoCapsules();
    const b = ringBasis([0, 0, 0], [0, 1, 0]);
    expect(b.heldAxis).toBe(0);
    const bins = binResiduals(sample(body, 200), body, body.bones);
    const thetas = bins.get(0)!.samples.map((s) => s.theta);
    expect(Math.min(...thetas)).toBeLessThan(-2);
    expect(Math.max(...thetas)).toBeGreaterThan(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/ring-fit.test.ts -t binResiduals`
Expected: FAIL — `binResiduals is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `src/lab/sdf-zombie/ring-fit.ts`:

```ts
import type { ResolvedBone } from './types';
import { ringBasis, toLocal, type RingBasis } from './ref-align';

export interface PrimSample {
  /** Position along the primitive's own axis, 0 at `a` and 1 at `b`. */
  t: number;
  /** Angle in the ring basis: 0 along e1 (held axis), +pi/2 along e2 (solved). */
  theta: number;
  /** sdBody at the reference point. Negative == our surface is PROUD of it. */
  d: number;
}

export interface PrimBin {
  prim: number;
  basis: RingBasis;
  samples: PrimSample[];
  /** Share of samples with a second primitive within blendK. Their numbers are soft. */
  blendDominated: number;
  /** Reference points that landed on a prim belonging to a DIFFERENT bone. */
  crossBone: number;
}

/**
 * Attribute every reference point to a primitive and record its residual in
 * that primitive's ring frame.
 *
 * A point whose nearest primitive rides a different bone than the one that
 * claimed it is counted in `crossBone` and DROPPED. That happens legitimately
 * where a torso prim's flesh covers the shoulder, and silently averaging it
 * into the shoulder's radius is exactly the mis-attribution this tool exists
 * to remove.
 */
export function binResiduals(
  pointsByBone: Map<string, Vec3[]>,
  body: Body,
  bones: Map<string, ResolvedBone>,
): Map<number, PrimBin> {
  const bins = new Map<number, PrimBin>();
  const basisOf = new Map<number, RingBasis>();

  for (const [boneName, points] of pointsByBone) {
    const bone = bones.get(boneName);
    if (!bone) continue;
    for (const p of points) {
      const { first, firstD, secondD } = twoNearestPrims(p, body);
      if (first < 0) continue;
      const prim = body.prims[first]!;

      let bin = bins.get(first);
      if (bin === undefined) {
        // The ring frame follows the PRIMITIVE's own axis where it has one, so
        // a prim offset off its bone still measures around itself. A point
        // prim (a == b) falls back to the bone's direction.
        let basis = basisOf.get(first);
        if (basis === undefined) {
          const axisLen = len(sub(prim.b, prim.a));
          basis = axisLen > 1e-9
            ? ringBasis(prim.a, prim.b)
            : ringBasis(prim.a, add(prim.a, sub(bone.tail, bone.head)));
          basisOf.set(first, basis);
        }
        bin = { prim: first, basis, samples: [], blendDominated: 0, crossBone: 0 };
        bins.set(first, bin);
      }

      if (prim.bone !== undefined && prim.bone !== boneName) { bin.crossBone++; continue; }

      const l = toLocal(p, bin.basis);
      const t = bin.basis.length > 1e-9
        ? Math.max(0, Math.min(1, l.along / bin.basis.length))
        : 0.5;
      bin.samples.push({ t, theta: Math.atan2(l.x2, l.x1), d: sdBody(p, body) });
      if (secondD - firstD < prim.blendK) bin.blendDominated++;
    }
  }

  for (const bin of bins.values()) {
    const n = bin.samples.length + bin.crossBone;
    bin.blendDominated = n === 0 ? 0 : bin.blendDominated / n;
  }
  return bins;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/ring-fit.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/ring-fit.ts src/lab/sdf-zombie/ring-fit.test.ts
git commit -m "feat(ring-fit): bin reference residuals per primitive in its ring frame"
```

---

### Task 6: `ring-fit.ts` — Fourier decomposition into suggestions

This is the load-bearing task. Its test is a **round-trip against ground truth**, and it must be **proven to fail** under a deliberate perturbation before it is trusted.

**Files:**
- Modify: `src/lab/sdf-zombie/ring-fit.ts` (append)
- Test: `src/lab/sdf-zombie/ring-fit.test.ts` (append)

The arithmetic, derived once so the implementation does not have to re-derive it. With `d < 0` meaning our surface is proud:

- `a0 = mean(d)`, `a1 = 2·mean(d·cos θ)`, `b1 = 2·mean(d·sin θ)`, `a2 = 2·mean(d·cos 2θ)`, `b2 = 2·mean(d·sin 2θ)`
- `m` = least-squares slope of `d` against `(t − t̄)`
- Semi-axis change along e1 (held) is `a0 + a2`; along e2 (solved) is `a0 − a2`
- `r_new = r + (a0 + a2) / scale[heldAxis]`
- `solved_new = (r·scale[solvedAxis] + (a0 − a2)) / r_new`
- Offset correction is `a1·e1 + b1·e2` (a prim displaced `+δ` along e1 makes reference points there read `d ≈ −δ cos θ`, so `a1 = −δ`)
- Taper, only when `|m|` clears the noise floor: `r_new = r + (a0 + m·(0 − t̄)) / scale[heldAxis]`, `r2_new = (radiusB ?? r) + (a0 + m·(1 − t̄)) / scale[heldAxis]`
- Noise floor is `stdev(d) / 4`. **This ratio is a guess** — the spec says to re-derive it from the observed spread after the first real pass and record what it moved to.

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/ring-fit.test.ts`:

```ts
import { fitPrims } from './ring-fit';

/** Fit a perturbed body against a reference sampled from the unperturbed one. */
function roundTrip(perturb: (b: ReturnType<typeof twoCapsules>) => void) {
  const truth = twoCapsules();
  const reference = sample(truth, 600);
  const ours = twoCapsules();
  perturb(ours);
  return fitPrims(binResiduals(reference, ours, ours.bones), ours);
}

describe('fitPrims — ground truth round trip', () => {
  it('NEGATIVE CONTROL: suggests nothing when the body already matches', () => {
    const s = roundTrip(() => {});
    for (const one of s) {
      expect(one.r).toBeUndefined();
      expect(one.solvedScale).toBeUndefined();
      expect(one.offset).toBeUndefined();
    }
  });

  it('recovers a known radius error', () => {
    // Ours is 8mm too thin on prim 0; the fit must put it back to 0.100.
    const s = roundTrip((b) => { b.prims[0]!.radius = 0.092; });
    const p0 = s.find((x) => x.prim === 0)!;
    expect(p0.r).toBeDefined();
    expect(p0.r!.from).toBeCloseTo(0.092, 6);
    expect(p0.r!.to).toBeGreaterThan(0.0975);
    expect(p0.r!.to).toBeLessThan(0.1025);
  });

  it('recovers a known anisotropy error', () => {
    // Ours is 25% too deep in z. Solved axis for a y-bone is `deep`.
    const s = roundTrip((b) => { b.prims[0]!.scale = [1, 1, 1.25]; });
    const p0 = s.find((x) => x.prim === 0)!;
    expect(p0.solvedScale).toBeDefined();
    expect(p0.solvedScale!.axis).toBe('deep');
    expect(p0.solvedScale!.to).toBeGreaterThan(0.94);
    expect(p0.solvedScale!.to).toBeLessThan(1.06);
  });

  it('recovers a known lateral offset', () => {
    // Shift prim 0 by +6mm in x; the fix must point back by about -6mm.
    const s = roundTrip((b) => {
      b.prims[0]!.a = [0.006, 0.0, 0];
      b.prims[0]!.b = [0.006, 0.5, 0];
    });
    const p0 = s.find((x) => x.prim === 0)!;
    expect(p0.offset).toBeDefined();
    expect(p0.offset!.delta[0]).toBeLessThan(-0.004);
    expect(p0.offset!.delta[0]).toBeGreaterThan(-0.008);
    expect(Math.abs(p0.offset!.delta[2])).toBeLessThan(0.002);
  });

  it('IS PROVEN TO FAIL under a perturbation it should catch', () => {
    // If this ever passes, the fitter has stopped measuring anything.
    const s = roundTrip((b) => { b.prims[0]!.radius = 0.060; });
    const p0 = s.find((x) => x.prim === 0)!;
    expect(p0.r).toBeDefined();
    expect(Math.abs(p0.r!.to - 0.060)).toBeGreaterThan(0.02);
  });

  it('skips primitives it cannot model, and says which', () => {
    const truth = twoCapsules();
    const reference = sample(truth, 300);
    const ours = twoCapsules();
    ours.prims[1]!.bend = [0, 0, 0.02];
    const s = fitPrims(binResiduals(reference, ours, ours.bones), ours);
    const p1 = s.find((x) => x.prim === 1)!;
    expect(p1.skipped).toMatch(/bend/i);
    expect(p1.r).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/ring-fit.test.ts -t "ground truth"`
Expected: FAIL — `fitPrims is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `src/lab/sdf-zombie/ring-fit.ts`:

```ts
import { SCALE_AXIS_NAMES } from './ref-align';

/** Below this many samples a primitive's numbers are noise; it is reported, not fitted. */
export const MIN_SAMPLES = 40;

export interface Change<T> { from: T; to: T; why: string }

export interface Suggestion {
  prim: number;
  /** 1-based .blob line, carried through from PrimDef.src. */
  src?: number;
  bone?: string;
  n: number;
  /** Mean |residual| in metres — the sort key. */
  meanAbs: number;
  blendDominated: number;
  crossBone: number;
  r?: Change<number>;
  r2?: Change<number>;
  solvedScale?: { axis: (typeof SCALE_AXIS_NAMES)[number] } & Change<number>;
  offset?: { delta: Vec3; why: string };
  /** Set when the primitive was deliberately not fitted. Nothing else is populated. */
  skipped?: string;
}

function mm(v: number): string { return `${(v * 1000).toFixed(1)}mm`; }

/**
 * Why a primitive cannot be fitted, or undefined when it can.
 *
 * bend/shell/orient all move or reshape the surface in ways the ring
 * decomposition does not model. Reporting them as skipped is honest; fitting
 * them anyway would produce a confident wrong number, which is worse than no
 * number at all.
 */
function skipReason(prim: Primitive): string | undefined {
  if (prim.dead) return 'dead (severed)';
  if (prim.op === 'sub') return 'carve — subtractive, no outer surface of its own';
  if (prim.op === 'groove') return 'groove — cuts a channel, not mass';
  if (prim.shell) return 'shell — a clipped sheet, not a ring';
  if (prim.bend) return 'bend — the medial curve is not the chord';
  if (prim.orient && Math.abs(1 - prim.orient[3]) > 1e-6) return 'orient — scale frame is rotated';
  return undefined;
}

export function fitPrims(bins: Map<number, PrimBin>, body: Body): Suggestion[] {
  const out: Suggestion[] = [];

  for (const [index, bin] of bins) {
    const prim = body.prims[index]!;
    const base = {
      prim: index, src: prim.src, bone: prim.bone,
      n: bin.samples.length, blendDominated: bin.blendDominated, crossBone: bin.crossBone,
    };

    const skipped = skipReason(prim);
    if (skipped !== undefined) { out.push({ ...base, meanAbs: 0, skipped }); continue; }
    if (bin.samples.length < MIN_SAMPLES) {
      out.push({ ...base, meanAbs: 0, skipped: `only ${bin.samples.length} samples (need ${MIN_SAMPLES})` });
      continue;
    }

    const n = bin.samples.length;
    const d = bin.samples.map((s) => s.d);
    const a0 = d.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(d.reduce((s, x) => s + (x - a0) ** 2, 0) / n);
    // The noise floor scales with the character rather than being a fixed
    // millimetre count. The 1/4 is a GUESS — re-derive it from the observed
    // spread once a real character has been through a pass (see the spec).
    const floor = sd / 4;

    let a1 = 0, b1 = 0, a2 = 0, b2 = 0, tbar = 0;
    for (const s of bin.samples) {
      a1 += s.d * Math.cos(s.theta);  b1 += s.d * Math.sin(s.theta);
      a2 += s.d * Math.cos(2 * s.theta); b2 += s.d * Math.sin(2 * s.theta);
      tbar += s.t;
    }
    a1 = 2 * a1 / n; b1 = 2 * b1 / n; a2 = 2 * a2 / n; b2 = 2 * b2 / n; tbar /= n;

    let sxy = 0, sxx = 0;
    for (const s of bin.samples) { const dt = s.t - tbar; sxy += dt * s.d; sxx += dt * dt; }
    const m = sxx < 1e-12 ? 0 : sxy / sxx;

    const held = prim.scale[bin.basis.heldAxis];
    const solvedNow = prim.scale[bin.basis.solvedAxis];
    const sug: Suggestion = { ...base, meanAbs: d.reduce((s, x) => s + Math.abs(x), 0) / n };

    const tapered = Math.abs(m) > floor && bin.basis.length > 1e-9;
    let rNew: number;
    if (tapered) {
      rNew = prim.radius + (a0 + m * (0 - tbar)) / held;
      const r2Now = prim.radiusB ?? prim.radius;
      sug.r2 = { from: r2Now, to: r2Now + (a0 + m * (1 - tbar)) / held,
                 why: `taper: ${mm(m)} of residual across the primitive` };
    } else {
      rNew = prim.radius + (a0 + a2) / held;
    }
    if (Math.abs(rNew - prim.radius) > floor / held) {
      sug.r = { from: prim.radius, to: rNew,
                why: tapered ? 'taper, see r2' : `uniform, ${mm(a0 + a2)}` };
    }

    if (Math.abs(a2) > floor && rNew > 1e-6) {
      const solvedNew = (prim.radius * solvedNow + (a0 - a2)) / rNew;
      sug.solvedScale = {
        axis: SCALE_AXIS_NAMES[bin.basis.solvedAxis]!,
        from: solvedNow, to: solvedNew,
        why: `cos2θ: ${mm(a0 + a2)} on ${SCALE_AXIS_NAMES[bin.basis.heldAxis]}, ${mm(a0 - a2)} on ${SCALE_AXIS_NAMES[bin.basis.solvedAxis]}`,
      };
    }

    if (Math.hypot(a1, b1) > floor) {
      sug.offset = {
        delta: add(vscale(bin.basis.e1, a1), vscale(bin.basis.e2, b1)),
        why: `cos1θ ${mm(Math.hypot(a1, b1))} off-centre`,
      };
    }

    out.push(sug);
  }

  return out.sort((x, y) => y.meanAbs - x.meanAbs);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/ring-fit.test.ts`
Expected: PASS, 14 tests.

If the round-trip tolerances fail marginally, **do not widen them to make the test green.** Widening a tolerance to fit the error it is meant to catch measures nothing. Raise the sample count in `roundTrip` first, and only if the error is genuinely structural, record what it is in a comment on the test.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/ring-fit.ts src/lab/sdf-zombie/ring-fit.test.ts
git commit -m "feat(ring-fit): decompose residuals into r/scale/offset/taper suggestions"
```

---

### Task 7: `ring-fit.ts` — merge mirrored primitives

`both` / `mirror` expands one `.blob` line into two placed primitives. They share a `src`, so their suggestions must merge back to a single number — and a large left/right disagreement means either the reference is genuinely asymmetric or the alignment is wrong.

**Files:**
- Modify: `src/lab/sdf-zombie/ring-fit.ts` (append)
- Test: `src/lab/sdf-zombie/ring-fit.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
import { mergeMirrored, type Suggestion } from './ring-fit';

const base = (over: Partial<Suggestion>): Suggestion => ({
  prim: 0, src: 7, bone: 'thigh.l', n: 500, meanAbs: 0.004,
  blendDominated: 0, crossBone: 0, ...over,
});

describe('mergeMirrored', () => {
  it('averages two suggestions that share a .blob line', () => {
    const merged = mergeMirrored([
      base({ prim: 0, bone: 'thigh.l', r: { from: 0.05, to: 0.060, why: 'uniform' } }),
      base({ prim: 1, bone: 'thigh.r', r: { from: 0.05, to: 0.070, why: 'uniform' } }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.r!.to).toBeCloseTo(0.065, 9);
  });

  it('reports the left/right disagreement in metres', () => {
    const merged = mergeMirrored([
      base({ prim: 0, bone: 'thigh.l', r: { from: 0.05, to: 0.060, why: 'uniform' } }),
      base({ prim: 1, bone: 'thigh.r', r: { from: 0.05, to: 0.070, why: 'uniform' } }),
    ]);
    expect(merged[0]!.mirrorDisagreement).toBeCloseTo(0.010, 9);
  });

  it('reports no disagreement for a symmetric body', () => {
    const merged = mergeMirrored([
      base({ prim: 0, bone: 'thigh.l', r: { from: 0.05, to: 0.06, why: 'uniform' } }),
      base({ prim: 1, bone: 'thigh.r', r: { from: 0.05, to: 0.06, why: 'uniform' } }),
    ]);
    expect(merged[0]!.mirrorDisagreement).toBe(0);
  });

  it('leaves an unmirrored primitive alone', () => {
    const merged = mergeMirrored([base({ prim: 0, src: 3, bone: 'chest' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.mirrorDisagreement).toBeUndefined();
  });

  it('does not merge two primitives that merely have no src', () => {
    const merged = mergeMirrored([
      base({ prim: 0, src: undefined, bone: 'a' }),
      base({ prim: 1, src: undefined, bone: 'b' }),
    ]);
    expect(merged).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/ring-fit.test.ts -t mergeMirrored`
Expected: FAIL — `mergeMirrored is not exported`.

- [ ] **Step 3: Write the implementation**

Add `mirrorDisagreement?: number;` to the `Suggestion` interface, then append:

```ts
/**
 * Fold the two placed primitives of a mirrored .blob line back into one
 * suggestion, because the source carries ONE number.
 *
 * The averaged value is only half the output: `mirrorDisagreement` is how far
 * apart the two sides wanted to be. A large one means the reference is
 * genuinely asymmetric or the alignment is wrong, and both are worth knowing
 * before trusting the average.
 *
 * A primitive with no `src` is never merged — an absent line number is not a
 * shared line number.
 */
export function mergeMirrored(suggestions: Suggestion[]): Suggestion[] {
  const bySrc = new Map<number, Suggestion[]>();
  const loose: Suggestion[] = [];
  for (const s of suggestions) {
    if (s.src === undefined) { loose.push(s); continue; }
    let list = bySrc.get(s.src);
    if (list === undefined) { list = []; bySrc.set(s.src, list); }
    list.push(s);
  }

  const out: Suggestion[] = [...loose];
  for (const group of bySrc.values()) {
    if (group.length === 1) { out.push(group[0]!); continue; }
    const [a, b] = group as [Suggestion, Suggestion];
    const avg = (x?: number, y?: number) => (x !== undefined && y !== undefined ? (x + y) / 2 : x ?? y);
    const merged: Suggestion = {
      ...a,
      n: group.reduce((s, g) => s + g.n, 0),
      meanAbs: group.reduce((s, g) => s + g.meanAbs, 0) / group.length,
      blendDominated: group.reduce((s, g) => s + g.blendDominated, 0) / group.length,
      crossBone: group.reduce((s, g) => s + g.crossBone, 0),
      mirrorDisagreement: Math.abs((a.r?.to ?? 0) - (b.r?.to ?? 0)),
    };
    if (a.r || b.r) merged.r = { from: a.r?.from ?? b.r!.from, to: avg(a.r?.to, b.r?.to)!, why: a.r?.why ?? b.r!.why };
    if (a.r2 || b.r2) merged.r2 = { from: a.r2?.from ?? b.r2!.from, to: avg(a.r2?.to, b.r2?.to)!, why: a.r2?.why ?? b.r2!.why };
    if (a.solvedScale || b.solvedScale) {
      const s = (a.solvedScale ?? b.solvedScale)!;
      merged.solvedScale = { ...s, to: avg(a.solvedScale?.to, b.solvedScale?.to)! };
    }
    // Offset is NOT averaged: mirrored sides carry opposite lateral offsets by
    // construction, so their mean is meaningless. Keep the left side's and say so.
    merged.offset = a.offset ? { ...a.offset, why: `${a.offset.why} (left side; mirrored line)` } : undefined;
    out.push(merged);
  }
  return out.sort((x, y) => y.meanAbs - x.meanAbs);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/ring-fit.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/ring-fit.ts src/lab/sdf-zombie/ring-fit.test.ts
git commit -m "feat(ring-fit): merge mirrored primitives and report left/right disagreement"
```

---

### Task 8: `scripts/blob-rings.ts` — the CLI

**Files:**
- Create: `scripts/blob-rings.ts`
- Modify: `package.json` (add the `blob:rings` script)
- Test: `src/lab/sdf-zombie/ring-fit.test.ts` (append the integration test)

The loading pattern is already established in `scripts/blob-measure.ts:337-342`:

```ts
const blobPath = `src/lab/sdf-zombie/characters/${name}.blob`;
const doc = parseBlob(readFileSync(blobPath, 'utf8'));
const body = buildBody(compileBlob(doc, compileFace(doc)));
```

- [ ] **Step 1: Write the failing integration test**

Append to `src/lab/sdf-zombie/ring-fit.test.ts`:

```ts
import { readFileSync, existsSync } from 'node:fs';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { readRefSkin } from './ref-skin';
import { groupByBone, refBones, ringBasis as rb, globalScale, refToBody } from './ref-align';

const MOUSE_GLB = 'docs/dev-notes/refs/mouse-mesh/mouse.glb';

describe.skipIf(!existsSync(MOUSE_GLB))('integration: mouse against its reference mesh', () => {
  function run() {
    const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/mouse.blob', 'utf8'));
    const body = buildBody(compileBlob(doc, compileFace(doc)));
    const skin = readRefSkin(new Uint8Array(readFileSync(MOUSE_GLB)));
    const ref = refBones(skin.jointWorld);
    const g = globalScale(ref, body.bones);
    const { byBone } = groupByBone(skin);
    const inBody = new Map<string, Vec3[]>();
    for (const [bone, pts] of byBone) {
      const r = ref.get(bone), o = body.bones.get(bone);
      if (!r || !o) continue;
      const rBasis = rb(r.head, r.tail), oBasis = rb(o.head, o.tail);
      inBody.set(bone, pts.map((p) => refToBody(p, rBasis, oBasis, g.scale)));
    }
    return { body, g, suggestions: mergeMirrored(fitPrims(binResiduals(inBody, body, body.bones), body)) };
  }

  it('measures a global scale near the reference rig`s own 0.01, from real bones', () => {
    const { g } = run();
    expect(g.n).toBeGreaterThan(10);
    expect(g.scale).toBeGreaterThan(0.005);
    expect(g.scale).toBeLessThan(0.02);
  });

  it('produces suggestions that name real .blob lines', () => {
    const { suggestions } = run();
    const fitted = suggestions.filter((s) => s.skipped === undefined);
    expect(fitted.length).toBeGreaterThan(5);
    const lines = readFileSync('src/lab/sdf-zombie/characters/mouse.blob', 'utf8').split('\n');
    for (const s of fitted.slice(0, 3)) {
      expect(s.src).toBeGreaterThan(0);
      // The named line must actually be a primitive declaration.
      expect(lines[s.src! - 1]).toMatch(/^\s*(blob|bar)\s/);
    }
  });

  it('PINS THE BONES OF THE THREE WORST PRIMITIVES, NOT THEIR NUMBERS', () => {
    // Numbers must be free to move as mouse.blob improves — pinning them would
    // make every genuine improvement read as a regression. The bones are the
    // stable claim: this is a smoke test that attribution is sane, not a score.
    const { suggestions } = run();
    const worst = suggestions.filter((s) => s.skipped === undefined).slice(0, 3);
    for (const s of worst) {
      expect(s.bone).toBeDefined();
      expect(s.bone).not.toMatch(/^skull/);   // head is out of scope
      expect(s.bone).not.toMatch(/^(hand|f_)/); // hands are out of scope
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/ring-fit.test.ts -t integration`
Expected: FAIL — missing imports, or a real failure from wiring not yet exercised. Fix `ring-fit.ts`/`ref-align.ts` until it passes; **do not** relax the assertions.

- [ ] **Step 3: Write the CLI**

Create `scripts/blob-rings.ts`:

```ts
// Fit a .blob's primitives to a skinned reference mesh, worst-first.
//
//   npm run blob:rings -- mouse
//   npm run blob:rings -- mouse --json
//   npm run blob:rings -- mouse --glb path/to/mesh.glb
//
// SUGGESTS, NEVER APPLIES. .blob comments carry design intent a fit cannot
// see — mouse.blob's `deep 1.15, not 1.30` exists because the reference mesh
// is DRESSED and the flesh must sit a fabric's thickness inside it. A person
// reads these numbers and decides.
//
// EXIT CODES, matching blob-measure: 0 whenever it RAN, however bad the
// numbers; 2 for "did not run". An agent must never be able to read a failure
// to run as a perfect fit.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { readRefSkin } from '../src/lab/sdf-zombie/ref-skin';
import { groupByBone, refBones, ringBasis, globalScale, refToBody } from '../src/lab/sdf-zombie/ref-align';
import { binResiduals, fitPrims, mergeMirrored } from '../src/lab/sdf-zombie/ring-fit';
import type { Vec3 } from '../src/lab/sdf-zombie/types';

function fail(msg: string): never { console.error(msg); process.exit(2); }

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
if (!name) fail('usage: npm run blob:rings -- <character> [--json] [--glb <path>]');
const asJson = args.includes('--json');
const glbFlag = args.indexOf('--glb') >= 0 ? args[args.indexOf('--glb') + 1] : undefined;

const blobPath = `src/lab/sdf-zombie/characters/${name}.blob`;
if (!existsSync(blobPath)) fail(`no such character: ${blobPath}`);

let glbPath = glbFlag;
if (!glbPath) {
  const dir = `docs/dev-notes/refs/${name}-mesh`;
  const canonical = `${dir}/${name}.glb`;
  if (existsSync(canonical)) glbPath = canonical;
  else if (existsSync(dir)) {
    const first = readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()[0];
    if (first) {
      glbPath = `${dir}/${first}`;
      console.error(`warning: ${canonical} is missing; scoring against ${glbPath}`);
    }
  }
}
if (!glbPath) fail(`no reference mesh for ${name}. blob:rings needs a SKINNED mesh; a reference plate cannot be used.`);

const doc = parseBlob(readFileSync(blobPath, 'utf8'));
const body = buildBody(compileBlob(doc, compileFace(doc)));
if (body.errors.length) console.error(`warning: body has ${body.errors.length} build error(s); numbers may be meaningless`);

// fail() returns never, so this narrows to RefSkin without a mutable binding.
const skin = (() => {
  try { return readRefSkin(new Uint8Array(readFileSync(glbPath))); }
  catch (e) { fail(`${glbPath}: ${(e as Error).message}`); }
})();

const ref = refBones(skin.jointWorld);
const g = globalScale(ref, body.bones);
const { byBone, unmapped } = groupByBone(skin);

const inBody = new Map<string, Vec3[]>();
for (const [bone, pts] of byBone) {
  const r = ref.get(bone), o = body.bones.get(bone);
  if (!r || !o) continue;
  const rB = ringBasis(r.head, r.tail), oB = ringBasis(o.head, o.tail);
  inBody.set(bone, pts.map((p) => refToBody(p, rB, oB, g.scale)));
}

const suggestions = mergeMirrored(fitPrims(binResiduals(inBody, body, body.bones), body));

if (asJson) {
  console.log(JSON.stringify({ character: name, mesh: glbPath, scale: g, coverage: {
    total: skin.total, dropped: skin.dropped, unmapped: Object.fromEntries(unmapped),
  }, suggestions }, null, 2));
  process.exit(0);
}

const mm = (v: number) => `${(v * 1000).toFixed(1)}mm`;
console.log(`=== mesh ${glbPath}  scale ${g.scale.toFixed(5)} (${g.n} bones, spread ${g.spreadPct.toFixed(1)}%, furthest ${g.worstBone})`);
console.log(`=== ${skin.total - skin.dropped}/${skin.total} verts assigned, ${skin.dropped} below dominant weight`);
if (unmapped.size) console.log(`=== unmapped joints: ${[...unmapped].map(([j, n]) => `${j}(${n})`).join(', ')}`);
console.log(`=== head skipped — use \`npx tsx scripts/head-profile.ts ${name}\``);
console.log();

let rank = 0;
for (const s of suggestions) {
  if (s.skipped !== undefined) continue;
  if (!s.r && !s.r2 && !s.solvedScale && !s.offset) continue;
  rank++;
  console.log(`  ${rank}. ${name}.blob:${s.src ?? '?'}   ${s.bone ?? '?'}`);
  const flags = [`n=${s.n}`, `blend-dominated ${(s.blendDominated * 100).toFixed(0)}%`];
  if (s.crossBone) flags.push(`cross-bone dropped ${s.crossBone}`);
  if (s.mirrorDisagreement) flags.push(`L/R disagree ${mm(s.mirrorDisagreement)}`);
  console.log(`     mean ${mm(s.meanAbs)}    ${flags.join('   ')}`);
  if (s.r) console.log(`     r      ${s.r.from.toFixed(4)} -> ${s.r.to.toFixed(4)}   ${s.r.why}`);
  if (s.r2) console.log(`     r2     ${s.r2.from.toFixed(4)} -> ${s.r2.to.toFixed(4)}   ${s.r2.why}`);
  if (s.solvedScale) console.log(`     ${s.solvedScale.axis.padEnd(6)} ${s.solvedScale.from.toFixed(3)} -> ${s.solvedScale.to.toFixed(3)}    ${s.solvedScale.why}`);
  if (s.offset) console.log(`     offset delta (${s.offset.delta.map((v) => v.toFixed(4)).join(', ')})   ${s.offset.why}`);
  console.log();
}

const skipped = suggestions.filter((s) => s.skipped !== undefined);
if (skipped.length) {
  console.log(`=== ${skipped.length} primitive(s) not fitted:`);
  for (const s of skipped) console.log(`     ${name}.blob:${s.src ?? '?'}  ${s.bone ?? '?'} — ${s.skipped}`);
}

console.log();
console.log('=== bone length ratios (reference : ours) — these are `len=` edits, not radius edits');
for (const [bone, r] of ref) {
  const o = body.bones.get(bone);
  if (!o) continue;
  const rl = Math.hypot(r.tail[0] - r.head[0], r.tail[1] - r.head[1], r.tail[2] - r.head[2]) * g.scale;
  const ol = Math.hypot(o.tail[0] - o.head[0], o.tail[1] - o.head[1], o.tail[2] - o.head[2]);
  console.log(`     ${bone.padEnd(12)} ref ${rl.toFixed(3)}  ours ${ol.toFixed(3)}  ${(100 * (ol / rl - 1)).toFixed(1)}%`);
}
process.exit(0);
```

- [ ] **Step 4: Add the npm script**

In `package.json`, beside `"blob:measure"`:

```json
"blob:rings": "tsx scripts/blob-rings.ts",
```

- [ ] **Step 5: Run it against the real character**

Run: `npm run blob:rings -- mouse`

Expected: a scale near `0.010`, a coverage line accounting for all 32260 vertices, `LeftHand`/`RightHand`/`Head`/`head_end`/`headfront` listed as unmapped, and a worst-first list whose top entries name `blob`/`bar` lines in `mouse.blob`.

**Sanity check before believing any of it:** pick the top suggestion, open that line in `mouse.blob`, and confirm the bone it names matches the bone on the line. If it does not, attribution is wrong and every number below it is too.

- [ ] **Step 6: Run the whole gate**

```bash
npx tsc --noEmit && npx vitest run src/lab/sdf-zombie/
```
Expected: tsc exits 0; the full lab suite passes with the new tests added and no existing test broken.

- [ ] **Step 7: Commit**

```bash
git add scripts/blob-rings.ts package.json src/lab/sdf-zombie/ring-fit.test.ts
git commit -m "feat(ring-fit): blob:rings CLI, worst-first suggestions against a skinned reference"
```

---

### Task 9: Document it where authors will find it

**Files:**
- Modify: `.claude/skills/authoring-sdf-characters/SKILL.md`
- Modify: `TASKS.md`

- [ ] **Step 1: Add `blob:rings` to the skill's measurement section**

In `.claude/skills/authoring-sdf-characters/SKILL.md`, under `## Measure against the mesh, frame-aligned`, add after the `blob:measure` paragraph:

```markdown
**When the reference is a SKINNED mesh, `npm run blob:rings -- <name>` is the
sharper tool.** It does not rasterise: it assigns every reference vertex to its
dominant joint, aligns each bone rigidly under one measured global scale, and
reads `sdBody` at each point — so the residual it reports is the error in
millimetres with blending already folded in, and it suggests a specific `r` /
`r2` / `deep` / `offset` per `.blob` line rather than a band score.

Two consequences worth knowing:

- **Pose does not matter.** Each bone is measured in its own frame, so the mouse
  mesh's T-posed arms against the `.blob`'s 47-degree rest are not a problem and
  no `--range` window is needed. `blob:measure` still needs one.
- **It cannot see the head, the hands, or an unrigged reference.** Head prims are
  offset-positioned features plus a `face` block; the reference rig lumps the
  whole hand into one joint; `cyclops.glb` has no skin at all. Those exit or
  print as skipped, never as a score.

Read `blend-dominated` before acting on a number: a primitive at 60% is telling
you its suggestion is soft, because the surface there belongs to the smooth-min
of two prims and `nearestPrim` had to pick one.
```

- [ ] **Step 2: Add a row to `TASKS.md`**

Under the appropriate section, add:

```markdown
- [x] `P9` **Ring-fit (`blob:rings`)** — fits existing `.blob` prims to a skinned
  reference mesh via `sdBody` residuals; pose-independent, suggests rather than
  applies. Spec `docs/superpowers/specs/2026-08-26-blob-ring-fit-design.md`,
  plan `docs/superpowers/plans/2026-08-26-blob-ring-fit.md`.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/authoring-sdf-characters/SKILL.md TASKS.md
git commit -m "docs(ring-fit): document blob:rings in the authoring skill and TASKS"
```

---

## Done when

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx vitest run src/lab/sdf-zombie/` passes, with no pre-existing test modified to accommodate the new code
- [ ] `npm run blob:rings -- mouse` prints a worst-first list whose top entry's named `.blob` line carries the bone the report claims
- [ ] `npm run blob:rings -- schoolgirl` runs (same rig, so it must)
- [ ] `npm run blob:rings -- cyclops` exits 2 with "no skin", not with a score
- [ ] The ground-truth round-trip test has been **observed to fail** under a deliberate perturbation, not merely observed to pass

## Calibration to record after the first real pass

The spec leaves two numbers as guesses. Once `mouse` has been through a pass,
write down what they actually wanted to be, in a comment at each definition:

1. ~~`MIN_DOMINANT_WEIGHT` (`ref-skin.ts`, starts at 0.60)~~ — **DONE
   2026-08-27.** Swept against both references, moved to **0.50** with a strict
   majority (`<=`) comparison. Dropped share fell 14%→5% (mouse), 20%→5%
   (schoolgirl). Table in the constant's own comment.
2. The noise floor ratio (`ring-fit.ts`, starts at `stdev / 4`) — derive it from
   the observed residual spread. A tolerance the same size as the error it is
   meant to tolerate measures nothing. **Still open.**

3. **Done during Task 4:** `sampleBodySurface`'s Newton budget is no longer the
   fixed 24 of the plan text. It is derived per primitive as
   `min(512, max(24, ceil(24 * ratio)))` where `ratio = max(scale)/min(scale)`,
   because `sdPrimitive` multiplies by `minScale` and Newton therefore degrades
   from quadratic to linear convergence at rate `minScale/maxScale`. At the
   plan's fixed 24 a ratio-4 prim silently kept only 218/400 samples, losing the
   major-axis extremes first and biasing the set INWARD — invisible to the
   plan's own ratio-2 fixture. Loss past 98% retention now warns, naming the
   prim. See `stepsForPrim`'s calibration table.
