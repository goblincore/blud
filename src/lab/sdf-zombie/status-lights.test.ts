import { describe, it, expect } from 'vitest';
import { STATUS_LIGHTS, lightsModeFor, statusLights, type LightsMode } from './status-lights';

const sample = (mode: LightsMode, secs: number, extra: { damage?: number; enraged?: boolean } = {}) =>
  Array.from({ length: Math.round(secs * 120) }, (_, i) => statusLights({ mode, t: i / 120, ...extra }));

describe('status-lights', () => {
  it('is deterministic: the same input gives the same lights', () => {
    const a = statusLights({ mode: 'fire', t: 3.217, damage: 0.4 });
    const b = statusLights({ mode: 'fire', t: 3.217, damage: 0.4 });
    expect(a).toEqual(b);
  });

  it('idle beats: bright twice a period, back to the floor between', () => {
    const s = sample('idle', STATUS_LIGHTS.beatSec.idle * 3).map(x => x.led);
    expect(Math.max(...s)).toBeGreaterThan(1.0);
    expect(Math.min(...s)).toBeCloseTo(STATUS_LIGHTS.beatFloor, 2);
    // Rising edges through the midpoint: two thumps per period, three periods.
    const mid = (STATUS_LIGHTS.beatFloor + STATUS_LIGHTS.beatPeak) / 2;
    let rises = 0;
    for (let i = 1; i < s.length; i++) if (s[i - 1]! < mid && s[i]! >= mid) rises++;
    expect(rises).toBe(6);
  });

  it('alert beats faster than idle', () => {
    const count = (mode: LightsMode) => {
      const s = sample(mode, 6).map(x => x.led);
      let n = 0;
      for (let i = 1; i < s.length; i++) if (s[i - 1]! < 0.7 && s[i]! >= 0.7) n++;
      return n;
    };
    expect(count('alert')).toBeGreaterThan(count('idle') * 1.5);
  });

  it('aim strobes at strobeHz and flares the core: the telegraph', () => {
    const s = sample('aim', 1);
    let flips = 0;
    for (let i = 1; i < s.length; i++) if (s[i - 1]!.led !== s[i]!.led) flips++;
    expect(flips).toBeGreaterThanOrEqual(STATUS_LIGHTS.strobeHz * 2 - 1);
    expect(flips).toBeLessThanOrEqual(STATUS_LIGHTS.strobeHz * 2 + 1);
    for (const x of s) expect(x.core).toBe(STATUS_LIGHTS.coreFlare);
  });

  it('goes dark when dead', () => {
    expect(statusLights({ mode: 'dead', t: 1 })).toMatchObject({ led: 0, core: 0 });
  });

  it('damage drops LEDs out in proportion, and a pristine machine never drops out', () => {
    const dark = (damage: number) => sample('idle', 20, { damage }).filter(x => x.led === 0).length;
    expect(dark(0)).toBe(0);
    const half = dark(0.5), full = dark(1);
    expect(full).toBeGreaterThan(half);
    // ~dropoutAtFull of the time at full damage.
    expect(full / (20 * 120)).toBeGreaterThan(STATUS_LIGHTS.dropoutAtFull - 0.1);
    expect(full / (20 * 120)).toBeLessThan(STATUS_LIGHTS.dropoutAtFull + 0.1);
  });

  it('turns the core red when enraged, amber otherwise', () => {
    expect(statusLights({ mode: 'idle', t: 0 }).coreRgb).toEqual(STATUS_LIGHTS.amber);
    expect(statusLights({ mode: 'idle', t: 0, enraged: true }).coreRgb).toEqual(STATUS_LIGHTS.red);
  });

  it('a phase offset shifts the beat, so a crowd does not blink in unison', () => {
    const a = statusLights({ mode: 'idle', t: 0.1 }).led;
    const b = statusLights({ mode: 'idle', t: 0.1, phase: 0.5 }).led;
    expect(a).not.toBeCloseTo(b, 2);
  });

  it('maps soldier-family mind states onto modes', () => {
    expect(lightsModeFor('idle')).toBe('idle');
    expect(lightsModeFor('idle', { alert: true })).toBe('alert');
    expect(lightsModeFor('engage')).toBe('alert');
    expect(lightsModeFor('aim')).toBe('aim');
    expect(lightsModeFor('fire')).toBe('fire');
    expect(lightsModeFor('recover')).toBe('fire');
    expect(lightsModeFor('stagger')).toBe('stunned');
    expect(lightsModeFor('fire', { collapsed: true })).toBe('dead');
  });
});
