import { describe, expect, it } from 'vitest';
import { BARREL } from './barrel-state';
import {
  BARREL_LOOK, BARREL_ROUGH, barrelAlbedo, barrelDents, barrelProfile, barrelYaw, dentDepth, lidAlbedo, scorchAlpha,
  scorchFit, scorchMask, stubBend, stubInnerStart, stubProfile, stubTear, stubWarp,
} from './barrel-look';

const R = BARREL.radiusM, H = BARREL.heightM;
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

describe('barrelProfile', () => {
  const p = barrelProfile();
  it('runs from the bottom centre to the recessed lid at the axis', () => {
    expect(p[0]).toEqual([0, 0]);
    const last = p[p.length - 1]!;
    expect(last[0]).toBe(0);
    expect(last[1]).toBeCloseTo(H - BARREL_LOOK.lidRecessM, 9);
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
    for (let i = topI + 1; i < p.length; i++) expect(p[i]![1]).toBeGreaterThanOrEqual(H - BARREL_LOOK.lidRecessM - 1e-12);
  });
  it('has shell rows no more than 5 cm apart (dents need vertices)', () => {
    const shell = p.filter(([r, y]) => near(r, R) && y > 0.04 && y < H - 0.04).map(([, y]) => y);
    for (let i = 1; i < shell.length; i++) expect(shell[i]! - shell[i - 1]!).toBeLessThanOrEqual(0.0521); // 5 cm, or a hoop's 52 mm
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
  it('the hazard band holds (dull, dirty) yellow and near-black stripes', () => {
    let yellow = 0, black = 0;
    for (const y of rowsIn(0.44, 0.56)) for (let x = 0; x < W; x++) {
      const [r, g, b] = px(x, y);
      if (r > 90 && g > 70 && b < 50 && r > 2.2 * b) yellow++;
      if (r + g + b < 90) black++;
    }
    expect(yellow).toBeGreaterThan(500);
    expect(black).toBeGreaterThan(500);
  });
  it('the upper drum is aged toxic green: still green, desaturated and dark', () => {
    const m = mean(0.6, 0.9);
    expect(m.g).toBeGreaterThan(1.05 * m.r);
    expect(m.g).toBeGreaterThan(1.3 * m.b);
    // Saturation (max − min) / max well under the old plastic green's (~0.7); luma under the walls' mid grey.
    expect((m.g - m.b) / m.g).toBeLessThan(0.5);
    expect(m.luma).toBeLessThan(70);
  });
  it('carries roughness in alpha: rust rougher than paint, bare steel smoother', () => {
    let lo = 0, hi = 0;
    for (let i = 3; i < a.length; i += 4) { if (a[i]! < 255 * (BARREL_ROUGH.bare + 0.1)) lo++; if (a[i]! > 255 * 0.9) hi++; }
    expect(lo).toBeGreaterThan(50);              // chips and scratches
    expect(hi).toBeGreaterThan(2000);            // rust and grime
  });
  it('rust blooms round the hoops more than mid-panel', () => {
    const rusty = (v0: number, v1: number) => {
      let n = 0, t = 0;
      for (const y of rowsIn(v0, v1)) for (let x = 0; x < W; x++) { const [r, g] = px(x, y); if (r > g * 1.15) n++; t++; }
      return n / t;
    };
    expect(rusty(1 / 3 - 0.05, 1 / 3 + 0.02)).toBeGreaterThan(2 * rusty(0.75, 0.85));
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
  const ringMean = (d0: number, d1: number) => {
    let t = 0, c = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const d = Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1);
      if (d >= d0 && d < d1) { t += s[y * n + x]!; c++; }
    }
    return t / c;
  };
  it('is opaque at the centre, clear at the corners, deterministic', () => {
    expect(s.length).toBe(n * n);
    for (const [x, y] of [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]] as const) expect(s[y * n + x]).toBe(0);
    expect(s[(n / 2) * n + n / 2]).toBeGreaterThan(240);
    expect(scorchAlpha(n)).toEqual(s);
  });
  it('has a darker core than its body, and a ragged edge', () => {
    expect(ringMean(0, 0.12)).toBeGreaterThan(ringMean(0.3, 0.45) + 25);
    // Ragged: round the ring at 0.6, some directions are sooty and some nearly clean.
    let lo = 255, hi = 0;
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2, x = Math.floor((Math.cos(a) * 0.6 + 1) / 2 * n), y = Math.floor((Math.sin(a) * 0.6 + 1) / 2 * n);
      lo = Math.min(lo, s[y * n + x]!); hi = Math.max(hi, s[y * n + x]!);
    }
    expect(hi - lo).toBeGreaterThan(80);
  });
});

describe('scorchMask', () => {
  it('is binary soot whose density follows the amount: solid core and body, flecked edge, clean corners', () => {
    const n = 128, m = scorchMask(n), a = scorchAlpha(n);
    expect(scorchMask(n)).toEqual(m);
    expect(m.every((q) => q === 0 || q === 255)).toBe(true);
    const density = (d0: number, d1: number) => {
      let on = 0, c = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const d = Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1);
        if (d >= d0 && d < d1) { on += m[y * n + x]! ? 1 : 0; c++; }
      }
      return on / c;
    };
    expect(density(0, 0.12)).toBeGreaterThan(0.95);
    expect(density(0.3, 0.45)).toBeGreaterThan(0.9);
    const edge = density(0.6, 0.75);              // the ragged, flecked edge
    expect(edge).toBeGreaterThan(0.15);
    expect(edge).toBeLessThan(0.75);
    expect(density(0.98, 2)).toBe(0);
    for (let i = 0; i < n * n; i++) if (a[i] === 0) expect(m[i]).toBe(0);
  });
});

describe('scorchFit', () => {
  it('takes the full size on an open floor and shrinks before a ledge drop, not before a wall or a step up', () => {
    const flat = () => 0;
    expect(scorchFit(flat, 0, 0, 0)).toBeCloseTo(BARREL_LOOK.scorchM, 9);
    // A drop 0.6 m east of the feet: the edge must keep 0.42 × size inside it.
    const ledge = (x: number) => (x > 0.6 ? -1 : 0);
    const size = scorchFit(ledge, 0, 0, 0);
    expect(size * 0.42).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(size).toBeGreaterThanOrEqual(BARREL_LOOK.scorchMinM);
    // Off the map (a wall) or a higher floor (a step up) hides the overhang: full size.
    expect(scorchFit((x) => (x > 0.6 ? NaN : 0), 0, 0, 0)).toBeCloseTo(BARREL_LOOK.scorchM, 9);
    expect(scorchFit((x) => (x > 0.6 ? 0.5 : 0), 0, 0, 0)).toBeCloseTo(BARREL_LOOK.scorchM, 9);
    // Never below the minimum.
    expect(scorchFit((x) => (x > 0.05 ? -1 : 0), 0, 0, 0)).toBe(BARREL_LOOK.scorchMinM);
  });
});

describe('barrelDents and dentDepth', () => {
  it('are seeded, in range, inward-only and bounded', () => {
    const d = barrelDents(12345);
    expect(d.length).toBeGreaterThanOrEqual(BARREL_LOOK.dents[0]);
    expect(d.length).toBeLessThanOrEqual(BARREL_LOOK.dents[1]);
    expect(barrelDents(12345)).toEqual(d);
    expect(barrelDents(54321)).not.toEqual(d);
    let peak = 0;
    for (let i = 0; i < 64; i++) for (let j = 0; j <= 40; j++) {
      const z = dentDepth(d, i / 64, (j / 40) * H);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(BARREL_LOOK.dentMaxM + 1e-12);
      peak = Math.max(peak, z);
    }
    expect(peak).toBeGreaterThan(0.006);           // a dent you can see
  });
  it('leave the chimes round and vanish away from every dent', () => {
    const d = barrelDents(7);
    for (let i = 0; i < 32; i++) {
      expect(dentDepth(d, i / 32, BARREL_LOOK.dentBandM * 0.5)).toBe(0);
      expect(dentDepth(d, i / 32, H - BARREL_LOOK.dentBandM * 0.5)).toBe(0);
    }
    const one = [{ u: 0.5, y: 0.5, radiusM: 0.1, depthM: 0.02 }];
    expect(dentDepth(one, 0.5, 0.5)).toBeCloseTo(0.02, 9);
    expect(dentDepth(one, 0.0, 0.5)).toBe(0);      // the far side of the drum
    expect(dentDepth(one, 0.5, 0.5 + 0.1)).toBe(0);
  });
});

describe('lidAlbedo', () => {
  const n = 64, l = lidAlbedo(n, 3);
  it('is deterministic, dark and rough (no bright flat disc)', () => {
    expect(l.length).toBe(n * n * 4);
    expect(lidAlbedo(n, 3)).toEqual(l);
    let luma = 0, rough = 0, c = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1) > 0.9) continue;
      const i = (y * n + x) * 4;
      luma += 0.2126 * l[i]! + 0.7152 * l[i + 1]! + 0.0722 * l[i + 2]!; rough += l[i + 3]!; c++;
    }
    expect(luma / c).toBeLessThan(65);
    expect(rough / c / 255).toBeGreaterThan(0.75);
  });
});
describe('stubProfile, stubTear, stubBend and stubWarp', () => {
  const top = BARREL_LOOK.stubHeightM, tear = BARREL_LOOK.tearM, cut = top - tear;
  it('keeps the drum bottom up to the cut, rises to a torn top, and is OPEN: the inner wall runs back down', () => {
    const full = barrelProfile(), stub = stubProfile(3);
    const keep = full.filter(([, y]) => y <= cut);
    expect(stub.slice(0, keep.length)).toEqual(keep);
    const inner = stubInnerStart(stub);
    const outer = stub.slice(keep.length, inner);
    expect(outer.length).toBeGreaterThanOrEqual(3);
    for (const [r, y] of outer) {
      expect(r).toBeCloseTo(R, 9);
      expect(y).toBeGreaterThan(cut);
      expect(y).toBeLessThanOrEqual(top + tear);
    }
    const rim = outer[outer.length - 1]![1];
    // No cap: nothing reaches toward the axis above the cut until the inner floor, near the bottom.
    for (const [r, y] of stub.slice(inner)) {
      expect(r).toBeLessThan(R);
      if (r < R - BARREL_LOOK.stubWallM - 1e-9) expect(y).toBeLessThan(0.05);
      expect(y).toBeLessThanOrEqual(rim + 1e-12);
    }
    expect(stub[stub.length - 1]![0]).toBe(0);
    expect(stubProfile(3)).toEqual(stub);
    expect(stubProfile(4)).not.toEqual(stub);
  });
  it('the rim tear is seeded, bounded and jagged (petal tips and torn notches)', () => {
    const t = stubTear(5, 48);
    expect(t).toHaveLength(48);
    for (const d of t) expect(Math.abs(d)).toBeLessThanOrEqual(tear + 1e-12);
    expect(stubTear(5, 48)).toEqual(t);
    expect(new Set(t.map(d => d.toFixed(4))).size).toBeGreaterThan(10);
    expect(Math.max(...t) - Math.min(...t)).toBeGreaterThan(tear);
  });
  it('the petals bend outward, curling more toward the tip', () => {
    const b = stubBend(5, 48);
    for (const k of b) { expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThanOrEqual(1); }
    expect(Math.max(...b)).toBeGreaterThan(0.5);
    expect(stubWarp(0.02, 1, 0)).toEqual([0, 0]);
    const [mid] = stubWarp(0, 1, 0.5), [tip, sag] = stubWarp(0, 1, 1);
    expect(tip).toBeCloseTo(BARREL_LOOK.petalOutM, 9);
    expect(mid).toBeLessThan(tip / 2);
    expect(sag).toBeLessThan(0);
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
