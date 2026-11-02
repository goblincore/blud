// src/lab/sdf-zombie/blast-fx.test.ts — the `?blastfx=` switch (blast-fx.ts).
import { describe, expect, it } from 'vitest';
import { BLAST_FX_STEPS, DEFAULT_BLAST_FX, parseBlastFx } from './blast-fx';

describe('parseBlastFx', () => {
  it('reads none / all / lists, and the default with no param', () => {
    expect([...parseBlastFx('none')]).toEqual([]);
    expect([...parseBlastFx('all')].sort()).toEqual([...BLAST_FX_STEPS].sort());
    expect([...parseBlastFx(null)].sort()).toEqual([...DEFAULT_BLAST_FX].sort());
    expect([...parseBlastFx('')].sort()).toEqual([...DEFAULT_BLAST_FX].sort());
    expect([...parseBlastFx('depth')]).toEqual(['depth']);
    expect([...parseBlastFx('front, timing')].sort()).toEqual(['front', 'timing']);
  });

  it('ignores unknown names, and a list of only unknown names is the old look', () => {
    expect([...parseBlastFx('depth,shade')]).toEqual(['depth']);
    expect([...parseBlastFx('shade')]).toEqual([]);
  });
});
