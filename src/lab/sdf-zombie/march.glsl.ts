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

// three's FRAGMENT prefix declares viewMatrix and cameraPosition but NOT
// projectionMatrix (that one is vertex-only). The gl_FragDepth write below
// needs it, so declare it here — three still binds it by name from the
// program's active uniform list. Without this the program fails to link with
// "'projectionMatrix' : undeclared identifier" and nothing renders, while
// tsc/vite/vitest all stay green because none of them compile GLSL.
uniform mat4 projectionMatrix;

// iq quadratic polynomial smooth-min: rigid + conservative (never overestimates).
// NOT associative — the fold order below is fixed by cluster and must stay that way.
float smin(float a, float b, float k) {
  k *= 4.0;
  if (k <= 0.0) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
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
      d = smin(d, sdPrim(p, idx), uPrimB[idx].w);
    }
  }
  return d;
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

  // INTERIM SHADING — superseded by Task 16's FleshMaterial presets. A flat
  // diffuse term gives the eye nothing to read form against, so the body looks
  // like a featureless mass even when the geometry is correct. Hard key +
  // specular + fresnel rim is the minimum that makes a silhouette legible.
  vec3 L = normalize(uLightDir);
  vec3 V = -rd;
  vec3 H = normalize(L + V);

  float diff = max(dot(n, L), 0.0);
  // Wrapped diffuse — light bends round the form instead of terminating hard.
  float wrap = max((dot(n, L) + 0.35) / 1.35, 0.0);
  // Bounce from the floor, so undersides aren't dead black.
  float bounce = max(-n.y, 0.0) * 0.18;
  float spec = pow(max(dot(n, H), 0.0), 42.0) * 0.55;
  // Fresnel rim: the single cheapest cue for reading a curved silhouette.
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.55;
  // Cheap AO from the field: sample a little along the normal — creases and
  // the insides of joints stay darker, which is what separates limb from torso.
  float ao = clamp(mapBody(p + n * 0.06) / 0.06, 0.35, 1.0);

  vec3 lit = uBaseColor * (0.10 + 0.55 * wrap + 0.75 * diff + bounce) * ao
           + vec3(1.0, 0.93, 0.90) * spec
           + vec3(0.85, 0.35, 0.38) * rim;
  outColor = vec4(lit, 1.0);

  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
}
`;
