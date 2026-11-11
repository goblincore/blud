// src/lab/sdf-zombie/webgpu/march/march-golden.test.ts
//
// THE MOVE-ONLY GATE for the march.wgsl.ts split (spec 2026-09-18). Every
// string export of the barrel, plus the joined include list and both entry
// points, hashed. Recorded before the first move; it must never change during
// phase 1. A diff here means a move altered shader text — fix the move, never
// update this snapshot.
// @ts-expect-error — node:crypto available in vitest via happy-dom/node
import { createHash } from 'node:crypto';
import { afterEach, describe, it, expect, vi } from 'vitest';
import * as M from '../march.wgsl';

const sha = (s: string) => createHash('sha1').update(s).digest('hex');
const digest = (mod: Record<string, unknown>) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(mod).sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof v === 'string') out[k] = sha(v);
    else if (typeof v === 'number') out[k] = `num:${v}`;
  }
  out['__HELPERS_joined'] = sha((mod.HELPERS as string[]).join('\n'));
  out['__HELPERS_count'] = String((mod.HELPERS as string[]).length);
  out['__export_names'] = sha(Object.keys(mod).sort().join(','));
  return out;
};
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('march.wgsl split golden', () => {
  // THE SHIPPED TEXT. Re-recorded 2026-11-09 on the owner's call: the lean walk (lean-walk-flag.ts) is on by default,
  // walk only, so MAP_BODY, the trace setup and loop, the bodies built from them and the joined helpers moved, and
  // nothing else did (the next test holds the text without it to the snapshot this one had before).
  // Re-recorded again 2026-11-10 on the owner's call: the tile reference list (tile-ref-flag.ts) is on by default, so
  // the fold's tail, MAP_BODY, MAP_LEAN, the tile preload, the analytic normal's tile walk and what is built from
  // them moved (the next test holds the text without it to the snapshot this one had before).
  // Re-recorded again 2026-11-10 on the owner's call: the cheaper fallback normal (normal-loose-flag.ts) is on by
  // default, so the shading normal block and the bodies built from it moved (the next test holds the text without
  // it to the snapshot this one had before).
  // Re-recorded again 2026-11-11 on the owner's call: the owner re-fold (wound-fold-flag.ts) is off by default, so
  // MAP_BODY and what is built from it moved (the next test holds the text with it to the snapshot this one had
  // before).
  // Re-recorded again 2026-11-11 on the owner's call: the baked wound volume (wound-volume-flag.ts) is on by default,
  // so applyWounds, MAP_BODY, the wound masks, the shading normal and what is built from them moved (the next test
  // holds the text without it to the snapshot this one had before). The older flags' tests below take `woundvol=0`.
  it('keeps every string export byte-identical', () => {
    expect(digest(M)).toMatchSnapshot();
  });
  // THE MARCH WITHOUT THE BAKED WOUND VOLUME (`?woundvol=0`): the snapshot the test above held until the volume went
  // on by default, value for value.
  it('keeps the ?woundvol=0 text byte-identical', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '?woundvol=0' });
    expect((await import('./wound-volume-flag')).WOUND_VOL).toBe(false);
    expect(digest(await import('../march.wgsl'))).toMatchSnapshot();
  });
  // THE MARCH WITH THE OWNER RE-FOLD (`?woundfold=1`): the snapshot the test above held until the re-fold went off
  // by default, value for value.
  it('keeps the ?woundfold=1 text byte-identical', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '?woundfold=1&woundvol=0' });
    expect((await import('./wound-fold-flag')).WOUND_FOLD).toBe(true);
    expect(digest(await import('../march.wgsl'))).toMatchSnapshot();
  });
  // THE MARCH WITHOUT THE CHEAPER FALLBACK NORMAL (`?ngloose=0`, and `?woundfold=1` since the re-fold went off by default, as in the tests below): the snapshot the test above held until the flag
  // went on by default, value for value.
  it('keeps the ?ngloose=0 text byte-identical', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '?ngloose=0&woundfold=1&woundvol=0' });
    expect((await import('./normal-loose-flag')).NORMAL_LOOSE).toBe(false);
    expect(digest(await import('../march.wgsl'))).toMatchSnapshot();
  });
  // THE MARCH WITHOUT THE TILE REFERENCE LIST (`?tileref=0`, and `?ngloose=0` since that went on by default): the snapshot the test above held until 2026-11-10,
  // value for value. The flag's off side must stay the old text to the byte.
  it('keeps the ?tileref=0 text byte-identical', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '?tileref=0&ngloose=0&woundfold=1&woundvol=0' });
    const flag = await import('./tile-ref-flag');
    expect(flag.TILE_REF).toBe(false);
    expect(digest(await import('../march.wgsl'))).toMatchSnapshot();
  });
  // THE MARCH WITHOUT THE LEAN WALK OR THE REFERENCE LIST (`?leanwalk=0&tileref=0`): the snapshot the first test
  // held until 2026-11-09, value for value. With both flags off the text must stay the old text to the byte.
  it('keeps the ?leanwalk=0&tileref=0 text byte-identical', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '?leanwalk=0&tileref=0&ngloose=0&woundfold=1&woundvol=0' });
    const flag = await import('./lean-walk-flag');
    expect(flag.LEAN_WALK).toBe(false);
    expect((await import('./tile-ref-flag')).TILE_REF).toBe(false);
    expect(digest(await import('../march.wgsl'))).toMatchSnapshot();
  });
  it('still exports the same functions', () => {
    expect(typeof M.soldierFaceDamageShadow).toBe('function');
  });
});
