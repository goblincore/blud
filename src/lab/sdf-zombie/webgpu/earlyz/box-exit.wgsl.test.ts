import { describe, it, expect } from 'vitest';
import { EARLYZ_BOX_EXIT_WGSL, boxExitT } from './box-exit.wgsl';
import { RAY_WINDOW_BLOCK } from '../march/body/blocks/setup/ray-window.wgsl';

describe('analytic box exit (spec D4)', () => {
  it('exit along the axis is the far face', () => {
    expect(boxExitT([0, 0, 0], [0, 0, -1], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(4.5, 6);
  });
  it('camera inside the box exits forward (never clamped if far enough)', () => {
    // Camera at box centre [0,0,-4], ray aimed at -z, exits at near face
    // Box centre [0, 0, -4], halfExt [0.5, 1, 0.5]; z in [-4.5, -3.5]
    // rel = 0, invRd[z] = -1, lo.z = 0.5, hi.z = -0.5, max = 0.5
    expect(boxExitT([0, 0, -4], [0, 0, -1], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(0.5, 6);
  });
  it('box entirely behind camera returns clamped minimum distance', () => {
    // Box centre at [0, 0, +4] (behind camera at origin), ray aimed at -z
    // Box z in [3.5, 4.5]; camera at 0, ray direction -z
    // rel.z = 4 - 0 = 4; lo.z = (4 - 0.5) / (-1) = -3.5, hi.z = (4 + 0.5) / (-1) = -4.5
    // max(lo.z, hi.z) = -3.5, tExit = -3.5, clamped to 1e-4
    expect(boxExitT([0, 0, 0], [0, 0, -1], [0, 0, 4], [0.5, 1, 0.5])).toBeCloseTo(1e-4, 6);
  });
  it('x-limited oblique ray (z in [-4.5, -3.5], x in [-0.5, 0.5])', () => {
    const d = Math.SQRT1_2;
    // Camera [0, 0, -4] (at box centre), ray (d, 0, -d)
    // rel = [0, 0, 0], invRd = [1/d, inf, -1/d]
    // x: lo.x = -0.5/d, hi.x = 0.5/d, max = 0.5/d
    // z: lo.z = 0.5*(-1/d) = -0.5/d, hi.z = -0.5*(-1/d) = 0.5/d, max = 0.5/d
    // tExit = min(0.5/d, 0.5/d) = 0.5/d
    expect(boxExitT([0, 0, -4], [d, 0, -d], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(0.5 / d, 6);
  });
  it('off-centre axis-aligned ray from outside box toward -z', () => {
    // Camera [0, 0, -5], ray [0, 0, 1], box centre [0, 0, -4], halfExt [0.5, 1, 0.5]
    // Box z in [-4.5, -3.5]
    // rel.z = -4 - (-5) = 1; lo.z = (1 - 0.5) * 1 = 0.5, hi.z = (1 + 0.5) * 1 = 1.5
    // max(lo.z, hi.z) = 1.5
    expect(boxExitT([0, 0, -5], [0, 0, 1], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(1.5, 6);
  });
  it('asymmetric oblique ray: x-limited exit', () => {
    const d = Math.SQRT1_2;
    // Camera [-0.5, 0, -5], ray (d, 0, 1), box centre [0, 0, -4], halfExt [0.5, 1, 0.5]
    // Box x in [-0.5, 0.5], z in [-4.5, -3.5]
    // rel = [0.5, 0, 1], invRd = [1/d, 1e9, 1]
    // x: lo = (0.5 - 0.5)/(d) = 0, hi = (0.5 + 0.5)/(d) = sqrt(2), max = sqrt(2)
    // z: lo = (1 - 0.5)/1 = 0.5, hi = (1 + 0.5)/1 = 1.5, max = 1.5
    // tExit = min(sqrt(2), 1.5) = sqrt(2) ≈ 1.414 (x-limited)
    expect(boxExitT([-0.5, 0, -5], [d, 0, 1], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(Math.SQRT2, 6);
  });
  it('the WGSL uses the same slab algebra and parallel-axis guard as ray-window', () => {
    expect(RAY_WINDOW_BLOCK).toContain('let invRd = select(vec3<f32>(1e9), 1.0 / rd, abs(rd) > vec3<f32>(1e-8));');
    expect(EARLYZ_BOX_EXIT_WGSL).toContain('let invRd = select(vec3<f32>(1e9), 1.0 / rd, abs(rd) > vec3<f32>(1e-8));');
    expect(EARLYZ_BOX_EXIT_WGSL).toContain('let tExit = min(min(max(lo.x, hi.x), max(lo.y, hi.y)), max(lo.z, hi.z));');
    expect(EARLYZ_BOX_EXIT_WGSL).toMatch(/^fn earlyzBoxExitPoint\(camPos: vec3<f32>, rd: vec3<f32>, centre: vec3<f32>, halfExt: vec3<f32>\) -> vec3<f32> \{/);
  });

  // Randomized fuzz test: 2000 cases comparing boxExitT against independent slab reference
  it('randomized: 2000 rays outside box aimed at interior match independent slab reference', () => {
    const seed = 12345;
    let rng = seed;
    const lcg = () => {
      rng = (rng * 1103515245 + 12345) % (1 << 31);
      return (rng >>> 0) / (1 << 31);
    };

    const boxCentre = [0, 0, -10];
    const boxHalfExt = [2, 3, 5];

    for (let trial = 0; trial < 2000; trial++) {
      // Random ray origin outside the box
      const camPos = [
        boxCentre[0]! + (lcg() - 0.5) * 20,
        boxCentre[1]! + (lcg() - 0.5) * 20,
        boxCentre[2]! + (lcg() - 0.5) * 20,
      ];

      // Random point inside the box
      const target = [
        boxCentre[0]! + (lcg() - 0.5) * 2 * boxHalfExt[0]!,
        boxCentre[1]! + (lcg() - 0.5) * 2 * boxHalfExt[1]!,
        boxCentre[2]! + (lcg() - 0.5) * 2 * boxHalfExt[2]!,
      ];

      // Normalize ray direction
      const dx = target[0]! - camPos[0]!;
      const dy = target[1]! - camPos[1]!;
      const dz = target[2]! - camPos[2]!;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rd = [dx / len, dy / len, dz / len];

      // Test: boxExitT result
      const result = boxExitT(camPos, rd, boxCentre, boxHalfExt);

      // Reference: independent slab computation (same algebra, no shared code)
      let tExit = Infinity;
      const rel = [boxCentre[0]! - camPos[0]!, boxCentre[1]! - camPos[1]!, boxCentre[2]! - camPos[2]!];
      for (let i = 0; i < 3; i++) {
        let t_lo_slab: number, t_hi_slab: number;
        if (Math.abs(rd[i]!) > 1e-8) {
          t_lo_slab = (rel[i]! - boxHalfExt[i]!) / rd[i]!;
          t_hi_slab = (rel[i]! + boxHalfExt[i]!) / rd[i]!;
        } else {
          // Parallel to slab; check if camera is inside bounds on this axis
          if (Math.abs(rel[i]!) > boxHalfExt[i]!) {
            // Camera is outside on this axis; no intersection
            tExit = -Infinity;
            break;
          }
          t_lo_slab = -Infinity;
          t_hi_slab = Infinity;
        }
        const t_exit_axis = Math.max(t_lo_slab, t_hi_slab);
        tExit = Math.min(tExit, t_exit_axis);
      }
      const refResult = Math.max(tExit, 1e-4);

      expect(result).toBeCloseTo(refResult, 8);
    }
  });
});
