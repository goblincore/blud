// scripts/levels/flat-textures.test.ts
//
// The Flat's generated textures exist and obey the exporter's 1024 px limit.

// @ts-expect-error — node:fs available in vitest
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'assets-source/levels/flat-textures';
const STONES = ['wall_n', 'wall_e', 'wall_w', 'wall_s', 'vault', 'flag', 'dark'];
const FILES = [...STONES.flatMap(s => [`${s}_color.jpg`, `${s}_normal.jpg`]), 'tatami.jpg', 'quilt.png', 'books.png', 'view.jpg', 'shell_color.jpg', 'screen.jpg'];

/** Width and height of a PNG (IHDR) or a JPEG (the first start-of-frame marker). */
function imageSize(file: string): [number, number] {
  const b = readFileSync(`${DIR}/${file}`);
  if (b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error(`${file}: no JPEG frame header`);
}

describe('flat textures', () => {
  it('every texture exists', () => {
    for (const f of FILES) expect(existsSync(`${DIR}/${f}`), f).toBe(true);
  });
  it('none is over 1024 px on a side', () => {
    for (const f of FILES) {
      const [w, h] = imageSize(f);
      expect(Math.max(w, h), f).toBeLessThanOrEqual(1024);
    }
  });
  it('a stone colour and its normal are the same size', () => {
    for (const s of STONES) expect(imageSize(`${s}_color.jpg`)).toEqual(imageSize(`${s}_normal.jpg`));
  });
});
