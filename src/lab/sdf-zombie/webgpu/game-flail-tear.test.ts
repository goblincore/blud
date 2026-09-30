// src/lab/sdf-zombie/webgpu/game-flail-tear.test.ts
//
// The flail's wounds are torn (torn-lips.ts, plan 2026-09-26-spike-flail.md Task 31): body craters by
// swing, every head crater at full, with an A/B switch (__sdfGame.flail.setTear).
import { describe, expect, it } from 'vitest';
import { FLAIL_TEAR, flailTear, setFlailTear } from '../torn-lips';
import flailSrc from './game-flail.ts?raw';
import headSrc from './game-head-damage.ts?raw';
import seamSrc from './game-seams-flail.ts?raw';

describe('the flail tears its wounds', () => {
  it('the flail tears body craters by swing and head craters at full; the switch turns it off', () => {
    expect(FLAIL_TEAR).toEqual({ H: 1.0, R: 0.8, L: 0.8, head: 1.0 });
    setFlailTear(false);
    expect(flailTear('H')).toBe(0);
    setFlailTear(true);
    expect(flailTear('R')).toBe(0.8);
    expect(flailSrc).toContain('tearWound(w, flailTear(side));');
    expect(seamSrc).toContain('setTear: (on: boolean) => ctx.weapon.flail?.setTear(on) ?? null');
    expect(headSrc).toContain("return tearWound(clothifyWound(posed.prims, w, 'heavy'), flailTear('head'));");
    expect(headSrc).toContain("tearWound(w, flailTear('head'));");
  });
});
