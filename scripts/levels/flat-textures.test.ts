// scripts/levels/flat-textures.test.ts
//
// The Flat's generated textures exist and obey the exporter's 1024 px limit.

// @ts-expect-error — node:fs available in vitest
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'assets-source/levels/flat-textures';
const STONES = ['wall_n', 'wall_e', 'wall_w', 'wall_s', 'vault', 'flag', 'dark'];
const FILES = [...STONES.flatMap(s => [`${s}_color.png`, `${s}_normal.png`]), 'tatami.png', 'quilt.png', 'books.png', 'view.png'];

function pngSize(file: string): [number, number] {
  const b = readFileSync(`${DIR}/${file}`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('flat textures', () => {
  it('every texture exists', () => {
    for (const f of FILES) expect(existsSync(`${DIR}/${f}`), f).toBe(true);
  });
  it('none is over 1024 px on a side', () => {
    for (const f of FILES) {
      const [w, h] = pngSize(f);
      expect(Math.max(w, h), f).toBeLessThanOrEqual(1024);
    }
  });
  it('a stone colour and its normal are the same size', () => {
    for (const s of STONES) expect(pngSize(`${s}_color.png`)).toEqual(pngSize(`${s}_normal.png`));
  });
});
