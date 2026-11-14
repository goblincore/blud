// wail.ts — the organ's chord of slow notes, and the `wail` pose (hound-attack.ts). Pure.
import { describe, it, expect } from 'vitest';
import { ORGAN_TUNING, WAIL, spawnWailNote, stepWailNotes, wailNotesCrossed, wailPlayerDamage, wailWobble } from './wail';
import { houndGapeAt, houndPose, wailEnvelope } from './hound-attack';
import type { Vec3 } from './types';

const never = { hitsWorld: () => false, hitsPlayer: () => false };

describe('wail notes', () => {
  it('fly straight at WAIL.speed, fanned to the body\'s left on a positive yaw', () => {
    const n = spawnWailNote([0, 1.4, 0], [0, 1.4, 10], 1);
    expect(Math.hypot(...n.vel)).toBeCloseTo(WAIL.speed, 6);
    expect(n.vel[0]).toBeCloseTo(0, 6);
    const left = spawnWailNote([0, 1.4, 0], [0, 1.4, 10], 1, 0.09);
    expect(left.vel[0]).toBeGreaterThan(0);
    // Sound does not fall: after a second it is still at its height.
    let live = [n];
    for (let i = 0; i < 60; i++) live = stepWailNotes(live, 1 / 60, never).live;
    expect(live[0]!.pos[1]).toBeCloseTo(1.4, 6);
    expect(live[0]!.pos[2]).toBeCloseTo(WAIL.speed, 3);
  });

  it('burst on the player (full hit), on a wall beside them (a shove), and expire unharmed', () => {
    const mid: Vec3 = [0, 1, 3];
    expect(wailPlayerDamage({ at: [0, 1, 2.9], cause: 'player', owner: 1 }, mid)).toBe(WAIL.playerDamage);
    expect(wailPlayerDamage({ at: [0.5, 1, 3], cause: 'world', owner: 1 }, mid)).toBe(WAIL.splashDamage);
    expect(wailPlayerDamage({ at: [3, 1, 3], cause: 'world', owner: 1 }, mid)).toBe(0);
    expect(wailPlayerDamage({ at: [0, 1, 3], cause: 'age', owner: 1 }, mid)).toBe(0);
    // Unarmed notes pass through the player (they leave from inside the bell).
    const n = spawnWailNote([0, 1, 0], [0, 1, 1], 1);
    expect(stepWailNotes([n], 1 / 60, { hitsWorld: () => true, hitsPlayer: () => true }).bursts).toEqual([]);
  });

  it('trembles as drawn, never on its true path', () => {
    const n = { pos: [0, 1, 0] as Vec3, vel: [0, 0, 6] as Vec3, ageSec: 0.03 };
    const w = wailWobble(n);
    expect(Math.hypot(w.pos[0] - n.pos[0], w.pos[1] - n.pos[1], w.pos[2] - n.pos[2])).toBeLessThan(WAIL.wobble.amp * 1.3);
    expect(w.pos[2]).toBe(0);
    expect(w.radius).toBeGreaterThan(WAIL.radius * (1 - WAIL.wobble.pulse) - 1e-9);
  });
});

describe('the wail', () => {
  it('fires its three notes in the hold, one per crossing', () => {
    let fired: number[] = [];
    let prev = 0;
    for (let i = 1; i <= 120; i++) { const p = i / 120; fired = fired.concat(wailNotesCrossed(prev, p)); prev = p; }
    expect(fired).toEqual([0, 1, 2]);
    for (const at of ORGAN_TUNING.notes) { expect(at).toBeGreaterThan(ORGAN_TUNING.filled); expect(at).toBeLessThan(ORGAN_TUNING.held); }
  });

  it('is a pose that starts and ends at rest, the head thrown up and the jaw wide through the note', () => {
    for (const p of [0, 1]) {
      const pose = houndPose(p, 'wail');
      expect(Object.keys(pose.offsets)).toEqual([]);
      expect(houndGapeAt(p, 'wail')).toBe(0);
    }
    const mid = houndPose(0.6, 'wail');
    expect(mid.offsets.head![1]).toBeGreaterThan(0.4);
    expect(mid.offsets.head![2]).toBeLessThan(0);
    expect(wailEnvelope(0.6)).toBe(1);
    expect(houndGapeAt(0.6, 'wail')).toBeGreaterThan(0.5);
    // No offsets on the spine's middle points: they would slide the flank mouths off their kit teeth.
    expect(mid.offsets.spineA).toBeUndefined();
    expect(mid.offsets.spineB).toBeUndefined();
  });
});
