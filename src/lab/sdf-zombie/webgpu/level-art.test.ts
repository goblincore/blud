// src/lab/sdf-zombie/webgpu/level-art.test.ts

import { describe, expect, it } from 'vitest';
import { ART_EMISSIVE_CAP, artRoomOf, artUrl, capEmissive, checkArtBudget, glbJson } from './level-art';

describe('level art', () => {
  it('the art file resolves beside the level JSON', () => {
    expect(artUrl('the-wake', 'the-wake.art.glb')).toBe('/assets/levels/the-wake.art.glb');
    expect(artUrl('fixtures/art-shell', 'art-shell.art.glb')).toBe('/assets/levels/fixtures/art-shell.art.glb');
  });
  it('a mesh takes the room of its nearest tagged ancestor-or-self', () => {
    expect(artRoomOf([{ room: 3 }, {}])).toBe(3);
    expect(artRoomOf([{}, { room: 2 }])).toBe(2);
    expect(artRoomOf([{}, {}])).toBeNull();
  });
  it('budget: passes inside, names every overrun', () => {
    const b = { drawCalls: 50, frameMs: 2 };
    expect(checkArtBudget({ drawCalls: 100, frameMs: 10 }, { drawCalls: 140, frameMs: 11.5 }, b)).toEqual([]);
    expect(checkArtBudget({ drawCalls: 100, frameMs: 10 }, { drawCalls: 160, frameMs: 13 }, b))
      .toEqual(['draw calls +60 > +50', 'frame +3.00 ms > +2 ms']);
  });
  it('caps Blender emission strengths at the game cap', () => {
    expect(capEmissive(12)).toBe(ART_EMISSIVE_CAP);
    expect(capEmissive(0.5)).toBe(0.5);
  });
  it('reads the JSON chunk of a GLB', () => {
    const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' } }) + '  ');
    const buf = new Uint8Array(12 + 8 + json.length);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, buf.length, true);
    dv.setUint32(12, json.length, true); dv.setUint32(16, 0x4e4f534a, true); buf.set(json, 20);
    expect(glbJson(buf)).toEqual({ asset: { version: '2.0' } });
  });
});

describe('art batching (optimisation pass)', () => {
  const base = { room: 3, materialId: 'm1', materialName: 'train.steel', shadow: true, sway: null, attributes: 'normal,position,uv', indexed: true };
  it('static meshes batch by room, material, shadow flag and layout', async () => {
    const { artBatchKey } = await import('./level-art');
    expect(artBatchKey(base)).toBe(artBatchKey({ ...base }));
    expect(artBatchKey(base)).not.toBe(artBatchKey({ ...base, room: 4 }));
    expect(artBatchKey(base)).not.toBe(artBatchKey({ ...base, materialId: 'm2' }));
    expect(artBatchKey(base)).not.toBe(artBatchKey({ ...base, shadow: false }));
    expect(artBatchKey(base)).not.toBe(artBatchKey({ ...base, attributes: 'position' }));
    expect(artBatchKey(base)).not.toBe(artBatchKey({ ...base, indexed: false }));
  });
  it('moving pieces, window glass and roomless meshes stay on their own', async () => {
    const { artBatchKey } = await import('./level-art');
    expect(artBatchKey({ ...base, sway: 'lamp' })).toBeNull();
    expect(artBatchKey({ ...base, sway: 'steam' })).toBeNull();
    expect(artBatchKey({ ...base, materialName: 'window:night' })).toBeNull();
    expect(artBatchKey({ ...base, room: null })).toBeNull();
  });
});
