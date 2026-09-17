import { describe, expect, it } from 'vitest';
import { characterNames, characterEntry } from './character-registry';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { DEFAULT_FACE } from './face';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { packBody } from './pack';
import { severLimb } from './sever';
import { buildCharacterBody } from './webgpu/character-view';

describe('half-strength character defaults', () => {
  it.each(characterNames())('%s carries the same effective blends through build, cache, packing and damage', name => {
    const entry = characterEntry(name), doc = parseBlob(entry.src);
    const def = compileBlob(doc, { ...DEFAULT_FACE, ...compileFace(doc) });
    const original = structuredClone(def);
    const full = buildBody(def, { ...DEFAULT_BUILD_OPTS, roundBlendScale: 1 });
    const half = buildBody(def);
    const cached = buildCharacterBody(entry, [0, 0, 0], []);
    expect(def).toEqual(original);
    expect(cached.prims).toEqual(half.prims);
    const packed = packBody(cached);
    const damaged = severLimb(cached, 'armL').body;
    expect(half.prims.length).toBe(full.prims.length);
    half.prims.forEach((p, i) => {
      const ref = full.prims[i]!;
      const preserved = ref.dead || (ref.op !== undefined && ref.op !== 'add')
        || ref.shell || ref.strand || ref.box || ref.blendProfile === 'chamfer';
      expect(p.blendK).toBe(ref.blendK * (preserved ? 1 : 0.5));
      expect(packed.primB[i * 4 + 3]).toBe(Math.fround(p.blendK));
      expect(damaged.prims[i]!.blendK).toBe(p.blendK);
    });
  });

  it('keeps panel overrides absolute and never halves them again on rebuild', () => {
    const doc = parseBlob(characterEntry('zombie').src);
    const def = compileBlob(doc, { ...DEFAULT_FACE, ...compileFace(doc) });
    const override = { primBlendK: { 0: 0.0123 } };
    const a = buildBody(def, DEFAULT_BUILD_OPTS, override);
    const b = buildBody(def, DEFAULT_BUILD_OPTS, override);
    expect(a.prims[0]!.blendK).toBe(0.0123);
    expect(b.prims).toEqual(a.prims);
  });
});
