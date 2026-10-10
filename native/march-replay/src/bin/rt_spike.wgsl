// NATIVE-RENDERER SPIKE (ray tracing): a clean-room sphere tracer over the
// game's primitives, built four ways from this one file. rt_spike.rs prepends
// `const MODE` (and `enable wgpu_ray_query;` plus the TLAS binding for mode 2).
//
//   MODE 0  cull     every step folds the whole body, skipping bound groups
//                    that are too far to matter — the game's approach.
//   MODE 1  softmask per ray, slab-test every primitive's box in the shader,
//                    then fold only the primitives the ray can touch.
//   MODE 2  rtmask   the same per-ray primitive list, found by a hardware ray
//                    query over a BVH of the primitive boxes.
//   MODE 3  cullspan MODE 0's field, but marched only between the entry and
//                    exit of the boxes the ray crosses (what the game's shell
//                    hull already gives it). Separates "start close" from
//                    "fold fewer prims".
//
// The field is the plain fold of validate.ts: ellipsoid capsules and round
// cones, per-prim orientation, ordered smin/chamfer. No wounds, carves,
// shells, strands, noise or lighting model.

struct U {
  camPos: vec4f,
  camRight: vec4f,
  camUp: vec4f,
  camFwd: vec4f,   // w = tan(fovY / 2)
  res: vec4f,      // width, height, body count, prim count
  bound: vec4f,    // body bound sphere: local centre, radius
  cfg: vec4f,      // 4 * max blendK, group count, max steps, -
}
@group(0) @binding(0) var<uniform> u: U;
// six rows a prim: a|radius, b|radiusB, 1/scale|minScale, orient, boxMin|blendK, boxMax|chamfer
@group(0) @binding(1) var<storage, read> P: array<vec4f>;
// one row a body: world offset
@group(0) @binding(2) var<storage, read> B: array<vec4f>;
// two rows a bound group: centre|radius, first prim|count|worst minScale/maxScale
@group(0) @binding(3) var<storage, read> G: array<vec4f>;

var<private> gSteps: f32 = 0.0;
var<private> gEvals: f32 = 0.0;

fn qrot(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

fn sdRoundCone(p: vec3f, a: vec3f, b: vec3f, r1: f32, r2: f32) -> f32 {
  let ba = b - a;
  let l2 = dot(ba, ba);
  let rr = r1 - r2;
  let a2 = l2 - rr * rr;
  let il2 = 1.0 / l2;
  let pa = p - a;
  let y = dot(pa, ba);
  let z = y - l2;
  let w = pa * l2 - ba * y;
  let x2 = dot(w, w);
  let y2 = y * y * l2;
  let z2 = z * z * l2;
  let k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) { return sqrt(x2 + z2) * il2 - r2; }
  if (sign(y) * a2 * y2 < k) { return sqrt(x2 + y2) * il2 - r1; }
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

fn sdPrim(p: vec3f, i: u32) -> f32 {
  let r0 = P[i * 6u];
  let r1 = P[i * 6u + 1u];
  let r2 = P[i * 6u + 2u];
  let o = P[i * 6u + 3u];
  var q = p;
  var a = r0.xyz;
  var b = r1.xyz;
  if (abs(1.0 - o.w) > 1e-6) {
    let mid = (a + b) * 0.5;
    let c = vec4f(-o.xyz, o.w);
    q = mid + qrot(c, q - mid);
    a = mid + qrot(c, a - mid);
    b = mid + qrot(c, b - mid);
  }
  q *= r2.xyz; a *= r2.xyz; b *= r2.xyz;
  let ab = b - a;
  let l2 = dot(ab, ab);
  gEvals += 1.0;
  if (l2 == 0.0 || r0.w == r1.w) {
    var t = 0.0;
    if (l2 > 0.0) { t = clamp(dot(q - a, ab) / l2, 0.0, 1.0); }
    return (length(q - (a + ab * t)) - r0.w) * r2.w;
  }
  return sdRoundCone(q, a, b, r0.w, r1.w) * r2.w;
}

fn blend(d: f32, x: f32, i: u32) -> f32 {
  let kk = P[i * 6u + 4u].w * 4.0;
  if (kk <= 0.0) { return min(d, x); }
  if (P[i * 6u + 5u].w > 0.5) { return min(min(d, x), (d - kk + x) * 0.70710678); }
  let h = max(kk - abs(d - x), 0.0) / kk;
  return min(d, x) - h * h * kk * 0.25;
}

// MODE 0: the whole body, minus bound groups too far to change the answer.
// The running distance only falls through the fold, so a group whose nearest
// possible point is past d + 4k cannot blend with anything.
fn fieldCull(p: vec3f) -> f32 {
  var d = 1e9;
  let groups = u32(u.cfg.y);
  for (var g = 0u; g < groups; g++) {
    let s = G[g * 2u];
    let r = G[g * 2u + 1u];
    if ((length(p - s.xyz) - s.w) * r.z > d + u.cfg.x) { continue; }
    let first = u32(r.x);
    for (var i = first; i < first + u32(r.y); i++) { d = blend(d, sdPrim(p, i), i); }
  }
  return d;
}

// MODES 1 and 2: only the primitives in the ray's mask, in fold order.
fn fieldMask(p: vec3f, m0: u32, m1: u32) -> f32 {
  var d = 1e9;
  var m = m0;
  while (m != 0u) {
    let i = countTrailingZeros(m);
    m &= m - 1u;
    d = blend(d, sdPrim(p, i), i);
  }
  m = m1;
  while (m != 0u) {
    let i = countTrailingZeros(m) + 32u;
    m &= m - 1u;
    d = blend(d, sdPrim(p, i), i);
  }
  return d;
}

fn field(p: vec3f, m0: u32, m1: u32) -> f32 {
  if (MODE == 0u || MODE == 3u) { return fieldCull(p); }
  return fieldMask(p, m0, m1);
}

fn march(ro: vec3f, rd: vec3f, t0: f32, t1: f32, m0: u32, m1: u32) -> f32 {
  var t = t0;
  let steps = i32(u.cfg.z);
  for (var s = 0; s < steps; s++) {
    let d = field(ro + rd * t, m0, m1);
    gSteps += 1.0;
    if (d < 0.0004 * max(t, 0.5)) { return t; }
    t += d;
    if (t > t1) { break; }
  }
  return -1.0;
}

// Ray against prim i's box (already inflated). x = entry, y = exit; a miss has x > y.
fn slab(ro: vec3f, inv: vec3f, i: u32) -> vec2f {
  let lo = (P[i * 6u + 4u].xyz - ro) * inv;
  let hi = (P[i * 6u + 5u].xyz - ro) * inv;
  let a = min(lo, hi);
  let b = max(lo, hi);
  return vec2f(max(max(a.x, a.y), max(a.z, 0.0)), min(min(b.x, b.y), b.z));
}

// Entry and exit of the masked boxes along the ray.
fn maskSpan(ro: vec3f, inv: vec3f, m0: u32, m1: u32) -> vec2f {
  var span = vec2f(1e9, -1e9);
  var m = m0;
  while (m != 0u) {
    let i = countTrailingZeros(m);
    m &= m - 1u;
    let s = slab(ro, inv, i);
    span = vec2f(min(span.x, s.x), max(span.y, s.y));
  }
  m = m1;
  while (m != 0u) {
    let i = countTrailingZeros(m) + 32u;
    m &= m - 1u;
    let s = slab(ro, inv, i);
    span = vec2f(min(span.x, s.x), max(span.y, s.y));
  }
  return span;
}

struct Hit { t: f32, body: u32, m0: u32, m1: u32 }

fn tryBody(best: Hit, body: u32, rd: vec3f, m0: u32, m1: u32, span: vec2f) -> Hit {
  if (span.x > span.y || span.x > best.t) { return best; }
  let ro = u.camPos.xyz - B[body].xyz;
  let t = march(ro, rd, span.x, min(span.y, best.t), m0, m1);
  if (t > 0.0 && t < best.t) { return Hit(t, body, m0, m1); }
  return best;
}

struct Out {
  @location(0) color: vec4f,
  @location(1) stats: vec4f,
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) frag: vec4f) -> Out {
  let ndc = frag.xy / u.res.xy * 2.0 - 1.0;
  let tanH = u.camFwd.w;
  let rd = normalize(u.camFwd.xyz + u.camRight.xyz * ndc.x * tanH * u.res.x / u.res.y - u.camUp.xyz * ndc.y * tanH);
  let inv = 1.0 / rd;
  let bodies = u32(u.res.z);
  let prims = u32(u.res.w);
  var best = Hit(1e9, 0u, 0u, 0u);
  var candidates = 0.0;
  var overflow = 0.0;

  if (MODE == 2u) {
    // One traversal lists every primitive box the ray crosses, per body.
    var ids: array<u32, 8>;
    var m0s: array<u32, 8>;
    var m1s: array<u32, 8>;
    var n = 0u;
    RT_COLLECT
    for (var j = 0u; j < n; j++) {
      let ro = u.camPos.xyz - B[ids[j]].xyz;
      best = tryBody(best, ids[j], rd, m0s[j], m1s[j], maskSpan(ro, inv, m0s[j], m1s[j]));
    }
  } else {
    for (var b = 0u; b < bodies; b++) {
      let ro = u.camPos.xyz - B[b].xyz;
      let oc = ro - u.bound.xyz;
      let h = dot(oc, rd);
      let disc = h * h - (dot(oc, oc) - u.bound.w * u.bound.w);
      if (disc < 0.0) { continue; }
      let sq = sqrt(disc);
      var span = vec2f(max(-h - sq, 0.0), -h + sq);
      var m0 = 0u;
      var m1 = 0u;
      if (MODE == 1u || MODE == 3u) {
        span = vec2f(1e9, -1e9);
        for (var i = 0u; i < prims; i++) {
          let s = slab(ro, inv, i);
          if (s.x > s.y) { continue; }
          if (i < 32u) { m0 |= 1u << i; } else { m1 |= 1u << (i - 32u); }
          span = vec2f(min(span.x, s.x), max(span.y, s.y));
          candidates += 1.0;
        }
      }
      best = tryBody(best, b, rd, m0, m1, span);
    }
  }

  var out: Out;
  out.color = vec4f(0.02, 0.02, 0.03, 0.0);
  if (best.t < 1e8) {
    let ro = u.camPos.xyz - B[best.body].xyz;
    let p = ro + rd * best.t;
    let e = vec2f(1.0, -1.0) * 0.001;
    let n = normalize(
      e.xyy * field(p + e.xyy, best.m0, best.m1) + e.yyx * field(p + e.yyx, best.m0, best.m1)
      + e.yxy * field(p + e.yxy, best.m0, best.m1) + e.xxx * field(p + e.xxx, best.m0, best.m1));
    let l = max(dot(n, normalize(vec3f(0.4, 0.8, 0.5))), 0.0);
    out.color = vec4f(vec3f(0.55, 0.12, 0.10) * (0.15 + 0.85 * l), best.t);
  }
  out.stats = vec4f(gSteps, gEvals, candidates, overflow);
  return out;
}
