import { describe, expect, it } from 'vitest';
import { bodyInSight } from './actor-sight';
import type { Aabb } from './game-level';
import type { Vec3 } from '../types';

// A wall along +X from x = 0: the player at the origin side looks down -Z and
// a body stands behind the wall's end, leaning out past the corner.
const wall: Aabb = { min: [0, 0, -4.2], max: [6, 3, -3.8] };
const eye: Vec3 = [-1, 1.6, 0];
const sphere = (center: Vec3, radius: number) => ({ center, radius, alive: true });

describe('bodyInSight', () => {
  it('sees a body whose torso is hidden but whose arm reaches past the corner (the peek bug)', () => {
    const clusters = [
      sphere([1.2, 1.2, -5], 0.35),   // torso: behind the wall
      sphere([1.2, 1.75, -5], 0.2),   // head: behind the wall too
      sphere([-0.4, 1.3, -5], 0.15),  // arm: past the wall's end at x = 0
    ];
    // The old test: torso centre and the point 0.6 m above it — both blocked.
    expect(bodyInSight(eye, [clusters[0]!], [wall])).toBe(false);
    expect(bodyInSight(eye, clusters, [wall])).toBe(true);
  });

  it('sees a sphere whose CENTRE is hidden but whose edge clears the corner', () => {
    // The centre ray crosses the wall plane at x = 0.04 (blocked); the near edge clears it.
    expect(bodyInSight(eye, [sphere([0.3, 1.2, -5], 0.3)], [wall])).toBe(true);
  });

  it('does not see a body fully behind the wall', () => {
    expect(bodyInSight(eye, [sphere([3, 1.2, -5], 0.35), sphere([3, 1.75, -5], 0.2)], [wall])).toBe(false);
  });

  it('ignores dead clusters, and sees everything when nothing occludes', () => {
    expect(bodyInSight(eye, [{ center: [-0.4, 1.3, -5], radius: 0.15, alive: false }], [wall])).toBe(false);
    expect(bodyInSight(eye, [sphere([3, 1.2, -5], 0.35)], [])).toBe(true);
  });

  it('handles a body directly above/below the eye (no horizontal side vector)', () => {
    expect(bodyInSight([0, 0, 0], [sphere([0, 3, 0], 0.3)], [])).toBe(true);
  });
});
