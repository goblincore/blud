import { describe, expect, it } from 'vitest';
import { STEAM_PUFF } from './train-steam.wgsl';

describe('train-steam.wgsl', () => {
  it('declares one fn', () => {
    expect(STEAM_PUFF.trim().startsWith('fn steamPuff(')).toBe(true);
    expect(STEAM_PUFF.match(/\bfn /g)).toHaveLength(1);
  });
});
