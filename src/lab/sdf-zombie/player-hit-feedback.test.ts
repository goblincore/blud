// src/lab/sdf-zombie/player-hit-feedback.test.ts
import { describe, it, expect } from 'vitest';
import { makeHitFeedback, hitFeedback, stepHitFeedback, HIT_FEEDBACK } from './player-hit-feedback';

describe('player hit feedback', () => {
  it('rests at zero', () => {
    const s = makeHitFeedback();
    expect(s.flash).toBe(0);
    expect(s.hits).toBe(0);
  });

  it('a hit flashes full and counts', () => {
    const s = hitFeedback(makeHitFeedback(), 'cleave');
    expect(s.flash).toBe(1);
    expect(s.shake).toBe(HIT_FEEDBACK.shake.cleave);
    expect(s.hits).toBe(1);
  });

  it('decays to zero within the fade time and never below', () => {
    let s = hitFeedback(makeHitFeedback(), 'sweep');
    for (let i = 0; i < 60; i++) s = stepHitFeedback(s, HIT_FEEDBACK.fadeSec / 30);
    expect(s.flash).toBe(0);
    expect(s.shake).toBe(0);
    expect(s.hits).toBe(1);
  });

  it('shake offset is deterministic in time', () => {
    const s = hitFeedback(makeHitFeedback(), 'cleave');
    expect(stepHitFeedback(s, 0.01).offset).toEqual(stepHitFeedback(s, 0.01).offset);
  });
});
