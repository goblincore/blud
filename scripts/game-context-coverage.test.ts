// scripts/game-context-coverage.test.ts
//
// The codemod is only as correct as its binding maps. Two ways they can be
// silently wrong: two slices claiming the same old name (one rewrite wins, the
// other binding vanishes), or a state binding no slice claims (it stays a local
// that extracted code cannot reach). Both are caught here rather than at the
// pixel gate.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as slices from '../src/lab/sdf-zombie/webgpu/game-context-bindings';
import { extractBindings } from './slice-extract';

const GAME_MAIN = 'src/lab/sdf-zombie/webgpu/game-main.ts';

function mapped(): Map<string, string> {
  const seen = new Map<string, string>();
  for (const [sliceExport, map] of Object.entries(slices)) {
    for (const key of Object.keys(map as object)) seen.set(key, sliceExport);
  }
  return seen;
}

function stateBindings() {
  return extractBindings(readFileSync(GAME_MAIN, 'utf8')).filter(b => b.role === 'state');
}

describe('binding maps', () => {
  it('has no name claimed by two slices', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const [sliceExport, map] of Object.entries(slices)) {
      for (const key of Object.keys(map as object)) {
        if (seen.has(key)) dupes.push(`${key}: ${seen.get(key)} AND ${sliceExport}`);
        seen.set(key, sliceExport);
      }
    }
    expect(dupes).toEqual([]);
  });

  it('claims every state binding in game-main.ts', () => {
    const seen = mapped();
    expect(stateBindings().filter(b => !seen.has(b.name)).map(b => b.name)).toEqual([]);
  });

  it('claims nothing that is not a state binding', () => {
    const names = new Set(stateBindings().map(b => b.name));
    expect([...mapped().keys()].filter(k => !names.has(k))).toEqual([]);
  });

  it('routes every mapping into its own slice namespace', () => {
    for (const [sliceExport, map] of Object.entries(slices)) {
      const ns = sliceExport.replace(/_BINDINGS$/, '').toLowerCase();
      for (const [oldName, path] of Object.entries(map as Record<string, string>)) {
        expect(path.startsWith(`${ns}.`), `${oldName} -> ${path} escapes ${ns}`).toBe(true);
      }
    }
  });
});
