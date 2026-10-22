import { describe, it, expect } from 'vitest';
import { HOUND_TUNING, houndGapeAt, houndPose, pounceAirborne } from './hound-attack';
import { makeHoundMind } from './webgpu/enemy-mind';
import type { MindInput } from './webgpu/enemy-mind';

const input = (dist: number, over: Partial<MindInput> = {}): MindInput => ({
  dt: 1 / 60, self: { x: 0, z: 0, yaw: 0, room: 1 }, player: { x: 0, z: dist, room: 1 },
  alerted: true, hasToken: true, drift: 0, roll: 0.2, rollDrift: 0.5, ...over,
});

describe('hound attack pose', () => {
  it('is exactly zero at phase 0 and 1, so it enters and leaves the gait cleanly', () => {
    for (const v of ['bite', 'pounce'] as const) {
      for (const p of [0, 1]) {
        const pose = houndPose(p, v);
        expect(pose.rootOffset).toEqual([0, 0, 0]);
        expect(Object.keys(pose.offsets)).toEqual([]);
      }
    }
  });

  it('bite throws the head forward at the strike; pounce lifts the paws and the body', () => {
    const bite = houndPose(0.55, 'bite');
    expect(bite.offsets.head![2]).toBeGreaterThan(0.25);
    expect(bite.offsets.handL).toBeUndefined();
    const pounce = houndPose(0.55, 'pounce');
    expect(pounce.offsets.handL![1]).toBeGreaterThan(0.2);
    expect(pounce.rootOffset[1]).toBeGreaterThan(0.1);
    expect(houndPose(0.2, 'pounce').rootOffset[1], 'the wind-up crouches').toBeLessThan(-0.05);
    expect(pounceAirborne(0.4, 'pounce')).toBe(true);
    expect(pounceAirborne(0.4, 'bite')).toBe(false);
  });

  it('the jaw is wide on the wind-up and shut by the strike', () => {
    expect(houndGapeAt(0.3, 'bite')).toBeCloseTo(HOUND_TUNING.gape.bite, 6);
    expect(houndGapeAt(0.5, 'bite')).toBe(0);
    expect(houndGapeAt(0, 'pounce')).toBe(0);
  });
});

describe('makeHoundMind', () => {
  it('bites inside reach and reports contact exactly once per bite', () => {
    const mind = makeHoundMind();
    let contacts = 0, swung = false;
    for (let i = 0; i < 120; i++) {
      const out = mind.step(input(1.2));
      if (out.attack) { swung = true; expect(out.attack.variant).toBe('bite'); }
      if (out.contact) contacts++;
      if (swung && !out.attack) break;
    }
    expect(swung).toBe(true);
    expect(contacts).toBe(1);
  });

  it('pounces from the band beyond and advances toward the player', () => {
    const mind = makeHoundMind();
    let total = 0, variant = '';
    for (let i = 0; i < 180; i++) {
      const out = mind.step(input(2.8 - total));
      if (out.attack) variant = out.attack.variant;
      if (out.advance) total += out.advance[2];
      if (variant && !out.attack) break;
    }
    expect(variant).toBe('pounce');
    expect(total).toBeCloseTo(Math.min(HOUND_TUNING.pounceDistance, 2.8 - HOUND_TUNING.pounceStopShort), 2);
  });
});
