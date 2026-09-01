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
import { SHADOW_HULL_LAYER } from './sdf-layer';
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

/** Scale for the SHADOW-CASTING hull, as opposed to the depth-occlusion hull.
 *
 *  HULL_SHRINK exists to keep the hull conservatively INSIDE the body so the
 *  march never skips real geometry. Reusing it for shadows was wrong: shrunk
 *  spheres leave gaps between them, and those gaps show up as holes in the
 *  shadow — the figure casts as a scatter of blobs rather than a body
 *  (owner-rejected, 2026-09-01). A shadow caster wants the opposite bias:
 *  overlap, so neighbouring spheres fuse into one silhouette.
 *
 *  This hull is NEVER consumed by the march — it exists only to be rendered
 *  into a shadow map — so inside-ness, the constraint that shapes everything
 *  above, simply does not apply to it. Being safely OUTSIDE the body is fine;
 *  a fat shadow reads as a soft edge, a hole reads as broken.
 */
export const SHADOW_HULL_INFLATE = 1.35;

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
 *
 * `shellAmp` (X1.21.2) sizes the hull against the SHELL-DISPLACED field, not
 * just the smooth one. Direction matters and is INWARD, which is not the
 * BVH instinct: this hull is consumed as a bound on how far a ray may march
 * (the march clamps tMax by the hull distance), so a sphere that grows is a
 * bound that TIGHTENS and culls more — the exact opposite of conservative
 * here. The displacement the hull must survive is the DENT side: the fbm can
 * pull the real surface up to ~0.9 amp below the smooth one, so a sphere
 * keeping only its usual (1 - shrink) clearance can find the dented surface
 * passing BEHIND it on thin limbs, and every ray through it discards — dark
 * dropout, A/B-confirmed with the occluder toggled off. Pulling the radius
 * in by the amp (and growing the wound clearance by it) keeps every emitted
 * sphere inside the displaced field; spheres too small to afford the margin
 * are dropped rather than half-included.
 *
 * The production consumer does not pass an amp: the march compensates on
 * its own side instead, extending its tMax by woundCfg2.z (see
 * march.wgsl.ts), which covers every dent through the uniform already on
 * every body. This parameter is the contract made explicit — and the
 * cheaper hull for any caller that prefers paying in geometry to paying in
 * march steps.
 */
export function buildHullInstances(
  bodies: BuiltBody[], shrink = HULL_SHRINK, wounds: WoundSphere[] = [],
  shellAmp = 0,
): HullInstance[] {
  const out: HullInstance[] = [];
  const clearOfWounds = (c: Vec3, r: number): boolean => {
    for (const w of wounds) {
      const dx = c[0] - w.centre[0], dy = c[1] - w.centre[1], dz = c[2] - w.centre[2];
      const reach = w.radius + r + WOUND_CLEARANCE + shellAmp;
      if (dx * dx + dy * dy + dz * dz < reach * reach) return false;
    }
    return true;
  };
  for (const body of bodies) {
    const live = new Set<number>();
    for (const c of body.clusters) if (c.alive) live.add(c.id);

    for (const p of body.prims) {
      // Carves are the subtractive half of the body's own definition. A hull
      // sphere built from one would sit in a hole. Dead prims (mid-limb
      // severing) are flesh that no longer exists: a hull sphere at the old
      // joint clamps tMax in EMPTY space and every ray through it discards —
      // see-through holes wherever the phantom overlaps the body on screen.
      // A groove is a cutter too — it REMOVES a channel — and its field is
      // not flesh any sphere may sit in. It only ever escaped by accident: a
      // groove's `tall` is tiny, so min(scale) pushed its spheres under
      // MIN_HULL_RADIUS. A fatter cutter would have punched a hole.
      if (p.op === 'sub' || p.op === 'groove' || p.dead) continue;
      if (!live.has(p.cluster)) continue;
      // Minus the amp, not plus: the dent side is the one that can reach
      // past the hull (see the buildHullInstances doc). A sphere that cannot
      // afford the margin is dropped — a half-margin sphere is the dropout
      // bug in miniature.
      const minScale = Math.min(p.scale[0], p.scale[1], p.scale[2]);
      const rA = p.radius * minScale * shrink - shellAmp;
      // PER END. A tapered primitive (`r2=`) is a round cone: radius `radius`
      // at `a`, `radiusB` at `b`. Sizing the b-sphere from `radius` put a
      // 0.046 sphere inside 0.036 of flesh at the mouse's snout tip — 10 mm
      // proud of the surface — and every ray that reached that cap clamped
      // and discarded. On screen: a perfectly ROUND see-through hole in the
      // face, which read as a nose carved out as negative space and cost
      // most of a day being hunted as a modelling defect. The mouse was just
      // the first character whose tapered prim was fat enough to clear
      // MIN_HULL_RADIUS; nothing about it was unusual.
      const rB = (p.radiusB ?? p.radius) * minScale * shrink - shellAmp;
      if (rA >= MIN_HULL_RADIUS && clearOfWounds(p.a, rA)) out.push({ centre: p.a, radius: rA });
      // A zero-length capsule is a sphere; one instance is enough.
      const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], dz = p.b[2] - p.a[2];
      if (dx * dx + dy * dy + dz * dz > 1e-8 && rB >= MIN_HULL_RADIUS && clearOfWounds(p.b, rB)) {
        out.push({ centre: p.b, radius: rB });
      }
    }
  }
  return out;
}

export interface OccluderHull {
  object: THREE.Mesh;
  /** A SECOND hull over the same instances, INFLATED (SHADOW_HULL_INFLATE),
   *  used only as a shadow caster. Invisible to the camera — it lives on
   *  SHADOW_HULL_LAYER, which no view pass ever enables — but seen by the
   *  flashlight's shadow camera, whose frustum it fills with one connected
   *  silhouette instead of the occlusion hull's scatter of shrunk blobs.
   *  Lives on its own layer rather than OCCLUDER_LAYER because the occluder
   *  pre-pass (sdf-layer.ts pass 1c) flips the camera mask to that layer and
   *  rasterises everything on it into the occT target — an inflated hull in
   *  that target would clamp tMax in empty space in front of every body and
   *  dissolve the march. */
  shadowObject: THREE.Mesh;
  update(bodies: BuiltBody[], wounds?: WoundSphere[]): void;
  /** Diagnostic: rasterise an explicit sphere list, bypassing the builder. */
  setSpheres(list: HullInstance[]): void;
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
  // DIAGNOSTIC CHANNEL (2026-09-01). uDebugWorld 1 writes the fragment's WORLD
  // POSITION instead of the distance, so a readback can be compared against
  // the sphere the instance matrix says was drawn. A uniform rather than a
  // second material: swapping colorNode would rebuild the pipeline mid-frame,
  // which is exactly the trap shell-hull-outer.ts documents.
  material.colorNode = vec4(dist, dist, dist, 1);
  // Ordinary hardware depth — no depthNode override, so early-Z works here
  // even though it cannot in the march. Nearest hull surface wins.
  material.depthWrite = true;
  material.depthTest = true;

  const mesh = new THREE.InstancedMesh(geo, material, maxInstances);
  mesh.frustumCulled = false;
  mesh.count = 0;

  // The shadow twin: same geometry, same distance-material (irrelevant in a
  // shadow pass, which consumes depth), INFLATED radii. Shares geo/material
  // deliberately — the two hulls are the same spheres at two scales, and a
  // material flip between passes is the WebGPU pipeline-rebuild trap recorded
  // on SHELL_EXIT_LAYER.
  const shadowMesh = new THREE.InstancedMesh(geo, material, maxInstances);
  shadowMesh.frustumCulled = false;
  shadowMesh.count = 0;
  // Not `visible = false`: three only renders visible objects into a shadow
  // map. The layers keep it out of every camera pass — including the occluder
  // pre-pass, whose flipped mask is exactly why this is NOT OCCLUDER_LAYER
  // (see the interface doc). Set here so a caller that forgets to set layers
  // still never rasterises grey blobs into the main pass.
  shadowMesh.layers.set(SHADOW_HULL_LAYER);
  shadowMesh.castShadow = true;
  mesh.castShadow = false;

  const m = new THREE.Matrix4();
  let count = 0;
  let shadowCount = 0;

  function fillInstances(target: THREE.InstancedMesh, inst: HullInstance[]): number {
    const n = Math.min(inst.length, maxInstances);
    for (let i = 0; i < n; i++) {
      const s = inst[i]!;
      m.makeScale(s.radius, s.radius, s.radius);
      m.setPosition(s.centre[0], s.centre[1], s.centre[2]);
      target.setMatrixAt(i, m);
    }
    target.count = n;
    target.instanceMatrix.needsUpdate = true;
    return n;
  }

  function update(bodies: BuiltBody[], wounds: WoundSphere[] = []) {
    count = fillInstances(mesh, buildHullInstances(bodies, HULL_SHRINK, wounds));
    shadowCount = fillInstances(shadowMesh, buildHullInstances(bodies, SHADOW_HULL_INFLATE, wounds));
  }

  update([]);

  return {
    object: mesh,
    shadowObject: shadowMesh,
    update,
    /** Diagnostic: rasterise an explicit sphere list, bypassing the builder. */
    setSpheres(list: HullInstance[]) {
      count = Math.min(list.length, maxInstances);
      for (let i = 0; i < count; i++) {
        const sp = list[i]!;
        m.makeScale(sp.radius, sp.radius, sp.radius);
        m.setPosition(sp.centre[0], sp.centre[1], sp.centre[2]);
        mesh.setMatrixAt(i, m);
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    },
    get instanceCount() { return count; },
    dispose() {
      geo.dispose();
      material.dispose();
      mesh.dispose();
      shadowMesh.dispose();
    },
  };
}
