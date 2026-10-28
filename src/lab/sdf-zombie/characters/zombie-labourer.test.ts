// src/lab/sdf-zombie/characters/zombie-labourer.test.ts
import { describe, it, expect } from 'vitest';
import zombieSrc from './zombie.blob?raw';
import { labourerSrc, TROUSERS_BEGIN, TROUSERS_END, ZOMBIE_LABOURER_SRC } from './zombie-labourer';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';

const build = (src: string) => { const d = parseBlob(src); return buildBody(compileBlob(d, compileFace(d))); };

describe('the labourer (zombie.blob in SDF-cloth trousers)', () => {
  it('compiles and validates clean', () => {
    expect(build(ZOMBIE_LABOURER_SRC).errors).toEqual([]);
  });
  it('is zombie.blob plus five shells and the shins painted under them', () => {
    const base = build(zombieSrc), lab = build(ZOMBIE_LABOURER_SRC);
    expect(lab.prims.filter(p => p.shell).length).toBe(5);
    expect(lab.prims.length).toBe(base.prims.length + 5);
    const shins = lab.prims.filter(p => !p.shell && p.bone?.startsWith('shin.') && p.color);
    expect(shins.length).toBe(2);
    expect(shins.every(p => p.fabric)).toBe(true);
    const a = ZOMBIE_LABOURER_SRC.indexOf(TROUSERS_BEGIN), b = ZOMBIE_LABOURER_SRC.indexOf(TROUSERS_END);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });
  it('throws when zombie.blob loses an anchor line', () => {
    expect(() => labourerSrc(zombieSrc.replace(/^bones\s*$/m, 'bonez'))).toThrow(/bones/);
  });
});
