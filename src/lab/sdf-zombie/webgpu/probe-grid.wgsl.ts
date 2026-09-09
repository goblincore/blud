/**
 * `probeIrradiance` — directional ambient from the static irradiance probe grid.
 *
 * THE TWIN. This is the GPU copy of `../probe-grid.ts`. Nothing here compiles
 * WGSL in tests, so the gather and the SH maths are property-tested over there
 * and this string is pinned by `probe-grid.wgsl.test.ts` (source text and the
 * real wgslFn parser). Change one, change both.
 *
 * THE SEAM. The probe grid is baked ONCE on the CPU at room setup against the
 * enclosure's six walls only — no bodies, no dynamic lights, no field
 * evaluations. The march pays one manual-trilinear texture read. The texture
 * is RGBA32F, three texels per probe (L1 SH: 4 coefficients x RGB), and its
 * packing is the other half of `packProbeTexture` in `../probe-grid.ts`.
 *
 * THE UNIFORMS. `probeMin` is the grid's inset-box minimum; `probeInvExtent`
 * is `1 / (max - min)`; `probeDims` is `(nx, ny, nz, 0)`. Probe `(i,j,k)`
 * sits at `min + (i,j,k)/(dims-1) * extent` and its 12 coefficients begin at
 * texel `(i + nx*(j + ny*k)) * 3`.
 *
 * ORDER. `probeIrradiance` is declared first, as the wgslFn parse contract
 * requires; WGSL functions may be defined after their use, so the two helpers
 * below can stay in dependency-free source order.
 */

/**
 * Manual trilinear over the 8 probes surrounding `p`, blending the SH
 * COEFFICIENTS and only then evaluating irradiance. Blending results would
 * bake the non-negative clamp into the interior of a cell and break the
 * linearity the CPU mirror is property-tested against.
 */
const PROBE_IRRADIANCE = /* wgsl */ `fn probeIrradiance(
  p: vec3<f32>,
  n: vec3<f32>,
  probeTex: texture_2d<f32>,
  probeMin: vec3<f32>,
  probeInvExtent: vec3<f32>,
  probeDims: vec4<f32>
) -> vec3<f32> {
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

  let s000 = probeLoadSh(probeTex, idx000);
  let s100 = probeLoadSh(probeTex, idx100);
  let s010 = probeLoadSh(probeTex, idx010);
  let s110 = probeLoadSh(probeTex, idx110);
  let s001 = probeLoadSh(probeTex, idx001);
  let s101 = probeLoadSh(probeTex, idx101);
  let s011 = probeLoadSh(probeTex, idx011);
  let s111 = probeLoadSh(probeTex, idx111);

  var c0 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var c1 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var c2 = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  c0 = c0 + s000[0] * w000; c1 = c1 + s000[1] * w000; c2 = c2 + s000[2] * w000;
  c0 = c0 + s100[0] * w100; c1 = c1 + s100[1] * w100; c2 = c2 + s100[2] * w100;
  c0 = c0 + s010[0] * w010; c1 = c1 + s010[1] * w010; c2 = c2 + s010[2] * w010;
  c0 = c0 + s110[0] * w110; c1 = c1 + s110[1] * w110; c2 = c2 + s110[2] * w110;
  c0 = c0 + s001[0] * w001; c1 = c1 + s001[1] * w001; c2 = c2 + s001[2] * w001;
  c0 = c0 + s101[0] * w101; c1 = c1 + s101[1] * w101; c2 = c2 + s101[2] * w101;
  c0 = c0 + s011[0] * w011; c1 = c1 + s011[1] * w011; c2 = c2 + s011[2] * w011;
  c0 = c0 + s111[0] * w111; c1 = c1 + s111[1] * w111; c2 = c2 + s111[2] * w111;

  return probeIrradianceL1(array<vec4<f32>, 3>(c0, c1, c2), n);
}`;

/**
 * Three RGBA texels per probe. Layout matches `packProbeTexture`:
 *   texel 0 = (L00.r, L00.g, L00.b, L1-1.r)
 *   texel 1 = (L1-1.g, L1-1.b, L10.r, L10.g)
 *   texel 2 = (L10.b, L11.r, L11.g, L11.b)
 */
const PROBE_LOAD_SH = /* wgsl */ `fn probeLoadSh(probeTex: texture_2d<f32>, index: i32) -> array<vec4<f32>, 3> {
  return array<vec4<f32>, 3>(
    textureLoad(probeTex, vec2<i32>(index * 3 + 0, 0), 0),
    textureLoad(probeTex, vec2<i32>(index * 3 + 1, 0), 0),
    textureLoad(probeTex, vec2<i32>(index * 3 + 2, 0), 0)
  );
}`;

/**
 * The cosine-lobe convolution of the blended L1 coefficients. Mirrors
 * `irradianceL1` in `../probe-grid.ts`: `A0 = pi`, `A1 = 2pi/3`, and the four
 * real-SH basis values are written as literals so the pin test can match them
 * against the exported TS constants. Negative lobes are clamped to 0.
 */
const PROBE_IRRADIANCE_L1 = /* wgsl */ `fn probeIrradianceL1(
  coeffs: array<vec4<f32>, 3>,
  n: vec3<f32>
) -> vec3<f32> {
  let l00 = vec3<f32>(coeffs[0].x, coeffs[0].y, coeffs[0].z);
  let l1m1 = vec3<f32>(coeffs[0].w, coeffs[1].x, coeffs[1].y);
  let l10 = vec3<f32>(coeffs[1].z, coeffs[1].w, coeffs[2].x);
  let l11 = vec3<f32>(coeffs[2].y, coeffs[2].z, coeffs[2].w);
  let e = 3.141592653589793 * 0.282095 * l00
    + 2.0943951023931953 * (0.488603 * n.y * l1m1 + 0.488603 * n.z * l10 + 0.488603 * n.x * l11);
  return max(e, vec3<f32>(0.0, 0.0, 0.0));
}`;

/**
 * The full shader snippet: `probeIrradiance` first (the parse contract), then
 * the two helpers. Feed this to three.js `wgslFn` in the march chain.
 */
export const PROBE_GRID_WGSL = `${PROBE_IRRADIANCE}\n\n${PROBE_LOAD_SH}\n\n${PROBE_IRRADIANCE_L1}`;
