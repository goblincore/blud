// scripts/extract-seam-group.test.ts
//
// readMembers picked "the largest expression statement whose text contains
// __sdfGame". Once the literal shrank below game-main's setDrawFn closure
// (leaves wave 1: ~39k chars vs ~20k), it picked the closure and crashed on
// `obj.properties` of undefined. These pin the SHAPE it selects — an assignment
// whose right-hand side is an object literal — and the eligibility rule.
import { describe, it, expect } from 'vitest';
import { readMembers, extractGroup } from './extract-seam-group';

/** A game-main.ts in miniature. `decoy` is a bigger statement that merely
 *  MENTIONS __sdfGame, which is exactly what the old size heuristic fell for. */
function fixture({ decoy = false }: { decoy?: boolean } = {}): string {
  const pad = '    // padding to make this statement the longest in the file\n'.repeat(12);
  const decoyStmt = decoy
    ? `  ctx.boot.handle.setDrawFn(() => {\n${pad}    // the __sdfGame seam owns the setters; this closure does not\n    ctx.render.frame++;\n  });\n`
    : '';
  return [
    "import * as THREE from 'three';",
    "import { makeGameContext } from './game-context';",
    '',
    'export function main(): void {',
    '  const ctx = makeGameContext();',
    '  function ceilingAt(x: number): number { return x; }',
    decoyStmt,
    '  (window as unknown as { __sdfGame: unknown }).__sdfGame = {',
    '    setFrame: (n: number) => { ctx.render.frame = n; },',
    '    bumpVersion: () => { version += 1; },',
    '    plain: () => 3,',
    '    needsCeiling: (x: number) => ceilingAt(x),',
    '  };',
    '  let version = 0;',
    '  void version;',
    '}',
    '',
  ].join('\n');
}

describe('extract-seam-group: which statement is the literal', () => {
  it('finds the __sdfGame object literal', () => {
    const { members } = readMembers(fixture());
    expect(members.map(m => m.name)).toEqual(['setFrame', 'bumpVersion', 'plain', 'needsCeiling']);
  });

  it('still finds it when a LONGER statement merely mentions __sdfGame', () => {
    const src = fixture({ decoy: true });
    // The decoy really is the longer statement — otherwise this test proves nothing.
    expect(src.indexOf('setDrawFn')).toBeGreaterThan(-1);
    const { members } = readMembers(src);
    expect(members.map(m => m.name)).toEqual(['setFrame', 'bumpVersion', 'plain', 'needsCeiling']);
  });
});

describe('extract-seam-group: eligibility', () => {
  it('lifts a ctx-only member and a member touching NO ctx slice alike', () => {
    // `plain` reads no ctx.<slice> at all. The old --slices pick required
    // slices.length > 0, which silently skipped 88 such members.
    const r = extractGroup(fixture(), 'game-seams-x', 'createXSeams', m => ['setFrame', 'plain'].includes(m.name), []);
    expect(r.picked.map(m => m.name)).toEqual(['setFrame', 'plain']);
    expect(r.module).toContain('export function createXSeams(');
    expect(r.main).toContain('...createXSeams(ctx)');
    expect(r.main).not.toContain('setFrame: (n: number)');
  });

  it('SKIPS a member that still closes over a main()-scope name, and says which', () => {
    const r = extractGroup(fixture(), 'game-seams-x', 'createXSeams', m => m.name === 'needsCeiling', []);
    expect(r.picked).toEqual([]);
    expect(r.skipped.map(m => m.name)).toEqual(['needsCeiling']);
    expect(r.skipped[0].free).toContain('ceilingAt');
    expect(r.main).toBe(fixture());
  });

  it('counts a main()-scope let referenced by a member as a free name', () => {
    const r = extractGroup(fixture(), 'game-seams-x', 'createXSeams', m => m.name === 'bumpVersion', []);
    expect(r.skipped.map(m => m.name)).toEqual(['bumpVersion']);
    expect(r.skipped[0].free).toContain('version');
  });
});
