import { describe, expect, it } from 'vitest';
import { BEACON, beaconAxis, beaconAxisInto, beaconPhase, beaconShadowLive, beaconSpotIntensity, countsAsRoomLamp, countsForRoomFill, lampKind, scriptFor } from './beacon';
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
  it('beaconAxisInto writes the same axis into the caller\'s tuple', () => {
    const out: [number, number, number] = [9, 9, 9];
    expect(beaconAxisInto(out, 1.3, -0.7, 0.4)).toBe(out);
    const a = beaconAxis(1.3, -0.7, 0.4);
    for (let i = 0; i < 3; i++) expect(out[i]).toBe(a[i]);
  });
  it('phase offsets the sweep', () => {
    const a = beaconAxis(0, 1, Math.PI / 2), b = beaconAxis(0.25, 1, 0);
    expect(a[0]).toBeCloseTo(b[0], 6); expect(a[2]).toBeCloseTo(b[2], 6);
  });
});

describe('beaconPhase', () => {
  it('two beacons in a room start opposite (0 and π)', () => {
    expect(beaconPhase(0, 2)).toBe(0);
    expect(beaconPhase(1, 2)).toBeCloseTo(Math.PI, 12);
    const a = beaconAxis(0, 0.7, beaconPhase(0, 2)), b = beaconAxis(0, -0.7, beaconPhase(1, 2));
    expect(a[0]).toBeCloseTo(-b[0], 6); expect(a[2]).toBeCloseTo(-b[2], 6);
  });
  it('spreads n evenly; a lone beacon starts at 0', () => {
    expect(beaconPhase(0, 1)).toBe(0);
    expect(beaconPhase(1, 3)).toBeCloseTo((2 * Math.PI) / 3, 12);
    expect(beaconPhase(2, 3)).toBeCloseTo((4 * Math.PI) / 3, 12);
  });
});

describe('scriptFor (arming)', () => {
  it('the strobe arms a beacon as emergency; tubes strobe; other commands pass through', () => {
    expect(scriptFor('strobe', true)).toBe('emergency');
    expect(scriptFor('strobe', false)).toBe('strobe');
    expect(scriptFor('die', true)).toBe('die');
    expect(scriptFor('blackout', true)).toBe('blackout');
    expect(scriptFor('die', true, null)).toBe('die');
  });
  it('once armed, an emergency light stays on: every later command keeps its script', () => {
    for (const m of ['die', 'blackout', 'strobe'] as const) expect(scriptFor(m, true, 'emergency')).toBeNull();
    // Not a beacon (or not armed): commands still apply.
    expect(scriptFor('die', false, 'strobe')).toBe('die');
    expect(scriptFor('strobe', true, 'blackout')).toBe('emergency');
  });
});

describe('beaconShadowLive (the rotating shadow refresh)', () => {
  const m = (...rooms: number[]) => rooms.reduce((a, r) => a | (1 << r), 0);
  it('refreshes while lit and its room is near the player (its room, or joined by a tunnel)', () => {
    expect(beaconShadowLive(1, 5, m(5, 4, 6))).toBe(true);      // in the Boiler Room
    expect(beaconShadowLive(1, 5, m(4, 5))).toBe(true);         // next door / in the vestibule
    expect(beaconShadowLive(1, 5, m(1, 2))).toBe(false);        // far carriages
  });
  it('never while dark; an unknown mask refreshes', () => {
    expect(beaconShadowLive(0, 5, m(5))).toBe(false);
    expect(beaconShadowLive(1, 5, 0)).toBe(true);
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
