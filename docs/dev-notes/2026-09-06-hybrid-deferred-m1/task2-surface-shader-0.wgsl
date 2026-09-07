// Three.js r185 - Node System

// global
diagnostic( off, derivative_uniformity );


// structs

struct OutputType {
	@location( 0 ) m0 : vec4<f32>,
	@location( 1 ) m1 : vec4<f32>,
	@location( 2 ) m2 : vec4<f32>,
	@location( 3 ) m3 : f32,
	@builtin( frag_depth ) depth : f32
};
var<private> output : OutputType;

// uniforms
@binding( 0 ) @group( 1 ) var nodeUniform4 : texture_2d<f32>;
@binding( 1 ) @group( 1 ) var nodeUniform5 : texture_3d<f32>;
@binding( 2 ) @group( 1 ) var nodeUniform6 : texture_2d<f32>;
@binding( 6 ) @group( 1 ) var nodeUniform69 : texture_depth_2d;
@binding( 7 ) @group( 1 ) var nodeUniform75 : texture_2d<f32>;

struct NodeBuffer_1240Struct {
	value : array< vec2<u32> >
};
@binding( 4 ) @group( 1 )
var<storage, read> NodeBuffer_1240 : NodeBuffer_1240Struct;

struct NodeBuffer_1241Struct {
	value : array< vec4<f32> >
};
@binding( 5 ) @group( 1 )
var<storage, read> NodeBuffer_1241 : NodeBuffer_1241Struct;

struct renderStruct {
	cameraProjectionMatrix : mat4x4<f32>,
	cameraViewMatrix : mat4x4<f32>,
	cameraPosition : vec3<f32>
};
@binding( 0 ) @group( 0 )
var<uniform> render : renderStruct;

struct objectStruct {
	nodeUniform3 : mat4x4<f32>,
	nodeUniform7 : vec4<f32>,
	nodeUniform8 : vec4<f32>,
	nodeUniform9 : vec3<f32>,
	nodeUniform10 : vec3<f32>,
	nodeUniform11 : vec4<f32>,
	nodeUniform12 : vec4<f32>,
	nodeUniform13 : vec4<f32>,
	nodeUniform14 : vec4<f32>,
	nodeUniform15 : vec3<f32>,
	nodeUniform16 : vec4<f32>,
	nodeUniform17 : vec4<f32>,
	nodeUniform18 : vec3<f32>,
	nodeUniform19 : vec3<f32>,
	nodeUniform20 : vec3<f32>,
	nodeUniform21 : vec3<f32>,
	nodeUniform22 : vec3<f32>,
	nodeUniform23 : vec2<f32>,
	nodeUniform24 : vec3<f32>,
	nodeUniform25 : vec3<f32>,
	nodeUniform26 : vec4<f32>,
	nodeUniform27 : vec4<f32>,
	nodeUniform28 : vec3<f32>,
	nodeUniform29 : vec4<f32>,
	nodeUniform30 : vec4<f32>,
	nodeUniform31 : vec4<f32>,
	nodeUniform32 : vec3<f32>,
	nodeUniform33 : vec3<f32>,
	nodeUniform34 : vec3<f32>,
	nodeUniform35 : vec3<f32>,
	nodeUniform36 : f32,
	nodeUniform37 : vec3<f32>,
	nodeUniform38 : f32,
	nodeUniform39 : vec4<f32>,
	nodeUniform40 : vec4<f32>,
	nodeUniform41 : vec4<f32>,
	nodeUniform42 : vec4<f32>,
	nodeUniform43 : vec4<f32>,
	nodeUniform44 : vec3<f32>,
	nodeUniform45 : vec3<f32>,
	nodeUniform46 : vec4<f32>,
	nodeUniform47 : vec3<f32>,
	nodeUniform48 : vec4<f32>,
	nodeUniform49 : vec2<f32>,
	nodeUniform50 : vec4<f32>,
	nodeUniform51 : vec3<f32>,
	nodeUniform52 : vec3<f32>,
	nodeUniform53 : vec3<f32>,
	nodeUniform54 : vec3<f32>,
	nodeUniform55 : vec3<f32>,
	nodeUniform56 : vec3<f32>,
	nodeUniform57 : vec3<f32>,
	nodeUniform58 : vec3<f32>,
	nodeUniform59 : vec2<f32>,
	nodeUniform60 : vec2<f32>,
	nodeUniform63 : vec4<f32>,
	nodeUniform64 : vec2<f32>,
	nodeUniform65 : vec4<f32>,
	nodeUniform66 : mat4x4<f32>,
	nodeUniform67 : vec3<f32>,
	nodeUniform68 : vec4<f32>,
	nodeUniform70 : mat4x4<f32>,
	nodeUniform71 : vec4<f32>,
	nodeUniform72 : vec3<f32>,
	nodeUniform73 : vec3<f32>,
	nodeUniform74 : vec4<f32>,
	nodeUniform76 : vec4<f32>,
	nodeUniform77 : vec4<f32>,
	nodeUniform78 : vec3<f32>,
	nodeUniform79 : f32
};
@binding( 3 ) @group( 1 )
var<uniform> object : objectStruct;

// vars
var<private> sdfTrace : vec4<f32>;
var<private> nodeVar0 : vec4<f32>;
var<private> nodeVar1 : f32;
var<private> DiffuseColor : vec4<f32>;
var<private> Output : vec4<f32>;
var<private> nodeVar2 : vec4<f32>;
var<private> nodeVar3 : vec4<f32>;
var<private> nodeVar4 : vec4<f32>;
var<private> nodeVar5 : vec4<f32>;

// codes
fn smin ( a: f32, b: f32, kIn: f32 ) -> f32 {
  let k = kIn * 4.0;
  if (k <= 0.0) { return min(a, b); }
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

fn sminChamfer ( a: f32, b: f32, kIn: f32 ) -> f32 {
  let k = kIn * 4.0;
  if (k <= 0.0) { return min(a, b); }
  return min(min(a, b), (a - k + b) * 0.70710678);
}

fn smax ( a: f32, b: f32, k: f32 ) -> f32 {
  return -smin(-a, -b, k);
}

fn sdGroove ( a: f32, b: f32, ra: f32, rb: f32 ) -> f32 {
  let inBand = rb - abs(b);
  if (inBand <= 0.0) { return a; }
  return max(a, min(a + ra, inBand));
}

fn coneCap ( q: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r1: f32, r2: f32, minScale: f32 ) -> f32 {
  if (r2 < 0.0) {
    let ab = b - a;
    let ap = q - a;
    let ab2 = dot(ab, ab);
    let t = select(clamp(dot(ap, ab) / ab2, 0.0, 1.0), 0.0, ab2 == 0.0);
    return (length(q - (a + ab * t)) - r1) * minScale;
  }
  let ba = b - a;
  let l2 = dot(ba, ba);
  if (l2 < 1e-12) { return (length(q - a) - max(r1, r2)) * minScale; }
  let rr = r1 - r2;
  let a2 = l2 - rr * rr;
  let il2 = 1.0 / l2;
  let pa = q - a;
  let y = dot(pa, ba);
  let z = y - l2;
  let x = pa * l2 - ba * y;
  let x2 = dot(x, x);
  let y2 = y * y * l2;
  let z2 = z * z * l2;
  let k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) { return (sqrt(x2 + z2) * il2 - r2) * minScale; }
  if (sign(y) * a2 * y2 < k) { return (sqrt(x2 + y2) * il2 - r1) * minScale; }
  return ((sqrt(x2 * a2 * il2) + y * rr) * il2 - r1) * minScale;
}

fn sdBezierT ( p: vec3<f32>, A: vec3<f32>, B: vec3<f32>, C: vec3<f32> ) -> vec4<f32> {
  let a = B - A;
  let bv = A - 2.0 * B + C;
  let dv = A - p;

  let kk = 1.0 / dot(bv, bv);
  let kx = kk * dot(a, bv);
  let ky = kk * (2.0 * dot(a, a) + dot(dv, bv)) / 3.0;
  let kz = kk * dot(dv, a);

  // Depressed cubic u^3 + pp*u + qq = 0, with t = u - kx.
  let pp = ky - kx * kx;
  let qq = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  let h = qq * qq + 4.0 * pp * pp * pp;

  if (h >= 0.0) {
    // One real root: the squared distance is monotone either side of it, so
    // the clamped root covers the interior. The |pp| ~ 0 branch is iq's
    // numerical-stability fix — there (plus/minus sqrt(h) - q)/2 cancels
    // catastrophically.
    let h2 = sqrt(h);
    var x1 = (h2 - qq) * 0.5;
    var x2 = (-h2 - qq) * 0.5;
    if (abs(pp) < 1e-4 && qq != 0.0) {
      let k = pp * pp * pp / qq;
      x1 = k;
      x2 = -k - qq;
    }
    let u1 = sign(x1) * pow(abs(x1), 1.0 / 3.0);
    let u2 = sign(x2) * pow(abs(x2), 1.0 / 3.0);
    return vec4<f32>(clamp(u1 + u2 - kx, 0.0, 1.0), 0.0, 0.0, 1.0);
  }
  // Three real roots.
  let z = sqrt(-pp);
  let v = acos(clamp(qq / (pp * z * 2.0), -1.0, 1.0)) / 3.0;
  let m = cos(v);
  let n = sin(v) * 1.7320508;
  return vec4<f32>(
    clamp((m + n) * z - kx, 0.0, 1.0),
    clamp(-(m + n) * z - kx, 0.0, 1.0),
    clamp((n - m) * z - kx, 0.0, 1.0),
    3.0);
}

fn coneBend ( q: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, r1: f32, r2: f32, minScale: f32 ) -> f32 {
  // DEGENERATE GUARD, before the division it protects — same class as the
  // l2 < 1e-12 guard coneCap carries for coincident endpoints. With a
  // collinear control point the curve coefficient bv below is the zero
  // vector, kk = 1/dot(bv,bv) is infinity, and the whole thing returns NaN —
  // and ONE NaN in a smooth-min fold takes the entire body with it. There
  // the straight round cone IS the exact answer, so the fallback costs
  // nothing but the test.
  let bb = a - 2.0 * c + b;
  if (dot(bb, bb) < 1e-12) { return coneCap(q, a, b, r1, r2, minScale); }
  if (dot(b - a, b - a) < 1e-12) { return coneCap(q, a, b, r1, r2, minScale); }
  // UNTAPERED SENTINEL. sdPrim passes r2 = -1 for a prim with no r2=, and
  // coneCap has always branched on it. This function did not: -1 went
  // straight into r1 + (r2 - r1) * t, so an untapered BENT prim's radius ran
  // to minus one metre along its curve and only the start end existed. It
  // hid for as long as every bent prim happened to be tapered; the mouse's
  // sunglass lens — a plain bent capsule — rendered as a single sphere at
  // its inner end. The CPU mirror never saw it because sdPrimitive
  // substitutes radiusB-or-radius before calling sdBentCone.
  let rb = select(r2, r1, r2 < 0.0);
  let cand = sdBezierT(q, a, c, b);
  // dist(t) - r(t) at every root AND both ends, keeping the minimum. The
  // radius term moves the objective's minimiser off the geometric closest
  // point where the taper is steep, so evaluating only the closest t could
  // overestimate — and an overestimated distance steps through surfaces.
  // Passes 2-3 refine locally around the best so far (steps 1/8 then 1/32);
  // monotone, the min can only improve. Mirrors sdBentCone in validate.ts.
  let e1 = (c - a) * 2.0;
  var best = 1e9;
  var bestT = 0.0;
  var ts = array<f32, 9>(cand.x, cand.y, cand.z, 0.0, 0.25, 0.5, 0.75, 1.0, 1.0);
  for (var i = 0; i < 9; i = i + 1) {
    if (f32(i) >= cand.w && i < 3) { continue; }
    let t = ts[i];
    let pt = a + e1 * t + bb * (t * t);
    let v = length(q - pt) - (r1 + (rb - r1) * t);
    if (v < best) { best = v; bestT = t; }
  }
  for (var round = 0; round < 2; round = round + 1) {
    let step = select(0.125, 0.03125, round >= 1);
    for (var s = -1; s <= 1; s = s + 1) {
      let t = clamp(bestT + f32(s) * step, 0.0, 1.0);
      let pt = a + e1 * t + bb * (t * t);
      let v = length(q - pt) - (r1 + (rb - r1) * t);
      if (v < best) { best = v; bestT = t; }
    }
  }
  return best * minScale;
}

fn strandHash4 ( ix: f32, iy: f32 ) -> vec4<f32> {
  return fract(vec4<f32>(
    0.371 * ix + 0.733 * iy,
    0.531 * ix + 0.297 * iy + 0.41,
    0.617 * ix + 0.173 * iy + 0.73,
    0.229 * ix + 0.859 * iy + 0.19));
}

fn strandLip ( a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, r1: f32, r2: f32, bent: f32, st: vec4<f32> ) -> f32 {
  let n = st.x;
  let wave = st.y;
  let cycles = st.z;
  let fat = st.w;
  let rb = select(r2, r1, r2 < 0.0);
  var e1 = b - a;
  var bb = vec3<f32>(0.0);
  if (bent > 0.5) {
    e1 = (c - a) * 2.0;
    bb = a - 2.0 * c + b;
    if (dot(bb, bb) < 1e-12) { e1 = b - a; bb = vec3<f32>(0.0); }
  }
  let bbLen = length(bb);
  var spdMin = length(e1);
  if (bbLen >= 1e-9) {
    let dd = 2.0 * bb;
    let tMin = clamp(-dot(e1, dd) / dot(dd, dd), 0.0, 1.0);
    spdMin = length(e1 + dd * tMin);
  }
  // A degenerate (zero-length) strand has no curve to wave along.
  if (spdMin < 1e-9) { return 1.0; }
  let m = ceil(n * 0.5);
  let rMax = max(r1, rb);
  let cellMax = 2.0 * rMax / n;
  let cellRate = 2.0 * abs(rb - r1) / n;
  // STRAND_JITTER: keep in step with strand.ts (0.4 of the wobble).
  let centreMax = m * cellMax + wave * 1.4 * cellMax;
  let rhoMax = centreMax + fat * cellMax * 0.5;
  let kappa = 2.0 * bbLen / (spdMin * spdMin);
  let rate = 1.0 / (spdMin * max(1.0 - rhoMax * kappa, 0.25));
  let dCentre = m * cellRate + wave * 1.4 * cellRate + wave * 6.2831853 * cycles * cellMax;
  let spin = 2.0 * bbLen / spdMin;
  let dSdir = spin + wave * 6.2831853 * cycles * (cellRate + 6.2831853 * cycles * cellMax) / spdMin;
  let win = 2.0 * cellMax;
  let dRad = fat * cellRate * 0.5;
  return 1.0 + rate * (dCentre + spin * centreMax + win * dSdir + dRad);
}

fn coneStrand ( q: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, r1: f32, r2: f32, minScale: f32, bent: f32, st: vec4<f32>, windPhase: f32 ) -> f32 {
  let n = st.x;
  let wave = st.y;
  let cycles = st.z;
  let fat = st.w;
  let rb = select(r2, r1, r2 < 0.0);
  var e1 = b - a;
  var bb = vec3<f32>(0.0);
  if (bent > 0.5) {
    e1 = (c - a) * 2.0;
    bb = a - 2.0 * c + b;
    if (dot(bb, bb) < 1e-12) { e1 = b - a; bb = vec3<f32>(0.0); }
  }
  // t*: the EXACT closest point on the base curve. Straight: the clamped
  // projection. Bent: the cubic roots are every interior distance extremum,
  // so roots + ends suffice — no quarters, no refinement (those exist in
  // coneBend for the radius term, which the strand fold applies AFTER t*).
  let abLen2 = dot(b - a, b - a);
  var tStar = 0.0;
  if (abLen2 >= 1e-12) {
    if (dot(bb, bb) < 1e-12) {
      tStar = clamp(dot(q - a, b - a) / abLen2, 0.0, 1.0);
    } else {
      let cand = sdBezierT(q, a, c, b);
      var bestD = 1e9;
      var ts = array<f32, 5>(cand.x, cand.y, cand.z, 0.0, 1.0);
      for (var i = 0; i < 5; i = i + 1) {
        if (f32(i) >= cand.w && i < 3) { continue; }
        let t = ts[i];
        let p0 = a + e1 * t + bb * (t * t);
        let dd = dot(q - p0, q - p0);
        if (dd < bestD) { bestD = dd; tStar = t; }
      }
    }
  }
  let pt = a + e1 * tStar + bb * (tStar * tStar);
  let dC = e1 + 2.0 * bb * tStar;
  let spd = max(length(dC), 1e-9);
  let tan = dC / spd;
  // Cross-section basis off the axis LEAST aligned with the tangent.
  let seedAxis = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(tan.y) < 0.9);
  let u = normalize(cross(tan, seedAxis));
  let v = cross(tan, u);
  let rT = r1 + (rb - r1) * tStar;
  let cell = max(2.0 * rT / n, 1e-6);
  let rS = fat * cell * 0.5;
  let m = ceil(n * 0.5);
  let win = 2.0 * cell;
  let rel = q - pt;
  let pl = vec2<f32>(dot(rel, u), dot(rel, v));
  let id0 = round(pl / cell);
  var best = 1e9;
  for (var di = -1; di <= 1; di = di + 1) {
    for (var dj = -1; dj <= 1; dj = dj + 1) {
      let idc = clamp(id0 + vec2<f32>(f32(di), f32(dj)), vec2<f32>(-m), vec2<f32>(m));
      let h = strandHash4(idc.x, idc.y);
      // windPhase rides INSIDE the cycle count: a whole-turn offset that
      // slides the sample along the wave without changing the wave. Mirrors
      // sdStrand in strand.ts; d(phase)/dt is still TAU*cycles, which is
      // what strandLip is built from, so the bound is untouched.
      let phx = 6.2831853 * (cycles * tStar + h.x + windPhase);
      let phy = 6.2831853 * (cycles * tStar + h.y + 0.25 + windPhase);
      let wob = wave * cell;
      let ctr = idc * cell + wob * vec2<f32>(sin(phx), sin(phy)) + 0.4 * wob * (2.0 * h.zw - vec2<f32>(1.0));
      // The strand's local direction: the curve's plus the wobble's slope,
      // so the windowed capsule lies ALONG the wavy strand rather than
      // beading at every sample station.
      let dw = wob * 6.2831853 * cycles * vec2<f32>(cos(phx), cos(phy));
      let sd3 = normalize(dC + dw.x * u + dw.y * v);
      let m3 = pt + ctr.x * u + ctr.y * v;
      let w3 = q - m3;
      let dl = dot(w3, sd3);
      // The window kills the ghost ridge a curve-length tangent line would
      // leave, and never runs past the curve's own ends: a pointed lock
      // ENDS at t = 1.
      let dlc = clamp(dl, max(-win, -tStar * spd), min(win, (1.0 - tStar) * spd));
      let dI = length(w3 - dlc * sd3) - rS;
      best = min(best, dI);
    }
  }
  return best * minScale / strandLip(a, b, c, r1, r2, bent, st);
}

fn sdRoundBox ( p: vec3<f32>, e: vec3<f32>, r: f32 ) -> f32 {
  let q = abs(p) - e;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

fn sdPrim ( p: vec3<f32>, i: i32, data: texture_2d<f32>, r2: f32, prof: f32, cpos: vec3<f32>, band: i32 ) -> f32 {
  let A = textureLoad(data, vec2<i32>(i, 0 + band), 0);
  let B = textureLoad(data, vec2<i32>(i, 1 + band), 0);
  let S = textureLoad(data, vec2<i32>(i, 2 + band), 0);
  let inv = 1.0 / S.xyz;
  let minScale = min(S.x, min(S.y, S.z));
  // STRAND before every other branch, mirroring sdPrimitive in validate.ts:
  // a strand prim is its own field construction, and box/shell are rejected
  // on it at compile time, so it cannot belong to any branch below. The
  // strand row is fetched HERE rather than by the caller — the same
  // on-demand discipline the box branch uses for ROW_PRIM_BEND — so a prim
  // without strands never pays for the fetch.
  //
  // The bent flag selects whether coneStrand reads the control point: a
  // straight strand is passed c = vec3(0) and must not use it. (No backticks
  // in this comment -- it lives inside a TEMPLATE LITERAL, and one would end
  // the WGSL string mid-function.)
  if ((i32(prof) & 32) != 0) {
    let ST = textureLoad(data, vec2<i32>(i, 21 + band), 0);
    let bent = select(0.0, 1.0, (i32(prof) & 2) != 0);
    // HAIR RIPPLES IN THE SAME WIND THE CLOTH SWAYS IN: cycles of wobble
    // phase per metre of accumulated drift (STRAND_WIND_RIPPLE in
    // strand.ts). Length, not a projection — a bundle has no single
    // facing, and hair ripples whichever way the air is moving.
    let windPhase = length(gWindDrift) * 6.0;
    return coneStrand(p * inv, A.xyz * inv, B.xyz * inv, cpos * inv, A.w, r2, minScale, bent, ST, windPhase);
  }
  // BOX before BENT: bend= is rejected on a box at compile time, so the two
  // never coexist; testing box first means the bend row is never fetched for
  // one, which is what makes sharing primBend.w safe. The bend row is
  // otherwise only fetched by the caller when prof & 2 (see applyCarves and
  // foldGroup), so a box branch here must load ROW_PRIM_BEND itself.
  if ((i32(prof) & 8) != 0) {
    let qq = p * inv;
    let a = A.xyz * inv;
    let b = B.xyz * inv;
    let ab = b - a;
    let ap = qq - a;
    let ab2 = dot(ab, ab);
    let t = select(clamp(dot(ap, ab) / ab2, 0.0, 1.0), 0.0, ab2 == 0.0);
    let closest = a + ab * t;
    let round = textureLoad(data, vec2<i32>(i, 11 + band), 0).w;
    let e = A.w * (1.0 - round);
    return sdRoundBox(qq - closest, vec3<f32>(e), A.w * round) * minScale;
  }
  // Bent above tapered above plain: prof's bit 1 (value 2) means the Bezier
  // path (0 round, 1 chamfer, 2 round+bent, 3 chamfer+bent; 4/6 add shell on
  // top, whose bend flag is the same bit), so the bit test keeps every
  // straight prim — including a straight SHELL (prof 4) — on the exact
  // expression it has always run, while a bent prim takes the curve. Bit 1
  // is the mask (i32(prof) & 2) != 0, equivalent to prof > 1.5 on the 0-3
  // range, and correct for shells on 4/6.
  if ((i32(prof) & 2) != 0) {
    return coneBend(p * inv, A.xyz * inv, B.xyz * inv, cpos * inv, A.w, r2, minScale);
  }
  return coneCap(p * inv, A.xyz * inv, B.xyz * inv, A.w, r2, minScale);
}

fn sdPrimO ( p: vec3<f32>, i: i32, data: texture_2d<f32>, r2: f32, prof: f32, cpos: vec3<f32>, band: i32 ) -> f32 {
  let A = textureLoad(data, vec2<i32>(i, 0 + band), 0);
  let B = textureLoad(data, vec2<i32>(i, 1 + band), 0);
  let S = textureLoad(data, vec2<i32>(i, 2 + band), 0);
  var qq = p;
  var a = A.xyz;
  var b = B.xyz;
  // The control point rides the same conjugate as the endpoints — the curve
  // is defined in the prim's frame exactly as they are.
  var c = cpos;
  let O = textureLoad(data, vec2<i32>(i, 7 + band), 0);
  if (abs(1.0 - O.w) > 1e-6) {
    let mid = (A.xyz + B.xyz) * 0.5;
    // Conjugate of O: vector part negated, w unchanged. Rodrigues-in-quat
    // form: v' = v + 2*w*(u x v) + 2*(u x (u x v)), matching qRotate in vec.ts.
    let u = -O.xyz;
    let vq = qq - mid;
    let tq = 2.0 * cross(u, vq);
    qq = mid + vq + tq * O.w + cross(u, tq);
    let va = a - mid;
    let ta = 2.0 * cross(u, va);
    a = mid + va + ta * O.w + cross(u, ta);
    let vb = b - mid;
    let tb = 2.0 * cross(u, vb);
    b = mid + vb + tb * O.w + cross(u, tb);
    let vc = c - mid;
    let tc = 2.0 * cross(u, vc);
    c = mid + vc + tc * O.w + cross(u, tc);
  }
  let inv = 1.0 / S.xyz;
  qq = qq * inv;
  a = a * inv;
  b = b * inv;
  let minScale = min(S.x, min(S.y, S.z));
  // STRAND before every other branch, mirroring sdPrimitive in validate.ts:
  // a strand prim is its own field construction, and box/shell are rejected
  // on it at compile time, so it cannot belong to any branch below. The
  // strand row is fetched HERE rather than by the caller — the same
  // on-demand discipline the box branch uses for ROW_PRIM_BEND — so a prim
  // without strands never pays for the fetch.
  //
  // The bent flag selects whether coneStrand reads the control point: a
  // straight strand is passed c = vec3(0) and must not use it. (No backticks
  // in this comment -- it lives inside a TEMPLATE LITERAL, and one would end
  // the WGSL string mid-function.)
  if ((i32(prof) & 32) != 0) {
    let ST = textureLoad(data, vec2<i32>(i, 21 + band), 0);
    let bent = select(0.0, 1.0, (i32(prof) & 2) != 0);
    // HAIR RIPPLES IN THE SAME WIND THE CLOTH SWAYS IN: cycles of wobble
    // phase per metre of accumulated drift (STRAND_WIND_RIPPLE in
    // strand.ts). Length, not a projection — a bundle has no single
    // facing, and hair ripples whichever way the air is moving.
    let windPhase = length(gWindDrift) * 6.0;
    return coneStrand(qq, a, b, c * inv, A.w, r2, minScale, bent, ST, windPhase);
  }
  // BOX before BENT — same reasoning as sdPrim: bend= and box never coexist,
  // so testing box first means the bend row is fetched only here, on demand.
  if ((i32(prof) & 8) != 0) {
    let ab = b - a;
    let ap = qq - a;
    let ab2 = dot(ab, ab);
    let t = select(clamp(dot(ap, ab) / ab2, 0.0, 1.0), 0.0, ab2 == 0.0);
    let closest = a + ab * t;
    let round = textureLoad(data, vec2<i32>(i, 11 + band), 0).w;
    let e = A.w * (1.0 - round);
    return sdRoundBox(qq - closest, vec3<f32>(e), A.w * round) * minScale;
  }
  if ((i32(prof) & 2) != 0) { return coneBend(qq, a, b, c * inv, A.w, r2, minScale); }
  return coneCap(qq, a, b, A.w, r2, minScale);
}

fn hash13 ( pIn: vec3<f32> ) -> f32 {
  var p = fract(pIn * 0.1031);
  p = p + dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

fn noise3 ( p: vec3<f32> ) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let n = mix(
    mix(mix(hash13(i + vec3<f32>(0.0, 0.0, 0.0)), hash13(i + vec3<f32>(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3<f32>(0.0, 1.0, 0.0)), hash13(i + vec3<f32>(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3<f32>(0.0, 0.0, 1.0)), hash13(i + vec3<f32>(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3<f32>(0.0, 1.0, 1.0)), hash13(i + vec3<f32>(1.0, 1.0, 1.0)), f.x), f.y), f.z);
  return n * 2.0 - 1.0;
}

fn fbm ( p: vec3<f32> ) -> f32 {
  return noise3(p * 4.0) * 0.6 + noise3(p * 9.0) * 0.3;
}

fn noiseLocal ( p: vec3<f32>, ns: vec3<f32> ) -> vec3<f32> {
  let dp = vec3<f32>(p.x - ns.x, p.y, p.z - ns.z);
  let ch = cos(ns.y);
  let sh = sin(ns.y);
  return vec3<f32>(dp.x * ch - dp.z * sh, dp.y, dp.x * sh + dp.z * ch);
}

fn sdShell ( dBase: f32, p: vec3<f32>, thick: f32, rim: f32, clipO: f32, hasClip: f32, clipN: vec3<f32>, warpA: f32, warpF: vec3<f32>, drift: vec3<f32> ) -> f32 {
  var base = dBase;
  var lip = 1.0;
  let fLen = length(warpF);
  if (warpA != 0.0 && fLen != 0.0) {
    // BODY-ANCHORED, via the same noiseLocal the body's surface noise uses:
    // at the raw world point the fold lattice is fixed in the world and she
    // turns underneath it, so the folds swim across the cloth as she walks.
    //
    // The drift is subtracted BEFORE the transform. noiseLocal is affine, so
    // local(p - drift) = local(p) - R(-yaw)*drift: the wind gets rotated into
    // her frame for free and a breeze keeps blowing in WORLD directions.
    // Subtracting after would nail the wind to her hips.
    let q = noiseLocal(p - drift, gBodyAnchor);
    base = base + warpA * sin(warpF.x * q.x) * sin(warpF.y * q.y + 1.3) * sin(warpF.z * q.z + 2.6);
    lip = 1.0 + abs(warpA) * fLen;
  }
  let d = abs(base) - thick;
  if (hasClip < 0.5) { return d / lip; }
  let dPlane = dot(p, clipN) - clipO;
  return max(max(d, dPlane), rim - length(vec2(d, dPlane))) / lip;
}

fn qRot ( q: vec4<f32>, v: vec3<f32> ) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + t * q.w + cross(q.xyz, t);
}

fn qMulQ ( a: vec4<f32>, b: vec4<f32> ) -> vec4<f32> {
  return vec4<f32>(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z);
}

fn qFromToV ( u: vec3<f32>, v: vec3<f32> ) -> vec4<f32> {
  let d = clamp(dot(u, v), -1.0, 1.0);
  if (d >= 0.999999) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  if (d <= -0.999999) {
    // Anti-parallel: any perpendicular axis gives the half turn.
    var seed = vec3<f32>(1.0, 0.0, 0.0);
    if (abs(u.x) >= 0.9) { seed = vec3<f32>(0.0, 1.0, 0.0); }
    return vec4<f32>(normalize(cross(u, seed)), 0.0);
  }
  return normalize(vec4<f32>(cross(u, v), 1.0 + d));
}

fn restPoint ( p: vec3<f32>, data: texture_2d<f32>, best: i32, fallback: vec3<f32> ) -> vec3<f32> {
  if (best < 0) { return fallback; }
  let ra = textureLoad(data, vec2<i32>(best, 8), 0);
  if (ra.w <= 0.0) { return fallback; }
  let rb = textureLoad(data, vec2<i32>(best, 9), 0);
  let pa = textureLoad(data, vec2<i32>(best, 0), 0).xyz;
  let pb = textureLoad(data, vec2<i32>(best, 1), 0).xyz;
  let midP = (pa + pb) * 0.5;
  let midR = (ra.xyz + rb.xyz) * 0.5;
  // The exact local frame first: the conjugate of the packed orient. A zero
  // or identity quat leaves q identity (qRot by it is the identity anyway).
  var q = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  let O = textureLoad(data, vec2<i32>(best, 7), 0);
  if (abs(1.0 - O.w) > 1e-6) { q = vec4<f32>(-O.xyz, O.w); }
  let axisP = pb - pa;
  let axisR = rb.xyz - ra.xyz;
  let lenP = length(axisP);
  let lenR = length(axisR);
  if (lenP > 1e-6 && lenR > 1e-6) {
    // Swing AFTER the orient frame: qMulQ(swing, q) applies q first.
    q = qMulQ(qFromToV(qRot(q, axisP / lenP), axisR / lenR), q);
  }
  return midR + qRot(q, p - midP);
}

fn applyCarves ( dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32> ) -> f32 {
  var d = dIn;
  if (counts.z < 0.5) { return d; }
  let clusterCount = i32(counts.y);
  let primCount = i32(counts.x);
  for (var c = 0; c < 8; c = c + 1) {
    if (c >= clusterCount) { break; }
    let range = textureLoad(data, vec2<i32>(c, 4), 0);
    if (range.z < 0.5) { continue; }
    let start = i32(range.x);
    let count = i32(range.y);
    // w: oriented-cluster flag (motion-polish task 3). Hoisting the quat
    // branch to cluster granularity is the measured win — see sdPrimO. The
    // two calls agree bit-for-bit on identity quats, so the CPU mirror
    // (validate.sdBody) branches per prim and stays exact for both.
    let flags = i32(range.w + 0.5);
    let ori = (flags & 1) != 0;
    let shaped = (flags & 2) != 0;
    for (var i = 0; i < 64; i = i + 1) {
      if (i >= count) { break; }
      let idx = start + i;
      if (idx >= primCount) { break; }
      let S = textureLoad(data, vec2<i32>(idx, 2), 0);
      // S.w: 0 add, 1 carve, 2 dead (severed mid-limb). Dead prims stop
      // carving too — a severed hand must not keep biting the field it left.
      // 1 = carve, 3 = groove. 0 (additive) and 2 (dead) are skipped.
      let isCarve = S.w > 0.5 && S.w < 1.5;
      // BOUNDED on both sides: W_BONE (4) is greater than the groove code (3),
      // so an open-ended '> 2.5' would carve every bone prim into the flesh as
      // a groove. Bone is folded separately, after wounds — see applyBones.
      let isGroove = S.w > 2.5 && S.w < 3.5;
      if (!isCarve && !isGroove) { continue; }
      let k = textureLoad(data, vec2<i32>(idx, 1), 0).w;
      // The shape row is read on the CARVE path too, not only in mapBody.
      // Skipping it would make a tapered carve a plain capsule in the shader
      // while validate.ts's carve loop honoured the taper: the two fields would
      // disagree, and this one backs click-to-shoot, so shots would land where
      // nothing is drawn.
      //
      // The PROFILE is deliberately not read here. Carving folds through smax,
      // and a chamfered subtraction is a different operator with its own
      // sign conventions — worth having, but not worth guessing at. A
      // chamfer on a carve is rejected at authoring time instead
      // (blob-compile.ts), so this cannot silently do the wrong thing.
      var r2 = -1.0;
      var gr = vec2<f32>(0.0, 0.0);
      var prof = 0.0;
      var cpos = vec3<f32>(0.0, 0.0, 0.0);
      if (shaped) {
        let T = textureLoad(data, vec2<i32>(idx, 10), 0);
        r2 = T.x;
        prof = T.y;
        gr = T.zw;
        // Only genuinely-bent prims pay for the bend row; bit 1 (value 2)
        // encodes bend so a straight SHELL (prof 4) skips it. Keeps every
        // "> 0.5 means chamfer" consumer working unchanged.
        if ((i32(prof) & 2) != 0) {
          cpos = textureLoad(data, vec2<i32>(idx, 11), 0).xyz;
        }
      }
      let sd = select(sdPrim(p, idx, data, r2, prof, cpos, 0), sdPrimO(p, idx, data, r2, prof, cpos, 0), ori);
      if (isGroove) { d = sdGroove(d, sd, gr.x, gr.y); } else { d = smax(d, -sd, k); }
    }
  }
  return d;
}

fn applyWounds ( dIn: f32, p: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, perfCfg: vec4<f32>, woundBound: vec4<f32> ) -> vec2<f32> {
  var d = dIn;
  var near = 0.0;
  // One sphere test before the loop replaces up to 16 wound-row loads plus a
  // length() each, on every mapBody evaluation, for every sample nowhere near
  // a crater. Tested BEFORE the loop (pinned by test): the whole point is
  // that a far sample pays nothing per-wound.
  if (length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }
  let n = i32(woundCfg.x);
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= n) { break; }
    let w = textureLoad(data, vec2<i32>(i, 5), 0);
    let r = length(p - w.xyz);
    // Reach of this wound's influence, beyond which the carve, the fillet
    // and the rim bump all contribute exactly nothing (see the test):
    //   crater .......... r < depth <= w.w, and nearWound at 2 depth
    //   smax fillet ..... quadratic smin is exactly min once |a-b| >= 4k;
    //                     a-b here is (r - depth) + d, and d >= -0.25 inside
    //                     any limb this game has
    //   rim bump ........ exp(-x^2) at x >= 3 is 1.2e-4 of amp — sub-micron
    // Skipping here saves the two texel loads below and every op after them
    // for every wound the sample is nowhere near — which, per march step,
    // is all of them but one. (perfCfg.y seam, game page ON; lab default 0
    // keeps its reference bit-identical.)
    let reach = w.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + 0.25;
    if (perfCfg.y > 0.5 && r > reach) { continue; }
    let wMeta = textureLoad(data, vec2<i32>(i, 6), 0);
    // Depth slab (2026-08-27): the sphere stays centred on the uploaded
    // anchor — the lab's deep bowl — and is clipped by a plane through the
    // anchor facing inward, at most wCap.w deep. The carve region is the
    // CONVEX INTERSECTION {inside sphere} ∩ {shallower than the cap}; its
    // inside-positive SDF is -max(sphereSDF, slabSDF) = min(depth - r,
    // capEff - dot). The sign of the dot term matters more than it looks:
    // a dot - capEff term is positive BEYOND the cap, so a max() with that
    // form kept the term positive across the entire half-space behind the
    // kept the term positive across the entire half-space behind the cap
    // plane — every wound silently deleted all flesh deeper than its cap,
    // out to infinity, and a body with wounds from mixed directions (the
    // shotgun) lost whole quadrants of itself while a single wound looked
    // perfect from the front. That regression is why whole zombies went
    // invisible on 2026-08-27. With min(depth - r, capEff - dot) the carve
    // is a bounded bowl: shallow+inside carves, beyond the cap flesh
    // remains, outside the sphere nothing changes. With wCap.w <= 0
    // (uncapped: the lab uploads no caps, old wounds, chunk torn-ends) the
    // 1e5 term loses the min for any real distance, so the carve is
    // BIT-IDENTICAL to the pre-slab sphere — that is what keeps the lab
    // reference stable.
    let wCap = textureLoad(data, vec2<i32>(i, 18), 0);
    let capEff = select(1.0e5, wCap.w, wCap.w > 0.0);
    let isBurn = wMeta.x > 1.5;
    let depth = select(w.w, w.w * 0.35 * clamp(wMeta.y, 0.0, 1.0), isBurn);
    d = smax(d, min(-(r - depth), capEff - dot(p - w.xyz, wCap.xyz)), woundCfg.y);
    if (r < depth * 2.0) { near = 1.0; }
    let x = (r - depth * woundCfg.w * wMeta.w) / max(depth * woundCfg2.x, 1e-4);
    let amp = depth * woundCfg.z * wMeta.z * select(1.0, 0.25, isBurn);
    let rimLocal = 1.0 - smoothstep(-amp * 0.3, amp * 0.7, dIn);
    d = d - exp(-x * x) * amp * rimLocal;
  }
  return vec2<f32>(d, near);
}

fn woundMask ( p: vec3<f32>, nrm: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32> ) -> vec3<f32> {
  var m = 0.0;
  var cav = 0.0;
  let n = i32(woundCfg.x);
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= n) { break; }
    let w = textureLoad(data, vec2<i32>(i, 5), 0);
    let contribution = 1.0 - smoothstep(0.0, w.w * 1.6, length(p - w.xyz));
    m = max(m, contribution);
    // Cavity-ness (entrails, 2026-09-02): the SAME radial footprint,
    // accumulated only over wounds whose flags row says the hit opened a
    // cavity. Deliberately NOT a second footprint — a second mask edge is
    // how the 2026-08-23 halo happened.
    let flags = textureLoad(data, vec2<i32>(i, 19), 0);
    if (flags.x > 0.5) { cav = max(cav, contribution); }
  }
  return vec3<f32>(m, m, cav);
}

fn tissueRamp ( depth: f32, baseColor: vec3<f32>, fatColor: vec3<f32>, deepColor: vec3<f32>, fatDepth: f32, muscleDepth: f32, cavity: f32, visceraColor: vec3<f32>, visceraDepth: f32 ) -> vec3<f32> {
  let dermis = mix(baseColor, deepColor, 0.5);
  let clot = deepColor * 0.45;
  let toFat = smoothstep(0.0, fatDepth, depth);
  let toMuscle = smoothstep(fatDepth, muscleDepth, depth);
  let toClot = smoothstep(muscleDepth, muscleDepth * 2.5, depth);
  var c = mix(dermis, fatColor, toFat);
  c = mix(c, deepColor, toMuscle);
  c = mix(c, clot, toClot);
  // Cavity. Gated on 'cavity' (this pixel is inside a wound that opened one),
  // NOT on depth alone — a deep limb wound is still a wall of meat.
  let toViscera = smoothstep(muscleDepth, visceraDepth, depth) * cavity;
  return mix(c, visceraColor, toViscera);
}

fn charMask ( p: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32> ) -> f32 {
  var m = 0.0;
  let n = i32(woundCfg.x);
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= n) { break; }
    let wMeta = textureLoad(data, vec2<i32>(i, 6), 0);
    if (wMeta.x < 1.5) { continue; }
    let w = textureLoad(data, vec2<i32>(i, 5), 0);
    m = max(m, (1.0 - smoothstep(0.0, w.w * 2.2, length(p - w.xyz))) * clamp(wMeta.y, 0.0, 1.0));
  }
  return m;
}

fn sampleHandVolumeFrame ( q: vec3<f32>, frameIndex: i32, volumeTex: texture_3d<f32>, volumeClip: vec4<f32> ) -> f32 {
  // X1.27: slab-local trilinear over ONE frame of the depth-packed atlas.
  // volumeClip.w is the frame depth (never 0 — max(1, ...) guarantees a live
  // slab and no 0-depth sentinel exists anywhere in WGSL); the z indices are
  // frame-local and offset by frame * frameDepth, with the z clamp ending at
  // zOffset + frameDepth - 1 so a slab can never bleed into its neighbour.
  let atlasDims = vec3<i32>(textureDimensions(volumeTex, 0));
  let depth = max(1, i32(volumeClip.w));
  let dimsI = vec3<i32>(atlasDims.x, atlasDims.y, depth);
  let frame = clamp(frameIndex, 0, atlasDims.z / depth - 1);
  let zBase = frame * depth;
  let i0 = vec3<i32>(floor(q));
  let i1 = min(i0 + vec3<i32>(1, 1, 1), dimsI - vec3<i32>(1, 1, 1));
  let a0 = vec3<i32>(i0.x, i0.y, i0.z + zBase);
  let a1 = vec3<i32>(i1.x, i1.y, i1.z + zBase);
  let fr = q - floor(q);
  let s000 = textureLoad(volumeTex, a0, 0).r;
  let s100 = textureLoad(volumeTex, vec3<i32>(a1.x, a0.y, a0.z), 0).r;
  let s010 = textureLoad(volumeTex, vec3<i32>(a0.x, a1.y, a0.z), 0).r;
  let s110 = textureLoad(volumeTex, vec3<i32>(a1.x, a1.y, a0.z), 0).r;
  let s001 = textureLoad(volumeTex, vec3<i32>(a0.x, a0.y, a1.z), 0).r;
  let s101 = textureLoad(volumeTex, vec3<i32>(a1.x, a0.y, a1.z), 0).r;
  let s011 = textureLoad(volumeTex, vec3<i32>(a0.x, a1.y, a1.z), 0).r;
  let s111 = textureLoad(volumeTex, a1, 0).r;
  return mix(
    mix(mix(s000, s100, fr.x), mix(s010, s110, fr.x), fr.y),
    mix(mix(s001, s101, fr.x), mix(s011, s111, fr.x), fr.y),
    fr.z);
}

fn sampleHandVolume(pWorld: vec3<f32>, volumeTex: texture_3d<f32>, volumePose0: vec4<f32>, volumePose1: vec4<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>) -> f32 {
  let pl = pWorld - volumePose0.xyz;
  let cq = vec4<f32>(-volumePose1.xyz, volumePose1.w);
  let tq = 2.0 * cross(cq.xyz, pl);
  let local0 = pl + tq * cq.w + cross(cq.xyz, tq);
  let extent = vec3<f32>(1.0, 1.0, 1.0) / volumeInvExtent;
  let uv0 = (local0 - volumeMin) * volumeInvExtent;
  let distal = smoothstep(0.15, 0.9, uv0.y);
  let local = local0 - volumeWarp.xyz * distal;
  let uv = (local - volumeMin) * volumeInvExtent;
  let diffMin = volumeMin - local;
  let diffMax = local - (volumeMin + extent);
  let outside = length(max(max(diffMin, diffMax), vec3<f32>(0.0, 0.0, 0.0)));
  // World-to-local, warp, uv and the outside-box distance are computed ONCE
  // here; only the frame pair is sampled twice and mixed (X1.27). Static v1
  // views bind volumeClip = [0, 0, 0, nz]: frame0 == frame1 == slab 0 and
  // alpha 0, so the mix degenerates to exactly the v1 sample. The fallback
  // binds [0, 0, 0, 1]: a 1-deep slab of one texel.
  //
  // textureDimensions is vec3<u32>: WGSL has no u32-minus-i32 overload, so
  // the clamps narrow through explicit i32/f32 conversions (a mixed-type
  // arithmetic here once failed pipeline compilation and froze the whole
  // canvas — invisible to the string-level tests).
  let atlasDims = vec3<i32>(textureDimensions(volumeTex, 0));
  let depth = max(1, i32(volumeClip.w));
  let dimsF = vec3<f32>(f32(atlasDims.x), f32(atlasDims.y), f32(depth));
  let q = clamp(uv * (dimsF - vec3<f32>(1.0, 1.0, 1.0)), vec3<f32>(0.0, 0.0, 0.0), dimsF - vec3<f32>(1.0, 1.0, 1.0));
  let d0 = sampleHandVolumeFrame(q, i32(volumeClip.x), volumeTex, volumeClip);
  let d1 = sampleHandVolumeFrame(q, i32(volumeClip.y), volumeTex, volumeClip);
  return mix(d0, d1, clamp(volumeClip.z, 0.0, 1.0)) + outside;
}

// PERF INSTRUMENTATION COUNTERS (raymarcher-perf task 2). Private-scope
// globals, so mapBody's signature — and every caller threading values
// outward through it — stays untouched; counting per march STEP at the
// call site would fork the fold, which the plan forbids. Declared at the
// tail of the LAST helper before MAP_BODY because WGSL requires declaration
// before use; MARCH_BODY and CALC_NORMAL see them transitively through the
// includes chain. Fragment invocations each start with zeroed private
// globals, so there is no cross-pixel bleed; the march entry re-zeroes
// them under the debug guard anyway. gDebugMode mirrors debugCfg.x for
// mapBody, which takes no debugCfg parameter by design.
var<private> gDebugMode: f32 = 0.0;
var<private> gDebugPrims: f32 = 0.0;
var<private> gDebugSteps: f32 = 0.0;
/** Bone-capsule evaluations this ray (gore r3 refinement 3). The bone fold
 *  has no spatial cull, so this is the number the cull has to move — and a
 *  counter is honest where a 0.0% timing delta under a 4% spread is not. */
var<private> gDebugBones: f32 = 0.0;
// NOTE: these live at the tail of SAMPLE_VOLUME's source rather than in
// their own HELPERS entry because three's wgslFn parser is ^-anchored on
// "fn" — a var-declaration source would fail its parse contract.

fn foldGroup ( dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, band: i32, bounds: vec4<f32>, grp: vec4<f32> ) -> f32 {
  var d = dIn;
  // Per-step group-sphere cull, WITH the distortion factor — unchanged from
  // the cluster walk (see pack.ts: sd under-reports Euclid by up to this
  // factor; a factor-free test tore black cracks inside wound cavities).
  // Tiles cut the LIST; spheres still cut PER-STEP work.
  if (length(p - bounds.xyz) - bounds.w > (d + counts.w * 4.0) * grp.z) { return d; }
  let start = i32(grp.x);
  let count = i32(grp.y);
  let flags = i32(grp.w + 0.5);
  let ori = (flags & 1) != 0;
  let shaped = (flags & 2) != 0;
  for (var i = 0; i < 64; i = i + 1) {
    if (i >= count) { break; }
    let idx = start + i;
    if (idx >= i32(counts.x)) { break; }
    let S = textureLoad(data, vec2<i32>(idx, 2 + band), 0);
    // S.w: 0 add, 1 carve, 2 dead (severed mid-limb) — both skip the fold.
    if (S.w > 0.5) { continue; }
    if (gDebugMode > 0.5) { gDebugPrims = gDebugPrims + 1.0; }
    let k = textureLoad(data, vec2<i32>(idx, 1 + band), 0).w;
    var r2 = -1.0;
    var prof = 0.0;
    var cpos = vec3<f32>(0.0, 0.0, 0.0);
    if (shaped) {
      let T = textureLoad(data, vec2<i32>(idx, 10 + band), 0);
      r2 = T.x;
      prof = T.y;
      // Only genuinely-bent prims pay for the bend row; bit 1 (value 2)
      // encodes bend so a straight SHELL (prof 4) skips it. Keeps every
      // "> 0.5 means chamfer" consumer working unchanged.
      if ((i32(prof) & 2) != 0) {
        cpos = textureLoad(data, vec2<i32>(idx, 11 + band), 0).xyz;
      }
    }
    var sd = sdPrim(p, idx, data, r2, prof, cpos, band);
    if (ori) { sd = sdPrimO(p, idx, data, r2, prof, cpos, band); }
    // A SHELL (profile bit 2, value 4) thins the closed base field to a
    // sheet and clips it: abs(dBase) - thick, then a rounded-rim clip against
    // the shell plane. Only shell prims read the two extra rows, and only in
    // a shaped group, so additive prims pay nothing.
    //
    // MUST be a mask, not a "prof >= 4" magnitude test: that only ever meant
    // "shell" while bit 2 (shell) was the highest bit anyone set, so nothing
    // outscored it. A BOX sets bit 3 (value 8) with bit 2 clear, and
    // 8 >= 4 is true — a magnitude test would fold every box as a
    // zero-thickness shell (primShell/primClip are all-zero for a box),
    // instead of the plain body it actually is.
    if ((i32(prof) & 4) != 0) {
      let S2 = textureLoad(data, vec2<i32>(idx, 16 + band), 0);
      let C2 = textureLoad(data, vec2<i32>(idx, 17 + band), 0);
      let W2 = textureLoad(data, vec2<i32>(idx, 20 + band), 0);
      sd = sdShell(sd, p, S2.x, S2.y, S2.z, S2.w, C2.xyz, W2.x, W2.yzw, gWindDrift);
    }
    if (sd < gFoldBest) { gFoldBest = sd; gFoldBestIdx = f32(idx); gFoldBestDistort = grp.z; }
    // Chamfer is profile bit 0 (value 1); bend is bit 1 (value 2); shell is
    // bit 2 (value 4); box is bit 3 (value 8); METAL is bit 4 (value 16),
    // packed by pack.ts and read ONLY in the shading block (it is a
    // material, not a shape — the fold must treat a metal prim exactly like
    // the same prim without it, and every mask here does: 16 & 7 == 0 and
    // 16 & 8 == 0). "& 7 == 1" means "bit 0 set, bits 1 and 2 clear" —
    // exactly chamfer-and-nothing-else, which is what the OLD bounded-window
    // test (prof strictly between one half and one and a half) meant back
    // when prof topped out at 6.
    //
    // MUST be a mask, not that bounded window: a BOX sets bit 3 (value 8),
    // so prof is no longer bounded above by 6, and a chamfered box (prof 9)
    // falls outside that old window entirely — the author writes chamfer=,
    // the row packs it (see pack.ts), and the crease silently never
    // appears. "& 7" ignores bit 3 entirely, so box+chamfer (9 & 7 == 1)
    // chamfers exactly as a non-box chamfered prim does, and every existing
    // case (0,1,2,3,4,6) keeps its current answer — verified by
    // enumeration, see pack.test.ts / the task 5 report.
    if ((i32(prof) & 7) == 1) { d = sminChamfer(d, sd, k); } else { d = smin(d, sd, k); }
  }
  return d;
}
// Tile-list state + fold-argmin state, declared at the TAIL of this source
// because three's wgslFn parser is ^-anchored on "fn" — a var-decl source of
// their own would fail the parse contract. MARCH_BODY fills the tile arrays
// ONCE per pixel (before stepping); every later mapBody call in the same
// fragment — march steps, calcNormal, AO/scatter probes, wound shadow — reads
// them through the same gTileActive gate, so shading sees exactly the field
// the march walked. Fragment invocations start zeroed; the cone pre-pass runs
// in its own invocations where gTileActive stays 0 and the cluster walk
// applies.
var<private> gFoldBest: f32 = 1e9;
var<private> gFoldBestIdx: f32 = -1.0;
// The dominant prim's GROUP DISTORTION factor (grp.z), for MARCH_BODY's
// footprint-AA epsilon (perf round 2 task 6): sdPrimitive under-reports
// Euclid by up to this factor, so the epsilon divides by it. Rides a private
// global rather than mapBody's .w return slot — that slot is owned by the
// wound-pass-r2 chain — under the SAME per-invocation contract as the
// argmin: mapBody resets, foldGroup writes at the argmin, MARCH_BODY reads
// straight after its mapBody call. 1.0 default: groups without distortion
// and the volume branch (which never folds) are exact no-ops.
var<private> gFoldBestDistort: f32 = 1.0;
// WIND DRIFT, metres, world space. A private global rather than another
// parameter on foldGroup because foldGroup is reached from mapBody, which has
// TEN call sites — threading a uniform through all of them to serve one
// primitive kind is the churn ROW_PRIM_WARP's own doc warns about. Both entry
// points (marchBody and coneMarch) set it from the same uniform before they
// fold anything, so the cone pre-pass certifies emptiness against exactly the
// surface the march then walks. A path that forgot to set it would see 0,
// which is the no-wind field — wrong, but never a tear.
var<private> gWindDrift: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
// THE BODY'S NOISE FRAME: (rootShiftX, bodyYaw, rootShiftZ), exactly the
// triple noiseLocal takes. Set from ONE uniform at both entry points rather
// than rebuilt from faceCfg3/lodCfg in each, so the march and the cone
// pre-pass cannot end up anchoring to different frames — a divergence there
// certifies emptiness against a surface the march does not have.
var<private> gBodyAnchor: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
var<private> gTileActive: f32 = 0.0;
var<private> gTileN: f32 = 0.0;
var<private> gTileBounds: array<vec4<f32>, 64>;
var<private> gTileGrp: array<vec4<f32>, 64>;
var<private> gTileBand: array<f32, 64>;

fn applyBones ( dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, boneCount: f32, band: i32 ) -> f32 {
  var d = dIn;
  let first = i32(counts.x);
  let last = first + i32(boneCount);
  for (var i = first; i < last; i = i + 1) {
    if (i >= 128) { break; }
    // SHAPE AND BEND, read exactly as foldGroup reads them.
    //
    // These were hard-coded to -1.0 / 0.0 / vec3(0) — no taper, no profile,
    // no bend — so every bone rendered as a straight untapered capsule while
    // the packer faithfully wrote its shape and bend rows. zombie.blob's six
    // rib pairs author bend= up to 0.162; the GPU drew none of it, and two
    // rounds of owner feedback ("horizontal sticks rather than a cage", then
    // "the ribs are still just straight") were tuning curvature that could
    // not reach the screen.
    //
    // Bones sit outside every cluster/group run, so there is no shaped
    // group flag to hoist the decision onto: the shape row is read for every
    // bone, and the bend row only when the profile bit says bent — the same
    // rule foldGroup applies per prim.
    let T = textureLoad(data, vec2<i32>(i, 10 + band), 0);
    let r2 = T.x;
    let prof = T.y;
    var cpos = vec3<f32>(0.0, 0.0, 0.0);
    if ((i32(prof) & 2) != 0) {
      cpos = textureLoad(data, vec2<i32>(i, 11 + band), 0).xyz;
    }
    if (gDebugMode > 0.5) { gDebugBones = gDebugBones + 1.0; }
    let sd = sdPrim(p, i, data, r2, prof, cpos, band);
    // A hard min, never smin — meat meeting bone should crease. Winning the
    // min claims gFoldBestIdx so shading reads a bone prim's primScale.w.
    if (sd < d) { gFoldBestIdx = f32(i); }
    d = min(d, sd);
  }
  return d;
}

fn mapBody ( p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, counts2: vec4<f32>, noiseCfg: vec4<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, noiseShift: vec3<f32>, volumeTex: texture_3d<f32>, volumePose0: vec4<f32>, volumePose1: vec4<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>, perfCfg: vec4<f32>, woundBound: vec4<f32> ) -> vec4<f32> {
  var d = 1e9;
  // Argmin tracking now lives in private globals shared with foldGroup
  // (above); reset per call — calcNormal calls mapBody four times and each
  // must track its own dominant prim.
  gFoldBest = 1e9;
  gFoldBestIdx = -1.0;
  gFoldBestDistort = 1.0;
  // VOLUME BRANCH (X1.26): volumePose0.w is the enable flag. Enabled, the
  // baked texture IS the body — d comes from sampleHandVolume and the whole
  // primitive/cluster fold is skipped (counts are zeroed by the hands view,
  // but the branch, not the counts, is what keeps it dead). bestIdx stays -1
  // — the dominant-prim index has no meaning against a volume, and faking
  // one would point restPoint at an unwritten prim row; -1 is its documented
  // no-live-prim path, so the noise falls back to the world-frame anchor.
  if (volumePose0.w > 0.5) {
    d = sampleHandVolume(p, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip);
  } else {
  let clusterCount = i32(counts.y);
  let primCount = i32(counts.x);
  if (gTileActive > 0.5) {
    // TILE-LIST PATH (perf task 5 step 2). MARCH_BODY preloaded this pixel's
    // tile entries into gTile* ONCE, before any stepping; every march step
    // folds exactly that list through the SAME foldGroup the cluster walk
    // uses, so the two paths cannot drift. No per-step bound texel reads
    // before the prim work — that is the whole economics argument (the
    // flat-list lesson: per-step reads dominate; this list costs one read
    // per pixel).
    for (var e = 0; e < 64; e = e + 1) {
      if (f32(e) >= gTileN) { break; }
      d = foldGroup(d, p, data, counts, i32(gTileBand[e]), gTileBounds[e], gTileGrp[e]);
    }
  } else {
  // TWO-LEVEL CULL. The outer loop is the cluster (limb) sphere it has
  // always been; a cluster that survives walks its own BOUND GROUPS
  // (pack.ts boundGroups) — contiguous runs of two to four prims in fold
  // order, each with a sphere small enough that a hip pixel no longer folds
  // the shin (the schoolgirl folded 42 of 56 prims per step through the fat
  // limb spheres alone). Measured against a FLAT group list: iterating all
  // ~37 groups per step cost more in bound reads than the culled prims
  // saved (zombie 2.6 -> 4.8 ms); nesting them under the surviving clusters
  // keeps the far-limb cost at the old two texels.
  for (var c = 0; c < 8; c = c + 1) {
    if (c >= clusterCount) { break; }
    let crange = textureLoad(data, vec2<i32>(c, 4), 0);
    if (crange.z < 0.5) { continue; }
    let cbounds = textureLoad(data, vec2<i32>(c, 3), 0);
    let gspan = textureLoad(data, vec2<i32>(c, 15), 0);
    // The CLUSTER test carries the factor too. A factor-free test (as
    // always shipped) was tried for speed and TORE THE FIELD inside wound
    // cavities: there the running d is negative, the threshold collapses,
    // and an anisotropic cluster culls while still inside smin support —
    // drawn as thin black crack seams across the flesh around wounds
    // (owner, 2026-08-23). The factor makes a plate-bearing cluster
    // (schoolgirl sole: 22x) nearly uncullable, but its GROUPS still cull
    // soundly below, so the cost is a few texel reads, not a full fold.
    if (length(p - cbounds.xyz) - cbounds.w > (d + counts.w * 4.0) * gspan.z) { continue; }
    let gFirst = i32(gspan.x);
    let gCount = i32(gspan.y);
  for (var gi = 0; gi < 64; gi = gi + 1) {
    if (gi >= gCount) { break; }
    let g = gFirst + gi;
    let range = textureLoad(data, vec2<i32>(g, 14), 0);
    let bounds = textureLoad(data, vec2<i32>(g, 13), 0);
    // range.w is a BITFIELD, not a bool: 1 = oriented group, 2 = some prim
    // here is tapered or chamfered. Both are per-group hoists of a per-prim
    // decision, for the reason sdPrimO's header measures — paying an extra
    // textureLoad for EVERY prim cost +10-18% frame time. A group with no
    // shaped prims never touches ROW_PRIM_SHAPE at all. The prim loop,
    // sphere cull and argmin tracking all live in foldGroup (above), shared
    // with the tile-list path.
    d = foldGroup(d, p, data, counts, 0, bounds, range);
  }
  }
  }
  }
  let carved = applyCarves(d, p, data, counts);
  let dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2, perfCfg, woundBound);
  var dmg = dmgRes.x;
  let nearWound = dmgRes.y;
  // Inside-flesh rows, gated on nearWound (see APPLY_BONES): ORGANS, plus
  // bones only when packBones is on (the shipped default until bone tubes
  // ship). Outside a wound the call is provably a no-op — the inside-flesh
  // rows are contained inside flesh — so skipping it is exact, not an
  // approximation. counts2.x carries boneCount: counts was already full and
  // woundCfg2.w is the volume hitEps override, not spare. counts2.y is the
  // BARE-BONES bypass (melt task 5): the gate's proof ("bones are contained
  // in flesh") stops holding the moment flesh moves without a wound — a
  // melting body sags off its own skeleton, and a bone-only chunk (a
  // released skeleton group) has no flesh and no wound to be near, so gated
  // it would march an EMPTY field.
  if ((nearWound > 0.5 || counts2.y > 0.5) && counts2.x > 0.0) {
    dmg = applyBones(dmg, p, data, counts, counts2.x, 0);
  }
  // bestIdx is read AFTER the bone fold so a bone that won the min is the
  // reported dominant prim — shading identifies bone via primScale.w == 4.
  // Kept as the bare f32 global so the returns below stay paren-free.
  let bestIdx = gFoldBestIdx;
  // Silhouette detail. The MARCH passes 0.0 here and only calcNormal passes a
  // real amplitude, so this term no longer displaces the surface — it survives
  // solely to give calcNormal's tetrahedron differences something to
  // differentiate, which warps the shading normal. See MARCH_BODY.
  //
  // Keeping it expressed as a field displacement rather than as a hand-written
  // gradient is deliberate: calcNormal returns normalize(grad(d + h)), which is
  // EXACTLY the normal the displaced surface had before. So the shading is
  // unchanged to the precision of the differencing, and only the silhouette
  // and the hit position lose the detail — which is the whole trade.
  //
  // The guard stays and now matters more than ever, since the march relies on
  // this call costing nothing: fbm is two 3D value-noise lookups, sixteen
  // hash13 calls, and without the branch a zero amplitude still pays in full.
  if (noiseCfg.x <= 0.0) { return vec4<f32>(dmg, bestIdx, nearWound, carved); }
  // NOISE ANCHOR (motion-polish task 6): the fbm samples the DOMINANT prim's
  // REST frame — the texture is baked into the model, so gait bob, arm raises
  // and jiggle carry their skin instead of sliding through the world-frame
  // field. restPoint falls back to the old root-shift anchor (noiseLocal)
  // when there is no live prim or the rest rows were never written.
  let anchor = restPoint(p, data, i32(bestIdx), noiseLocal(p, noiseShift));
  // Hoisted so the return carries no nested parens — the ramp test lexes the
  // return site for the word 'carved' and a paren would truncate the match.
  let detail = fbm(anchor * 3.0) * noiseCfg.x;
  return vec4<f32>(dmg + detail, bestIdx, nearWound, carved);
}

fn calcNormal ( p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, counts2: vec4<f32>, noiseCfg: vec4<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, noiseShift: vec3<f32>, volumeTex: texture_3d<f32>, volumePose0: vec4<f32>, volumePose1: vec4<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>, perfCfg: vec4<f32>, woundBound: vec4<f32> ) -> vec3<f32> {
  let e = vec2<f32>(1.0, -1.0) * 0.0015;
  return normalize(
    e.xyy * mapBody(p + e.xyy, data, counts, counts2, noiseCfg, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg, woundBound).x +
    e.yyx * mapBody(p + e.yyx, data, counts, counts2, noiseCfg, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg, woundBound).x +
    e.yxy * mapBody(p + e.yxy, data, counts, counts2, noiseCfg, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg, woundBound).x +
    e.xxx * mapBody(p + e.xxx, data, counts, counts2, noiseCfg, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg, woundBound).x);
}

fn woundShadow ( p: vec3<f32>,
  L: vec3<f32>,
  k: f32,
  data: texture_2d<f32>,
  counts: vec4<f32>,
  counts2: vec4<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  volumeTex: texture_3d<f32>,
  volumePose0: vec4<f32>,
  volumePose1: vec4<f32>,
  volumeMin: vec3<f32>,
  volumeInvExtent: vec3<f32>,
  volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>,
  perfCfg: vec4<f32>,
  woundBound: vec4<f32> ) -> f32 {
  var res = 1.0;
  var t = 0.02;
  for (var i = 0; i < 14; i = i + 1) {
    let h = mapBody(p + L * t, data, counts, counts2, vec4<f32>(0.0), woundCfg, woundCfg2, vec3<f32>(0.0, 0.0, 0.0), volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg, woundBound).x;
    res = min(res, k * h / t);
    if (res < 0.02 || t > 0.4) { break; }
    t = t + clamp(h, 0.01, 0.06);
  }
  return clamp(res, 0.0, 1.0);
}

fn texel ( tex: texture_2d<f32>, uv: vec2<f32> ) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(tex, 0));
  let c = clamp(vec2<i32>(floor(uv * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  return textureLoad(tex, c, 0);
}

fn flicker ( t: f32, amt: f32 ) -> f32 {
  let a = sin(t * 11.3) * 0.5 + 0.5;
  let b = sin(t * 23.7 + 1.3) * 0.5 + 0.5;
  let c = sin(t * 3.1 + 0.7) * 0.5 + 0.5;
  let f = a * 0.35 + b * 0.25 + c * 0.40;
  // Biased upward so it mostly burns and only occasionally dips, rather than
  // spending half its time dark.
  return mix(1.0, 0.45 + f * 0.75, amt);
}

fn softShoulder ( x: f32, knee: f32 ) -> f32 {
  // Below the knee, identity — the whole midtone range is untouched, so a
  // body out of the beam shades exactly as it always did. Above it, compress
  // [knee, inf) into [knee, 1) with an exponential that is C1 at the join and
  // strictly monotonic, which is the property that matters here: monotonic
  // means two surfaces that differed in brightness still differ afterwards.
  // That is what keeps a wound crater darker than the skin around it when the
  // flashlight is pointed straight at the body, instead of both clipping to
  // white and the damage vanishing at exactly the range you aim from.
  if (x <= knee) { return x; }
  let head = max(1.0 - knee, 1e-4);
  return knee + head * (1.0 - exp(-(x - knee) / head));
}

fn wallContribution ( c: vec3<f32>,
  p: vec3<f32>,
  n: vec3<f32>,
  color: vec3<f32> ) -> vec3<f32> {
  let d = c - p;
  let dist = length(d);
  if (dist < 1e-5) { return vec3<f32>(0.0, 0.0, 0.0); }
  let ndl = max(dot(d / dist, n), 0.0);
  let t = dist / 1.6;
  return color * (ndl / (1.0 + t * t));
}

fn ambientAt ( p: vec3<f32>,
  n: vec3<f32>,
  boxMin: vec3<f32>,
  boxMax: vec3<f32>,
  wallNegX: vec3<f32>,
  wallPosX: vec3<f32>,
  wallNegY: vec3<f32>,
  wallPosY: vec3<f32>,
  wallNegZ: vec3<f32>,
  wallPosZ: vec3<f32>,
  bounceCfg: vec4<f32>,
  fill: f32,
  keyColor: vec3<f32> ) -> vec3<f32> {
  // bounceCfg: x probeWeight, y ambientGain, z ceilingEnabled, w chromaGain.
  let flat = fill * keyColor;

  // EXACT early out, not an optimisation. At probeWeight 0 the caller's
  // expression must collapse to precisely what it was before bounce
  // existed — mixing toward the same value would not be bit-identical, and
  // every owner-blessed visual is calibrated against the old numbers.
  if (bounceCfg.x <= 0.0) { return flat; }

  var acc = vec3<f32>(0.0, 0.0, 0.0);
  let clamped = clamp(p, boxMin, boxMax);

  // Six walls, unrolled. Each is the closest point on that wall's rectangle
  // to p: clamp into the box, then pin the wall's own axis to its plane.
  // wallDir handles the rest — pure arithmetic, no field, no texture.
  let cNegX = vec3<f32>(boxMin.x, clamped.y, clamped.z);
  let cPosX = vec3<f32>(boxMax.x, clamped.y, clamped.z);
  let cNegY = vec3<f32>(clamped.x, boxMin.y, clamped.z);
  let cPosY = vec3<f32>(clamped.x, boxMax.y, clamped.z);
  let cNegZ = vec3<f32>(clamped.x, clamped.y, boxMin.z);
  let cPosZ = vec3<f32>(clamped.x, clamped.y, boxMax.z);

  acc = acc + wallContribution(cNegX, p, n, wallNegX);
  acc = acc + wallContribution(cPosX, p, n, wallPosX);
  acc = acc + wallContribution(cNegY, p, n, wallNegY);
  acc = acc + wallContribution(cPosY, p, n, wallPosY) * step(0.5, bounceCfg.z);
  acc = acc + wallContribution(cNegZ, p, n, wallNegZ);
  acc = acc + wallContribution(cPosZ, p, n, wallPosZ);

  // COLOUR, NOT BRIGHTNESS. Renormalise to unit luminance so only the hue
  // of the accumulation survives; the LEVEL comes from the flat term it is
  // replacing, so the shadow side stays exactly as dark as it is today and
  // only its hue changes. practical-hard-key is 2.4 key against 0.06 fill,
  // and lifting that fill is what would spend the blowout the preset was
  // tuned for. A room with nothing lit to offer falls back to the flat tint.
  let lum = dot(acc, vec3<f32>(0.2126, 0.7152, 0.0722));
  let tint = select(keyColor, acc / max(lum, 1e-5), lum > 1e-5);

  // CHROMA (bounceCfg.w). Extrapolate the unit-luminance tint away from
  // neutral so a mostly-white room still delivers hue. Both ends have
  // luminance 1 and luminance is linear, so this is level-preserving at any
  // gain — unlike ambientGain it does NOT break "colour, not brightness", it
  // is that rule taken literally. Clamp then renormalise: past neutral the
  // weak channels go negative, and a bare clamp would quietly ADD level.
  var hue = vec3<f32>(1.0, 1.0, 1.0) + (tint - vec3<f32>(1.0, 1.0, 1.0)) * bounceCfg.w;
  hue = max(hue, vec3<f32>(0.0, 0.0, 0.0));
  let hueLum = dot(hue, vec3<f32>(0.2126, 0.7152, 0.0722));
  hue = select(tint, hue / hueLum, hueLum > 1e-5);

  let w = clamp(bounceCfg.x, 0.0, 1.0);
  // The level that survives is the LUMINANCE of the flat term ('fill *
  // keyColor'), so probeWeight shifts hue only and the brightness stays put.
  // ambientGain > 1 deliberately breaks the house rule — it is the control
  // for testing whether the look actually wants genuine radiosity lift.
  let g = fill * dot(keyColor, vec3<f32>(0.2126, 0.7152, 0.0722)) * bounceCfg.y;
  return mix(flat, hue * g, w);
}

fn levelShadow ( p: vec3<f32>, n: vec3<f32>, shadowTex: texture_depth_2d, shadowMat: mat4x4<f32>, cfg: vec4<f32> ) -> f32 {
  if (cfg.x < 0.5) { return 1.0; }
  let sp = shadowMat * vec4<f32>(p + n * cfg.y, 1.0);
  let uv = sp.xy / sp.w;
  let z = sp.z / sp.w - cfg.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || z > 1.0) { return 1.0; }
  let dims = vec2<f32>(textureDimensions(shadowTex, 0));
  let base = uv * dims - vec2<f32>(0.5, 0.5);
  var lit = 0.0;
  for (var dy = 0; dy < 2; dy = dy + 1) {
    for (var dx = 0; dx < 2; dx = dx + 1) {
      let c = clamp(vec2<i32>(floor(base)) + vec2<i32>(dx, dy), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
      let d = textureLoad(shadowTex, c, 0);
      lit = lit + select(0.0, 1.0, z <= d);
    }
  }
  return lit * 0.25;
}

fn depthPreFetch ( tex: texture_2d<f32>,
  screenUV: vec2<f32>,
  cfg: vec4<f32> ) -> f32 {
  if (cfg.x < 0.5) { return 0.0; }
  let dims = vec2<f32>(textureDimensions(tex, 0));
  let c = clamp(vec2<i32>(floor(screenUV * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let v = textureLoad(tex, c, 0).x;
  if (v <= 0.0) { return 0.0; }
  return v;
}

fn ngReset (  ) -> f32 {
  gNgReason = 0;
  return 0.0;
}
var<private> gNgReason: i32;

fn ngQRot ( q: vec4<f32>, v: vec3<f32> ) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + t * q.w + cross(q.xyz, t);
}

fn ngCapsule ( p: vec3<f32>,
  a: vec3<f32>,
  b: vec3<f32>,
  r: f32,
  scale: vec3<f32> ) -> vec4<f32> {
  if (any(scale <= vec3<f32>(0.0))) {
    if (gNgReason == 0) { gNgReason = 1; }
    return vec4<f32>(0.0);
  }
  let invScale = 1.0 / scale;
  let q = p * invScale;
  let aa = a * invScale;
  let bb = b * invScale;
  let ab = bb - aa;
  let ap = q - aa;
  let ab2 = dot(ab, ab);
  let t = select(clamp(dot(ap, ab) / ab2, 0.0, 1.0), 0.0, ab2 == 0.0);
  let v = q - (aa + ab * t);
  let vLen = length(v);
  let minScale = min(scale.x, min(scale.y, scale.z));
  let d = (vLen - r) * minScale;
  if (vLen < 1e-9) {
    if (gNgReason == 0) { gNgReason = 2; }
    return vec4<f32>(d, 0.0, 0.0, 0.0);
  }
  return vec4<f32>(d, (v / vLen) * invScale * minScale);
}

fn ngCapsuleOriented ( p: vec3<f32>,
  a: vec3<f32>,
  b: vec3<f32>,
  r: f32,
  scale: vec3<f32>,
  quat: vec4<f32> ) -> vec4<f32> {
  let quatLen2 = dot(quat, quat);
  if (abs(quatLen2 - 1.0) > 1e-3) {
    if (gNgReason == 0) { gNgReason = 1; }
    return vec4<f32>(0.0);
  }
  let mid = (a + b) * 0.5;
  let invQuat = vec4<f32>(-quat.xyz, quat.w);
  let local = ngCapsule(
    mid + ngQRot(invQuat, p - mid),
    mid + ngQRot(invQuat, a - mid),
    mid + ngQRot(invQuat, b - mid),
    r,
    scale);
  return vec4<f32>(local.x, ngQRot(quat, local.yzw));
}

fn ngSmin ( a: vec4<f32>,
  b: vec4<f32>,
  kIn: f32 ) -> vec4<f32> {
  let K = kIn * 4.0;
  if (K <= 0.0) {
    if (a.x == b.x) {
      if (gNgReason == 0) { gNgReason = 3; }
      return vec4<f32>(a.x, 0.0, 0.0, 0.0);
    }
    return select(b, a, a.x < b.x);
  }
  let h = max(K - abs(a.x - b.x), 0.0) / K;
  let wa = select(h * 0.5, 1.0 - h * 0.5, a.x <= b.x);
  return vec4<f32>(min(a.x, b.x) - h * h * K * 0.25,
                   wa * a.yzw + (1.0 - wa) * b.yzw);
}

fn ngSmax ( a: vec4<f32>,
  b: vec4<f32>,
  kIn: f32 ) -> vec4<f32> {
  let folded = ngSmin(-a, -b, kIn);
  return -folded;
}

fn ngWound ( dIn: vec4<f32>, base: vec4<f32>, v: vec3<f32>, depth: f32, cap: vec4<f32>, blend: f32, rim: vec3<f32> ) -> vec4<f32> {
  let r = length(v);
  let sphere = depth - r;
  let slab = cap.w - dot(v, cap.xyz);
  if (r < 1e-9) { gNgReason = 2; }
  if (abs(sphere - slab) < 1e-7) { gNgReason = 3; }
  let radial = v / max(r, 1e-9);
  let cutter = vec4<f32>(min(sphere, slab), select(-cap.xyz, -radial, sphere < slab));
  var d = ngSmax(dIn, cutter, blend);
  let amp = rim.z;
  if (amp <= 0.0) { return d; }
  let x = (r - rim.x) / rim.y;
  let bump = exp(-x * x) * amp;
  let m = 1.0 - smoothstep(-amp * 0.3, amp * 0.7, base.x);
  let u = clamp((base.x + 0.3 * amp) / amp, 0.0, 1.0);
  let gradBump = bump * (-2.0 * x / rim.y) * radial;
  let gradGate = -(6.0 * u * (1.0 - u) / amp) * base.yzw;
  return vec4<f32>(d.x - bump * m, d.yzw - m * gradBump - bump * gradGate);
}

fn ngExcluded ( p: vec3<f32>, bounds: vec4<f32>, grp: vec4<f32>, data: texture_2d<f32>, band: i32 ) -> f32 {
  // The enclosing sphere minus R contains the entire stencil. OUTSIDE it,
  // each supported capsule's field is >= Euclidean exterior / distortion.
  // Inside an enclosing sphere no lower field bound follows from that sphere.
  let exterior = length(p - bounds.xyz) - bounds.w - 0.002598076211;
  let lower = select(-1e9, exterior / max(grp.z, 1.0), exterior > 0.0);
  gNgExcluded = min(gNgExcluded, lower);
  // Bounds of unsupported profiles do not carry a proven field/Lipschitz
  // relationship here. Do not bless an unsupported skipped contributor.
  if ((i32(grp.w + 0.5) & 2) != 0) {
    for (var i = 0; i < i32(grp.y); i = i + 1) {
      let idx = i32(grp.x) + i;
      let S = textureLoad(data, vec2<i32>(idx, 2 + band), 0);
      if (S.w > 0.5) { continue; }
      let T = textureLoad(data, vec2<i32>(idx, 10 + band), 0);
      if (T.x >= 0.0 || (i32(T.y) & 47) != 0) { gNgReason = 1; }
    }
  }
  return lower;
}
var<private> gNgBest: f32;
var<private> gNgSecond: f32;
var<private> gNgOwner: i32;
var<private> gNgExcluded: f32;

fn ngGroup ( dIn: vec4<f32>, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, band: i32, bounds: vec4<f32>, grp: vec4<f32> ) -> vec4<f32> {
  var d = dIn;
  if (length(p - bounds.xyz) - bounds.w > (d.x + counts.w * 4.0) * grp.z) {
    let excluded = ngExcluded(p, bounds, grp, data, band);
    return d;
  }
  let flags = i32(grp.w + 0.5);
  for (var i = 0; i < 64; i = i + 1) {
    if (i >= i32(grp.y)) { break; }
    let idx = i32(grp.x) + i;
    if (idx >= i32(counts.x)) { break; }
    let S = textureLoad(data, vec2<i32>(idx, 2 + band), 0);
    if (S.w > 0.5) { continue; }
    if ((flags & 2) != 0) {
      let T = textureLoad(data, vec2<i32>(idx, 10 + band), 0);
      // Metal is bit 16 and has no geometric effect. All other profiles,
      // including strand bit 32, are unsupported in the intact phase.
      if (T.x >= 0.0 || (i32(T.y) & 47) != 0) { gNgReason = 1; return d; }
    }
    let A = textureLoad(data, vec2<i32>(idx, 0 + band), 0);
    let B = textureLoad(data, vec2<i32>(idx, 1 + band), 0);
    var dg = ngCapsule(p, A.xyz, B.xyz, A.w, S.xyz);
    if ((flags & 1) != 0) {
      let O = textureLoad(data, vec2<i32>(idx, 7 + band), 0);
      // Production leaves near-identity quaternions untouched too.
      if (abs(1.0 - O.w) > 1e-6) { dg = ngCapsuleOriented(p, A.xyz, B.xyz, A.w, S.xyz, O); }
    }
    if (dg.x < gNgBest) {
      gNgSecond = gNgBest;
      gNgBest = dg.x;
      gNgOwner = idx;
    } else { gNgSecond = min(gNgSecond, dg.x); }
    d = ngSmin(d, dg, B.w);
  }
  return d;
}

fn ngWoundLip ( base: f32, r: f32, rim: vec3<f32> ) -> f32 {
  if (rim.z <= 0.0) { return 0.0; }
  let R = 0.002598076211;
  let lo = max(0.0, r - R);
  let hi = r + R;
  let xlo = (lo - rim.x) / rim.y;
  let xhi = (hi - rim.x) / rim.y;
  let amin = select(min(abs(xlo), abs(xhi)), 0.0, xlo <= 0.0 && xhi >= 0.0);
  let amax = max(abs(xlo), abs(xhi));
  let critical = clamp(0.7071067812, amin, amax);
  let bumpMax = rim.z * exp(-amin * amin);
  let radialLip = rim.z / rim.y * 2.0 * critical * exp(-critical * critical);
  let mMax = 1.0 - smoothstep(-0.3 * rim.z, 0.7 * rim.z, base - R);
  let gateLip = select(0.0, 1.5 / rim.z, base + R > -0.3 * rim.z && base - R < 0.7 * rim.z);
  return radialLip * mMax + bumpMax * gateLip;
}

fn ngWounds ( base: vec4<f32>, p: vec3<f32>, data: texture_2d<f32>, cfg: vec4<f32>, cfg2: vec4<f32>, perf: vec4<f32>, bound: vec4<f32> ) -> vec4<f32> {
  gNgLip = 1.0;
  gNgNear = 0.0;
  var d = base;
  if (cfg.x < 0.5) { return d; }
  let R = 0.002598076211;
  let boundDistance = length(p - bound.xyz);
  if (abs(boundDistance - bound.w) <= R) { gNgReason = 3; }
  if (boundDistance > bound.w) { return d; }
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= i32(cfg.x)) { break; }
    let w = textureLoad(data, vec2<i32>(i, 5), 0);
    let v = p - w.xyz;
    let r = length(v);
    let reach = w.w * max(2.0, 2.0 * cfg.w + 3.0 * cfg2.x) + 4.0 * cfg.y + 0.25;
    if (perf.y > 0.5) {
      if (abs(r - reach) <= R) { gNgReason = 3; }
      if (r > reach) { continue; }
    }
    let wMeta = textureLoad(data, vec2<i32>(i, 6), 0);
    let capRow = textureLoad(data, vec2<i32>(i, 18), 0);
    let cap = vec4<f32>(capRow.xyz, select(1e5, capRow.w, capRow.w > 0.0));
    let burn = wMeta.x > 1.5;
    let depth = select(w.w, w.w * 0.35 * clamp(wMeta.y, 0.0, 1.0), burn);
    let rim = vec3<f32>(depth * cfg.w * wMeta.w, max(depth * cfg2.x, 1e-4), depth * cfg.z * wMeta.z * select(1.0, 0.25, burn));
    if (r <= R) { gNgReason = 2; }
    if (abs(r - 2.0 * depth) <= R) { gNgReason = 3; }
    let cutter = min(depth - r, cap.w - dot(v, cap.xyz));
    if (abs((depth - r) - (cap.w - dot(v, cap.xyz))) <= (1.0 + length(cap.xyz)) * R && cutter + (1.0 + gNgLip) * R >= d.x - 4.0 * cfg.y) { gNgReason = 3; }
    if (cfg.y <= 0.0 && abs(d.x - cutter) <= (gNgLip + max(1.0, length(cap.xyz))) * R) { gNgReason = 3; }
    d = ngWound(d, base, v, depth, cap, cfg.y, rim);
    gNgLip = max(gNgLip, max(1.0, length(cap.xyz))) + ngWoundLip(base.x, r, rim);
    if (r < 2.0 * depth) { gNgNear = 1.0; }
  }
  return d;
}
var<private> gNgLip: f32;
var<private> gNgNear: f32;

fn ngInternalLower ( p: vec3<f32>, a: vec4<f32>, b: vec4<f32>, scale: vec3<f32>, shape: vec4<f32>, control: vec3<f32> ) -> f32 {
  if (any(scale <= vec3<f32>(0.0)) || (i32(shape.y) & 44) != 0) { return -1e9; }
  let aa = a.xyz / scale;
  let bb = b.xyz / scale;
  var lo = min(aa, bb);
  var hi = max(aa, bb);
  if ((i32(shape.y) & 2) != 0) {
    lo = min(lo, control / scale);
    hi = max(hi, control / scale);
  }
  let exterior = length(max(max(lo - p / scale, p / scale - hi), vec3<f32>(0.0)));
  return (exterior - max(a.w, shape.x)) * min(scale.x, min(scale.y, scale.z)) - 0.002598076211;
}

fn ngBones ( flesh: vec4<f32>, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, count: f32 ) -> vec4<f32> {
  let R = 0.002598076211;
  var d = flesh;
  var best = 1e9;
  var second = 1e9;
  var excluded = 1e9;
  var owner = -1;
  var bestDg = vec4<f32>(1e9, 0.0, 0.0, 0.0);
  for (var i = i32(counts.x); i < i32(counts.x + count); i = i + 1) {
    if (i >= 128) { break; }
    let T = textureLoad(data, vec2<i32>(i, 10), 0);
    let A = textureLoad(data, vec2<i32>(i, 0), 0);
    let B = textureLoad(data, vec2<i32>(i, 1), 0);
    let S = textureLoad(data, vec2<i32>(i, 2), 0);
    var control = vec3<f32>(0.0);
    if ((i32(T.y) & 2) != 0) { control = textureLoad(data, vec2<i32>(i, 11), 0).xyz; }
    // Evaluate every internal scalar in the same order as applyBones. An
    // unsupported operation may be excluded only by a full-ball bound.
    let sd = sdPrim(p, i, data, T.x, T.y, control, 0);
    if (T.x >= 0.0 || (i32(T.y) & 47) != 0) {
      excluded = min(excluded, ngInternalLower(p, A, B, S.xyz, T, control));
      if (sd < d.x) { gNgReason = 1; }
    } else {
      let savedReason = gNgReason;
      let candidate = ngCapsule(p, A.xyz, B.xyz, A.w, S.xyz);
      if (gNgReason != savedReason && sd - R > d.x + gNgLip * R) { gNgReason = savedReason; }
      if (sd < best) { second = best; best = sd; owner = i; bestDg = candidate; }
      else { second = min(second, sd); }
    }
    d.x = min(d.x, sd);
  }
  if (best < flesh.x) {
    if (flesh.x - best <= (gNgLip + 1.0) * R || second - best <= 2.0 * R) { gNgReason = 4; }
    if (excluded <= best + R) { gNgReason = 1; }
    gNgOwner = owner;
    return bestDg;
  }
  if (best - flesh.x <= (gNgLip + 1.0) * R) { gNgReason = 4; }
  if (excluded <= flesh.x + gNgLip * R) { gNgReason = 1; }
  return flesh;
}

fn ngBody ( p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, counts2: vec4<f32>, noiseCfg: vec4<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, noiseShift: vec3<f32>, volumeTex: texture_3d<f32>, volumePose0: vec4<f32>, volumePose1: vec4<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>, perfCfg: vec4<f32>, woundBound: vec4<f32> ) -> vec4<f32> {
  let resetMarker = ngReset();
  gNgBest = 1e9;
  gNgSecond = 1e9;
  gNgOwner = -1;
  gNgExcluded = 1e9;
  var d = vec4<f32>(1e9, 0.0, 0.0, 0.0);
  if (volumePose0.w > 0.5) { gNgReason = 6; return d; }
  if (counts2.y > 0.5) { gNgReason = 1; return d; }
  let R = 0.002598076211;
  if (gTileActive > 0.5) {
    for (var e = 0; e < 64; e = e + 1) {
      if (f32(e) >= gTileN) { break; }
      // The per-view field uses band zero. Foreign atlas entries require a
      // separate rest-frame/owner contract; do not silently mis-anchor them.
      if (gTileBand[e] != 0.0) { gNgReason = 1; return d; }
      d = ngGroup(d, p, data, counts, 0, gTileBounds[e], gTileGrp[e]);
    }
  }
  for (var c = 0; c < 8; c = c + 1) {
    if (c >= i32(counts.y)) { break; }
    let crange = textureLoad(data, vec2<i32>(c, 4), 0);
    if (crange.z < 0.5) { continue; }
    let cbounds = textureLoad(data, vec2<i32>(c, 3), 0);
    let gspan = textureLoad(data, vec2<i32>(c, 15), 0);
    let clusterSkipped = length(p - cbounds.xyz) - cbounds.w > (d.x + counts.w * 4.0) * gspan.z;
    for (var gi = 0; gi < 64; gi = gi + 1) {
      if (gi >= i32(gspan.y)) { break; }
      let g = i32(gspan.x) + gi;
      let grp = textureLoad(data, vec2<i32>(g, 14), 0);
      let bounds = textureLoad(data, vec2<i32>(g, 13), 0);
      if (gTileActive > 0.5) {
        var listed = false;
        for (var e = 0; e < 64; e = e + 1) {
          if (f32(e) >= gTileN) { break; }
          if (gTileGrp[e].x == grp.x && gTileBand[e] == 0.0) { listed = true; break; }
        }
        // Tile culling is not itself a stencil-owner certificate. Explicitly
        // include omitted candidates via their group bounds at this hit.
        if (!listed) { let excluded = ngExcluded(p, bounds, grp, data, 0); }
      } else if (clusterSkipped) {
        let excluded = ngExcluded(p, bounds, grp, data, 0);
      } else { d = ngGroup(d, p, data, counts, 0, bounds, grp); }
    }
  }
  if (gNgReason != 0) { return d; }
  if (gNgOwner < 0) { gNgReason = 7; return d; }
  // Preserve the production cluster/primitive carve order. Smooth max of
  // 1-Lipschitz capsule fields remains 1-Lipschitz.
  if (counts.z > 0.5) {
    for (var c = 0; c < 8; c = c + 1) {
      if (c >= i32(counts.y)) { break; }
      let crange = textureLoad(data, vec2<i32>(c, 4), 0);
      if (crange.z < 0.5) { continue; }
      for (var i = 0; i < 64; i = i + 1) {
        if (i >= i32(crange.y)) { break; }
        let idx = i32(crange.x) + i;
        if (idx >= i32(counts.x)) { break; }
        let S = textureLoad(data, vec2<i32>(idx, 2), 0);
        if (S.w < 0.5 || (S.w > 1.5 && S.w < 2.5)) { continue; }
        if (S.w >= 3.5) { continue; }
        if (S.w > 2.5) { gNgReason = 1; return d; }
        let T = select(vec4<f32>(-1.0, 0.0, 0.0, 0.0), textureLoad(data, vec2<i32>(idx, 10), 0), (i32(crange.w + 0.5) & 2) != 0);
        if (T.x >= 0.0 || (i32(T.y) & 47) != 0) { gNgReason = 1; return d; }
        let A = textureLoad(data, vec2<i32>(idx, 0), 0);
        let B = textureLoad(data, vec2<i32>(idx, 1), 0);
        let O = textureLoad(data, vec2<i32>(idx, 7), 0);
        var cutter = ngCapsule(p, A.xyz, B.xyz, A.w, S.xyz);
        if ((i32(crange.w + 0.5) & 1) != 0 && abs(1.0 - O.w) > 1e-6) { cutter = ngCapsuleOriented(p, A.xyz, B.xyz, A.w, S.xyz, O); }
        if (B.w <= 0.0 && abs(d.x + cutter.x) <= 2.0 * R) { gNgReason = 3; return d; }
        d = ngSmax(d, -cutter, B.w);
      }
    }
  }
  d = ngWounds(d, p, data, woundCfg, woundCfg2, perfCfg, woundBound);
  if (gNgReason != 0) { return d; }
  if (gNgNear > 0.5 && counts2.x > 0.0) { d = ngBones(d, p, data, counts, counts2.x); }
  if (gNgReason != 0) { return d; }
  if (noiseCfg.x > 0.0 && gNgOwner < i32(counts.x) && (gNgSecond - gNgBest <= 2.0 * R || gNgExcluded <= gNgBest + R)) {
    gNgReason = 4;
  }
  return d;
}

fn ngDetail ( p: vec3<f32>, data: texture_2d<f32>, owner: i32, noiseShift: vec3<f32>, amplitude: f32 ) -> vec3<f32> {
  if (amplitude <= 0.0) { return vec3<f32>(0.0); }
  let k1 = vec3<f32>(1.0, -1.0, -1.0);
  let k2 = vec3<f32>(-1.0, -1.0, 1.0);
  let k3 = vec3<f32>(-1.0, 1.0, -1.0);
  let k4 = vec3<f32>(1.0, 1.0, 1.0);
  let p1 = p + k1 * 0.0015;
  let p2 = p + k2 * 0.0015;
  let p3 = p + k3 * 0.0015;
  let p4 = p + k4 * 0.0015;
  // Match mapBody's frequency, multiplication order, owner frame and eps.
  let h1 = fbm(restPoint(p1, data, owner, noiseLocal(p1, noiseShift)) * 3.0) * amplitude;
  let h2 = fbm(restPoint(p2, data, owner, noiseLocal(p2, noiseShift)) * 3.0) * amplitude;
  let h3 = fbm(restPoint(p3, data, owner, noiseLocal(p3, noiseShift)) * 3.0) * amplitude;
  let h4 = fbm(restPoint(p4, data, owner, noiseLocal(p4, noiseShift)) * 3.0) * amplitude;
  return (k1 * h1 + k2 * h2 + k3 * h3 + k4 * h4) / (4.0 * 0.0015);
}

fn sdfSurfaceStateReset (  ) -> f32 {
  gSdfAlbedoRough = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  gSdfNormalMetal = vec4<f32>(0.0, 0.0, 1.0, 0.0);
  gSdfEmissionClass = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  return 0.0;
}
var<private> gSdfAlbedoRough: vec4<f32>;
var<private> gSdfNormalMetal: vec4<f32>;
var<private> gSdfEmissionClass: vec4<f32>;

fn marchSurface ( worldPos: vec3<f32>,
  camPos: vec3<f32>,
  data: texture_2d<f32>,
  volumeTex: texture_3d<f32>,
  faceTex: texture_2d<f32>,
  volumePose0: vec4<f32>,
  volumePose1: vec4<f32>,
  volumeMin: vec3<f32>,
  volumeInvExtent: vec3<f32>,
  volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>,
  counts: vec4<f32>,
  counts2: vec4<f32>,
  marchCfg: vec3<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  baseColor: vec3<f32>,
  deepColor: vec3<f32>,
  charColor: vec3<f32>,
  lightDir: vec3<f32>,
  keyColor: vec3<f32>,
  lightCfg: vec2<f32>,
  spotPos: vec3<f32>,
  spotAxis: vec3<f32>,
  spotCfg: vec4<f32>,
  spotCfg2: vec4<f32>,
  spotColor: vec3<f32>,
  surfCfg: vec4<f32>,
  surfCfg2: vec4<f32>,
  surfCfg3: vec4<f32>,
  mottleColor: vec3<f32>,
  fatColor: vec3<f32>,
  boneColor: vec3<f32>,
  organColor: vec3<f32>,
  organAmp: f32,
  visceraColor: vec3<f32>,
  visceraDepth: f32,
  faceCfg: vec4<f32>,
  faceCfg2: vec4<f32>,
  faceCfg3: vec4<f32>,
  faceProj: vec4<f32>,
  faceAtlas: vec4<f32>,
  headCentre: vec3<f32>,
  headAxes: vec3<f32>,
  headQuat: vec4<f32>,
  faceGlowColor: vec3<f32>,
  lodCfg: vec4<f32>,
  woundShadowCfg: vec2<f32>,
  bounceCfg: vec4<f32>,
  boxMin: vec3<f32>,
  boxMax: vec3<f32>,
  wallNegX: vec3<f32>,
  wallPosX: vec3<f32>,
  wallNegY: vec3<f32>,
  wallPosY: vec3<f32>,
  wallNegZ: vec3<f32>,
  wallPosZ: vec3<f32>,
  aaCfg: vec2<f32>,
  debugCfg: vec2<f32>,
  tileHdr: ptr<storage, array<vec2<u32>>, read>,
  tileEnt: ptr<storage, array<vec4<f32>>, read>,
  tileCfg: vec4<f32>,
  screenUV: vec2<f32>,
  startT: f32,
  occT: f32,
  shellIn: f32,
  shellOut: f32,
  perfCfg: vec4<f32>,
  prevT: f32,
  bodyCentre: vec3<f32>,
  bodyHalf: vec3<f32>,
  // Melt progress in x, yzw spare (zombie melt task 6). Zero everywhere but a
  // melting body and its released bone chunks; the flesh-only wet-red ramp
  // below is bit-identical to the pre-melt shader while it is 0.
  meltCfg: vec4<f32>,
  // Level-only shadow (perf round 2 task 7) — bound positionally LAST to
  // match createMarchMaterial's binding order. The gate is cfg.x — zero
  // keeps the march bit-identical to the pre-task-7 shader.
  // NOTE FOR THE NEXT EDITOR — the wgslFn parser regexes the parameter list
  // for name-colon-type pairs, COMMENTS INCLUDED, so no comment in here may
  // ever contain a colon between two words; a phantom input shifts every
  // binding by one slot and the pipeline dies on a type mismatch.
  levelShadowTex: texture_depth_2d,
  levelShadowMatrix: mat4x4<f32>,
  levelShadowCfg: vec4<f32>,
  windDrift: vec3<f32>,
  bodyAnchor: vec3<f32>,
  // Wound union-reach bound - close-up wound-cull task 2026-09-05. No parens or colons in these comments.
  woundBound: vec4<f32>,
  // Quarter-res depth prepass - close-up task 3. Bound POSITIONALLY LAST,
  // in the same commit as the WGSL input - the meltCfg rule. cfg is
  // x enabled, y the coarse block footprint - radius per unit distance, the
  // 2*sqrt2 SDF-pixel half-diagonal - zw spare. Disabled or untouched, the
  // fetch hands back 0 and the max at the ray start folds it away, so
  // every view that never opts in marches bit-identical.
  // HAZARD - WIDER THAN THE COLON WARNING AT THE TOP OF THIS LIST - three
  // captures the parameter list UP TO THE FIRST CLOSE-PAREN, so a paren in
  // any comment here also truncates the parsed inputs; the missing params
  // then get float 0 substituted at the call, WGSL generation dies with a
  // JoinNode null deref, and every body renders unlit-black behind a
  // console-only error - 2026-09-05. A stray name-colon-type pattern in a
  // comment is the OLDER failure - the phantom input shifts every binding
  // by one slot. NO PARENS and NO COLONS in any comment in this list. Ever.
  depthPreTex: texture_2d<f32>,
  depthPreCfg: vec4<f32>,
  normalGradientCfg: vec4<f32> ) -> vec4<f32> {

  _ = sdfSurfaceStateReset();
  // FIRST STATEMENT, before anything folds. gWindDrift is read inside
  // sdShell, which is reached from foldGroup on every mapBody call in this
  // invocation — the march steps, calcNormal, the AO and scatter probes. Set
  // it late and the normal would be taken against a different surface than
  // the one the march hit.
  gWindDrift = windDrift;
  gBodyAnchor = bodyAnchor;
  let rd = normalize(worldPos - camPos);
  // PERF INSTRUMENTATION (task 2): debugCfg.x 0 = off, 1 = steps-per-pixel
  // heatmap, 2 = prims-per-pixel. Everything below is guarded so the
  // shipping path pays exactly one uniform branch; gDebugMode hands the
  // flag to mapBody's fold without forking its signature.
  if (debugCfg.x > 0.5) { gDebugMode = debugCfg.x; gDebugPrims = 0.0; gDebugSteps = 0.0; gDebugBones = 0.0; }
  // TILE-LIST PRELOAD (perf task 5 step 2). Read ONCE per pixel, here at the
  // march entry — never per step. The entry's groups then ride every mapBody
  // call in this fragment through gTileActive (march steps AND the post-hit
  // normal/AO/scatter probes, so shading sees exactly the field the ray
  // walked). The cone pre-pass is a separate invocation chain and keeps
  // gTileActive 0 — it marches the full cluster field, which is CONSERVATIVE
  // relative to any correctly-binned tile list.
  gTileActive = select(0.0, 1.0, tileCfg.x > 0.5);
  if (tileCfg.x > 0.5) {
    // The grid travels IN THE UNIFORM — deliberately not textureDimensions(),
    // whose inference-from-resource-size is exactly what broke when adaptive
    // resolution moved rungs under the old DataTexture path.
    let gx = max(1, i32(tileCfg.y));
    let gy = max(1, i32(tileCfg.w));
    let tid = clamp(vec2<i32>(floor(screenUV * vec2<f32>(f32(gx), f32(gy)))), vec2<i32>(0, 0), vec2<i32>(gx - 1, gy - 1));
    let head = (*tileHdr)[tid.y * gx + tid.x];
    let n = min(head.y, 64u);
    gTileN = f32(n);
    // Entry stream: TILE_STRIDE vec4s per entry at base head.x. Same record
    // layout the CPU binner packs; kTileWrite emits it verbatim.
    for (var e = 0; e < 64; e = e + 1) {
      if (e >= i32(n)) { break; }
      let lin = (head.x + u32(e)) * 3u;
      gTileBounds[e] = (*tileEnt)[lin];
      gTileGrp[e] = (*tileEnt)[lin + 1u];
      gTileBand[e] = (*tileEnt)[lin + 2u].x * 22.0;
    }
  }
  // OCCLUDER PRE-PASS. occT is the distance to the nearest point of a
  // conservative INNER hull of the scene — geometry guaranteed to lie inside
  // the real surface, rasterised depth-only before this pass.
  //
  // Clamping tMax by it is the entire consumption path, and it is safe in the
  // one direction that matters: the hull is INSIDE the body, so any true
  // surface along this ray is NEARER than the hull that covers it. Cutting the
  // ray at the hull can therefore never remove a hit that would have been
  // visible — it only stops the march from grinding through the full step
  // budget in space that something solid already covers.
  //
  // + woundCfg2.z (shell displacement, X1.21.2) buys back the one exception
  // that direction had. The shell can also dent the surface INWARD, and a
  // dent retreats up to ~0.9 amp below the smooth field the hull was sized
  // against; the hull clearance is only (1 - shrink) of the prim radius, so on
  // thin limbs a dent can pass BEHIND the hull sphere along the ray — and a
  // march whose tMax stops at the hull discards the pixel outright. On screen
  // that is dark dropout where the displaced skin should be; A/B with the
  // occluder off and the shell on makes it vanish. Extending the bound by one
  // amp reaches every dent the fbm can cut, while bumps stand PROUD of the
  // hull and were never at risk. Zero when the shell is off, so the
  // undisplaced bound is bit-identical.
  // OUTER-HULL BOUNDS (shell-hull-outer.ts). The hull CONTAINS the flesh, so
  // it answers two questions the occluder cannot:
  //
  //   shellOut <= 0 — no hull covers this pixel, therefore no surface can be
  //     here, therefore there is nothing to march. Measured 2026-08-31: that
  //     is 82-92% of every pixel the march rasterises, carrying 63-84% of all
  //     its steps.
  //   shellIn — where the hull's near surface is. No surface exists before it,
  //     so the ray may start there instead of at the proxy box's front.
  //
  // THE return IS NOT REDUNDANT WITH THE discard. In WGSL, discard demotes the
  // invocation to a helper; it does NOT stop execution. Without the return the
  // pixel would still walk its entire budget and only then be thrown away —
  // which is precisely the work this exists to delete.
  // (No backticks in this file: it is one big template literal.)
  //
  // ENTRY AND EXIT ARE SEPARATE for one reason: a camera INSIDE a hull sphere
  // sees no front face, so entry reads 0 there exactly as it does where there
  // is no hull at all. Exit tells them apart — inside the hull it is positive.
  // Collapsing the two would discard flesh at point-blank range.
  //
  // With the shell OFF the fetches hand back shellIn 0 / shellOut 1e9, so both
  // uses below are identities and this path stays bit-identical.
  //
  // shellOut FOLDS INTO tMax ON THE UN-RELAXED PATH, behind perfCfg.x, and
  // there the fold is EXACT: the hull contains the flesh, so no ray can hit
  // anything beyond the hull's back face. Cutting the march there deletes
  // only the empty space a miss ray used to walk between the hull exit and
  // the proxy box's far plane. The game page binds perfCfg.x 1 (see
  // GAME_HULL_EXIT_BOUND); the lab binds zero and stays bit-identical.
  //
  // The relaxed tracer (omega > 1.0) is the exception, and why the fold ships
  // behind a seam at all: X1.15 made that tracer take a CLAMPED FINAL SAMPLE
  // at tMax so an overshoot past tMax could still retract. Clamping tMax to
  // the hull puts that sample ON THE HULL — a surface sitting blendK +
  // shellAmp + chain-inflation OUTSIDE the flesh — and the AA epsilon
  // (t * aaCfg.x, which grows with distance) accepts it as a hit: a bright
  // halo hugging every silhouette and distant ghost outlines, worst far away
  // where the epsilon is largest. Caught by the 2026-08-31 on/off visual
  // gate. The clamped final sample exists only above omega 1.0, so the fold
  // is guarded with !relax and the relaxed path keeps the proxy-box far
  // plane. (History: the fold was first left out entirely as the fix for
  // that halo; perf round 2 re-adds it for the un-relaxed path only.)
  //
  // With the shell OFF the fetch hands back shellOut 1e9, so min() is the
  // identity; with perfCfg.x 0 select() is the identity. Both identities are
  // bit-exact — nothing else about the march changes.
  if (shellOut <= 0.0) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  // THE OCCLUDER NO LONGER BOUNDS tMax, AND IT MUST NOT (2026-09-01).
  //
  // Everything above about the inner hull being safe to clamp against is
  // sound as GEOMETRY, and the hull really is inside the flesh: sampling
  // sdBody at all 300 emitted spheres of the live POSED bodies puts every one
  // of them at least its own radius deep (__sdfGame.hullInsideness). What is
  // not sound is the NUMBER the pre-pass writes for them.
  //
  // Measured with one synthetic sphere of known centre and radius, rasterised
  // alone and read straight back (__sdfGame.syntheticSphereCheck). The value
  // the pre-pass stores tracks the true camera distance only in the near
  // field and then comes apart -- and the error depends on DISTANCE alone,
  // not on the sphere's radius or its size on screen:
  //
  //   true 1.9 -> 1.905    true 2.4 -> 2.405   true 2.9 -> 2.892   (exact)
  //   true 3.9 -> 3.714    true 4.9 -> 4.252   true 5.9 -> 4.447
  //   true 7.9 -> 3.782    true 9.9 -> 2.079   true 11.9 -> 0.367
  //
  // An UNDER-reported occT is the one error this bound cannot survive: tMax
  // lands in front of the surface, the ray gives up before reaching skin, and
  // the fragment discards. On screen that is the owner's report of bodies
  // "full of holes until you get fairly close" -- holes because the clamp
  // bites per pixel wherever the hull covers, and distance-keyed because the
  // encoding is accurate exactly where the player is close. Measured on a
  // single isolated zombie at 4.9 m: 1369 of 1375 lost pixels had tMax IN
  // FRONT of the flesh, worst case 0.68 m short, and the hull's own CPU
  // ray-sphere entry (4.814 m) sat correctly BEHIND the surface (4.757 m)
  // while the pre-pass wrote 4.225 m for the same pixel.
  //
  // The bound bought nothing to weigh against that. Interleaved frame timing
  // with the outer shell hull shipping (room 3, 8 bodies, 6 rounds x 30
  // frames, GPU-fenced): occluder on 14.23 ms mean, off 14.32 ms, against a
  // 13.4-14.9 ms spread WITHIN either leg. That matches what the shell work
  // already recorded -- "the occluder measured as worth nothing anyway".
  //
  // So the clamp goes and the pre-pass ships disabled. Everything else stays:
  // occluder-hull.ts still builds, occFetch still fetches, debug mode 3 still
  // heats occT, and __sdfGame.setOccluder still renders the pass -- so
  // whoever works out why an instanced MeshBasicNodeMaterial writing
  // length(positionWorld - cameraPosition) decays with distance can revive
  // this by putting the term back. Do not put it back before that: the outer
  // hull (shell-hull-outer.ts) writes distance the same way, and is unharmed
  // only because shellIn is a ray START and shellOut a > 0 test, where
  // under-reporting is conservative. Here it is fatal.
  let tMaxBox = length(worldPos - camPos);
  let relax = woundCfg2.y > 1.0;
  let tMaxSel = select(tMaxBox, min(tMaxBox, shellOut), perfCfg.x > 0.5 && !relax);
  // Accumulated-depth gate (perf round 2 task 5): a nearer body already
  // owns this pixel out to prevT — the front-to-back per-body passes blit
  // the accumulated frame state before each pass, and prevFetch decodes its
  // alpha (clip depth) into a ray distance.
  //
  // bodyEntry is the fragment's OWN conservative entry along the ray: its
  // proxy box (centre = the mesh's world origin, half extents = bodyHalf)
  // contains the hull contains the flesh, so nothing of this body can be
  // nearer than the ray-box entry. shellIn is a second lower bound on the
  // same first-possible hit (the SHARED nearest hull entry across ALL
  // bodies — weaker here, but never wrong). The exact discard takes the MAX
  // of the two: the larger of two lower bounds on the first possible hit is
  // still a lower bound on it, and the tighter of the two, so discarding
  // when max(shellIn, bodyEntry) > prevT can never drop a fragment this
  // body would have shaded — while min(shellIn, bodyEntry) <= shellIn <=
  // prevT almost everywhere was inert (task 5 shipped it and measured the
  // counters bit-identical on/off; task 5b proves the max form bites).
  //
  // invRd's 1e9 fallback (parallel axis) keeps the slab algebra finite: a
  // fragment's ray genuinely hits the box, so its fixed coordinate lies
  // inside that slab and the ±1e9 pair cancels in the min/max. The 0 clamp
  // is the camera-inside-the-box case: entry 0 never discards.
  let invRd = select(vec3<f32>(1e9), 1.0 / rd, abs(rd) > vec3<f32>(1e-8));
  let bLo = (bodyCentre - bodyHalf - camPos) * invRd;
  let bHi = (bodyCentre + bodyHalf - camPos) * invRd;
  let bodyEntry = max(max(min(bLo.x, bHi.x), min(bLo.y, bHi.y)), max(min(bLo.z, bHi.z), 0.0));
  if (max(shellIn, bodyEntry) > prevT) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  let tMax = min(tMaxSel, prevT);
  let steps = i32(marchCfg.x);
  // HIT EPSILON (X1.26): the primitive literal was 1.2 mm. A trilinear
  // reconstruction of a baked SDF is not exact to the surface, so volume
  // mode raises the threshold through the SPARE woundCfg2.w channel to at
  // least half the largest voxel pitch (set by the hands view). max() keeps
  // the primitive path bit-identical at the default 0.
  // HIT EPSILON, and the ANTIALIASING lever on top of it.
  //
  // hitEpsBase is the floor: the original 1.2 mm primitive literal, raised
  // by woundCfg2.w in volume mode (see below).
  //
  // aaCfg.y > 0 additionally ends the march once the field is within the RAY'S
  // OWN PIXEL FOOTPRINT, t * aaCfg.x. That prefilters geometry below Nyquist
  // — detail finer than a pixel is smoothed rather than aliased — which is the
  // principled fix for geometric aliasing, versus FXAA guessing edges after
  // the fact. It is also FASTER, because a larger epsilon converges in fewer
  // steps, and the saving grows with distance: biggest exactly where crowds
  // are. Corner rounding is sub-pixel by construction, so invisible; that IS
  // the antialiasing.
  //
  // THREE THINGS TO KNOW BEFORE RAISING THE STRENGTH:
  //  1. mapBody UNDER-REPORTS Euclid distance by the group distortion factor
  //     (up to 22x — the schoolgirl's sole plate), so d < eps can fire when
  //     the TRUE distance is many times eps, stopping the ray short and
  //     reading blobby/detached, non-uniformly, in high-distortion regions.
  //     CORRECTED (perf round 2 task 6): the fold's argmin carries the
  //     dominant group's packed factor in the private global gFoldBestDistort
  //     and the epsilon below divides by it — same per-sample state as the
  //     argmin, so the correction is exact where the hit lands. This is why
  //     the lever can now ship ON.
  //  2. Craters fill in at range as eps approaches wound depth. Arguably
  //     correct LOD, but it is the distance at which a player judges whether
  //     a shot landed — hence the floor, which never shrinks below 1.2 mm.
  //  3. It does nothing for SHADING aliasing, and henenlotter-latex is the
  //     worst case (specIntensity 0.95 / specRoughness 0.12, plus
  //     surfaceNoiseAmp perturbing normals). Geometric prefiltering will not
  //     stop specular scintillation; that wants roughness widening with the
  //     same footprint, separately.
  //
  // Bonus: the footprint tracks the adaptive-resolution ladder for free, since
  // aaCfg.x is derived from the SDF pass height — so AA quality stays
  // consistent at scale 1.0 and at 0.45, where today the low rungs give more
  // aliasing AND more blur at once.
  let hitEpsBase = max(0.0012, woundCfg2.w);
  let aaK = aaCfg.x * aaCfg.y;
  // NOISE ANCHOR (motion-polish task 6): every fbm below samples the
  // DOMINANT prim's REST frame via restPoint — the noise is baked into the
  // model. noiseShift (faceCfg3.zw + lodCfg.z, the task-3 root-shift anchor)
  // survives ONLY as restPoint's fallback for bodies without rest rows and
  // for the no-live-prim case. Zero = the pre-motion behaviour there.
  let noiseShift = vec3<f32>(faceCfg3.z, lodCfg.z, faceCfg3.w);
  // ONLY .x CARRIES MEANING: the silhouette-noise amplitude. y/z/w are dead.
  //
  // They were a parked melt spike's amp/frequency/time (c52b05b), removed in
  // the 2026-09-04 merge because the shipped zombie melt supersedes it. Note
  // what this line read immediately after that merge:
  //   vec4<f32>(marchCfg.z, meltCfg.x, meltCfg.y, meltCfg.z)
  // Both sides had independently named a uniform meltCfg, so git merged the
  // two files with NO conflict marker and quietly fed the zombie melt's
  // PROGRESS into the spike's displacement amplitude — a body that ridges as
  // it melts, from a merge that reported success.
  //
  // The vec4 survives only because hard-surface's gloss/metal kill is written
  // against it (see calcNormal below). Collapsing it back to a plain f32 is a
  // tidy-up worth doing; three permanently-dead lanes on a shared struct is
  // precisely how primClip.w's "spare" comment went stale.
  let noiseCfg = vec4<f32>(marchCfg.z, 0.0, 0.0, 0.0);

  // RELAXED SPHERE TRACING (Keinert et al. 2014; Balint & Valasek 2018).
  //
  // Plain sphere tracing steps by exactly the unbounding radius. This shader
  // used to step by 0.6 of it — UNDER-relaxation, costing ~1.67x the
  // iterations of the textbook algorithm — because the silhouette fbm added to
  // mapBody broke the Lipschitz bound, so the "distance" could overestimate
  // and a full step could tunnel through the surface.
  //
  // The overshoot test is the whole safety argument: if the new unbounding
  // sphere does not reach back far enough to touch the previous one, the step
  // jumped over a gap the spheres never covered, so it is retracted and the
  // step falls back to the conservative radius.
  // woundCfg2.y carries the relaxation factor so it stays tunable — the win is
  // theory until it is measured, and it cannot be measured against a constant.
  // At or below 1.0 the relaxed path is off and marchCfg.y is back in charge.
  // NORMAL WARPING (Hubert-Brierre et al. 2025) took the silhouette fbm OUT
  // of the marched field — see the mapBody call below, which passes 0.0 — so
  // it survives only in calcNormal, where it perturbs the shading normal at
  // the hit point. That made the field an exact CSG of ellipsoid capsules
  // under a conservative smooth-min for EVERY body, not just the distant ones
  // LOD had already stripped.
  //
  // ==> THAT ARGUMENT NO LONGER HOLDS. It was written before wounds existed.
  // applyWounds does NOT return a distance bound (the smax fillet overstates,
  // the lip understates), so the field the tracer sees near a crater is not
  // conservative and over-relaxation is NOT always safe. Relax pinned to 1.0
  // on 2026-08-24 after ω = 1.4 × carved wounds produced the wound-halo
  // "distorted lens": both ω > 1-only paths below step rays BACKWARD at
  // grazing wound angles and fail to reconverge, so whole screen-space
  // circles shade the body from an offset depth. Post-mortem in Obsidian,
  // Claude Notes/Blud/2026-08-24-wound-halo-postmortem.md.
  //
  // DO NOT raise the default above 1.0 until the two retractions below are
  // bounded and provably reconverge — see the "retract-guard reconvergence"
  // lever in docs/superpowers/specs/2026-08-23-raymarcher-performance-design.md.
  // It is worth 1.60× on crowds (X1.10: 10 bodies, 1.0 → 14.89 ms vs
  // 1.4 → 9.31 ms), so it is worth doing properly — but that sweep PREDATES
  // wounds and must be re-run with craters in the scene before 1.4 returns.
  //
  // SHELL DISPLACEMENT (gobs-and-goo task 4) is the owner-approved middle
  // path that brings the bumpy outline BACK: the relaxed march runs the
  // smooth field until it is inside a thin shell of the surface, and only
  // there does the fbm displace the stepped distance — see the loop body.
  var omega = select(marchCfg.y, woundCfg2.y, relax);
  // Near-wound step multiplier, with a live override on perfCfg.z for A/B
  // (__sdfGame.setWoundStep). ZERO IS THE IDENTITY: every view that never
  // writes the lane gets the compiled constant, bit for bit. The lane is on
  // perfCfg and not counts2 because counts2 is re-set on every pack — an
  // override parked there would evaporate on the next body rebuild.
  let woundMul = select(0.6, perfCfg.z, perfCfg.z > 0.0);
  // Start where the cone pre-pass proved the tile is still empty, rather than
  // at the camera. Clamped to tMax so a stale or over-eager coarse value can
  // never push the ray straight out the back of the proxy box.
  // max(startT, shellIn): the cone pre-pass proved empty space ahead, and the
  // outer hull proves no surface exists before its own near face. Take
  // whichever reaches further; clamped to tMax so neither can push the ray out
  // the back of the box.
  //
  // QUARTER-RES DEPTH PREPASS (close-up task 3) adds a third lower bound to
  // the max — the coarse pass's first cone-touch distance for this pixel's
  // 4x4 block, provably at or in front of every ray's own first surface
  // (the proof lives on DEPTH_PREPASS_MARCH). The fetch returns 0 for a
  // miss or a disabled pass, and preStart collapses to 0, which is the
  // identity inside the max — the off path is bit-identical.
  //
  // The backoff subtracts three slack terms from the recorded touch. The
  // footprint term (preT * cfg.y) is insurance beyond the cone-radius proof:
  // it would take a depth gradient steeper than one block footprint per
  // block — a grazing silhouette — to put a block ray's own surface nearer
  // than touch minus a footprint, and the proof already covers that case;
  // this term costs one multiply and buys the census a quiet night. The
  // 0.0012 is the coarse touch test's own epsilon (the touch can record up
  // to that far before the field's nearest surface), and shellAmp is the
  // shell displacement the coarse test also stopped short of — the same two
  // slack terms CONE_MARCH's stop carries, handed back to the ray here.
  let preT = depthPreFetch(depthPreTex, screenUV, depthPreCfg);
  let preStart = select(0.0, max(preT - (preT * depthPreCfg.y + 0.0012 + woundCfg2.z), 0.0), preT > 0.0);
  var t = clamp(max(max(startT, shellIn), preStart), 0.0, tMax);
  var hit = false;
  var prevRadius = 0.0;
  var stepLen = 0.0;
  var clamped = false;
  // Dominant prim at the last field sample (mapBody.y) — the hit pixel's
  // noise anchor reuses it instead of re-running the fold (task 6).
  var hitBest = -1;
  // The last field sample's full mapBody result (wound-r2 task 6). Re-assigned
  // every iteration exactly like hitBest/hitNearWound so it always describes
  // the sample the loop actually lands on; at the break it is therefore the
  // ACCEPTING sample, whose .w is the pre-wound field carved — depth
  // beneath the original skin, the tissue ramp's signal.
  var hitField = vec4<f32>(0.0);
  // Whether the ACCEPTED hit sample sat in a wound's near zone (mapBody.z).
  // Re-derived every iteration so it always describes the sample the loop
  // actually lands on — retractions and shell steps included. This is the
  // wound-shadow gate: firing iq's soft shadow march only for pixels inside
  // twice a wound's radius keeps its cost proportional to crater screen
  // area instead of screen size.
  var hitNearWound = false;
  for (var i = 0; i < 512; i = i + 1) {
    if (i >= steps) { break; }
    if (debugCfg.x > 0.5) { gDebugSteps = gDebugSteps + 1.0; }
    // 0.0, not marchCfg.z: the field mapBody returns stays SMOOTH — the fbm
    // still reaches the normal only via calcNormal — but inside a thin shell
    // of the surface the same fbm is added to the REAL stepped distance just
    // below, which is where the silhouette gets its bumps back without
    // paying fbm at every step of the empty approach.
    let dres = mapBody(camPos + rd * t, data, counts, counts2, vec4<f32>(0.0), woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg, woundBound);
    let distort = max(gFoldBestDistort, 1.0);
    var d = dres.x;
    hitBest = i32(dres.y);
    hitField = dres;
    // Shell displacement: inside a thin shell of the smooth surface, the
    // silhouette noise displaces the REAL field — bumpy outlines are back —
    // and stepping goes conservative because the noise breaks the Lipschitz
    // bound. Outside the shell the relaxed march is untouched. The fbm
    // samples the dominant prim's REST frame (task 6), glued to the flesh;
    // restPoint's loads are paid only inside the shell band.
    let shellAmp = woundCfg2.z;
    var conservative = false;
    if (shellAmp > 0.0 && abs(d) < shellAmp * 4.0) {
      d = d + fbm(restPoint(camPos + rd * t, data, i32(dres.y), noiseLocal(camPos + rd * t, noiseShift)) * 3.0) * shellAmp;
      conservative = true;
    }
    // Near a wound (mapBody.z) the field is not a distance bound — see
    // applyWounds — so step UNDER-relaxed at 0.6, exactly as the noise shell
    // does, and skip the overshoot test (a retraction there takes back a
    // step that was never relaxed). Plain 1.0 stepping was tried first and
    // still banded: the smax fillet overstates distance, so even an exact
    // sphere step lands past the crater wall.
    let nearWound = dres.z > 0.5;
    hitNearWound = nearWound;
    let radius = abs(d);
    let overshot = !conservative && !nearWound && omega > 1.0 && (radius + prevRadius) < stepLen;
    if (overshot) {
      // Undo the part of the last step that was not covered by the spheres,
      // and drop to plain sphere tracing for the rest of this ray. Skipped on
      // a displaced sample — the retraction rewinds by the omega excess,
      // which is only the real excess when stepLen was d times omega, and a
      // shell step was already under-relaxed at 0.6 so there is nothing to
      // take back.
      //
      // KNOWN WRONG, dead at the shipping default (relax 1.0) — do not "tidy"
      // this without the gates in the perf spec's retract-reconvergence lever.
      // The last step was d*omega; the excess over a conservative step is
      // d*(omega-1) == stepLen*(omega-1)/omega. This takes back
      // stepLen*(omega-1) instead — at omega 1.4, 0.56*d rather than 0.40*d,
      // a 40% OVER-retraction. It errs conservative (it lands short of the
      // safe point) so it cannot tunnel, but it burns steps and, combined
      // with the unbounded guard below, is half of why wounded rays fail to
      // reconverge. Correct form: stepLen = -stepLen * (omega - 1.0) / omega.
      stepLen = stepLen - omega * stepLen;
      omega = 1.0;
    } else {
      let hitEps = max(hitEpsBase, t * aaK / distort);
      if (d < hitEps) {
        // wound-halo r2: an over-relaxed step can cross the skin with
        // radius + prevRadius == stepLen EXACTLY — a perpendicular approach
        // onto near-flat skin makes the sum an equality, not a strict <, so
        // the overshoot test above cannot see it — and the hit then registers
        // up to (omega-1)/omega of the last step INSIDE the solid. Behind the
        // wound grid that landing zone sits in the carve spheres' smax/smin
        // blend, whose gradient contaminates the shading normal: the torso's
        // far side lit up as a red/pale band at wound height (owner,
        // 2026-08-24; instrumented — band hits at z -0.17 vs skin -0.266,
        // normals sideways/up, wm ~ 0). Retract onto the surface and finish
        // the ray at omega 1; the hit is accepted once d is within hitEps.
        // The crossing sample usually sits inside the near-wound zone (the
        // landing is BEHIND the wound spheres even when the crossing is in
        // front of them), so nearWound is NOT a stop signal here — 0.6
        // stepping of the overstated fillet can cross too, and retracting to
        // the wall is strictly more correct than shading a point inside it.
        // Only shell-displaced samples keep the old contract (their retraction
        // assumes the smooth field).
        //
        // KNOWN UNSOUND, dead at the shipping default (relax 1.0). d here is a
        // SCALED-space distance: per the cull-soundness rule sdPrimitive
        // under-reports Euclid by the group's distortion factor (22x on the
        // schoolgirl sole plate), so stepping back by |d| is not guaranteed to
        // leave the solid, and nothing here bounds a retry or caps the
        // back-step to the interval actually travelled. This is the other half
        // of the wounded-ray non-reconvergence. Fixing it needs the packed
        // distortion factor threaded to this site — see the perf spec.
        if (d < -max(hitEpsBase, t * aaK / distort) && omega > 1.0 && !conservative) {
          stepLen = d;
          omega = 1.0;
        } else {
          hit = true;
          break;
        }
      } else {
        // TWO INDEPENDENT REASONS TO UNDER-RELAX, and the stricter one wins.
        // The shell's 0.6 pays for the fbm; the wound zone's own multiplier
        // pays for a field that is not a distance bound (WOUND_STEP_MUL).
        // They used to share the 0.6 literal, which is how the wound side
        // went unexamined for as long as it did — the shell's figure was
        // never measured against a crater.
        //
        // At WOUND_STEP_MUL 0.6 this is the old select() exactly, for every
        // omega the pages ship (all >= 0.6). It differs only BELOW 0.6, where
        // the old form LENGTHENED the step to 0.6 in the very zones that
        // wanted it shortest; min() keeps omega there instead.
        stepLen = d * min(select(omega, 0.6, conservative), select(omega, woundMul, nearWound));
      }
    }
    prevRadius = radius;
    t = t + stepLen;
    if (t > tMax) {
      // Do NOT break outright on the relaxed path. An over-relaxed step can
      // cross the surface AND tMax together, and the overshoot test cannot
      // fire until the NEXT sample — so breaking here discards a hit the
      // retraction would have recovered. Harmless while tMax was the proxy
      // box's far side; the occluder pre-pass made tMax a bound that can sit
      // millimetres behind the surface, and this break shredded every body
      // whose hull gap was tight (the interpenetrating-crowd holes).
      //
      // Instead, take the pending sample AT tMax: if the step did cross the
      // surface, the overshoot test fires there and the retraction replays
      // the interval at omega 1. One extra visit at most — the clamped flag —
      // so a genuinely empty ray still terminates. The plain path is exempt:
      // at omega <= 1.0 steps are conservative and nothing can be skipped.
      if (omega <= 1.0 || clamped) { break; }
      t = tMax;
      clamped = true;
    }
  }
  // OCCUPANCY MODE (debugCfg.x == 4, 2026-08-31). Returns RAW COUNTERS
  // instead of a colour, and — the whole point — returns BEFORE the discard,
  // so pixels that missed still write. Channels:
  //   r = steps this ray took   g = 1 if it hit flesh, else 0
  //   b = 1 always (this fragment was rasterised and marched)
  //   a = t -- BUT DO NOT READ IT BACK AS A DISTANCE. createMarchMaterial's
  //     outputNode replaces alpha with CLIP-SPACE DEPTH, so a readback of
  //     this channel always lands in [0, 1]. (2026-09-01: that silently
  //     collapsed a whole "lost pixels by distance" histogram into the
  //     0-1 m bucket before it was caught.)
  //
  // ONE MORE BIAS, and it matters for the counts below: this returns BEFORE
  // the discard, so a MISSED ray still writes depth -- at the distance it
  // gave up, which for a near body's proxy box is nearer than a far body's
  // real hit. The missed fragment then wins the depth test and the readback
  // reports "no flesh" for a pixel the shipping render draws. Wherever proxy
  // boxes overlap, occupancy()'s hit counts are therefore a LOWER bound for
  // that reason too, on top of the overdraw one below.
  //
  // WHAT IT MEASURES, and what it does not. Summing over the target gives
  // hits/rasterised = the fraction of proxy-box screen area that actually
  // shows flesh. That is the shell march's addressable market: a bounded
  // hull never rasterises the rest. It is a LOWER BOUND on the waste,
  // because depth-testing means only the front-most body writes to a pixel —
  // where several bodies' boxes overlap, the real fragment-invocation count
  // is higher than this can see.
  //
  // Only ever read back; it does not composite to anything meaningful.
  if (debugCfg.x > 3.5 && debugCfg.x < 4.5) {
    return vec4<f32>(gDebugSteps, select(0.0, 1.0, hit), 1.0, t);
  }
  // BONE-EVAL MODE (debugCfg.x == 5, gore r3 refinement 3). Same contract as
  // occupancy above — raw counters, returned BEFORE the discard so missed
  // rays still write, alpha unusable. r = bone capsule evaluations this ray.
  // This is what the bone-fold cull must move; the timing bench could not
  // resolve the fold at all (+0.0% under a 4% spread), so the counter is the
  // measurement and the bench is only a sanity check.
  if (debugCfg.x > 4.5 && debugCfg.x < 5.5) {
    return vec4<f32>(gDebugBones, select(0.0, 1.0, hit), 1.0, t);
  }
  if (!hit) { discard; }
  // FLAT-ALBEDO SEAM (close-up diagnostics task 1, 2026-09-04). Returns the
  // body's base albedo AT THE HIT and skips the entire post-hit chain —
  // calcNormal (4 field evals), the anchor, the micro-detail fbm, wound/char
  // masks, the tissue ramp, organ/mottle/gore/face albedo, the analytic
  // flashlight, spec/fresnel, the scatter and AO probes, the wound soft
  // shadow, the level shadow and the ambient compose. Nothing about the WALK
  // changes: the loop above ran to the same t with the same stepping, and
  // hitBest/hitNearWound/hitField were still maintained because the tracer
  // itself consumes them.
  //
  // debugCfg.y is the seam's gate because debugCfg.y was the one spare
  // channel on a uniform every march variant already binds — a new input in
  // MARCH_BODY's signature would have to be threaded through the entry
  // literal AND every variant literal in signature order (the meltCfg
  // incident), for a diagnostic that must stay inert. Default 0 = the
  // guarded return never fires and the fragment below is bit-identical to
  // the pre-seam shader; a test pins this file to exactly one debugCfg.y
  // occurrence, placed here.
  //
  // Precedence note: with debugCfg.x ALSO in a heatmap mode (1/2/3) the flat
  // return wins — those modes returned after shading, and this seam exists to
  // skip shading. Modes 4/5 (occupancy/bone counters) still win over it:
  // they return above, before the hit test.
  if (debugCfg.y > 0.5) { return vec4<f32>(baseColor, t); }
  // Snapshot the counters BEFORE the post-hit probes: calcNormal folds
  // four more mapBody calls and the wound shadow up to fourteen, and the
  // heatmap is about RAY cost, not shading cost.
  let debugSteps = gDebugSteps;
  let debugPrims = gDebugPrims;

  let p = camPos + rd * t;
  // PER-PRIMITIVE MATERIAL READ — hoisted above the noise (hard-surface
  // task 1). gloss must be known BEFORE the shading normal exists: both
  // flesh-noise paths below scale by (1 - gloss), because a polished prim
  // has no pores. This is the SAME single texel the per-prim colour block
  // below used to read (hitBest row, ROW_PRIM_COLOR) — hoisted, not
  // repeated, so no hit pixel pays for it twice. hitBest is -1 on the
  // baked-volume path; there gloss stays 0 and every noise term runs at
  // full flesh amplitude exactly as before.
  // METAL (task 2) rides the same hoist: prof bit 4 (16), read off
  // ROW_PRIM_SHAPE only inside the painted branch (metal is parse-gated on
  // color=, so an unpainted pixel can never change the answer — one extra
  // texel load on painted hit pixels only). metal implies the same noise
  // suppression with no gloss set: a machined surface has no pores either,
  // so both sites below take (1 - max(gloss, metal)).
  var gloss = 0.0;
  var painted = 0.0;
  var metal = 0.0;
  var primGlow = 0.0;
  var primAlbedo = vec3<f32>(0.0);
  if (hitBest >= 0) {
    let PC = textureLoad(data, vec2<i32>(hitBest, 12), 0);
    if (PC.w > 0.0) {
      primAlbedo = PC.xyz;
      gloss = clamp(PC.w - 1.0, 0.0, 1.0);
      painted = 1.0;
      let PS = textureLoad(data, vec2<i32>(hitBest, 10), 0);
      if ((i32(PS.y) & 16) != 0) { metal = 1.0; }
      // GLOW (hard-surface task 3): primClip.w, the lane that was documented
      // spare until now. Loaded ONLY inside the painted branch — glow is
      // parse-gated on color=, so an unpainted pixel can never author one,
      // and this is the third texel a painted hit pixel pays for (colour,
      // shape, clip) and the last.
      primGlow = clamp(textureLoad(data, vec2<i32>(hitBest, 17), 0).w, 0.0, 1.0);
    }
  }
  // Silhouette noise into the normal, scaled by (1 - max(gloss, metal)) at
  // the point of application: a polished or machined prim has no pits. The
  // AO and scatter probes below keep the FULL marchCfg.z — they probe the
  // real displaced field (fbm at frequency 3, features ~0.2 m), not surface
  // detail, and the march loop runs the field smooth regardless. At
  // gloss 0 / metal 0 this argument is exactly what it always was.
  // MERGE (hard-surface task 3, resolving main's melt): calcNormal's amp is
  // now a vec4 — x silhouette, y/z/w the MELT components. Only x carries the
  // gloss/metal kill; melt amplitude is a transient effect the owner drives
  // deliberately, not flesh pore detail, and task 1's contract was noise
  // suppression of the flesh's own texture, so meltCfg passes through
  // untouched. At gloss 0 / metal 0 / melt 0 the vec4 is byte-identical to
  // the pre-both-changes call.
  // The hit pixel's REST-space noise anchor (task 6): every fbm below —
  // micro-detail, gore mottle — samples the dominant prim's rest frame, so
  // the surface texture rides the limb through gait and jiggle. Computed
  // once here; the fallback keeps the old root-shift anchor for bodies with
  // no rest rows (the FPV hands view).
  // HOISTED above the shading normal (close-up task 2) — the forward-
  // difference mode rebuilds its stencil base from this anchor, so the
  // anchor must exist before the normal runs. restPoint and noiseLocal are
  // pure reads, so hoisting them cannot move a pixel, and the mode-0 branch
  // below is byte-for-byte the pre-task-2 call.
  let anchor = restPoint(p, data, hitBest, noiseLocal(p, noiseShift));
  var n = vec3<f32>(0.0);
  var ngValid = false;
  var ngReason = 7;
  var ngScalar = 0.0;
  if (normalGradientCfg.x > 0.5) {
    let noiseAmplitude = marchCfg.z * (1.0 - max(gloss, metal));
    let ng = ngBody(p, data, counts, counts2, vec4<f32>(noiseAmplitude, 0.0, 0.0, 0.0), woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg, woundBound);
    ngReason = gNgReason;
    ngScalar = ng.x;
    if (ngReason == 0) {
      let candidate = ng.yzw + ngDetail(p, data, gNgOwner, noiseShift, noiseAmplitude);
      let magnitude2 = dot(candidate, candidate);
      // Comparisons reject NaN and infinity as well as a collapsed gradient.
      ngValid = magnitude2 > 1e-12 && magnitude2 < 1e12;
      if (ngValid) { n = normalize(candidate); } else { ngReason = 2; }
    }
  }
  if (!ngValid) {
    n = calcNormal(p, data, counts, counts2, vec4<f32>(marchCfg.z * (1.0 - max(gloss, metal)), 0.0, 0.0, 0.0), woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg, woundBound);
  }
  // Raw diagnostic RGB bypasses later detail/shading; outputNode still writes
  // the identical clip depth. Eligibility 0 is background, 1 is analytic.
  if (normalGradientCfg.y > 1.5) {
    return vec4<f32>(f32(ngReason + 1), select(0.0, ngScalar - hitField.x, ngValid), f32(hitBest), t);
  }
  if (normalGradientCfg.y > 0.5) { return vec4<f32>(n * 0.5 + 0.5, t); }
  let detailAmp = surfCfg2.y * (1.0 - max(gloss, metal));
  if (detailAmp > 0.0) {
    n = normalize(n + vec3<f32>(
      fbm(anchor * 22.0), fbm(anchor * 22.0 + 5.0), fbm(anchor * 22.0 + 11.0)) * detailAmp);
  }

  let wmBoth = woundMask(p, n, data, woundCfg, woundCfg2);
  let wm = wmBoth.x;      // colouring / wet / cavity shading
  let wmRim = wmBoth.y;   // fresnel fade, covers the lip
  let wmCav = wmBoth.z;   // cavity-ness: only wounds whose flags row opened one
  let cm = charMask(p, data, woundCfg);
  // Tissue depth rides mapBody's .w (the PRE-wound field). The ramp chooses
  // WHICH colour the wounded end of the lerp reaches for; wm remains the
  // sole authority on WHETHER this pixel is wounded. That composition is what
  // makes the ramp halo-safe by construction: at wm = 0 nothing it computes
  // can reach the albedo, so it has no edge to disagree with the mask's.
  //
  // surfCfg3 = (woundDepthAmp, fatDepth, muscleDepth, visceraAmp); the
  // select is the amplitude gate — woundDepthAmp 0 shades bit-for-bit as
  // before the ramp existed.
  //
  // Do NOT refactor this into a second mask. The 2026-08-23 crater pass split
  // one mask into three and cost two days to the resulting halo; the note above
  // WOUND_MASK is the record.
  let tissueDepth = max(0.0, -hitField.w) * surfCfg3.x;
  // Viscera (entrails): low-frequency fbm over the rest-space anchor lumps
  // the cavity colour so it reads as organs and not as noise. Lumped only
  // where it can be SEEN: inside a cavity wound, with the stop enabled. The
  // amplitude guard has to wrap the fbm, not just its result — guarding the
  // result leaves the cost on every pixel, which is the mistake that cost
  // the torn-fibre pass its life. 0 leaves the ramp shading bit-for-bit as
  // before entrails.
  var viscera = visceraColor;
  if (surfCfg3.w > 0.0 && wmCav > 0.0) {
    let lump = fbm(anchor * 2.5) * 0.5 + 0.5;
    viscera = visceraColor * mix(0.75, 1.25, lump);
  }
  let tissue = select(deepColor,
    tissueRamp(tissueDepth, baseColor, fatColor, deepColor, surfCfg3.y, surfCfg3.z,
      wmCav * surfCfg3.w, viscera, visceraDepth),
    surfCfg3.x > 0.0);
  var albedo = mix(baseColor, tissue, wm);

  // NO TORN-FIBRE PASS. It shipped in wound pass r2 and was CUT on the
  // owner's playtest verdict (2026-09-02): "rather subtle... just seems to
  // make the texture a little different but not really noticeable or that
  // visibly different from default", judged with the panel slider swept to
  // its ceiling. An fbm per wound-interior pixel that nobody can see is
  // cost without a look, so it is gone rather than defaulted to 0 — a dead
  // knob invites someone to turn it back on and re-litigate this.
  // surfCfg3.w is consequently SPARE; the row map above says so.

  // Inside-flesh material (organs r3). The dominant prim carries the
  // material code in primScale.w — W_ORGAN is 5, and only applyBones can
  // claim bestIdx for an inside-flesh row because foldGroup and applyCarves
  // skip the range entirely — so this is an identity read, not a guess from
  // depth or radius. (Bone tubes: op 'bone' prims no longer reach the field
  // when packBones is off — the bone ALBEDO branch this used to feed is
  // deleted with them; a packed bone row still wins the fold identically
  // under the default packBones-on layout, it just shades as plain meat.)
  // hitBest is -1 on the baked-volume path (no dominant prim), so clamp the
  // row index and gate on it, like the painted-prim read below. Gated on wm
  // (gore r3 refinement 5): an inside-flesh prim can only ever be dominant
  // INSIDE a wound — applyBones runs only where nearWound is set — so on an
  // unwounded pixel this texel load can never change the answer. It ran on
  // every hit pixel of every body before the gate.
  var hitMat = 0.0;
  // The melt reads this too (meltCfg.x > 0): the skeleton EMERGES through
  // thinning flesh with no wound anywhere near it (the bareBones bypass), so
  // the wm gate alone would leave an exposed bone unidentified and it would
  // shade as meat — the exact pale-vs-red contrast the melt lives on lost.
  if ((wm > 0.0 || meltCfg.x > 0.0) && hitBest >= 0) {
    hitMat = textureLoad(data, vec2<i32>(hitBest, 2), 0).w;
  }
  let isOrgan = hitMat > 4.5 && hitMat < 5.5;
  // W_BONE is 4 — the dominant row is a packed bone prim (bones still fold
  // under the default packBones-on layout). Only consulted by the melt ramp.
  let isBone = hitMat > 3.5 && hitMat < 4.5;
  if (isOrgan) {
    // Pale, wet, and NOT stained toward the meat: viscera is already wet
    // and already the same family of colour as the flesh around it. organAmp
    // 0 leaves albedo untouched, which is the off-state.
    albedo = mix(albedo, organColor, organAmp);
  }

  // Colour mottle. surfaceNoiseAmp above perturbs the NORMAL, which reads as
  // texture but never as colour — under a broad key the whole creature stays
  // one hue and the silhouette reads as a single object. This is the albedo
  // twin, and it is what stops every .blob character being the same flat
  // sheet of flesh.
  //
  // Sampled off anchor, the REST-space point, exactly like the micro-detail
  // and the gore mottle: blotches then ride a limb through gait instead of
  // swimming across the surface as the body moves. A world-space sample looks
  // fine on a statue and wrong the moment anything walks.
  //
  // Before the wound/gore/face passes, so damage and the face still paint over
  // it — mottle is the flesh's own colour, not a layer on top. Amplitude-
  // guarded like every other quality lever here (see the LOD NOTE above), so a
  // preset that leaves mottleAmp at 0 skips the fbm entirely and shades
  // bit-for-bit as it did before this existed.
  if (surfCfg2.z > 0.0) {
    // smoothstep, NOT the obvious 0.5 + 0.5*fbm remap.
    //
    // fbm here is two octaves of trilinear value noise summed at 0.6/0.3, and
    // like any such sum it concentrates hard around zero — the tails near
    // +/-0.9 are rare. Rescaling the nominal -1..1 range linearly therefore
    // lands almost every pixel near 0.5, which is not mottling at all: it is a
    // uniform half-strength tint toward mottleColor, so the body just goes
    // flatly darker and the amplitude reads as a brightness knob. That is
    // exactly what the first version did on screen.
    //
    // Mapping the range the noise ACTUALLY occupies to the full 0..1 is what
    // produces patches with light flesh between them. The bounds are the
    // working range, not the theoretical one.
    //
    // Note the frequency: fbm multiplies its own input by 4 and 9, so
    // mottleScale is roughly a quarter of the resulting cycles per metre. A
    // scale near 1 gives patches a hand-span across on a human-sized body;
    // by 5 it is already freckles, and past ~10 it aliases into what looks
    // like compression noise rather than skin.
    let blotch = smoothstep(-0.35, 0.35, fbm(anchor * surfCfg2.w));
    albedo = mix(albedo, mottleColor, blotch * surfCfg2.z);
  }

  // Gore mask (gobs-and-goo spec §2): chunks are torn meat, not clean latex.
  // fbm mottling + proximity to the torn wounds; blends toward wet deep red
  // and darker clot, and rides the wet boost so bloody regions glisten.
  // Sits BEFORE the face/char pass so a torn-off head still gets its face
  // and char painted over the gore, and before the wet line, which maxes wm
  // against gore. goreStrength is 0 on the body view, so standing bodies skip
  // the whole block — including its fbm — and shade exactly as before.
  let goreStrength = lodCfg.w;
  var gore = 0.0;
  if (goreStrength > 0.0) {
    let mottle = clamp(fbm(anchor * 6.0) * 0.5 + 0.5, 0.0, 1.0);
    gore = clamp(mottle * 0.55 + wm * 0.65, 0.0, 1.0) * goreStrength;
    let clot = deepColor * 0.55;
    albedo = mix(albedo, mix(deepColor, clot, mottle), gore * 0.85);
  }

  // Emissive mask from the face sheet; added into the lit colour further down.
  var faceGlow = 0.0;
  // Decal coverage at this pixel (facing * alpha, decal mode only): drives
  // the FLAT-LIGHTING blend at fleshLit. A painted PSX face is authored
  // pre-lit; shading it again buries the nose and lips under the fringe
  // shadow and the jaw's diffuse falloff.
  var faceFlat = 0.0;

  // Face texture, before wounds and char so damage still paints over it.
  if (faceCfg.x > 0.5) {
    let forward = faceCfg.z;
    // Head-space position, normalised PER AXIS by the skull's own semi-axes —
    // re-uploaded every frame from the posed primitives, so the projection
    // rides the head as it jiggles without a full rest-space transform. One
    // scalar radius put whichever axis was largest exactly on the head-mask
    // cutoff, and raising headDepth then erased the entire face.
    // Un-rotate into the head's REST frame before projecting (motion-polish):
    // the rigid head pass rotates the skull masses, and a projection that
    // stays axis-aligned paints the face onto whichever side happens to face
    // front — nose mass out the ear, eyes off the brow. Rotation by the
    // CONJUGATE of the head quaternion (v' = v + 2*cross(-q.xyz, cross(-q.xyz, v) + q.w*v)).
    let hql = -headQuat.xyz;
    let hpv = p - headCentre;
    let hrot = hpv + 2.0 * cross(hql, cross(hql, hpv) + headQuat.w * hpv);
    let hs = hrot / max(headAxes, vec3<f32>(1e-4, 1e-4, 1e-4));
    var raw = vec2<f32>(hs.x * forward, hs.y);
    if (faceCfg2.x > 0.5) {
      let dir = normalize(hs);
      // Longitude measured from the front, latitude from the equator. Both
      // normalised to -1..1 so faceProj means the same thing in either mode.
      // NOTE atan2 — GLSL's two-argument atan() renames on this path.
      raw = vec2<f32>(
        atan2(dir.x * forward, dir.z * forward) / 3.14159265,
        asin(clamp(dir.y, -1.0, 1.0)) / 1.57079633);
    }
    let uv0 = raw * faceProj.xy + faceProj.zw;
    // Melt drips the face off the skull (task 8): sag drags features DOWN
    // (see the FACE_MELT_SAG comment at the constants for why positive is
    // down), the stretch elongates them as they go. The offset alone would
    // slide a rigid face downward like a sticker.
    let meltSag = meltCfg.x;
    var uv = uv0;
    uv.y = uv0.y + meltSag * 0.25 - (uv0.y - faceProj.w) * meltSag * 0.6;
    // Fade by how squarely this surface faces the front, so the projection does
    // not smear a second face down the sides and back of the skull. A planar
    // projection derives uv from x/y alone, so as the surface turns away it
    // repeats the same uv column and STREAKS; fading out well before edge-on
    // hides that.
    // The facing axis is the head's rotated forward, not world +z.
    // The lower bound widens toward FACE_MELT_FADE_LO as the melt flattens
    // the head: a squashed skull's surface turns away from the forward axis
    // far sooner than a round one's, and the un-widened cutoff faded the
    // face out before it had finished dripping.
    let hfw = vec3<f32>(0.0, 0.0, forward);
    let hfr = hfw + 2.0 * cross(headQuat.xyz, cross(headQuat.xyz, hfw) + headQuat.w * hfw);
    var facing = smoothstep(mix(0.28, 0.05, meltCfg.x), 0.66, dot(n, hfr));
    // Confine it to the HEAD. Generous, because the surface now sits at
    // |hs| ~= 1 everywhere and the jaw hangs past that: this is only a backstop
    // against wrapping onto the neck.
    // A DECAL (faceCfg.x == 2) gets half again the reach: hs is normalised by
    // the FATTEST head prim, which on a character with hair is the crown
    // shell, centred well above the face -- the schoolgirl's mouth sat at
    // |hs| 1.55 and faded out at every projection setting. The decal's own
    // alpha and the facing fade bound it instead.
    // FACE MODE, faceCfg.x: 1 = sheet (MULTIPLY the rgb), 2 = decal (REPLACE
    // the albedo), 3 = LUMA multiply. Mode 3 exists because multiplying two
    // COLOURED values compounds their hue -- a skin-toned bake times skin-toned
    // flesh reads more saturated than either, which the owner spotted as the
    // face looking "more saturated from the surrounding skin". Using the
    // decal's LUMINANCE as a scalar modulates brightness and leaves hue alone.
    // Modes 1 and 2 are untouched and bit-identical.
    let decal = select(0.0, 1.0, abs(faceCfg.x - 2.0) < 0.5);
    let lumaOnly = abs(faceCfg.x - 3.0) < 0.5;
    let reach = 1.0 + 0.5 * decal;
    facing = facing * (1.0 - smoothstep(1.30 * reach, 1.70 * reach, length(hs)));
    if (facing > 0.0 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      let base = uv * faceAtlas.xy + faceAtlas.zw;
      // Not linearised, deliberately: the sheet is sRGB-encoded and so are the
      // hand-tuned flesh colours it blends against, which were authored to
      // compensate for the missing output encode. Revisit both together at the
      // preset retune, not before.
      let tex = texel(faceTex, base);
      faceFlat = facing * tex.a * decal;
      let W = vec3<f32>(0.2126, 0.7152, 0.0722);
      // DECAL mode (faceCfg.x == 2): the sheet is a colour image baked off a
      // reference mesh and pasted on as albedo where its alpha is set, the way
      // a PSX face was painted onto a head. No glow -- a photo is bright in
      // many places that are not eyes -- and no relief, because its luminance
      // edges (hairline, lips) are colour changes, not height.
      faceGlow = smoothstep(faceCfg2.z, 1.0, dot(tex.rgb, W)) * facing * tex.a * (1.0 - decal);

      // Otherwise a MULTIPLIER, not a replacement: the generated sheet carries
      // baked lighting, so pasting it in as albedo and lighting it again
      // double-shades. Dividing by its measured mean keeps the pattern and
      // throws away level.
      // Luma mode divides by the same mean, so an average texel still
      // multiplies by ~1 and the level is unchanged -- only the hue shift goes.
      let detailSrc = select(tex.rgb, vec3<f32>(dot(tex.rgb, W)), lumaOnly);
      let detail = detailSrc / max(faceCfg2.y, 1e-3);
      // Skip the multiply where it glows: an eye is not tinted flesh, and the
      // emissive term below supplies its colour outright.
      albedo = mix(albedo, mix(albedo * detail, tex.rgb, decal),
                   facing * tex.a * faceCfg.y * (1.0 - faceGlow));

      // Relief. Central differences on luminance give the height gradient; the
      // projection is planar along z, so its tangent basis is just x and y and
      // the bump drops straight into world space with no TBN to build.
      if (faceCfg.w > 0.0 && decal < 0.5) {
        let e = faceAtlas.xy * 0.012;
        let hL = dot(texel(faceTex, base - vec2<f32>(e.x, 0.0)).rgb, W);
        let hR = dot(texel(faceTex, base + vec2<f32>(e.x, 0.0)).rgb, W);
        let hD = dot(texel(faceTex, base - vec2<f32>(0.0, e.y)).rgb, W);
        let hU = dot(texel(faceTex, base + vec2<f32>(0.0, e.y)).rgb, W);
        // Negated: the gradient points UPHILL, and a normal tilts away from
        // rising ground. Without this the sockets would bulge instead of sink.
        let bumpL = vec3<f32>(-(hR - hL) * forward, -(hU - hD), 0.0);
        // The bump lives in the PROJECTION frame (the un-rotated head/hand
        // space the uv was derived in) — rotate it by headQuat into world,
        // the same rotation hfr gets above. Identity for an unrotated head;
        // load-bearing for the hands view, whose frame is a large rotation
        // (Opus hands round 3 — grooves shaded from a skewed direction).
        let bump = bumpL
          + 2.0 * cross(headQuat.xyz, cross(headQuat.xyz, bumpL) + headQuat.w * bumpL);
        // Suppressed where it glows: bright means RAISED to a height map, so
        // without this the eyes bulge out of their sockets.
        n = normalize(n + bump * faceCfg.w * facing * tex.a * (1.0 - faceGlow));
      }
    }
  }

  // PER-PRIMITIVE COLOUR. The fold already reports the nearest primitive at
  // the hit (hitBest, the noise anchor); a painted one replaces the flesh
  // albedo outright, mottle and face sheet included — a lens is not tinted
  // skin. The gloss/painted VALUES were resolved — and the row read, once —
  // up above calcNormal, where the noise suppression needs them; the
  // OVERWRITE itself stays HERE, after the face pass, because a painted
  // prim replaces everything the flesh passes laid down. Char still wins
  // below, because burnt is burnt.
  //
  // GLOW PRECEDENCE (hard-surface task 3): the eye-glow kill two lines down
  // applies to the FACE glow only — the baked sheet's own emission, which is
  // zeroed on paint for the same reason the sheet is: the painted eyes sit
  // exactly where a pair of sunglasses goes, and they must not shine through
  // the lenses. Per-prim glow (primGlow, primClip.w) is AUTHORED emission on
  // the prim itself, packed per prim, and deliberately SURVIVES this kill:
  // the whole point of glow= is a prim that emits — the minotaur's red eyes
  // — and those prims are painted (glow= is parse-gated on color=). The face
  // sheet under a painted prim contributes exactly what it always did here
  // (zero); the prim's own authored emission is a separate additive term at
  // the composite. Nothing in that kill reads primGlow, so the sunglasses
  // rule is intact BY CONSTRUCTION, not by a second kill that could drift.
  if (painted > 0.0) {
    albedo = primAlbedo;
  }
  faceGlow = faceGlow * (1.0 - painted);

  albedo = mix(albedo, charColor, cm);

  // MELT (2026-09-03, task 6) — the wet red, on flesh ONLY.
  //
  // The colour LEADS the sag: the reference goes red while the body is still
  // standing, before any height is visibly lost, so the ramp runs on
  // smoothstep(clamp(meltCfg.x * 2)) and is essentially complete by half
  // progress. That is the frame that reads as "melt" rather than "fall".
  //
  // A dominant BONE row does the opposite: it goes PALE (boneColor, the
  // wound pass's exposed-bone colour) and stays matte — the wetness boost
  // below skips it. Pale matte bones sitting in wet red goo is the contrast
  // this effect lives on, and before this branch a bone row winning the fold
  // shaded as plain meat (the old bone-albedo branch was deleted with the
  // bone-tubes pack flag), which would have reddened the very skeleton the
  // melt exists to reveal.
  //
  // meltCfg.x is 0 everywhere except a melting body and its released bone
  // chunks, so every other pixel shades bit-identical to before this existed.
  let meltU = smoothstep(0.0, 1.0, clamp(meltCfg.x * 2.0, 0.0, 1.0));
  if (meltU > 0.0) {
    if (isBone) {
      albedo = mix(albedo, boneColor, meltU * 0.9);
    } else {
      // Patchy, not uniform: skin sloughs in pieces. Each point crosses over
      // at its OWN progress, read off the rest-space anchor, and the patches
      // scaled past 1.0 by MELT_SKIN_KEEP never cross at all — so pink skin
      // survives in the finished puddle instead of everything staining red
      // together. See the constants for the owner's brief.
      // NB 'patch' is a RESERVED KEYWORD in WGSL — naming this variable that
      // compiles fine in TypeScript and fails the shader at runtime, which
      // renders the body invisible rather than erroring anywhere a test looks.
      let skinPatch = clamp(fbm(anchor * 5) * 2.8 * 0.5 + 0.5, 0.0, 1.0);
      let thresh = skinPatch * 1.3;
      let local = smoothstep(thresh - 0.16, thresh + 0.16, meltU);
      albedo = mix(albedo, deepColor * 0.8, local * 0.8);
    }
  }

  // Wounds are wetter than the surrounding skin; char is dead matte. Gore
  // rides the same boost: bloody chunk regions glisten like open wounds.
  // gloss pulls a painted surface toward a tight, fully wet highlight
  // whatever the flesh preset says: a lens on a matte clay character still
  // has to glint.
  //
  // Wound pass r2: wetness peaks at the fat/muscle boundary — the lip
  // glistens, the floor does not — instead of wetting the whole crater
  // uniformly. At woundDepthAmp 0 tissueDepth is 0, so lip is 1 and
  // wetWound is exactly the old max(wm, gore): the amp-0 guarantee survives
  // this line. Bone is matte — wet skin reflects, wet bone just looks
  // polished.
  let lip = 1.0 - smoothstep(surfCfg3.z, surfCfg3.z * 3.0, tissueDepth);
  let wetWound = max(wm * lip, gore);
  var wet = mix(surfCfg2.x * mix(1.0, 1.6, wetWound) * (1.0 - cm) * select(1.0, 1.8, isOrgan), 1.0, gloss);
  // Melt wetness (task 6): liquefying flesh goes FULLY wet — the puddle
  // glistens. FLESH ONLY: bone stays matte (the anchor comment above — wet
  // skin reflects, wet bone just looks polished), and that matte-vs-wet
  // contrast is what makes pale bones read inside the red puddle.
  // 1.6, the wound-wetness precedent: 2.2 was the first guess and the
  // near-level capture showed the whole grazing-angle puddle clipping to
  // paper white — wet, yes; blown out, no.
  if (meltU > 0.0) {
    wet = mix(wet, select(1.6, 0.45, isBone), meltU);
  }
  // The legacy shine exponent, named so the lighting tail and the deferred
  // surface output share one definition: the surface's roughness inverts the
  // shared light pass's exponent mapping against exactly this value.
  let specPow = mix(mix(128.0, 4.0, surfCfg.y), 220.0, gloss);

  // The eye REPLACES the flesh rather than adding to it.
  //
  // This used to be a pure addition, and it could not produce a red eye. Lit
  // flesh is already bright — roughly (1.16, 0.60, 0.62) with the key on it —
  // so adding a red emissive on top gives something like (4.2, 0.62, 0.63).
  // The output sRGB encode then clamps red at 1.0 while lifting the low
  // channels hard (0.62 encodes to 0.81), and the eye lands at RGB(255, 206,
  // 208): a pale cream, with the red only visible where it spilled onto the
  // darker skin around the socket. Exactly the reported symptom.
  //
  // Fading the flesh out under the glow also matches what the GLSL header
  // always claimed — "an eye should not be lit by the key light at all" — a
  // statement the code never actually implemented.
  let glow = faceGlowColor * faceGlow * faceCfg2.w
           * flicker(faceCfg3.y, faceCfg3.x) * (1.0 - cm)
           // PER-PRIM GLOW (hard-surface task 3): the same two lines keyed
           // off the prim row instead of the face texture. The colour is the
           // prim's OWN albedo (design C — a prim with color=ff2200 glow=0.9
           // glows red because it IS red), the strength is the authored
           // 0..1 from primClip.w. No faceCfg2.w global (the authored value
           // IS the strength) and no flicker (that is the face sheet's
           // heartbeat). Char kills it exactly as it kills the face glow:
           // burnt is burnt.
           + primAlbedo * primGlow * (1.0 - cm);

  // ---- SURFACE OUTPUT (hybrid deferred M1 task 2) -------------------------
  // Exit BEFORE every light-dependent term. Everything written here is unlit
  // linear material data from the production hit evaluation above.
  var surfRough = 1.0 - log2(max(specPow - 2.0, 1.0)) / 8.0;
  surfRough = clamp(mix(1.0, surfRough, min(wet, 1.0)) / max(wet, 1.0), 0.04, 1.0);
  gSdfAlbedoRough = vec4<f32>(albedo, surfRough);
  gSdfNormalMetal = vec4<f32>(normalize(n), metal);
  gSdfEmissionClass = vec4<f32>(glow, 2.0);
  // vec4(albedo, t) exactly like the legacy entry: createMarchMaterial turns
  // t into the surfaceDepth attachment and the hardware depthNode with the
  // SAME clip formula, so both modes preserve the same traced hit depth.
  return vec4<f32>(albedo, t);
}

fn sdfSurfaceReadAlbedo ( dep: vec4<f32> ) -> vec4<f32> {
  return gSdfAlbedoRough;
}

fn sdfSurfaceReadNormal ( dep: vec4<f32> ) -> vec4<f32> {
  return gSdfNormalMetal;
}

fn sdfSurfaceReadEmission ( dep: vec4<f32> ) -> vec4<f32> {
  return gSdfEmissionClass;
}



@fragment
fn main( @location( 0 ) v_positionWorld : vec3<f32>,
	@builtin( position ) fragCoord : vec4<f32> ) -> OutputType {

	// flow
	// code

	sdfTrace = marchSurface( v_positionWorld, render.cameraPosition, nodeUniform4, nodeUniform5, nodeUniform6, object.nodeUniform7, object.nodeUniform8, object.nodeUniform9, object.nodeUniform10, object.nodeUniform11, object.nodeUniform12, object.nodeUniform13, object.nodeUniform14, object.nodeUniform15, object.nodeUniform16, object.nodeUniform17, object.nodeUniform18, object.nodeUniform19, object.nodeUniform20, object.nodeUniform21, object.nodeUniform22, object.nodeUniform23, object.nodeUniform24, object.nodeUniform25, object.nodeUniform26, object.nodeUniform27, object.nodeUniform28, object.nodeUniform29, object.nodeUniform30, object.nodeUniform31, object.nodeUniform32, object.nodeUniform33, object.nodeUniform34, object.nodeUniform35, object.nodeUniform36, object.nodeUniform37, object.nodeUniform38, object.nodeUniform39, object.nodeUniform40, object.nodeUniform41, object.nodeUniform42, object.nodeUniform43, object.nodeUniform44, object.nodeUniform45, object.nodeUniform46, object.nodeUniform47, object.nodeUniform48, object.nodeUniform49, object.nodeUniform50, object.nodeUniform51, object.nodeUniform52, object.nodeUniform53, object.nodeUniform54, object.nodeUniform55, object.nodeUniform56, object.nodeUniform57, object.nodeUniform58, object.nodeUniform59, object.nodeUniform60, &NodeBuffer_1240.value, &NodeBuffer_1241.value, object.nodeUniform63, ( fragCoord.xy / object.nodeUniform64 ), 0.0, 1000000000.0, 0.0, 1000000000.0, object.nodeUniform65, 1000000000.0, ( object.nodeUniform66 * vec4<f32>( 0.0, 0.0, 0.0, 1.0 ) ).xyz, object.nodeUniform67, object.nodeUniform68, nodeUniform69, object.nodeUniform70, object.nodeUniform71, object.nodeUniform72, object.nodeUniform73, object.nodeUniform74, nodeUniform75, object.nodeUniform76, object.nodeUniform77 );
	nodeVar0 = ( render.cameraProjectionMatrix * ( render.cameraViewMatrix * vec4<f32>( ( render.cameraPosition + ( normalize( ( v_positionWorld - render.cameraPosition ) ) * vec3<f32>( sdfTrace.w ) ) ), 1.0 ) ) );
	nodeVar1 = ( nodeVar0.z / nodeVar0.w );
	output.depth = nodeVar1;
	DiffuseColor = vec4<f32>( object.nodeUniform78, 1.0 );
	DiffuseColor.w = ( DiffuseColor.w * object.nodeUniform79 );
	DiffuseColor.w = 1.0;
	Output = max( vec4<f32>( DiffuseColor.xyz, DiffuseColor.w ), vec4<f32>( 0.0 ) );
	nodeVar2 = sdfSurfaceReadAlbedo( sdfTrace );
	output.m0 = nodeVar2;
	nodeVar3 = sdfSurfaceReadNormal( sdfTrace );
	output.m1 = nodeVar3;
	nodeVar4 = sdfSurfaceReadEmission( sdfTrace );
	output.m2 = nodeVar4;
	nodeVar5 = vec4<f32>( nodeVar1, 0.0, 0.0, 1.0 );
	output.m3 = nodeVar5.x;

	// result

	return output;

}
