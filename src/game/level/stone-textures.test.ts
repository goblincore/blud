// src/game/level/stone-textures.test.ts
//
// Fixture note (degenerate-fixture house rule): every assertion here compares
// TWO different sample regions, or two different tunings, so a generator that
// returned a constant buffer cannot pass.
import { describe, expect, it } from 'vitest';
import { generateStone, STONE_SIZE, type StoneKind } from './stone-textures';

const px = (buf: Uint8ClampedArray, x: number, y: number) => {
  const i = (y * STONE_SIZE + x) * 4;
  return [buf[i]!, buf[i + 1]!, buf[i + 2]!, buf[i + 3]!] as const;
};

describe('generateStone', () => {
  it('is deterministic for a given seed', () => {
    const a = generateStone('wallBrick', 1234);
    const b = generateStone('wallBrick', 1234);
    expect(Array.from(a.albedo.slice(0, 512))).toEqual(Array.from(b.albedo.slice(0, 512)));
  });

  it('a different seed gives different stone', () => {
    const a = generateStone('wallBrick', 1);
    const b = generateStone('wallBrick', 2);
    expect(Array.from(a.albedo.slice(0, 512))).not.toEqual(Array.from(b.albedo.slice(0, 512)));
  });

  it('albedo is DESATURATED GRAY — the palette decision, not sepia', () => {
    const { albedo } = generateStone('wallBrick', 7);
    let checked = 0;
    for (let y = 4; y < STONE_SIZE; y += 37) {
      for (let x = 4; x < STONE_SIZE; x += 37) {
        const [r, g, b] = px(albedo, x, y);
        // red must never run away from blue the way sandstone does
        expect(r - b).toBeLessThan(26);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('the normal map is a real map, not a flat sheet', () => {
    const { normal } = generateStone('wallBrick', 7);
    // A flat normal map is (128,128,255) everywhere. Mortar lines must deviate.
    let deviating = 0;
    for (let i = 0; i < normal.length; i += 4) {
      if (Math.abs(normal[i]! - 128) > 12 || Math.abs(normal[i + 1]! - 128) > 12) deviating++;
    }
    expect(deviating).toBeGreaterThan(normal.length / 4 * 0.02);
  });

  it('normal-map STRENGTH is a real knob — the primary Doom 3 control', () => {
    const soft = generateStone('wallBrick', 7, { normalStrength: 0.2 });
    const hard = generateStone('wallBrick', 7, { normalStrength: 2.0 });
    const spread = (n: Uint8ClampedArray) => {
      let s = 0;
      for (let i = 0; i < n.length; i += 4) s += Math.abs(n[i]! - 128);
      return s;
    };
    expect(spread(hard.normal)).toBeGreaterThan(spread(soft.normal) * 1.5);
  });

  it('WET regions are both darker and glossier than dry ones', () => {
    const { albedo, roughness, wetMask } = generateStone('wallBrick', 7);
    let wet = -1, dry = -1;
    for (let i = 0; i < wetMask.length && (wet < 0 || dry < 0); i++) {
      if (wetMask[i]! > 200 && wet < 0) wet = i;
      if (wetMask[i]! < 20 && dry < 0) dry = i;
    }
    expect(wet).toBeGreaterThanOrEqual(0);
    expect(dry).toBeGreaterThanOrEqual(0);
    // glossier == LOWER roughness
    expect(roughness[wet * 4]!).toBeLessThan(roughness[dry * 4]!);
    expect(albedo[wet * 4]!).toBeLessThan(albedo[dry * 4]!);
  });

  it('floor cobble and wall brick are different stone', () => {
    const wall = generateStone('wallBrick', 7);
    const floor = generateStone('floorCobble', 7);
    expect(Array.from(wall.albedo.slice(0, 512))).not.toEqual(Array.from(floor.albedo.slice(0, 512)));
  });
});
