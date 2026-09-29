import { describe, expect, it } from 'vitest';
import { TUBE_BEAM_WGSL } from './tube-beam.wgsl';

describe('tube-beam.wgsl', () => {
  it('declares one fn and returns black for a dark lamp', () => {
    expect(TUBE_BEAM_WGSL.trim().startsWith('fn tubeBeam(')).toBe(true);
    expect(TUBE_BEAM_WGSL.match(/\bfn /g)).toHaveLength(1);
    expect(TUBE_BEAM_WGSL).toContain('if (cfg.x <= 0.0) { return vec3<f32>(0.0); }');
  });
});
