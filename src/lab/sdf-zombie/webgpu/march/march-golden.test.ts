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
  it('keeps every string export byte-identical', () => {
    expect(digest(M)).toMatchSnapshot();
  });
  // THE MARCH WITHOUT THE LEAN WALK (`?leanwalk=0`): the snapshot the test above held until 2026-11-09, value for
  // value. The flag's off side must stay the old text to the byte.
  it('keeps the ?leanwalk=0 text byte-identical', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '?leanwalk=0' });
    const flag = await import('./lean-walk-flag');
    expect(flag.LEAN_WALK).toBe(false);
    expect(digest(await import('../march.wgsl'))).toMatchSnapshot();
  });
  it('still exports the same functions', () => {
    expect(typeof M.soldierFaceDamageShadow).toBe('function');
  });
});
