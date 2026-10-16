// src/lab/sdf-zombie/jaw.test.ts
//
// The per-body jaw hinge (goblin expression pass, Task 3b): `hinge=` on a .blob's jaw bone moves where the jaw hinges along the
// skull; without it every body keeps the shared JAW_HINGE (the bride's tuning), bit for bit.
import { describe, it, expect } from 'vitest';
import { JAW_HINGE, jawRestOf, openAboutHinge } from './jaw';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import bride from './characters/bride.blob?raw';
import type { Vec3 } from './types';

const head: Vec3 = [0, 1.1186, 0.0129];
const tail: Vec3 = [0, 1.3527, -0.0076];
const chin: Vec3 = [0, 1.0875, 0.0898];

describe('jawRestOf hinge', () => {
  it('defaults to JAW_HINGE.at: passing undefined is the same rest as passing nothing', () => {
    expect(jawRestOf(head, tail, chin, undefined)).toEqual(jawRestOf(head, tail, chin));
    const r = jawRestOf(head, tail, chin);
    expect(r.hinge[1]).toBeCloseTo((tail[1] - head[1]) * JAW_HINGE.at, 12);
  });

  it('a lower hinge drops the lip line instead of swinging it back', () => {
    const lip: Vec3 = [0, 1.1326 - head[1], 0.122 - head[2]]; // pivot-relative, at the goblin's lip line
    const high = jawRestOf(head, tail, chin);
    const low = jawRestOf(head, tail, chin, 0.06);
    expect(low.hinge[1]).toBeLessThan(high.hinge[1]);
    const dHigh = openAboutHinge(high, lip, 0.5), dLow = openAboutHinge(low, lip, 0.5);
    // Both drop it; the low hinge keeps it further forward.
    expect(dLow[1]).toBeLessThan(lip[1]);
    expect(dLow[2]).toBeGreaterThan(dHigh[2] + 0.02);
  });
});

describe('hinge= reaches the built body', () => {
  it('a .blob jaw bone with hinge= carries it on the resolved bone; the bride (no hinge=) does not', () => {
    const src = bride.replace(/^(\s*bone jaw\b[^\n]*)$/m, '$1 hinge=0.2');
    expect(src).not.toBe(bride);
    const withHinge = buildBody(compileBlob(parseBlob(src), compileFace(parseBlob(src))));
    expect(withHinge.bones.get('jaw')!.jawHinge).toBe(0.2);
    const plain = buildBody(compileBlob(parseBlob(bride), compileFace(parseBlob(bride))));
    expect(plain.bones.get('jaw')!.jawHinge).toBeUndefined();
  });
});
