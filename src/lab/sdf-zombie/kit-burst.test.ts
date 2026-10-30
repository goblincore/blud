import { describe, expect, it } from 'vitest';
import { PLANE_GROUND, type DebrisGround } from './debris-ground';
import { assignBurstSlots, KIT_BURST, kitBurstLaunch, kitPieceHalfHeight, layFlat, makeKitPiece, stepKitPiece } from './kit-burst';
import { qFromAxisAngle, qRotate } from './vec';

const fly = (p: ReturnType<typeof makeKitPiece>, g: DebrisGround, sec = 8) => {
  for (let t = 0; t < sec && !p.resting; t += 1 / 60) stepKitPiece(p, 1 / 60, g);
  return p;
};

describe('assignBurstSlots', () => {
  it('leaves one group per bone on its own bone', () => {
    expect(assignBurstSlots([{ joint: 2, radius: .1 }, { joint: 5, radius: .2 }], 8)).toEqual([2, 5]);
  });
  it('gives a second group on a bone a spare bone, and never one in use', () => {
    const slots = assignBurstSlots([{ joint: 0, radius: .2 }, { joint: 0, radius: .1 }, { joint: 1, radius: .1 }], 4);
    expect(slots[0]).toBe(0);
    expect(slots[2]).toBe(1);
    expect([2, 3]).toContain(slots[1]);
  });
  it('the bone goes to its largest group, and the spares to the biggest of the rest', () => {
    const slots = assignBurstSlots([{ joint: 0, radius: .05 }, { joint: 0, radius: .3 }, { joint: 0, radius: .1 }], 2);
    expect(slots[1]).toBe(0);    // largest keeps the bone
    expect(slots[2]).toBe(1);    // the one spare goes to the next biggest
    expect(slots[0]).toBe(0);    // none left: flies with the largest
  });
  it('keeps a rivet with its plate', () => {
    expect(assignBurstSlots([{ joint: 0, radius: .2 }, { joint: 0, radius: .01 }], 4)).toEqual([0, 0]);
  });
  it('does not care how many groups or bones there are', () => {
    const groups = Array.from({ length: 300 }, (_, i) => ({ joint: i % 7, radius: .05 + i * 1e-4 }));
    const slots = assignBurstSlots(groups, 21);
    expect(slots.every(s => s >= 0 && s < 21)).toBe(true);
    expect(new Set(slots).size).toBe(21);
  });
});

describe('stepKitPiece', () => {
  const half: [number, number, number] = [.12, .02, .08];
  it('flies along its launch and rests on the floor, flat', () => {
    const p = fly(makeKitPiece([0, 1.2, 0], qFromAxisAngle([1, 0, 0], .7), half, [6, 3, 0], [.3, .6, .1], 0), PLANE_GROUND);
    expect(p.resting).toBe(true);
    expect(p.pos[0]).toBeGreaterThan(1);
    const up = qRotate(p.quat, [0, 1, 0]);
    expect(Math.abs(up[1])).toBeCloseTo(1, 5);                                  // on its broad face
    expect(p.pos[1] - kitPieceHalfHeight(p.quat, p.half)).toBeCloseTo(KIT_BURST.floorPad, 5);
  });
  it('lands on the floor under it, wherever that is', () => {
    const stepUp: DebrisGround = { floorAt: x => (x > 1 ? .5 : 0), bounce: () => null };
    const p = fly(makeKitPiece([0, 2, 0], [0, 0, 0, 1], half, [4, 2, 0], [.3, .6, .1], 0), stepUp);
    expect(p.pos[0]).toBeGreaterThan(1);
    expect(p.floorY).toBe(.5);
    expect(p.pos[1] - kitPieceHalfHeight(p.quat, p.half)).toBeCloseTo(.5 + KIT_BURST.floorPad, 5);
  });
  it('stays under a ceiling', () => {
    const low: DebrisGround = { floorAt: () => 0, ceilAt: () => 1.5, bounce: () => null };
    const p = makeKitPiece([0, 1.2, 0], [0, 0, 0, 1], half, [0, 12, 0], [.3, .6, .1], 0);
    for (let i = 0; i < 40; i++) {
      stepKitPiece(p, 1 / 60, low);
      expect(p.pos[1] + kitPieceHalfHeight(p.quat, p.half)).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });
  it('stops at a wall', () => {
    const wall: DebrisGround = {
      floorAt: () => 0,
      bounce: (_a, b, v, r) => (b[0] > 1 ? { pos: [1, b[1], b[2]], vel: [-Math.abs(v[0]) * r, v[1], v[2]], normal: [-1, 0, 0] } : null),
    };
    const p = fly(makeKitPiece([0, 1, 0], [0, 0, 0, 1], half, [12, 2, 0], [.3, .6, .1], 0), wall);
    expect(p.pos[0]).toBeLessThanOrEqual(1);
  });
  it('off the map it keeps the last floor it knew', () => {
    const hole: DebrisGround = { floorAt: x => (x > .5 ? NaN : .25), bounce: () => null };
    const p = fly(makeKitPiece([0, 1, 0], [0, 0, 0, 1], half, [3, 1, 0], [.3, .6, .1], .25), hole);
    expect(p.floorY).toBe(.25);
  });
  it('is stopped if it never settles', () => {
    const p = makeKitPiece([0, 100, 0], [0, 0, 0, 1], half, [0, 0, 0], [.3, .6, .1], 0);
    for (let t = 0; t < KIT_BURST.maxAgeSec + .1; t += 1 / 60) stepKitPiece(p, 1 / 60, { floorAt: () => -1e9, bounce: () => null });
    expect(p.resting).toBe(true);
  });
  it('the launch takes velGain, and is reported as flown', () => {
    const p = makeKitPiece([0, 1, 0], [0, 0, 0, 1], half, [10, 0, 0], [.3, .6, .1], 0);
    expect(p.vel[0]).toBeCloseTo(10 * KIT_BURST.velGain);
    expect(p.launch).toEqual(p.vel);
    const fast = makeKitPiece([0, 1, 0], [0, 0, 0, 1], half, [100, 0, 0], [.3, .6, .1], 0);
    expect(fast.vel[0]).toBeCloseTo(KIT_BURST.maxSpeedMps);
  });
});

describe('kitBurstLaunch', () => {
  it('adds a push out of the body to the blast shove', () => {
    const left = kitBurstLaunch([5, 1, 0], [-.3, 1, 0], [0, 1, 0], [.5, 0, .5]);
    const right = kitBurstLaunch([5, 1, 0], [.3, 1, 0], [0, 1, 0], [.5, 0, .5]);
    expect(left[0]).toBeCloseTo(5 - KIT_BURST.burstMps);
    expect(right[0]).toBeCloseTo(5 + KIT_BURST.burstMps);
    expect(left[1]).toBeCloseTo(1);
  });
  it('a piece at the centre takes the shove and its scatter only', () => {
    expect(kitBurstLaunch([1, 2, 3], [0, 1, 0], [0, 1, 0], [.5, 0, .5])).toEqual([1, 2, 3]);
  });
  it('the rolls scatter it within bounds', () => {
    const v = kitBurstLaunch([0, 0, 0], [0, 1, 0], [0, 1, 0], [1, 1, 0]);
    expect(v[0]).toBeCloseTo(KIT_BURST.scatterMps);
    expect(v[1]).toBeCloseTo(KIT_BURST.burstUpMps);
    expect(v[2]).toBeCloseTo(-KIT_BURST.scatterMps);
  });
});

describe('layFlat', () => {
  it('turns the thinnest axis vertical, the short way', () => {
    const q = qFromAxisAngle([0, 0, 1], .3);
    const up = qRotate(layFlat(q, [.2, .01, .2]), [0, 1, 0]);
    expect(up[1]).toBeCloseTo(1, 6);
  });
  it('a cube keeps the face it is nearest', () => {
    const q = qFromAxisAngle([0, 0, 1], Math.PI / 2 - .1);
    const flat = layFlat(q, [.1, .1, .1]);
    expect(Math.abs(qRotate(flat, [1, 0, 0])[1])).toBeCloseTo(1, 6);
  });
});
