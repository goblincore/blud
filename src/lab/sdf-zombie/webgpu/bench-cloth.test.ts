import { describe, expect, it } from 'vitest';
import zombieSrc from '../characters/zombie.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { CLOTH_VARIANTS, clothVariantSrc } from './bench-cloth';

function build(src: string) {
  const doc = parseBlob(src);
  return buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS, {});
}

describe('bench-cloth variants', () => {
  const base = build(zombieSrc);
  const shells = (b: ReturnType<typeof build>) => b.prims.filter(p => p.shell).length;

  it.each(CLOTH_VARIANTS)('%s compiles with no body errors', (v) => {
    const b = build(clothVariantSrc(zombieSrc, v));
    expect(b.errors).toEqual([]);
  });

  it('paint and offset add no prim; trousers add five shells; the robes two', () => {
    const n = (v: Parameters<typeof clothVariantSrc>[1]) => build(clothVariantSrc(zombieSrc, v));
    expect(n('paint').prims.length).toBe(base.prims.length);
    expect(n('offset').prims.length).toBe(base.prims.length);
    expect(shells(n('trousers'))).toBe(5);
    expect(shells(n('robe'))).toBe(2);
    expect(n('robe').prims.find(p => p.shell)?.shell?.warpAmp).toBeGreaterThan(0);
    expect(n('robe-flat').prims.every(p => !p.shell || p.shell.warpAmp === 0)).toBe(true);
  });

  it('offset grows the covered bars by the stand-off', () => {
    const src = clothVariantSrc(zombieSrc, 'offset');
    expect(src).toMatch(/bar {2}leg on thigh .*r=0\.0940 .*color=3a3428/);
    expect(src).toMatch(/bar {2}leg on shin {2}from=0\.05 .*r=0\.0740 .*color=3a3428/);
  });
});
