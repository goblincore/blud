// src/lab/sdf-zombie/webgpu/occluder-hull.ts
//
// A conservative INNER hull of the bodies, rasterised so the march can stop
// early where something solid already covers the ray.
//
// WHY THIS SHAPE OF FIX. The march writes frag_depth and discards, which
// between them defeat early-Z, so a body entirely hidden behind another still
// pays in full — measured at 6.2x for ten bodies sharing one silhouette. WGSL
// has no equivalent of EXT_conservative_depth's depth_greater qualifier, so
// early-Z cannot be won back and the rejection has to be done by hand.
//
// The merged single-pass march was tried first and lost — deleted since; the
// autopsy lives in commits 482f9e1/b28d168 and TASKS.md row X1.14. The lesson
// from it is the reason this approach works: every body's TIGHT proxy box is
// worth more than the overdraw it costs, so the fix has to ADD a bound rather
// than replace ten of them with one.
//
// WHY IT IS SAFE, which is the only thing that really matters here. smin never
// subtracts — `smin(a,b,k) <= min(a,b)` — so the solid region contains the
// union of the raw primitives. Any sphere inside a primitive is therefore
// inside the blended body, and a ray cut short at that sphere can only ever
// have been going to hit something NEARER. Cutting cannot remove a visible
// surface; it can only fail to cut as much as it might have.
//
// WHAT BREAKS THAT: carves and wounds SUBTRACT. A hull sphere sitting where an
// eye socket or a blast crater removed material is no longer inside anything,
// and a ray cut there would punch a hole straight through the body. Hence
// HULL_SHRINK, and hence the wound exclusion in buildHullInstances.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { positionWorld, cameraPosition, vec4, length, sub } from 'three/tsl';
import type { BuiltBody, Vec3 } from '../types';

/**
 * How far each hull sphere is pulled in from the primitive that contains it.
 *
 * Not paranoia — it is what buys margin against the subtractive terms the hull
 * cannot see. Carved eye sockets and small wounds bite into the surface, and a
 * hull that hugged the primitive exactly would poke through them. 0.8 costs a
 * little culling and removes a whole class of hole.
 */
export const HULL_SHRINK = 0.8;

/**
 * Radius under which a sphere is not worth an instance. Tiny face primitives
 * contribute almost no screen coverage and are the ones most likely to sit
 * next to a carve.
 */
const MIN_HULL_RADIUS = 0.02;

export interface HullInstance {
  centre: Vec3;
  radius: number;
}

/** A wound's removal sphere, in world space — what applyWounds subtracts. */
export interface WoundSphere {
  centre: Vec3;
  radius: number;
}

/**
 * Extra clearance around a wound before a hull sphere is considered safe.
 *
 * Covers the two ways a wound reaches past its nominal radius: the smax blend
 * softens the cavity wall outward, and the everted rim displaces material
 * around the mouth. Verified the hard way — a blast crater rendered with a
 * BLACK centre while the occluder was on and a wet interior with it off,
 * because the carve had exposed the hull sphere inside the cavity and every
 * ray into the crater clamped at it.
 */
const WOUND_CLEARANCE = 0.05;

/**
 * One sphere at each end of every additive primitive.
 *
 * Endpoints rather than the midpoint: a limb capsule is long, and a single
 * mid-sphere of radius r covers almost none of it. Two end-spheres track the
 * shape as it bends, which is what makes the hull worth rasterising at all.
 *
 * Radius is `r * min(scale)`, the largest sphere guaranteed to fit inside an
 * ellipsoid capsule whose axes are scaled unevenly — using the raw radius
 * would poke outside on any axis scaled below 1.
 *
 * `wounds` are the current removal spheres: any hull sphere that intersects
 * one is DROPPED, not shrunk. Wounds subtract, and subtraction is the one
 * thing that can put a hull sphere outside the body — the inside-ness
 * argument (smin only adds) covers every other case. Dropping costs a little
 * culling in a small region around each wound; keeping it costs a hole in
 * the render.
 */
export function buildHullInstances(
  bodies: BuiltBody[], shrink = HULL_SHRINK, wounds: WoundSphere[] = [],
): HullInstance[] {
  const out: HullInstance[] = [];
  const clearOfWounds = (c: Vec3, r: number): boolean => {
    for (const w of wounds) {
      const dx = c[0] - w.centre[0], dy = c[1] - w.centre[1], dz = c[2] - w.centre[2];
      const reach = w.radius + r + WOUND_CLEARANCE;
      if (dx * dx + dy * dy + dz * dz < reach * reach) return false;
    }
    return true;
  };
  for (const body of bodies) {
    const live = new Set<number>();
    for (const c of body.clusters) if (c.alive) live.add(c.id);

    for (const p of body.prims) {
      // Carves are the subtractive half of the body's own definition. A hull
      // sphere built from one would sit in a hole.
      if (p.op === 'sub') continue;
      if (!live.has(p.cluster)) continue;
      const r = p.radius * Math.min(p.scale[0], p.scale[1], p.scale[2]) * shrink;
      if (r < MIN_HULL_RADIUS) continue;
      if (clearOfWounds(p.a, r)) out.push({ centre: p.a, radius: r });
      // A zero-length capsule is a sphere; one instance is enough.
      const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], dz = p.b[2] - p.a[2];
      if (dx * dx + dy * dy + dz * dz > 1e-8 && clearOfWounds(p.b, r)) {
        out.push({ centre: p.b, radius: r });
      }
    }
  }
  return out;
}

export interface OccluderHull {
  object: THREE.Mesh;
  update(bodies: BuiltBody[], wounds?: WoundSphere[]): void;
  readonly instanceCount: number;
  dispose(): void;
}

export function createOccluderHull(maxInstances = 1024): OccluderHull {
  // Icosahedron rather than a UV sphere: at this size the silhouette is a few
  // pixels across, and it has no pole crowding to waste triangles on.
  //
  // NOTE it is an inscribed approximation — a subdivided icosahedron's FACES
  // sit inside its circumsphere — which errs in the safe direction here.
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const material = new MeshBasicNodeMaterial();
  // The distance from the camera, which is exactly the ray parameter the march
  // compares against. Writing depth instead would need the projection undone
  // per marched pixel to get back to a distance.
  const dist = length(sub(positionWorld, cameraPosition));
  material.colorNode = vec4(dist, dist, dist, 1);
  // Ordinary hardware depth — no depthNode override, so early-Z works here
  // even though it cannot in the march. Nearest hull surface wins.
  material.depthWrite = true;
  material.depthTest = true;

  const mesh = new THREE.InstancedMesh(geo, material, maxInstances);
  mesh.frustumCulled = false;
  mesh.count = 0;

  const m = new THREE.Matrix4();
  let count = 0;

  function update(bodies: BuiltBody[], wounds: WoundSphere[] = []) {
    const inst = buildHullInstances(bodies, HULL_SHRINK, wounds);
    count = Math.min(inst.length, maxInstances);
    for (let i = 0; i < count; i++) {
      const s = inst[i]!;
      m.makeScale(s.radius, s.radius, s.radius);
      m.setPosition(s.centre[0], s.centre[1], s.centre[2]);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }

  update([]);

  return {
    object: mesh,
    update,
    get instanceCount() { return count; },
    dispose() {
      geo.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
