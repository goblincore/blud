// src/game/level/panel-textures.test.ts
//
// Every assertion compares two regions, kinds or seeds, so a constant buffer cannot pass.
import { describe, expect, it } from 'vitest';
import { generatePanel, PANEL_KINDS, PANEL_SIZE, type PanelKind } from './panel-textures';

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
    expect(grey).toBeGreaterThan(35);
    expect(grey).toBeLessThan(150);
  });

  it('only the light panel glows', () => {
    for (const k of PANEL_KINDS) expect(get(k).emissive !== null).toBe(k === 'lightPanel');
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
});
