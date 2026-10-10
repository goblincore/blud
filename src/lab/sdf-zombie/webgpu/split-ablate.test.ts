// src/lab/sdf-zombie/webgpu/split-ablate.test.ts
//
// The ablation switches (split-ablate.ts) are OFF on every page that does not ask for them: with no `?splitablate`
// the march carries none of their text, and the CPU switches default to the shipped bounds.
import { afterEach, describe, expect, it } from 'vitest';
import { SPLIT_ABL, SPLIT_ABLATE, SPLIT_BOUND, SPLIT_FILM_OFF, ablWgsl, boundsSplit, splitAblate } from './split-ablate';
import { MAP_BODY } from './march/map-body.wgsl';
import { APPLY_WOUNDS } from './march/fields/wounds.wgsl';
import { INSTANCE_STATE } from './march/fields/groups.wgsl';
import { SPLIT_HIT_BLOCK } from './march/body/blocks/post/split-hit.wgsl';
import { SHADING_NORMAL_BLOCK } from './march/body/blocks/post/shading-normal.wgsl';
import { SPLIT_GLISTEN_BLOCK, splitGlistenBlock } from './march/body/blocks/light/split-glisten.wgsl';

describe('the open head\'s ablation switches', () => {
  afterEach(() => { splitAblate.mask = 0; splitAblate.boundsOff = 0; });

  it('are compiled out without the URL flags: the shipped march reads no mask', () => {
    expect(SPLIT_ABLATE).toBe(false);
    expect(SPLIT_FILM_OFF).toBe(false);
    expect(ablWgsl(' anything')).toBe('');
    for (const text of [MAP_BODY, APPLY_WOUNDS, INSTANCE_STATE, SPLIT_HIT_BLOCK, SHADING_NORMAL_BLOCK, SPLIT_GLISTEN_BLOCK]) {
      expect(text).not.toContain('gInstSplitR.y');
      expect(text).not.toContain('splitAbl');
    }
    expect(SPLIT_GLISTEN_BLOCK).toBe(splitGlistenBlock());
  });

  it('default to the shipped bounds, and a bound switched off reads no split', () => {
    const split = { tag: 1 };
    expect(splitAblate).toEqual({ mask: 0, boundsOff: 0 });
    for (const bit of Object.values(SPLIT_BOUND)) expect(boundsSplit(split, bit)).toBe(split);
    expect(boundsSplit(null, SPLIT_BOUND.box)).toBeNull();
    expect(boundsSplit(undefined, SPLIT_BOUND.box)).toBeNull();
    splitAblate.boundsOff = SPLIT_BOUND.tiles | SPLIT_BOUND.hullInner;
    expect(boundsSplit(split, SPLIT_BOUND.tiles)).toBeNull();
    expect(boundsSplit(split, SPLIT_BOUND.hullInner)).toBeNull();
    expect(boundsSplit(split, SPLIT_BOUND.box)).toBe(split);
    expect(boundsSplit(split, SPLIT_BOUND.hullOuter)).toBe(split);
  });

  it('the switches are distinct bits', () => {
    for (const set of [SPLIT_ABL, SPLIT_BOUND]) {
      const bits = Object.values(set);
      expect(new Set(bits).size).toBe(bits.length);
      for (const b of bits) expect(b & (b - 1)).toBe(0);
    }
  });
});
