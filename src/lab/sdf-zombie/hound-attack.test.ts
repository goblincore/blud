import { describe, it, expect } from 'vitest';
import { GIBBET_TUNING, HOUND_TUNING, houndGapeAt, houndPose, pounceAirborne } from './hound-attack';
import { makeGibbetMind, makeHoundMind } from './webgpu/enemy-mind';
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

describe('the gibbet\'s stab and squirt', () => {
  it('the stab rears both front legs up, then drives the tips forward; the squirt swings the sac', () => {
    const rear = houndPose(0.2, 'stab'), thrust = houndPose(0.55, 'stab');
    expect(rear.offsets.handL![1]).toBeGreaterThan(0.3);
    expect(thrust.offsets.handL![2]).toBeGreaterThan(0.35);
    expect(thrust.offsets.handR).toEqual(thrust.offsets.handL);
    expect(pounceAirborne(0.5, 'stab')).toBe(true);
    expect(houndPose(0.2, 'squirt').offsets.hem![2], 'sac swings back').toBeLessThan(-0.1);
    expect(houndPose(0.55, 'squirt').offsets.hem![2], 'then forward').toBeGreaterThan(0.2);
    expect(houndGapeAt(0.3, 'stab')).toBe(0);
  });

  it('stabs a player inside its reach, contact exactly once', () => {
    const mind = makeGibbetMind();
    let contacts = 0, swung = false, fired = 0;
    for (let i = 0; i < 240; i++) {
      const out = mind.step(input(1.5));
      if (out.attack) { swung = true; expect(out.attack.variant).toBe('stab'); }
      if (out.contact) contacts++;
      if (out.fire) fired++;
      if (swung && !out.attack) break;
    }
    expect(swung).toBe(true);
    expect(contacts).toBe(1);
    expect(fired).toBe(0);
  });

  it('squirts at a player out of reach: halts, faces, one glob per squirt, then cools down', () => {
    const mind = makeGibbetMind();
    let fired = 0, squirts = 0, wasSquirting = false;
    // Two squirts and the cooldown between them, ending well before a third would start.
    const secs = GIBBET_TUNING.squirtFirst + 2 * GIBBET_TUNING.squirtSec + GIBBET_TUNING.squirtCooldown + 0.5;
    for (let i = 0; i < secs * 60; i++) {
      const out = mind.step(input(6));
      const squirting = out.attack?.variant === 'squirt';
      if (squirting) { expect(out.halt).toBe(true); expect(out.faceHeading).toBeCloseTo(0, 6); }
      if (squirting && !wasSquirting) squirts++;
      wasSquirting = squirting;
      if (out.fire) fired++;
    }
    expect(squirts).toBe(2);
    expect(fired).toBe(2);
  });

  it('does not squirt at a player it cannot see', () => {
    const mind = makeGibbetMind();
    for (let i = 0; i < 300; i++) expect(mind.step(input(6, { lineOfSight: false })).fire).toBe(false);
  });
});
