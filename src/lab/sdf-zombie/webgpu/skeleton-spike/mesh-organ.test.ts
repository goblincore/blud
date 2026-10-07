// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-organ.test.ts
import { describe, it, expect } from 'vitest';
import {
  MESH_ORGAN_DETAIL_WGSL, MESH_ORGAN_HEIGHT_WGSL, MESH_ORGAN_SHADE_WGSL, MESH_ORGAN_SURFACE_WGSL, MESH_ORGAN_WET_WGSL,
  ORGAN_DETAIL, ORGAN_DETAIL_MIN_PX, ORGAN_DETAIL_SETS, ORGAN_LOOKS, ORGAN_LOOK_DEFAULT, ORGAN_RELIEF, ORGAN_TISSUE_BASE,
  ORGAN_WASH, ORGAN_WRINKLE_STRETCH, organBaseAlbedo, organDetailFade, organGroove, organOcclusion, organStained,
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
      expect(look.gloss[3]).toBeGreaterThanOrEqual(0);
    }
    // The match look adds no pattern of its own: flat colour, the full measured wash.
    expect(ORGAN_LOOKS.match.cfg[0]).toBe(0);
    expect(ORGAN_LOOKS.match.cfg[1]).toBe(0);
    expect(ORGAN_LOOKS.match.cfg[3]).toBe(1);
  });

  it('each WGSL string is exactly one fn (the wgslFn rule), and the surface mirrors the CPU terms', () => {
    for (const src of [MESH_ORGAN_SURFACE_WGSL, MESH_ORGAN_WET_WGSL, MESH_ORGAN_SHADE_WGSL, MESH_ORGAN_HEIGHT_WGSL, MESH_ORGAN_DETAIL_WGSL]) {
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
    // ... and the whole of it by the cavity shade (a crease, a groove's floor): the glint dies there too.
    expect(MESH_ORGAN_SHADE_WGSL).toContain('return (lit * mix(occ.xyz, vec3<f32>(occ.w), s) + glint) * cav;');
    // The wet glint: the beam's alone (its own luminance, so none with the torch off), gained by gloss.w (0 = none).
    expect(MESH_ORGAN_SHADE_WGSL).toContain('glint = vec3<f32>(bl.lumBeam * pow(max(dot(n, V), 0.0), 90.0) * gloss.w);');
    expect(MESH_ORGAN_SHADE_WGSL).toContain('share = bl.lumBeam / max(bl.lumAll + dot(ambient * fill, lumW), 1e-5);');
    expect(MESH_ORGAN_SHADE_WGSL).toContain('if (listOn > 0.5 && picks.x > -1.5) {');
    expect(MESH_ORGAN_SHADE_WGSL.match(/bodyLights\(/g)?.length).toBe(1);
  });
});

describe('organ surface detail as shading (organs, low-poly, 2026-10-07)', () => {
  it('every look ships the same detail; its numbers are real sizes', () => {
    for (const look of Object.values(ORGAN_LOOKS)) { expect(look.detail).toBe(ORGAN_DETAIL); expect(look.relief).toBe(ORGAN_RELIEF); }
    for (const set of Object.values(ORGAN_DETAIL_SETS)) {
      const [haustra, wrinkle, crease, period] = set.detail, [wander, floor, power, size] = set.relief;
      // Depths in metres, well under the tube's 2.2 cm radius; the period is about one radius.
      expect(haustra).toBeGreaterThanOrEqual(0); expect(haustra).toBeLessThan(0.006);
      expect(wrinkle).toBeGreaterThanOrEqual(0); expect(wrinkle).toBeLessThanOrEqual(haustra);
      expect(crease).toBeGreaterThanOrEqual(0); expect(crease).toBeLessThanOrEqual(1);
      expect(period).toBeGreaterThan(0.012); expect(period).toBeLessThan(0.04);
      // The groove's line wanders less than half a period (past that neighbours cross), and its floor is never black.
      expect(wander).toBeGreaterThanOrEqual(0); expect(wander).toBeLessThan(0.5);
      expect(floor).toBeGreaterThanOrEqual(0); expect(floor).toBeLessThan(1);
      expect(power).toBeGreaterThanOrEqual(2);
      expect(size).toBeGreaterThan(0.001); expect(size).toBeLessThan(period);
    }
    expect(ORGAN_DETAIL_SETS.ships.detail).toBe(ORGAN_DETAIL);
    expect(ORGAN_DETAIL_SETS.plain.detail.slice(0, 3)).toEqual([0, 0, 0]);
    expect(ORGAN_DETAIL[0]).toBeGreaterThan(0);
  });

  it('the groove is 1 on its line, 0 midway, one a period, and narrow', () => {
    expect(organGroove(0)).toBe(1);
    expect(organGroove(3)).toBeCloseTo(1, 12);
    expect(organGroove(0.5)).toBeCloseTo(0, 12);
    expect(organGroove(0.37)).toBeCloseTo(organGroove(1.37), 12);
    expect(organGroove(0.37)).toBeCloseTo(organGroove(-0.37), 12);
    // Narrow: under half its depth a fifth of a period from the line (a crease between bulges, not a wave).
    expect(organGroove(0.2)).toBeLessThan(0.5);
    // A higher power is a narrower groove.
    expect(organGroove(0.2, 8)).toBeLessThan(organGroove(0.2, 4));
    // The WGSL takes the same power, as half of it on cos^2 (so the base is never negative).
    expect(MESH_ORGAN_HEIGHT_WGSL).toContain('let groove = pow(c * c, relief.z * 0.5);');
    expect(MESH_ORGAN_HEIGHT_WGSL).toContain('return -detail.x * groove + detail.y * wr;');
  });

  it('the height is a function of the tube coordinate alone: rings across the axis, in q.x', () => {
    expect(MESH_ORGAN_HEIGHT_WGSL.startsWith('fn meshOrganHeight(q: vec3<f32>, detail: vec4<f32>, relief: vec4<f32>) -> f32 {')).toBe(true);
    expect(MESH_ORGAN_HEIGHT_WGSL).toContain('q.x / max(detail.w, 1e-4) + wob * relief.x');
    // The wrinkle noise's cell is relief.w across the tube and ORGAN_WRINKLE_STRETCH times that along it.
    expect(MESH_ORGAN_HEIGHT_WGSL).toContain('let cell = 1.0 / max(relief.w, 1e-4);');
    expect(MESH_ORGAN_HEIGHT_WGSL).toContain(`vec3<f32>(cell / ${ORGAN_WRINKLE_STRETCH.toFixed(1)}, cell, cell)`);
    expect(MESH_ORGAN_HEIGHT_WGSL).not.toMatch(/dpd[xy]|pWorld/);
  });

  it('a detail fades out as it nears ORGAN_DETAIL_MIN_PX pixels', () => {
    const period = ORGAN_DETAIL[3];
    expect(organDetailFade(period, period / ORGAN_DETAIL_MIN_PX)).toBe(0);
    expect(organDetailFade(period, period / (2 * ORGAN_DETAIL_MIN_PX))).toBe(1);
    expect(organDetailFade(period, period / (1.5 * ORGAN_DETAIL_MIN_PX))).toBeCloseTo(0.5, 12);
    expect(organDetailFade(period, 1)).toBe(0);
    // No footprint (a surface-nets organ: no tube coordinate): no detail, as the WGSL's `on`.
    expect(organDetailFade(period, 0)).toBe(0);
    expect(MESH_ORGAN_DETAIL_WGSL).toContain(`let px = 1.0 / (max(foot, 1e-9) * ${ORGAN_DETAIL_MIN_PX.toFixed(1)});`);
    expect(MESH_ORGAN_DETAIL_WGSL).toContain('let fadeH = on * clamp(detail.w * px - 1.0, 0.0, 1.0);');
  });

  it('the detail normal: derivatives first and unconditionally, no branch, the plain normal for a mesh with no tube coordinate', () => {
    const body = MESH_ORGAN_DETAIL_WGSL;
    // Derivatives may only be taken in uniform control flow: the four are the first statements, and the fn has no
    // branch at all (select and step instead).
    const lines = body.split('\n').slice(1, 5).map(l => l.trim());
    expect(lines).toEqual(['let dqx = dpdx(tube.xyz);', 'let dqy = dpdy(tube.xyz);', 'let dpx = dpdx(pWorld);', 'let dpy = dpdy(pWorld);']);
    expect(body).not.toMatch(/\bif\b|\bfor\b|\bloop\b|\bswitch\b/);
    expect(body.match(/dpd[xy]\(/g)?.length).toBe(4);
    // No footprint (the attribute is all zero): both fades are 0, so the height is flat and the normal is n.
    expect(body).toContain('let on = step(1e-9, foot);');
    expect(body).toContain('let nn = select(n, v / max(l, 1e-30), l > 1e-20);');
    // Mikkelsen's surface gradient from the two per-pixel height changes.
    expect(body).toContain('let v = abs(det) * n - sign(det) * (dhx * r1 + dhy * r2);');
    // The cavity shade: the baked crease times the groove's floor.
    expect(body).toContain('let crease = mix(1.0 - detail.z, 1.0, smoothstep(0.0, 1.0, tube.w));');
    expect(body).toContain('return vec4<f32>(nn, crease * (1.0 - relief.y * floorShade));');
    expect(body.match(/meshOrganHeight\(/g)?.length).toBe(4);
  });
});
