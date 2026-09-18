// src/lab/sdf-zombie/webgpu/game-context.test.ts
//
// The container's own invariants. Per-slice defaults are tested in each
// game-state-<slice>.test.ts; this file only pins that the container is
// complete and that two contexts never share a mutable object.

import { describe, expect, it } from 'vitest';
import { SLICE_NAMES, makeGameContext } from './game-context';

describe('makeGameContext', () => {
  it('creates every declared slice', () => {
    const ctx = makeGameContext();
    for (const name of SLICE_NAMES) expect(ctx).toHaveProperty(name);
  });

  it('gives each context its own slice objects', () => {
    const a = makeGameContext();
    const b = makeGameContext();
    for (const name of SLICE_NAMES) expect(a[name]).not.toBe(b[name]);
  });

  it('declares no slice it does not construct', () => {
    const ctx = makeGameContext() as unknown as Record<string, unknown>;
    for (const key of Object.keys(ctx)) {
      expect(SLICE_NAMES as readonly string[]).toContain(key);
    }
  });
});
