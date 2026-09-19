// src/lab/sdf-zombie/webgpu/march/body/light.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): march lighting tail.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.

export const MARCH_BODY_LIGHT = /* wgsl */ `  // Runtime normal out (MARCH_NORMAL_OUT): world-space unit n, before any early return below.
  // Run 5b: the normal attachment's alpha carries a per-body KEY (gInstCentre is the record's per-body centre, read from the
  // same record by the march and by the refine twin, so it compares exactly). +1 keeps it off the cleared 0.
  // No reader of the attachment consumes .w except the refine twin (pinned).
  let bodyKey = dot(gInstCentre, vec3<f32>(1.0, 7.31, 13.7)) + 1.0;
  gMarchNormal = vec4<f32>(normalize(n), bodyKey);
  // NORMAL-OUTPUT MODE (debugCfg.x == 9, neural upscale normals capture,
  // 2026-09-12). The final shading normal (after the face bump) in WORLD space,
  // depth in alpha exactly as the lit output, so the same readback and crop
  // apply. Read-back only, like the counters above; the capture script
  // (scripts/upscale-capture-v2.mjs) rotates it into view space. The runtime
  // stage gets normals from an MRT attachment later — this mode is the
  // TRAINING-side source and must compute the same n the lit path shades with.
  if (debugCfg.x > 8.5 && debugCfg.x < 9.5) {
    return vec4<f32>(normalize(n), t);
  }
  // ---- ANALYTIC FLASHLIGHT ----------------------------------------------
  // The world's SpotLight is invisible to the march — SDF bodies are shaded
  // here, not by three — so the beam is re-evaluated analytically per pixel.
  //
  // PER-PIXEL, not per-body, so the cone edge cuts ACROSS a figure instead of
  // the whole zombie popping on at once.
  //
  // ZERO field taps: a normalise, two dots and a divide. This is the
  // constraint that let character self-shadowing be cut rather than paid for.
  //
  // It drives L and keyColor — NOT albedo. ambientAt renormalises bounce to
  // unit luminance, so an albedo boost would change hue and leave brightness
  // untouched. Brightness must ride the key.
  var L = normalize(lightDir);
  var keyC = keyColor;
  var keyI = lightCfg.x;
  var beamAmt = 0.0;
  if (spotCfg.x > 0.0) {
    let toLamp = spotPos - p;
    let dist = length(toLamp);
    let Ls = toLamp / max(dist, 1e-4);
    let cone = dot(-Ls, normalize(spotAxis));
    let coneFall = clamp((cone - spotCfg.z) / max(spotCfg.y - spotCfg.z, 1e-4), 0.0, 1.0);
    let distFall = clamp(1.0 - dist / max(spotCfg.w, 1e-4), 0.0, 1.0);
    let beam = coneFall * coneFall * distFall * distFall * spotCfg.x;
    // Blend the key TOWARD the beam. At beam 0 this is exactly the old key,
    // which keeps the lab and every existing preset bit-identical.
    L = normalize(mix(L, Ls, clamp(beam, 0.0, 1.0)));
    keyC = mix(keyColor, spotColor, clamp(beam, 0.0, 1.0));
    // spotCfg2.x is the beam's KEY GAIN, a live knob. The 2.2 it replaces
    // blew a lit body clean past 1.0 on every channel, and a clipped
    // body has no wound in it: crater, lip and char all saturate to the
    // same white. See the shoulder below.
    // THE BEAM IS THE KEY, NOT A BONUS ON TOP OF IT (spotCfg2.z).
    //
    // This used to be lightCfg.x + beam*gain, which left the preset's own key
    // — 2.4 for practical-hard-key — burning at full strength from a fixed
    // direction that nothing could switch off. So a character standing in an
    // unlit corridor was still brightly lit from nowhere (owner, 2026-09-01:
    // "the unlit characters seem still to be lit ... bright in the darkness
    // without light"). In a dungeon the lamp you carry has to be the reason a
    // body is visible.
    //
    // spotCfg2.z is what survives of the preset key when the beam is off: a
    // floor, not a fill. It is NOT zero on purpose — ambientAt carries hue
    // rather than brightness (bounce is renormalised to unit luminance), so a
    // character lit by nothing but bounce has no level at all and disappears
    // completely rather than reading as a shape in the dark.
    keyI = lightCfg.x * spotCfg2.z + beam * spotCfg2.x;
    beamAmt = beam;
  }
  // ---- END ANALYTIC FLASHLIGHT --------------------------------------------
  let V = -rd;
  let H = normalize(L + V);
  let diff = max(dot(n, L), 0.0);

  // wet, specPow and glow now live ABOVE the flashlight in
  // MARCH_BODY_SURFACE_PREP (the task-2 section split — see its header).
  // shine's exponent IS specPow, the legacy inline mix given a name; the
  // arithmetic is unchanged.
  let shine = pow(max(dot(n, H), 0.0), specPow);
  // Fresnel fades out INSIDE wounds rather than riding the wet boost: it is
  // environment rim-light, and inside a cavity the "environment" is the wound
  // itself. At full strength it maxes out on the grazing-heavy rim geometry,
  // the 1.6x wound wetness lands on top, and whole patches clip to white and
  // sweep across the cavity as the camera moves (X1.17). The wet glisten a
  // wound SHOULD have is the tight specular term, which keeps the boost.
  let fres = pow(1.0 - max(dot(n, V), 0.0), 4.0) * surfCfg.z * (1.0 - wmRim);

  // Fake backlit scatter: sample the field a little way toward the light.
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
  let lvl = levelShadow(p, n, levelShadowTex, levelShadowMatrix, levelShadowCfg);

  // ENVIRONMENT BOUNCE (lighting P1). Replaces the flat scalar fill with a
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
  }
  // HIGHLIGHT SHOULDER (spotCfg2.y). A body standing in the beam used to run
  // past 1.0 on every channel and hard-clip, which does not just look blown —
  // it DELETES the wounds: crater, lip, char and clean skin all clamp to the
  // same white, so a shot enemy reads identical to an unshot one exactly when
  // you are close enough to aim. The shoulder compresses [knee, inf) into
  // [knee, 1) monotonically, so those differences survive as differences.
  //
  // Gated on the beam existing at all, so the lab and every stock preset keep
  // their old arithmetic bit-for-bit.
  //
  // METAL (hard-surface task 2), at metal 1:
  //  - the whole diffuse FAMILY (ambient bounce + key diffuse) scales to a
  //    0.45 floor — bounce IS diffuse, and leaving it full would keep the
  //    plate reading as paint. NOT zero: with no environment map the lab
  //    has one key, and a true-zero diffuse goes black wherever the
  //    highlight is not. Rendered curve, 2026-09-03 (12-frame turntable,
  //    front and plate-bearing yaws): 0.25 went BLACK at the front yaw;
  //    0.35 kept the slab forms but the front still read near-black; 0.45
  //    keeps the greave's specular gradient AND a readable front face. 0.45
  //    ships; the owner can pull it darker now that the word exists.
  //  - the specular AND the fresnel rim are tinted by the prim's own
  //    albedo instead of shining the light's colour — the single change
  //    that makes steel differ from white plastic under the same light.
  //    The tint is the albedo's HUE with its luminance renormalised to
  //    steel's F0: multiplying by the RAW albedo (this line's first
  //    version) rendered the minotaur's plates BLACK — 0.17 linear
  //    luminance times the highlight is no highlight (frame-00 A/B,
  //    2026-09-03). Polished steel reflects ~56% at normal incidence
  //    however dark its paint reads (iron F0 = 0.56, standard metals
  //    table), so the scale renormalises luminance, and the min() caps the
  //    blow-up on near-black paint (dark chrome should stay dark).
  //  - wet, scatter and the wound terms are untouched: scope discipline,
  //    and the floor above keeps the plate readable without them.
  // At metal 0 both factors are exactly 1.0 — bit-identical to the old sum
  // (multiplication by 1.0 is exact), so every non-metal character shades
  // byte-for-byte as before.
  // (Task 3's merge removed a STALE duplicate of this block left by task 2's
  // tuning pass — it claimed the 0.25 floor this curve superseded.)
  //
  // THE mix() IS LEAD, NOT TRIM (regression fixed 2026-09-04). The sentence
  // above was the INTENT; for one merge the tint below did not implement it.
  // It shipped as the bare min(), and primAlbedo is vec3(0) on every
  // UNPAINTED pixel — flesh never enters the 'PC.w > 0.0' branch that fills
  // it. So metalTintLum sat on its 1e-3 floor, the tint evaluated to vec3(0),
  // and it multiplied the ENTIRE specular + fresnel line to nothing: every
  // zombie lost its highlight and its rim at once, in the lab and in the
  // game. The diagnostic tell is that the specular slider went dead — surfCfg.x
  // lives inside those parentheses, so nothing it does survives a zero
  // common factor.
  //
  // Gate it the same way the diffuse floor beside it is gated. A PAINTED
  // non-metal wants the untinted white highlight too (polished plastic, not
  // coloured chrome), which 'metal' - not 'painted' - is exactly the flag for.
  let metalTintLum = max(dot(primAlbedo, vec3<f32>(0.2126, 0.7152, 0.0722)), 1e-3);
  let metalTint = mix(vec3<f32>(1.0), min(primAlbedo * (0.56 / metalTintLum), vec3<f32>(1.5)), metal);
  // DIRECT MUZZLE FLASH (owner, 2026-09-09: "the soldier's flash should light
  // them up briefly"). The nearest burning muzzle — this body's own or a
  // neighbour's, the game picks the strongest by I/d² — as a warm point
  // light with a 0.2 m floor on the distance so a muzzle against the flesh
  // does not blow it out. bodyFlash.w = 0 skips it: bit-identical.
  var flashDirect = vec3<f32>(0.0, 0.0, 0.0);
  if (gInstFlash.w > 0.0) {
    let fv = gInstFlash.xyz - p;
    let fd2 = max(dot(fv, fv), 0.04);
    let fl = fv * inverseSqrt(fd2);
    flashDirect = vec3<f32>(1.0, 0.72, 0.45) * (gInstFlash.w * max(dot(n, fl), 0.0) / fd2);
  }
  var fleshLit = albedo * (amb + flashDirect + diff * wShadow * lvl * keyI * keyC) * ao * mix(1.0, 0.45, metal)
               // * woundGlint: MEAT DETAIL (soldierWound block) — the wet highlight broken into glints,
               // soldier wounds only; applied at the consumer so the hoisted wet statement stays pinned.
               + metalTint * keyC * (shine * wShadow * lvl * mix(surfCfg.x, 1.5, gloss) + fres * mix(1.0, 2.5, gloss)) * wet * mix(1.0, woundGlint, soldierWound)
               + scatter;
  // FLAT-LIT decal: where the baked face covers the surface, relight it with
  // a fixed favourable diffuse and no AO/spec/fresnel — the image carries its
  // own shading, and real shading on top drew hard shadow lines from the
  // fringe and killed the mouth on the down-sloping jaw. 0.85 keeps a whisper
  // of real light so the head still turns.
  //
  // The DIFFUSE CONSTANT was 0.52 and is 0.30 (2026-09-04). At 0.52 the decal
  // rendered effectively UNLIT: measured on the soldier, face #cc9f69 --
  // almost exactly his raw atlas skin -- against a correctly-lit body at
  // #954821, a 1.83x mismatch that read as a pale card stuck on the head.
  // 0.30 brings it to 1.22x, about right for a face catching light. The 0.85
  // MIX is deliberately untouched: that is what keeps the fringe shadow off
  // the mouth, which is the failure this comment records. Swept for
  // regressions -- the zombie sits at 1.18x face/torso, contrast sd 41.4.
  fleshLit = mix(fleshLit,
                 albedo * (amb + 0.30 * lightCfg.x * keyColor),
                 faceFlat * 0.85);
  if (spotCfg.x > 0.0 && spotCfg2.y > 0.0) {
    let knee = clamp(1.0 - spotCfg2.y, 0.05, 0.99);
    fleshLit = vec3<f32>(softShoulder(fleshLit.x, knee),
                         softShoulder(fleshLit.y, knee),
                         softShoulder(fleshLit.z, knee));
  }

  // Each emission source fades the lit term by its own amount, mirroring the
  // face path's fleshLit * (1 - faceGlow): a surface that IS the light
  // should not ALSO carry the key's full diffuse on top — that add-then-clamp
  // is exactly how the face glow used to render pale cream (comment above).
  // At primGlow 0 the factor is exactly 1.0 — bit-identical to the old line
  // (multiplication by 1.0 is exact), so every non-glowing pixel everywhere
  // shades byte-for-byte as before.
  // gBurnEmit is 0 on every non-burning body, so this line is bit-identical to
  // the old one everywhere burn is off (adding 0.0 is exact).
  var lit = fleshLit * (1.0 - faceGlow) * (1.0 - primGlow) + glow + gBurnEmit;

  // Legacy display look (lodCfg.y). Every flesh preset was hand-tuned in the
  // WebGL lab, which displayed the lit LINEAR value raw — no output sRGB
  // encode. This path encodes correctly, which lifts the low channels and
  // washes those presets out. Applying the sRGB EOTF (decode) here cancels
  // three's output encode exactly, so the marched flesh displays the same
  // linear values the presets were tuned against. Kill switch for the X1.3
  // retune: turn this off, retune presets through the honest chain, delete.
  if (lodCfg.y > 0.5) {
    let c = max(lit, vec3<f32>(0.0));
    let lo = c / 12.92;
    let hi = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    lit = select(hi, lo, c <= vec3<f32>(0.04045));
  }

  // PERF INSTRUMENTATION output (task 2): replace the shaded colour with
  // the counter heatmap — a two-stop blue -> yellow -> red ramp, no
  // texture. Steps normalise by the budget (marchCfg.x, 96); prims by 2000
  // (56 prims x ~35 steps as the red end). After the gamma block so the
  // ramp colours emit raw; depth (t) still goes out, so the composite's
  // depth path runs identically to a shaded frame.
  if (debugCfg.x > 0.5) {
    // MODE 3 (hull-holes diagnosis, 2026-08-27): heat of occT itself — the
    // distance this pixel's march will be clamped by. 0 m = blue, 4 m = red,
    // no hull = white. Shows WHICH hull surface a wounded body's pixels are
    // being cut by. Temporary diagnostic.
    if (debugCfg.x > 2.5 && debugCfg.x < 3.5) {
      let occNorm = clamp(occT / 4.0, 0.0, 1.0);
      var occCol = mix(vec3<f32>(0.05, 0.15, 0.75), vec3<f32>(0.95, 0.85, 0.15), clamp(occNorm * 2.0, 0.0, 1.0));
      occCol = mix(occCol, vec3<f32>(1.0, 1.0, 1.0), select(0.0, 1.0, occT > 3.9));
      return vec4<f32>(occCol, t);
    }
    let heatNorm = select(debugSteps / max(marchCfg.x, 1.0), debugPrims / 2000.0, debugCfg.x > 1.5);
    let rampA = vec3<f32>(0.05, 0.15, 0.75);
    let rampB = vec3<f32>(0.95, 0.85, 0.15);
    let rampC = vec3<f32>(0.85, 0.05, 0.10);
    var heatCol = mix(rampA, rampB, clamp(heatNorm * 2.0, 0.0, 1.0));
    heatCol = mix(heatCol, rampC, clamp((heatNorm - 0.5) * 2.0, 0.0, 1.0));
    return vec4<f32>(heatCol, t);
  }

  return vec4<f32>(lit, t);
}`;
