// src/lab/sdf-zombie/webgpu/shell-hull-outer.ts
//
// A conservative OUTER hull of the bodies — geometry guaranteed to CONTAIN
// the real surface — rasterised so the march can start where the body starts
// and stop where it ends, instead of walking the whole proxy box.
//
// WHY THIS EXISTS, with the number that justifies it. Measured 2026-08-31 via
// __sdfGame.occupancy(): the proxy boxes cover 75-100% of the SDF target while
// flesh occupies 7.5-18% of it, so **82-92% of every pixel the march
// rasterises hits nothing**, and those pixels carry 63-84% of all march steps.
// This hull is how that work gets deleted.
// (docs/dev-notes/2026-08-31-game-perf-baseline/notes.md)
//
// THE MIRROR IMAGE OF occluder-hull.ts, AND EVERY SIGN IS FLIPPED. That file
// builds an INNER hull: spheres guaranteed to sit inside the flesh, used to
// cut tMax short. Inner and outer want opposite things everywhere, and the
// four places it bites are worth naming, because copying occluder-hull's
// arithmetic would be wrong in all of them:
//
//   1. SCALE. Inner uses min(scale) — the largest sphere that fits inside an
//      unevenly scaled ellipsoid. Outer uses MAX(scale), the smallest that
//      contains it.
//   2. WOUNDS. Inner must DROP any sphere a wound might have hollowed out.
//      Outer ignores wounds entirely: subtraction only ever moves the surface
//      inward, and an outer bound stays valid when the thing it bounds
//      shrinks. No wound list, no clearance term, no dropped spheres.
//   3. SHELL DISPLACEMENT. Inner shrinks by shellAmp (the fbm's DENT side can
//      retreat behind the hull). Outer GROWS by it — the bump side is the one
//      that can escape a bound that contains.
//   4. COVERAGE. Inner emits one sphere per capsule END and that is enough:
//      any sphere inside the body is useful, and gaps just cull less. An
//      outer hull with gaps is a HOLE IN THE RENDER, and two end spheres do
//      NOT cover a capsule's waist. Hence the sphere chain below.
//
// WHY THE SURFACE IS PROVABLY INSIDE THIS HULL. Three terms, each bounding one
// way the real surface can sit outside the raw primitive it came from:
//
//   * The primitive itself: reach = rMax * maxScale (+ shell thickness, which
//     rides proud of the base capsule by construction).
//   * The BLEND, and MIND THE WIDTH CONVENTION — this is where the first
//     draft was wrong, and the containment test caught it. `smin` internally
//     works in `kk = k * 4` (validate.ts), so `min(a,b) - h*h*kk*0.25`
//     undercuts by at most `kk/4 = k`. The surface therefore sits up to a
//     FULL blendK outside the raw primitives, not k/4. Solving for where the
//     folded value reaches zero: `d = k` for `smin`, and `d = 2k` for
//     `sminChamfer`, whose bevel reaches further. BLEND_REACH uses the
//     chamfer figure for chamfer prims and the round one otherwise.
//
//     One honest limit: the fold is SEQUENTIAL, so a chain of primitives that
//     are all mutually within `4k` could in principle stack reductions beyond
//     a single prim's bound. Each fold only bites when the running distance is
//     within `4k` of the next primitive, so real anatomy does not approach it
//     — but the analytic bound covers ONE fold, and the whole-zombie
//     containment test is what guards the chain case on actual content.
//   * The NOISE. Silhouette fbm displaces the real field by up to shellAmp.
//
// Taper is not special-cased: rMax takes the fatter of radius/radiusB, exactly
// as assignClusters does for the bounds the march already culls with.
//
// BEND IS special-cased, and the naive version is wrong. assignClusters can
// fit a bounding SPHERE to {a, ctrl, b} because a sphere containing the
// control polygon contains the Bezier inside it. A sphere CHAIN threaded
// through those three points does not: the curve bows away from the control
// polygon, and a chain following a->ctrl->b leaves the middle of the arc
// outside. Measured on a 0.12 m bend: the surface escaped by 17 mm. So the
// spine is the tessellated curve itself.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { positionWorld, cameraPosition, vec4, length, sub } from 'three/tsl';
import { bendCtrl } from '../vec';
import type { BuiltBody, Vec3 } from '../types';

/**
 * How much bigger each chain sphere is than the capsule radius it covers.
 *
 * Spheres centred every `d <= R` along the axis, each of radius `R * f`. The
 * worst-case point is on the capsule surface (distance R from the axis)
 * exactly midway between two centres, at `sqrt(R^2 + (d/2)^2)` from either.
 * With `d = R` that is `R * sqrt(1.25)`, so `f >= sqrt(1.25) ~= 1.118`.
 *
 * 1.13 rather than 1.118: a hair of slack for the floating-point spacing
 * arithmetic, at a cost of ~1% in hull area.
 */
export const SPHERE_CHAIN_INFLATE = 1.13;

/** Chain spacing as a fraction of the covered radius. Pairs with the constant
 *  above — change one and the containment proof needs redoing. */
const SPHERE_CHAIN_SPACING = 1.0;

/** Below this the sphere is not worth an instance; the primitive is smaller
 *  than a pixel at any distance the crowd is seen from. */
const MIN_HULL_RADIUS = 0.008;

/** Segments the quadratic bend curve is tessellated into. 8 keeps the chord
 *  error well under the sphere slack at the bends this content authors. */
const BEND_SEGMENTS = 8;

/**
 * How far outside the raw primitives the fold can push the surface, per unit
 * of authored blendK. See the header: `smin` reaches k, `sminChamfer` 2k.
 */
export function blendReach(blendK: number, profile?: 'round' | 'chamfer'): number {
  return Math.max(0, blendK) * (profile === 'chamfer' ? 2 : 1);
}

/** Quadratic Bezier point, matching bendCtrl's control-point convention. */
function bezier(a: Vec3, c: Vec3, b: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return [
    u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
    u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
    u * u * a[2] + 2 * u * t * c[2] + t * t * b[2],
  ];
}

export interface HullSphere { centre: Vec3; radius: number }

export interface OuterHullOpts {
  /** Silhouette-noise amplitude the field may bulge by (marchCfg.z). */
  shellAmp?: number;
  /** Extra uniform slack, in metres. Debugging aid; ships at 0. */
  margin?: number;
}

/**
 * Conservative outer hull spheres, in world space, for the POSED bodies.
 *
 * "Per-limb posed hulls" in the plan's sense: these follow the skeleton for
 * free, because they are rebuilt from `posed().prims` — the rig has already
 * placed those. No re-meshing, unlike the 2026-08-25 spike whose single
 * rest-pose marching-tets hull took ~0.5 s to build and could never have
 * tracked an animated body.
 */
export function buildOuterHullInstances(
  bodies: BuiltBody[],
  opts: OuterHullOpts = {},
): HullSphere[] {
  const shellAmp = opts.shellAmp ?? 0;
  const margin = opts.margin ?? 0;
  const out: HullSphere[] = [];

  for (const body of bodies) {
    const live = new Set<number>();
    for (const c of body.clusters) if (c.alive) live.add(c.id);

    for (const p of body.prims) {
      // Cutters and severed flesh contribute no surface to contain.
      if (p.op === 'sub' || p.op === 'groove' || p.dead) continue;
      if (!live.has(p.cluster)) continue;

      const maxScale = Math.max(p.scale[0], p.scale[1], p.scale[2]);
      const rMax = Math.max(p.radius, p.radiusB ?? p.radius);
      const reach =
        rMax * maxScale
        + (p.shell ? p.shell.thickness : 0)
        + blendReach(p.blendK ?? 0, p.blendProfile)
        + shellAmp
        + margin;
      if (reach < MIN_HULL_RADIUS) continue;

      // The path the surface hugs. For a bend that is the CURVE, tessellated
      // — not the control polygon, which the arc bows away from.
      let spine: Vec3[];
      if (p.bend === undefined) {
        spine = [p.a, p.b];
      } else {
        const c = bendCtrl(p.a, p.b, p.bend);
        spine = [];
        for (let i = 0; i <= BEND_SEGMENTS; i++) {
          spine.push(bezier(p.a, c, p.b, i / BEND_SEGMENTS));
        }
      }

      const r = reach * SPHERE_CHAIN_INFLATE;
      const step = reach * SPHERE_CHAIN_SPACING;
      for (let seg = 0; seg + 1 < spine.length; seg++) {
        const s = spine[seg]!;
        const e = spine[seg + 1]!;
        const dx = e[0] - s[0], dy = e[1] - s[1], dz = e[2] - s[2];
        const len = Math.hypot(dx, dy, dz);
        const n = Math.max(1, Math.ceil(len / step));
        // <= n so the far endpoint always gets a sphere; the last segment
        // shares its end with the next segment's start, which is harmless
        // duplication and cheaper than special-casing it.
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          out.push({ centre: [s[0] + dx * t, s[1] + dy * t, s[2] + dz * t], radius: r });
        }
      }
    }
  }
  return out;
}

export interface OuterHull {
  /** Front faces — the ENTRY distance. */
  readonly object: THREE.Mesh;
  update(bodies: BuiltBody[], opts?: OuterHullOpts): void;
  readonly instanceCount: number;
  readonly overflowed: boolean;
  dispose(): void;
}

/**
 * The rasterised outer hull.
 *
 * Writes DISTANCE FROM THE CAMERA as colour, exactly as occluder-hull does —
 * that is the ray parameter the march compares against, and writing depth
 * instead would need the projection undone per marched pixel to recover it.
 *
 * The caller renders this object TWICE into two targets: once front-side with
 * a near depth test (entry) and once back-side with a far one (exit).
 */
export function createOuterHull(maxInstances = 4096): OuterHull {
  // Icosahedron, subdivision 1 — but note this is an INSCRIBED approximation:
  // a subdivided icosahedron's faces sit INSIDE its circumsphere. For the
  // inner occluder that errs safe; here it errs the WRONG way, so the radius
  // is pre-divided by the inradius ratio below to compensate.
  const geo = new THREE.IcosahedronGeometry(1, 1);
  // Inradius of a subdivision-1 icosahedron relative to its circumradius.
  // Dividing by it inflates the mesh until its FACES reach the true sphere.
  const FACE_INSET = 0.9356;

  const material = new MeshBasicNodeMaterial();
  const dist = length(sub(positionWorld, cameraPosition));
  material.colorNode = vec4(dist, dist, dist, 1);
  material.depthWrite = true;
  material.depthTest = true;

  const mesh = new THREE.InstancedMesh(geo, material, maxInstances);
  mesh.frustumCulled = false;
  mesh.count = 0;

  const m = new THREE.Matrix4();
  let count = 0;
  let overflowed = false;

  function update(bodies: BuiltBody[], opts: OuterHullOpts = {}) {
    const inst = buildOuterHullInstances(bodies, opts);
    overflowed = inst.length > maxInstances;
    count = Math.min(inst.length, maxInstances);
    for (let i = 0; i < count; i++) {
      const s = inst[i]!;
      const r = s.radius / FACE_INSET;
      m.makeScale(r, r, r);
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
    // An overflowed hull is NOT a slightly worse hull — the instances that did
    // not fit leave uncovered flesh, and uncovered flesh renders as a hole.
    // The consumer must fall back to the unbounded march when this is true.
    get overflowed() { return overflowed; },
    dispose() { geo.dispose(); material.dispose(); mesh.dispose(); },
  };
}
