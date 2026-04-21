import { describe, it, expect } from 'vitest';
import { validateManifest } from './qav-schema';

const validQav = {
  name: 'dynamite-cock',
  kind: 'qav',
  loop: true,
  nFrames: 1,
  frames: [{ durMs: 50, layers: [{ tile: 3205, ox: 0, oy: 0, scale: 1.0 }] }],
};

const validSeq = {
  name: 'zombie-walk',
  kind: 'seq',
  loop: true,
  baseTile: 1170,
  angleStride: 5,
  frames: [{ tileOffset: 0, durMs: 120 }],
};

const tileMeta = { '1170': { w: 48, h: 64, ox: 0, oy: -32 }, '3205': { w: 40, h: 50, ox: 0, oy: -25 } };

describe('validateManifest', () => {
  it('accepts valid QAV', () => {
    expect(() => validateManifest(validQav, tileMeta)).not.toThrow();
  });
  it('accepts valid SEQ', () => {
    expect(() => validateManifest(validSeq, tileMeta)).not.toThrow();
  });
  it('rejects missing name', () => {
    const bad = { ...validQav, name: undefined };
    expect(() => validateManifest(bad, tileMeta)).toThrow(/name/);
  });
  it('rejects unknown kind', () => {
    expect(() => validateManifest({ ...validQav, kind: 'xyz' }, tileMeta)).toThrow(/kind/);
  });
  it('rejects QAV with zero frames', () => {
    expect(() => validateManifest({ ...validQav, frames: [] }, tileMeta)).toThrow(/frames/);
  });
  it('rejects QAV frame with non-positive durMs', () => {
    const bad = { ...validQav, frames: [{ durMs: 0, layers: [{ tile: 3205, ox: 0, oy: 0, scale: 1 }] }] };
    expect(() => validateManifest(bad, tileMeta)).toThrow(/durMs/);
  });
  it('rejects QAV layer referencing unknown tile', () => {
    const bad = { ...validQav, frames: [{ durMs: 50, layers: [{ tile: 99999, ox: 0, oy: 0, scale: 1 }] }] };
    expect(() => validateManifest(bad, tileMeta)).toThrow(/tile 99999/);
  });
  it('rejects SEQ with angleStride < 1', () => {
    expect(() => validateManifest({ ...validSeq, angleStride: 0 }, tileMeta)).toThrow(/angleStride/);
  });
  it('rejects SEQ referencing tile not in tileMeta', () => {
    const bad = { ...validSeq, baseTile: 99999 };
    expect(() => validateManifest(bad, tileMeta)).toThrow(/tile 99999/);
  });
});

// --- Real manifest validation against extracted data ---
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import * as fs from 'node:fs';
// @ts-expect-error — node:path available in vitest via happy-dom/node
import * as path from 'node:path';

describe('real manifest validation', () => {
  const meta = JSON.parse(fs.readFileSync('public/assets/animations/tiles-meta.json', 'utf8'));
  const roots = ['public/assets/animations/weapons', 'public/assets/animations/characters'];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const f of fs.readdirSync(root).filter((n: string) => n.endsWith('.json'))) {
      it(`validates ${root}/${f}`, () => {
        const raw = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
        expect(() => validateManifest(raw, meta)).not.toThrow();
      });
    }
  }
});
