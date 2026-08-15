// src/lab/sdf-zombie/march.glsl.ts
// Shader source as strings. Kept engine-free so it can be diffed and tested
// as text; Three only consumes it in zombie.ts.

export const VERT = /* glsl */ `
out vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const MAX_PRIMS = 32;
export const MAX_CLUSTERS = 6;

export const FRAG = /* glsl */ `
precision highp float;

#define MAX_PRIMS ${MAX_PRIMS}
#define MAX_CLUSTERS ${MAX_CLUSTERS}
#define MAX_WOUNDS 16
uniform vec4 uWound[MAX_WOUNDS];   // xyz = world position, w = radius
uniform vec4 uWoundMeta[MAX_WOUNDS]; // x = type (0 pellet, 1 blast, 2 burn), y = age
uniform int  uWoundCount;
uniform float uWoundBlendK;        // separate from the union k — makes the wet lip
uniform vec3 uDeepColor;
uniform vec3 uCharColor;

in vec3 vWorldPos;
out vec4 outColor;

uniform vec4 uPrimA[MAX_PRIMS];          // xyz = A, w = radius
uniform vec4 uPrimB[MAX_PRIMS];          // xyz = B, w = blendK
uniform vec4 uPrimScale[MAX_PRIMS];      // xyz = scale, w = cluster id
uniform vec4 uClusterBounds[MAX_CLUSTERS]; // xyz = centre, w = radius
uniform vec4 uClusterRange[MAX_CLUSTERS];  // x = start, y = count, z = alive
uniform int  uPrimCount;
uniform int  uClusterCount;
uniform float uMaxBlendK;
uniform int uSteps;
uniform float uStepMul;
uniform vec3 uBaseColor;
uniform vec3 uLightDir;

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
    d = smax(d, -(length(p - w.xyz) - depth), uWoundBlendK);
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

float mapBody(vec3 p) {
  float d = 1e9;
  for (int c = 0; c < MAX_CLUSTERS; c++) {
    if (c >= uClusterCount) break;
    vec4 range = uClusterRange[c];
    if (range.z < 0.5) continue;               // severed
    vec4 bounds = uClusterBounds[c];
    // Cull, with a blend margin: a cluster still pulls the surface from
    // uMaxBlendK away, so culling on "> d" alone would clip the blend fillet.
    if (length(p - bounds.xyz) - bounds.w > d + uMaxBlendK) continue;
    int start = int(range.x), count = int(range.y);
    for (int i = 0; i < MAX_PRIMS; i++) {
      if (i >= count) break;
      int idx = start + i;
      if (idx >= uPrimCount) break;
      d = smin(d, sdPrim(p, idx), uPrimB[idx].w);
    }
  }
  return applyWounds(d, p);
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
  float diff = max(dot(n, normalize(uLightDir)), 0.0);
  float wm = woundMask(p);
  float cm = charMask(p);
  vec3 albedo = mix(uBaseColor, uDeepColor, wm);
  albedo = mix(albedo, uCharColor, cm);
  outColor = vec4(albedo * (0.22 + 0.78 * diff), 1.0);

  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
}
`;
