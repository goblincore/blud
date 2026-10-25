// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyInSight, sectorOcclusion } from './actor-sight';
import { parseSectorLevel } from './sector-json';
import { buildSectorGround } from './sector-ground';
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

// The committed sectors fixture (sector-ray.test.ts): A (x −4..4, z −8..0, floor 0, ceil 4, with the
// column hole x −1..1, z −5..−3), B (z −8..−12, floor 0.5), C (z −12..−16, floor 1.5), D (x 4..8,
// z −8..0, floor −1, sky ceiling). No boxes: on a sector level the walls are only lines.
describe('bodyInSight on a sector level (sectorOcclusion)', () => {
  const map = parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'))).sectors!;
  const occ = sectorOcclusion(map, buildSectorGround(map));
  const body = (x: number, y: number, z: number): ReturnType<typeof sphere>[] =>
    [sphere([x, y + 1.2, z], 0.3), sphere([x, y + 1.7, z], 0.15), sphere([x, y + 0.5, z], 0.25)];

  it('hides a body behind the column that the boxes-only test would draw', () => {
    const eye: Vec3 = [0, 1.6, -0.5];
    expect(bodyInSight(eye, body(0, 0, -7), [])).toBe(true);
    expect(bodyInSight(eye, body(0, 0, -7), [], occ)).toBe(false);
  });

  it('keeps a body whose centres are behind the column but whose edge clears its corner', () => {
    const eye: Vec3 = [0, 1.6, -0.5];
    // Torso centre ray crosses z −3 at x 0.96 (inside the column); its right edge at x 1.08 (outside).
    const torso = sphere([2.5, 1.2, -7], 0.3);
    expect(bodyInSight(eye, [{ ...torso, radius: 0 }], [], occ)).toBe(false);
    expect(bodyInSight(eye, [torso], [], occ)).toBe(true);
  });

  it('sees through two-sided openings: up the step into B, and down into the sky pit D', () => {
    expect(bodyInSight([3, 1.6, -1], body(3, 0.5, -10), [], occ)).toBe(true);
    expect(bodyInSight([2, 1.6, -4], body(6, -1, -4), [], occ)).toBe(true);
  });

  it('hides a body in the pit below the lip from a low eye, every probe included', () => {
    const eye: Vec3 = [-3, 0.2, -1];
    const low = [sphere([6, -0.6, -7], 0.2)];
    expect(bodyInSight(eye, low, [])).toBe(true);
    expect(bodyInSight(eye, low, [], occ)).toBe(false);
  });

  it('a hit within the slack of the probe is the body\'s own spot, not a wall in front of it', () => {
    // 5 cm past A's north wall line: the wall is hit 5 cm short of the probe point.
    expect(occ([0, 1.6, -2], [0, 1, 0.05], 0.1)).toBe(false);
    expect(occ([0, 1.6, -2], [0, 1, 0.5], 0.1)).toBe(true);
  });

  it('never culls from an eye it cannot judge (in the column, under the floor)', () => {
    expect(bodyInSight([0, 1.6, -4], body(0, 0, -7), [], occ)).toBe(true);
    expect(bodyInSight([3, -0.5, -1], body(3, 0, -6), [], occ)).toBe(true);
  });
});
