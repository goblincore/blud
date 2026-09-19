// src/lab/sdf-zombie/webgpu/march/body/blocks/light/ambient.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): environment bounce, probe grid, bounce spot, dynamic probes.
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const AMBIENT_BLOCK = /* wgsl */ `  // ENVIRONMENT BOUNCE (lighting P1). Replaces the flat scalar fill with a
  // chromatic ambient derived analytically from the enclosure's six walls.
  //
  // At bounceCfg.x == 0 this returns exactly lightCfg.y * keyColor, which
  // makes the two expressions below algebraically identical to what they
  // were before bounce existed — the parity guarantee the spike rests on,
  // and the reason every preset ships with probeWeight 0.
  //
  // ZERO extra mapBody evaluations: ambientAt is dot products and distance
  // falloff, gated by a test that greps its source for field calls. The
  // post-hit eval budget is unchanged.
  var amb = ambientAt(p, n, boxMin, boxMax, wallNegX, wallPosX, wallNegY, wallPosY, wallNegZ, wallPosZ, bounceCfg, lightCfg.y, keyColor);
  // STATIC PROBE GRID (lighting P3 step 1, lab spike). Replaces the analytic
  // six-wall ambient with irradiance read from a probe grid gathered once on
  // the CPU against the same enclosure — directional, with real level
  // instead of the hue-only P1 tint. probeCfg.x = 0 skips the branch and
  // leaves amb exactly what ambientAt returned - the parity guarantee. Zero
  // field evaluations: three textureLoads per probe, eight probes.
  if (probeCfg.x > 0.0) {
    amb = mix(amb, probeIrradiance(p, n, probeTex, probeMin, probeInvExtent, probeDims) * probeCfg.y, probeCfg.x);
  }
  // FLASHLIGHT BOUNCE SPOT (lighting P4 step 1). The beam's lit patch on the
  // level, found on the CPU each frame, added as one analytic disc light so
  // a body between the lamp and the wall is lit from behind by the glow.
  // The gain gate lives inside the function - at bounceSpotCfg.x = 0 it
  // returns zero and amb is untouched. No field evaluations.
  amb = amb + bounceSpotIrradiance(p, n, bounceSpotPos, bounceSpotNormal, bounceSpotRadiance, bounceSpotCfg);
  // GPU PROBE GATHER dynamic layer. Body VISIBILITY darkens the ambient a
  // body sits in (and its own underside), dynamic RADIANCE adds the level
  // lit by the muzzle flash. Both gains 0 skip the storage read entirely -
  // the parity path. See probe-gather-compute.ts for the writer.
  if (probeDynCfg.x > 0.0 || probeDynCfg.y > 0.0) {
    let dyn = probeDynamic(p, n, probeDyn, probeMin, probeInvExtent, probeDims);
    amb = amb * mix(1.0, dyn.w, probeDynCfg.y) + dyn.xyz * probeDynCfg.x;
  }`;
