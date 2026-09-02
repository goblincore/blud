// src/lab/sdf-zombie/webgpu/surface-nets.wgsl.test.ts
import { describe, expect, it } from 'vitest';
import { MAP_BODY } from './march.wgsl';
import {
  HULL_FIELD, K_HULL_NETS, K_VERT_AT, K_PUT_V, K_EMIT_QUAD, K_HULL_QUADS, K_HULL_ARGS,
  HULL_NETS_CHAIN, HULL_QUADS_CHAIN, MAX_SOUP_VERTS,
} from './surface-nets.wgsl';
import {
  BLOCK, NO_VERT, EDGE_X_CROSS, EDGE_X_IN2OUT, EDGE_Y_CROSS, EDGE_Y_IN2OUT, EDGE_Z_CROSS, EDGE_Z_IN2OUT,
  VERT_PULL_TARGET, VERT_PULL_ITERS,
} from './surface-nets-cpu';

/** three's wgslFn parser: ^-anchored `fn`, and it scrapes `name: type` pairs
 *  out of the parameter list INCLUDING comments — a colon between two words
 *  inside the signature is a phantom parameter. */
function signature(src: string): string {
  const open = src.indexOf('(');
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    if (src[i] === ')') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced');
}

describe('surface-nets WGSL parse contract', () => {
  for (const [name, src] of Object.entries({ HULL_FIELD, K_HULL_NETS, K_VERT_AT, K_PUT_V, K_EMIT_QUAD, K_HULL_QUADS, K_HULL_ARGS })) {
    it(`${name} starts with fn and has no colon-in-comment in its signature`, () => {
      expect(src.startsWith('fn ')).toBe(true);
      const sig = signature(src);
      for (const line of sig.split('\n')) {
        const c = line.indexOf('//');
        if (c >= 0) expect(line.slice(c)).not.toMatch(/\w\s*:\s*\w/);
      }
    });
  }
  it('HULL_FIELD passes mapBody exactly the arguments MAP_BODY declares', () => {
    const declared = signature(MAP_BODY).split(',').length;
    const call = HULL_FIELD.match(/mapBody\(([^;]*)\)\.x/)![1]!;
    // count top-level commas in the call
    let depth = 0, n = 1;
    for (const ch of call) { if (ch === '(') depth++; else if (ch === ')') depth--; else if (ch === ',' && depth === 0) n++; }
    expect(n).toBe(declared);
  });
  it('kernel constants match the CPU reference, each declared ONCE per chain', () => {
    expect(K_HULL_NETS).toContain(`const BLOCK: i32 = ${BLOCK};`);
    expect(K_HULL_NETS).toContain(`const NO_VERT: u32 = ${NO_VERT}u;`);
    expect(K_VERT_AT).toContain(`const NO_VERT: u32 = ${NO_VERT}u;`);
    expect(K_EMIT_QUAD).toContain(`const MAX_SOUP_VERTS: u32 = ${MAX_SOUP_VERTS}u;`);
    expect(K_HULL_ARGS).toContain(`const MAX_SOUP_VERTS: u32 = ${MAX_SOUP_VERTS}u;`);
    for (const [k, v] of Object.entries({ EDGE_X_CROSS, EDGE_X_IN2OUT, EDGE_Y_CROSS, EDGE_Y_IN2OUT, EDGE_Z_CROSS, EDGE_Z_IN2OUT })) {
      expect(K_HULL_NETS).toContain(`const ${k}: u32 = ${v}u;`);
      expect(K_HULL_QUADS).toContain(`const ${k}: u32 = ${v}u;`);
    }
    // The sub-iso vertex pull (surface-nets-cpu.ts header deviation note) is
    // load-bearing for band coverage — pin its constants in the kernel too.
    expect(K_HULL_NETS).toContain(`const VERT_PULL_TARGET: f32 = ${VERT_PULL_TARGET};`);
    expect(K_HULL_NETS).toContain(`const VERT_PULL_ITERS: i32 = ${VERT_PULL_ITERS};`);
    // A module-scope const declared twice in one chain is a WGSL error.
    const quadsModule = HULL_QUADS_CHAIN.join('\n');
    expect(quadsModule.match(/const NO_VERT:/g)!.length).toBe(1);
    expect(quadsModule.match(/const MAX_SOUP_VERTS:/g)!.length).toBe(1);
  });
  it('chains are in dependency order', () => {
    expect(HULL_NETS_CHAIN).toEqual([HULL_FIELD, K_HULL_NETS]);
    expect(HULL_QUADS_CHAIN).toEqual([K_VERT_AT, K_PUT_V, K_EMIT_QUAD, K_HULL_QUADS]);
  });
  it('steers clear of the two Tint rejections the spike page hit (2026-09-02)', () => {
    // 'meta' is a RESERVED KEYWORD in WGSL — using it as a parameter name
    // fails shader-module creation.
    expect(signature(K_HULL_ARGS)).not.toMatch(/\bmeta\b/);
    // A barrier reached after a branch on a workgroup-storage READ is
    // non-uniform control flow to Tint. The live test is recomputed per
    // thread; there is no broadcast variable.
    expect(K_HULL_NETS).not.toContain('gBlockLive');
    const barrierIdx = K_HULL_NETS.indexOf('workgroupBarrier');
    expect(barrierIdx).toBeGreaterThan(-1);
    // every barrier sits at statement depth inside the fn body, not nested
    // under an if/for (uniform control flow by construction)
    for (const m of K_HULL_NETS.matchAll(/workgroupBarrier/g)) {
      const lineStart = K_HULL_NETS.lastIndexOf('\n', m.index!) + 1;
      expect(K_HULL_NETS.slice(lineStart, m.index)).toBe('  ');
    }
  });
});
