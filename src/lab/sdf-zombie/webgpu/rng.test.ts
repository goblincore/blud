import { describe, it, expect } from 'vitest';
import { createRngStreams } from './rng';
describe('seeded rng streams', () => {
  it('is reproducible per seed and independent per stream', () => {
    const a = createRngStreams(1234), b = createRngStreams(1234), c = createRngStreams(1235);
    const seqA = [a.fx(), a.fx(), a.reload(), a.bleed()];
    const seqB = [b.fx(), b.fx(), b.reload(), b.bleed()];
    expect(seqA).toEqual(seqB);
    expect([c.fx(), c.fx()]).not.toEqual(seqA.slice(0, 2));
    // draining one stream does not move another
    const d = createRngStreams(1234); for (let i = 0; i < 100; i++) d.fx();
    expect(d.reload()).toBe(seqA[2]);
  });
});
