// scripts/march-private-seed-guard.test.ts
//
// Every node chain that includes the march body must be SEEDED with the one
// marchNormalRead node (src/lab/sdf-zombie/webgpu/march-private-reads.ts):
// the march body writes module-scope privates (gMarchAnchor, from the shared
// wound-masks block) and that node is their only declaration. The deferred
// surface chain was seeded with `[]` and compiled every deferred surface
// shader against an undeclared gMarchAnchor ("unresolved value
// 'gMarchAnchor'") from cd8d8d8a until 2026-09-21.
//
// Source-level because wgslFn returns an opaque function: the dependency
// graph is not inspectable without reaching into three's internals. The
// runtime proof is the shutter task-3 rig's deferred mode compiling clean.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const W = 'src/lab/sdf-zombie/webgpu';
const read = (f: string) => readFileSync(`${W}/${f}`, 'utf8');

describe('march chains are seeded with the shared private-declaring node', () => {
  it('the march body really does write a private declared only in MARCH_NORMAL_OUT', () => {
    // If this stops being true the seeding rule is moot — and this guard
    // should be revisited rather than left asserting a dead invariant.
    expect(read('march/body/blocks/post/wound-masks.wgsl.ts')).toMatch(/gMarchAnchor\s*=/);
    expect(read('march/body/surface.wgsl.ts')).toMatch(/var<private> gMarchAnchor/);
  });

  it('the forward chain seeds with marchNormalRead', () => {
    expect(read('zombie-gpu.ts')).toMatch(/wgslFn\(src, acc\.slice\(-1\)\)\],\s*\[marchNormalRead\]/);
  });

  it('the DEFERRED surface chain seeds with the same node, not []', () => {
    const src = read('deferred-sdf.ts');
    expect(src).toMatch(/import \{ marchNormalRead \} from '\.\/march-private-reads'/);
    expect(src).toMatch(/wgslFn\(src, acc\.slice\(-1\)\)\],\s*\[marchNormalRead\]/);
  });

  it('nobody builds a second copy of the declaring node', () => {
    // A second wgslFn(MARCH_NORMAL_OUT) would redeclare the privates in any
    // material that meets both chains.
    for (const f of ['zombie-gpu.ts', 'deferred-sdf.ts', 'sdf-layer.ts']) {
      expect(read(f)).not.toMatch(/wgslFn\(MARCH_NORMAL_OUT/);
    }
    expect(read('march-private-reads.ts')).toMatch(/wgslFn\(MARCH_NORMAL_OUT\)/);
  });
});
