// src/lab/sdf-zombie/webgpu/zap-halo.wgsl.test.ts
import { describe, expect, it } from 'vitest';
import { ZAP_HALO, zapHaloAmount } from './zap-halo.wgsl';

describe("the zap halo's strength", () => {
  const [near, far] = ZAP_HALO.nearM;

  it('is full from nearM[1] out and nearFloor of that up close, falling steadily between', () => {
    expect(zapHaloAmount(false, far)).toBe(1);
    expect(zapHaloAmount(false, 40)).toBe(1);
    expect(zapHaloAmount(false, near)).toBeCloseTo(ZAP_HALO.nearFloor, 9);
    expect(zapHaloAmount(false, 0)).toBeCloseTo(ZAP_HALO.nearFloor, 9);
    let last = zapHaloAmount(false, near);
    for (let d = near + 0.1; d <= far; d += 0.1) { const a = zapHaloAmount(false, d); expect(a).toBeGreaterThan(last); last = a; }
  });

  it('the negative frame keeps its share at every distance', () => {
    for (const d of [0, near, 2, far, 10]) expect(zapHaloAmount(true, d)).toBeCloseTo(zapHaloAmount(false, d) * ZAP_HALO.negative, 9);
  });
});
