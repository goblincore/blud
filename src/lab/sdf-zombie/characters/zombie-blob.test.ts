// src/lab/sdf-zombie/characters/zombie-blob.test.ts
import { describe, it, expect } from 'vitest';
import src from './zombie.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob } from '../blob-compile';
import { buildBody } from '../build-body';
import { makeZombie } from '../body';

const fromBlob = () => buildBody(compileBlob(parseBlob(src)));
const fromTs = () => buildBody(makeZombie());

describe('zombie.blob is the zombie', () => {
  it('compiles with no validation errors', () => {
    expect(fromBlob().errors).toEqual([]);
  });

  it('produces the same primitive and cluster counts', () => {
    expect(fromBlob().prims).toHaveLength(fromTs().prims.length);
    expect(fromBlob().clusters.map(c => c.limb)).toEqual(fromTs().clusters.map(c => c.limb));
  });

  // dir is normalised at resolve time, so bone POSITIONS are the honest
  // comparison — not the raw dir arrays, which differ in magnitude by design.
  it('resolves every bone to the same head and tail within 0.1 mm', () => {
    const a = fromBlob().bones, b = fromTs().bones;
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [name, bone] of a) {
      const ref = b.get(name)!;
      bone.head.forEach((v, i) => expect(v).toBeCloseTo(ref.head[i]!, 4));
      bone.tail.forEach((v, i) => expect(v).toBeCloseTo(ref.tail[i]!, 4));
    }
  });

  it('places every primitive at the same endpoints and radius', () => {
    const a = fromBlob().prims, b = fromTs().prims;
    a.forEach((p, i) => {
      expect(p.radius).toBeCloseTo(b[i]!.radius, 6);
      expect(p.blendK).toBeCloseTo(b[i]!.blendK, 6);
      expect(p.limb).toBe(b[i]!.limb);
      p.a.forEach((v, j) => expect(v).toBeCloseTo(b[i]!.a[j]!, 4));
      p.b.forEach((v, j) => expect(v).toBeCloseTo(b[i]!.b[j]!, 4));
    });
  });
});
