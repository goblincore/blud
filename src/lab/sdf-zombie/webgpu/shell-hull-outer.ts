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
import { bendCtrl, qRotate, type Quat } from '../vec';
import { boxReach, shellReach, strandReach } from '../extent';
import type { BuiltBody, Vec3 } from '../types';
import { HEAD_SPLIT, splitFrame, splitSphereImages } from '../head-split';
import { CUT_SHADE } from '../cut-wound';
import { SPLIT_BOUND, boundsSplit, splitAblate } from './split-ablate';

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

/** The tight cover's spacing, as a share of its capsule's radius, and the hair of slack on its spheres. A chain of
 *  spheres of radius rho, spaced d along a segment, covers the capsule of radius R about that segment exactly when
 *  rho^2 >= R^2 + (d / 2)^2 (the worst point is on the capsule's surface midway between two centres; an end cap is
 *  inside its end sphere). At a quarter of the radius that is 0.8% over R, where the hull's own chains (spaced at the
 *  radius) need 13%: on a cover whose whole point is to be slim, and whose end spheres would otherwise reach 13%
 *  past the ellipsoid's tips, the extra spheres are worth it (four for a skull). */
const TIGHT_CHAIN_SPACING = 0.25;
const TIGHT_CHAIN_SLACK = 1.001;

/**
 * THE TIGHT COVER OF A PLAIN ELLIPSOID: a sphere chain along its LONGEST axis, where the hull's own sphere for it
 * (one sphere of the largest semi-axis) is loose across the two shorter ones. `axes` are the semi-axes in the
 * prim's frame (radius x scale), `orient` turns that frame into the world (none = the world's axes), and `pad` is
 * everything the surface may sit proud of the raw ellipsoid by (the blend, the shell noise, the margin).
 *
 * WHY IT CONTAINS THE ELLIPSOID. With semi-axes a <= b <= c (c along z): a point of the ellipsoid has
 * x^2 + y^2 <= b^2 (1 - z^2 / c^2), so it is within b of the z axis; and past the segment's end, at |z| = t in
 * (c - b, c], its distance to the end point squared is at most b^2 (1 - t^2 / c^2) + (t - c + b)^2, which is at most
 * b^2 exactly when t <= c. So the ellipsoid lies in the capsule of radius b about the segment of half-length c - b,
 * the padded one in the capsule of radius b + pad, and the chain covers that capsule (TIGHT_CHAIN_SPACING). A sphere
 * (b = c) is one sphere of radius b + pad.
 *
 * The outer hull keeps its one loose sphere where the body stands: closed bodies draw as they did. THE HEAD SPLIT
 * turns copies of THIS cover with each half instead (below): the skull's sphere is 0.158 m against a 0.090 m
 * half-width, and its turned copies were a ring of rays that march and miss.
 */
export function ellipsoidChain(centre: Vec3, axes: Vec3, orient: Quat | undefined, pad: number): HullSphere[] {
  const kc = axes[0] >= axes[1] && axes[0] >= axes[2] ? 0 : axes[1] >= axes[2] ? 1 : 2;
  const c = axes[kc]!, b = Math.max(axes[(kc + 1) % 3]!, axes[(kc + 2) % 3]!);
  const reach = b + pad, half = Math.max(c - b, 0);
  const unit: Vec3 = [kc === 0 ? 1 : 0, kc === 1 ? 1 : 0, kc === 2 ? 1 : 0];
  const dir = orient ? qRotate(orient, unit) : unit;
  const n = half === 0 ? 0 : Math.max(1, Math.ceil(2 * half / (reach * TIGHT_CHAIN_SPACING)));
  const d = n === 0 ? 0 : 2 * half / n;
  const radius = Math.hypot(reach, d / 2) * TIGHT_CHAIN_SLACK;
  const out: HullSphere[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : -half + d * i;
    out.push({ centre: [centre[0] + dir[0] * t, centre[1] + dir[1] * t, centre[2] + dir[2] * t], radius });
  }
  return out;
}

/** THE LIP OF A SPLIT'S FACE CUT (m): the most the cut stamped along an opened half's cut face can raise the skin at
 *  its rim (cut-wound.ts cutLip's amplitude for head-split.ts HEAD_SPLIT.faceCalibre). The outer hull ignores wounds,
 *  because subtraction only moves a surface inward, and a lip is the one thing a wound ADDS: a loose sphere has the
 *  room for it, a tight cover does not, and the face cuts sit on the very rims the tight cover hugs. So the tight
 *  cover is padded by it. */
export const SPLIT_HULL_LIP = HEAD_SPLIT.faceCalibre.kerf * CUT_SHADE.lipHeight * Math.min(HEAD_SPLIT.faceCalibre.lip, CUT_SHADE.maxLipScale);

/** A prim whose solid is exactly an ellipsoid: a point prim with no taper, bend, box, strand or shell. */
function plainEllipsoid(p: BuiltBody['prims'][number]): boolean {
  return p.a[0] === p.b[0] && p.a[1] === p.b[1] && p.a[2] === p.b[2]
    && p.bend === undefined && p.box === undefined && p.strand === undefined && p.shell === undefined
    && (p.radiusB === undefined || p.radiusB === p.radius);
}

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
    // THE HEAD SPLIT (head-split.ts): the spheres whose turned copies cover the opened halves (below). None for a
    // closed head.
    const split = splitFrame(boundsSplit(body.split, SPLIT_BOUND.hullOuter));
    const tightCopies = split !== null && (splitAblate.boundsOff & SPLIT_BOUND.hullOld) === 0;
    const turning: HullSphere[] = [];

    for (const p of body.prims) {
      // Cutters and severed flesh contribute no surface to contain.
      if (p.op === 'sub' || p.op === 'groove' || p.dead) continue;
      if (!live.has(p.cluster)) continue;

      const maxScale = Math.max(p.scale[0], p.scale[1], p.scale[2]);
      const rMax = Math.max(p.radius, p.radiusB ?? p.radius) * boxReach(p.box) * strandReach(p.strand);
      const reach =
        rMax * maxScale
        + shellReach(p)
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
      const primStart = out.length;
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
      // What turns with a half is this prim's cover: the spheres just pushed, or for a plain ellipsoid its tight
      // chain (ellipsoidChain), which holds the same solid in less room.
      if (split) {
        let cover: HullSphere[] | null = null;
        if (tightCopies && plainEllipsoid(p)) {
          const axes: Vec3 = [p.radius * p.scale[0], p.radius * p.scale[1], p.radius * p.scale[2]];
          // The pad is everything in `reach` but the ellipsoid itself (a plain one has no shell), and the face
          // cut's lip (SPLIT_HULL_LIP). A cover no slimmer than the prim's own sphere is not taken.
          const pad = blendReach(p.blendK ?? 0, p.blendProfile) + shellAmp + margin + ((splitAblate.boundsOff & SPLIT_BOUND.hullNoLip) === 0 ? SPLIT_HULL_LIP : 0);
          const chain = ellipsoidChain(p.a, axes, p.orient, pad);
          if (chain[0]!.radius < r) cover = chain;
        }
        if (cover) for (const s of cover) turning.push(s);
        else for (let i = primStart; i < out.length; i++) turning.push(out[i]!);
      }
    }
    // THE HEAD SPLIT (head-split.ts): the prims above are the closed head's. An opened half is its closed flesh
    // turned rigidly about the hinge, cut faces included (the covers hold the closed head's inside too), so each
    // sphere of a prim's cover that holds flesh of a half gets a copy turned with that half. The spheres pushed
    // above stay: they hold what does not turn.
    if (split) {
      for (const s of turning) {
        for (const centre of splitSphereImages(split, s.centre, s.radius)) out.push({ centre, radius: s.radius });
      }
    }
  }
  return out;
}

export interface OuterHull {
  /** Front faces + LessEqual — rendered into the ENTRY target. */
  readonly entryObject: THREE.Mesh;
  /** Back faces + GreaterDepth — rendered into the EXIT target. */
  readonly exitObject: THREE.Mesh;
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

  // TWO meshes with FIXED materials, not one flipped between passes.
  //
  // The first build flipped a single material (side + depthFunc +
  // needsUpdate) twice per frame between the entry and exit renders. On the
  // WebGPU backend needsUpdate forces a pipeline rebuild, and a pass whose
  // pipeline is mid-rebuild renders stale or nothing — so the RENDERED hull
  // stopped tracking the bodies even though the instance matrices updated
  // every frame. On screen: the body walks out of its own frozen hull and the
  // march masks it against the stale bounds — flesh scraps floating where the
  // body used to be. Caught by the owner in live play (2026-08-31); every
  // automated gate had frozen the wanderers first, and a stale hull is
  // indistinguishable from a fresh one on a frozen body.
  //
  // The occluder never hit this because its material is never touched after
  // creation. Same rule here now: create two, mutate neither.
  const makeMaterial = (side: THREE.Side, depthFunc: THREE.DepthModes) => {
    const material = new MeshBasicNodeMaterial();
    const dist = length(sub(positionWorld, cameraPosition));
    // Distance from the camera — exactly the ray parameter the march compares
    // against; depth would need the projection undone per marched pixel.
    material.colorNode = vec4(dist, dist, dist, 1);
    // FOG MUST BE OFF HERE (close-up diagnostics task 1, 2026-09-04). The
    // pre-pass renders through the main scene, whose fog the WebGPU node
    // system applies to every fogged material's OUTPUT — and the TSL fog
    // factor is smoothstep(near, far, viewZ), so the written "distance"
    // was mix(dist, fogColor, smoothstep(...)): exact below fog.near, then
    // collapsing toward fogColor with range. That was the "unexplained
    // three-r185 TSL distance decay" that held GAME_HULL_EXIT_BOUND at 0
    // and killed the occluder pre-pass — the ladder fit the fog curve to
    // four decimals once the fog was suspected (tex-roundtrip notes).
    material.fog = false;
    material.depthWrite = true;
    material.depthTest = true;
    material.side = side;
    material.depthFunc = depthFunc;
    return material;
  };
  const entryMaterial = makeMaterial(THREE.FrontSide, THREE.LessEqualDepth);
  const exitMaterial = makeMaterial(THREE.BackSide, THREE.GreaterDepth);

  const entryMesh = new THREE.InstancedMesh(geo, entryMaterial, maxInstances);
  const exitMesh = new THREE.InstancedMesh(geo, exitMaterial, maxInstances);
  for (const m of [entryMesh, exitMesh]) {
    m.frustumCulled = false;
    m.count = 0;
  }

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
      entryMesh.setMatrixAt(i, m);
      exitMesh.setMatrixAt(i, m);
    }
    entryMesh.count = count;
    exitMesh.count = count;
    entryMesh.instanceMatrix.needsUpdate = true;
    exitMesh.instanceMatrix.needsUpdate = true;
  }

  update([]);

  return {
    entryObject: entryMesh,
    exitObject: exitMesh,
    update,
    get instanceCount() { return count; },
    // An overflowed hull is NOT a slightly worse hull — the instances that did
    // not fit leave uncovered flesh, and uncovered flesh renders as a hole.
    // The consumer must fall back to the unbounded march when this is true.
    get overflowed() { return overflowed; },
    dispose() {
      geo.dispose();
      entryMaterial.dispose();
      exitMaterial.dispose();
      entryMesh.dispose();
      exitMesh.dispose();
    },
  };
}
