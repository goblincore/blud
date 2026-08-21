// src/lab/sdf-zombie/validate.ts
import type { ClusterInfo, Primitive, Vec3 } from './types';
import type { Quat } from './vec';
import { add, cross, dot, len, lerp, normalize, qMul, qNormalize, qRotate, scale as vscale, sub } from './vec';

/**
 * Shader array ceilings. THE canonical declaration — `march.glsl.ts` imports
 * these and bakes them into the GLSL, so the CPU field and the GPU field
 * cannot drift apart. They were separately declared in both files until
 * 2026-08-15; if they disagree the shader reads past the uniform array.
 *
 * 128 is sized for a CAST, not for the one zombie. It was 48 — the 21-primitive
 * body plus a ~13-primitive face with headroom — which is a fine ceiling right
 * up until you try to author a second character (see `P8`, the SDF character
 * language). Raising it is close to free on the shipping WebGPU path: prims
 * ride a data texture there (`zombie-gpu.ts` allocates MAX_PRIMS x DATA_ROWS
 * RGBA-float, so 128 costs ~20 KiB against 48's ~7.7 KiB), and the WGSL folds
 * break out on the live prim count rather than looping the full width.
 *
 * The only thing this cost anything was the WebGL twin, which declares three
 * `uniform vec4[MAX_PRIMS]` arrays and so grows three vec4 per added prim. That
 * used to be the reason not to raise this: the GLSL shader already sat near 300
 * vec4 against a GLES 3.0 guaranteed minimum of 224, and 128 puts it near 540.
 * It is NOT a reason any more — Blud is WebGPU-only (`X1.11`), the GLSL twin is
 * unsupported reference kept until it is deleted, and it still compiles on the
 * development machine (Apple M3 reports MAX_FRAGMENT_UNIFORM_VECTORS = 1024)
 * for as long as it survives. Do not let it constrain the shipping path.
 */
export const MAX_PRIMS = 128;
export const MAX_CLUSTERS = 6;

/**
 * Per-cluster primitive ceiling — the REAL shader bound, and the one that used
 * to go unchecked.
 *
 * `march.wgsl.ts` folds a cluster with a fixed `for (var i = 0; i < 64)` that
 * breaks out on the cluster's live count. So a cluster carrying more than 64
 * primitives does not error: the shader silently stops folding at 64 and the
 * surface quietly loses geometry. Nothing validated this before — MAX_PRIMS
 * bounded the TOTAL, never a single cluster, and at 48 total the case was
 * unreachable. Raising MAX_PRIMS to 128 makes it reachable, so it is checked.
 *
 * Keep this equal to the literal in march.wgsl.ts's cluster loops; the WGSL is
 * a template string, so `validate.test.ts` asserts the literal is present
 * rather than trusting them to stay in step.
 */
export const MAX_CLUSTER_PRIMS = 64;

export interface ValidateOpts {
  silhouetteNoiseAmp: number;
  stepMultiplier: number;
}

interface Body { prims: Primitive[]; clusters: ClusterInfo[] }

/** Distance from p to one primitive, matching the shader's ellipsoid capsule. */
export function sdPrimitive(p: Vec3, prim: Primitive): number {
  let qv: Vec3 = p;
  let av = prim.a;
  let bv = prim.b;
  // Per-prim orientation, the exact CPU mirror of sdPrimO in march.wgsl.ts:
  // conjugate rotation about the prim midpoint BEFORE the scale-divide, so a
  // rig-posed face ellipsoid's squash turns with the head. The WGSL hoists
  // the choice between sdPrim and sdPrimO to a cluster flag purely as a
  // texture-fetch optimisation — sdPrimO on an identity quat runs sdPrim's
  // exact op sequence, so this per-prim branch is bit-identical to both.
  const o = prim.orient;
  if (o && Math.abs(1 - o[3]) > 1e-6) {
    const mid = vscale(add(prim.a, prim.b), 0.5);
    const u: Vec3 = [-o[0], -o[1], -o[2]]; // conjugate: negate the vector part
    const w = o[3];
    const rot = (x: Vec3): Vec3 => {
      const v = sub(x, mid);
      const t = vscale(cross(u, v), 2);
      return add(mid, add(v, add(vscale(t, w), cross(u, t))));
    };
    qv = rot(qv);
    av = rot(av);
    bv = rot(bv);
  }
  const inv: Vec3 = [1 / prim.scale[0], 1 / prim.scale[1], 1 / prim.scale[2]];
  const q: Vec3 = [qv[0] * inv[0], qv[1] * inv[1], qv[2] * inv[2]];
  const a: Vec3 = [av[0] * inv[0], av[1] * inv[1], av[2] * inv[2]];
  const b: Vec3 = [bv[0] * inv[0], bv[1] * inv[1], bv[2] * inv[2]];
  const ab = sub(b, a), ap = sub(q, a);
  const abLen2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = abLen2 === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / abLen2));
  const closest = add(a, vscale(ab, t));
  const minScale = Math.min(prim.scale[0], prim.scale[1], prim.scale[2]);
  if (prim.radiusB === undefined || prim.radiusB === prim.radius)
    return (len(sub(q, closest)) - prim.radius) * minScale;
  return sdRoundCone(q, a, b, prim.radius, prim.radiusB) * minScale;
}

/**
 * Exact SDF of a round cone — a capsule whose radius runs from `r1` at `a` to
 * `r2` at `b`. iq's construction; must match sdRoundConeW in march.wgsl.ts.
 *
 * Reached only when the primitive actually tapers. An untapered prim keeps the
 * plain capsule branch above, which matters for more than speed: with
 * `r1 === r2` this formula is mathematically identical but NOT bit-identical,
 * and `characters/zombie-blob.test.ts` pins the shipped zombie against
 * `makeZombie()` to 0.1 mm. Routing every existing primitive through a new
 * expression to gain nothing is how a "no-op refactor" moves a whole cast.
 *
 * The value of the taper is the degenerate case the capsule cannot express:
 * `r2 = 0` is a TRUE POINT. Smooth-min rounds every tip it touches, so before
 * this the sharpest thing authorable was a small sphere.
 */
function sdRoundCone(p: Vec3, a: Vec3, b: Vec3, r1: number, r2: number): number {
  const ba = sub(b, a);
  const l2 = ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  // Degenerate: the two ends coincide, so there is no axis to taper along and
  // the shape is just the larger sphere. Guarding here rather than trusting the
  // divisions below, which would produce NaN and poison the whole fold.
  if (l2 < 1e-12) return len(sub(p, a)) - Math.max(r1, r2);
  const il2 = 1 / l2;
  const pa = sub(p, a);
  const y = pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2];
  const z = y - l2;
  const x: Vec3 = [pa[0] * l2 - ba[0] * y, pa[1] * l2 - ba[1] * y, pa[2] * l2 - ba[2] * y];
  const x2 = x[0] ** 2 + x[1] ** 2 + x[2] ** 2;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

/** Quadratic polynomial smooth-min — must match the shader exactly. */
export function smin(a: number, b: number, k: number): number {
  const kk = k * 4;
  if (kk <= 0) return Math.min(a, b);
  const h = Math.max(kk - Math.abs(a - b), 0) / kk;
  return Math.min(a, b) - h * h * kk * 0.25;
}

/**
 * Chamfer union — a flat 45-degree bevel where `smin` gives a fillet.
 *
 * The only fold available before this was the quadratic smooth-min, with
 * `blendK: 0` (a hard boolean seam) as the sole alternative. That left nothing
 * between "smeared" and "cut": a plate lip, a brow ridge or a jaw line either
 * dissolved into its neighbour or met it at a raw intersection. A chamfer
 * keeps a CREASE — two flats meeting at an edge — which is what reads as
 * carved rather than melted.
 *
 * Mercury's `fOpUnionChamfer`. `k * 4` matches `smin`'s width convention so
 * the same authored `blend=` means a comparable reach in either profile, and
 * `k <= 0` degenerates to a plain `min` exactly as `smin` does.
 */
export function sminChamfer(a: number, b: number, k: number): number {
  const kk = k * 4;
  if (kk <= 0) return Math.min(a, b);
  return Math.min(Math.min(a, b), (a - kk + b) * Math.SQRT1_2);
}

/**
 * Carpenter's groove — cuts a channel of width `rb` and depth `ra` into
 * surface `a`, along the line where cutting surface `b` crosses it.
 *
 * Mercury's `fOpGroove`. This is NOT a blend profile and could not be one: a
 * blend combines two solids, and this removes material from one along the
 * OTHER's zero-set, so it belongs in the carve pass with `smax`.
 *
 * What it buys is the class of feature that is a LINE rather than a lump. A
 * mouth seam, a panel gap, a nostril slit, a scar. Before this the only way to
 * cut a line into flesh was to subtract a long thin solid, which needs its own
 * primitive placed along the whole feature and rounds off at both ends — the
 * goblin's lip crease was faked with two chamfered lip prims creased against
 * each other, which works only while both lips exist and are touching.
 *
 * `rb - abs(b)` is positive only within `rb` of the cutting surface, so the
 * channel is confined to a band; `min(a + ra, ...)` bounds how deep it can go.
 * Must match sdGroove in march.wgsl.ts.
 */
export function sdGroove(a: number, b: number, ra: number, rb: number): number {
  const inBand = rb - Math.abs(b);
  // GATED ON THE BAND, which hg_sdf's original is not — it is
  // `max(a, min(a + ra, rb - abs(b)))` unconditionally. That form assumes |b|
  // grows faster than |a|, which holds for the surface evaluation a renderer
  // does and fails deep inside a body: with `a` at -0.2 and the cutting
  // surface 0.18 away, `rb - abs(b)` is -0.174, which is GREATER than
  // `a + ra`, so the min picks `a + ra` and the whole interior is lifted by
  // the groove's depth.
  //
  // Invisible in a pure renderer, because only the zero-crossing is ever
  // read. Not invisible here: this same field backs `clearOf`, `daylightOf`,
  // `fusedOf`, validateBody's connectivity probe and click-to-shoot, all of
  // which read INTERIOR values, and a systematic few-millimetre shift moves
  // every one of them. Returning `a` untouched outside the channel is both
  // correct and what the operator means.
  if (inBand <= 0) return a;
  return Math.max(a, Math.min(a + ra, inBand));
}

/** Smooth subtraction. Must match the shader's smax exactly. */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/**
 * Field value over all live clusters, in fixed fold order.
 *
 * Two passes, and the order is load-bearing. Every ADDITIVE primitive folds
 * first, then every carve is subtracted from the assembled result. Carving
 * per-cluster instead would restructure a non-associative smooth-min fold and
 * change the surface everywhere, forcing a retune of every authored blendK.
 *
 * Mirrors mapBody + applyCarves in march.glsl.ts, and must stay in step: this
 * field also backs click-to-shoot raycasting, so drift means shots land where
 * the body isn't — or inside an eye socket. primScale.w semantics are shared
 * with the shaders: 0 add, 1 carve, 2 dead — dead prims skip BOTH passes.
 */
export function sdBody(p: Vec3, body: Body): number {
  let d = 1e9;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      if (prim.op === 'sub' || prim.op === 'groove' || prim.dead) continue;
      d = prim.blendProfile === 'chamfer'
        ? sminChamfer(d, sdPrimitive(p, prim), prim.blendK)
        : smin(d, sdPrimitive(p, prim), prim.blendK);
    }
  }
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      if (prim.dead) continue;
      if (prim.op === 'sub') {
        d = smax(d, -sdPrimitive(p, prim), prim.blendK);
      } else if (prim.op === 'groove') {
        d = sdGroove(d, sdPrimitive(p, prim), prim.grooveDepth ?? 0, prim.grooveWidth ?? 0);
      }
    }
  }
  return d;
}

export function validateBody(body: Body, opts: ValidateOpts): string[] {
  const errs: string[] = [];

  if (body.prims.length > MAX_PRIMS)
    errs.push(`primitive count ${body.prims.length} exceeds shader ceiling ${MAX_PRIMS}`);
  if (body.clusters.length > MAX_CLUSTERS)
    errs.push(`cluster count ${body.clusters.length} exceeds shader ceiling ${MAX_CLUSTERS}`);

  // Per-cluster ceiling. The total staying under MAX_PRIMS does not save a
  // single fat cluster: the WGSL folds each one with a fixed 64-iteration loop,
  // so prim 65 onward is dropped WITHOUT an error and the surface just loses
  // geometry. Report it as the count against the bound so the author knows
  // which way to move.
  for (const c of body.clusters)
    if (c.count > MAX_CLUSTER_PRIMS)
      errs.push(
        `cluster "${c.limb}" holds ${c.count} primitives, over the per-cluster ` +
        `shader ceiling ${MAX_CLUSTER_PRIMS} — the fold silently truncates`);

  // Fold order: each cluster must own a contiguous run of same-limb primitives.
  for (const c of body.clusters) {
    const slice = body.prims.slice(c.start, c.start + c.count);
    if (slice.length !== c.count || slice.some(p => p.limb !== c.limb))
      errs.push(`cluster "${c.limb}" is not contiguous — fold order is corrupt`);
  }

  // Bounding spheres must contain their SOLID primitives, or the cull drops
  // real surface. Carves are skipped for the same reason clusters.ts excludes
  // them from the fit: they carry no surface to lose. Dead prims likewise —
  // they are not in the field. The connectivity check below deliberately does
  // NOT skip carves — it runs on the carved field, so a socket deep enough to
  // detach the head from the neck is reported.
  for (const c of body.clusters)
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      if (prim.op === 'sub' || prim.dead) continue;
      const maxScale = Math.max(prim.scale[0], prim.scale[1], prim.scale[2]);
      for (const end of [prim.a, prim.b])
        if (len(sub(end, c.center)) + prim.radius * maxScale > c.radius + 1e-6)
          errs.push(`primitive in cluster "${c.limb}" escapes its bounding sphere`);
    }

  // Distance displacement breaks the Lipschitz bound; the step multiplier pays for it.
  if (opts.silhouetteNoiseAmp > (1 - opts.stepMultiplier) * 0.5)
    errs.push(
      `silhouette noise ${opts.silhouetteNoiseAmp} violates the Lipschitz bound at step ` +
      `multiplier ${opts.stepMultiplier} — lower the noise or the multiplier`);

  // Connectivity: every cluster must fuse into at least one other cluster.
  // Sample along the segment between cluster CORES; fused ⇒ the field stays
  // inside (negative) the whole way.
  //
  // Probe from a core rather than from `center`. A cluster centre is a BOUNDING
  // construct — the centroid of every endpoint — and nothing guarantees it lies
  // inside the flesh. A head carrying a dozen face primitives on the front of
  // the skull drags that centroid clean out of the cranium, at which point every
  // segment starts outside the surface and the whole body reports as
  // disconnected. The core below is inside its primitive by construction.
  if (body.clusters.length > 1)
    for (const c of body.clusters) {
      const from = clusterCore(body, c);
      if (from === null) continue; // nothing solid to probe from
      const fused = body.clusters.some(o => {
        if (o.id === c.id) return false;
        const to = clusterCore(body, o);
        return to !== null && segmentInside(from, to, body);
      });
      if (!fused) errs.push(`cluster "${c.limb}" is disconnected — not fused to any other cluster`);
    }

  return errs;
}

// ——— REST-SPACE NOISE ANCHOR, CPU mirror (motion-polish task 6) ————————————
// The WGSL samples every fbm in the DOMINANT prim's rest frame (restPoint in
// march.wgsl.ts) so the flesh texture rides every limb. These are the exact
// CPU twins, needed so tests can assert pose-invariance of the noise term
// without a GPU. The raycast field itself (sdBody above) never included the
// noise term and still does not — the noise warps SHADING normals and the
// silhouette shell only, so click-to-shoot is untouched by this change.

/** fract() as WGSL defines it: x - floor(x), per component. */
const fract3 = (p: Vec3): Vec3 => [p[0] - Math.floor(p[0]), p[1] - Math.floor(p[1]), p[2] - Math.floor(p[2])];

/** CPU twin of HASH13 in march.wgsl.ts. */
export function hash13(pIn: Vec3): number {
  let p = fract3(vscale(pIn, 0.1031));
  const s = dot(p, [p[1] + 33.33, p[2] + 33.33, p[0] + 33.33]);
  p = [p[0] + s, p[1] + s, p[2] + s];
  const v = (p[0] + p[1]) * p[2];
  return v - Math.floor(v);
}

/** CPU twin of NOISE3 in march.wgsl.ts. */
export function noise3(p: Vec3): number {
  const i: Vec3 = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
  let f = fract3(p);
  f = [f[0] * f[0] * (3 - 2 * f[0]), f[1] * f[1] * (3 - 2 * f[1]), f[2] * f[2] * (3 - 2 * f[2])];
  const h = (x: number, y: number, z: number) => hash13([i[0] + x, i[1] + y, i[2] + z]);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const n = mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), f[0]), mix(h(0, 1, 0), h(1, 1, 0), f[0]), f[1]),
    mix(mix(h(0, 0, 1), h(1, 0, 1), f[0]), mix(h(0, 1, 1), h(1, 1, 1), f[0]), f[1]),
    f[2]);
  return n * 2 - 1;
}

/** CPU twin of FBM in march.wgsl.ts. */
export function fbm(p: Vec3): number {
  return noise3(vscale(p, 4)) * 0.6 + noise3(vscale(p, 9)) * 0.3;
}

/**
 * Shortest-arc quat taking unit vector u onto v, in the cheap half-angle
 * form (cross, 1+d) — the SAME rotation vec.qFromTo's acos form produces,
 * computed the way qFromToV in march.wgsl.ts does so the mirror stays tight.
 */
function qFromToCheap(u: Vec3, v: Vec3): Quat {
  const d = Math.max(-1, Math.min(1, dot(u, v)));
  if (d >= 1 - 1e-6) return [0, 0, 0, 1];
  if (d <= -1 + 1e-6) {
    const seed: Vec3 = Math.abs(u[0]) >= 0.9 ? [0, 1, 0] : [1, 0, 0];
    const c = normalize(cross(u, seed));
    return [c[0], c[1], c[2], 0];
  }
  const c = cross(u, v);
  return qNormalize([c[0], c[1], c[2], 1 + d]);
}

/**
 * CPU twin of restPoint in march.wgsl.ts: maps a world point into the
 * DOMINANT primitive's rest frame — the additive prim whose own sdPrimitive
 * is smallest at p (the argmin the WGSL fold tracks), then the rigid
 * transform between the posed and rest capsule frames (midpoint translation,
 * shortest-arc axis swing composed over the orient conjugate). `rest` is the
 * same body in its authored rest pose; omitted, the posed prims double as
 * rest (never-rigged bodies). Returns p unchanged when no live additive prim
 * exists — the WGSL falls back to the noiseLocal anchor there, which at zero
 * root shift is also p.
 *
 * ROLL about the capsule axis is deliberately unresolved (shortest arc picks
 * any roll) — the noise is statistical, so a consistent arbitrary roll reads
 * as the same flesh. The CPU argmin runs WITHOUT the shader's cluster-bounds
 * cull; a culled cluster can only hold prims farther than the fold's margin,
 * so the two agree except in cases that resolve to a neighbouring prim's
 * frame — the accepted seam behaviour.
 */
export function restSpacePoint(p: Vec3, body: Body, rest?: Body): Vec3 {
  let best = Infinity;
  let bestIdx = -1;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (let i = c.start; i < c.start + c.count; i++) {
      const prim = body.prims[i]!;
      if (prim.op === 'sub' || prim.dead) continue;
      const sd = sdPrimitive(p, prim);
      if (sd < best) { best = sd; bestIdx = i; }
    }
  }
  if (bestIdx < 0) return p;
  const rp = (rest ?? body).prims[bestIdx];
  // restA.w <= 0 is the WGSL's 'unwritten rest row' sentinel; a real prim
  // always has radius > 0.
  if (!rp || rp.radius <= 0) return p;
  const prim = body.prims[bestIdx]!;
  const midP = vscale(add(prim.a, prim.b), 0.5);
  const midR = vscale(add(rp.a, rp.b), 0.5);
  let q: Quat = [0, 0, 0, 1];
  const O = prim.orient;
  if (O && Math.abs(1 - O[3]) > 1e-6) q = [-O[0], -O[1], -O[2], O[3]];
  const axisP = sub(prim.b, prim.a);
  const axisR = sub(rp.b, rp.a);
  const lenP = len(axisP);
  const lenR = len(axisR);
  if (lenP > 1e-6 && lenR > 1e-6) {
    // Swing AFTER the orient frame: qMul(swing, q) applies q first.
    q = qMul(qFromToCheap(qRotate(q, vscale(axisP, 1 / lenP)), vscale(axisR, 1 / lenR)), q);
  }
  return add(midR, qRotate(q, sub(p, midP)));
}

/**
 * The noise term exactly as mapBody evaluates it: fbm at the rest-space
 * anchor scaled by 3. Pose-invariance of THIS value is the whole feature —
 * the same material point must read the same noise in every pose.
 */
export function surfaceNoise(p: Vec3, body: Body, rest?: Body): number {
  return fbm(vscale(restSpacePoint(p, body, rest), 3));
}

/**
 * A point guaranteed to be inside a cluster's flesh: the midpoint of its
 * fattest solid primitive, which sits `radius * minScale` deep inside that
 * primitive's own surface and therefore inside the union.
 *
 * Exported for `blob-checks.ts`'s `fused` check, which needs exactly this
 * "a point guaranteed inside" concept for its own segment probe and would
 * otherwise have to re-derive it — this is the one place that reasoning is
 * allowed to live. `body` only needs `prims`/`clusters`, so a `BuiltBody` or
 * any narrower same-shaped object works.
 */
export function clusterCore(body: Body, c: ClusterInfo): Vec3 | null {
  let best: Primitive | null = null;
  let bestDepth = -Infinity;
  for (const p of body.prims.slice(c.start, c.start + c.count)) {
    if (p.op === 'sub' || p.dead) continue;
    const depth = p.radius * Math.min(p.scale[0], p.scale[1], p.scale[2]);
    if (depth > bestDepth) { bestDepth = depth; best = p; }
  }
  return best === null ? null : lerp(best.a, best.b, 0.5);
}

function segmentInside(from: Vec3, to: Vec3, body: Body): boolean {
  const STEPS = 24;
  for (let i = 0; i <= STEPS; i++)
    if (sdBody(lerp(from, to, i / STEPS), body) > 0) return false;
  return true;
}
