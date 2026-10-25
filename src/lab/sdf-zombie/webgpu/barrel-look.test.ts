import { describe, expect, it } from 'vitest';
import { BARREL } from './barrel-state';
import { BARREL_LOOK, barrelAlbedo, barrelProfile, barrelYaw, scorchAlpha, stubProfile, stubTear } from './barrel-look';

const R = BARREL.radiusM, H = BARREL.heightM;
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

describe('barrelProfile', () => {
  const p = barrelProfile();
  it('runs from the bottom centre to the recessed lid at the axis', () => {
    expect(p[0]).toEqual([0, 0]);
    const last = p[p.length - 1]!;
    expect(last[0]).toBe(0);
    expect(last[1]).toBeCloseTo(H - 0.01, 9);
  });
  it('never stands more than 13 mm proud of the shell', () => {
    for (const [r] of p) expect(r).toBeLessThanOrEqual(R + 0.013 + 1e-12);
  });
  it('has two hoop bulges near h/3 and 2h/3', () => {
    const hoops = p.filter(([r]) => near(r, R + 0.012));
    for (const yc of [H / 3, (2 * H) / 3]) expect(hoops.some(([, y]) => Math.abs(y - yc) < 0.03)).toBe(true);
    expect(hoops.every(([, y]) => Math.abs(y - H / 3) < 0.03 || Math.abs(y - (2 * H) / 3) < 0.03)).toBe(true);
  });
  it('has a rim lip at the bottom and at the top', () => {
    const lips = p.filter(([r]) => near(r, R + 0.008));
    expect(lips.some(([, y]) => y < 0.05)).toBe(true);
    expect(lips.some(([, y]) => y > H - 0.05)).toBe(true);
  });
  it('rises monotonically except the lid recess at the top', () => {
    const topI = p.findIndex(([, y]) => y >= H);
    expect(topI).toBeGreaterThan(0);
    for (let i = 1; i <= topI; i++) expect(p[i]![1]).toBeGreaterThanOrEqual(p[i - 1]![1]);
    for (let i = topI + 1; i < p.length; i++) expect(p[i]![1]).toBeGreaterThanOrEqual(H - 0.01 - 1e-12);
  });
});

describe('barrelAlbedo', () => {
  const W = 256, Hp = 256;
  const a = barrelAlbedo(W, Hp, 7);
  const px = (x: number, y: number) => { const i = (y * W + x) * 4; return [a[i]!, a[i + 1]!, a[i + 2]!] as const; };
  const rowsIn = (v0: number, v1: number) => {
    const ys: number[] = [];
    for (let y = 0; y < Hp; y++) { const v = (y + 0.5) / Hp; if (v >= v0 && v <= v1) ys.push(y); }
    return ys;
  };
  const mean = (v0: number, v1: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const y of rowsIn(v0, v1)) for (let x = 0; x < W; x++) { const [pr, pg, pb] = px(x, y); r += pr; g += pg; b += pb; n++; }
    return { r: r / n, g: g / n, b: b / n, luma: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n };
  };

  it('is deterministic RGBA of the asked size', () => {
    expect(a.length).toBe(W * Hp * 4);
    expect(barrelAlbedo(W, Hp, 7)).toEqual(a);
    expect(barrelAlbedo(W, Hp, 8)).not.toEqual(a);
  });
  it('the hazard band holds yellow and near-black stripes', () => {
    let yellow = 0, black = 0;
    for (const y of rowsIn(0.44, 0.56)) for (let x = 0; x < W; x++) {
      const [r, g, b] = px(x, y);
      if (r > 150 && g > 120 && b < 80) yellow++;
      if (r + g + b < 90) black++;
    }
    expect(yellow).toBeGreaterThan(500);
    expect(black).toBeGreaterThan(500);
  });
  it('the upper drum is toxic green', () => {
    const m = mean(0.6, 0.9);
    expect(m.g).toBeGreaterThan(1.4 * m.r);
  });
  it('the foot is darker with rust and grime', () => {
    expect(mean(0, 0.1).luma).toBeLessThan(0.7 * mean(0.6, 0.9).luma);
  });
  it('wraps round the drum without a seam', () => {
    // The first and last columns are neighbours on the drum: their mean difference is like any two neighbours'.
    let seam = 0, inner = 0;
    for (let y = 0; y < Hp; y++) {
      const v = (y + 0.5) / Hp;
      if (v >= 0.44 && v <= 0.56) continue; // the stripes cross the seam on a 45° phase, by design
      seam += Math.abs(px(0, y)[1] - px(W - 1, y)[1]);
      inner += Math.abs(px(W / 2, y)[1] - px(W / 2 - 1, y)[1]);
    }
    expect(seam).toBeLessThan(inner * 2);
  });
});

describe('scorchAlpha', () => {
  const n = 64, s = scorchAlpha(n);
  it('is opaque at the centre, clear at the corners, deterministic', () => {
    expect(s.length).toBe(n * n);
    for (const [x, y] of [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]] as const) expect(s[y * n + x]).toBe(0);
    expect(s[(n / 2) * n + n / 2]).toBeGreaterThan(200);
    expect(scorchAlpha(n)).toEqual(s);
  });
});

describe('stubProfile and stubTear', () => {
  it('keeps the drum bottom up to the stub height, then a torn top within ±tear', () => {
    const full = barrelProfile(), stub = stubProfile(3);
    const top = BARREL_LOOK.stubHeightM, tear = BARREL_LOOK.tearM;
    const keep = full.filter(([, y]) => y <= top - tear);
    expect(stub.slice(0, keep.length)).toEqual(keep);
    const torn = stub.slice(keep.length);
    expect(torn.length).toBeGreaterThan(2);
    for (const [r, y] of torn) {
      expect(r).toBeLessThanOrEqual(R + 1e-12);
      expect(y).toBeGreaterThanOrEqual(top - tear);
      expect(y).toBeLessThanOrEqual(top + tear);
    }
    expect(torn[torn.length - 1]![0]).toBe(0);
    expect(stubProfile(3)).toEqual(stub);
    expect(stubProfile(4)).not.toEqual(stub);
  });
  it('the rim tear is seeded and bounded', () => {
    const t = stubTear(5, 28);
    expect(t).toHaveLength(28);
    for (const d of t) expect(Math.abs(d)).toBeLessThanOrEqual(BARREL_LOOK.tearM);
    expect(stubTear(5, 28)).toEqual(t);
    expect(new Set(t.map(d => d.toFixed(4))).size).toBeGreaterThan(10);
  });
});

describe('barrelYaw', () => {
  it('is a fixed angle in [0, 2π) per id', () => {
    const a = barrelYaw('barrel-3');
    expect(a).toBe(barrelYaw('barrel-3'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(Math.PI * 2);
    expect(barrelYaw('barrel-4')).not.toBe(a);
  });
});
