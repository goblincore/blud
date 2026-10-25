// src/lab/sdf-zombie/kit-eye-texture.test.ts
import { describe, it, expect } from 'vitest';
import { eyeTextures, stalkTextures } from './kit-eye-texture';
import { stalkTubeLayout, stalkTubePositions } from './kit-eye';
import type { Vec3 } from './types';

const px = (a: Uint8ClampedArray, w: number, x: number, y: number) => [a[(y * w + x) * 4]!, a[(y * w + x) * 4 + 1]!, a[(y * w + x) * 4 + 2]!];

describe('kit-eye-texture', () => {
  const W = 256, H = 128, IRIS: Vec3 = [1, 0.55, 0.02];
  const e = eyeTextures(W, H, IRIS);

  it('paints the iris at the front pole, the slit through it, the torn back red, and glows only the iris', () => {
    // just off the front pole, away from the slit (sx = -cos(phi) sin(theta): phi = 0 is x < 0, the slit is |x| small)
    const iris = px(e.albedo, W, 0, 8);
    expect(iris[0]).toBeGreaterThan(180); expect(iris[1]).toBeGreaterThan(70); expect(iris[2]).toBeLessThan(60);
    expect(px(e.glow!, W, 0, 8)[0]).toBeGreaterThan(100);
    // the slit: phi = pi/2 puts the point on the face's vertical (x = 0)
    expect(px(e.albedo, W, W / 4, 10)[0]).toBeLessThan(20);
    expect(px(e.glow!, W, W / 4, 10)[0]).toBe(0);
    // the back pole: dark raw red, no glow
    const back = px(e.albedo, W, 10, H - 2);
    expect(back[0]).toBeGreaterThan(back[1]! * 4); expect(back[0]).toBeLessThan(140);
    expect(px(e.glow!, W, 10, H - 2)[0]).toBe(0);
  });

  it('has veins in the sclera: some texels far redder than the cream around them', () => {
    let red = 0, cream = 0;
    for (let y = Math.floor(H * 60 / 180); y < Math.floor(H * 100 / 180); y++) for (let x = 0; x < W; x++) {
      const [r, g] = px(e.albedo, W, x, y);
      if (r! > 100 && g! < r! * 0.55) red++; else if (g! > 120) cream++;
    }
    expect(red).toBeGreaterThan(60); expect(cream).toBeGreaterThan(red);
  });

  it('makes a normal map that is not flat (the veins and fibres are raised)', () => {
    let off = 0;
    for (let i = 0; i < e.normal.length; i += 4) if (Math.abs(e.normal[i]! - 128) > 10) off++;
    expect(off).toBeGreaterThan(W * H * 0.05);
  });

  it('soaks the stalk in blood toward the eye: the eye end darker and redder than the middle', () => {
    const s = stalkTextures(128, 32);
    const mid = px(s.albedo, 128, 50, 5), end = px(s.albedo, 128, 125, 5);
    expect(end[1]).toBeLessThan(mid[1]!);
    expect(mid[0]).toBeGreaterThan(150);   // pink, not grey
  });
});

describe('stalk tube', () => {
  it('lays a tube through the nodes, tapering, with the cuff swelling where asked', () => {
    const segs = 20, radial = 8;
    const { uv, index } = stalkTubeLayout(segs, radial);
    expect(uv.length).toBe((segs + 1) * (radial + 1) * 2);
    expect(index.length).toBe(segs * radial * 6);
    const nodes: Vec3[] = [0, 1, 2, 3, 4, 5].map(i => [0, -i * 0.04, 0]);
    const pos = stalkTubePositions(nodes, 0.03, 0.02, segs, radial, 0.5);
    const ringR = (i: number) => {
      let r = 0;
      for (let j = 0; j < radial; j++) { const k = (i * (radial + 1) + j) * 3; r += Math.hypot(pos[k]!, pos[k + 2]!); }
      return r / radial;
    };
    expect(ringR(0)).toBeCloseTo(0.03, 2);
    expect(ringR(segs / 2)).toBeGreaterThan(ringR(2) * 1.5);    // the cuff at t 0.5
    // the ring centres follow the rope down
    expect(pos[(segs * (radial + 1)) * 3 + 1]).toBeCloseTo(-0.2, 2);
  });
});
