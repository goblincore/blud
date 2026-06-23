// src/sim/runner.test.ts
import { describe, it, expect } from 'vitest';
import { SimRunner } from './runner';
import { EMPTY_INPUT } from './types';

describe('SimRunner heads', () => {
  it('spawns a head and reports interpolated renders that fall under gravity', () => {
    const r = new SimRunner(1, 0, 0);
    r.spawnHead(0, 5, 0, 0, 0, 0); // 5 m up, no initial velocity
    // Advance by a fractional tic so the accumulator retains a remainder (alpha > 0).
    // A whole-tic advance leaves alpha=0, which renders the prev position (5 m);
    // the head has fallen in `cur` but isn't visible until alpha > 0.
    r.advance(1.5 / 120, () => EMPTY_INPUT);
    const renders = r.headRenders();
    expect(renders).toHaveLength(1);
    expect(renders[0]!.yMeters).toBeLessThan(5); // gravity pulled it down a touch
  });
});
