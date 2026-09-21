// scripts/seam-merge-guard.test.ts
//
// The source-level guard for the frozen-seam-getter bug
// (src/lab/sdf-zombie/webgpu/seam-merge.ts). The extraction tools already
// refuse the spread shape (scripts/lib/seam-literal.ts); this catches a HAND
// edit that puts `...createXSeams(ctx)` back into game-main, which would
// re-freeze that factory's getters at boot and type-check perfectly.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('game-main assembles __sdfGame with mergeSeams', () => {
  it('passes seam factories as arguments, never as spreads', () => {
    const src = readFileSync('src/lab/sdf-zombie/webgpu/game-main.ts', 'utf8');
    expect(src).toMatch(/__sdfGame = mergeSeams\(/);
    expect(src).not.toMatch(/\.\.\.\s*create\w+Seams\s*\(/);
  });
});
