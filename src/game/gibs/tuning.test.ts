import { describe, it, expect } from 'vitest';
import {
  BU_PER_METER,
  TICS_PER_SECOND,
  buPerTicToMps,
  buPerTicSquaredToMpsSquared,
  EXPLOSION_STANDARD,
  GIB_THRESHOLD,
  DYNAMITE_COOK,
  BLOOD_TRAIL,
  GIB_BURST,
  AXE_ZOMBIE,
} from './tuning';

describe('unit conversion', () => {
  it('BU_PER_METER is 256', () => {
    expect(BU_PER_METER).toBe(256);
  });

  it('TICS_PER_SECOND is 120', () => {
    expect(TICS_PER_SECOND).toBe(120);
  });

  it('converts Build velocity (1 BU/tic) to m/s', () => {
    // 1 BU/tic * 120 tic/s = 120 BU/s = 120/256 m/s ≈ 0.46875 m/s
    expect(buPerTicToMps(1)).toBeCloseTo(0.46875, 5);
  });

  it('converts Build acceleration (1 BU/tic²) to m/s²', () => {
    // 1 BU/tic² * 120² tic²/s² / 256 BU/m
    expect(buPerTicSquaredToMpsSquared(1)).toBeCloseTo(56.25, 4);
  });

  it('converts Blood dynamite min velocity (0x66666 fixed-16) to ~3 m/s', () => {
    // Blood's min throw after mulscale16 = 0x66666 >> 16 = 6.4 BU/tic
    // 6.4 * 120 / 256 ≈ 3.0 m/s
    const minBuPerTic = 0x66666 / 0x10000;
    expect(buPerTicToMps(minBuPerTic)).toBeCloseTo(3.0, 1);
  });
});

describe('explosion constants', () => {
  it('kExplosionStandard (TNT Bundle) matches NotBlood explodeInfo[1]', () => {
    expect(EXPLOSION_STANDARD.radius).toBe(150);
    expect(EXPLOSION_STANDARD.damage).toBe(20);
    expect(EXPLOSION_STANDARD.damageRange).toBe(10);
    expect(EXPLOSION_STANDARD.impulse).toBe(900);
    expect(EXPLOSION_STANDARD.quake).toBe(160);
  });

  it('GIB_THRESHOLD is 160 (R1 NotBlood extraction)', () => {
    expect(GIB_THRESHOLD).toBe(160);
  });
});

describe('dynamite tuning', () => {
  it('maxChargeSec is 2 (240 tics @ 120 TPS)', () => {
    expect(DYNAMITE_COOK.maxChargeSec).toBe(2.0);
  });
  it('fuseMaxSec is 1.5 (shorter fuse for snappier feel, closer to Blood weaponTimer)', () => {
    expect(DYNAMITE_COOK.fuseMaxSec).toBe(1.5);
  });
  it('throw velocity range matches Blood nSpeed >> 16 (F1 port: min ~3 m/s, max ~14 m/s)', () => {
    // source: weapon.cpp:1215, nSpeed = mulscale16(throwPower, 0x177777) + 0x66666
    // xvel = mulscale30(nSpeed, cos(ang)) = nSpeed >> 16 when cos(ang) = 16384
    // min = 0x66666  >> 16 =  6.4 BU/tic → ~3.0 m/s at BU_PER_METER=256, TICS/s=120
    // max = 0x1DDDDD >> 16 = 29.9 BU/tic → ~14.0 m/s
    expect(DYNAMITE_COOK.minVelocityMps).toBeCloseTo(3.0, 1);
    expect(DYNAMITE_COOK.maxVelocityMps).toBeCloseTo(14.0, 1);
    expect(DYNAMITE_COOK.maxVelocityMps).toBeGreaterThan(DYNAMITE_COOK.minVelocityMps);
  });
  it('pitchLobDeg exists and is in a plausible range (15–45°)', () => {
    // Blood's upward lob = arcsin(9460/16384) ≈ 35.3°; we ported to 30° for arena scale.
    expect(DYNAMITE_COOK.pitchLobDeg).toBeGreaterThanOrEqual(15);
    expect(DYNAMITE_COOK.pitchLobDeg).toBeLessThanOrEqual(45);
  });
});

describe('blood trail (FX_27)', () => {
  it('emits at 20 Hz (6 tics @ 120 TPS)', () => {
    expect(BLOOD_TRAIL.emitHz).toBe(20);
  });
  it('inherits 1/256 of parent velocity (Blood xvel>>8)', () => {
    expect(BLOOD_TRAIL.velScale).toBeCloseTo(1 / 256, 10);
  });
  it('lifetime is 4 seconds (480 tics)', () => {
    expect(BLOOD_TRAIL.lifetimeSec).toBe(4.0);
  });
  it('picnum is 733', () => {
    expect(BLOOD_TRAIL.tile).toBe(733);
  });
});

describe('gib burst (FX_13)', () => {
  it('picnum is 2154', () => {
    expect(GIB_BURST.tile).toBe(2154);
  });
  it('lifetime is 4 seconds', () => {
    expect(GIB_BURST.lifetimeSec).toBe(4.0);
  });
});

describe('axe zombie', () => {
  it('has tuning-sourced HP and melee values', () => {
    expect(AXE_ZOMBIE.hp).toBeGreaterThan(0);
    expect(AXE_ZOMBIE.meleeDamage).toBeGreaterThan(0);
    expect(AXE_ZOMBIE.speed).toBeGreaterThan(0);
  });
});
