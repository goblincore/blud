// src/lab/sdf-zombie/webgpu/kit-sever.ts
//
// KIT THAT LEAVES WITH ITS FLESH (owner, 2026-10-26, the zombie's grabber hands: "when you shoot the arm off, the hand
// does not follow, so you have a floating arm").
//
// WHY. A kit part rides ONE bone rigidly (scripts/blender-kit.ts), and a sever does not take the bone away: rebind keeps
// every rig point and the kit is posed from all of them (rig-frames.ts boneFrames), so after a forearm is shot through,
// its hand and wrist shackle went on hanging at the stump. Only kits marked `armoured` shed anything (kit-damage.ts),
// and they shed into their own falling debris, not the severed piece.
//
// WHAT. When a severed piece takes flesh off bone B, the triangles of the actor's kit that ride B are cut out of THAT
// actor's kit (its geometry is a clone the first time: kit geometry is shared by every actor wearing the kit,
// kit-overlay.ts loadKitSource) and become a plain mesh, in world space at the moment of the cut, that RIDES the
// piece's flying chunk (a KitRider: posed from the chunk each frame, the chunk's own T(pos) S(squash) R(quat), exactly
// as game-mesh-gibs.ts poses a mesh gib, and gone when the chunk goes). The rider keeps the kit's materials (the
// flesh parts keep the flesh shader's look, kit-flesh.ts).
import * as THREE from 'three/webgpu';
import { squashFactors, type Chunk } from '../gib-chunks';
import { kitBoneKey } from '../rig-frames';
import { isSharedKitResource } from './kit-overlay';
import type { Primitive, Vec3 } from '../types';

/** A cut-off kit part riding a flying chunk (ctx.gibs.kitRiders). Its geometry is world space less `origin`. */
export interface KitRider {
  object: THREE.Object3D;
  /** The chunk it rides (LiveChunk / BakedChunk `id`). */
  chunkId: number;
}

/** Which triangles (by their first index position) ride joint `joint` with all three vertices. Pure, for the test. */
export function trianglesOnJoint(index: ArrayLike<number>, skinIndex: ArrayLike<number>, joint: number): { take: number[]; keep: number[] } {
  const take: number[] = [], keep: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const on = [0, 1, 2].every(k => skinIndex[index[t + k]! * 4] === joint);
    (on ? take : keep).push(t);
  }
  return { take, keep };
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Cut every triangle of `kitRoot` that rides `bone` (only the meshes whose material is in `materials`, when given) out
 * of this actor's kit, and return them as plain meshes in a group, their vertices in WORLD space less `origin` (the
 * chunk's local frame at spawn: gib-chunks makeChunk starts at `origin` with an identity quat). Null when no triangle
 * rides `bone`.
 */
export function cutKitBone(kitRoot: THREE.Object3D, bone: string, origin: Vec3, materials?: ReadonlySet<string>): THREE.Group | null {
  const group = new THREE.Group();
  kitRoot.updateMatrixWorld(true);
  const key = kitBoneKey(bone);
  kitRoot.traverse(o => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || Array.isArray(mesh.material)) return;
    // The kit's material name: a flesh part's is on userData (kit-flesh.ts swaps in one shared, unnamed lit material).
    const matName: string = mesh.userData['kitMaterial'] ?? mesh.material.name;
    if (materials && !materials.has(matName)) return;
    const joint = mesh.skeleton.bones.findIndex(b => b.name === key);
    if (joint < 0) return;
    let g = mesh.geometry;
    const index = g.index, si = g.getAttribute('skinIndex');
    if (!index || !si) return;
    const { take, keep } = trianglesOnJoint(index.array, si.array, joint);
    if (take.length === 0) return;
    // The bone's rigid transform now (poseKitBones wrote its matrixWorld; inverse binds are pure translations).
    const boneObj = mesh.skeleton.bones[joint]!;
    const toWorld = new THREE.Matrix4().multiplyMatrices(boneObj.matrixWorld, mesh.skeleton.boneInverses[joint]!)
      .premultiply(new THREE.Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]));
    toWorld.decompose(_p, _q, _s);
    // The rider's geometry: the taken triangles' vertices, every attribute but the skin weights, positions placed.
    const remap = new Map<number, number>();
    const order: number[] = [];
    for (const t of take) for (let k = 0; k < 3; k++) {
      const v = index.getX(t + k);
      if (!remap.has(v)) { remap.set(v, order.length); order.push(v); }
    }
    const out = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      if (name === 'skinIndex' || name === 'skinWeight') continue;
      const a = attr as THREE.BufferAttribute, n = a.itemSize;
      const arr = new Float32Array(order.length * n);
      order.forEach((v, i) => { for (let c = 0; c < n; c++) arr[i * n + c] = a.getComponent(v, c); });
      if (name === 'position') for (let i = 0; i < order.length; i++) {
        _v.fromArray(arr, i * 3).applyMatrix4(toWorld).toArray(arr, i * 3);
      } else if (name === 'normal') for (let i = 0; i < order.length; i++) {
        _v.fromArray(arr, i * 3).applyQuaternion(_q).toArray(arr, i * 3);
      } else if (name === 'tangent') for (let i = 0; i < order.length; i++) {
        _v.set(arr[i * 4]!, arr[i * 4 + 1]!, arr[i * 4 + 2]!).applyQuaternion(_q);
        arr[i * 4] = _v.x; arr[i * 4 + 1] = _v.y; arr[i * 4 + 2] = _v.z;
      }
      out.setAttribute(name, new THREE.BufferAttribute(arr, n, a.normalized));
    }
    const idx: number[] = [];
    for (const t of take) for (let k = 0; k < 3; k++) idx.push(remap.get(index.getX(t + k))!);
    out.setIndex(idx);
    out.computeBoundingSphere();
    const rider = new THREE.Mesh(out, mesh.material);
    rider.name = `${bone}|${matName}`;
    group.add(rider);
    // Hide them on THIS actor: its own copy of the geometry the first time (the source is shared by every actor).
    if (isSharedKitResource(g)) { g = g.clone(); mesh.geometry = g; }
    const kept: number[] = [];
    for (const t of keep) for (let k = 0; k < 3; k++) kept.push(index.getX(t + k));
    g.setIndex(kept);
  });
  if (group.children.length === 0) return null;
  group.matrixAutoUpdate = false;
  return group;
}

const _m = new THREE.Matrix4();
const _sm = new THREE.Matrix4();
const _cq = new THREE.Quaternion();
/** Pose a rider from its chunk: T(pos) S(squash, world axes) R(quat), game-mesh-gibs.ts's pose. */
export function poseKitRider(r: KitRider, c: Chunk): void {
  _cq.set(c.quat[0], c.quat[1], c.quat[2], c.quat[3]);
  _m.makeRotationFromQuaternion(_cq);
  const { sx, sy, sz } = squashFactors(c);
  _m.premultiply(_sm.makeScale(sx, sy, sz));
  _m.setPosition(c.pos[0], c.pos[1], c.pos[2]);
  r.object.matrix.copy(_m);
  r.object.matrixWorldNeedsUpdate = true;
}

/** Free a rider's own geometry (its materials are the kit's, shared). */
export function disposeKitRider(r: KitRider): void {
  r.object.removeFromParent();
  r.object.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
}

/** What a severed piece takes of the kit, per bone: every kit part riding a bone the piece took a LIMB SEGMENT of
 *  (a bar: the hand AND the shackle go with a forearm), or only `handMaterials` when it took no more than the bone's
 *  end knob (a wrist cut: the hand goes, the empty shackle stays on the stump). */
export function kitTakenBy(prims: readonly Primitive[], handMaterials: ReadonlySet<string> | null): { bone: string; materials?: ReadonlySet<string> }[] {
  const byBone = new Map<string, boolean>();   // bone -> took a segment (not only a knob)
  for (const p of prims) {
    if (!p.bone) continue;
    const seg = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) > 0.05;
    byBone.set(p.bone, (byBone.get(p.bone) ?? false) || seg);
  }
  return [...byBone].map(([bone, seg]) => seg || !handMaterials ? { bone } : { bone, materials: handMaterials });
}

// ---------------------------------------------------------------- shootable pieces
// SHOT OFF (owner, 2026-10-26: "the belt doesn't react to shots; if it gets hit it should just break or fly off, same
// with the wrist shackles"). A round's segment is tested against a kit piece's own triangles in its bone's REST frame
// (the segment goes through the inverse of the bone's rigid transform, so no vertex is ever skinned on the CPU), and
// the nearest hit takes the piece off as a mesh gib (game-kit-riders.ts kitPieceShot).

/** The triangles (index positions) on one joint, and their rest-space bounding sphere: per INDEX attribute, so a cut
 *  (which writes a new index) is seen at once. */
const PIECE_TRIS = new WeakMap<object, Map<number, { tris: Int32Array; c: THREE.Vector3; r: number }>>();
function pieceTris(g: THREE.BufferGeometry, joint: number) {
  const index = g.index!, si = g.getAttribute('skinIndex'), pos = g.getAttribute('position');
  let byJoint = PIECE_TRIS.get(index);
  if (!byJoint) { byJoint = new Map(); PIECE_TRIS.set(index, byJoint); }
  let e = byJoint.get(joint);
  if (!e) {
    const { take } = trianglesOnJoint(index.array, si.array, joint);
    const box = new THREE.Box3();
    for (const t of take) for (let k = 0; k < 3; k++) box.expandByPoint(_v.fromBufferAttribute(pos, index.getX(t + k)));
    const c = box.getCenter(new THREE.Vector3());
    let r = 0;
    for (const t of take) for (let k = 0; k < 3; k++) r = Math.max(r, _v.fromBufferAttribute(pos, index.getX(t + k)).distanceTo(c));
    e = { tris: Int32Array.from(take), c, r };
    byJoint.set(joint, e);
  }
  return e;
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _pv = new THREE.Vector3(), _tv = new THREE.Vector3(), _qv = new THREE.Vector3();
const _inv = new THREE.Matrix4();

/** Where the segment `from`->`to` first meets a triangle of `kitRoot` riding `bone` (only these materials), as a
 *  fraction 0..1 of the segment; null for a miss. */
export function kitPieceHit(kitRoot: THREE.Object3D, bone: string, materials: ReadonlySet<string>, from: Vec3, to: Vec3): number | null {
  const key = kitBoneKey(bone);
  let best: number | null = null;
  kitRoot.traverse(o => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || Array.isArray(mesh.material) || !mesh.visible) return;
    if (!materials.has(mesh.userData['kitMaterial'] ?? mesh.material.name)) return;
    const joint = mesh.skeleton.bones.findIndex(b => b.name === key);
    const g = mesh.geometry;
    if (joint < 0 || !g.index || !g.getAttribute('skinIndex')) return;
    const piece = pieceTris(g, joint);
    if (piece.tris.length === 0) return;
    // the segment into the bone's rest frame (rest -> world is boneWorld * boneInverse, rigid)
    _inv.multiplyMatrices(mesh.skeleton.bones[joint]!.matrixWorld, mesh.skeleton.boneInverses[joint]!).invert();
    _o.set(from[0], from[1], from[2]).applyMatrix4(_inv);
    _d.set(to[0], to[1], to[2]).applyMatrix4(_inv).sub(_o);
    // the sphere first
    _tv.subVectors(piece.c, _o);
    const L2 = _d.lengthSq(), along = Math.max(0, Math.min(1, _tv.dot(_d) / (L2 || 1)));
    if (_qv.copy(_o).addScaledVector(_d, along).distanceTo(piece.c) > piece.r) return;
    const pos = g.getAttribute('position'), index = g.index;
    for (const t of piece.tris) {
      _a.fromBufferAttribute(pos, index.getX(t)); _b.fromBufferAttribute(pos, index.getX(t + 1)); _c.fromBufferAttribute(pos, index.getX(t + 2));
      _e1.subVectors(_b, _a); _e2.subVectors(_c, _a); _pv.crossVectors(_d, _e2);
      const det = _e1.dot(_pv);
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      _tv.subVectors(_o, _a);
      const u = _tv.dot(_pv) * inv;
      if (u < 0 || u > 1) continue;
      _qv.crossVectors(_tv, _e1);
      const v = _d.dot(_qv) * inv;
      if (v < 0 || u + v > 1) continue;
      const s = _e2.dot(_qv) * inv;
      if (s >= 0 && s <= 1 && (best === null || s < best)) best = s;
    }
  });
  return best;
}
