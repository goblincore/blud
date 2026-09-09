import { describe, expect, it } from 'vitest';
import { stepSoldierFootwork, type SoldierFootwork } from './soldier-footwork';
import type { Vec3 } from './types';
import { add } from './vec';

const geometry = {
  yaw: 0, groundY: .13,
  hips: [[-.068, .855, 0], [.068, .855, 0]] as [Vec3, Vec3],
  homes: [[-.22, .13, .03], [.22, .13, .03]] as [Vec3, Vec3],
  reach: [.8, .8] as [number, number],
  lift: [.07, .07] as [number, number],
};

function step(state: SoldierFootwork | undefined, speed: number, dt: number) {
  const root = state?.root ?? [0, 0, 0] as Vec3;
  return stepSoldierFootwork(state, { ...geometry, dt, fromRoot: root,
    desiredRoot: add(root, [speed * dt, 0, 0]), feet: state?.feet ?? [[-.13, .13, .03], [.13, .13, .03]] });
}

describe('Soldier floor contacts', () => {
  it('shortens the injured-side step without moving its planted support', () => {
    const span = (next: 0 | 1) => {
      const previous: SoldierFootwork = { root: [0,0,0], feet: [[-.13,.13,.03],[.13,.13,.03]],
        swing: null, next, driveSpeed: .7 };
      const result = stepSoldierFootwork(previous, { ...geometry, stepScale: [.35, .72], dt: 1 / 60,
        fromRoot: previous.root, desiredRoot: [0,0,.06], feet: previous.feet });
      expect(result.swing?.side).toBe(next);
      return Math.hypot(result.swing!.to[0] - result.swing!.from[0], result.swing!.to[2] - result.swing!.from[2]);
    };
    expect(span(1)).toBeGreaterThan(span(0) + .03);
  });

  it.each([30, 60, 120])('keeps alternating supports fixed through movement, stop and reversal at %s Hz', hz => {
    let state: SoldierFootwork | undefined;
    let supports = 0;
    for (let i = 0; i < 7 * hz; i++) {
      const speed = i < 3 * hz ? 1.25 : i < 4 * hz ? 0 : -1.25;
      const next = step(state, speed, 1 / hz);
      for (const side of [0, 1] as const) {
        if (next.swing?.side !== side) {
          expect(next.feet[side][1]).toBe(.13);
          if (state && state.swing?.side !== side) {
            expect(next.feet[side]).toEqual(state.feet[side]);
            supports++;
          }
        }
      }
      if (i === 3 * hz - 1) expect(next.root[0]).toBeGreaterThan(2);
      if (i === 4 * hz - 1) expect(next.swing).toBeNull();
      state = next;
    }
    expect(supports).toBeGreaterThan(5 * hz);
    expect(state!.root[0]).toBeLessThan(1);
  });

  it('rebases contacts with an external crowd correction without mutating the previous state', () => {
    let state = step(undefined, 0, 1 / 60);
    for (let i = 0; i < 60; i++) state = step(state, 0, 1 / 60);
    const saved = structuredClone(state);
    const shift: Vec3 = [3, 0, -2];
    const root = add(state.root, shift);
    const result = stepSoldierFootwork(state, { ...geometry, dt: 1 / 60,
      fromRoot: root, desiredRoot: root, feet: [add(state.feet[0], shift), add(state.feet[1], shift)] });
    expect(result.feet).toEqual(state.feet.map(p => add(p, shift)));
    expect(result.root).toEqual(root);
    expect(state).toEqual(saved);
  });
});
