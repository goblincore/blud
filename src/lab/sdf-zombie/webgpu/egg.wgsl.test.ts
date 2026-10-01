// src/lab/sdf-zombie/webgpu/egg.wgsl.test.ts

import { describe, expect, it } from 'vitest';
import { EGG_GAUSS, EGG_RAY, EGG_SHADE, EGG_SPOTS, EGG_VEINS } from './egg.wgsl';
import { EGG, FIGURE } from './egg-look';

describe('egg.wgsl', () => {
  it('each string declares exactly one fn', () => {
    for (const s of [EGG_RAY, EGG_GAUSS, EGG_SPOTS, EGG_VEINS, EGG_SHADE]) {
      expect(s.trim().startsWith('fn ')).toBe(true);
      expect(s.match(/^fn /gm)).toHaveLength(1);
    }
  });
  it('is built from the twin\'s tables', () => {
    expect(EGG_SHADE).toContain(`array<vec3<f32>, ${FIGURE.length}>`);
    expect(EGG_SHADE).toContain(`j < ${FIGURE.length}`);
    expect(EGG_SPOTS).toContain(`i < ${EGG.spots}`);
    for (const b of FIGURE) expect(EGG_SHADE).toContain(`vec3<f32>(${b.sc[0]}`);
  });
  it('the golden angle matches the twin', () => {
    expect(EGG_SPOTS).toContain(String(Math.PI * (3 - Math.sqrt(5))).slice(0, 7));
  });
  it('writes premultiplied colour and alpha = 1 - transmittance', () => {
    expect(EGG_SHADE).toContain('return vec4<f32>(col, 1.0 - T);');
  });
});
