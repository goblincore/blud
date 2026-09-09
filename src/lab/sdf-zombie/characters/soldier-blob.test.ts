import { describe, expect, it } from 'vitest';
import { buildBody } from '../build-body';
import { compileBlob } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import source from './soldier.blob?raw';

const body = () => buildBody(compileBlob(parseBlob(source)));

describe('soldier exposed anatomy', () => {
  it('authors a face-sized cranium and a distinct jaw', () => {
    const b = body();
    const head = b.bonePrims.filter(p => p.limb === 'head' && p.bone === 'skull');
    expect(head.length).toBeGreaterThanOrEqual(2);
    const cranium = head.reduce((a, p) => a.radius * a.scale[0] > p.radius * p.scale[0] ? a : p);
    expect(cranium.radius * cranium.scale[0]).toBeGreaterThan(0.07);
    expect(head.some(p => p !== cranium && p.a[1] < cranium.a[1] - 0.03)).toBe(true);
    expect(b.errors).toEqual([]);
  });

  it('authors bilateral ribs plus sternum and spine instead of torso plugs', () => {
    const torso = body().bonePrims.filter(p => p.limb === 'torso');
    const xs = torso.flatMap(p => [p.a[0], p.b[0]]);
    expect(torso.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...xs)).toBeGreaterThan(0.08);
    expect(Math.min(...xs)).toBeLessThan(-0.08);
    expect(torso.filter(p => Math.max(Math.abs(p.a[0]), Math.abs(p.b[0])) < 0.02).length).toBeGreaterThanOrEqual(2);
  });
});
