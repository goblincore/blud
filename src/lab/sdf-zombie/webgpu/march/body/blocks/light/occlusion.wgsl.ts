// src/lab/sdf-zombie/webgpu/march/body/blocks/light/occlusion.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): scatter, AO, wound soft shadow and level shadow.
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const OCCLUSION_BLOCK = /* wgsl */ `  // Fake backlit scatter: sample the field a little way toward the light.
  // A whole extra mapBody, so it is skipped outright at zero translucency
  // rather than multiplied away afterwards.
  var scatter = vec3<f32>(0.0, 0.0, 0.0);
  if (surfCfg.w > 0.0) {
    let thin = clamp(mapBody(p + L * 0.06, data, noiseCfg, woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg).x * -8.0, 0.0, 1.0);
    scatter = deepColor * thin * surfCfg.w * (1.0 - cm);
  }

  // Cheap AO from the field, so creases and the insides of joints stay dark.
  // Without it a limb dissolves into the torso visually even when the geometry
  // is correctly separated — so this is a LOD lever, not a free win: it is the
  // one guarded by an explicit flag rather than by its own amplitude, because
  // there is no "AO strength" to turn down.
  var ao = 1.0;
  if (lodCfg.x > 0.5) {
    ao = clamp(mapBody(p + n * 0.06, data, noiseCfg, woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg).x / 0.06, 0.35, 1.0);
  }
  // NO wound-keyed AO darkening, NO analytic key gate, NO spec occlusion —
  // deliberately (owner bisect A/B, 2026-08-24). All three were 2026-08-23/24
  // attempts to mask wound-adjacent brightness, and each carried its own
  // radial or gated edge onto the skin around the crater; the owner judged
  // the plain 2026-08-22 lighting decisively better in motion. The real
  // fixes for what they chased are structural: the tracer retract (rays no
  // longer land inside the body and shade garbage) and the soft shadow below.

  // WOUND SOFT SHADOW — the cast shadow the crater was missing: the wall
  // nearest the key shadowing the floor under it, soft-edged (owner call,
  // "cast shadow vs darker floor" — the shadow won). Gated on hitNearWound:
  // outside the wound zones shadow stays exactly 1.0 and the whole thing
  // costs nothing. Strength mixes toward 1 so the slider scales the effect,
  // never inverts it. Applied to the KEY diffuse and key specular ONLY —
  // fill, ambient and scatter stay untouched or craters go pitch black.
  var wShadow = 1.0;
  if (woundShadowCfg.x > 0.0 && hitNearWound) {
    wShadow = mix(1.0, woundShadow(p, L, abs(woundShadowCfg.y), data, woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg), woundShadowCfg.x);
  }

  // LEVEL SHADOW (perf round 2 task 7). One texture load per hit pixel, ZERO
  // extra field evaluations: the lookup is a projection + 4 depth loads
  // against the twin light's level-only map. At cfg.x = 0 it returns 1.0
  // before touching the texture — the whole feature is inert in the lab and
  // until the game page's seam turns it on. Applied to the KEY diffuse and
  // key specular ONLY — the same discipline as wShadow above: ambient, fill
  // and scatter stay untouched or a shadowed body goes pitch black.
  let lvl = levelShadow(p, n, levelShadowTex, levelShadowMatrix, levelShadowCfg);`;
