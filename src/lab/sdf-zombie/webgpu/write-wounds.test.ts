// Wound upload packing — the depth-slab cap row (2026-08-27 pale-wound fix).
// writeWounds had no dedicated test file before this; the caps row is new
// shared surface between the game (uploads caps) and the lab (must not), so
// the contract gets pinned explicitly.
import { describe, expect, it } from 'vitest';
import { writeWounds } from './zombie-gpu';
import { DATA_ROWS, ROW_WOUND, ROW_WOUND_META, ROW_WOUND_CAP, ROW_WOUND_FLAGS } from './march.wgsl';
import { MAX_PRIMS } from '../validate';

const STRIDE = 64; // any stride; tests below read through the same layout math

it('keeps the wounded limb identity and clears it when a slot is reused for an unscoped chunk wound', () => {
  const t = new Float32Array(STRIDE * DATA_ROWS * 4);
  writeWounds(t, [[0,1.4,0]], [.13], [1], [0], undefined, undefined,
    { stride: STRIDE }, undefined, [false], [{ cluster: 2, start: 18, count: 6 }]);
  expect(read(t, ROW_WOUND_FLAGS, 0)).toEqual([0,3,18,24]);
  writeWounds(t, [[0,1.4,0]], [.13], [1], [0], undefined, undefined, { stride: STRIDE });
  expect(read(t, ROW_WOUND_FLAGS, 0)).toEqual([0,0,0,0]);
});

const read = (texels: Float32Array, row: number, i: number) =>
  [...texels.slice((row * STRIDE * 4 + i * 4), (row * STRIDE * 4 + i * 4) + 4)];

/** f32 storage quantises literals; compare per element. */
const expectRow = (got: number[], want: number[]) => {
  expect(got).toHaveLength(want.length);
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 6));
};

describe('writeWounds — depth-slab cap row', () => {
  const texels = () => new Float32Array(STRIDE * DATA_ROWS * 4); // zero-initialised

  it('writes the cap when given: inward normal + depth', () => {
    const t = texels();
    const n = writeWounds(
      t,
      [[1, 2, 3]], [0.16], [2], [0.5], [0.45], [0.85],
      { stride: STRIDE },
      [{ n: [0, 1, 0], depth: 0.056 }],
    );
    expect(n).toBe(1);
    expectRow(read(t, ROW_WOUND, 0), [1, 2, 3, 0.16]);
    expectRow(read(t, ROW_WOUND_META, 0), [2, 0.5, 0.45, 0.85]);
    expectRow(read(t, ROW_WOUND_CAP, 0), [0, 1, 0, 0.056]);
  });

  it('leaves the cap row zeroed when caps are omitted — the lab path', () => {
    // The lab uploads without caps; applyWounds reads w = 0 as "uncapped"
    // and its max() selects the plain sphere term. The row must stay at the
    // allocation's zeros so the lab's field is bit-identical to pre-slab.
    const t = texels();
    writeWounds(t, [[1, 2, 3]], [0.16], [2], [0.5], [0.45], [0.85], { stride: STRIDE });
    expectRow(read(t, ROW_WOUND_CAP, 0), [0, 0, 0, 0]);
  });

  it('a null cap leaves that wound uncapped without disturbing later ones', () => {
    const t = texels();
    writeWounds(
      t,
      [[1, 0, 0], [0, 2, 0], [0, 0, 3]], [0.1, 0.1, 0.1], [1, 1, 1], [0, 0, 0],
      undefined, undefined,
      { stride: STRIDE },
      [null, { n: [1, 0, 0], depth: 0.03 }, null],
    );
    expectRow(read(t, ROW_WOUND_CAP, 0), [0, 0, 0, 0]);
    expectRow(read(t, ROW_WOUND_CAP, 1), [1, 0, 0, 0.03]);
    expectRow(read(t, ROW_WOUND_CAP, 2), [0, 0, 0, 0]);
  });

  it('stale cap rows beyond the live count are never read by applyWounds', () => {
    // The ring shrinks (wound eviction); writeWounds only touches i < n, and
    // applyWounds only loads i < woundCfg.x — stale texels past both are
    // dead. Pin that the writer doesn't clear-or-shift the whole row (that
    // would be per-frame churn for nothing).
    const t = texels();
    writeWounds(t, [[9, 9, 9]], [0.1], [1], [0], undefined, undefined, { stride: STRIDE }, [{ n: [0, 0, 1], depth: 0.02 }]);
    writeWounds(t, [[8, 8, 8]], [0.1], [1], [0], undefined, undefined, { stride: STRIDE }, []);
    // Position row rewritten, cap row left holding the previous upload —
    // harmless (unreachable), and pinned here so nobody "fixes" it into a
    // per-frame clear.
    expectRow(read(t, ROW_WOUND, 0), [8, 8, 8, 0.1]);
    expectRow(read(t, ROW_WOUND_CAP, 0), [0, 0, 1, 0.02]);
  });
});

describe('cavity flag (entrails)', () => {
  it('writes 1 for a cavity wound and 0 otherwise, on the flags row', () => {
    const texels = new Float32Array(MAX_PRIMS * DATA_ROWS * 4);
    writeWounds(texels, [[0, 1, 0], [0.2, 1, 0]], [0.1, 0.1], [0, 0], [0, 0],
      undefined, undefined, undefined, undefined, [true, false]);
    const base = ROW_WOUND_FLAGS * MAX_PRIMS * 4;
    expect(texels[base]).toBe(1);
    expect(texels[base + 4]).toBe(0);
  });

  it('defaults every wound to non-cavity when the argument is omitted', () => {
    const texels = new Float32Array(MAX_PRIMS * DATA_ROWS * 4);
    writeWounds(texels, [[0, 1, 0]], [0.1], [0], [0]);
    expect(texels[ROW_WOUND_FLAGS * MAX_PRIMS * 4]).toBe(0);
  });

  it('leaves the existing wound and meta rows untouched', () => {
    // The flags row is ADDITIVE. If this fails, a row index collided.
    const a = new Float32Array(MAX_PRIMS * DATA_ROWS * 4);
    const b = new Float32Array(MAX_PRIMS * DATA_ROWS * 4);
    writeWounds(a, [[0, 1, 0]], [0.1], [1], [0.5]);
    writeWounds(b, [[0, 1, 0]], [0.1], [1], [0.5], undefined, undefined, undefined, undefined, [true]);
    const wBase = ROW_WOUND * MAX_PRIMS * 4, mBase = ROW_WOUND_META * MAX_PRIMS * 4;
    expect(Array.from(a.slice(wBase, wBase + 4))).toEqual(Array.from(b.slice(wBase, wBase + 4)));
    expect(Array.from(a.slice(mBase, mBase + 4))).toEqual(Array.from(b.slice(mBase, mBase + 4)));
  });
});
