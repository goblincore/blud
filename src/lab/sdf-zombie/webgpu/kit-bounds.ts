// src/lab/sdf-zombie/webgpu/kit-bounds.ts
//
// A cheap, conservative bounding sphere for a skinned kit mesh — the "bone
// sphere" — so frustum culling stays valid without skinning every vertex on
// the CPU each frame.
//
// WHY: kit-overlay drives bones with ABSOLUTE world matrices and leaves the
// mesh transform stationary, so three's cached skinned sphere stayed behind as
// a character walked away and camera turns culled the whole kit. The first fix
// called SkinnedMesh.computeBoundingSphere() every frame, which runs
// applyBoneTransform on every vertex (4,916 for the bride) — ~75 ms/frame under
// load (docs/dev-notes/2026-09-24-bride-perf/COST.md, "Timing check").
//
// THE BOUND. Three skins a vertex v (mesh-local) as
//   u = bindMatrix·v,  w = Σ_k weight_k · B_k·boneInverse_k·u,  local = bindMatrixInverse·w
// with B_k = bone.matrixWorld. Let d_k = boneInverse_k·u, the vertex in bone
// k's BIND-local frame. If B_k is RIGID (rotation + translation, unit scale —
// kit-overlay composes frames with scale 1 and chains translation-only
// bind-local matrices), then |B_k·d_k − t_k| = |d_k|, t_k being bone k's posed
// origin (B_k's translation). So each bone's image of the vertex lies within
// pad = max |d_k| (over all vertices and every bone weighting them) of t_k.
// Weights sum to 1, so w is a convex combination of those images and lies
// within pad of the convex hull of the posed origins — which lies inside any
// sphere enclosing them. Hence sphere(origins) grown by pad contains every
// skinned vertex. The sphere is built in world (w) space, then carried into
// mesh-local space with bindMatrixInverse — exactly the space three's own
// computeBoundingSphere produces and Frustum.intersectsObject expects (it
// applies mesh.matrixWorld). Sphere.applyMatrix4 scales the radius by the
// matrix's max axis scale, so that last step stays conservative too.
//
// Kit damage hides pieces by rewriting the index; a sphere over the whole
// mesh is still a valid (just looser) bound for what remains.
import { Sphere, Vector3, type SkinnedMesh } from 'three/webgpu';

export interface KitBoundsPre {
  /** Skeleton bone indices that carry non-zero weight on some vertex. */
  boneIdx: number[];
  /** Max distance from any vertex to the bind origin of a bone weighting it. */
  pad: number;
}

/** Once per skinned mesh, at load (bind pose; reads geometry + boneInverses only). */
export function precomputeKitBounds(mesh: SkinnedMesh): KitBoundsPre {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const inv = mesh.skeleton.boneInverses;
  const used = new Set<number>();
  const u = new Vector3(), d = new Vector3();
  let pad2 = 0;
  for (let i = 0; i < pos.count; i++) {
    u.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
    for (let c = 0; c < 4; c++) {
      if (sw.getComponent(i, c) === 0) continue;
      const b = si.getComponent(i, c);
      used.add(b);
      pad2 = Math.max(pad2, d.copy(u).applyMatrix4(inv[b]!).lengthSq());
    }
  }
  return { boneIdx: [...used].sort((a, b) => a - b), pad: Math.sqrt(pad2) };
}

const _t = new Vector3(), _min = new Vector3(), _max = new Vector3();

/** Each frame, after the bones' matrixWorld are posed. O(bones used). */
export function updateKitBounds(mesh: SkinnedMesh, pre: KitBoundsPre): void {
  const sphere = mesh.boundingSphere ?? (mesh.boundingSphere = new Sphere());
  const bones = mesh.skeleton.bones;
  if (pre.boneIdx.length === 0) { sphere.makeEmpty(); return; }
  _min.set(Infinity, Infinity, Infinity);
  _max.set(-Infinity, -Infinity, -Infinity);
  for (const k of pre.boneIdx) {
    _t.setFromMatrixPosition(bones[k]!.matrixWorld);
    _min.min(_t); _max.max(_t);
  }
  // Box centre + farthest origin: not the minimal sphere, but enclosing, and
  // within a few percent of it for a body's worth of bones.
  sphere.center.addVectors(_min, _max).multiplyScalar(0.5);
  let r2 = 0;
  for (const k of pre.boneIdx) {
    r2 = Math.max(r2, _t.setFromMatrixPosition(bones[k]!.matrixWorld).distanceToSquared(sphere.center));
  }
  sphere.radius = Math.sqrt(r2) + pre.pad;
  sphere.applyMatrix4(mesh.bindMatrixInverse);
}
