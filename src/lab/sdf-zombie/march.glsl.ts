// src/lab/sdf-zombie/march.glsl.ts
// Shader source as strings. Kept engine-free so it can be diffed and tested
// as text; Three only consumes it in zombie.ts.

import { MAX_CLUSTERS, MAX_PRIMS } from './validate';

export const VERT = /* glsl */ `
out vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// Re-exported for existing importers. `validate.ts` is the single source of
// truth: a second declaration here is exactly how the CPU field (which backs
// click-to-shoot) and the GPU field drift apart. No import cycle — validate.ts
// does not import this module.
export { MAX_CLUSTERS, MAX_PRIMS };

export const FRAG = /* glsl */ `
precision highp float;

#define MAX_PRIMS ${MAX_PRIMS}
#define MAX_CLUSTERS ${MAX_CLUSTERS}
#define MAX_WOUNDS 16
uniform vec4 uWound[MAX_WOUNDS];   // xyz = world position, w = radius
uniform vec4 uWoundMeta[MAX_WOUNDS]; // x = type (0 pellet, 1 blast, 2 burn), y = age
uniform int  uWoundCount;
uniform float uWoundBlendK;        // separate from the union k — makes the wet lip
uniform float uRimSplay;           // height of the everted lip, as a fraction of depth
uniform float uRimOffset;          // where the lip sits, as a multiple of crater radius
uniform float uRimWidth;           // how broad the lip is
uniform vec3 uDeepColor;
uniform vec3 uCharColor;

// --- Face texture, projected flat onto the front of the head ---------------
// Features (eyes, mouth, brow shading) are texture rather than geometry: at
// this scale smin's blend zone is wider than the features themselves, so a
// carved socket smears into a band. A texture also costs ONE sample at the hit
// point instead of prims x steps x pixels.
//
// Projection is planar in head space, faded by how squarely the surface faces
// front, so it wraps the face without smearing round the sides of the skull.
uniform sampler2D uFaceTex;
uniform float uFaceEnabled;   // 0 on limbs that are not the head
uniform float uFaceStrength;
uniform float uFaceForward;   // +1 or -1: which way the zombie looks
uniform vec4  uFaceProj;      // xy = scale of head-space xy -> uv, zw = uv centre
uniform vec4  uFaceAtlas;     // xy = uv scale, zw = uv offset — crops the head out of the sheet
// The SKULL's own centre, and its three SEMI-AXES.
//
// Not the head cluster's bounds: that also encloses the neck capsule, so
// normalising by it spilled the projection over the neck and shoulders.
//
// And not a single radius either. The head is an ELLIPSOID, so with one scalar
// radius the surface sits at |hs| = maxScale/thisAxis — meaning whichever axis
// happened to be largest landed at |hs| = 1 and got eaten by the head mask.
// Raising headDepth past headHeight made the entire face vanish. Dividing per
// axis puts the whole surface at |hs| ~= 1 regardless of proportions.
uniform vec3  uHeadCentre;
uniform vec3  uHeadAxes;
/**
 * Mean luminance of the face crop. The sheet already carries BAKED LIGHTING,
 * so pasting it in as albedo and then lighting it again double-shades — the
 * Blood face averages 84/255, which turned the whole head near-black. Dividing
 * by the mean keeps the PATTERN (dark eye sockets, pale highlights) while
 * throwing away its overall level, so it modulates our flesh instead of
 * replacing it.
 */
uniform float uFaceMean;

in vec3 vWorldPos;
out vec4 outColor;

uniform vec4 uPrimA[MAX_PRIMS];          // xyz = A, w = radius
uniform vec4 uPrimB[MAX_PRIMS];          // xyz = B, w = blendK
uniform vec4 uPrimScale[MAX_PRIMS];      // xyz = scale, w = 1 when this is a carve
uniform vec4 uClusterBounds[MAX_CLUSTERS]; // xyz = centre, w = radius
uniform vec4 uClusterRange[MAX_CLUSTERS];  // x = start, y = count, z = alive
uniform int  uPrimCount;
uniform int  uCarveCount;   // 0 lets the whole carve pass be skipped
uniform int  uClusterCount;
uniform float uMaxBlendK;
uniform int uSteps;
uniform float uStepMul;
uniform vec3 uBaseColor;
uniform vec3 uLightDir;
uniform float uSpecIntensity, uSpecRoughness, uFresnelBoost, uTranslucency;
uniform float uSurfaceNoiseAmp, uSilhouetteNoiseAmp, uWetness;
uniform float uKeyIntensity, uFillIntensity;
uniform vec3  uKeyColor;
// three's ShaderMaterial FRAGMENT prefix declares viewMatrix/cameraPosition but
// NOT projectionMatrix (vertex-only) — the gl_FragDepth write below needs it.
// Declared here; three still binds it by name from the program's active uniforms.
uniform mat4 projectionMatrix;

// iq quadratic polynomial smooth-min: rigid + conservative (never overestimates).
// NOT associative — the fold order below is fixed by cluster and must stay that way.
float smin(float a, float b, float k) {
  k *= 4.0;
  if (k <= 0.0) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Smooth subtraction: smax(a, b, k) = -smin(-a, -b, k).
float smax(float a, float b, float k) { return -smin(-a, -b, k); }

/** Carves every wound out of the field. Burns barely subtract; they char. */
float applyWounds(float d, vec3 p) {
  for (int i = 0; i < MAX_WOUNDS; i++) {
    if (i >= uWoundCount) break;
    vec4 w = uWound[i];
    float type = uWoundMeta[i].x;
    // A burn only opens up as it cooks; a pellet/blast subtracts immediately.
    float depth = type > 1.5 ? w.w * 0.35 * clamp(uWoundMeta[i].y, 0.0, 1.0) : w.w;
    float r = length(p - w.xyz);

    d = smax(d, -(r - depth), uWoundBlendK);

    // Everted rim. A plain smooth subtraction leaves a clean dish; real flesh
    // (and the T-1000 taking a shotgun round) PEELS — the displaced material
    // splays outward into a raised lip around the mouth.
    //
    // Modelled as a Gaussian ring just outside the crater. Subtracting from d
    // means "more material here", so this adds a bulge rather than a dent.
    // Burns evert far less: they char and contract instead of tearing open.
    float x = (r - depth * uRimOffset) / max(depth * uRimWidth, 1e-4);
    d -= exp(-x * x) * depth * uRimSplay * (type > 1.5 ? 0.25 : 1.0);
  }
  return d;
}

/** 0 at the surface far from wounds, 1 deep inside one. Drives the wet interior. */
float woundMask(vec3 p) {
  float m = 0.0;
  for (int i = 0; i < MAX_WOUNDS; i++) {
    if (i >= uWoundCount) break;
    vec4 w = uWound[i];
    m = max(m, 1.0 - smoothstep(0.0, w.w * 1.6, length(p - w.xyz)));
  }
  return m;
}

/** 0 unburned, 1 fully charred. */
float charMask(vec3 p) {
  float m = 0.0;
  for (int i = 0; i < MAX_WOUNDS; i++) {
    if (i >= uWoundCount) break;
    if (uWoundMeta[i].x < 1.5) continue;
    vec4 w = uWound[i];
    m = max(m, (1.0 - smoothstep(0.0, w.w * 2.2, length(p - w.xyz))) * clamp(uWoundMeta[i].y, 0.0, 1.0));
  }
  return m;
}

float sdPrim(vec3 p, int i) {
  vec4 A = uPrimA[i], B = uPrimB[i], S = uPrimScale[i];
  vec3 inv = 1.0 / S.xyz;
  vec3 q = p * inv, a = A.xyz * inv, b = B.xyz * inv;
  vec3 ab = b - a, ap = q - a;
  float ab2 = dot(ab, ab);
  float t = ab2 == 0.0 ? 0.0 : clamp(dot(ap, ab) / ab2, 0.0, 1.0);
  float minScale = min(S.x, min(S.y, S.z));
  return (length(q - (a + ab * t)) - A.w) * minScale;
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
        mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
        mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  return n * 2.0 - 1.0;
}

float fbm(vec3 p) { return noise3(p * 4.0) * 0.6 + noise3(p * 9.0) * 0.3; }

/**
 * Carves every subtractive primitive out of the assembled field.
 *
 * Runs AFTER the complete additive fold, in fixed cluster order — the same
 * structure applyWounds uses. Carving per-cluster instead would restructure a
 * non-associative smooth-min fold, changing the surface everywhere and forcing
 * a retune of every authored blendK.
 *
 * Consequence worth knowing before authoring: a carve is NOT scoped to its
 * cluster. That is geometrically safe today because the face carves sit inside
 * the skull and nothing else is within their radius. A future carve placed near
 * a cluster boundary would silently bite its neighbour.
 */
float applyCarves(float d, vec3 p) {
  if (uCarveCount == 0) return d;   // free on bodies with no carves
  for (int c = 0; c < MAX_CLUSTERS; c++) {
    if (c >= uClusterCount) break;
    vec4 range = uClusterRange[c];
    if (range.z < 0.5) continue;              // severed — its carves leave with it
    int start = int(range.x), count = int(range.y);
    for (int i = 0; i < MAX_PRIMS; i++) {
      if (i >= count) break;
      int idx = start + i;
      if (idx >= uPrimCount) break;
      if (uPrimScale[idx].w < 0.5) continue;  // additive — already folded
      // blendK 0 makes smax short-circuit to a hard max: a crisp-edged carve
      // with no smear, which is the only way features smaller than the blend
      // zone survive. Hard min/max are also ASSOCIATIVE, so zero-blend carves
      // are exempt from the fold-order constraint that shapes everything else.
      d = smax(d, -sdPrim(p, idx), uPrimB[idx].w);
    }
  }
  return d;
}

float mapBody(vec3 p) {
  float d = 1e9;
  for (int c = 0; c < MAX_CLUSTERS; c++) {
    if (c >= uClusterCount) break;
    vec4 range = uClusterRange[c];
    if (range.z < 0.5) continue;               // severed
    vec4 bounds = uClusterBounds[c];
    // Cull, with a blend margin: a cluster still pulls the surface from its
    // blend width away, so culling on "> d" alone clips the blend fillet.
    // NOTE the 4.0: smin() scales k by 4 internally, so the ACTUAL influence
    // radius is 4x the authored blendK. Using the unscaled value here culls
    // clusters that are still bending the surface, which shows up as hard
    // creases exactly along cluster boundaries.
    if (length(p - bounds.xyz) - bounds.w > d + uMaxBlendK * 4.0) continue;
    int start = int(range.x), count = int(range.y);
    for (int i = 0; i < MAX_PRIMS; i++) {
      if (i >= count) break;
      int idx = start + i;
      if (idx >= uPrimCount) break;
      if (uPrimScale[idx].w > 0.5) continue;   // carve — handled by applyCarves
      d = smin(d, sdPrim(p, idx), uPrimB[idx].w);
    }
  }
  // Carves first: they are part of the body's own definition. Wounds are
  // damage stamped on top of the finished body.
  return applyWounds(applyCarves(d, p), p) + fbm(p * 3.0) * uSilhouetteNoiseAmp;
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.0015;
  return normalize(
    e.xyy * mapBody(p + e.xyy) + e.yyx * mapBody(p + e.yyx) +
    e.yxy * mapBody(p + e.yxy) + e.xxx * mapBody(p + e.xxx));
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);
  float tMax = length(vWorldPos - cameraPosition);

  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < 256; i++) {
    if (i >= uSteps) break;
    float d = mapBody(ro + rd * t);
    if (d < 0.0012) { hit = true; break; }
    t += d * uStepMul;
    if (t > tMax) break;
  }
  if (!hit) discard;

  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);

  // Micro-detail perturbs the normal only — costs no march safety.
  n = normalize(n + vec3(fbm(p * 22.0), fbm(p * 22.0 + 5.0), fbm(p * 22.0 + 11.0)) * uSurfaceNoiseAmp);

  float wm = woundMask(p);
  float cm = charMask(p);
  vec3 albedo = mix(uBaseColor, uDeepColor, wm);

  // Face texture, before wounds and char so damage still paints over it.
  if (uFaceEnabled > 0.5) {
    // Head-space position, normalised by the skull's own sphere — which is
    // re-uploaded every frame from the posed primitives, so the projection
    // rides the head as it jiggles without a full rest-space transform.
    vec3 hs = (p - uHeadCentre) / max(uHeadAxes, vec3(1e-4));
    vec2 uv = vec2(hs.x * uFaceForward, hs.y) * uFaceProj.xy + uFaceProj.zw;
    // Fade by how squarely this surface faces the front, so the projection
    // does not smear a second face down the sides and back of the skull.
    // Widened from (0.15, 0.65): with hard-edged sockets the normals swing
    // sharply, and a narrow window left the eye region — the part that most
    // needs the texture — almost entirely unpainted.
    float facing = smoothstep(-0.10, 0.35, dot(n, vec3(0.0, 0.0, uFaceForward)));
    // Confine it to the HEAD. Generous, because the surface now sits at
    // |hs| ~= 1 everywhere and the jaw hangs past that: this is only a backstop
    // against wrapping onto the neck, and the uv bounds below do most of the
    // vertical confining already.
    facing *= 1.0 - smoothstep(1.30, 1.70, length(hs));
    if (facing > 0.0 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      vec4 t = texture(uFaceTex, uv * uFaceAtlas.xy + uFaceAtlas.zw);
      // Not linearised, deliberately: the sheet is sRGB-encoded and so are the
      // hand-tuned flesh colours it blends against, which were authored to
      // compensate for the missing output encode (see lab-main's post-fx note).
      // Revisit both together at the preset retune, not before.
      //
      // Used as a MULTIPLIER, not a replacement — see uFaceMean.
      vec3 detail = t.rgb / max(uFaceMean, 1e-3);
      albedo = mix(albedo, albedo * detail, facing * t.a * uFaceStrength);
    }
  }

  albedo = mix(albedo, uCharColor, cm);

  vec3 L = normalize(uLightDir);
  vec3 V = -rd;
  vec3 H = normalize(L + V);
  float diff = max(dot(n, L), 0.0);

  // Wounds are wetter than the surrounding skin; char is dead matte.
  float wet = uWetness * mix(1.0, 1.6, wm) * (1.0 - cm);
  float shine = pow(max(dot(n, H), 0.0), mix(128.0, 4.0, uSpecRoughness));
  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0) * uFresnelBoost;

  // Fake backlit scatter: sample the field a little way toward the light.
  float thin = clamp(mapBody(p + L * 0.06) * -8.0, 0.0, 1.0);
  vec3 scatter = uDeepColor * thin * uTranslucency * (1.0 - cm);

  // Cheap AO from the field: sample along the normal so creases and the
  // insides of joints stay darker. Kept from the interim shading pass —
  // without it a limb dissolves into the torso visually even when the
  // geometry is correctly separated.
  float ao = clamp(mapBody(p + n * 0.06) / 0.06, 0.35, 1.0);

  vec3 lit = albedo * (uFillIntensity + diff * uKeyIntensity) * uKeyColor * ao
           + uKeyColor * (shine * uSpecIntensity + fres) * wet
           + scatter;
  outColor = vec4(lit, 1.0);

  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
}
`;
