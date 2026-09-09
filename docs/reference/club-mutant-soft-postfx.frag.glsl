// VERBATIM COPY — do not edit.
// Source: /Users/donny/Projects/2026/club-mutant/client/src/pipelines/SoftPostFxPipeline.ts
// Phaser 3 post-FX pipeline, GLSL ES 1.0. Staged here as the porting source
// for the WGSL rewrite (docs/superpowers/specs/2026-09-09-vhs-post-fx-design.md)
// so a sandboxed worker can read it without reaching outside the repo.

#ifdef GL_ES
precision mediump float;
#endif

varying vec2 outTexCoord;

uniform sampler2D uMainSampler;
uniform vec2 uResolution;
uniform float iTime;
uniform float uIntensity;
uniform float uBlurAmount;
uniform float uNoiseAmount;
uniform float uGradeAmount;
uniform float uWarpAmount;
uniform float uWarpFrequency;
uniform float uWarpSpeed;
uniform sampler2D uPrevSampler;
uniform float uHasPrev;
uniform float uChromaAmount;
uniform float uChromaJitter;
uniform float uMotionThreshold;
uniform float uChromaBurstChance;
uniform float uChromaBurstStrength;
uniform float uChromaBurstRate;

float hash21(vec2 p)
{
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

vec3 applyColorGrade(vec3 color, float amount)
{
  vec3 graded = color;

  graded *= vec3(0.95, 1.05, 0.95);
  graded += vec3(0.0, 0.012, 0.0);

  float luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
  graded = mix(vec3(luma), graded, 0.9);

  return mix(color, graded, amount);
}

vec3 applyNoise(vec3 color, vec2 uv, float amount)
{
  float row = floor(uv.y * uResolution.y);
  float n = hash21(vec2(row, floor(iTime * 60.0)));
  float centered = (n - 0.5) * 2.0;

  return color + centered * amount;
}

vec3 blur9(sampler2D s, vec2 uv, vec2 texel, float amount)
{
  vec3 c = texture2D(s, uv).rgb * 4.0;

  c += texture2D(s, uv + vec2(texel.x, 0.0)).rgb;
  c += texture2D(s, uv - vec2(texel.x, 0.0)).rgb;
  c += texture2D(s, uv + vec2(0.0, texel.y)).rgb;
  c += texture2D(s, uv - vec2(0.0, texel.y)).rgb;

  c += texture2D(s, uv + vec2(texel.x, texel.y)).rgb;
  c += texture2D(s, uv + vec2(-texel.x, texel.y)).rgb;
  c += texture2D(s, uv + vec2(texel.x, -texel.y)).rgb;
  c += texture2D(s, uv + vec2(-texel.x, -texel.y)).rgb;

  c /= 12.0;

  vec3 base = texture2D(s, uv).rgb;

  return mix(base, c, amount);
}

void main()
{
  vec2 uv = outTexCoord;
  vec2 texel = 1.0 / uResolution.xy;

  float phase = (uv.y * uWarpFrequency + iTime * uWarpSpeed) * 6.28318530718;
  float warp = sin(phase) * (uWarpAmount / uResolution.x);
  vec2 warpedUv = uv + vec2(warp, 0.0);

  vec4 baseTexCenter = texture2D(uMainSampler, warpedUv);

  float hasPrev = step(0.5, uHasPrev);
  vec3 prevTex = texture2D(uPrevSampler, warpedUv).rgb;
  float motion = hasPrev * length(baseTexCenter.rgb - prevTex);
  float motionMask = smoothstep(uMotionThreshold, uMotionThreshold * 2.0, motion);

  float row = floor(uv.y * uResolution.y);
  float burstPhase = floor(iTime * uChromaBurstRate);
  float burst = step(1.0 - uChromaBurstChance, hash21(vec2(row + 13.0, burstPhase)));
  float burstMask = burst * uChromaBurstStrength;

  float effectMask = max(motionMask, burstMask);

  float jx = hash21(vec2(floor(iTime * 24.0), uv.y * 512.0));
  float jy = hash21(vec2(uv.y * 512.0 + 19.0, floor(iTime * 24.0)));

  vec2 jitter = vec2((jx - 0.5) * 2.0, (jy - 0.5) * 2.0);

  vec2 chromaPx = (uChromaAmount + jitter * uChromaJitter) * effectMask;
  vec2 chromaUv = vec2(chromaPx.x / uResolution.x, chromaPx.y / uResolution.y);

  vec3 chromaR = texture2D(uMainSampler, warpedUv + chromaUv).rgb;
  vec3 chromaG = baseTexCenter.rgb;
  vec3 chromaB = texture2D(uMainSampler, warpedUv - chromaUv).rgb;

  vec3 base = vec3(chromaR.r, chromaG.g, chromaB.b);

  vec3 color = blur9(uMainSampler, warpedUv, texel, uBlurAmount);

  color = applyColorGrade(color, uGradeAmount);

  color = applyNoise(color, uv, uNoiseAmount);

  color = clamp(color, 0.0, 1.0);

  color = mix(base, color, uIntensity);

  gl_FragColor = vec4(color, baseTexCenter.a);
}
