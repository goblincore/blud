import { describe, expect, it } from 'vitest';
import { BEACON, beaconAxis, beaconSpotIntensity, countsAsRoomLamp, countsForRoomFill, lampKind, scriptFor } from './beacon';
import { LAMP_SCRIPT, lampLevel } from './lamp-moods';

describe('beaconAxis', () => {
  it('is a unit vector tilted BEACON.tilt below horizontal', () => {
    const a = beaconAxis(1.3, 0.7, 0);
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1, 6);
    expect(Math.asin(-a[1])).toBeCloseTo(BEACON.tilt, 6);
  });
  it('turns spin revolutions per second, sign = direction', () => {
    const a0 = beaconAxis(0, 0.5, 0), a1 = beaconAxis(1, 0.5, 0);   // half a turn
    expect(a1[0]).toBeCloseTo(-a0[0], 6); expect(a1[2]).toBeCloseTo(-a0[2], 6);
    const cw = beaconAxis(0.25, 1, 0), ccw = beaconAxis(0.25, -1, 0);
    expect(cw[2]).toBeCloseTo(-ccw[2], 6);   // a quarter turn each way: z flips
  });
  it('phase offsets the sweep', () => {
    const a = beaconAxis(0, 1, Math.PI / 2), b = beaconAxis(0.25, 1, 0);
    expect(a[0]).toBeCloseTo(b[0], 6); expect(a[2]).toBeCloseTo(b[2], 6);
  });
});

describe('scriptFor (arming)', () => {
  it('the strobe arms a beacon as emergency; tubes strobe; other commands pass through', () => {
    expect(scriptFor('strobe', true)).toBe('emergency');
    expect(scriptFor('strobe', false)).toBe('strobe');
    expect(scriptFor('die', true)).toBe('die');
    expect(scriptFor('blackout', true)).toBe('blackout');
  });
});

describe('lamp kinds (glass and room fill)', () => {
  it('beacons are neither the room lamp nor its fill; fires fill but are not the lamp', () => {
    expect(lampKind({ mood: 'dead', beacon: {} })).toBe('beacon');
    expect(countsAsRoomLamp({ mood: 'dead', beacon: {} })).toBe(false);
    expect(countsForRoomFill({ mood: 'dead', beacon: {} })).toBe(false);
    expect(countsAsRoomLamp({ mood: 'fire' })).toBe(false);
    expect(countsForRoomFill({ mood: 'fire' })).toBe(true);
    expect(countsAsRoomLamp({ mood: 'steady', beacon: null })).toBe(true);
    expect(countsForRoomFill({ mood: 'flicker' })).toBe(true);
  });
});

describe('the emergency script drives the beacon spot', () => {
  it('0 through the strobe, base × spotGain once on', () => {
    const at = 10, seed = 3;
    const during = lampLevel('dead', { mode: 'emergency', at }, at + LAMP_SCRIPT.surgeS + 1, seed);
    expect(beaconSpotIntensity(2.4, during)).toBe(0);
    const after = lampLevel('dead', { mode: 'emergency', at }, at + LAMP_SCRIPT.surgeS + LAMP_SCRIPT.strobeS + LAMP_SCRIPT.emergencyOnS + 0.01, seed);
    expect(after).toBe(1);
    expect(beaconSpotIntensity(2.4, after)).toBeCloseTo(2.4 * BEACON.spotGain, 9);
  });
});
