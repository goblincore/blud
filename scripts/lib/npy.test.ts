import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper without type declarations (same pattern as sdf-closeup-stage.test.ts).
import { decodeNpy, encodeNpy } from './npy.mjs';

describe('npy', () => {
  it('writes a v1.0 little-endian float32 file numpy can read', () => {
    const data = new Float32Array([1, 2.5, -3, 4, 5, 6]);
    const buf: Buffer = encodeNpy(data, [1, 2, 3]);
    expect(buf.subarray(0, 6).toString('latin1')).toBe('\x93NUMPY');
    expect([buf[6], buf[7]]).toEqual([1, 0]);
    const headerLen = buf.readUInt16LE(8);
    expect((10 + headerLen) % 64).toBe(0);
    const header = buf.subarray(10, 10 + headerLen).toString('latin1');
    expect(header).toContain("'descr': '<f4'");
    expect(header).toContain("'fortran_order': False");
    expect(header).toContain("'shape': (1, 2, 3)");
    expect(header.endsWith('\n')).toBe(true);
    expect(buf.length).toBe(10 + headerLen + 24);
  });

  it('round-trips', () => {
    const data = new Float32Array(300 * 4).map((_, k) => k * 0.25);
    const { shape, data: back } = decodeNpy(encodeNpy(data, [15, 20, 4]));
    expect(shape).toEqual([15, 20, 4]);
    expect(Array.from(back)).toEqual(Array.from(data));
  });

  it('rejects a data/shape mismatch', () => {
    expect(() => encodeNpy(new Float32Array(5), [2, 3])).toThrow(/shape/);
  });
});
