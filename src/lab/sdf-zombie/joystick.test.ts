// joystick.ts: the gamer working his stick. Pins that the attack's jiggle is exactly the idle twitch at an attack's
// ends (so it composes with the swing without a jump), that it throws the grip several cm mid-attack, and that a
// spec with no idle holds the stick still between attacks.
import { describe, it, expect } from 'vitest';
import { joystickOffset } from './joystick';

const SPEC = { amp: 0.05, idle: 0.012 };
const mag = (v: readonly number[]) => Math.hypot(...v);

describe('joystickOffset', () => {
  it('adds nothing on top of the idle twitch at an attack\'s ends', () => {
    for (const t of [0, 0.7, 3.3]) {
      expect(joystickOffset(t, 0, SPEC)).toEqual(joystickOffset(t, null, SPEC));
      expect(joystickOffset(t, 1, SPEC)).toEqual(joystickOffset(t, null, SPEC));
    }
  });
  it('throws the grip several centimetres mid-attack', () => {
    let peak = 0;
    for (let i = 1; i < 100; i++) peak = Math.max(peak, mag(joystickOffset(0, i / 100, { amp: 0.05, idle: 0 })));
    expect(peak).toBeGreaterThan(0.03);
    expect(peak).toBeLessThan(0.09);
  });
  it('holds still between attacks with no idle', () => {
    for (const t of [0, 1.1, 2.9]) expect(mag(joystickOffset(t, null, { amp: 0.05, idle: 0 }))).toBe(0);
  });
});
