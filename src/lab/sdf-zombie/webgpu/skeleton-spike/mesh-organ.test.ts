// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-organ.test.ts
import { describe, it, expect } from 'vitest';
import {
  MESH_ORGAN_SHADE_WGSL, MESH_ORGAN_SURFACE_WGSL, MESH_ORGAN_WET_WGSL, ORGAN_LOOKS, ORGAN_LOOK_DEFAULT, ORGAN_TISSUE_BASE,
  ORGAN_WASH, organBaseAlbedo, organOcclusion, organStained,
} from './mesh-organ';
import { FLESH_PRESETS } from '../../material';

const ZOMBIE_SURFACE = Object.values(FLESH_PRESETS)[0]!;

describe('organ mesh material (organs as mesh)', () => {
  it('organAmp 1 is the march organColor exactly; 0 is the tissue base; out of range clamps', () => {
    const c = ZOMBIE_SURFACE.organColor;
    expect(organBaseAlbedo(c, 1)).toEqual([...c]);
    expect(organBaseAlbedo(c, 0)).toEqual([...ORGAN_TISSUE_BASE]);
    expect(organBaseAlbedo(c, 7)).toEqual([...c]);
    const half = organBaseAlbedo(c, 0.5);
    for (let k = 0; k < 3; k++) expect(half[k]).toBeCloseTo((c[k]! + ORGAN_TISSUE_BASE[k]!) / 2, 12);
  });

  it('the stain leaves a crater centre alone and pulls the rim toward the deep colour', () => {
    const a = organBaseAlbedo(ZOMBIE_SURFACE.organColor, 1), deep = ZOMBIE_SURFACE.deepColor;
    expect(organStained(a, deep, 0.55, 1)).toEqual(a);
    expect(organStained(a, deep, 0, 0)).toEqual(a);
    const rim = organStained(a, deep, 1, 0);
    for (let k = 0; k < 3; k++) expect(rim[k]).toBeCloseTo(deep[k]! * 0.6, 12);
  });

  it('every look is finite and in range, and the default is one of them', () => {
    expect(Object.keys(ORGAN_LOOKS)).toContain(ORGAN_LOOK_DEFAULT);
    for (const look of Object.values(ORGAN_LOOKS)) {
      for (const v of [...look.cfg, ...look.gloss, ...look.occ]) expect(Number.isFinite(v)).toBe(true);
      for (const v of [...look.cfg.slice(0, 3), look.cfg[3], ...look.occ.slice(0, 3)]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      expect(look.gloss[2]).toBeGreaterThan(0); expect(look.gloss[2]).toBeLessThanOrEqual(1);
      expect(look.occ[3]).toBeGreaterThanOrEqual(1); expect(look.occ[3]).toBeLessThan(4);
    }
    // The match look adds nothing of its own: flat colour.
    expect(ORGAN_LOOKS.match.cfg[0]).toBe(0);
    expect(ORGAN_LOOKS.match.cfg[1]).toBe(0);
  });

  it('each WGSL string is exactly one fn (the wgslFn rule), and the surface mirrors the CPU terms', () => {
    for (const src of [MESH_ORGAN_SURFACE_WGSL, MESH_ORGAN_WET_WGSL, MESH_ORGAN_SHADE_WGSL]) {
      expect(src.match(/\bfn\s+\w+\s*\(/g)?.length).toBe(1);
      expect(src.startsWith('fn ')).toBe(true);
    }
    // The base mix is weighted by organAmp itself (tint.w), as the march's mix(albedo, organColor, organAmp) is.
    expect(MESH_ORGAN_SURFACE_WGSL).toContain('tint.xyz, clamp(tint.w, 0.0, 1.0))');
    expect(MESH_ORGAN_SURFACE_WGSL).toContain('albedo = mix(albedo, deepColor * 0.6, cfg.y * (1.0 - expo));');
    expect(MESH_ORGAN_SURFACE_WGSL).toContain('return vec4<f32>(albedo, mix(cfg.z, 1.0, expo));');
    // Craters are read with textureLoad (no derivative, legal anywhere), in world space; variation is local.
    expect(MESH_ORGAN_SURFACE_WGSL).toContain('textureLoad(woundTex');
    expect(MESH_ORGAN_SURFACE_WGSL).not.toMatch(/boneNoise\(pWorld/);
  });

  it('the wash multiplies ORGAN_WASH into the albedo by cfg.w', () => {
    const c = ZOMBIE_SURFACE.organColor;
    const washed = organBaseAlbedo(c, 1, 1);
    for (let k = 0; k < 3; k++) expect(washed[k]).toBeCloseTo(c[k]! * ORGAN_WASH[k]!, 12);
    expect(organBaseAlbedo(c, 1, 0)).toEqual([...c]);
    expect(MESH_ORGAN_SURFACE_WGSL).toContain('clamp(cfg.w, 0.0, 1.0));');
  });

  it('the cavity occlusion: every light but the beam is multiplied by occ; all beam is 1', () => {
    const occ = ORGAN_LOOKS.match.occ;
    expect(organOcclusion([occ[0], occ[1], occ[2]], 0)).toEqual([occ[0], occ[1], occ[2]]);
    expect(organOcclusion([occ[0], occ[1], occ[2]], 1)).toEqual([1, 1, 1]);
    expect(organOcclusion([0.4, 0.2, 0.1], 0.5)).toEqual([0.7, 0.6, 0.55].map(v => expect.closeTo(v, 12)));
    // The shade is boneShade's colour times that mix, with the beam's share from bodyLights' own luminances, called
    // under the per-draw condition boneShade uses (never per fragment: body-lights.wgsl.ts).
    expect(organOcclusion([0.4, 0.2, 0.1], 1, 1.9)).toEqual([1.9, 1.9, 1.9]);
    expect(organOcclusion([0.4, 0.2, 0.1], 0, 1.9)).toEqual([0.4, 0.2, 0.1]);
    expect(MESH_ORGAN_SHADE_WGSL).toContain('return lit * mix(occ.xyz, vec3<f32>(occ.w), clamp(share, 0.0, 1.0));');
    expect(MESH_ORGAN_SHADE_WGSL).toContain('share = bl.lumBeam / max(bl.lumAll + dot(ambient * fill, lumW), 1e-5);');
    expect(MESH_ORGAN_SHADE_WGSL).toContain('if (listOn > 0.5 && picks.x > -1.5) {');
    expect(MESH_ORGAN_SHADE_WGSL.match(/bodyLights\(/g)?.length).toBe(1);
  });
});
