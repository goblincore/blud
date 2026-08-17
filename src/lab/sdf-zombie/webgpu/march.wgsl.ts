// src/lab/sdf-zombie/webgpu/march.wgsl.ts
//
// WGSL port of march.glsl.ts. Kept as a near line-for-line translation on
// purpose — the WebGPU spec argues for raw WGSL over a TSL node graph
// specifically so this stays diffable against the GLSL original AND against
// validate.ts's CPU mirror. Nothing here checks that mirror automatically, and
// it backs click-to-shoot raycasting, so a human has to be able to read the
// two side by side.
//
// ============================ HOW wgslFn PARSES =============================
// Two hard constraints, both discovered the painful way, both presenting as
// the single unhelpful error "FunctionNode: Function is not a WGSL code."
//
//   1. Each source string must BEGIN with `fn`. three's declarationRegexp is
//      ^-anchored (see WGSLNodeFunction.js), so a leading comment — even a
//      blank first line — makes the parse fail outright. Every comment in this
//      file therefore sits OUTSIDE the template strings, or inside a body.
//
//   2. Helpers cannot simply be concatenated ahead of the entry point, because
//      of (1), nor after it, because WGSL requires declaration before use.
//      They are passed through wgslFn's second argument, `includes`, which is
//      the mechanism three provides for exactly this. See buildMarchFn().
// ============================================================================
//
// PRIMITIVE DATA ARRIVES AS A FLOAT TEXTURE, not uniform arrays. That is the
// substantive win of the migration: uniforms capped the body near 48
// primitives against a 224-vec4 floor, whereas a texture has no such ceiling
// (this device reports a 4 GB storage limit). Layout, MAX_PRIMS wide:
//
//   row 0  primA        xyz = endpoint A, w = radius
//   row 1  primB        xyz = endpoint B, w = blendK
//   row 2  primScale    xyz = ellipsoid scale, w = 1 when this is a carve
//   row 3  clusterBnds  xyz = centre, w = radius
//   row 4  clusterRange x = start, y = count, z = alive
//   row 5  wound        xyz = world position, w = radius
//   row 6  woundMeta    x = type (0 pellet, 1 blast, 2 burn), y = age
//   row 7  primQuat     xyzw = per-prim orientation (identity = 0,0,0,1)
//
// DIVERGENCE NOTE (2026-08-17, motion-polish task 3): row 7 / per-prim
// orientation exists ONLY here. The GLSL twin (march.glsl.ts) is FROZEN per
// owner decision and keeps world-axis ellipsoid squash — its lab renders a
// posed head with the old detached-visor artefact. Do not port this back.
//
// Wounds ride the SAME texture rather than a uniform array, which the GLSL
// path had to use. MAX_WOUNDS (16) is comfortably under MAX_PRIMS (48), so
// they fit in two more rows and the whole per-body payload stays one upload.
//
// TRANSLATION TRAPS, all of which bite silently:
//   - `a ? b : c` becomes `select(c, b, a)` — the ARGUMENT ORDER FLIPS.
//   - GLSL's two-argument `atan(y, x)` is `atan2(y, x)` in WGSL; one-argument
//     `atan` keeps its name, so a mis-port compiles and returns nonsense.
//   - No implicit int/float conversion; loop bounds need explicit casts.
//   - WGSL has no `discard` expression, only the statement.
//   - WGSL RESERVES a long list of ordinary-looking identifiers that GLSL is
//     happy with: `meta`, `type`, `filter`, `set`, `shared`, `sample`, `mut`,
//     `ref`, `match`, `pass`, `line`, `precise`... `let meta = ...` cost a
//     blank page here. RESERVED_WORDS in march.wgsl.test.ts now fails the
//     build for any of them, so this is a test failure rather than a
//     pipeline-creation error nobody reads.

export const DATA_ROWS = 8;
export const ROW_PRIM_A = 0;
export const ROW_PRIM_B = 1;
export const ROW_PRIM_SCALE = 2;
export const ROW_CLUSTER_BOUNDS = 3;
export const ROW_CLUSTER_RANGE = 4;
export const ROW_WOUND = 5;
export const ROW_WOUND_META = 6;
export const ROW_PRIM_QUAT = 7;


// iq quadratic polynomial smooth-min: rigid, and conservative (never
// overestimates, which would punch holes during sphere tracing). NOT
// associative, so the cluster fold order is fixed and must stay that way.
// The k <= 0 short-circuit is load-bearing rather than a guard: blendK 0 is how
// face features get a HARD crisp edge instead of a smear, and hard min/max ARE
// associative, so zero-blend features are exempt from the ordering constraint.
export const SMIN = /* wgsl */ `fn smin(a: f32, b: f32, kIn: f32) -> f32 {
  let k = kIn * 4.0;
  if (k <= 0.0) { return min(a, b); }
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}`;

export const SMAX = /* wgsl */ `fn smax(a: f32, b: f32, k: f32) -> f32 {
  return -smin(-a, -b, k);
}`;

// Ellipsoid capsule. Mirrors sdPrimitive() in validate.ts exactly; edit both in
// the same commit or click-to-shoot drifts from what is drawn.
export const SD_PRIM = /* wgsl */ `fn sdPrim(p: vec3<f32>, i: i32, data: texture_2d<f32>) -> f32 {
  let A = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_A}), 0);
  let B = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_B}), 0);
  let S = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SCALE}), 0);
  var qq = p;
  var a = A.xyz;
  var b = B.xyz;
  // Per-prim orientation (motion-polish task 3): rotate the sample AND the
  // endpoints into the prim's local frame — the CONJUGATE rotation about the
  // prim midpoint — BEFORE the scale-divide, so an anisotropic ellipsoid (the
  // brow is [1.55, 0.42, 0.80]) turns with the head instead of staying
  // world-aligned as a detached visor. Identity quats — everything except
  // rig-posed skull prims — pay one compare and a texture fetch.
  let O = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_QUAT}), 0);
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
  }
  let inv = 1.0 / S.xyz;
  qq = qq * inv;
  a = a * inv;
  b = b * inv;
  let ab = b - a;
  let ap = qq - a;
  let ab2 = dot(ab, ab);
  // select() is (falseValue, trueValue, condition) — reversed from a ternary.
  let t = select(clamp(dot(ap, ab) / ab2, 0.0, 1.0), 0.0, ab2 == 0.0);
  let minScale = min(S.x, min(S.y, S.z));
  return (length(qq - (a + ab * t)) - A.w) * minScale;
}`;

export const HASH13 = /* wgsl */ `fn hash13(pIn: vec3<f32>) -> f32 {
  var p = fract(pIn * 0.1031);
  p = p + dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}`;

export const NOISE3 = /* wgsl */ `fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let n = mix(
    mix(mix(hash13(i + vec3<f32>(0.0, 0.0, 0.0)), hash13(i + vec3<f32>(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3<f32>(0.0, 1.0, 0.0)), hash13(i + vec3<f32>(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3<f32>(0.0, 0.0, 1.0)), hash13(i + vec3<f32>(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3<f32>(0.0, 1.0, 1.0)), hash13(i + vec3<f32>(1.0, 1.0, 1.0)), f.x), f.y), f.z);
  return n * 2.0 - 1.0;
}`;

export const FBM = /* wgsl */ `fn fbm(p: vec3<f32>) -> f32 {
  return noise3(p * 4.0) * 0.6 + noise3(p * 9.0) * 0.3;
}`;

// Carves every subtractive primitive out of the assembled field, AFTER the
// complete additive fold and in fixed cluster order — the structure the GLSL
// version uses for wounds. Carving per-cluster would restructure a
// non-associative fold and change the surface everywhere.
export const APPLY_CARVES = /* wgsl */ `fn applyCarves(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>) -> f32 {
  var d = dIn;
  if (counts.z < 0.5) { return d; }
  let clusterCount = i32(counts.y);
  let primCount = i32(counts.x);
  for (var c = 0; c < 8; c = c + 1) {
    if (c >= clusterCount) { break; }
    let range = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_RANGE}), 0);
    if (range.z < 0.5) { continue; }
    let start = i32(range.x);
    let count = i32(range.y);
    for (var i = 0; i < 64; i = i + 1) {
      if (i >= count) { break; }
      let idx = start + i;
      if (idx >= primCount) { break; }
      let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE}), 0);
      // S.w: 0 add, 1 carve, 2 dead (severed mid-limb). Dead prims stop
      // carving too — a severed hand must not keep biting the field it left.
      if (S.w < 0.5 || S.w > 1.5) { continue; }
      let k = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B}), 0).w;
      d = smax(d, -sdPrim(p, idx, data), k);
    }
  }
  return d;
}`;

// Carves every wound out of the field. Burns barely subtract; they char.
//
// woundCfg  = (count, blendK, rimSplay, rimOffset)
// woundCfg2 = (rimWidth, relax, shellAmp, spare) — y and z are consumed by
//             MARCH_BODY, not here; see the woundCfg2 note at the entry point.
export const APPLY_WOUNDS = /* wgsl */ `fn applyWounds(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>) -> f32 {
  var d = dIn;
  let n = i32(woundCfg.x);
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= n) { break; }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
    let wMeta = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_META}), 0);
    let isBurn = wMeta.x > 1.5;
    // A burn only opens up as it cooks; a pellet/blast subtracts immediately.
    let depth = select(w.w, w.w * 0.35 * clamp(wMeta.y, 0.0, 1.0), isBurn);
    let r = length(p - w.xyz);

    d = smax(d, -(r - depth), woundCfg.y);

    // Everted rim. A plain smooth subtraction leaves a clean dish; real flesh
    // (and the T-1000 taking a shotgun round) PEELS — the displaced material
    // splays outward into a raised lip around the mouth.
    //
    // Modelled as a Gaussian ring just outside the crater. Subtracting from d
    // means "more material here", so this adds a bulge rather than a dent.
    // Burns evert far less: they char and contract instead of tearing open.
    let x = (r - depth * woundCfg.w * wMeta.w) / max(depth * woundCfg2.x, 1e-4);
    let amp = depth * woundCfg.z * wMeta.z * select(1.0, 0.25, isBurn);
    // Surface locality: a bulge of amplitude amp can only displace flesh that
    // was already within ~amp of the pre-wound surface. Ungated, the shell
    // adds material in EMPTY space and welds separate limbs together.
    // Tighter reach than the first cut: 0.35/0.7 (was 0.5/1.2). At blast
    // amplitude the old reach exceeded the armpit gap and the rim still
    // bridged arm to torso from the shoulder side.
    let rimLocal = 1.0 - smoothstep(amp * 0.35, amp * 0.7, dIn);
    d = d - exp(-x * x) * amp * rimLocal;
  }
  return d;
}`;

// 0 at the surface far from wounds, 1 deep inside one. Drives the wet interior.
export const WOUND_MASK = /* wgsl */ `fn woundMask(p: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>) -> f32 {
  var m = 0.0;
  let n = i32(woundCfg.x);
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= n) { break; }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
    m = max(m, 1.0 - smoothstep(0.0, w.w * 1.6, length(p - w.xyz)));
  }
  return m;
}`;

// 0 unburned, 1 fully charred.
export const CHAR_MASK = /* wgsl */ `fn charMask(p: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>) -> f32 {
  var m = 0.0;
  let n = i32(woundCfg.x);
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= n) { break; }
    let wMeta = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_META}), 0);
    if (wMeta.x < 1.5) { continue; }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
    m = max(m, (1.0 - smoothstep(0.0, w.w * 2.2, length(p - w.xyz))) * clamp(wMeta.y, 0.0, 1.0));
  }
  return m;
}`;

// The cull margin's 4.0 matters: smin scales k by 4 internally, so a cluster
// still bends the surface from 4x the authored blendK away. Using the unscaled
// value clips the fillet and shows up as hard creases along cluster edges.
//
// Carves come first: they are part of the body's own definition. Wounds are
// damage stamped on top of the finished body.
export const MAP_BODY = /* wgsl */ `fn mapBody(p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, noiseAmp: f32, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, noiseShift: vec3<f32>) -> f32 {
  var d = 1e9;
  let clusterCount = i32(counts.y);
  let primCount = i32(counts.x);
  for (var c = 0; c < 8; c = c + 1) {
    if (c >= clusterCount) { break; }
    let range = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_RANGE}), 0);
    if (range.z < 0.5) { continue; }
    let bounds = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_BOUNDS}), 0);
    if (length(p - bounds.xyz) - bounds.w > d + counts.w * 4.0) { continue; }
    let start = i32(range.x);
    let count = i32(range.y);
    for (var i = 0; i < 64; i = i + 1) {
      if (i >= count) { break; }
      let idx = start + i;
      if (idx >= primCount) { break; }
      let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE}), 0);
      // S.w: 0 add, 1 carve, 2 dead (severed mid-limb) — both skip the fold.
      if (S.w > 0.5) { continue; }
      let k = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B}), 0).w;
      d = smin(d, sdPrim(p, idx, data), k);
    }
  }
  let carved = applyCarves(d, p, data, counts);
  let dmg = applyWounds(carved, p, data, woundCfg, woundCfg2);
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
  if (noiseAmp <= 0.0) { return dmg; }
  // NOISE ANCHOR (motion-polish): the field is packed in WORLD space but the
  // noise must ride the FLESH — sampled at p minus the body's root shift
  // (faceCfg3.zw), so a walking body does not slide through a stationary
  // noise field. Callers with noiseAmp 0 may pass any shift; the term is dead.
  return dmg + fbm((p - noiseShift) * 3.0) * noiseAmp;
}`;

// Tetrahedron differences. Epsilon stays SMALL: the prior blendshell experiment
// used 0.02 (2 cm on 6 cm limbs) and smeared normals exactly at the
// high-curvature joints where they matter most.
export const CALC_NORMAL = /* wgsl */ `fn calcNormal(p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, noiseAmp: f32, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, noiseShift: vec3<f32>) -> vec3<f32> {
  let e = vec2<f32>(1.0, -1.0) * 0.0015;
  return normalize(
    e.xyy * mapBody(p + e.xyy, data, counts, noiseAmp, woundCfg, woundCfg2, noiseShift) +
    e.yyx * mapBody(p + e.yyx, data, counts, noiseAmp, woundCfg, woundCfg2, noiseShift) +
    e.yxy * mapBody(p + e.yxy, data, counts, noiseAmp, woundCfg, woundCfg2, noiseShift) +
    e.xxx * mapBody(p + e.xxx, data, counts, noiseAmp, woundCfg, woundCfg2, noiseShift));
}`;

// Nearest-neighbour fetch by uv.
//
// textureLoad rather than textureSample, deliberately: the face sheet is
// authored as chunky NearestFilter art on both paths, so a sampler would buy
// nothing but a second binding to declare — and wgslFn's `sampler` parameter
// has no TSL node to feed it that the data-texture path already proves out.
// Clamp-to-edge is done here by hand, which is what the GLSL sampler's default
// wrap mode was doing implicitly.
export const TEXEL = /* wgsl */ `fn texel(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(tex, 0));
  let c = clamp(vec2<i32>(floor(uv * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  return textureLoad(tex, c, 0);
}`;

// Irregular flicker. Three incommensurate sines rather than one, because a
// single sine reads as a machine pulsing and the eye picks the period out
// immediately; overlapping periods never quite repeat.
export const FLICKER = /* wgsl */ `fn flicker(t: f32, amt: f32) -> f32 {
  let a = sin(t * 11.3) * 0.5 + 0.5;
  let b = sin(t * 23.7 + 1.3) * 0.5 + 0.5;
  let c = sin(t * 3.1 + 0.7) * 0.5 + 0.5;
  let f = a * 0.35 + b * 0.25 + c * 0.40;
  // Biased upward so it mostly burns and only occasionally dips, rather than
  // spending half its time dark.
  return mix(1.0, 0.45 + f * 0.75, amt);
}`;

// CONE MARCH — the coarse pre-pass.
//
// Runs at a fraction of the resolution and answers one question per tile: how
// far can EVERY ray in this tile travel before any of them could possibly hit
// something? The full-resolution march then starts there instead of at the
// camera, skipping the empty space in front of the body.
//
// The cone is what makes it safe. A ray marched at tile centre would report a
// distance valid only for that one ray; a neighbouring ray in the same tile
// might have geometry nearer and would tunnel straight through it. So this
// marches a CONE whose radius grows with distance to cover the tile's whole
// screen footprint, and stops as soon as the field comes within that radius.
// The result is conservative for every ray the tile covers.
//
// `coneK` is the footprint radius per unit distance: tilePixels * tan(fovY/2)
// / viewportHeight. Stepping by (d - r) rather than d is the standard cone
// march step — it is what keeps the cone outside the surface.
//
// LEVELS CHAIN, AND FINER IS WHAT HELPS. A coarser level above the first would
// only cheapen the pre-pass, which is already a fraction of the pixels; it
// would not improve the distance handed to the full march. A FINER level does,
// because coneK shrinks with tile size and a narrower cone travels further
// before it touches. So the chain runs wide to narrow — 8x8, then 2x2 — each
// starting from the last.
//
// Returns the distance, or tMax when the cone never came near anything. tMax
// is the right answer for a miss rather than zero: a cone that missed means
// every ray in the tile misses too, so there is nothing for them to skip past.
export const CONE_MARCH = /* wgsl */ `fn coneMarch(
  worldPos: vec3<f32>,
  camPos: vec3<f32>,
  data: texture_2d<f32>,
  counts: vec4<f32>,
  marchCfg: vec3<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  coneK: f32,
  startT: f32
) -> f32 {
  let rd = normalize(worldPos - camPos);
  let tMax = length(worldPos - camPos);
  // Chained levels: this cone begins where the coarser one stopped. Safe
  // because a NARROWER cone can only travel further than a wider one before
  // touching — which is the whole reason a second, finer level is worth
  // running at all.
  var t = clamp(startT, 0.0, tMax);
  for (var i = 0; i < 64; i = i + 1) {
    // 0.0 for the noise: it lives on the normal now, not in the field. The
    // pre-pass must see the same field the march does, or the distance it
    // certifies as empty is not a distance the march can trust. The noise
    // shift is irrelevant at amplitude 0 (mapBody short-circuits the fbm), so
    // the zero vector keeps this pass independent of the motion plumbing.
    let d = mapBody(camPos + rd * t, data, counts, 0.0, woundCfg, woundCfg2, vec3<f32>(0.0, 0.0, 0.0));
    let r = t * coneK;
    // + woundCfg2.z (shell displacement, X1.21.2): the emptiness this pass
    // certifies is measured against the SMOOTH field, but the shell displaces
    // the real surface OUTWARD by up to ~0.9 amp wherever the fbm dips. A
    // bump standing proud of the smooth surface can sit CLOSER to the camera
    // than the distance this pass proved empty, so a march started there
    // skips its crest whole — hard-edged pale tile-shaped patches across
    // shoulders and arms, because the miss is per tile. Stopping one amp
    // early hands that band back to the full march, which walks it
    // conservative and hits the bumps properly. Zero when the shell is off,
    // so the undisplaced behaviour is bit-identical.
    if (d < r + 0.0012 + woundCfg2.z) { return t; }
    t = t + max(d - r, 0.0005) * marchCfg.y;
    if (t > tMax) { return tMax; }
  }
  return t;
}`;

// Entry point. Returns rgb plus the hit distance in w, so the depth node can
// reconstruct the hit point without marching a second time.
//
// Parameter groups, all vec4-packed to keep the argument list survivable:
//   counts     x primCount, y clusterCount, z carveCount, w maxBlendK
//   marchCfg   x steps, y stepMul, z silhouetteNoiseAmp
//   woundCfg   x count, y blendK, z rimSplay, w rimOffset
//   woundCfg2  x rimWidth, y relaxation factor, z shellAmp (silhouette shell)
//   lightCfg   x keyIntensity, y fillIntensity
//   surfCfg    x specIntensity, y specRoughness, z fresnelBoost, w translucency
//   surfCfg2   x wetness, y surfaceNoiseAmp
//   faceCfg    x enabled, y strength, z forward (+1/-1), w relief
//   faceCfg2   x projMode (0 planar, 1 spherical), y mean, z glowThreshold,
//              w glowStrength
//   faceCfg3   x glowFlicker, y timeSeconds, zw = noise root shift (xz world;
//              the y shift is zero — root translation is ground-plane)
//   faceProj   xy = scale of head-space xy -> uv, zw = uv centre
//   headQuat   xyzw = the rigid head rotation (rig-bind headQuatOf); the face
//              projection un-rotates by its conjugate so the painted face
//              rides the rotating skull. Identity (0,0,0,1) on statues/chunks.
//   faceAtlas  xy = uv scale, zw = uv offset — crops the head out of the sheet
//   lodCfg     x aoEnabled, y legacyGamma, w goreStrength (0 body, 1 chunk views)
//
// LOD NOTE: most quality levers are guarded by their own amplitude reaching
// zero (silhouette noise, surface noise, translucency, face, wounds), so the
// LOD system drives them through uniforms that already existed. AO needs
// lodCfg.x because "no ambient occlusion" has no amplitude to turn down;
// the gore mask took the spare lodCfg.w for the same reason — "no gore"
// has no colour amplitude to fade to.
export const MARCH_BODY = /* wgsl */ `fn marchBody(
  worldPos: vec3<f32>,
  camPos: vec3<f32>,
  data: texture_2d<f32>,
  faceTex: texture_2d<f32>,
  counts: vec4<f32>,
  marchCfg: vec3<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  baseColor: vec3<f32>,
  deepColor: vec3<f32>,
  charColor: vec3<f32>,
  lightDir: vec3<f32>,
  keyColor: vec3<f32>,
  lightCfg: vec2<f32>,
  surfCfg: vec4<f32>,
  surfCfg2: vec2<f32>,
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
  startT: f32,
  occT: f32
) -> vec4<f32> {
  let rd = normalize(worldPos - camPos);
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
  let tMax = min(length(worldPos - camPos), occT + woundCfg2.z);
  let steps = i32(marchCfg.x);
  // NOISE ANCHOR (motion-polish): every fbm below samples at p - noiseShift
  // so surface noise, silhouette noise, shell displacement and gore mottle
  // ride the flesh instead of staying pinned to world space while the body
  // walks. Packed into faceCfg3.zw — the only spare vec2 in the uniform set
  // (see zombie-gpu.ts). Zero = the pre-motion behaviour, bit-identical.
  let noiseShift = vec3<f32>(faceCfg3.z, 0.0, faceCfg3.w);

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
  // NORMAL WARPING (Hubert-Brierre et al. 2025) is why this is no longer
  // conditional on the noise amplitude. The silhouette fbm has been taken OUT
  // of the marched field — see the mapBody call below, which passes 0.0 — and
  // survives only in calcNormal, where it perturbs the shading normal at the
  // hit point. The field the tracer sees is therefore an exact CSG of
  // ellipsoid capsules under a conservative smooth-min for EVERY body, not
  // just the distant ones LOD had already stripped, so over-relaxation is
  // always safe and marchCfg.y no longer has to be held under 1.
  //
  // SHELL DISPLACEMENT (gobs-and-goo task 4) is the owner-approved middle
  // path that brings the bumpy outline BACK: the relaxed march runs the
  // smooth field until it is inside a thin shell of the surface, and only
  // there does the fbm displace the stepped distance — see the loop body.
  let relax = woundCfg2.y > 1.0;
  var omega = select(marchCfg.y, woundCfg2.y, relax);
  // Start where the cone pre-pass proved the tile is still empty, rather than
  // at the camera. Clamped to tMax so a stale or over-eager coarse value can
  // never push the ray straight out the back of the proxy box.
  var t = clamp(startT, 0.0, tMax);
  var hit = false;
  var prevRadius = 0.0;
  var stepLen = 0.0;
  var clamped = false;
  for (var i = 0; i < 512; i = i + 1) {
    if (i >= steps) { break; }
    // 0.0, not marchCfg.z: the field mapBody returns stays SMOOTH — the fbm
    // still reaches the normal only via calcNormal — but inside a thin shell
    // of the surface the same fbm is added to the REAL stepped distance just
    // below, which is where the silhouette gets its bumps back without
    // paying fbm at every step of the empty approach.
    var d = mapBody(camPos + rd * t, data, counts, 0.0, woundCfg, woundCfg2, noiseShift);
    // Shell displacement: inside a thin shell of the smooth surface, the
    // silhouette noise displaces the REAL field — bumpy outlines are back —
    // and stepping goes conservative because the noise breaks the Lipschitz
    // bound. Outside the shell the relaxed march is untouched.
    let shellAmp = woundCfg2.z;
    var conservative = false;
    if (shellAmp > 0.0 && abs(d) < shellAmp * 4.0) {
      d = d + fbm((camPos + rd * t - noiseShift) * 3.0) * shellAmp;
      conservative = true;
    }
    let radius = abs(d);
    let overshot = !conservative && omega > 1.0 && (radius + prevRadius) < stepLen;
    if (overshot) {
      // Undo the part of the last step that was not covered by the spheres,
      // and drop to plain sphere tracing for the rest of this ray. Skipped on
      // a displaced sample — the retraction rewinds by the omega excess,
      // which is only the real excess when stepLen was d times omega, and a
      // shell step was already under-relaxed at 0.6 so there is nothing to
      // take back.
      stepLen = stepLen - omega * stepLen;
      omega = 1.0;
    } else {
      if (d < 0.0012) { hit = true; break; }
      stepLen = d * select(omega, 0.6, conservative);
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
  if (!hit) { discard; }

  let p = camPos + rd * t;
  var n = calcNormal(p, data, counts, marchCfg.z, woundCfg, woundCfg2, noiseShift);
  // Micro-detail perturbs the normal only — costs no march safety. Three more
  // fbm calls though, so it is guarded: once per hit pixel rather than per
  // step, but still six noise lookups a body does not always need.
  if (surfCfg2.y > 0.0) {
    n = normalize(n + vec3<f32>(
      fbm((p - noiseShift) * 22.0), fbm((p - noiseShift) * 22.0 + 5.0), fbm((p - noiseShift) * 22.0 + 11.0)) * surfCfg2.y);
  }

  let wm = woundMask(p, data, woundCfg);
  let cm = charMask(p, data, woundCfg);
  var albedo = mix(baseColor, deepColor, wm);

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
    let mottle = clamp(fbm((p - noiseShift) * 6.0) * 0.5 + 0.5, 0.0, 1.0);
    gore = clamp(mottle * 0.55 + wm * 0.65, 0.0, 1.0) * goreStrength;
    let clot = deepColor * 0.55;
    albedo = mix(albedo, mix(deepColor, clot, mottle), gore * 0.85);
  }

  // Emissive mask from the face sheet; added into the lit colour further down.
  var faceGlow = 0.0;

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
    let uv = raw * faceProj.xy + faceProj.zw;
    // Fade by how squarely this surface faces the front, so the projection does
    // not smear a second face down the sides and back of the skull. A planar
    // projection derives uv from x/y alone, so as the surface turns away it
    // repeats the same uv column and STREAKS; fading out well before edge-on
    // hides that.
    // The facing axis is the head's rotated forward, not world +z.
    let hfw = vec3<f32>(0.0, 0.0, forward);
    let hfr = hfw + 2.0 * cross(headQuat.xyz, cross(headQuat.xyz, hfw) + headQuat.w * hfw);
    var facing = smoothstep(0.28, 0.66, dot(n, hfr));
    // Confine it to the HEAD. Generous, because the surface now sits at
    // |hs| ~= 1 everywhere and the jaw hangs past that: this is only a backstop
    // against wrapping onto the neck.
    facing = facing * (1.0 - smoothstep(1.30, 1.70, length(hs)));
    if (facing > 0.0 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      let base = uv * faceAtlas.xy + faceAtlas.zw;
      // Not linearised, deliberately: the sheet is sRGB-encoded and so are the
      // hand-tuned flesh colours it blends against, which were authored to
      // compensate for the missing output encode. Revisit both together at the
      // preset retune, not before.
      let tex = texel(faceTex, base);
      let W = vec3<f32>(0.2126, 0.7152, 0.0722);
      faceGlow = smoothstep(faceCfg2.z, 1.0, dot(tex.rgb, W)) * facing * tex.a;

      // Used as a MULTIPLIER, not a replacement: the sheet carries baked
      // lighting, so pasting it in as albedo and lighting it again double-shades.
      // Dividing by its measured mean keeps the pattern and throws away level.
      let detail = tex.rgb / max(faceCfg2.y, 1e-3);
      // Skip the multiply where it glows: an eye is not tinted flesh, and the
      // emissive term below supplies its colour outright.
      albedo = mix(albedo, albedo * detail,
                   facing * tex.a * faceCfg.y * (1.0 - faceGlow));

      // Relief. Central differences on luminance give the height gradient; the
      // projection is planar along z, so its tangent basis is just x and y and
      // the bump drops straight into world space with no TBN to build.
      if (faceCfg.w > 0.0) {
        let e = faceAtlas.xy * 0.012;
        let hL = dot(texel(faceTex, base - vec2<f32>(e.x, 0.0)).rgb, W);
        let hR = dot(texel(faceTex, base + vec2<f32>(e.x, 0.0)).rgb, W);
        let hD = dot(texel(faceTex, base - vec2<f32>(0.0, e.y)).rgb, W);
        let hU = dot(texel(faceTex, base + vec2<f32>(0.0, e.y)).rgb, W);
        // Negated: the gradient points UPHILL, and a normal tilts away from
        // rising ground. Without this the sockets would bulge instead of sink.
        let bump = vec3<f32>(-(hR - hL) * forward, -(hU - hD), 0.0);
        // Suppressed where it glows: bright means RAISED to a height map, so
        // without this the eyes bulge out of their sockets.
        n = normalize(n + bump * faceCfg.w * facing * tex.a * (1.0 - faceGlow));
      }
    }
  }

  albedo = mix(albedo, charColor, cm);

  let L = normalize(lightDir);
  let V = -rd;
  let H = normalize(L + V);
  let diff = max(dot(n, L), 0.0);

  // Wounds are wetter than the surrounding skin; char is dead matte. Gore
  // rides the same boost: bloody chunk regions glisten like open wounds.
  let wet = surfCfg2.x * mix(1.0, 1.6, max(wm, gore)) * (1.0 - cm);
  let shine = pow(max(dot(n, H), 0.0), mix(128.0, 4.0, surfCfg.y));
  // Fresnel fades out INSIDE wounds rather than riding the wet boost: it is
  // environment rim-light, and inside a cavity the "environment" is the wound
  // itself. At full strength it maxes out on the grazing-heavy rim geometry,
  // the 1.6x wound wetness lands on top, and whole patches clip to white and
  // sweep across the cavity as the camera moves (X1.17). The wet glisten a
  // wound SHOULD have is the tight specular term, which keeps the boost.
  let fres = pow(1.0 - max(dot(n, V), 0.0), 4.0) * surfCfg.z * (1.0 - wm);

  // Fake backlit scatter: sample the field a little way toward the light.
  // A whole extra mapBody, so it is skipped outright at zero translucency
  // rather than multiplied away afterwards.
  var scatter = vec3<f32>(0.0, 0.0, 0.0);
  if (surfCfg.w > 0.0) {
    let thin = clamp(mapBody(p + L * 0.06, data, counts, marchCfg.z, woundCfg, woundCfg2, noiseShift) * -8.0, 0.0, 1.0);
    scatter = deepColor * thin * surfCfg.w * (1.0 - cm);
  }

  // Cheap AO from the field, so creases and the insides of joints stay dark.
  // Without it a limb dissolves into the torso visually even when the geometry
  // is correctly separated — so this is a LOD lever, not a free win: it is the
  // one guarded by an explicit flag rather than by its own amplitude, because
  // there is no "AO strength" to turn down.
  var ao = 1.0;
  if (lodCfg.x > 0.5) {
    ao = clamp(mapBody(p + n * 0.06, data, counts, marchCfg.z, woundCfg, woundCfg2, noiseShift) / 0.06, 0.35, 1.0);
  }

  let fleshLit = albedo * (lightCfg.y + diff * lightCfg.x) * keyColor * ao
               + keyColor * (shine * surfCfg.x + fres) * wet
               + scatter;

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
           * flicker(faceCfg3.y, faceCfg3.x) * (1.0 - cm);
  var lit = fleshLit * (1.0 - faceGlow) + glow;

  // Legacy display look (lodCfg.y). Every flesh preset was hand-tuned in the
  // WebGL lab, which displayed the lit LINEAR value raw — no output sRGB
  // encode. This path encodes correctly, which lifts the low channels and
  // washes those presets out. Applying the sRGB EOTF (decode) here cancels
  // three's output encode exactly, so the marched flesh displays the same
  // linear values the presets were tuned against. Kill switch for the X1.3
  // retune: turn this off, retune presets through the honest chain, delete.
  if (lodCfg.y > 0.5) {
    let c = max(lit, vec3<f32>(0.0));
    let lo = c / 12.92;
    let hi = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    lit = select(hi, lo, c <= vec3<f32>(0.04045));
  }

  return vec4<f32>(lit, t);
}`;

/**
 * Helper sources in DEPENDENCY ORDER — each one may only call those before it,
 * because WGSL requires declaration before use and three emits includes in the
 * order given.
 */
export const HELPERS = [
  SMIN, SMAX, SD_PRIM, HASH13, NOISE3, FBM,
  APPLY_CARVES, APPLY_WOUNDS, WOUND_MASK, CHAR_MASK,
  MAP_BODY, CALC_NORMAL, TEXEL, FLICKER,
];

