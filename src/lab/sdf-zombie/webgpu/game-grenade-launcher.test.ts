import { describe, it, expect } from 'vitest';
import { LAUNCHER, makeLauncherState, fireLauncher, reloadLauncher, stepLauncher, launcherReady, launcherBeat, launcherReloadPose, launcherRecoil, launcherCartridge, launcherSupportHand } from './game-grenade-launcher';

describe('single-shot launcher cycle', () => {
  it('spends exactly one round, refuses input through recoil and reload, refills from unlimited reserve', () => {
    let s = fireLauncher(makeLauncherState());
    expect(s.shots).toBe(1);
    expect(s.loaded).toBe(false);
    expect(fireLauncher(s)).toBe(s);
    expect(reloadLauncher(s)).toBe(s);
    s = stepLauncher(s, LAUNCHER.fireLeadSec + 0.1);
    expect(s.reloadAge).toBeCloseTo(0.1);
    expect(launcherBeat(s)).toBe('unlock');
    expect(fireLauncher(s)).toBe(s);
    s = stepLauncher(s, LAUNCHER.reloadSec);
    expect(launcherReady(s)).toBe(true);
    expect(s.spent).toBe(false);
    expect(fireLauncher(s).shots).toBe(2);
  });
  it('is independent of step rate and spends a slow frame across both phase boundaries', () => {
    const initial = fireLauncher(makeLauncherState());
    const run = (n: number) => {
      let s = initial;
      for (let i = 0; i < n; i++) s = stepLauncher(s, 1.6 / n);
      return s;
    };
    expect(run(48).reloadAge).toBeCloseTo(run(96).reloadAge, 10);
    const s = stepLauncher(initial, 3);
    expect(s.loaded).toBe(true);
    expect(s.reloadAge).toBe(Infinity);
    expect(s.shots).toBe(1);
    expect(stepLauncher(s, -1)).toBe(s);
    expect(stepLauncher(s, Infinity)).toBe(s);
  });
  it('manual reload extracts a live round and cannot restart a running reload', () => {
    const s = reloadLauncher(makeLauncherState());
    expect(s.spent).toBe(false);
    expect(s.loaded).toBe(false);
    expect(reloadLauncher(s)).toBe(s);
    expect(launcherReady(stepLauncher(s, 2))).toBe(true);
  });
});
describe('mechanical pose and cartridge handoffs', () => {
  it('holds the action fully open through axial seating, then closes and settles exactly at rest', () => {
    for (const t of [LAUNCHER.openSec, LAUNCHER.stageSec, LAUNCHER.seatSec, LAUNCHER.closeStartSec]) {
      expect(launcherReloadPose(t).hinge).toBe(1);
    }
    expect(launcherReloadPose(LAUNCHER.closeSec).hinge).toBe(0);
    expect(launcherReloadPose(LAUNCHER.reloadSec)).toEqual(launcherReloadPose(Infinity));
    for (let t = 0; t < 2; t += 0.01) {
      const p = launcherReloadPose(t);
      expect(p.hinge).toBeGreaterThanOrEqual(0);
      expect(p.hinge).toBeLessThanOrEqual(1);
    }
  });
  it('holds the presented action still from full opening through cartridge seating', () => {
    const open = launcherReloadPose(LAUNCHER.openSec);
    expect(open.yaw).not.toBe(0);
    for (const t of [LAUNCHER.stageSec, LAUNCHER.seatSec]) {
      for (const key of ['pitch', 'yaw', 'roll', 'dx', 'dy', 'dz', 'hinge'] as const) {
        expect(launcherReloadPose(t)[key]).toBeCloseTo(open[key], 12);
      }
    }
    expect(launcherReloadPose(LAUNCHER.reloadSec).yaw).toBe(0);
    expect(launcherReloadPose(LAUNCHER.reloadSec).dx).toBe(0);
  });
  it('has a strong recoil before the action unlocks and no residual kick at reload start', () => {
    expect(launcherRecoil(.045).dz).toBeCloseTo(.067);
    expect(launcherRecoil(.045).pitch).toBe(9);
    expect(launcherRecoil(LAUNCHER.fireLeadSec)).toEqual(launcherRecoil(Infinity));
  });
  it('clears the whole case before tumble and carries into an exactly matching insertion endpoint', () => {
    const atEject = launcherCartridge(LAUNCHER.ejectSec, true);
    expect(atEject.extractM).toBe(LAUNCHER.caseLengthM);
    expect(atEject.eject).toEqual({ out: 0, side: 0, up: 0, spin: 0 });
    expect(atEject.seated).toBe(false);
    const staged = launcherCartridge(LAUNCHER.stageSec, true);
    expect(staged.carry).toBeNull();
    expect(staged.insert).toBe(0);
    expect(launcherCartridge(LAUNCHER.seatSec, true).seated).toBe(true);
    expect(launcherCartridge(LAUNCHER.ejectSec, false).extractM).toBe(LAUNCHER.roundLengthM);
  });
  it('places the support hand at the live stage/seat and returns to the moving fore-end before snap', () => {
    const fore = [1, 2, 3] as const, stage = [7, 8, 9] as const, seat = [10, 11, 12] as const;
    expect(launcherSupportHand(LAUNCHER.stageSec, fore, stage, seat)).toEqual(stage);
    expect(launcherSupportHand(LAUNCHER.seatSec, fore, stage, seat)).toEqual(seat);
    expect(launcherSupportHand(LAUNCHER.closeStartSec, fore, stage, seat)).toEqual(fore);
    expect(launcherSupportHand(Infinity, fore, stage, seat)).toEqual(fore);
  });
  it('keeps the hand on the live forestock until the action opens and the case ejects', () => {
    const stage = [7, 8, 9] as const, seat = [10, 11, 12] as const;
    for (const t of [.15, .40, LAUNCHER.openSec, LAUNCHER.extractSec, LAUNCHER.ejectSec]) {
      const movingFore = [t, 2 - t, 3 + t] as const;
      expect(launcherSupportHand(t, movingFore, stage, seat)).toEqual(movingFore);
    }
  });
});
