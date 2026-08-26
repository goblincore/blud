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

function trs(node: { translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }): Mat4 {
  if (node.matrix) return node.matrix.slice();
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
Expected: PASS, 4 tests.

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
