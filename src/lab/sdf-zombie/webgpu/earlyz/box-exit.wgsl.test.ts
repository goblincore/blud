import { describe, it, expect } from 'vitest';
import { EARLYZ_BOX_EXIT_WGSL, boxExitT } from './box-exit.wgsl';
import { RAY_WINDOW_BLOCK } from '../march/body/blocks/setup/ray-window.wgsl';

describe('analytic box exit (spec D4)', () => {
  it('exit along the axis is the far face', () => {
    expect(boxExitT([0, 0, 0], [0, 0, -1], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(4.5, 6);
  });
  it('an oblique ray leaves through the nearest far slab', () => {
    const d = Math.SQRT1_2;
    // box x in [-0.5, 0.5], z in [-4.5, -3.5]; ray (d, 0, -d): x leaves at t = 0.5/d
    expect(boxExitT([0, 0, -4], [d, 0, -d], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(0.5 / d, 6);
  });
  it('a camera inside the box still exits forward (never negative)', () => {
    expect(boxExitT([0, 0, -4], [0, 0, -1], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(0.5, 6);
  });
  it('the WGSL uses the same slab algebra and parallel-axis guard as ray-window', () => {
    expect(RAY_WINDOW_BLOCK).toContain('let invRd = select(vec3<f32>(1e9), 1.0 / rd, abs(rd) > vec3<f32>(1e-8));');
    expect(EARLYZ_BOX_EXIT_WGSL).toContain('let invRd = select(vec3<f32>(1e9), 1.0 / rd, abs(rd) > vec3<f32>(1e-8));');
    expect(EARLYZ_BOX_EXIT_WGSL).toContain('let tExit = min(min(max(lo.x, hi.x), max(lo.y, hi.y)), max(lo.z, hi.z));');
    expect(EARLYZ_BOX_EXIT_WGSL).toMatch(/^fn earlyzBoxExitPoint\(camPos: vec3<f32>, rd: vec3<f32>, centre: vec3<f32>, halfExt: vec3<f32>\) -> vec3<f32> \{/);
  });
});
