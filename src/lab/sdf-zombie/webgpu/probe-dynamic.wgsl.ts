/**
 * `kProbeGather` + `probeDynamic` — the GPU twin of `../probe-dynamic.ts`.
 *
 * THE TWIN. Nothing here compiles WGSL in tests, so the per-ray maths is
 * property-tested over in `../probe-dynamic.ts` and these strings are pinned by
 * `probe-dynamic.wgsl.test.ts` (source text and the real wgslFn parser). Change
 * one, change both.
 *
 * THE SEAM. A compute pass runs `kProbeGather` over this frame's boxes (the
 * room's enclosure plus its furniture), body capsules (two per posed bone) and
 * point lights (the muzzle flash first), ONE THREAD PER (probe, ray) with each
 * probe's ray group folded by its lane 0. It writes the dynamic layer: three
 * vec4 of L1 radiance in the static packing plus one vec4 of scalar L1
 * visibility. `probeDynamic` is the march's read, a manual trilinear over that
 * storage buffer, returning `(radiance.rgb, visibility)`.
 *
 * ORDER. `kProbeGather` is declared first, as the wgslFn parse contract
 * requires; WGSL module-scope declarations may be used before they are defined,
 * so the structs and helpers follow. `probeDynamic` likewise leads its string.
 */

import {
  DYN_RAY_CAP,
  GOLDEN_ANGLE,
  LIGHT_FILL_REF_M,
  PROBE_GATHER_WORKGROUP,
  TWO_PI,
} from '../probe-dynamic';
import { PROBE_CAPSULE_GROUP_SIZE } from '../probe-capsule-groups';
import { SH_A0, SH_A1, SH_Y00, SH_Y1 } from '../probe-grid';

/**
 * ONE THREAD PER (probe, ray) — the R1 dispatch widening (2026-09-10).
 *
 * The pass used to run one thread per probe: 400 threads, i.e. ~7 workgroups
 * of 64, ~35% of one wave on an M3, two warps per core, no latency hiding. Its
 * cost measured near-perfectly LINEAR in the ray count, which is what says the
 * work is unshareable per-ray work executed serially inside each thread. Now a
 * workgroup of `PROBE_GATHER_WORKGROUP` threads covers `WG / tpp` WHOLE probes,
 * every thread runs ONE ray, and each probe's group is folded by its lane 0.
 * Same work, `tpp` times the parallelism.
 *
 * `tpp` (threads per probe, `gather.x`) is the next power of two at least the
 * ray count, clamped to [1, WG] — see `gatherThreadsPerProbe`. A power of two
 * so that a probe's ray group never straddles two workgroups, which is what
 * makes a workgroup-LOCAL reduction correct at any ray count. It is at least 1
 * when the ray count is 0, so the `?dynrays=0` control still dispatches one
 * thread per probe and writes the decayed record, exactly as the old pass did.
 *
 * THE REDUCTION is the whole difficulty, and Tint dictates its shape:
 *  - There is NO count guard in this kernel. `workgroupBarrier` may not sit in
 *    non-uniform control flow, and three emits its own
 *    `if (instanceIndex >= count) return;` ahead of the kernel whenever
 *    compute() is given a NUMERIC count — which is why the host dispatches with
 *    an explicit WORKGROUP-count array instead (probe-gather-compute.ts). The
 *    probe-count test here is therefore a FLAG: threads past the last probe do
 *    no ray work and contribute zeros, but they still reach the barrier.
 *  - The barrier is unconditional and at the function's top level.
 *  - The fold is SERIAL in ascending lane order, not a tree: exact at any `tpp`
 *    and it reproduces the old per-probe accumulation ORDER exactly. The terms
 *    are the same values, so the estimate is equivalent; only the compiler's
 *    freedom to contract a multiply-add into an FMA can differ in the last ulp.
 *
 * `cfg` = `(probeCount, raysPerProbe, frameSeed, blend)`, `gather.x` = tpp. The
 * three grid vec4s are exactly what the static evaluator binds (`min.xyz,
 * fall`, `invExtent.xyz, 0`, `(nx, ny, nz, 0)`). The new estimate is blended
 * into the previous frame's texels by `cfg.w` for stability.
 */
export const K_PROBE_GATHER = /* wgsl */ `fn kProbeGather(
  boxes: ptr<storage, array<vec4<f32>>, read>,
  capsules: ptr<storage, array<vec4<f32>>, read>,
  lights: ptr<storage, array<vec4<f32>>, read>,
  probeDyn: ptr<storage, array<vec4<f32>>, read_write>,
  cfg: vec4<f32>,
  gridMin: vec4<f32>,
  gridInvExtent: vec4<f32>,
  gridDims: vec4<f32>,
  gather: vec4<f32>,
  gi: u32
) -> void {
  let nRays = min(u32(cfg.y), ${DYN_RAY_CAP}u);
  let probeCount = u32(cfg.x);
  let tpp = max(1u, u32(gather.x));
  let probe = gi / tpp;
  let lane = gi % tpp;
  let valid = probe < probeCount;
  // This thread's slot in the workgroup's shared scratch. instanceIndex is the
  // linear invocation index (workgroupId * workgroupSize + localId; see
  // WGSLNodeBuilder _getWGSLComputeCode) and the dispatch is 1-D, so gi % WG is
  // the local invocation index.
  let lin = gi % ${PROBE_GATHER_WORKGROUP}u;
  // The group's base slot. tpp divides the workgroup size, so groupBase is the
  // same for every thread of a probe and the group is contiguous.
  let groupBase = (lin / tpp) * tpp;

  let nBoxes = u32((*boxes)[0].x);
  let nCaps = u32((*capsules)[0].x);
  let nLights = u32((*lights)[0].x);

  // THIS THREAD'S RAY, packed into the same four vec4s the old pass used for a
  // whole probe's accumulators, so the fold below adds the same terms in the
  // same order as the old serial r00 = r00 + radiance * SH_Y00 loop.
  // (No backticks in this string — one breaks the TypeScript parse; that trap
  // has been hit three times in this file's history, see the perf handoff.)
  var acc0 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var acc1 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var acc2 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var acc3 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var hits = 0u;

  if (valid && lane < nRays) {
    // Probe position, mirroring probePosition(): x fastest, then y, then z, and
    // a one-probe axis sits at the cell centre.
    let extent = vec3<f32>(1.0, 1.0, 1.0) / max(gridInvExtent.xyz, vec3<f32>(1e-9, 1e-9, 1e-9));
    let span = max(gridDims.xyz - vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(0.0, 0.0, 0.0));
    let nx = i32(gridDims.x);
    let ny = i32(gridDims.y);
    let gp = i32(probe);
    let ix = gp % nx;
    let iy = (gp / nx) % ny;
    let iz = gp / (nx * ny);
    var tp = vec3<f32>(0.5, 0.5, 0.5);
    if (span.x > 0.0) { tp.x = f32(ix) / span.x; }
    if (span.y > 0.0) { tp.y = f32(iy) / span.y; }
    if (span.z > 0.0) { tp.z = f32(iz) / span.z; }
    let origin = gridMin.xyz + extent * tp;

    let dir = kdFibonacci(lane, nRays, cfg.z);
    let bh = kdHitBox(origin, dir, boxes, false);
    // Bound the capsule sweep by the box hit already in hand: a capsule entered
    // beyond the box surface can never win the comparison below, so it is
    // retired on its bounding sphere (2026-09-10). Exact, and it is the common
    // case — the room enclosure usually ends the ray before any body does.
    let wallDist = select(1e30, bh.t, bh.hit);
    var bodyBlocks = false;
    if (gather.y > 0.0) {
      // Only visibility is consumed here, never the nearest point or normal.
      bodyBlocks = kdCapsuleBlocks(origin, dir, capsules, wallDist);
    } else {
      let ch = kdHitCapsule(origin, dir, capsules, wallDist);
      bodyBlocks = ch.hit && ch.t <= wallDist;
    }

    var radiance = vec3<f32>(0.0, 0.0, 0.0);
    var vis = 0.0;
    var hit = false;
    if (bodyBlocks) {
      // A body: occluded and dark. It still counts as a hit so the projection
      // divides by the same sample count as the CPU twin.
      hit = true;
      vis = 0.0;
    } else if (bh.hit) {
      hit = true;
      vis = 1.0;
      // Lift off the surface so the shadow ray cannot re-enter its own box.
      let o = bh.point + bh.normal * 1e-4;
      for (var l = 0u; l < nLights; l = l + 1u) {
        // vec4 index, not float offset: the count is element 0, light l is
        // 1 + 2l (packLights writes it at float 4 + 8l).
        let lb = 1u + l * 3u;
        let lp = (*lights)[lb].xyz;
        let intensity = (*lights)[lb].w;
        let color = (*lights)[lb + 1u].xyz;
        let cosOuter = (*lights)[lb + 1u].w;
        let axis = (*lights)[lb + 2u].xyz;
        let cosInner = (*lights)[lb + 2u].w;
        let dvec = lp - bh.point;
        let d2 = dot(dvec, dvec);
        if (d2 < 1e-12) { continue; }
        let d = sqrt(d2);
        let ld = dvec / d;
        let ndl = dot(bh.normal, ld);
        if (ndl <= 0.0) { continue; }
        if (gather.y <= 0.0 && kdShadowed(o, ld, d, capsules, boxes)) { continue; }
        // Spot cone, mirroring the analytic beam; a point light packs
        // cosOuter = -2 and takes cone = 1.
        var cone = 1.0;
        if (cosOuter > -1.5) {
          let c = dot(-ld, axis);
          let t = clamp((c - cosOuter) / max(cosInner - cosOuter, 1e-4), 0.0, 1.0);
          cone = t * t;
          if (cone <= 0.0) { continue; }
        }
        // Reject outside-beam samples BEFORE tracing their shadows.
        if (gather.y > 0.0 && kdShadowed(o, ld, d, capsules, boxes)) { continue; }
        // Hard point term plus the SOFT room-fill term (CPU twin:
        // probe-dynamic.ts LIGHT_FILL_REF_M). For a point light the third vec4's
        // .w carries the fill fraction instead of cosInner, which is why the
        // cone branch above tests cosOuter first. A detonation sets it so the
        // blast lights the ROOM rather than a disc of floor at the crater.
        let fill = select((*lights)[lb + 2u].w, 0.0, cosOuter > -1.5);
        let soft = select(fill / (1.0 + d2 / (${LIGHT_FILL_REF_M} * ${LIGHT_FILL_REF_M})), 0.0, fill > 0.0);
        radiance = radiance + color * (intensity * ndl * cone * (1.0 / d2 + soft));
      }
      radiance = radiance * bh.albedo;
    }

    if (hit) {
      let ym1 = ${SH_Y1} * dir.y;
      let y10 = ${SH_Y1} * dir.z;
      let y11 = ${SH_Y1} * dir.x;
      acc0 = vec4<f32>(radiance.x * ${SH_Y00}, radiance.y * ${SH_Y00}, radiance.z * ${SH_Y00}, radiance.x * ym1);
      acc1 = vec4<f32>(radiance.y * ym1, radiance.z * ym1, radiance.x * y10, radiance.y * y10);
      acc2 = vec4<f32>(radiance.z * y10, radiance.x * y11, radiance.y * y11, radiance.z * y11);
      acc3 = vec4<f32>(vis * ${SH_Y00}, vis * ym1, vis * y10, vis * y11);
      hits = 1u;
    }
  }

  // Hand this thread's contribution to the workgroup. EVERY thread writes here —
  // an idle lane or a thread past the last probe writes zeros — and every thread
  // reaches the barrier below, which is what keeps it in uniform control flow.
  // Nothing reads the scratch before the barrier.
  gProbeScratch[lin * 4u + 0u] = acc0;
  gProbeScratch[lin * 4u + 1u] = acc1;
  gProbeScratch[lin * 4u + 2u] = acc2;
  gProbeScratch[lin * 4u + 3u] = acc3;
  gProbeHit[lin] = hits;
  workgroupBarrier();

  // ONE thread per probe folds its group and writes the record: the old pass's
  // read-modify-write of the probe record must stay single-threaded (two writers
  // is a race that shows up as flicker, not as a compile error). Walking the
  // group in ascending slot order is the old accumulation order.
  if (lane == 0u && valid) {
    var s0 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    var s1 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    var s2 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    var s3 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    var nHit = 0u;
    for (var s = 0u; s < tpp; s = s + 1u) {
      let k = (groupBase + s) * 4u;
      s0 = s0 + gProbeScratch[k + 0u];
      s1 = s1 + gProbeScratch[k + 1u];
      s2 = s2 + gProbeScratch[k + 2u];
      s3 = s3 + gProbeScratch[k + 3u];
      nHit = nHit + gProbeHit[groupBase + s];
    }

    // projectL1's (4pi / N) weight, with N floored at 1 so an all-miss probe
    // writes zeros rather than a NaN.
    let w = (4.0 * ${SH_A0}) / f32(max(1u, nHit));
    let new0 = s0 * w;
    let new1 = s1 * w;
    let new2 = s2 * w;
    let new3 = s3 * w;

    let base = probe * 4u;
    // AFTERGLOW. Radiance rises at cfg.w and FALLS at gridMin.w (a spare slot;
    // the fall rate, e.g. 0.12 = a ~0.3 s tail at 60 Hz). A muzzle flash lives
    // 0.14 s; blended symmetrically it was a two-frame flicker on a body. Rise
    // or fall is decided on the L00 luminance, and the whole radiance record
    // takes one rate so the lobes stay coherent. Visibility keeps cfg.w.
    let prev0 = (*probeDyn)[base + 0u];
    let lumNew = dot(new0.xyz, vec3<f32>(0.2126, 0.7152, 0.0722));
    let lumPrev = dot(prev0.xyz, vec3<f32>(0.2126, 0.7152, 0.0722));
    let rate = select(gridMin.w, cfg.w, lumNew > lumPrev);
    (*probeDyn)[base + 0u] = mix(prev0, new0, rate);
    (*probeDyn)[base + 1u] = mix((*probeDyn)[base + 1u], new1, rate);
    (*probeDyn)[base + 2u] = mix((*probeDyn)[base + 2u], new2, rate);
    (*probeDyn)[base + 3u] = mix((*probeDyn)[base + 3u], new3, cfg.w);
  }
}

struct KdBoxHit {
  hit: bool,
  t: f32,
  point: vec3<f32>,
  normal: vec3<f32>,
  albedo: vec3<f32>,
}

struct KdCapsuleHit {
  hit: bool,
  t: f32,
  point: vec3<f32>,
  normal: vec3<f32>,
}

/** Fibonacci direction i of n, rotated about +Y by seed * 2pi. */
fn kdFibonacci(i: u32, n: u32, seed: f32) -> vec3<f32> {
  let golden = ${GOLDEN_ANGLE};
  let fi = f32(i);
  let y = 1.0 - (fi + 0.5) * 2.0 / f32(n);
  let r = sqrt(max(0.0, 1.0 - y * y));
  let theta = golden * fi + seed * ${TWO_PI};
  return vec3<f32>(cos(theta) * r, y, sin(theta) * r);
}

/**
 * Nearest of every box along one ray. kind 0 is the enclosure (the ray EXITS
 * it, normal points into the room); kind 1 is an occluder (the ray ENTERS it,
 * normal points out toward the origin). With occludersOnly, the enclosure is
 * skipped for shadow rays: the room never shadows a light it contains.
 */
fn kdHitBox(
  origin: vec3<f32>,
  dir: vec3<f32>,
  boxes: ptr<storage, array<vec4<f32>>, read>,
  occludersOnly: bool
) -> KdBoxHit {
  var best = KdBoxHit(false, 1e30, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 0.0));
  let n = u32((*boxes)[0].x);
  for (var b = 0u; b < n; b = b + 1u) {
    let bb = 1u + b * 3u; // vec4 index; count is element 0
    let mn = (*boxes)[bb].xyz;
    let kind = (*boxes)[bb].w;
    let mx = (*boxes)[bb + 1u].xyz;
    let alb = (*boxes)[bb + 2u].xyz;
    if (occludersOnly && kind < 0.5) { continue; }

    if (kind < 0.5) {
      // Enclosure exit: the largest tFar over the slabs.
      var tExit = 1e30;
      var axis = 0;
      var side = 1.0;
      if (abs(dir.x) < 1e-12) {
        if (origin.x < mn.x || origin.x > mx.x) { continue; }
      } else {
        let t1 = (mn.x - origin.x) / dir.x;
        let t2 = (mx.x - origin.x) / dir.x;
        let tFar = max(t1, t2);
        if (tFar < tExit) { tExit = tFar; axis = 0; side = select(1.0, -1.0, t1 > t2); }
      }
      if (abs(dir.y) < 1e-12) {
        if (origin.y < mn.y || origin.y > mx.y) { continue; }
      } else {
        let t1 = (mn.y - origin.y) / dir.y;
        let t2 = (mx.y - origin.y) / dir.y;
        let tFar = max(t1, t2);
        if (tFar < tExit) { tExit = tFar; axis = 1; side = select(1.0, -1.0, t1 > t2); }
      }
      if (abs(dir.z) < 1e-12) {
        if (origin.z < mn.z || origin.z > mx.z) { continue; }
      } else {
        let t1 = (mn.z - origin.z) / dir.z;
        let t2 = (mx.z - origin.z) / dir.z;
        let tFar = max(t1, t2);
        if (tFar < tExit) { tExit = tFar; axis = 2; side = select(1.0, -1.0, t1 > t2); }
      }
      if (tExit <= 0.0 || tExit >= best.t) { continue; }
      var nrm = vec3<f32>(0.0, 0.0, 0.0);
      if (axis == 0) { nrm.x = -side; } else if (axis == 1) { nrm.y = -side; } else { nrm.z = -side; }
      best = KdBoxHit(true, tExit, origin + dir * tExit, nrm, alb);
    } else {
      // Occluder entry: the largest tNear over the slabs, inside [0, tExit].
      var tEnter = -1e30;
      var tExit = 1e30;
      var axis = 0;
      var side = -1.0;
      if (abs(dir.x) < 1e-12) {
        if (origin.x < mn.x || origin.x > mx.x) { continue; }
      } else {
        var tNear = (mn.x - origin.x) / dir.x;
        var tFar = (mx.x - origin.x) / dir.x;
        var sgn = -1.0;
        if (tNear > tFar) { let tmp = tNear; tNear = tFar; tFar = tmp; sgn = 1.0; }
        if (tNear > tEnter) { tEnter = tNear; axis = 0; side = sgn; }
        if (tFar < tExit) { tExit = tFar; }
      }
      if (abs(dir.y) < 1e-12) {
        if (origin.y < mn.y || origin.y > mx.y) { continue; }
      } else {
        var tNear = (mn.y - origin.y) / dir.y;
        var tFar = (mx.y - origin.y) / dir.y;
        var sgn = -1.0;
        if (tNear > tFar) { let tmp = tNear; tNear = tFar; tFar = tmp; sgn = 1.0; }
        if (tNear > tEnter) { tEnter = tNear; axis = 1; side = sgn; }
        if (tFar < tExit) { tExit = tFar; }
      }
      if (abs(dir.z) < 1e-12) {
        if (origin.z < mn.z || origin.z > mx.z) { continue; }
      } else {
        var tNear = (mn.z - origin.z) / dir.z;
        var tFar = (mx.z - origin.z) / dir.z;
        var sgn = -1.0;
        if (tNear > tFar) { let tmp = tNear; tNear = tFar; tFar = tmp; sgn = 1.0; }
        if (tNear > tEnter) { tEnter = tNear; axis = 2; side = sgn; }
        if (tFar < tExit) { tExit = tFar; }
      }
      if (tEnter > tExit || tExit <= 0.0 || tEnter < 0.0 || tEnter >= best.t) { continue; }
      var nrm = vec3<f32>(0.0, 0.0, 0.0);
      if (axis == 0) { nrm.x = side; } else if (axis == 1) { nrm.y = side; } else { nrm.z = side; }
      best = KdBoxHit(true, tEnter, origin + dir * tEnter, nrm, alb);
    }
  }
  return best;
}

/**
 * Nearest entry into any body capsule, or a miss. A ray that starts inside or
 * on a capsule ignores it: an occluder you are inside blocks nothing. The
 * cylinder quadratic is paired with both sphere caps; the nearest valid
 * candidate wins.
 */
fn kdHitCapsule(
  origin: vec3<f32>,
  dir: vec3<f32>,
  capsules: ptr<storage, array<vec4<f32>>, read>,
  tMax: f32
) -> KdCapsuleHit {
  var best = KdCapsuleHit(false, 1e30, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 0.0));
  let n = u32((*capsules)[0].x);
  for (var c = 0u; c < n; c = c + 1u) {
    let cb = 1u + c * 2u; // vec4 index; count is element 0
    let a = (*capsules)[cb].xyz;
    let r = (*capsules)[cb].w;
    let b = (*capsules)[cb + 1u].xyz;
    let ba = b - a;
    let pa = origin - a;
    let baba = dot(ba, ba);
    // BOUNDING-SPHERE REJECT FIRST (2026-09-10). The capsule is contained in
    // the sphere centred on the segment midpoint with radius |ba|/2 + r, so a
    // ray that misses that sphere CANNOT hit the capsule, and one whose sphere
    // exit is behind the origin cannot have a positive entry either. Both are
    // exact miss conditions for two dots and at most one sqrt, against the
    // full quadratic's three sqrts below. Rejecting on the sphere is sound
    // because t_capsule_entry >= t_sphere_entry, so tMax (a caller's running
    // best, or a light distance) retires any capsule it cannot beat.
    let mid = a + ba * 0.5;
    let radius = 0.5 * sqrt(baba) + r;
    let oc0 = origin - mid;
    let bq0 = dot(oc0, dir);
    let cq0 = dot(oc0, oc0) - radius * radius;
    let disc0 = bq0 * bq0 - cq0;
    if (disc0 < 0.0) { continue; }
    let sq0 = sqrt(disc0);
    if (sq0 - bq0 < 0.0) { continue; }        // whole sphere behind the origin
    if (-bq0 - sq0 > tMax) { continue; }      // entered only beyond the bound
    var s = 0.0;
    if (baba > 1e-18) { s = clamp(dot(pa, ba) / baba, 0.0, 1.0); }
    let closest = a + ba * s;
    if (dot(origin - closest, origin - closest) < r * r) { continue; }

    var bestT = 1e30;
    var bestPoint = vec3<f32>(0.0, 0.0, 0.0);
    var bestNormal = vec3<f32>(0.0, 0.0, 0.0);
    var found = false;

    if (baba > 1e-18) {
      let bard = dot(ba, dir);
      let baoa = dot(ba, pa);
      let rdoa = dot(dir, pa);
      let oaoa = dot(pa, pa);
      let qa = baba - bard * bard;
      let qb = baba * rdoa - baoa * bard;
      let qc = baba * oaoa - baoa * baoa - r * r * baba;
      if (qa > 1e-18) {
        let h = qb * qb - qa * qc;
        if (h >= 0.0) {
          let t = (-qb - sqrt(h)) / qa;
          let y = baoa + t * bard;
          if (t > 0.0 && t < tMax && y >= 0.0 && y <= baba) {
            let p = origin + dir * t;
            let sa = y / baba;
            bestT = t; bestPoint = p; bestNormal = normalize(p - (a + ba * sa)); found = true;
          }
        }
      }
    }

    {
      let oc = origin - a;
      let bq = dot(oc, dir);
      let cq = dot(oc, oc) - r * r;
      let disc = bq * bq - cq;
      if (disc >= 0.0) {
        let t = -bq - sqrt(disc);
        if (t > 0.0 && t < bestT && t < tMax) {
          let p = origin + dir * t;
          bestT = t; bestPoint = p; bestNormal = normalize(p - a); found = true;
        }
      }
    }
    {
      let oc = origin - b;
      let bq = dot(oc, dir);
      let cq = dot(oc, oc) - r * r;
      let disc = bq * bq - cq;
      if (disc >= 0.0) {
        let t = -bq - sqrt(disc);
        if (t > 0.0 && t < bestT && t < tMax) {
          let p = origin + dir * t;
          bestT = t; bestPoint = p; bestNormal = normalize(p - b); found = true;
        }
      }
    }

    if (found && bestT < best.t) {
      best = KdCapsuleHit(true, bestT, bestPoint, bestNormal);
    }
  }
  return best;
}

/**
 * ANY-HIT within dist — the shadow-ray question, and all it is (2026-09-10).
 *
 * kdHitCapsule answers "where is the nearest entry", so it must sweep every
 * capsule to prove none is nearer. A shadow ray does not care where: only
 * whether SOMETHING blocks before the light, so it returns on the first
 * blocker and retires the rest of the list. dist doubles as the bound, so
 * capsules entered beyond the light are rejected on the bounding sphere
 * without ever reaching the quadratic. Same entry semantics as kdHitCapsule
 * (a ray starting inside a capsule is not blocked by it), so the answer is
 * identical; only the work differs.
 *
 * THIS IS THE GATHER'S HOTTEST PATH: kdShadowed calls it once per light per
 * ray, so up to 8 times per ray.
 */
fn kdCapsuleBlocks(
  origin: vec3<f32>,
  dir: vec3<f32>,
  capsules: ptr<storage, array<vec4<f32>>, read>,
  dist: f32
) -> bool {
  let n = u32((*capsules)[0].x);
  let groups = u32((*capsules)[0].y);
  for (var c = 0u; c < n; c = c + 1u) {
    if (groups > 0u && c % ${PROBE_CAPSULE_GROUP_SIZE}u == 0u) {
      let sphere = (*capsules)[groups + c / ${PROBE_CAPSULE_GROUP_SIZE}u];
      let oc = origin - sphere.xyz;
      let bq = dot(oc, dir);
      let disc = bq * bq - (dot(oc, oc) - sphere.w * sphere.w);
      var skip = disc < 0.0;
      if (!skip) {
        let sq = sqrt(disc);
        skip = sq - bq < 0.0 || -bq - sq > dist;
      }
      if (skip) { c = c + ${PROBE_CAPSULE_GROUP_SIZE - 1}u; continue; }
    }
    let cb = 1u + c * 2u;
    let a = (*capsules)[cb].xyz;
    let r = (*capsules)[cb].w;
    let b = (*capsules)[cb + 1u].xyz;
    let ba = b - a;
    let pa = origin - a;
    let baba = dot(ba, ba);
    // Bounding-sphere reject, bounded by the light distance — see kdHitCapsule.
    let mid = a + ba * 0.5;
    let radius = 0.5 * sqrt(baba) + r;
    let oc0 = origin - mid;
    let bq0 = dot(oc0, dir);
    let cq0 = dot(oc0, oc0) - radius * radius;
    let disc0 = bq0 * bq0 - cq0;
    if (disc0 < 0.0) { continue; }
    let sq0 = sqrt(disc0);
    if (sq0 - bq0 < 0.0) { continue; }
    if (-bq0 - sq0 > dist) { continue; }
    var s = 0.0;
    if (baba > 1e-18) { s = clamp(dot(pa, ba) / baba, 0.0, 1.0); }
    let closest = a + ba * s;
    if (dot(origin - closest, origin - closest) < r * r) { continue; }

    if (baba > 1e-18) {
      let bard = dot(ba, dir);
      let baoa = dot(ba, pa);
      let rdoa = dot(dir, pa);
      let oaoa = dot(pa, pa);
      let qa = baba - bard * bard;
      let qb = baba * rdoa - baoa * bard;
      let qc = baba * oaoa - baoa * baoa - r * r * baba;
      if (qa > 1e-18) {
        let h = qb * qb - qa * qc;
        if (h >= 0.0) {
          let t = (-qb - sqrt(h)) / qa;
          let y = baoa + t * bard;
          if (t > 0.0 && t < dist && y >= 0.0 && y <= baba) { return true; }
        }
      }
    }
    {
      let oc = origin - a;
      let bq = dot(oc, dir);
      let cq = dot(oc, oc) - r * r;
      let disc = bq * bq - cq;
      if (disc >= 0.0) {
        let t = -bq - sqrt(disc);
        if (t > 0.0 && t < dist) { return true; }
      }
    }
    {
      let oc = origin - b;
      let bq = dot(oc, dir);
      let cq = dot(oc, oc) - r * r;
      let disc = bq * bq - cq;
      if (disc >= 0.0) {
        let t = -bq - sqrt(disc);
        if (t > 0.0 && t < dist) { return true; }
      }
    }
  }
  return false;
}

/** True when a body capsule or a furniture box blocks the segment to a light. */
fn kdShadowed(
  origin: vec3<f32>,
  dir: vec3<f32>,
  dist: f32,
  capsules: ptr<storage, array<vec4<f32>>, read>,
  boxes: ptr<storage, array<vec4<f32>>, read>
) -> bool {
  // BOXES FIRST (2026-09-10). The result is a boolean OR of two independent
  // tests, so the order cannot change the answer — but the box list is at most
  // 16 entries against ~200 capsules (measured: ~45 capsules per body), so
  // testing the cheap list first and short-circuiting skips the capsule sweep
  // outright whenever a wall or a piece of furniture is in the way. In a
  // dungeon that is the common case, and this runs once per LIGHT per ray.
  let bh = kdHitBox(origin, dir, boxes, true);
  if (bh.hit && bh.t < dist) { return true; }
  if (kdCapsuleBlocks(origin, dir, capsules, dist)) { return true; }
  return false;
}

// THE WORKGROUP SCRATCH (module scope, emitted with the kernel's own source —
// see surface-nets.wgsl.ts, which declares its workgroup storage the same way
// and is the reason this shape is known to survive Tint). Four vec4 per thread,
// the same packing the kernel produces and the fold consumes, plus one hit flag
// per thread: Tint will not accept a workgroup variable declared inside a
// non-entry-point function, and three's workgroupArray node buys nothing here
// because we index it ourselves.
var<workgroup> gProbeScratch: array<vec4<f32>, ${PROBE_GATHER_WORKGROUP * 4}>;
var<workgroup> gProbeHit: array<u32, ${PROBE_GATHER_WORKGROUP}>;`;

/**
 * Manual trilinear over the 8 probes surrounding `p`, blending the four vec4
 * coefficients and only then evaluating. Mirrors `probeIrradiance` in
 * `probe-grid.wgsl.ts` exactly, but reads the dynamic storage layout: texels
 * 0-2 are the L1 radiance (static packing), texel 3 is scalar visibility.
 */
const PROBE_DYNAMIC_EVAL = /* wgsl */ `fn probeDynamic(
  p: vec3<f32>,
  n: vec3<f32>,
  probeDyn: ptr<storage, array<vec4<f32>>, read>,
  probeMin: vec3<f32>,
  probeInvExtent: vec3<f32>,
  probeDims: vec4<f32>
) -> vec4<f32> {
  // probeDims = (nx, ny, nz, 0); probeInvExtent = 1 / (max - min).
  let extent = vec3<f32>(1.0, 1.0, 1.0) / max(probeInvExtent, vec3<f32>(1e-9, 1e-9, 1e-9));
  let cp = clamp(p, probeMin, probeMin + extent);
  let dims = probeDims.xyz;
  let span = max(dims - vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(0.0, 0.0, 0.0));
  let f = (cp - probeMin) * probeInvExtent * span;
  let i0 = floor(f);
  let t = f - i0;
  let i1 = min(i0 + vec3<f32>(1.0, 1.0, 1.0), span);

  let nx = i32(probeDims.x);
  let ny = i32(probeDims.y);
  let ix0 = i32(i0.x);
  let iy0 = i32(i0.y);
  let iz0 = i32(i0.z);
  let ix1 = i32(i1.x);
  let iy1 = i32(i1.y);
  let iz1 = i32(i1.z);

  // x fastest, then y, then z — the CPU probe index.
  let idx000 = ix0 + nx * (iy0 + ny * iz0);
  let idx100 = ix1 + nx * (iy0 + ny * iz0);
  let idx010 = ix0 + nx * (iy1 + ny * iz0);
  let idx110 = ix1 + nx * (iy1 + ny * iz0);
  let idx001 = ix0 + nx * (iy0 + ny * iz1);
  let idx101 = ix1 + nx * (iy0 + ny * iz1);
  let idx011 = ix0 + nx * (iy1 + ny * iz1);
  let idx111 = ix1 + nx * (iy1 + ny * iz1);

  let w000 = (1.0 - t.x) * (1.0 - t.y) * (1.0 - t.z);
  let w100 = t.x * (1.0 - t.y) * (1.0 - t.z);
  let w010 = (1.0 - t.x) * t.y * (1.0 - t.z);
  let w110 = t.x * t.y * (1.0 - t.z);
  let w001 = (1.0 - t.x) * (1.0 - t.y) * t.z;
  let w101 = t.x * (1.0 - t.y) * t.z;
  let w011 = (1.0 - t.x) * t.y * t.z;
  let w111 = t.x * t.y * t.z;

  let s000 = probeDynLoad(probeDyn, idx000);
  let s100 = probeDynLoad(probeDyn, idx100);
  let s010 = probeDynLoad(probeDyn, idx010);
  let s110 = probeDynLoad(probeDyn, idx110);
  let s001 = probeDynLoad(probeDyn, idx001);
  let s101 = probeDynLoad(probeDyn, idx101);
  let s011 = probeDynLoad(probeDyn, idx011);
  let s111 = probeDynLoad(probeDyn, idx111);

  var c0 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var c1 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var c2 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var c3 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  c0 = c0 + s000[0] * w000; c1 = c1 + s000[1] * w000; c2 = c2 + s000[2] * w000; c3 = c3 + s000[3] * w000;
  c0 = c0 + s100[0] * w100; c1 = c1 + s100[1] * w100; c2 = c2 + s100[2] * w100; c3 = c3 + s100[3] * w100;
  c0 = c0 + s010[0] * w010; c1 = c1 + s010[1] * w010; c2 = c2 + s010[2] * w010; c3 = c3 + s010[3] * w010;
  c0 = c0 + s110[0] * w110; c1 = c1 + s110[1] * w110; c2 = c2 + s110[2] * w110; c3 = c3 + s110[3] * w110;
  c0 = c0 + s001[0] * w001; c1 = c1 + s001[1] * w001; c2 = c2 + s001[2] * w001; c3 = c3 + s001[3] * w001;
  c0 = c0 + s101[0] * w101; c1 = c1 + s101[1] * w101; c2 = c2 + s101[2] * w101; c3 = c3 + s101[3] * w101;
  c0 = c0 + s011[0] * w011; c1 = c1 + s011[1] * w011; c2 = c2 + s011[2] * w011; c3 = c3 + s011[3] * w011;
  c0 = c0 + s111[0] * w111; c1 = c1 + s111[1] * w111; c2 = c2 + s111[2] * w111; c3 = c3 + s111[3] * w111;

  let r = probeDynIrradianceL1(array<vec4<f32>, 3>(c0, c1, c2), n);
  let vis = probeDynVisibility(c3, n);
  return vec4<f32>(r, vis);
}`;

/** Four storage vec4s per probe. Matches the kernel's `base = gi * 4u`. */
const PROBE_DYN_LOAD = /* wgsl */ `fn probeDynLoad(
  probeDyn: ptr<storage, array<vec4<f32>>, read>,
  index: i32
) -> array<vec4<f32>, 4> {
  let base = u32(index) * 4u;
  return array<vec4<f32>, 4>(
    (*probeDyn)[base + 0u],
    (*probeDyn)[base + 1u],
    (*probeDyn)[base + 2u],
    (*probeDyn)[base + 3u]
  );
}`;

/**
 * The cosine-lobe convolution of the blended L1 radiance. Mirrors
 * `irradianceL1`: `A0 = pi`, `A1 = 2pi/3`, real-SH basis literals, negative
 * lobes clamped to 0.
 */
const PROBE_DYN_IRRADIANCE_L1 = /* wgsl */ `fn probeDynIrradianceL1(
  coeffs: array<vec4<f32>, 3>,
  n: vec3<f32>
) -> vec3<f32> {
  let l00 = vec3<f32>(coeffs[0].x, coeffs[0].y, coeffs[0].z);
  let l1m1 = vec3<f32>(coeffs[0].w, coeffs[1].x, coeffs[1].y);
  let l10 = vec3<f32>(coeffs[1].z, coeffs[1].w, coeffs[2].x);
  let l11 = vec3<f32>(coeffs[2].y, coeffs[2].z, coeffs[2].w);
  let e = ${SH_A0} * ${SH_Y00} * l00
    + ${SH_A1} * (${SH_Y1} * n.y * l1m1 + ${SH_Y1} * n.z * l10 + ${SH_Y1} * n.x * l11);
  return max(e, vec3<f32>(0.0, 0.0, 0.0));
}`;

/**
 * Scalar visibility from `(V00, V1-1, V10, V11)`: the same convolution as
 * radiance divided by pi, which is exactly 1 for an unoccluded probe, then
 * clamped to [0, 1] because an L1 reconstruction can overshoot.
 */
const PROBE_DYN_VISIBILITY = /* wgsl */ `fn probeDynVisibility(v: vec4<f32>, n: vec3<f32>) -> f32 {
  let e = ${SH_A0} * ${SH_Y00} * v.x
    + ${SH_A1} * (${SH_Y1} * n.y * v.y + ${SH_Y1} * n.z * v.z + ${SH_Y1} * n.x * v.w);
  return clamp(max(e, 0.0) / ${SH_A0}, 0.0, 1.0);
}`;

/** The full evaluator snippet: `probeDynamic` first, then its helpers. */
export const PROBE_DYNAMIC_WGSL =
  `${PROBE_DYNAMIC_EVAL}\n\n${PROBE_DYN_LOAD}\n\n${PROBE_DYN_IRRADIANCE_L1}\n\n${PROBE_DYN_VISIBILITY}`;
