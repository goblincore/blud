// src/lab/sdf-zombie/webgpu/kit-burst-mesh.ts
//
// THE KIT COMES APART (kit-burst.ts's header has why): every group of vertices is re-weighted to one bone, and from then
// on moving that bone moves the group rigidly. Same SkinnedMeshes, same materials, same attribute set: the skinned draw
// the kit already had, so the gib frame builds nothing and draws no more than the kit did alive.
//
// Skinning, world = W * bindInverse * B * boneInverse * bind * v (B = bone.matrixWorld, W = mesh.matrixWorld). A group's
// start transform D (bind space -> world) is that chain through the bone that weighted it. Its slot may be another
// bone with another boneInverse, so B is solved from the piece's own motion each step.
import * as THREE from 'three/webgpu';
import { assignBurstSlots, kitPieceHalfHeight, makeKitPiece, stepKitPiece, type KitPiece } from '../kit-burst';
import type { DebrisGround, DebrisSeat } from '../debris-ground';
import type { Vec3 } from '../types';
import type { Quat } from '../vec';

/** A connected island (kit-damage.ts piecesOf). */
export interface KitIsland { source: THREE.SkinnedMesh; indices: readonly number[]; joint: number; radius: number }

export interface KitBurstOpts {
  meshes: readonly THREE.SkinnedMesh[];
  /** The kit's islands, or null to come apart by bone (kit-burst.ts islandIndexLimit). */
  islands: readonly KitIsland[] | null;
  /** The kit's split by bone when `islands` is null (prepareKitBurst). */
  byBone?: KitBurstByBone | null;
  /** The launch for the piece with this stable key, centred here, in m/s (the gib launch). */
  launch(key: string, centre: Vec3): Vec3;
  /** Three stable [0, 1) rolls for this key (the piece's spin). */
  rolls(key: string): readonly [number, number, number];
  seat?: DebrisSeat | null;
}

export interface KitBurstPieceReport { pos: Vec3; launch: Vec3; minY: number; floorY: number; resting: boolean }

export interface KitBurst {
  /** Advance every moving piece and its bone. True while anything still moves. */
  step(dt: number, ground: DebrisGround): boolean;
  report(): KitBurstPieceReport[];
}

interface Part { mesh: THREE.SkinnedMesh; verts: Iterable<number> }
/** `box`: bind-space bounds worked out already (by bone); else they come from the parts' verts. */
interface Group { joint: number; radius: number; parts: Part[]; rewrite: boolean; box?: THREE.Box3 }

const _v = new THREE.Vector3();

/** A kit's split by bone, worked out at load (prepareKitBurst). */
export interface KitBurstByBone { groups: Group[]; tears: { mesh: THREE.SkinnedMesh; jointOf: Int16Array }[] }

/** BY BONE, for the big sculpted kits: one pass over up to 120k vertices, so at LOAD beside kit-bounds.ts's own pass and
 *  not on the gib frame (teratoma: 16 ms there). Vertices already on one bone need no rewrite, which is every sculpted kit today. A smoothly weighted mesh
 *  (a remade kit may be) is torn where its bones meet: each vertex goes to its heaviest bone and a triangle across two
 *  bones is dropped, since it would stretch. */
export function prepareKitBurst(meshes: readonly THREE.SkinnedMesh[]): KitBurstByBone {
  const byJoint = new Map<number, Group>();
  const tears: KitBurstByBone['tears'] = [];
  for (const mesh of meshes) {
    if (!mesh.visible) continue;
    const g = mesh.geometry, pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
    const index = g.index?.array ?? null, n = index ? index.length : pos.count;
    const jointOf = new Int16Array(pos.count).fill(-1);
    let smooth = false;
    for (let i = 0; i < n; i++) {
      const v = index ? index[i]! : i;
      if (jointOf[v] !== -1) continue;
      let joint = si.getComponent(v, 0), best = sw.getComponent(v, 0), sum = best;
      for (let c = 1; c < 4; c++) {
        const w = sw.getComponent(v, c);
        if (w === 0) continue;
        sum += w;
        if (w > best) { best = w; joint = si.getComponent(v, c); }
      }
      if (best < sum * 0.999) smooth = true;
      jointOf[v] = joint;
      let group = byJoint.get(joint);
      if (!group) byJoint.set(joint, group = { joint, radius: 0, parts: [], rewrite: false, box: new THREE.Box3() });
      group.box!.expandByPoint(_v.fromBufferAttribute(pos, v).applyMatrix4(mesh.bindMatrix));
    }
    if (smooth) {
      tears.push({ mesh, jointOf });
      const lists = new Map<number, number[]>();
      jointOf.forEach((j, v) => { if (j !== -1) { let l = lists.get(j); if (!l) lists.set(j, l = []); l.push(v); } });
      for (const [j, verts] of lists) { const group = byJoint.get(j)!; group.parts.push({ mesh, verts }); group.rewrite = true; }
    }
  }
  return { groups: [...byJoint.values()], tears };
}

/** A smoothly weighted mesh loses its triangles across two bones. */
function applyTears(tears: KitBurstByBone['tears']): void {
  for (const { mesh, jointOf } of tears) {
    const index = mesh.geometry.index?.array;
    if (!index) continue;
    const kept: number[] = [];
    for (let i = 0; i < index.length; i += 3) {
      const j = jointOf[index[i]!];
      if (j === jointOf[index[i + 1]!] && j === jointOf[index[i + 2]!]) kept.push(index[i]!, index[i + 1]!, index[i + 2]!);
    }
    mesh.geometry.setIndex(kept);
  }
}

const _m = new THREE.Matrix4(), _pos = new THREE.Vector3(), _q = new THREE.Quaternion(), _scl = new THREE.Vector3();

export function createKitBurst(opts: KitBurstOpts): KitBurst {
  const groups: Group[] = opts.islands
    ? opts.islands.map(s => ({ joint: s.joint, radius: s.radius, parts: [{ mesh: s.source, verts: new Set(s.indices) }], rewrite: true }))
    : (opts.byBone ?? prepareKitBurst(opts.meshes)).groups;
  if (!opts.islands) applyTears((opts.byBone ?? { tears: [] }).tears);
  const first = opts.meshes[0];
  const bodies: { slot: number; piece: KitPiece; post: THREE.Matrix4; scale: number }[] = [];
  if (!first || groups.length === 0) return { step: () => false, report: () => [] };
  const skeleton = first.skeleton, bones = skeleton.bones, inverses = skeleton.boneInverses;
  const slots = assignBurstSlots(groups, bones.length);

  // Bind-space bounds per slot (groups sharing a slot share a joint: assignBurstSlots), re-weighting as it goes.
  const boxes = new Map<number, { joint: number; box: THREE.Box3 }>();
  const touched = new Set<THREE.BufferAttribute>();
  const p = new THREE.Vector3();
  groups.forEach((group, i) => {
    const slot = slots[i]!;
    let entry = boxes.get(slot);
    if (!entry) boxes.set(slot, entry = { joint: group.joint, box: new THREE.Box3() });
    if (group.box) entry.box.union(group.box);
    for (const part of group.parts) {
      const g = part.mesh.geometry, pos = g.getAttribute('position');
      const si = g.getAttribute('skinIndex') as THREE.BufferAttribute, sw = g.getAttribute('skinWeight') as THREE.BufferAttribute;
      const b = part.mesh.bindMatrix;
      for (const v of part.verts) {
        if (!group.box) entry.box.expandByPoint(p.fromBufferAttribute(pos, v).applyMatrix4(b));
        if (group.rewrite) { si.setXYZW(v, slot, 0, 0, 0); sw.setXYZW(v, 1, 0, 0, 0); }
      }
      if (group.rewrite) { touched.add(si); touched.add(sw); }
    }
  });
  for (const a of touched) a.needsUpdate = true;

  // W * bindInverse is the identity for every kit today (it sits at the origin), and is kept for exactness. The bind
  // matrix and W are the skeleton's single skin's, so every mesh of the kit shares them.
  first.updateWorldMatrix(true, false);
  const outer = new THREE.Matrix4().multiplyMatrices(first.matrixWorld, first.bindMatrixInverse);
  const outerInv = outer.clone().invert();
  const bindInv = first.bindMatrix.clone().invert();
  const centre = new THREE.Vector3(), size = new THREE.Vector3();
  for (const [slot, { joint, box }] of boxes) {
    if (box.isEmpty()) continue;
    const D = new THREE.Matrix4().multiplyMatrices(outer, bones[joint]!.matrixWorld)
      .multiply(inverses[joint]!).multiply(first.bindMatrix);
    D.decompose(_pos, _q, _scl);
    const s = _scl.x;
    box.getCenter(centre);
    box.getSize(size).multiplyScalar(0.5 * s);
    const key = `kit:${slot}`;
    const world = centre.clone().applyMatrix4(D).toArray() as Vec3;
    const half = size.toArray() as Vec3;
    const at = opts.seat?.(world, Math.hypot(half[0], half[1], half[2])) ?? null;
    const piece = makeKitPiece(at ? at.pos : world, _q.toArray() as unknown as Quat, half, opts.launch(key, world),
      opts.rolls(key), at?.floorY ?? 0);
    // Bone.matrixWorld = outerInv * [T(pos) R(quat) S(s)] * post, with post = T(-centre) bindInv boneInverse(slot)^-1.
    const post = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z)
      .multiply(bindInv).multiply(inverses[slot]!.clone().invert());
    bodies.push({ slot, piece, post, scale: s });
  }

  const write = (b: typeof bodies[number]) => {
    const { piece } = b;
    _pos.set(piece.pos[0], piece.pos[1], piece.pos[2]);
    _q.set(piece.quat[0], piece.quat[1], piece.quat[2], piece.quat[3]);
    _scl.setScalar(b.scale);
    _m.compose(_pos, _q, _scl).multiply(b.post);
    bones[b.slot]!.matrixWorld.multiplyMatrices(outerInv, _m);
  };
  /** One culling sphere over every piece, on every mesh: pieces are few, and a kit's meshes scatter together. */
  const sphere = new THREE.Sphere();
  const box = new THREE.Box3(), reach = new THREE.Vector3();
  const updateBounds = () => {
    box.makeEmpty();
    let r = 0;
    for (const b of bodies) { box.expandByPoint(reach.set(b.piece.pos[0], b.piece.pos[1], b.piece.pos[2])); r = Math.max(r, b.piece.radius); }
    box.getBoundingSphere(sphere);
    sphere.radius += r;
    for (const mesh of opts.meshes) {
      (mesh.boundingSphere ??= new THREE.Sphere()).copy(sphere).applyMatrix4(mesh.bindMatrixInverse);
    }
  };
  for (const b of bodies) write(b);
  updateBounds();

  return {
    step(dt, ground) {
      let moving = false;
      for (const b of bodies) {
        if (b.piece.resting) continue;
        stepKitPiece(b.piece, dt, ground);
        write(b);
        moving ||= !b.piece.resting;
      }
      updateBounds();
      return moving;
    },
    report() {
      return bodies.map(({ piece: q }) => ({
        pos: [q.pos[0], q.pos[1], q.pos[2]] as Vec3, launch: [q.launch[0], q.launch[1], q.launch[2]] as Vec3,
        minY: q.pos[1] - kitPieceHalfHeight(q.quat, q.half), floorY: q.floorY, resting: q.resting,
      }));
    },
  };
}
