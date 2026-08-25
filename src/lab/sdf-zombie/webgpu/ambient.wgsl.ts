/**
 * `ambientAt` — analytic chromatic ambient from a six-walled enclosure.
 *
 * THE TWIN. This is the GPU copy of `../ambient.ts`. Nothing here compiles
 * WGSL in tests, so the maths is property-tested over there and this string
 * is pinned by `ambient.wgsl.test.ts`. Change one, change both.
 *
 * THE SEAM. The spec names this signature as the single seam every future
 * lighting implementation routes through — analytic bounce now (P1), an
 * irradiance-volume lookup later (P3), cone-tracing the field in the
 * "everything SDF" endgame. Keeping the signature stable is what makes those
 * a data-source swap rather than a shader rewrite, which is the entire reason
 * it was specified before anything was built. Do not widen it casually.
 *
 * ZERO FIELD EVALUATIONS, and this is enforced by test, not by discipline.
 * The six walls are unrolled rather than looped precisely so that no one is
 * tempted to put a march inside the loop later.
 */

/**
 * Half-contribution distance in metres. Shared with `../ambient.ts`; the
 * pin test asserts this literal appears in the WGSL so the two cannot drift.
 */
export const AMBIENT_REF_DIST = 1.6;

export const AMBIENT_AT = /* wgsl */ `fn ambientAt(
  p: vec3<f32>,
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
  keyColor: vec3<f32>
) -> vec3<f32> {
  // bounceCfg: x probeWeight, y ambientGain, z ceilingEnabled, w spare.
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

  let w = clamp(bounceCfg.x, 0.0, 1.0);
  // The level that survives is the LUMINANCE of the flat term ('fill *
  // keyColor'), so probeWeight shifts hue only and the brightness stays put.
  // ambientGain > 1 deliberately breaks the house rule — it is the control
  // for testing whether the look actually wants genuine radiosity lift.
  let g = fill * dot(keyColor, vec3<f32>(0.2126, 0.7152, 0.0722)) * bounceCfg.y;
  return mix(flat, tint * g, w);
}`;

/**
 * The per-wall term, hoisted so `ambientAt` reads as six identical lines.
 * Emitted before `AMBIENT_AT` in the shader chain.
 */
export const WALL_CONTRIBUTION = /* wgsl */ `fn wallContribution(
  c: vec3<f32>,
  p: vec3<f32>,
  n: vec3<f32>,
  color: vec3<f32>
) -> vec3<f32> {
  let d = c - p;
  let dist = length(d);
  if (dist < 1e-5) { return vec3<f32>(0.0, 0.0, 0.0); }
  let ndl = max(dot(d / dist, n), 0.0);
  let t = dist / ${AMBIENT_REF_DIST};
  return color * (ndl / (1.0 + t * t));
}`;
