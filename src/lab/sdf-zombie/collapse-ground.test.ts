// src/lab/sdf-zombie/collapse-ground.test.ts
//
// A corpse on the ground (collapse.ts): THE FLOOR GRIPS (floorGrip) and THE FOOT TURNS WITH THE SHIN (carryFeet).
import { describe, expect, it } from 'vitest';
import { carryFeet, FLOOR_GRIP, floorGrip, type HipCone } from './collapse';
import type { RigPoint } from './rig';
import type { Vec3 } from './types';

const pt = (pos: Vec3, prev: Vec3 = pos, pinned = false): RigPoint => ({ pos: [...pos] as Vec3, prev: [...prev] as Vec3, pinned });
const floor0 = () => 0;

describe('floorGrip', () => {
  /** The whole-body grip alone. */
  const BODY = { ...FLOOR_GRIP, pointStick: 0 };
  /** A body lying on the floor: four points in a 0.6 x 0.3 m patch, and one held up off it. */
  const lying = (): RigPoint[] => [pt([0, 0, 0]), pt([0.6, 0, 0]), pt([0, 0, 0.3]), pt([0.6, 0, 0.3]), pt([0.3, 0.4, 0.15])];
  const moved = (ps: RigPoint[], f: (p: Vec3, i: number) => Vec3, keepSpeed = false) =>
    ps.map((p, i) => { const q = f(p.pos, i); return pt(q, keepSpeed ? p.prev : q); });
  const turnY = (t: number) => (p: Vec3): Vec3 => {
    const x = p[0] - 0.3, z = p[2] - 0.15;
    return [0.3 + x * Math.cos(t) + z * Math.sin(t), p[1], 0.15 - x * Math.sin(t) + z * Math.cos(t)];
  };

  it('takes back a whole body\'s creep, every point, with its speed', () => {
    const before = lying();
    const after = moved(before, p => [p[0] + 0.002, p[1], p[2] - 0.001], true);
    const out = floorGrip(before, after, floor0, BODY);
    out.forEach((p, i) => { expect(p.pos[0]).toBeCloseTo(before[i]!.pos[0], 9); expect(p.pos[2]).toBeCloseTo(before[i]!.pos[2], 9); });
    out.forEach(p => expect(Math.hypot(p.pos[0] - p.prev[0], p.pos[2] - p.prev[2])).toBeLessThan(1e-9));
  });

  it('takes back a whole body\'s slow turn about the vertical', () => {
    const before = lying();
    const out = floorGrip(before, moved(before, turnY(0.004)), floor0, BODY);
    // To a micron: the turn is measured as a small angle.
    out.forEach((p, i) => { expect(p.pos[0]).toBeCloseTo(before[i]!.pos[0], 6); expect(p.pos[2]).toBeCloseTo(before[i]!.pos[2], 6); });
  });

  it('drags a sliding body by `stick` a step', () => {
    const before = lying();
    const out = floorGrip(before, moved(before, p => [p[0] + 0.05, p[1], p[2]]), floor0, BODY);
    out.forEach((p, i) => expect(p.pos[0] - before[i]!.pos[0]).toBeCloseTo(0.05 - FLOOR_GRIP.stick, 9));
  });

  it('lets the body change shape: one point moving alone keeps most of its move', () => {
    // With only four contacts, a lone mover's move is partly a whole-body turn by least squares and that share is
    // taken back (a corpse has a dozen or more): it keeps 60% here, and the hip cone pushes again the next step.
    const before = lying();
    // The hip cone pulls one leg 2 mm sideways; nothing else moves.
    const after = moved(before, (p, i) => i === 1 ? [p[0], p[1], p[2] + 0.002] : p);
    const out = floorGrip(before, after, floor0, BODY);
    const legMove = out[1]!.pos[2] - out[0]!.pos[2] - (before[1]!.pos[2] - before[0]!.pos[2]);
    expect(legMove).toBeGreaterThan(0.0011);
  });

  it('then grips each resting point on its own, under pointStick', () => {
    const before = lying();
    // One point creeps 1 mm on its own: the body grip takes back its rigid share, the point grip the rest.
    const after = moved(before, (p, i) => i === 1 ? [p[0], p[1], p[2] + 0.001] : p);
    const out = floorGrip(before, after, floor0, { ...FLOOR_GRIP, pointStick: 0.0015 });
    expect(out[1]!.pos[2]).toBeCloseTo(before[1]!.pos[2], 9);
    // A big move keeps all but pointStick of what the body grip left it.
    const big = moved(before, (p, i) => i === 1 ? [p[0], p[1], p[2] + 0.02] : p);
    const kept = floorGrip(before, big, floor0, BODY)[1]!.pos[2] - before[1]!.pos[2];
    const both = floorGrip(before, big, floor0, { ...FLOOR_GRIP, pointStick: 0.0015 })[1]!.pos[2] - before[1]!.pos[2];
    expect(both).toBeCloseTo(kept - 0.0015, 4);   // the leftover move is slightly diagonal after the turn
  });

  it('leaves a body with fewer than three points on the floor, and pinned points, alone', () => {
    const before = [pt([0, 0, 0]), pt([0.5, 0, 0]), pt([0.2, 0.4, 0])];
    const after = moved(before, p => [p[0] + 0.002, p[1], p[2]]);
    expect(floorGrip(before, after, floor0, BODY)).toBe(after);
    const b2 = lying(), a2 = moved(b2, p => [p[0] + 0.002, p[1], p[2]]);
    a2[4] = { ...a2[4]!, pinned: true };
    expect(floorGrip(b2, a2, floor0, BODY)[4]).toBe(a2[4]);
  });
});

describe('carryFeet', () => {
  // knee 0, foot 1, toe 2: a shin straight down with the foot pointing +z.
  const cone = { knee: 0, foot: 1, ankle: { toe: 2, pitch: 0, yaw: 0, fwdSign: 1 } } as unknown as HipCone;
  const shin = (angle: number, toe?: Vec3) => {
    const foot: Vec3 = [0, 1 - Math.cos(angle) * 0.5, Math.sin(angle) * 0.5];
    return [pt([0, 1, 0]), pt(foot), pt(toe ?? [foot[0], foot[1], foot[2] + 0.16])];
  };
  const footAngle = (p: readonly RigPoint[]) => {
    const s = [0, 1, 2].map(k => p[1]!.pos[k]! - p[0]!.pos[k]!), t = [0, 1, 2].map(k => p[2]!.pos[k]! - p[1]!.pos[k]!);
    return Math.acos((s[0]! * t[0]! + s[1]! * t[1]! + s[2]! * t[2]!) / Math.hypot(...s) / Math.hypot(...t)) * 180 / Math.PI;
  };

  it('turns the toe with the shin, keeping the foot\'s angle to it', () => {
    const before = shin(0);
    // The shin swings 40 deg forward in a step; the toe stays where it was (its own inertia).
    const swung = shin(40 * Math.PI / 180), after = [swung[0]!, swung[1]!, pt(before[2]!.pos)];
    const out = carryFeet(before, after, [cone], () => -1, { share: 1, minTurn: 0 });
    expect(footAngle(out)).toBeCloseTo(footAngle(before), 3);
    // No speed added: prev moved with pos.
    const d = [0, 1, 2].map(k => out[2]!.pos[k]! - out[2]!.prev[k]!);
    expect(Math.hypot(...d)).toBeLessThan(1e-9);
  });

  it('leaves the foot of a shin that barely turned alone (a resting leg)', () => {
    const before = shin(0), after = shin(0.5 * Math.PI / 180);
    expect(carryFeet(before, after, [cone], () => -1)).toBe(after);
  });

  it('leaves a toe on its floor, and a pinned toe, where they are', () => {
    const before = shin(0), swung = shin(0.7);
    const onFloor = [swung[0]!, swung[1]!, pt([0, 0.5, 0.16])];
    expect(carryFeet(before, onFloor, [cone], () => 0.5)).toBe(onFloor);
    const pinned = [swung[0]!, swung[1]!, pt(before[2]!.pos, before[2]!.pos, true)];
    expect(carryFeet(before, pinned, [cone], () => -1)).toBe(pinned);
  });
});
