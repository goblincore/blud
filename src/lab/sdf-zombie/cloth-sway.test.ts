// CLOTH SWAY: the folds swing back from a walk, stay small, ease (no jump in a frame), and settle when the body stops.
import { describe, expect, it } from 'vitest';
import { CLOTH_SWAY_MAX, stepClothSway, type ClothSway } from './cloth-sway';

const run = (s: ClothSway, path: (i: number) => [number, number, number], frames: number, dt = 1 / 60) => {
  const out: ClothSway[] = [];
  for (let i = 1; i <= frames; i++) { s = stepClothSway(s, path(i - 1), path(i), dt); out.push(s); }
  return out;
};
const rest: ClothSway = { x: 0, z: 0, vx: 0, vz: 0 };

describe('cloth sway', () => {
  it('a walk swings the folds back, eased and bounded', () => {
    const walk = run(rest, i => [0, i / 60, 0], 240); // 1 m/s along +z
    expect(Math.abs(walk[0]!.z)).toBeLessThan(0.001); // no snap on the first frame
    expect(walk[239]!.z).toBeLessThan(-0.02);         // swung back, against the walk
    for (const s of walk) expect(Math.hypot(s.x, s.z)).toBeLessThan(CLOTH_SWAY_MAX * 1.4);
  });

  it('settles back to rest when the body stops', () => {
    const walked = run(rest, i => [0, i / 60, 0], 120).at(-1)!;
    const stopped = run(walked, () => [0, 2, 0], 600).at(-1)!;
    expect(Math.hypot(stopped.x, stopped.z)).toBeLessThan(1e-4);
  });

  it('turning to track a strafing player barely moves it', () => {
    const turn = run(rest, i => [0, 0, Math.sin(i / 30) * 0.8], 300); // swinging round to face, 1.6 rad/s at peak
    for (const s of turn) expect(Math.hypot(s.x, s.z)).toBeLessThan(0.01);
  });

  it('a jump (spawn, teleport) is not a step', () => {
    expect(Math.hypot(...Object.values(run(rest, i => (i < 1 ? [0, 0, 0] : [5, 5, 0]), 1)[0]!).slice(0, 2))).toBe(0);
  });
});
