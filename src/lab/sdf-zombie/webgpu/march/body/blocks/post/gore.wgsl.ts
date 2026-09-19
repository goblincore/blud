// src/lab/sdf-zombie/webgpu/march/body/blocks/post/gore.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): gore mask (post-hit material).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const GORE_BLOCK = /* wgsl */ `  // Gore mask (gobs-and-goo spec §2): chunks are torn meat, not clean latex.
  // fbm mottling + proximity to the torn wounds; blends toward wet deep red
  // and darker clot, and rides the wet boost so bloody regions glisten.
  //
  // TASK 2 (2026-09-16 playtest follow-ups): this pass MOVED AFTER the face
  // layer and is attenuated by (1 - faceCover). Before, the face multiplied an
  // already gore-blackened albedo, so a detached head read as a mottled meat
  // blob with the painted face invisible under it. Standing bodies have
  // goreStrength 0 and pay nothing; a non-head chunk has faceCfg.x 0, so the
  // face layer is a no-op and the gore result is bit-identical to before.
  //
  // TASK 3: the gate is the MAX of the per-view uniform (non-crowd draws and
  // chunk views) and the per-instance record. The crowd shares ONE material, so
  // a doomed body in a crowd could not ramp its gore through lodCfg.w without
  // repainting the whole type; gInstGore carries its own ramp (REC_GORE).
  let goreStrength = max(lodCfg.w, gInstGore) * (1.0 - faceCover);
  var gore = 0.0;
  if (goreStrength > 0.0) {
    let mottle = clamp(fbm(anchor * 6.0) * 0.5 + 0.5, 0.0, 1.0);
    gore = clamp(mottle * 0.55 + wm * 0.65, 0.0, 1.0) * goreStrength;
    let clot = deepColor * 0.55;
    albedo = mix(albedo, mix(deepColor, clot, mottle), gore * 0.85);
    // Capped blast cuts have no spherical torn-end wound. Stain their flesh
    // without carving away the caps; mirror this in bakeChunkAlbedo.
    let stain = smoothstep(0.40, 0.68, mottle) * goreStrength;
    albedo = mix(albedo, deepColor * 0.22, stain * 0.85);
  }`;
