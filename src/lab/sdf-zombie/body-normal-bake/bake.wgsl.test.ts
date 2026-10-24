// src/lab/sdf-zombie/body-normal-bake/bake.wgsl.test.ts
//
// The bake kernel's TEXT, checked without a GPU (spec Tests 4): the failures that otherwise surface only at pipeline
// creation as a bare WGSL parse error. The numbers are held by the *.gpu.test.ts parity suites (npm run test:gpu).
import { describe, expect, it } from 'vitest';
import { HELPERS } from '../webgpu/march/helpers';
import { BAKE_FIELD, BAKE_GLOBALS, BAKE_LEAVES, BAKE_PRIM, FIELD_ENTRY, fieldShaderSource } from './bake.wgsl';

const strip = (s: string) => s.replace(/\/\/.*$/gm, '');
const declared = (s: string) => [...strip(s).matchAll(/\bfn\s+(\w+)\s*\(/g)].map(m => m[1]!);
const called = (s: string) => new Set([...strip(s).matchAll(/\b([a-z]\w*)\s*\(/g)].map(m => m[1]!));
/** Every fn the game's include list declares: a call to one of these from the kernel must be declared in it. */
const GAME_FNS = new Set(HELPERS.flatMap(declared));
const OWN = [['bakePrim', BAKE_PRIM], ['bakeField', BAKE_FIELD], ['fieldMain', FIELD_ENTRY]] as const;

describe('bake field WGSL text', () => {
  it('each leaf is the fn its label names, and the leaves are the game include strings themselves', () => {
    for (const [name, src] of BAKE_LEAVES) {
      expect(declared(src)[0], name).toBe(name);
      expect(HELPERS, name).toContain(src);
    }
  });

  it('declares every game helper it calls, before the call (WGSL has no forward declarations)', () => {
    const order = [...BAKE_LEAVES, ...OWN];
    const seen = new Set<string>();
    for (const [name, src] of order) {
      for (const fn of called(src)) {
        if (fn === name || !GAME_FNS.has(fn) && !OWN.some(o => o[0] === fn)) continue;
        expect(seen.has(fn), `${name} calls ${fn} before it is declared (or it is missing from BAKE_LEAVES)`).toBe(true);
      }
      seen.add(name);
    }
  });

  it('declares every private global the leaves read', () => {
    const globals = new Set(BAKE_GLOBALS.map(g => g[0]));
    for (const [name, src] of BAKE_LEAVES) {
      for (const g of strip(src).match(/\bg[A-Z]\w*/g) ?? []) expect(globals.has(g), `${name} reads ${g}`).toBe(true);
    }
    for (const [g, decl] of BAKE_GLOBALS) expect(decl).toMatch(new RegExp(`^var<private> ${g}: `));
  });

  it('never mixes && and || on one line in its own code (WGSL needs the parentheses)', () => {
    for (const [name, src] of OWN) {
      for (const line of strip(src).split('\n')) expect(/&&/.test(line) && /\|\|/.test(line), `${name}: ${line}`).toBe(false);
    }
  });

  it('assembles one module with the fieldMain entry', () => {
    const src = fieldShaderSource();
    expect(src.match(/@compute/g)).toHaveLength(1);
    expect(src).toContain('fn fieldMain(');
    expect(new Set(declared(src)).size).toBe(declared(src).length);
  });
});
