import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listModels, modelStoreRoot, readModelText } from './upscale-model-store';

describe('upscale model store (contracts §4)', () => {
  const root = mkdtempSync(join(tmpdir(), 'upscale-models-'));
  const put = (name: string, text: string) => {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, 'model.json'), text);
  };
  put('s16-rgbd-best', JSON.stringify({
    id: 's16', inputs: 'rgbd', source: 'trained', run: 's16-rgbd', step: 1200, weightHash: 'a1b2c3d4', metrics: { overall: 0.02 },
  }));
  put('broken', '{nope');
  put('_hidden', '{}');
  mkdirSync(join(root, 'empty'));

  it('lists valid names with summaries, and reports bad JSON', () => {
    const list = listModels(root);
    expect(list.map((m) => m.name)).toEqual(['broken', 's16-rgbd-best']);
    expect(list[0]!.error).toMatch(/bad JSON/);
    expect(list[1]).toEqual({
      name: 's16-rgbd-best', id: 's16', inputs: 'rgbd', source: 'trained', run: 's16-rgbd', step: 1200,
      weightHash: 'a1b2c3d4', overall: 0.02,
    });
    expect(listModels(join(root, 'nope'))).toEqual([]);
  });

  it('reads by name and refuses anything that could leave the store', () => {
    expect(JSON.parse(readModelText(root, 's16-rgbd-best')!).id).toBe('s16');
    for (const bad of ['../s16-rgbd-best', 'a/b', '.hidden', '_hidden', '', 'x'.repeat(65), 'S16']) {
      expect(readModelText(root, bad)).toBeNull();
    }
    expect(readModelText(root, 'missing')).toBeNull();
  });

  it('honours UPSCALE_MODELS_DIR', () => {
    expect(modelStoreRoot('/repo', {})).toBe(join('/repo', '.upscale-models'));
    expect(modelStoreRoot('/repo', { UPSCALE_MODELS_DIR: '/data/models' })).toBe('/data/models');
  });
});
