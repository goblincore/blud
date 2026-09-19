// src/lab/sdf-zombie/webgpu/march/body/blocks/post/burn.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): burning body, soot and skeleton show-through (post-hit material).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const BURN_BLOCK = /* wgsl */ `  // BURNING BODY. One noise field decides both halves of the look: where it is
  // high there is flame, where it is low there is soot. That is what the Blood
  // sprites do -- dark char shows BETWEEN the flames from the first frame, so
  // char cannot come from elapsed time alone or a freshly lit body reads as a
  // uniformly glowing statue. The noise rides the anchor (REST space) and
  // scrolls along -y, so fire climbs the body and stays ON the body as it
  // walks. burnCfg is the per-view ramp, gInstBurn the per-instance one; max()
  // makes one shader serve single and crowd draws, as goreStrength does above.
  // char is monotonic (burn-state.ts) -- a body that burned and was put out is
  // a CHARRED CORPSE, not a clean one -- so the gate opens on char too and the
  // soot mix inside it is an exact identity (x*1 + y*0) at sootMask 0, keeping
  // a non-burning body unchanged.
  let burnAmt = clamp(max(burnCfg.x, gInstBurn.x), 0.0, 1.0);
  let charAmt = clamp(max(burnCfg.z, gInstBurn.z), 0.0, 1.0);
  if (burnAmt > 0.0 || charAmt > 0.0) {
    let burnPhase = max(burnCfg.y, gInstBurn.y) * burnRiseSpeed;
    let fireN = fbm(anchor * burnNoiseScale + vec3<f32>(0.0, -burnPhase, 0.0));
    // coverBias slides the threshold: at coverage 1 almost the whole surface is
    // above it, at 0 almost none is.
    let coverBias = mix(0.85, -0.15, burnFireCoverage);
    let fire = clamp(fireN - coverBias, 0.0, 1.0) * burnAmt * (1.0 - charAmt * 0.55);
    let sootMask = clamp((1.0 - fire) * burnCharPatch + charAmt, 0.0, 1.0);
    // SOOT NOISE, the same fbm that drives the char/soot split placed on its
    // soot side: the fbm is signed (noise3 returns -1..1), so fireN < 0 is
    // where the flesh chars. Remap it to 1 at the soot end and 0 at the flame
    // end. The bone streaks below read this, so a dark streak in the bone lines
    // up with the soot patch on the flesh beside it. Kept separate from
    // sootMask because charAmt drives sootMask to 1 on a fully charred body,
    // which would flatten the streaks out.
    let sootNoise = clamp(0.5 - 0.5 * fireN, 0.0, 1.0);
    albedo = mix(albedo, charColor, sootMask);
    // Burnt meat is not wet latex. Killing gloss and metal is most of what
    // makes a charred body read as charred rather than as a dark body.
    gloss = gloss * (1.0 - sootMask * 0.9);
    metal = metal * (1.0 - sootMask * 0.9);
    // SKELETON SHOW-THROUGH. The bone capsules are already in the field but sit
    // at least 4 mm inside the flesh, so flesh depth alone always hides them.
    // Probe the bone field alone at the shading point instead -- folding into an
    // empty distance returns the bone distance, since min of 1e9 and bone is
    // bone -- and let a bone within revealDepth of the surface bleed through as
    // the flesh chars. Reads the instance globals the hit slot loaded in the
    // trace post, so counts and band are THIS instance's. Builds with char, so
    // a freshly lit body is still opaque; zero on a body that never burned, so
    // no other pixel pays for the probe.
    let skelK = charAmt * burnSkeleton;
    // How much of the bone material actually reaches this fragment, 0..
    // skeletonShow. Declared out here because the fire emission below is
    // damped by it: revealed bone is not on fire and must not pick up
    // gBurnEmit, or a cold burnt corpse reads as glowing bone.
    var boneMat = 0.0;
    if (skelK > 0.0) {
      let boneProbe = applyBones(1e9, p, data, gInstCounts, gInstCounts2.x, gBand, segVolumeAtlas, segVolumeMeta);
      // Reveal depth (0.08 default; fix pass task 3 history): the plan's 0.045
      // hugged the bones so tightly that only the shin and shoulder edge read
      // through soot. Probed 0.1 under the old flat tint: a whole limb then sat
      // within reach of its bone capsule and read pale pink -- FRESH flesh,
      // killing the char. The constant is now BurnTuning.skeletonDepth so the
      // panel can trade that limb clutter for rib coverage without a rebuild;
      // 8 cm keeps the falloff ON the skeleton (nearest-bone ridge brightest,
      // smoothstep to zero). The ribs sit deeper than 8 cm under chest flesh.
      let revealDepth = burnSkeletonDepth;
      // STEEPER FALLOFF (bone-fix pass). The linear ramp left too much reveal
      // for bone sitting well under the surface; squaring it pulls deep bone
      // toward zero while the nearest-bone ridge (the skull, a forearm edge)
      // still reads. A thin limb's capsule runs its whole length at a shallow
      // depth, so the depth term alone cannot save it -- the cap below does.
      let nearBoneLin = 1.0 - smoothstep(0.0, revealDepth, max(boneProbe, 0.0));
      let nearBone = nearBoneLin * nearBoneLin;
      // REVEAL GATE (skeleton pass D). Bone only shows through flesh that has
      // actually burnt through: char must pass 0.55 and the same soot mask that
      // darkens the flesh must be high, so the reveal rides charred patches
      // instead of lifting a whole limb. Both gates are 1 at char 1, so the
      // full-char corpse keeps the reveal; they only trim the mid stages.
      let charGate = smoothstep(0.55, 0.62, charAmt);
      let sootGate = smoothstep(0.35, 0.8, sootMask);
      let revealGate = charGate * sootGate;
      let showBone = clamp(nearBone * skelK * revealGate, 0.0, 1.0);
      // BONE, NOT A PALE TINT (flame-polish task 4). The old branch lerped
      // albedo straight toward boneColor and left the flesh normal and gloss
      // alone, so the result was a flat pale patch with skin bumps in it --
      // pale skin, not bone. Where the probe finds bone, shade the fragment
      // with the bone material: a depth-shaded bone albedo, a near-matte bone
      // gloss, and a normal taken from the ISOLATED BONE FIELD's own gradient
      // so the highlight follows the tube under the skin instead of the flesh.
      if (showBone > 0.0) {
        // calcNormal's four-tap tetrahedron, applied to the bone fold alone.
        // applyBones returns the dIn it was handed, so 1e9 isolates bone from
        // flesh; each tap is the signed distance to the nearest bone surface
        // and the tetrahedron weights recover its outward gradient there.
        let be = max(revealDepth * 0.03, 0.0015);
        let b0 = applyBones(1e9, p + vec3<f32>(be, -be, -be), data, gInstCounts, gInstCounts2.x, gBand, segVolumeAtlas, segVolumeMeta);
        let b1 = applyBones(1e9, p + vec3<f32>(-be, -be, be), data, gInstCounts, gInstCounts2.x, gBand, segVolumeAtlas, segVolumeMeta);
        let b2 = applyBones(1e9, p + vec3<f32>(-be, be, -be), data, gInstCounts, gInstCounts2.x, gBand, segVolumeAtlas, segVolumeMeta);
        let b3 = applyBones(1e9, p + vec3<f32>(be, be, be), data, gInstCounts, gInstCounts2.x, gBand, segVolumeAtlas, segVolumeMeta);
        let boneG = vec3<f32>(b0 - b1 - b2 + b3, -b0 - b1 + b2 + b3, -b0 + b1 - b2 + b3);
        // A bone fold can have a zero gradient at its medial axis or where two
        // capsules meet; normalize(0) is NaN and a NaN normal blackens the
        // fragment. Guard it and keep the flesh normal there.
        let boneG2 = dot(boneG, boneG);
        if (boneG2 > 1e-12) {
          let boneN = boneG * inverseSqrt(boneG2);
          // Bias hard toward the bone normal where the probe is close: hardness
          // is what makes it read as bone, and the flesh normal only has to
          // survive at the reveal edge. Geometry-driven (nearBone), not gated by
          // skelK, so even a faint reveal has the tube's own shading.
          n = normalize(mix(n, boneN, clamp(nearBone * 0.95, 0.0, 0.95)));
        }
        // BONE AS BONE (skeleton pass D). Scorched grey kept a charred body
        // from reading pale, but it also killed the skeleton read: the bone
        // landed at ~1.4x the surrounding char with no ivory anywhere. The
        // reveal is now restricted (char > 0.55 and soot-high patches, see
        // revealGate), so the bone can carry an actual ivory tone again without
        // paling a whole limb. THREE terms, all needed:
        //   ivory        -- clean bone colour, the thing that reads as skeleton;
        //   sootStreak   -- the SAME fbm that drives the char/soot split, taken
        //                   on its soot side, so a dark streak in the bone lines
        //                   up with the soot on the flesh beside it;
        //   cavity       -- nearBone 1 on the bone surface, 0 deep in the gap
        //                   toward the charred flesh, which is what gives the
        //                   tube its rounded, recessed read.
        let boneIvory = vec3<f32>(0.72, 0.66, 0.55);
        let sootStreak = mix(1.0, 0.25, sootNoise);
        let cavity = mix(0.12, 1.0, nearBone);
        let boneShade = boneIvory * sootStreak * cavity;
        // CAP THE REVEAL at skelK (which is charAmt * skeletonShow, so never
        // above skeletonShow). The old unconditional 3.5 gain saturated any
        // showBone above ~0.29 to a full bone mix, which is what turned a
        // whole thin forearm bone-coloured end to end. The gain still sharpens
        // the core, but the cap means a limb can only ever be PART bone, so it
        // stays a charred limb with bone hinted along it. revealGate trims the
        // whole mix to the burnt-through patches.
        boneMat = clamp(nearBone * 2.2, 0.0, 1.0) * skelK * revealGate;
        albedo = mix(albedo, boneShade, boneMat);
        // Bone is matte but not dead-flat like char; a low, non-zero gloss with
        // no metal is enough for the rounded shape to catch the key light and
        // read as a tube rather than a flat ivory patch.
        gloss = mix(gloss, 0.25, boneMat);
        metal = mix(metal, 0.0, boneMat);
      }
    }
    // Revealed bone is not on fire. Damp the fire emission by the bone mix so
    // a bone patch does not glow through the flames or on a corpse; at
    // boneMat 0 the factor is exactly 1.0 and the line is byte-identical.
    gBurnEmit = fireRamp(fire) * fire * burnFireGain * (1.0 - boneMat);
    // The burn mask rides out to the tongue pass with the emissive write
    // (flame-tongues task 2): burn, char and the same fire term the ramp
    // consumed, so the screen-space tongues shape off exactly what the
    // surface lit with. Unburned bodies leave the private at vec4(0), which
    // is what their fragments then write over any burning body behind them.
    gBurnOut = vec4<f32>(burnAmt, charAmt, fire, 1.0);
    faceGlow = faceGlow * (1.0 - burnAmt);
    primGlow = primGlow * (1.0 - burnAmt);
  }`;
