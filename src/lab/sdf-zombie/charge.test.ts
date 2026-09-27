import { describe, it, expect } from 'vitest';
import { CHARGE, CHARGE_REST, stepCharge, type ChargeInput, type ChargeState } from './charge';

const DT = 1 / 60;
/** An open room 40 m wide unless a wall is given (z >= wallZ is solid). */
function sim(opts: { player: { x: number; z: number }; enraged?: boolean; busy?: boolean; wallZ?: number; movePlayer?: (t: number) => { x: number; z: number }; secs?: number; roll?: number }) {
  let s: ChargeState = CHARGE_REST, self = { x: 0, z: 0 };
  const log: { phase: string; self: { x: number; z: number }; contact: boolean; halt: boolean; face: number | null }[] = [];
  for (let i = 0; i < (opts.secs ?? 6) * 60; i++) {
    const player = opts.movePlayer ? opts.movePlayer(i * DT) : opts.player;
    const input: ChargeInput = {
      dt: DT, self, player, visible: true, enraged: !!opts.enraged, busy: !!opts.busy, roll: opts.roll ?? 0,
      canStand: (_x, z) => opts.wallZ === undefined || z < opts.wallZ,
    };
    const o = stepCharge(s, input);
    s = o.state;
    if (o.target && o.speed > 0) {
      const dx = o.target[0] - self.x, dz = o.target[2] - self.z, l = Math.hypot(dx, dz);
      self = { x: self.x + dx / l * o.speed * DT, z: self.z + dz / l * o.speed * DT };
    }
    log.push({ phase: s.phase, self: { ...self }, contact: o.contact, halt: o.halt, face: o.faceHeading });
  }
  return log;
}

describe('bull charge', () => {
  it('telegraphs halted and squared up, then runs straight at where the player was', () => {
    const log = sim({ player: { x: 0, z: 6 }, enraged: true });
    const firstRun = log.findIndex(l => l.phase === 'charge');
    expect(firstRun).toBeGreaterThan(0);
    // Windup: halted, facing the player (bearing 0 = +z).
    const wind = log.slice(0, firstRun).filter(l => l.phase === 'windup');
    expect(wind.length * DT).toBeCloseTo(CHARGE.enragedWindupSec, 1);
    for (const l of wind) { expect(l.halt).toBe(true); expect(l.face).toBeCloseTo(0, 6); }
    // The run: straight along +z, at CHARGE.speed.
    const run = log.filter(l => l.phase === 'charge');
    for (const l of run) expect(Math.abs(l.self.x)).toBeLessThan(1e-9);
  });

  it('hits once, carries past, then recovers', () => {
    const log = sim({ player: { x: 0, z: 5 }, enraged: true });
    expect(log.filter(l => l.contact)).toHaveLength(1);
    const after = log.find(l => l.phase === 'recover')!;
    expect(after.self.z).toBeGreaterThan(5);           // carried past the spot
    expect(after.self.z).toBeLessThan(5 + CHARGE.overshoot + 0.2);
  });

  it('locks the line at the end of the windup: a sidestep after the lock makes him miss', () => {
    const lockT = CHARGE.enragedWindupSec;
    const log = sim({ player: { x: 0, z: 6 }, enraged: true,
      movePlayer: t => (t < lockT + 0.05 ? { x: 0, z: 6 } : { x: 2.5, z: 6 }) });
    // The FIRST charge (a second one, after the cooldown, is a fresh aim).
    const firstEnd = log.findIndex(l => l.phase === 'recover');
    expect(firstEnd).toBeGreaterThan(0);
    expect(log.slice(0, firstEnd + 1).some(l => l.contact)).toBe(false);
  });

  it('a wall in his line STUNS him for stunSec: the punish window', () => {
    const log = sim({ player: { x: 0, z: 6 }, enraged: true, wallZ: 4 });
    const i = log.findIndex(l => l.phase === 'stunned');
    expect(i).toBeGreaterThan(0);
    const stunned = log.slice(i).findIndex(l => l.phase !== 'stunned');
    expect(stunned * DT).toBeCloseTo(CHARGE.stunSec, 1);
    // He stopped short of the wall by his probe.
    expect(log[i]!.self.z).toBeLessThan(4 - CHARGE.wallProbe + 0.1);
  });

  it('armed, he only charges a player who has closed in; enraged, from the whole band', () => {
    expect(sim({ player: { x: 0, z: 7 } }).some(l => l.phase !== 'none')).toBe(false);
    expect(sim({ player: { x: 0, z: 7 }, enraged: true }).some(l => l.phase === 'charge')).toBe(true);
    expect(sim({ player: { x: 0, z: 3.5 } }).some(l => l.phase === 'charge')).toBe(true);
  });

  it('never starts mid-volley, nor inside minDist (he brawls there)', () => {
    expect(sim({ player: { x: 0, z: 3.5 }, busy: true }).some(l => l.phase !== 'none')).toBe(false);
    expect(sim({ player: { x: 0, z: CHARGE.minDist - 0.3 }, enraged: true }).some(l => l.phase !== 'none')).toBe(false);
  });

  it('waits out the cooldown between charges, shorter when enraged', () => {
    const wait = (enraged: boolean) => {
      let s: ChargeState = { ...CHARGE_REST, phase: 'recover', t: CHARGE.recoverSec,
        cooldown: enraged ? CHARGE.enragedCooldownSec : CHARGE.cooldownSec };
      let n = 0;
      do {
        s = stepCharge(s, { dt: DT, self: { x: 0, z: 0 }, player: { x: 0, z: 3.5 }, visible: true, enraged,
          busy: false, roll: 0, canStand: () => true }).state;
        n++;
      } while (s.phase !== 'windup' && n < 60 * 20);
      return n * DT;
    };
    expect(wait(false)).toBeGreaterThan(CHARGE.cooldownSec - 0.1);
    expect(wait(true)).toBeGreaterThan(CHARGE.enragedCooldownSec - 0.1);
    expect(wait(true)).toBeLessThan(wait(false));
  });
});
