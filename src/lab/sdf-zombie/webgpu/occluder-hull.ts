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
 *  (owner-rejected, 2026-09-01).
 *
 *  This hull is NEVER consumed by the march — it exists only to be rendered
 *  into a shadow map — so inside-ness, the constraint that shapes everything
 *  above, simply does not apply to it. Being safely OUTSIDE the body is fine;
 *  a fat shadow reads as a soft edge, a hole reads as broken.
 *
 *  WHY THIS NUMBER IS SMALL, AND WHY IT USED TO BE 1.35. The first fix tried
 *  to close the gaps with inflation alone, and the owner rejected the result
 *  as STILL BLOBS. Inflation cannot do that job, and the prim table says so
 *  without a screenshot: the two end spheres of a primitive touch only when
 *  inflate >= L / (rA + rB), and on the zombie that ratio is 2.95 for the
 *  shins (L 0.365, r 0.062), 2.66 and 2.54 for the arms, 2.20 for the thighs.
 *  Every one of the nine spanning prims is still gapped at 1.6, eight of nine
 *  at 1.8, and the set only fuses at 3.0 — by which point a shin sphere is
 *  0.186 across a 0.062 limb, three times the flesh, so the cure is a worse
 *  artifact than the disease. There is no value that closes the gaps and
 *  keeps the silhouette.
 *
 *  So the connectivity is bought by SPANNING instead (see `span` in
 *  buildHullInstances): spheres stepped along each primitive's axis, which is
 *  just the capsule the primitive already is. That leaves inflation with only
 *  its honest job — covering what min(scale) under-sizes on an unevenly
 *  scaled prim, and the smin blend's extra flesh at the joints — which is a
 *  few percent, not a few hundred.
 */
export const SHADOW_HULL_INFLATE = 1.15;

/**
 * Step between consecutive spheres along a spanned primitive, as a fraction
 * of the two radii added together. 1.0 = exactly tangent; below that they
 * overlap.
 *
 * Not 1.0, because tangency is a single point and a 1024x1024 shadow map
 * rasterises the pinch as nothing at all — the bead-chain reappears at
 * grazing angles. 0.75 leaves a quarter of the sum as genuine overlap, which
 * costs one extra sphere on the longest bone the zombie has.
 */
export const SHADOW_SPAN_STEP = 0.75;

/** Hard cap on spheres emitted per primitive when spanning, so a mis-authored
 *  hair-thin prim cannot blow the instance budget. At the production step and
 *  inflation nothing on the cast comes close (worst is the shin, 5). */
const MAX_SPAN_SPHERES = 16;

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
 *
 * `span` fills the AXIS of each primitive instead of only its two ends, and
 * exists for the shadow hull. Two end spheres are a fine BOUND — which is all
 * the occlusion hull ever needed — but they are not the shape: a primitive is
 * a capsule, and the union of its two end spheres is a dumbbell with nothing
 * in the middle. Rasterised into a shadow map that dumbbell is exactly what
 * the owner saw, a scatter of separate circles, and no amount of inflation
 * fixes it (the arithmetic is under SHADOW_HULL_INFLATE). Stepping spheres
 * along the segment reconstructs the capsule, which is honest by construction
 * — every sphere is centred ON the primitive's own axis with the primitive's
 * own interpolated radius, so the silhouette is the limb rather than a
 * fattened guess at it.
 *
 * The occlusion path leaves it OFF, and must: spanning is free correctness
 * for a shadow and pure extra instances for a bound that two spheres already
 * satisfy, and turning it on there would change a hull that is pinned
 * bit-for-bit by the shell tests.
 */
export function buildHullInstances(
  bodies: BuiltBody[], shrink = HULL_SHRINK, wounds: WoundSphere[] = [],
  shellAmp = 0, span = false,
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
      const lenSq = dx * dx + dy * dy + dz * dz;
      if (lenSq <= 1e-8) continue;
      // The interior of the capsule. Steps are sized off the THIN end
      // (min(rA, rB)) because a taper's tightest pair is there — sizing off
      // the mean leaves the last step short of overlapping on a cone like the
      // mouse's snout. `steps` is the number of gaps, so `steps - 1` interior
      // spheres go between the two ends that bracket them.
      const steps = span && Math.min(rA, rB) > 0
        ? Math.min(MAX_SPAN_SPHERES, Math.max(1, Math.ceil(
          Math.sqrt(lenSq) / (SHADOW_SPAN_STEP * 2 * Math.min(rA, rB)))))
        : 1;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const c: Vec3 = [p.a[0] + dx * t, p.a[1] + dy * t, p.a[2] + dz * t];
        const r = rA + (rB - rA) * t;
        if (r >= MIN_HULL_RADIUS && clearOfWounds(c, r)) out.push({ centre: c, radius: r });
      }
      if (rB >= MIN_HULL_RADIUS && clearOfWounds(p.b, rB)) {
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
  /** `occluder: false` skips the inner-hull rebuild (the pre-pass consumes
   *  it, and the pre-pass is off on the game page); the shadow twin is
   *  always rebuilt because the shadow map is always live. */
  update(bodies: BuiltBody[], wounds?: WoundSphere[], opts?: { occluder?: boolean }): void;
  /** Diagnostic: rasterise an explicit sphere list, bypassing the builder. */
  setSpheres(list: HullInstance[]): void;
  /**
   * A/B SEAM FOR THE SHADOW HULL — turn spanning off and rebuild.
   *
   * Exists because a cross-load A/B of this feature is not trustworthy: the
   * actors wander, and a reload freezes them at a different heading, so two
   * builds captured back to back differ by an arm as well as by the fix
   * (measured — a same-state pair already moves ~6.6k px of a 1.0 Mpx frame,
   * and the residual sits ON the figure). Toggling within ONE load holds
   * every actor exactly still, so the only thing that changes between the two
   * frames is the caster. Call the owner's refreshHull() after it.
   *
   * `inflate` overrides SHADOW_HULL_INFLATE for the same reason: the state the
   * owner rejected was spanning off AND inflate 1.35, and reproducing it needs
   * both. Omit it to use the shipped value.
   */
  setShadowSpan(on: boolean, inflate?: number): void;
  readonly instanceCount: number;
  dispose(): void;
}

/**
 * How much bigger the SHADOW mesh's instance budget is than the occlusion
 * mesh's. Spanning trades instances for connectivity — the zombie goes from
 * 30 spheres to 51, so ten of them fit in 1024 with room to spare, but the
 * headroom halved and `fillInstances` truncates SILENTLY. A truncated shadow
 * hull is a body whose legs stop casting, which is exactly the bug class this
 * work exists to remove, so the budget is bought back here. The cost is one
 * instanceMatrix buffer (16 floats an instance, 128 KB at 2048) — geometry
 * and material are shared with the occlusion mesh either way.
 */
const SHADOW_INSTANCE_FACTOR = 2;

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
  const shadowMesh = new THREE.InstancedMesh(geo, material, maxInstances * SHADOW_INSTANCE_FACTOR);
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
  let shadowSpan = true;
  let shadowInflate = SHADOW_HULL_INFLATE;

  function fillInstances(target: THREE.InstancedMesh, inst: HullInstance[]): number {
    // The mesh's OWN capacity, not maxInstances — the shadow twin is allocated
    // larger (SHADOW_INSTANCE_FACTOR) and clamping it to the occlusion budget
    // would throw the extra room away.
    const n = Math.min(inst.length, target.instanceMatrix.count);
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

  function update(bodies: BuiltBody[], wounds: WoundSphere[] = [], opts: { occluder?: boolean } = {}) {
    if (opts.occluder !== false) {
      count = fillInstances(mesh, buildHullInstances(bodies, HULL_SHRINK, wounds));
    }
    // SPANNED (last arg): the shadow needs the capsule, not its two ends. See
    // SHADOW_HULL_INFLATE for why inflation alone could never do this.
    fillInstances(shadowMesh, buildHullInstances(bodies, shadowInflate, wounds, 0, shadowSpan));
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
    setShadowSpan(on: boolean, inflate = SHADOW_HULL_INFLATE) {
      shadowSpan = on;
      shadowInflate = inflate;
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
