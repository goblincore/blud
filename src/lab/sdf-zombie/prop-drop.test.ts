import { describe, it, expect } from 'vitest';
import { releaseProp, stepDrop, DROP } from './prop-drop';

describe('prop drop', () => {
  it('falls under gravity, lands on the floor pad, and stops', () => {
    let s = releaseProp([0, 1.0, 0], [0, 0, 0, 1], [0.5, 1.0, 0], 3);
    for (let i = 0; i < 240; i++) s = stepDrop(s, 1 / 60, 0);
    expect(s.pos[1]).toBeCloseTo(DROP.floorPad, 6);
    expect(s.resting).toBe(true);
    expect(s.pos[0]).toBeGreaterThan(0.05); // it travelled
  });
  it('tumbles while airborne and stops spinning at rest', () => {
    let s = releaseProp([0, 1.0, 0], [0, 0, 0, 1], [0, 1, 0], 3);
    const q0 = s.quat;
    s = stepDrop(s, 1 / 60, 0);
    expect(s.quat).not.toEqual(q0);
    for (let i = 0; i < 300; i++) s = stepDrop(s, 1 / 60, 0);
    const qRest = s.quat;
    expect(stepDrop(s, 1 / 60, 0).quat).toEqual(qRest);
  });
  it('is deterministic in the seed', () => {
    const a = releaseProp([0, 1, 0], [0, 0, 0, 1], [0, 1, 0], 9);
    const b = releaseProp([0, 1, 0], [0, 0, 0, 1], [0, 1, 0], 9);
    expect(a).toEqual(b);
  });
});
