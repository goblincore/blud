// Wound upload packing — the depth-slab cap row (2026-08-27 pale-wound fix).
// writeWounds had no dedicated test file before this; the caps row is new
// shared surface between the game (uploads caps) and the lab (must not), so
// the contract gets pinned explicitly.
import { describe, expect, it } from 'vitest';
import { writeWounds } from './zombie-gpu';
import { DATA_ROWS, ROW_WOUND, ROW_WOUND_META, ROW_WOUND_CAP, ROW_WOUND_FLAGS, ROW_WOUND_CUT } from './march.wgsl';
import { BASE_PRIM_STRIDE } from '../validate';

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

  it('a cut with a null cap zeroes a stale CAP texel (reused slot), so no inward axis survives', () => {
    const t = texels();
    writeWounds(t, [[1, 2, 3]], [0.16], [2], [0.5], [0.45], [0.85], { stride: STRIDE },
      [{ n: [0, 1, 0], depth: 0.056 }]);
    expectRow(read(t, ROW_WOUND_CAP, 0), [0, 1, 0, 0.056]);
    writeWounds(t, [[1, 2, 3]], [0.16], [2], [0.5], [0.45], [0.85], { stride: STRIDE },
      [null], undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      [{ dir: [1, 0, 0], kerf: 0.01 }]);
    expectRow(read(t, ROW_WOUND_CAP, 0), [0, 0, 0, 0]);
    expectRow(read(t, ROW_WOUND_CUT, 0), [1, 0, 0, 0.01]);
  });

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
    const texels = new Float32Array(BASE_PRIM_STRIDE * DATA_ROWS * 4);
    writeWounds(texels, [[0, 1, 0], [0.2, 1, 0]], [0.1, 0.1], [0, 0], [0, 0],
      undefined, undefined, undefined, undefined, [true, false]);
    const base = ROW_WOUND_FLAGS * BASE_PRIM_STRIDE * 4;
    expect(texels[base]).toBe(1);
    expect(texels[base + 4]).toBe(0);
  });

  it('defaults every wound to non-cavity when the argument is omitted', () => {
    const texels = new Float32Array(BASE_PRIM_STRIDE * DATA_ROWS * 4);
    writeWounds(texels, [[0, 1, 0]], [0.1], [0], [0]);
    expect(texels[ROW_WOUND_FLAGS * BASE_PRIM_STRIDE * 4]).toBe(0);
  });

  it('leaves the existing wound and meta rows untouched', () => {
    // The flags row is ADDITIVE. If this fails, a row index collided.
    const a = new Float32Array(BASE_PRIM_STRIDE * DATA_ROWS * 4);
    const b = new Float32Array(BASE_PRIM_STRIDE * DATA_ROWS * 4);
    writeWounds(a, [[0, 1, 0]], [0.1], [1], [0.5]);
    writeWounds(b, [[0, 1, 0]], [0.1], [1], [0.5], undefined, undefined, undefined, undefined, [true]);
    const wBase = ROW_WOUND * BASE_PRIM_STRIDE * 4, mBase = ROW_WOUND_META * BASE_PRIM_STRIDE * 4;
    expect(Array.from(a.slice(wBase, wBase + 4))).toEqual(Array.from(b.slice(wBase, wBase + 4)));
    expect(Array.from(a.slice(mBase, mBase + 4))).toEqual(Array.from(b.slice(mBase, mBase + 4)));
  });
});

describe('cut wounds (flag 32, ROW_WOUND_CUT)', () => {
  it('writes the along unit and kerf into ROW_WOUND_CUT and sets flag bit 32', () => {
    const stride = 128;
    const texels = new Float32Array(DATA_ROWS * stride * 4);
    writeWounds(texels, [[0, 1, 0]], [0.1], [0], [0], [1], [1], { stride }, [{ n: [0, 0, -1], depth: 0.05 }],
      undefined, undefined, undefined, undefined, undefined, undefined, [true],
      [{ dir: [0, 1, 0], kerf: 0.01 }]);
    const cut = ROW_WOUND_CUT * stride * 4;
    expect([...texels.subarray(cut, cut + 4)]).toEqual([0, 1, 0, Math.fround(0.01)]);
    const flags = ROW_WOUND_FLAGS * stride * 4;
    expect(Math.floor(texels[flags]!) & 32).toBe(32);
    expect(Math.floor(texels[flags]!) & 16).toBe(16);   // and its wet lip
  });
  it('a crater leaves ROW_WOUND_CUT untouched and has no bit 32', () => {
    const stride = 128;
    const texels = new Float32Array(DATA_ROWS * stride * 4);
    const cutBase = ROW_WOUND_CUT * stride * 4;
    texels.fill(-7, cutBase, cutBase + 4);   // sentinel: a crater must not touch the cut row
    writeWounds(texels, [[0, 1, 0]], [0.05], [0], [0], undefined, undefined, { stride });
    expect(Math.floor(texels[ROW_WOUND_FLAGS * stride * 4]!) & 32).toBe(0);
    expect([...texels.subarray(cutBase, cutBase + 4)]).toEqual([-7, -7, -7, -7]);
  });
  it('a crater reusing a cut slot clears bit 32 (the cut row is left stale, readers gate on the bit)', () => {
    const stride = 128;
    const texels = new Float32Array(DATA_ROWS * stride * 4);
    const cutBase = ROW_WOUND_CUT * stride * 4;
    writeWounds(texels, [[0, 1, 0]], [0.1], [0], [0], [1], [1], { stride }, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, [true], [{ dir: [0, 1, 0], kerf: 0.01 }]);
    expect(Math.floor(texels[ROW_WOUND_FLAGS * stride * 4]!) & 32).toBe(32);
    writeWounds(texels, [[0, 1, 0]], [0.05], [0], [0], undefined, undefined, { stride });
    expect(Math.floor(texels[ROW_WOUND_FLAGS * stride * 4]!) & 32).toBe(0);
    expect([...texels.subarray(cutBase, cutBase + 4)]).toEqual([0, 1, 0, Math.fround(0.01)]);
  });
  it('a cut keeps its sag in ROW_WOUND_META.w (offsetScales slot), and honours a custom cutRow', () => {
    const stride = 64;
    const texels = new Float32Array(30 * stride * 4);
    writeWounds(texels, [[0, 1, 0]], [0.1], [0], [0], [1], [0.037],
      { stride, woundRow: 0, metaRow: 1, capRow: 2, flagsRow: 3, cutRow: 4 }, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      [{ dir: [1, 0, 0], kerf: 0.02 }]);
    expect(texels[1 * stride * 4 + 3]).toBe(Math.fround(0.037));
    expect([...texels.subarray(4 * stride * 4, 4 * stride * 4 + 4)]).toEqual([1, 0, 0, Math.fround(0.02)]);
    expect(Math.floor(texels[3 * stride * 4]!) & 32).toBe(32);
  });
});
