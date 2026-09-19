// src/lab/sdf-zombie/webgpu/march/fields/volume.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `volume`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { HELPERS, MARCH_BODY, CONE_MARCH, MAP_BODY, SAMPLE_VOLUME, NOISE_LOCAL, SD_SHELL } from '../../march.wgsl';
import { declaredName } from '../../march-test-support';

describe('baked hand volume branch (X1.26 task B2)', () => {
  it('exports SAMPLE_VOLUME starting with fn, per the wgslFn parse contract', () => {
    // X1.27: the template now declares TWO helpers — the slab-local frame
    // sampler first (wgslFn parses the leading fn), then the mixing sampler.
    expect(declaredName(SAMPLE_VOLUME)).toBe('sampleHandVolumeFrame');
    expect(SAMPLE_VOLUME).toContain('fn sampleHandVolume(');
  });

  it('reads exactly eight 3D corner texels for the trilinear reconstruction', () => {
    const loads = SAMPLE_VOLUME.match(/textureLoad\(volumeTex/g) ?? [];
    expect(loads.length).toBe(8);
    // And nothing else in the helper touches the texture.
    expect(SAMPLE_VOLUME.match(/textureLoad\(/g)?.length).toBe(8);
  });

  it('reconstructs on the baker\'s ENDPOINT-INCLUSIVE lattice, not the sampler convention', () => {
    // The baker sampled ON the bounds: first/last texels sit exactly at
    // boundsMin/boundsMax, so texel coords are uv * (dims - 1). The
    // normalized-sampler convention uv*dims - 0.5 assumes samples at texel
    // CENTRES and would shift the whole field half a voxel.
    expect(SAMPLE_VOLUME)
      .toContain('q = clamp(uv * (dimsF - vec3<f32>(1.0, 1.0, 1.0)), vec3<f32>(0.0, 0.0, 0.0), dimsF - vec3<f32>(1.0, 1.0, 1.0));');
    expect(SAMPLE_VOLUME).not.toContain('- 0.5)');
    // Nested mix: 4 edges, 2 faces, 1 slab = exactly seven per frame helper,
    // plus the ONE frame mix in sampleHandVolume.
    expect((SAMPLE_VOLUME.match(/mix\(/g) ?? []).length).toBe(8);
    // Degenerate top corner: floor == dims-1 clamps i1 back onto i0.
    expect(SAMPLE_VOLUME).toContain('min(i0 + vec3<i32>(1, 1, 1), dimsI - vec3<i32>(1, 1, 1))');
    // textureDimensions is vec3<u32> — WGSL has no u32−i32 overload, and a
    // mixed subtraction fails pipeline compilation at runtime (the canvas
    // freeze task C diagnosed live). Every narrowing is explicit.
    expect(SAMPLE_VOLUME).toContain('vec3<i32>(textureDimensions(volumeTex, 0))');
  });

  it('transforms world to local with the conjugate of the local-to-world quat', () => {
    expect(SAMPLE_VOLUME).toContain('vec4<f32>(-volumePose1.xyz, volumePose1.w)');
  });

  it('applies the distal warp progressively with smoothstep(0.15, 0.9, uv.y)', () => {
    // Wrist pinned (0 at the carpals), fingers fully lagged past 0.9. The
    // 12 mm CLAMP is CPU-side (task C1); the shader just ramps.
    expect(SAMPLE_VOLUME).toContain('smoothstep(0.15, 0.9, uv0.y)');
    expect(SAMPLE_VOLUME).toContain('local0 - volumeWarp.xyz * distal');
  });

  it('adds metric distance to the AABB outside the volume — no slab extrusion', () => {
    // Clamp-to-edge alone would repeat the boundary slab out to infinity;
    // every outside sample must grow by its true distance to the box.
    expect(SAMPLE_VOLUME).toContain('let diffMin = volumeMin - local;');
    expect(SAMPLE_VOLUME).toContain('let diffMax = local - (volumeMin + extent);');
    expect(SAMPLE_VOLUME).toContain(
      'let outside = length(max(max(diffMin, diffMax), vec3<f32>(0.0, 0.0, 0.0)));');
    expect(SAMPLE_VOLUME)
      .toContain('return mix(d0, d1, clamp(volumeClip.z, 0.0, 1.0)) + outside;');
  });

  it('sits in HELPERS before MAP_BODY, which calls it', () => {
    // WGSL declaration-before-use; HELPERS is dependency-ordered.
    expect(HELPERS).toContain(SAMPLE_VOLUME);
    expect(HELPERS.indexOf(SAMPLE_VOLUME)).toBeLessThan(HELPERS.indexOf(MAP_BODY));
    expect(MAP_BODY).toContain('sampleHandVolume(p, volumeTex');
  });

  it('MAP_BODY: the volume branch supplies d, skips the primitive loop, and keeps the dominant index -1', () => {
    const branch = MAP_BODY.indexOf('if (volumePose0.w > 0.5) {');
    expect(branch).toBeGreaterThanOrEqual(0);
    // The branch must precede carves/wounds — the bake is the body, damage
    // still stamps on top of it either way.
    expect(branch).toBeLessThan(MAP_BODY.indexOf('applyCarves'));
    expect(branch).toBeLessThan(MAP_BODY.indexOf('applyWounds'));
    // No faked primitive index: the volume branch never assigns bestIdx, so
    // the rest-space anchor falls to its noiseLocal fallback.
    const vol = MAP_BODY.slice(branch, MAP_BODY.indexOf('} else {', branch));
    expect(vol).not.toMatch(/bestIdx\s*=/);
    // ...and the primitive fold lives only in the else arm.
    const elseArm = MAP_BODY.slice(MAP_BODY.indexOf('} else {', branch));
    expect(elseArm).toContain('for (var c = 0; c < 8; c = c + 1)');
    expect(elseArm).toContain('for (var gi = 0; gi < 64; gi = gi + 1)');
  });

  it('threads the texture and six volume uniforms through EVERY mapBody call', () => {
    // Argument forwarding is load-bearing: a call site that forgets one
    // volume argument does not fail to compile — WGSL has no named args —
    // the generated node call simply mismatches. Every call, every source.
    const needed = ['volumeTex', 'volumeMin',
      'volumeInvExtent', 'volumeWarp', 'volumeClip', 'segVolumeAtlas', 'segVolumeMeta'];
    for (const src of [...HELPERS, MARCH_BODY, CONE_MARCH]) {
      let at = src.indexOf('mapBody(');
      while (at >= 0) {
        const isDecl = at >= 2 && src.slice(at - 3, at).includes('fn');
        if (!isDecl) {
          const call = src.slice(at, at + 460);
          for (const n of needed) {
            expect(call, `${declaredName(src) ?? 'entry'} mapBody call missing ${n}`)
              .toContain(n);
          }
        }
        at = src.indexOf('mapBody(', at + 1);
      }
    }
  });

  it('calcNormal declares and forwards the volume params', () => {
    const calcNormal = HELPERS.find(h => declaredName(h) === 'calcNormal')!;
    expect(calcNormal).toContain('volumeTex: texture_3d<f32>');
    expect(calcNormal).toContain('volumeMin: vec3<f32>');
    expect((calcNormal.match(/mapBody\(/g) ?? []).length).toBe(4);
  });

  it('MARCH_BODY and CONE_MARCH declare the volume params', () => {
    for (const src of [MARCH_BODY, CONE_MARCH]) {
      expect(src).toContain('volumeTex: texture_3d<f32>');
      expect(src).toContain('volumeMin: vec3<f32>');
      expect(src).toContain('volumeInvExtent: vec3<f32>');
      expect(src).toContain('volumeWarp: vec4<f32>');
    }
  });

  it('hit epsilon rides the spare woundCfg2.w; primitive default stays bit-identical', () => {
    // Volume mode needs a hit epsilon of at least half the largest voxel
    // pitch (trilinear of an SDF is not exact); the primitive path keeps its
    // 1.2 mm literal because max(0.0012, 0) is 0.0012.
    expect(MARCH_BODY).toContain('let hitEpsBase = max(0.0012, woundCfg2.w);');
    // AA epsilon rides ON TOP of that floor and must collapse to it exactly at
    // the shipping default (aaCfg.y = 0 => aaK = 0 => max(base, 0) = base), so
    // the primitive path stays bit-identical until someone moves the slider.
    expect(MARCH_BODY).toContain('let aaK = aaCfg.x * aaCfg.y;');
    // Perf round 2 task 6: the footprint term divides by the dominant group's
    // distortion factor. At aaCfg.y = 0 the whole term is still exactly 0
    // (t * 0 / distort = 0), so the primitive path stays bit-identical.
    expect(MARCH_BODY).toContain('let hitEps = max(hitEpsBase, t * aaK / distort);');
    // wound-halo r2 split the accept into the deep-crossing retract guard and
    // the literal hit test; the epsilon literal still gates both.
    expect(MARCH_BODY).toContain('hit = true;\n          break;');
    expect(MARCH_BODY).toContain('if (d < -max(hitEpsBase, t * aaK / distort) && omega > 1.0');
    expect(MARCH_BODY).not.toContain('if (d < 0.0012)');
  });
});

describe('adjacent-slab clip sampling (X1.27 task C2)', () => {
  const frameFn = SAMPLE_VOLUME.slice(0, SAMPLE_VOLUME.indexOf('fn sampleHandVolume('));

  it('declares the slab-local frame helper with exactly eight textureLoads', () => {
    expect(declaredName(SAMPLE_VOLUME)).toBe('sampleHandVolumeFrame');
    const loads = frameFn.match(/textureLoad\(volumeTex/g) ?? [];
    expect(loads.length).toBe(8);
    // The frame helper is self-contained: no other texture traffic in it.
    expect(frameFn.match(/textureLoad\(/g)?.length).toBe(8);
    expect(frameFn.match(/textureDimensions/g)?.length).toBe(1);
  });

  it('offsets slab Z by frame * frameDepth and clamps Z to end at zOffset + frameDepth - 1', () => {
    expect(frameFn).toContain('let depth = max(1, i32(volumeClip.w));');
    expect(frameFn).toContain('let zBase = frame * depth;');
    expect(frameFn).toContain(
      'let i1 = min(i0 + vec3<i32>(1, 1, 1), dimsI - vec3<i32>(1, 1, 1));');
    expect(frameFn).toContain('let a0 = vec3<i32>(i0.x, i0.y, i0.z + zBase);');
    expect(frameFn).toContain('let a1 = vec3<i32>(i1.x, i1.y, i1.z + zBase);');
    // dimsI is the SLAB extent (atlas x/y, frameDepth z) — never the atlas
    // depth — so the clamp can never reach into the neighbouring slab.
    expect(frameFn).toContain('let dimsI = vec3<i32>(atlasDims.x, atlasDims.y, depth);');
    // Frames clamp to the atlas's frame count, so a stray index degrades to
    // the last slab rather than sampling off the texture.
    expect(frameFn).toContain('let frame = clamp(frameIndex, 0, atlasDims.z / depth - 1);');
  });

  it('forbids a 0-depth sentinel: depth is at least 1 in BOTH samplers', () => {
    expect(frameFn).toContain('max(1, i32(volumeClip.w))');
    expect(SAMPLE_VOLUME).toContain(
      'let depth = max(1, i32(volumeClip.w));');
    // And no division by volumeClip.w on any CODE line (comments excluded —
    // the depth guard divides by the derived depth, never the raw uniform).
    const codeLines = SAMPLE_VOLUME.split('\n').filter(l => !l.trim().startsWith('//'));
    expect(codeLines.join('\n')).not.toMatch(/\/\s*volumeClip\.w/);
  });

  it('samples frame0 and frame1 independently and mixes once, after the shared work', () => {
    const mixSampler = SAMPLE_VOLUME.slice(SAMPLE_VOLUME.indexOf('fn sampleHandVolume('));
    expect(mixSampler).toContain(
      'let d0 = sampleHandVolumeFrame(q, i32(volumeClip.x), volumeTex, volumeClip);');
    expect(mixSampler).toContain(
      'let d1 = sampleHandVolumeFrame(q, i32(volumeClip.y), volumeTex, volumeClip);');
    // Exactly two frame calls, exactly one distance mix.
    expect(mixSampler.match(/sampleHandVolumeFrame\(/g)?.length).toBe(2);
    expect(mixSampler.match(/mix\(d0, d1/g)?.length).toBe(1);
    expect(mixSampler).toContain('clamp(volumeClip.z, 0.0, 1.0)');
    // World-to-local, warp, uv and the outside-box distance are computed ONCE
    // (in the mixing sampler, before either frame is sampled).
    expect(mixSampler.indexOf('let outside')).toBeLessThan(
      mixSampler.indexOf('sampleHandVolumeFrame(q'));
    expect((mixSampler.match(/volumeWarp\.xyz/g) ?? []).length).toBe(1);
  });

  it('forwards volumeClip beside volumeWarp through every sampler call site', () => {
    expect(MAP_BODY).toContain(
      'sampleHandVolume(p, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip)');
    expect(MARCH_BODY).toContain('volumeClip: vec4<f32>');
    expect(CONE_MARCH).toContain('volumeClip: vec4<f32>');
    // WIND PARITY. The cone certifies emptiness for the march that follows,
    // so it must march the SAME surface. Unlike the noise (which the cone
    // passes as 0 by design, because it lives on the normal), wind moves the
    // field: a cone without this slot would certify space the drifted cloth
    // occupies and the march would start inside it.
    expect(CONE_MARCH).toContain('gWindDrift = gInstWind;');
    expect(MARCH_BODY).toContain('gWindDrift = gInstWind;');
    // BODY FRAME PARITY, for the same reason and with a sharper failure: a
    // cone anchored to the world while the march is anchored to a turning
    // body certifies emptiness against a surface that has rotated away.
    // Both must read the same uniform — NOT rebuild the triple from
    // faceCfg3/lodCfg, which only MARCH_BODY has.
    expect(CONE_MARCH).toContain('gBodyAnchor = gInstAnchor;');
    expect(MARCH_BODY).toContain('gBodyAnchor = gInstAnchor;');
    // sdShell must actually USE it, and noiseLocal must be declared first.
    expect(SD_SHELL).toContain('noiseLocal(p - drift, gBodyAnchor)');
    expect(HELPERS.indexOf(NOISE_LOCAL)).toBeLessThan(HELPERS.indexOf(SD_SHELL));
    const calcNormal = HELPERS.find(h => declaredName(h) === 'calcNormal')!;
    expect(calcNormal).toContain('volumeClip: vec4<f32>');
    // Every calcNormal mapBody tap (4 of them) carries it — and the perfCfg
    // and woundBound pass-throughs behind it (perf round 2 task 3, close-up
    // wound-cull task).
    expect((calcNormal.match(/volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg\)/g) ?? []).length).toBe(4);
  });
});
