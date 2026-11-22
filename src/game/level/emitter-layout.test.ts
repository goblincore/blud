// src/game/level/emitter-layout.test.ts
import { describe, expect, it } from 'vitest';
import {
  DIM_LEVEL, emHash, emitterFactor, emRand, exitLetterAt, EX_GLYPHS, EX_TEXT_BOX, FLUORO_FLICKER, FLUORO_RATES, fluoroFlicker,
  panelState, SB_CELL_PX, SB_CELL_TYPES, SB_GLASS, SB_LEDS, SB_LED_R, SCREEN_FLICKER, SCREEN_RATES, screenFlicker, signBuzz,
  FLUORO_RGB, FLUORO_WARM, fluoroCellMean, fluoroFlickerMean, fluoroTint, fluoroTubeA, GLOW_PERIOD_S, LED_AMBER, LED_GREEN, LED_RED,
  ledColour, ledOn, SB_GLASS_COVER, SB_SCREEN_MEAN, SCREEN_AMBER, SCREEN_AMBER_RATE, screenCellMean, screenColour, screenIsAmber,
  sectorRowSeed, SIGN_BUZZ, signMean, viewscreenMean, viewscreenPlanet, VS_PLANET_CHANCE, wrapGlowTime,
} from './emitter-layout';

describe('emHash / emRand (mirrored in WGSL as u32 ops)', () => {
  it('is deterministic, 32-bit unsigned, and pinned (a change breaks the shader mirror)', () => {
    expect(emHash(0, 0)).toBe(emHash(0, 0));
    for (const [a, b] of [[0, 0], [1, 0], [-3, 7], [123456, -98765]]) {
      const h = emHash(a!, b!);
      expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
    }
    // An independent u32 reference in BigInt: the exact ops the WGSL emHash runs (wrapping multiply and add).
    const M = (1n << 32n) - 1n;
    const u = (v: number) => BigInt.asUintN(32, BigInt(v));
    const ref = (a: number, b: number) => {
      let h = ((u(a) * 0x9e3779b1n) & M) ^ ((((u(b) + 0x7f4a7c15n) & M) * 0x85ebca77n) & M);
      h ^= h >> 15n; h = (h * 0x2c1b3c6dn) & M; h ^= h >> 12n; h = (h * 0x297a2d39n) & M; h ^= h >> 15n;
      return Number(h);
    };
    for (let a = -40; a < 40; a += 3) for (let b = -50000; b < 50000; b += 4999) expect(emHash(a, b)).toBe(ref(a, b));
    expect(emHash(2 ** 31 - 1, -(2 ** 31))).toBe(ref(2 ** 31 - 1, -(2 ** 31)));
  });
  it('emRand spreads over 0..1 with no strong bias', () => {
    let sum = 0, lo = 1, hi = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) { const r = emRand(i % 200 - 100, Math.floor(i / 200)); sum += r; lo = Math.min(lo, r); hi = Math.max(hi, r); }
    expect(sum / n).toBeGreaterThan(0.48); expect(sum / n).toBeLessThan(0.52);
    expect(lo).toBeLessThan(0.001); expect(hi).toBeGreaterThan(0.999); expect(hi).toBeLessThan(1);
  });
});

describe('panel states', () => {
  const rate = (rates: typeof SCREEN_RATES) => {
    const c = { dead: 0, dim: 0, flicker: 0, steady: 0 };
    for (let a = 0; a < 100; a++) for (let b = 0; b < 100; b++) c[panelState(a, b * 977, rates)]++;
    return c;
  };
  it.each([['screen', SCREEN_RATES], ['fluorescent', FLUORO_RATES]] as const)('%s: a few dead, dim and flickering, most steady, at the set rates', (_, rates) => {
    const c = rate(rates);
    expect(c.dead / 1e4).toBeCloseTo(rates.dead, 1);
    expect(c.dim / 1e4).toBeCloseTo(rates.dim, 1);
    expect(c.flicker / 1e4).toBeCloseTo(rates.flicker, 1);
    expect(c.steady / 1e4).toBeGreaterThan(0.6);
  });
  it('is the same panel state every call (seeded by its id)', () => {
    expect(panelState(17, 4, FLUORO_RATES)).toBe(panelState(17, 4, FLUORO_RATES));
  });
});

describe('flicker', () => {
  const minOf = (xs: number[]) => xs.reduce((m, v) => Math.min(m, v), Infinity);
  const sample = (fn: (t: number) => number) => { const out: number[] = []; for (let t = 0; t < 600; t += 1 / 60) out.push(fn(t)); return out; };
  it('a flickering fluorescent bursts off now and then, deterministic; calm never strobes', () => {
    const ids = Array.from({ length: 40 }, (_, i) => i);
    const all = ids.map(i => sample(t => fluoroFlicker(t, i, 3, false)));
    const offFrac = all.flat().filter(v => v < 1).length / all.flat().length;
    expect(offFrac).toBeGreaterThan(0.02); expect(offFrac).toBeLessThan(0.15);
    expect(sample(t => fluoroFlicker(t, 5, 3, false))).toEqual(sample(t => fluoroFlicker(t, 5, 3, false)));
    const calm = ids.flatMap(i => sample(t => fluoroFlicker(t, i, 3, true)));
    expect(minOf(calm)).toBe(FLUORO_FLICKER.calmLow);
    expect(minOf(all.flat())).toBe(FLUORO_FLICKER.low);
  });
  it('screens dip rarely; flickering screens often; calm keeps dips shallow', () => {
    const frac = (flick: boolean) => sample(t => screenFlicker(t, 9, 2, flick, false)).filter(v => v < 1).length / 36000;
    expect(frac(false)).toBeLessThan(0.03);
    expect(frac(true)).toBeGreaterThan(0.1);
    expect(minOf(sample(t => screenFlicker(t, 9, 2, true, true)))).toBe(SCREEN_FLICKER.calmDip);
  });
  it('the exit sign buzzes in short shallow dips', () => {
    const s = sample(t => signBuzz(t, 1, 1, false));
    expect(s.filter(v => v < 1).length / s.length).toBeLessThan(0.1);
    expect(minOf(s)).toBeGreaterThan(0.6);
  });
});

describe('emitterFactor', () => {
  it('a full-bright sector is 1, a dark one keeps the floor, and it never exceeds 1', () => {
    expect(emitterFactor(0.35, 0.35, 0.75)).toBe(1);
    expect(emitterFactor(0, 0.35, 0.75)).toBe(0.75);
    expect(emitterFactor(0.7, 0.35, 0.5)).toBe(1);
    expect(emitterFactor(0.2, 0.35, 0.5)).toBeCloseTo(0.2 / 0.35, 9);
    expect(emitterFactor(0.1, 0, 0.5)).toBe(0.5);
  });
});

describe('layout', () => {
  it('screen-bank glass and LEDs sit inside their 1 m cell and do not overlap', () => {
    expect(SB_CELL_TYPES).toHaveLength(16);
    for (const ty of SB_CELL_TYPES) expect(ty >= 0 && ty < SB_GLASS.length).toBe(true);
    SB_GLASS.forEach((rects, ty) => {
      const [x0, y, dx, count, rows, dy] = SB_LEDS[ty]!;
      for (const r of rects) {
        expect(r[0] >= 4 && r[1] >= 4 && r[2] <= SB_CELL_PX - 4 && r[3] <= SB_CELL_PX - 4).toBe(true);
        for (let j = 0; j < rows; j++) for (let i = 0; i < count; i++) {
          const lx = x0 + i * dx, ly = y + j * dy;
          expect(lx + SB_LED_R < SB_CELL_PX && ly + SB_LED_R < SB_CELL_PX).toBe(true);
          const inside = lx > r[0] - SB_LED_R - 2 && lx < r[2] + SB_LED_R + 2 && ly > r[1] - SB_LED_R - 2 && ly < r[3] + SB_LED_R + 2;
          expect(inside, `type ${ty} led ${i},${j}`).toBe(false);
        }
      }
    });
  });
  it('the exit sign spells our block E X I T: lit dots only inside the text box', () => {
    expect(EX_GLYPHS).toHaveLength(4);
    for (const g of EX_GLYPHS) { expect(g).toHaveLength(7); for (const r of g) expect(r).toHaveLength(5); }
    const [x0, y0, x1, y1] = EX_TEXT_BOX;
    let lit = 0;
    for (let y = 0; y < 512; y += 4) for (let x = 0; x < 512; x += 4) {
      if (!exitLetterAt(x, y)) continue;
      lit++;
      expect(x >= x0 && x < x1 && y >= y0 && y < y1).toBe(true);
    }
    expect(lit).toBeGreaterThan(400);
    // The E's top bar: its first glyph row (top) is lit across.
    const rowH = (y1 - y0) / 7, colW = (x1 - x0) / 23;
    expect(exitLetterAt(x0 + colW * 2.5, y1 - rowH * 0.5)).toBe(true);
    expect(exitLetterAt(x0 + colW * 2.5, y1 - rowH * 2.5)).toBe(false);   // the E's open middle-right
  });
  it('a dim panel is dimmer than a steady one but not off', () => {
    expect(DIM_LEVEL).toBeGreaterThan(0.1); expect(DIM_LEVEL).toBeLessThan(0.6);
  });
});

describe('colours and means (item 2g B1: the CPU twin of the shader\'s per-panel colour)', () => {
  it('screens are amber at about SCREEN_AMBER_RATE, an LED panel (type 2) always', () => {
    let amber = 0;
    for (let s = 0; s < 4000; s++) if (screenIsAmber(0, s, 3)) amber++;
    expect(amber / 4000).toBeGreaterThan(SCREEN_AMBER_RATE - 0.04);
    expect(amber / 4000).toBeLessThan(SCREEN_AMBER_RATE + 0.04);
    for (let s = 0; s < 50; s++) expect(screenColour(2, s, 9)).toBe(SCREEN_AMBER);
  });
  it('LED hues split red / green / amber at LED_HUE_CUTS', () => {
    expect(ledColour(0.1)).toBe(LED_RED); expect(ledColour(0.6)).toBe(LED_GREEN); expect(ledColour(0.95)).toBe(LED_AMBER);
  });
  it('under reduced flashes an LED never changes state (no blink)', () => {
    for (let lid = 16; lid < 40; lid++) {
      const first = ledOn(7, lid, 3, 0, true);
      for (let t = 0; t < 20; t += 0.13) expect(ledOn(7, lid, 3, t, true)).toBe(first);
    }
    let changes = 0;
    for (let lid = 16; lid < 40; lid++) for (let t = 0; t < 20; t += 0.13) if (ledOn(7, lid, 3, t, false) !== ledOn(7, lid, 3, t + 0.13, false)) changes++;
    expect(changes).toBeGreaterThan(10);
  });
  it('a troffer tint stays within ±FLUORO_WARM / 2 of FLUORO_RGB; tube A sags only when not calm', () => {
    for (let a = 0; a < 200; a++) {
      const c = fluoroTint(a, 5);
      expect(Math.abs(c[0] - FLUORO_RGB[0])).toBeLessThanOrEqual(FLUORO_WARM / 2 + 1e-12);
      expect(c[1]).toBe(FLUORO_RGB[1]);
    }
    expect(fluoroTubeA(0.12, true)).toBe(1);
    expect(fluoroTubeA(0.12, false)).toBeCloseTo(0.92 + 0.08 * 0.12, 12);
    expect(fluoroTubeA(1, false)).toBe(1);
  });
  it('the glow clock wraps at GLOW_PERIOD_S and every slot period divides it', () => {
    expect(wrapGlowTime(GLOW_PERIOD_S + 1.5)).toBeCloseTo(1.5, 9);
    expect(wrapGlowTime(10)).toBe(10);
    for (const p of [FLUORO_FLICKER.window, 1 / SCREEN_FLICKER.slotHz, 1 / FLUORO_FLICKER.slotHz, 1 / SIGN_BUZZ.slotHz]) {
      const k = GLOW_PERIOD_S / p;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }
  });
  it('mean glows: screens green-or-amber and dimmer than their glass, dead cells dim the mean, troffers cold, signs red', () => {
    const cells = Array.from({ length: 64 }, (_, i) => screenCellMean(i, i % 7, 15));
    for (const c of cells) { expect(Math.max(...c)).toBeLessThan(0.2); expect(c[1]).toBeGreaterThan(c[2]); }
    const mean = cells.reduce((s, c) => s + c[1], 0) / cells.length;
    expect(mean).toBeGreaterThan(0.01);
    const fl = fluoroCellMean(3, 1, 25);
    expect(fl[2]).toBeGreaterThan(fl[0]);
    expect(fluoroFlickerMean(false)).toBeLessThan(fluoroFlickerMean(true));
    const sg = signMean();
    expect(sg[0]).toBeGreaterThan(sg[1] * 10);
    const vs = viewscreenMean(1, 0, 16);
    expect(vs[2]).toBeGreaterThan(0);
    expect(Math.max(...vs)).toBeLessThan(0.1);
    // A dead screen's cell is dimmer than the steady ones' mean.
    let dead = -1;
    for (let wx = 0; wx < 400 && dead < 0; wx++) {
      if (SB_CELL_TYPES[(wx % 4)]! !== 1 && panelState(wx * 2, 0 + sectorRowSeed(15), SCREEN_RATES) === 'dead') dead = wx;
    }
    expect(dead).toBeGreaterThanOrEqual(0);
    expect(screenCellMean(dead, 0, 15)[1]).toBeLessThan(0.3 * SB_SCREEN_MEAN * SB_GLASS_COVER[SB_CELL_TYPES[dead % 4]!]!);
  });
  it('viewscreenPlanet: about VS_PLANET_CHANCE of screens, radius 0.18..0.32', () => {
    let n = 0;
    for (let wx = 0; wx < 2000; wx++) {
      const p = viewscreenPlanet(wx, 5);
      if (!p) continue;
      n++;
      expect(p.r).toBeGreaterThanOrEqual(0.18); expect(p.r).toBeLessThanOrEqual(0.32);
    }
    expect(Math.abs(n / 2000 - VS_PLANET_CHANCE)).toBeLessThan(0.04);
  });
});
