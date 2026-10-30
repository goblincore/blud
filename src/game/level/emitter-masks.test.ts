// src/game/level/emitter-masks.test.ts
//
// The emitter glow masks' means that emitter-layout.ts pins for the CPU bake (SB_GLASS_COVER, ...)
// against the real generated masks (panel-textures.ts). Slow: it generates four 512 px panels.
import { describe, expect, it } from 'vitest';
import { EX_COVER, FL_TUBE_COVER, SB_CELL_TYPES, SB_GLASS_COVER, SB_LED_COVER, VS_GLASS_COVER } from './emitter-layout';
import { generatePanel } from './panel-textures';

const means = (kind: Parameters<typeof generatePanel>[0]) => {
  const e = generatePanel(kind, 1).emissive!;
  const n = e.length / 4;
  let r = 0, g = 0;
  for (let i = 0; i < n; i++) { r += e[i * 4]!; g += e[i * 4 + 1]!; }
  return { e, r: r / n / 255, g: g / n / 255 };
};

describe('emitter mask means (emitter-layout.ts covers)', () => {
  it('the screen bank per cell type, the viewscreen, the troffer and the sign match their generated masks', () => {
    const sb = means('screenBank');
    const r = [0, 0, 0, 0], g = [0, 0, 0, 0], c = [0, 0, 0, 0];
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const ty = SB_CELL_TYPES[Math.floor(y / 128) * 4 + Math.floor(x / 128)]!, i = (y * 512 + x) * 4;
      r[ty]! += sb.e[i]! / 255; g[ty]! += sb.e[i + 1]! / 255; c[ty]!++;
    }
    for (let ty = 0; ty < 4; ty++) {
      expect(r[ty]! / c[ty]!).toBeCloseTo(SB_GLASS_COVER[ty]!, 2);
      expect(g[ty]! / c[ty]!).toBeCloseTo(SB_LED_COVER[ty]!, 2);
    }
    expect(means('viewscreen').r).toBeCloseTo(VS_GLASS_COVER, 2);
    const fl = means('fluorescent');
    expect(fl.r).toBeCloseTo(FL_TUBE_COVER[0], 2); expect(fl.g).toBeCloseTo(FL_TUBE_COVER[1], 2);
    const ex = means('exitSign');
    expect(ex.r).toBeCloseTo(EX_COVER[0], 2); expect(ex.g).toBeCloseTo(EX_COVER[1], 2);
  });
});
