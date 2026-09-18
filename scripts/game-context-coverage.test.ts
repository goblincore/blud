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

  // BEFORE the codemod these two asserted the maps covered every main()-scope
  // binding. AFTER it there are no such bindings left, so the useful invariant
  // inverts: the migration must stay complete. This is the gate that stops a
  // new `let foo` from quietly reappearing in main()'s scope and starting the
  // 14,000-line closure over again.
  it('leaves ctx as the only state binding in main()', () => {
    const names = stateBindings().map(b => b.name);
    expect(names).toEqual(['ctx']);
  });

  it('maps a name for every slice field path it declares', () => {
    for (const [sliceExport, map] of Object.entries(slices)) {
      const paths = Object.values(map as Record<string, string>);
      expect(new Set(paths).size, `${sliceExport} maps two names onto one field`).toBe(paths.length);
    }
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
