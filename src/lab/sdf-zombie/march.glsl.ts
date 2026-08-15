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

/** Spike fragment shader: one hardcoded sphere, correct depth write. */
export const FRAG_SPIKE = /* glsl */ `
precision highp float;

in vec3 vWorldPos;
out vec4 outColor;

uniform vec3 uSphereCenter;
uniform float uSphereRadius;

float map(vec3 p) {
  return length(p - uSphereCenter) - uSphereRadius;
}

vec3 calcNormal(vec3 p) {
  // Tetrahedron sampling — 4 evaluations instead of 6.
  const vec2 e = vec2(1.0, -1.0) * 0.0015;
  return normalize(
    e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) +
    e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);

  // March from the camera; the back face of the proxy box bounds the search.
  float tMax = length(vWorldPos - cameraPosition);
  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < 96; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.001) { hit = true; break; }
    t += d;
    if (t > tMax) break;
  }
  if (!hit) discard;

  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);
  vec3 lightDir = normalize(vec3(0.5, 1.0, 0.4));
  float diff = max(dot(n, lightDir), 0.0);
  outColor = vec4(vec3(0.85, 0.3, 0.35) * (0.25 + 0.75 * diff), 1.0);

  // Depth write — this is what lets the blob interleave with the floor/cube.
  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
}
`;
