// src/lab/sdf-zombie/webgpu/game-weapon-slots.test.ts
//
// The weapon switch is timing, so it is tested as timing: how long a switch
// takes, when firing is legal, that a mis-key is free, and that the two travel
// scalars can never both be "in frame".

import { describe, expect, it } from 'vitest';
import {
  SLOT_BY_KEY, WEAPON_SLOTS, WEAPON_SWITCH, makeWeaponSlotState, requestSlot,
  slotForKey, slotLowerAmount, slotReady, stepWeaponSlot, type WeaponSlot,
  type WeaponSlotState,
} from './game-weapon-slots';

const STEP = 1 / 60;

/** Run the machine for `sec` at 60 Hz, collecting the state at the end. */
function run(state: WeaponSlotState, sec: number, press?: WeaponSlot): WeaponSlotState {
  let s = state;
  const n = Math.round(sec / STEP);
  for (let i = 0; i < n; i++) {
    if (press !== undefined && i === 0) s = requestSlot(s, press);
    s = stepWeaponSlot(s, STEP);
  }
  return s;
}

describe('slot mapping', () => {
  it('maps 1, 2 and 3 and nothing else', () => {
    expect(slotForKey('Digit1')).toBe('shotgun');
    expect(slotForKey('Digit2')).toBe('dynamite');
    expect(slotForKey('Digit3')).toBe('flare');
    expect(slotForKey('Digit4')).toBeNull();
    expect(slotForKey('KeyE')).toBeNull();
    expect(Object.keys(SLOT_BY_KEY)).toHaveLength(3);
    expect(WEAPON_SLOTS).toEqual(['shotgun', 'dynamite', 'flare']);
  });
});

describe('switch timing', () => {
  it('starts settled on the shotgun and may fire', () => {
    const s = makeWeaponSlotState();
    expect(s.phase).toBe('up');
    expect(slotReady(s)).toBe(true);
    expect(slotLowerAmount(s, 'shotgun')).toBe(0);
    expect(slotLowerAmount(s, 'dynamite')).toBe(1);
  });

  it('refuses to fire for the whole switch, then allows it', () => {
    let s = requestSlot(makeWeaponSlotState(), 'dynamite');
    expect(slotReady(s)).toBe(false);
    // Just short of the total: still switching.
    s = run(s, WEAPON_SWITCH.lowerSec + WEAPON_SWITCH.raiseSec - 3 * STEP);
    expect(slotReady(s)).toBe(false);
    s = run(s, 4 * STEP);
    expect(slotReady(s)).toBe(true);
    expect(s.live).toBe('dynamite');
  });

  it('holds the old weapon live until it is fully down', () => {
    let s = requestSlot(makeWeaponSlotState(), 'dynamite');
    s = run(s, WEAPON_SWITCH.lowerSec - 2 * STEP);
    expect(s.live).toBe('shotgun');
    expect(slotReady(s)).toBe(false);          // down, but not yet handed over
    expect(slotLowerAmount(s, 'shotgun')).toBeGreaterThan(0.7);
    s = run(s, 4 * STEP);
    expect(s.live).toBe('dynamite');
    expect(slotLowerAmount(s, 'shotgun')).toBe(1);   // holstered
    // Two frames into the raise: off the bottom, nowhere near up yet.
    expect(slotLowerAmount(s, 'dynamite')).toBeLessThan(1);
    expect(slotLowerAmount(s, 'dynamite')).toBeGreaterThan(0.5);
  });

  it('never has both slots in frame at once', () => {
    let s = requestSlot(makeWeaponSlotState(), 'dynamite');
    for (let i = 0; i < 120; i++) {
      s = stepWeaponSlot(s, STEP);
      const a = slotLowerAmount(s, 'shotgun');
      const b = slotLowerAmount(s, 'dynamite');
      // At rest one of them is fully holstered; mid-switch the two travels sum
      // to at least 1 (one is down while the other comes up).
      expect(a <= 0 || b <= 0 || a + b >= 1 - 1e-9).toBe(true);
      expect(Math.min(a, b)).toBeLessThanOrEqual(1);
    }
  });

  it('is frame-rate independent within a frame of the nominal duration', () => {
    const at60 = run(requestSlot(makeWeaponSlotState(), 'dynamite'), 0.5);
    let at30 = requestSlot(makeWeaponSlotState(), 'dynamite');
    for (let i = 0; i < 15; i++) at30 = stepWeaponSlot(at30, 1 / 30);
    expect(at30.live).toBe(at60.live);
    expect(slotReady(at30)).toBe(slotReady(at60));
    expect(at30.down).toBeCloseTo(at60.down, 6);
    expect(at30.up).toBeCloseTo(at60.up, 6);
  });

  it('ignores a re-press of the slot already selected', () => {
    const s = makeWeaponSlotState('dynamite');
    expect(requestSlot(s, 'dynamite')).toBe(s);
  });
});

describe('cancel and retarget', () => {
  it('a mis-keyed slot is free: the held weapon comes back up', () => {
    let s = requestSlot(makeWeaponSlotState(), 'dynamite');
    s = run(s, WEAPON_SWITCH.lowerSec * 0.5);
    expect(slotLowerAmount(s, 'shotgun')).toBeGreaterThan(0.3);
    // Player re-picks the shotgun they already hold.
    s = run(s, WEAPON_SWITCH.lowerSec, 'shotgun');
    expect(s.live).toBe('shotgun');
    expect(slotReady(s)).toBe(true);
    expect(slotLowerAmount(s, 'shotgun')).toBe(0);
    expect(slotLowerAmount(s, 'dynamite')).toBe(1);
  });

  it('retargeting keeps the lower travel instead of restarting it', () => {
    let s = requestSlot(makeWeaponSlotState(), 'dynamite');
    s = run(s, WEAPON_SWITCH.lowerSec * 0.5);
    const midDrop = slotLowerAmount(s, 'shotgun');
    // 1 → 2 → 1 → 2 rapidly: the last press is the dynamite again.
    s = requestSlot(s, 'shotgun');
    s = requestSlot(s, 'dynamite');
    // The live model must not have popped back to the top of its travel.
    expect(slotLowerAmount(s, 'shotgun')).toBeCloseTo(midDrop, 6);
  });

  it('a completed switch is idempotent under further stepping', () => {
    let s = run(requestSlot(makeWeaponSlotState(), 'dynamite'), 1.0);
    const settled = stepWeaponSlot(s, STEP);
    expect(settled).toBe(s);
  });
});

describe('flare (slot 3)', () => {
  it('settles on the flare and holsters both other slots', () => {
    let s = requestSlot(makeWeaponSlotState(), 'flare');
    s = run(s, WEAPON_SWITCH.lowerSec + WEAPON_SWITCH.raiseSec + STEP);
    expect(s.live).toBe('flare');
    expect(slotReady(s)).toBe(true);
    expect(slotLowerAmount(s, 'flare')).toBe(0);
    expect(slotLowerAmount(s, 'shotgun')).toBe(1);
    expect(slotLowerAmount(s, 'dynamite')).toBe(1);
  });

  it('never has two of the three slots in frame at once', () => {
    let s = requestSlot(makeWeaponSlotState(), 'flare');
    for (let i = 0; i < 180; i++) {
      s = stepWeaponSlot(s, STEP);
      const lowers = WEAPON_SLOTS.map((w) => slotLowerAmount(s, w));
      const inFrame = lowers.filter((v) => v <= 0).length;
      // At rest exactly one slot is at 0; mid-switch the travels sum to >= 1.
      expect(inFrame).toBeLessThanOrEqual(1);
      expect(lowers.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });
});
