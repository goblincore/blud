// src/lab/sdf-zombie/webgpu/crt-handoff.test.ts
import { describe, expect, it } from 'vitest';
import { CRT_KEY, CRT_MAX_CHARS, clearCrtPicture, loadCrtPicture, looksBlank, saveCrtPicture, type KeyValueStorage } from './crt-handoff';

const store = (): KeyValueStorage & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('crt-handoff storage', () => {
  it('round-trips a PNG data URL and clears it', () => {
    const s = store();
    expect(saveCrtPicture(s, PNG)).toBe(true);
    expect(s.m.has(CRT_KEY)).toBe(true);
    expect(loadCrtPicture(s)).toBe(PNG);
    clearCrtPicture(s);
    expect(loadCrtPicture(s)).toBeNull();
  });
  it('refuses what is not a PNG data URL, and what is over the cap', () => {
    const s = store();
    expect(saveCrtPicture(s, 'data:image/jpeg;base64,AAAA')).toBe(false);
    expect(saveCrtPicture(s, 'http://x/y.png')).toBe(false);
    expect(saveCrtPicture(s, PNG + 'A'.repeat(CRT_MAX_CHARS))).toBe(false);
    expect(s.m.size).toBe(0);
  });
  it('loads null for a malformed stored value', () => {
    const s = store();
    s.m.set(CRT_KEY, 'javascript:alert(1)');
    expect(loadCrtPicture(s)).toBeNull();
  });
  it('never throws when the storage does', () => {
    const boom: KeyValueStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
    expect(saveCrtPicture(boom, PNG)).toBe(false);
    expect(loadCrtPicture(boom)).toBeNull();
    expect(() => clearCrtPicture(boom)).not.toThrow();
  });
});

describe('looksBlank', () => {
  const px = (n: number, f: (i: number) => [number, number, number]) => {
    const a = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { const [r, g, b] = f(i); a.set([r, g, b, 255], i * 4); }
    return a;
  };
  it('is true for a flat colour (black, white or transparent), false for a picture', () => {
    expect(looksBlank(px(100, () => [0, 0, 0]))).toBe(true);
    expect(looksBlank(px(100, () => [255, 255, 255]))).toBe(true);
    expect(looksBlank(new Uint8ClampedArray(400))).toBe(true);
    expect(looksBlank(px(100, i => [i * 2, 255 - i * 2, (i * 7) % 255]))).toBe(false);
  });
});
