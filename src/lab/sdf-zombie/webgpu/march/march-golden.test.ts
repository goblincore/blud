// src/lab/sdf-zombie/webgpu/march/march-golden.test.ts
//
// THE MOVE-ONLY GATE for the march.wgsl.ts split (spec 2026-09-18). Every
// string export of the barrel, plus the joined include list and both entry
// points, hashed. Recorded before the first move; it must never change during
// phase 1. A diff here means a move altered shader text — fix the move, never
// update this snapshot.
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import * as M from '../march.wgsl';

const sha = (s: string) => createHash('sha1').update(s).digest('hex');

describe('march.wgsl split golden', () => {
  it('keeps every string export byte-identical', () => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(M).sort(([a], [b]) => a.localeCompare(b))) {
      if (typeof v === 'string') out[k] = sha(v);
      else if (typeof v === 'number') out[k] = `num:${v}`;
    }
    out['__HELPERS_joined'] = sha((M.HELPERS as string[]).join('\n'));
    out['__HELPERS_count'] = String((M.HELPERS as string[]).length);
    out['__export_names'] = sha(Object.keys(M).sort().join(','));
    expect(out).toMatchSnapshot();
  });
  it('still exports the same functions', () => {
    expect(typeof M.soldierFaceDamageShadow).toBe('function');
  });
});
