// src/game/level/panel-textures.test.ts
//
// Every assertion compares two regions, kinds or seeds, so a constant buffer cannot pass.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EMITTER_PANEL_KINDS, generateMottle, generatePanel, isEmitterPanel, MOTTLE_SIZE, PANEL_KINDS, PANEL_SIZE, panelGlows, tstreak, wrapPanel, type PanelKind } from './panel-textures';
import { exitLetterAt, FL_CELL_W, FL_FRAME_PX, FL_TUBES, SB_CELL_TYPES, SB_GLASS, SB_LEDS } from './emitter-layout';
import { generateStone } from './stone-textures';

const N = PANEL_SIZE;
const maps = new Map<PanelKind, ReturnType<typeof generatePanel>>();
const get = (k: PanelKind) => { let m = maps.get(k); if (!m) maps.set(k, (m = generatePanel(k, 7))); return m; };
const mean = (buf: Uint8ClampedArray, ch: number) => { let s = 0; for (let i = ch; i < buf.length; i += 4) s += buf[i]!; return s / (buf.length / 4); };

describe('generatePanel', () => {
  it('is deterministic per seed and varies with it', () => {
    const a = generatePanel('concreteSlab', 3), b = generatePanel('concreteSlab', 3), c = generatePanel('concreteSlab', 4);
    expect(Array.from(a.albedo.slice(0, 4096))).toEqual(Array.from(b.albedo.slice(0, 4096)));
    expect(Array.from(a.albedo.slice(0, 4096))).not.toEqual(Array.from(c.albedo.slice(0, 4096)));
  });

  it.each(PANEL_KINDS)('%s tiles: the wrap edge steps no more than the map does inside', (k) => {
    const h = get(k).height;
    let wrap = 0, inside = 0;
    for (let y = 0; y < N; y++) {
      wrap += Math.abs(h[y * N]! - h[y * N + N - 1]!) + Math.abs(h[y]! - h[(N - 1) * N + y]!);
      inside += Math.abs(h[y * N + 255]! - h[y * N + 256]!) + Math.abs(h[255 * N + y]! - h[256 * N + y]!);
    }
    // Seams sit on some period lines (both the edge and the middle are pattern lines for most kinds), so
    // compare against the busier of the two plus slack: a non-tiling field steps far more at the edge.
    expect(wrap).toBeLessThan(Math.max(inside, 1) * 2.5 + N * 0.05);
  });

  it.each(PANEL_KINDS)('%s has a real normal map and stays in the dark albedo range', (k) => {
    const m = get(k);
    let deviating = 0;
    for (let i = 0; i < m.normal.length; i += 4) if (Math.abs(m.normal[i]! - 128) > 12 || Math.abs(m.normal[i + 1]! - 128) > 12) deviating++;
    expect(deviating).toBeGreaterThan(N * N * 0.01);
    const grey = (mean(m.albedo, 0) + mean(m.albedo, 1) + mean(m.albedo, 2)) / 3;
    // Screens and the viewscreen are mostly dark glass.
    expect(grey).toBeGreaterThan(isEmitterPanel(k) ? 20 : 35);
    expect(grey).toBeLessThan(150);
  });

  it('only the light panel and the emitter kinds glow', () => {
    for (const k of PANEL_KINDS) expect(get(k).emissive !== null).toBe(k === 'lightPanel' || EMITTER_PANEL_KINDS.includes(k));
    for (const k of PANEL_KINDS) expect(panelGlows(k)).toBe(get(k).emissive !== null);
    const e = get('lightPanel').emissive!;
    // A cell centre glows, the frame corner does not.
    expect(e[(64 * N + 64) * 4 + 1]!).toBeGreaterThan(40);
    expect(e[(2 * N + 2) * 4 + 1]!).toBe(0);
  });

  it('rust is the warm one; tech panels are cold', () => {
    const warm = (k: PanelKind) => mean(get(k).albedo, 0) - mean(get(k).albedo, 2);
    expect(warm('rustBrick')).toBeGreaterThan(20);
    expect(warm('techPanel')).toBeLessThan(0);
  });

  it('kinds differ from each other', () => {
    const sig = (k: PanelKind) => Array.from(get(k).height.slice(0, 2048), v => Math.round(v * 20));
    expect(sig('floorTile')).not.toEqual(sig('metalPlate'));
    expect(sig('techPanel')).not.toEqual(sig('door'));
  });

  it.each(PANEL_KINDS.filter(k => !isEmitterPanel(k)))('%s: relief near the stone set (mean normal tilt > 65%% of wallBrick)', (k) => {
    const tilt = (n: Uint8ClampedArray) => { let t = 0; for (let i = 0; i < n.length; i += 4) t += Math.hypot(n[i]! - 128, n[i + 1]! - 128); return t / (n.length / 4); };
    // The sector mesh draws these at normalScale 1.3 against the stone's 1.1, so 65% here is ~75% on screen; the panels' relief sits on their features (seams, rivets), not everywhere.
    expect(tilt(get(k).normal)).toBeGreaterThan(tilt(generateStone('wallBrick', 11).normal) * 0.65);
  });

  it('roughness is one channel and varies (damp and oily patches are glossier)', () => {
    const r = get('metalPlate').roughness;
    expect(r.length).toBe(N * N);
    let lo = 255, hi = 0;
    for (let i = 0; i < r.length; i += 97) { lo = Math.min(lo, r[i]!); hi = Math.max(hi, r[i]!); }
    expect(hi - lo).toBeGreaterThan(80);
  });

  it('the mottle map is single-channel, tileable and spread', () => {
    const m = generateMottle(977);
    expect(m.length).toBe(MOTTLE_SIZE * MOTTLE_SIZE);
    let lo = 255, hi = 0, wrap = 0, inside = 0;
    for (const v of m) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let y = 0; y < MOTTLE_SIZE; y++) { wrap += Math.abs(m[y * MOTTLE_SIZE]! - m[y * MOTTLE_SIZE + MOTTLE_SIZE - 1]!); inside += Math.abs(m[y * MOTTLE_SIZE + 63]! - m[y * MOTTLE_SIZE + 64]!); }
    expect(hi - lo).toBeGreaterThan(100);
    expect(wrap).toBeLessThan(inside * 3 + MOTTLE_SIZE * 2);
  });

  it.each([[2, 64], [4, 64], [4, 128], [8, 128], [8, 256]])('tstreak %i × %i tiles at the map size and has no short period', (cx, cy) => {
    const f = (x: number, y: number) => tstreak(x, y, 41, cx, cy);
    let wrap = 0, step = 0;
    for (let y = 0; y < N; y += 7) { wrap += Math.abs(f(0, y) - f(N, y)) + Math.abs(f(y, 0) - f(y, N)); step += Math.abs(f(100, y) - f(100 + cx, y)); }
    expect(wrap).toBeLessThan(1e-9);
    // The old bug wrapped the x lattice at N / cy cells of cx px: a period of cx·N/cy px (16–24 px).
    for (const period of [16, 24, 32, 64]) {
      let d = 0;
      for (let y = 0; y < N; y += 5) for (let x = 0; x < N; x += 11) d += Math.abs(f(x, y) - f(x + period, y));
      expect(d).toBeGreaterThan(step * 0.5);
    }
  });
});

describe('emitter masks (R and G channels, linear)', () => {
  const at = (k: PanelKind, x: number, y: number, ch: number) => get(k).emissive![(y * N + x) * 4 + ch]!;
  it('screen bank: glass centres glow in R, bezels and seams do not; LED lenses glow in G', () => {
    for (let cell = 0; cell < 16; cell++) {
      const cx = (cell % 4) * 128, cy = Math.floor(cell / 4) * 128;
      const [r] = SB_GLASS[SB_CELL_TYPES[cell]!]!;
      const gx = cx + Math.round((r![0] + r![2]) / 2), gy = cy + Math.round((r![1] + r![3]) / 2);
      expect(at('screenBank', gx, gy, 0), `cell ${cell} glass`).toBeGreaterThan(60);
      expect(at('screenBank', cx + 1, cy + 64, 0), `cell ${cell} seam`).toBe(0);
      const [lx, ly] = SB_LEDS[SB_CELL_TYPES[cell]!]!;
      expect(at('screenBank', cx + lx, cy + ly, 1), `cell ${cell} led`).toBeGreaterThan(60);
      expect(at('screenBank', gx, gy, 1)).toBe(0);
    }
  });
  it('viewscreen: the glass glows, the frame does not', () => {
    expect(at('viewscreen', 128, 128, 0)).toBeGreaterThan(80);
    expect(at('viewscreen', 4, 128, 0)).toBe(0);
  });
  it('fluorescent: each tube band is brighter in its own channel than the diffuser between; the frame is dark', () => {
    let tubeA = 0, tubeB = 0, mid = 0;
    for (let y = 64; y < 192; y++) { tubeA += at('fluorescent', FL_TUBES[0], y, 0); tubeB += at('fluorescent', FL_TUBES[1], y, 1); mid += at('fluorescent', 64, y, 0); }
    expect(tubeA).toBeGreaterThan(mid * 1.6);
    expect(tubeB).toBeGreaterThan(mid * 1.6);
    expect(at('fluorescent', FL_CELL_W + 2, 128, 0)).toBe(0);
    expect(at('fluorescent', FL_FRAME_PX + 30, 128, 0)).toBeGreaterThan(0);
  });
  it('exit sign: the letters glow in R, the backlit face in G, the housing in neither', () => {
    let lit = 0, unlit = 0, seen = 0;
    for (let y = 0; y < N; y += 7) for (let x = 0; x < N; x += 7) {
      if (exitLetterAt(x, y)) { lit += at('exitSign', x, y, 0); seen++; } else unlit = Math.max(unlit, at('exitSign', x, y, 0));
    }
    expect(seen).toBeGreaterThan(100);
    expect(lit / seen).toBeGreaterThan(120);
    expect(unlit).toBeLessThan(60);
    expect(at('exitSign', 256, 60, 1)).toBeGreaterThan(80);
    expect(at('exitSign', 4, 256, 1)).toBe(0);
  });
  it('an emitter mask wraps as linear data; the light panel glow as sRGB', () => {
    const m = get('screenBank');
    expect(wrapPanel(m, 'screenBank').emissiveMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(wrapPanel(get('lightPanel'), 'lightPanel').emissiveMap!.colorSpace).toBe(THREE.SRGBColorSpace);
  });
});
