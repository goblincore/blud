// joystick.ts: the gamer working his stick. Pins that the attack's jiggle is exactly the idle twitch at an attack's
// ends (so it composes with the swing without a jump), that it throws the grip several cm mid-attack, and that a
// spec with no idle holds the stick still between attacks.
import { describe, it, expect } from 'vitest';
import { joystickOffset, stepSwellJiggle } from './joystick';

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

describe('stepSwellJiggle (a shot rings the swell)', () => {
  const spec = { amp: 1.6, freq: 6, decay: 0.18 };
  it('is silent until a shot, swings both ways after one, and dies out', () => {
    const st = { amp: 0, since: 0 };
    expect(stepSwellJiggle(st, 1 / 60, null, spec)).toBe(0);
    const w: number[] = [stepSwellJiggle(st, 1 / 60, 1, spec)];
    for (let i = 0; i < 120; i++) w.push(stepSwellJiggle(st, 1 / 60, null, spec));
    expect(Math.max(...w), 'bulges').toBeGreaterThan(0.8);
    expect(Math.min(...w), 'and sucks in').toBeLessThan(-0.4);
    expect(Math.abs(w[w.length - 1]!), 'gone within 2 s').toBeLessThan(0.01);
  });
  it('stacks kicks only up to 1.6x', () => {
    const st = { amp: 0, since: 0 };
    for (let i = 0; i < 10; i++) stepSwellJiggle(st, 1 / 60, 1, spec);
    expect(st.amp).toBeLessThanOrEqual(spec.amp * 1.6 + 1e-9);
  });
});
