import { describe, expect, it } from 'vitest';
import { AIM_CENTRE_RATE, SLOT_AIM_STYLE, easeAimToCentre, freeAimFor, mouselookTurn, pinLook } from './aim-style';
import { WEAPON_SLOTS } from './game-weapon-slots';

describe('freeAimFor (per-weapon aim style)', () => {
  it('the shotgun is conventional mouselook; every other weapon keeps free aim', () => {
    expect(freeAimFor('shotgun', null)).toBe(false);
    for (const s of WEAPON_SLOTS) if (s !== 'shotgun') expect(freeAimFor(s, null), s).toBe(true);
  });
  it('every slot has a style', () => {
    for (const s of WEAPON_SLOTS) expect(['free', 'mouselook']).toContain(SLOT_AIM_STYLE[s]);
  });
  it('the session override (G / setFreeAim) wins for every weapon', () => {
    for (const s of WEAPON_SLOTS) {
      expect(freeAimFor(s, true)).toBe(true);
      expect(freeAimFor(s, false)).toBe(false);
    }
  });
});

describe('mouselook + the look pin (the G bug)', () => {
  it('a live mouselook frame keeps the turn its delta made', () => {
    // The frame's look is snapshotted at the tick boundary, BEFORE the delta.
    const recorded: [number, number] = [0, 0];
    const turned = mouselookTurn(0, 0, 100, -50, 1.45);
    expect(turned.yaw).toBeCloseTo(0.22, 9);
    expect(turned.pitch).toBeCloseTo(0.11, 9);
    // The old path pinned straight back to `recorded`, undoing the turn: the view never moved.
    expect(pinLook(false, recorded, turned)).toEqual([turned.yaw, turned.pitch]);
  });
  it('a replayed frame is pinned to its recorded look', () => {
    expect(pinLook(true, [0.5, -0.1], { yaw: 0.51, pitch: -0.11 })).toEqual([0.5, -0.1]);
  });
  it('clamps pitch', () => {
    expect(mouselookTurn(0, 1.4, 0, -1000, 1.45).pitch).toBe(1.45);
    expect(mouselookTurn(0, -1.4, 0, 1000, 1.45).pitch).toBe(-1.45);
  });
});

describe('easeAimToCentre (a switch into mouselook hands the reticle back smoothly)', () => {
  it('leaves a centred reticle alone', () => {
    const a = { x: 0, y: 0 };
    expect(easeAimToCentre(a, 1 / 60)).toBe(a);
  });
  it('moves toward the centre without a jump, and lands exactly on it', () => {
    let a = { x: 0.6, y: -0.3 };
    const first = easeAimToCentre(a, 1 / 60);
    expect(first.x).toBeLessThan(0.6);
    expect(first.x).toBeGreaterThan(0.6 * 0.7);   // one frame moves it < 30%: no snap
    expect(first.y / first.x).toBeCloseTo(-0.5, 9); // straight line to the centre
    for (let i = 0; i < 60; i++) a = easeAimToCentre(a, 1 / 60);
    expect(a).toEqual({ x: 0, y: 0 });
  });
  it('is ~95% home in 0.2 s', () => {
    expect(Math.exp(-AIM_CENTRE_RATE * 0.2)).toBeLessThan(0.06);
  });
});
