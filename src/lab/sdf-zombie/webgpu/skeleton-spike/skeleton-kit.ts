// src/lab/sdf-zombie/webgpu/skeleton-spike/skeleton-kit.ts
//
// THE SKELETON KIT: authored bone meshes that stand in for the surface-nets extraction of a body's bone segments.
//
// The surface-nets mesh of a bone segment IS its SDF capsules, so a bare skeleton read as sausages: a ball for a
// shoulder, one rod for a forearm, no vertebrae, femurs that began below the pelvis (owner, 2026-11-15, watching the
// melt strip a body). The kit is one low-poly mesh for each segment, built in Blender against the zombie's rig
// (scripts/skeleton-kit/build_kit.py, public/assets/lab/skeleton-kit.glb): vertebrae on a disc column, the extracted cage's own ribs
// and a sternum, a pelvis with sockets at the rig's hip joints, clavicle and scapula on the shoulder, humerus, radius
// and ulna, a fist, femur with head and neck, kneecap, tibia and fibula, a foot.
//
// A PIECE REPLACES A SEGMENT'S GEOMETRY AND NOTHING ELSE. The segments, their poses, their liveness and their prims
// are the contract's (contract.ts) and stay as they were, so everything that works by segment keeps working: a sever
// hides the piece the frame its segment dies, and the melt drops it with its segment's group (melt-bones.ts groupOf
// reads the segment's first prim). A scapula or a kneecap has no segment of its own: it is part of the piece of the
// segment it rides (the shoulder ball's, the thigh's), which is how it falls with a group and never hangs in the air.
//
// WHICH SEGMENT GETS WHICH PIECE: a piece carries the revision of the segment it was built against (kitRevisionOf:
// the segment's key, prim count and content hash, without the character's name). A source draws the piece whose
// revision is its own, and any other source draws its surface nets as before. So a body that is not the zombie's
// rig, a zombie whose bones were re-derived into something else, and a kit that has gone stale against the blob all
// fall back to the nets, segment by segment, and none of them can draw a bone built for another body. And a body
// draws the kit whole or not at all (SkeletonKit.admit): one that merely shares a segment with the zombie keeps its
// extracted bones throughout.
// skeleton-kit.test.ts holds the shipped kit to the shipped zombie: every piece is some zombie segment's.
//
// TWO PIECES RIDE A FRAME OF THEIR OWN (KitFrame, kitSources), because the rig is particles, not a chain of rigid
// bones, and a real bone has to stay on its neighbours:
//  - the hip bones follow the two hip joints. The rig's hips swing 3-5 cm against the base of its spine in a stride
//    (measured in the game, 2026-11-15); on the pelvis bone's own frame the femoral heads left their sockets by that
//    much. The sacrum is part of the cage's piece instead, and slides between the hip bones.
//  - the clavicle and scapula turn with the rig's clavicle bone about the shoulder joint, so the clavicle's inner
//    end stays at the top of the chest while the socket stays on the humeral head.
// Every other piece rides its segment's frame as the contract poses it.
//
// A piece is authored in the body's REST WORLD frame; a segment's local frame at rest is that frame moved to the
// segment's rest origin (contract.ts: a rest pose is the exact identity), which the piece also carries.
//
// Pure CPU + 'three' (like mesh.ts), no DOM: the GLB is read by hand (one JSON chunk, one binary chunk), so vitest
// builds a kit from the shipped file.
import * as THREE from 'three';
import type { BoneFieldSource, SegmentPose } from './contract';
import { segmentQuat } from '../../rig-frames';
import type { Quat } from '../../vec';
import type { SegmentMesh } from './mesh';
import type { Vec3 } from '../../types';

export const SKELETON_KIT_URL = '/assets/lab/skeleton-kit.glb';

/** A segment's identity for the kit: its key, prim count and content hash, without the character's name, so any body
 *  whose segment is the same geometry draws the same kit piece. */
export function kitRevisionOf(source: Pick<BoneFieldSource, 'revision' | 'character'>): string {
  return source.revision.startsWith(`${source.character}:`) ? source.revision.slice(source.character.length + 1) : source.revision;
}

/** One piece of the kit as the file holds it. */
export interface SkeletonKitPiece {
  /** The segment key it was built for (contract.ts BoneFieldSource.segment). */
  segment: string;
  /** kitRevisionOf the segment it was built against. */
  revision: string;
  /** That segment's rest origin, world. */
  origin: Vec3;
  /** Rest world positions and normals, three floats a vertex. */
  positions: Float32Array;
  normals: Float32Array;
  index: Uint32Array;
  /** The frame the piece rides where it is not its segment's own (kitSources). */
  frame?: KitFrame;
}

/** A piece's own frame, from rig points (indices into RigState.points) and their rest layout:
 *   span  turned by a width line (`lat`: from the second point to the first) and an up line (`up`: first to second),
 *         held by the middle of the width line (`restHold`: that middle at rest, world);
 *   aim   turned with the rig bone `head` -> `tail` (yaw first, as contract.ts poses a segment), about the segment's
 *         own origin. */
export type KitFrame =
  | { kind: 'span'; lat: [number, number]; up: [number, number]; restLat: Vec3; restUp: Vec3; restHold: Vec3 }
  | { kind: 'aim'; head: number; tail: number; restDir: Vec3 };

const sub3 = (a: readonly number[], b: readonly number[]): Vec3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** The orthonormal basis of a width line and an up line: x along the width, y the up made square to it, z = x cross y. */
function spanBasis(lat: Vec3, up: Vec3): [Vec3, Vec3, Vec3] {
  const x = unit3(lat), z = unit3(cross3(x, up));
  return [x, cross3(z, x), z];
}

/** The rotation that takes basis `from` to basis `to`, as a quaternion [x, y, z, w]. */
function basisQuat(from: [Vec3, Vec3, Vec3], to: [Vec3, Vec3, Vec3]): Quat {
  // R = to * from^T, the basis vectors being the columns of `to` and of `from`.
  const m = (r: number, c: number) => to[0][r]! * from[0][c]! + to[1][r]! * from[1][c]! + to[2][r]! * from[2][c]!;
  const m00 = m(0, 0), m11 = m(1, 1), m22 = m(2, 2), tr = m00 + m11 + m22;
  if (tr > 0) { const k = Math.sqrt(tr + 1) * 2; return [(m(2, 1) - m(1, 2)) / k, (m(0, 2) - m(2, 0)) / k, (m(1, 0) - m(0, 1)) / k, k / 4]; }
  if (m00 > m11 && m00 > m22) { const k = Math.sqrt(1 + m00 - m11 - m22) * 2; return [k / 4, (m(0, 1) + m(1, 0)) / k, (m(0, 2) + m(2, 0)) / k, (m(2, 1) - m(1, 2)) / k]; }
  if (m11 > m22) { const k = Math.sqrt(1 + m11 - m00 - m22) * 2; return [(m(0, 1) + m(1, 0)) / k, k / 4, (m(1, 2) + m(2, 1)) / k, (m(0, 2) - m(2, 0)) / k]; }
  const k = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m(0, 2) + m(2, 0)) / k, (m(1, 2) + m(2, 1)) / k, k / 4, (m(1, 0) - m(0, 1)) / k];
}

/** A piece's frame for the rig as it stands: world = origin + quat * (rest world - `pieceOrigin`). `points`: the
 *  live rig points; `segmentOrigin`: the segment's own live origin (an `aim` frame turns about it). */
export function kitFramePose(
  frame: KitFrame, pieceOrigin: Vec3, points: readonly { pos: readonly number[] }[], segmentOrigin: readonly number[], yaw: number,
): SegmentPose {
  if (frame.kind === 'aim') {
    const dir = unit3(sub3(points[frame.tail]!.pos, points[frame.head]!.pos));
    return { origin: [segmentOrigin[0]!, segmentOrigin[1]!, segmentOrigin[2]!], quat: segmentQuat(frame.restDir, dir, yaw) };
  }
  const a = points[frame.lat[0]]!.pos, b = points[frame.lat[1]]!.pos;
  const quat = basisQuat(spanBasis(frame.restLat, frame.restUp), spanBasis(sub3(a, b), sub3(points[frame.up[1]]!.pos, points[frame.up[0]]!.pos)));
  const hold = rotate(quat, sub3(frame.restHold, pieceOrigin));
  return { origin: [(a[0]! + b[0]!) / 2 - hold[0], (a[1]! + b[1]!) / 2 - hold[1], (a[2]! + b[2]!) / 2 - hold[2]], quat };
}

/** A body's sources as the kit draws them: a source whose piece rides its own frame (KitFrame) is given that frame
 *  (pose, toLocal and toWorld; everything else is the source's own), and every other source is returned as it is.
 *  `points` and `yaw`: the body's live rig points and yaw, as the sources themselves were given them. */
export function kitSources(
  sources: readonly BoneFieldSource[], kit: SkeletonKit | null, points: () => readonly { pos: readonly number[] }[], yaw: () => number,
): BoneFieldSource[] {
  if (!kit || !kit.admit(sources)) return [...sources];
  const out = sources.map((s): BoneFieldSource => {
    const piece = kit.pieceOf(s);
    const frame = piece?.frame;
    if (!piece || !frame) return s;
    const pose = (): SegmentPose => kitFramePose(frame, piece.origin, points(), s.pose().origin, yaw());
    return {
      ...s,
      pose,
      toWorld(p): Vec3 { const f = pose(); const r = rotate(f.quat, [p[0], p[1], p[2]]); return [f.origin[0] + r[0], f.origin[1] + r[1], f.origin[2] + r[2]]; },
      toLocal(p): Vec3 { const f = pose(); return rotate([-f.quat[0], -f.quat[1], -f.quat[2], f.quat[3]], [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]]); },
    };
  });
  kit.admit(out);   // the framed copies are the sources the renderer and the cache are handed
  return out;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Reads a kit GLB: every mesh node that carries the `segment`, `revision` and `origin` extras build_kit.py writes.
 *  Throws on a file that is not a GLB with one binary chunk. */
export function parseSkeletonKit(glb: ArrayBuffer | Uint8Array): SkeletonKitPiece[] {
  const bytes = glb instanceof Uint8Array ? glb : new Uint8Array(glb);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('skeleton kit: not a GLB');
  const jsonLength = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
    nodes?: { name?: string; mesh?: number; extras?: Record<string, unknown> }[];
    meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
    accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
  };
  const binStart = 20 + jsonLength + 8;
  const read = (index: number): number[] => {
    const a = gltf.accessors[index]!, bv = gltf.bufferViews[a.bufferView]!;
    const dims = COMPONENTS[a.type]!;
    const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    const stride = bv.byteStride ?? size * dims;
    const out: number[] = new Array(a.count * dims);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < dims; c++) {
      const at = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * stride + c * size;
      out[i * dims + c] = a.componentType === 5126 ? view.getFloat32(at, true) : a.componentType === 5125 ? view.getUint32(at, true)
        : a.componentType === 5123 ? view.getUint16(at, true) : view.getUint8(at);
    }
    return out;
  };
  const pieces: SkeletonKitPiece[] = [];
  for (const node of gltf.nodes ?? []) {
    const x = node.extras;
    if (node.mesh === undefined || !x || typeof x.segment !== 'string' || typeof x.revision !== 'string' || !Array.isArray(x.origin)) continue;
    const prim = gltf.meshes[node.mesh]!.primitives[0]!;
    if (prim.attributes.POSITION === undefined || prim.attributes.NORMAL === undefined || prim.indices === undefined) continue;
    const frame = typeof x.frame === 'string' ? JSON.parse(x.frame) as KitFrame : undefined;
    pieces.push({
      ...(frame ? { frame } : {}),
      segment: x.segment, revision: x.revision, origin: [Number(x.origin[0]), Number(x.origin[1]), Number(x.origin[2])],
      positions: new Float32Array(read(prim.attributes.POSITION)), normals: new Float32Array(read(prim.attributes.NORMAL)),
      index: new Uint32Array(read(prim.indices)),
    });
  }
  return pieces;
}

/** The kit, loaded: its pieces by segment revision, and the meshes built from them (one a piece, on the first ask). */
export class SkeletonKit {
  readonly #byRevision = new Map<string, SkeletonKitPiece>();
  readonly #meshes = new Map<string, SegmentMesh>();
  /** How long the asset took to load, ms (the loader's; 0 for a kit built from bytes). */
  loadMs = 0;

  constructor(readonly pieces: readonly SkeletonKitPiece[]) {
    for (const p of pieces) this.#byRevision.set(p.revision, p);
  }

  readonly #admitted = new WeakSet<BoneFieldSource>();

  /** A BODY DRAWS THE KIT WHOLE OR NOT AT ALL. `sources`: one body's. The body is admitted when at least half its
   *  bone segments (the head aside) have a piece: the zombie (all of them), and a zombie that has lost a limb. A
   *  body that shares a segment or two with the zombie (the butcher's pelvis bones are the zombie's) is not: a kit
   *  pelvis on extracted femurs is two skeletons in one body. Only an admitted body's sources have pieces
   *  (pieceOf). Returns whether it was admitted. */
  admit(sources: readonly BoneFieldSource[]): boolean {
    const bones = sources.filter(s => s.kind === 'bone' && s.segment !== 'head');
    const matched = bones.filter(s => this.#byRevision.has(kitRevisionOf(s))).length;
    if (matched === 0 || matched * 2 < bones.length) return false;
    for (const s of sources) this.#admitted.add(s);
    return true;
  }

  /** The piece built for `source`'s segment as it now is; null: this source draws its surface nets (its body was
   *  not admitted, or the kit has no piece of this revision). */
  pieceOf(source: BoneFieldSource): SkeletonKitPiece | null {
    if (source.kind !== 'bone' || !this.#admitted.has(source)) return null;
    return this.#byRevision.get(kitRevisionOf(source)) ?? null;
  }

  /** The piece of `source` as a segment mesh, segment-local; null where pieceOf is. One geometry a piece, shared by
   *  every body that draws it. */
  segment(source: BoneFieldSource): SegmentMesh | null {
    const piece = this.pieceOf(source);
    if (!piece) return null;
    let mesh = this.#meshes.get(piece.revision);
    if (!mesh) {
      const t0 = performance.now();
      const local = new Float32Array(piece.positions.length);
      for (let i = 0; i < local.length; i += 3) {
        local[i] = piece.positions[i]! - piece.origin[0];
        local[i + 1] = piece.positions[i + 1]! - piece.origin[1];
        local[i + 2] = piece.positions[i + 2]! - piece.origin[2];
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(local, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(piece.normals.slice(), 3));
      geometry.setIndex(new THREE.BufferAttribute(piece.index.slice(), 1));
      geometry.userData.skeletonKit = piece.segment;
      mesh = {
        key: `kit:${piece.revision}`, geometry, mesher: 'asset', verts: local.length / 3, tris: piece.index.length / 3,
        bakeMs: performance.now() - t0, overflow: false, droppedQuads: 0, clamped: false,
      };
      this.#meshes.set(piece.revision, mesh);
    }
    return mesh;
  }

  /** Meshes built so far. */
  get size(): number { return this.#meshes.size; }
  /** Vertices and triangles of the meshes built so far. */
  get totals(): { verts: number; tris: number } {
    let verts = 0, tris = 0;
    for (const m of this.#meshes.values()) { verts += m.verts; tris += m.tris; }
    return { verts, tris };
  }
  dispose(): void {
    for (const m of this.#meshes.values()) m.geometry.dispose();
    this.#meshes.clear();
  }
}

/** Fetches and parses the kit. */
export async function loadSkeletonKit(url: string = SKELETON_KIT_URL): Promise<SkeletonKit> {
  const began = performance.now();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const kit = new SkeletonKit(parseSkeletonKit(await response.arrayBuffer()));
  kit.loadMs = performance.now() - began;
  return kit;
}

/** WHERE THE KIT'S BONES MEET. Each joint is a point of the zombie's rest pose (world, metres) where a bone of one
 *  segment sits on or in a bone of another: the ball in its socket, the end of a bone on the next. The pieces are
 *  built so both bones cover the point at rest (skeleton-kit.test.ts), and a pose keeps them together as far as the
 *  two segments' frames carry the point to the same place: kitJointGaps measures how far apart they carry it.
 *  Left side only; the right is the mirror. */
export const KIT_JOINTS: readonly { name: string; a: string; b: string; at: Vec3; slides?: true }[] = [
  { name: 'skull on atlas', a: 'head', b: 'axial:2-3', at: [0, 1.545, 0.078] },
  { name: 'neck on chest (C7/T1)', a: 'axial:2-3', b: 'axial:1-2', at: [0, 1.4, 0.018] },
  // The one joint that is MEANT to move: the sacrum (the cage's piece) slides between the hip bones.
  { name: 'sacrum between the hip bones', a: 'axial:1-2', b: 'axial:0-1', at: [0.03, 1.03, -0.058], slides: true },
  { name: 'clavicle on sternum', a: 'limb:armL:5-5', b: 'axial:1-2', at: [0.02, 1.378, 0.088] },
  { name: 'shoulder (humeral head in socket)', a: 'limb:armL:5-7', b: 'limb:armL:5-5', at: [0.2, 1.3976, 0.0405] },
  { name: 'elbow', a: 'limb:armL:7-9', b: 'limb:armL:5-7', at: [0.2862, 1.1102, 0.0405] },
  { name: 'wrist', a: 'limb:armL:9-9', b: 'limb:armL:7-9', at: [0.3, 0.84, 0.068] },
  { name: 'hip (femoral head in socket)', a: 'limb:legL:11-12', b: 'axial:0-1', at: [0.1, 1.06, 0] },
  { name: 'knee', a: 'limb:legL:12-15', b: 'limb:legL:11-12', at: [0.1, 0.6, 0] },
  { name: 'ankle (shin on talus)', a: 'limb:legL:15-15', b: 'limb:legL:12-15', at: [0.1, 0.1006, 0.025] },
  { name: 'foot on talus', a: 'limb:legL:15-17', b: 'limb:legL:15-15', at: [0.1, 0.0556, 0.025] },
];

/** A segment's frame, as contract.ts SegmentPose, with the rest origin its kit piece carries. */
export interface KitSegmentFrame { restOrigin: Vec3; origin: readonly number[]; quat: readonly number[] }

function rotate(q: readonly number[], v: Vec3): Vec3 {
  const [x, y, z, w] = q as [number, number, number, number];
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** How far apart a pose carries each joint of KIT_JOINTS: the distance, metres, between the joint's rest point as
 *  segment `a` moves it and as segment `b` moves it. 0 at rest. `frames`: each segment's live frame by key; a joint
 *  with a segment missing is left out. `rightKey`: measure the right side (it names the right segment of a
 *  left key; the point's x is negated). */
export function kitJointGaps(
  frames: (segment: string) => KitSegmentFrame | null, rightKey?: (leftKey: string) => string,
): { name: string; gap: number; slides: boolean }[] {
  const out: { name: string; gap: number; slides: boolean }[] = [];
  for (const j of KIT_JOINTS) {
    const fa = frames(rightKey ? rightKey(j.a) : j.a), fb = frames(rightKey ? rightKey(j.b) : j.b);
    if (!fa || !fb) continue;
    const at: Vec3 = rightKey ? [-j.at[0], j.at[1], j.at[2]] : j.at;
    const carry = (f: KitSegmentFrame): Vec3 => {
      const r = rotate(f.quat, [at[0] - f.restOrigin[0], at[1] - f.restOrigin[1], at[2] - f.restOrigin[2]]);
      return [f.origin[0]! + r[0], f.origin[1]! + r[1], f.origin[2]! + r[2]];
    };
    const pa = carry(fa), pb = carry(fb);
    out.push({ name: j.name, slides: j.slides === true, gap: Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) });
  }
  return out;
}
