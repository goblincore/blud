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

/**
 * A joint must hold a STRICT MAJORITY of a vertex to claim it. At or below
 * this, the vertex is genuinely shared across a joint blend and "dominant"
 * would mean a plurality, not a majority — so it is dropped and counted.
 *
 * CALIBRATED, not guessed (2026-08-27). Share of vertices kept, swept against
 * both real references:
 *
 *   threshold   0.90  0.80  0.70  0.60  0.50  0.40
 *   mouse        60%   68%   77%   86%   95%   99%
 *   schoolgirl   41%   54%   65%   80%   95%   99%
 *
 * The spec shipped with 0.60 as an explicit guess. 0.50 is where the knee is
 * — it recovers 15 points on the schoolgirl, where 0.40 buys only 4 more —
 * and it is the only value on the curve with a meaning rather than a number
 * behind it. Re-derive from the coverage line if a future reference is
 * weighted very differently.
 */
export const MIN_DOMINANT_WEIGHT = 0.5;

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
  /** Vertices dropped for a top weight at or below MIN_DOMINANT_WEIGHT. */
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
  // report a confident wrong number. The threshold is 1e-4 RELATIVE: real
  // float32-authored files (the mouse reference's LeftUpLeg) carry ~2e-6 of
  // rounding noise on a nominally uniform scale, which is sub-micron on a
  // metre bone, while a genuinely anisotropic rig is per-cent or worse.
  if (node.scale) {
    const [sx, sy, sz] = node.scale as [number, number, number];
    const spread = Math.max(sx, sy, sz) - Math.min(sx, sy, sz);
    if (spread > 1e-4 * Math.max(Math.abs(sx), Math.abs(sy), Math.abs(sz), 1)) {
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

// MAT4 is here because the inverse bind matrices need it. Reading an accessor
// whose type is missing from this table used to yield `undefined` through a
// non-null assertion and fill the array with NaN — silently, all the way into
// the fitted numbers. Unknown types now throw instead.
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** Read an accessor into a flat number array, honouring byteStride. */
function readAccessor(gltf: any, bin: Uint8Array, index: number): number[] {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const n = COMPONENTS[acc.type];
  if (n === undefined) throw new Error(`unsupported accessor type ${acc.type}`);
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
  const prim = gltf.meshes[gltf.nodes[meshNodeIndex].mesh].primitives[0];

  /**
   * Skinning matrix per joint: `globalTransform(joint) * inverseBindMatrix`.
   *
   * NOT the mesh node's world matrix, which is what this was and which is
   * WRONG BY THE SPEC — glTF defines a skinned vertex's world position as
   * `sum_j w_j * globalTransform(joint_j) * IBM_j * POSITION`, with the mesh
   * node's own transform explicitly cancelled out ("the transform of the node
   * the mesh is attached to is ignored"). Applying it as well double-counts
   * every ancestor scale.
   *
   * On mouse.glb that was not a rounding error. Blender exports the rig under
   * an `Armature` node scaled 0.01 with the bones authored at 100x, so every
   * IBM carries a column scale of exactly 100 to cancel it. Both the joints
   * AND the mesh node hang off that Armature, so multiplying POSITION by the
   * mesh node's world matrix shrank the whole reference surface by 100: a
   * 1.7m character came back 17mm tall, sitting in a heap at the origin while
   * `jointWorld` correctly spanned 1.5m. Every residual downstream was then
   * measured from a point cloud nowhere near the body, and `fitPrims` fitted
   * exactly nothing.
   *
   * A skin with no `inverseBindMatrices` means identity IBMs, per the spec —
   * so a simple rig under a scaled root still gets that root's scale, which
   * is what the two-joint fixture pins.
   */
  const ibm: number[] | undefined = skin.inverseBindMatrices === undefined
    ? undefined
    : readAccessor(gltf, bin, skin.inverseBindMatrices);
  const skinMatrix: Mat4[] = skin.joints.map((j: number, k: number) => {
    const g = world.get(j) ?? IDENTITY;
    return ibm === undefined ? g : mul(g, ibm.slice(k * 16, k * 16 + 16));
  });

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
    // `<=`, not `<`: an exact 0.5/0.5 split is a tie, not a majority, and the
    // tie-break would be whichever weight the exporter happened to write first.
    if (bestW <= MIN_DOMINANT_WEIGHT) { dropped++; continue; }
    // The full weighted blend, not just the dominant joint's matrix. At an
    // exact bind pose the two agree (every `globalTransform * IBM` is the
    // identity there), but a reference exported mid-pose has them disagreeing
    // by up to half a vertex's motion across a joint, and the blended one is
    // the surface that actually exists.
    const raw: Vec3 = [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
    let px = 0, py = 0, pz = 0;
    for (let c = 0; c < 4; c++) {
      const w = wt[i * 4 + c]!;
      if (w === 0) continue;
      const q = apply(skinMatrix[jt[i * 4 + c]!] ?? IDENTITY, raw);
      px += w * q[0]; py += w * q[1]; pz += w * q[2];
    }
    verts.push({ joint: jointNames[bestJ] ?? `joint${bestJ}`, position: [px, py, pz] });
  }
  return { verts, jointWorld, total, dropped };
}
