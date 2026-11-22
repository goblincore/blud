// src/lab/sdf-zombie/webgpu/floater-move.test.ts
//
// Doom-style floaters on the committed sectors fixture: A floor 0 ceil 4 (x -4..4, z 0..-8, a column at
// x -1..1, z -5..-3), B a 0.5 m step north (z -8..-12), C a 1.5 m ledge beyond B (z -12..-16: a 1 m climb
// a walker cannot make), D a -1 m sky pit east (x 4..8).

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSectorLevel } from './sector-json';
import { buildSectorGround } from './sector-ground';
import { createSectorNavigation } from './sector-navigation';
import {
  DIRS, FLOAT_TUNING, TERATOMA_FLOAT_BODY as BODY, createFloater, createFloaterSpace, fitBand, fitsAt, flyOpening,
  floatMode, heightTarget, newChaseDir, stepAltitude, type FlyOpening,
} from './floater-move';
import type { Vec3 } from '../types';

const level = () => parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8')));
const L = level();
const map = L.sectors!;
const ground = buildSectorGround(map);
const space = createFloaterSpace(map, ground, L.rooms, []);
const T = FLOAT_TUNING;

describe('flyOpening / canFly: walls stop a floater, floor heights do not', () => {
  it('reads the highest floor and lowest ceiling under the disc', () => {
    expect(flyOpening(map, ground, -2.5, -6, BODY.radius)).toEqual({ floor: 0, ceil: 4, sky: false });
    expect(flyOpening(map, ground, -2.5, -8.3, BODY.radius)).toEqual({ floor: 0.5, ceil: 4, sky: false });   // over the A|B step
    expect(flyOpening(map, ground, 6, -4, BODY.radius)!.sky).toBe(true);
    expect(flyOpening(map, ground, 0, -0.3, BODY.radius)).toBeNull();                                         // A's north wall
    expect(flyOpening(map, ground, 30, 30, BODY.radius)).toBeNull();
  });
  it('flies up the 1 m ledge and out of the pit, where a walker cannot', () => {
    const walk = createSectorNavigation(map, ground, L.rooms, []);
    const b: Vec3 = [0, 0.5, -11], c: Vec3 = [0, 1.5, -13], d: Vec3 = [6, -1, -4], a: Vec3 = [2.5, 0, -4];
    expect(walk.canTravel(b, c)).toBe(false);
    expect(walk.canTravel(d, a)).toBe(false);
    expect(space.canFly(b, c)).toBe(true);
    expect(space.canFly(d, a)).toBe(true);
    expect(space.canFly([0, 0, -1.5], [0, 0, -6.5])).toBe(false);                                            // the column
    expect(space.navigation.route(d, c).length).toBeGreaterThan(0);                                          // pit -> ledge
  });
  it('a ceiling too low for the body closes a line', () => {
    const m = level().sectors!;
    m.sectors[2]!.ceil = 1.5 + (BODY.top - BODY.bottom) + 0.2;                                                // C: 1.55 m open, the body needs 1.7
    const low = createFloaterSpace(m, buildSectorGround(m), L.rooms, []);
    expect(low.canFly([0, 0, -11], [0, 0, -13])).toBe(false);
  });
});

describe('heightTarget: high when idle, down to the player when chasing', () => {
  const room: FlyOpening = { floor: 0, ceil: 4, sky: false };
  const centre = (y: number) => y + BODY.centre;
  it('idle cruises at cruiseFrac of the opening, bobbing by bobAmpM', () => {
    const ys = [0, 2.5, 5, 7.5].map(time => centre(heightTarget('idle', room, BODY, { time }, T)));
    for (const y of ys) expect(Math.abs(y - T.cruiseFrac * 4)).toBeLessThanOrEqual(T.bobAmpM + 1e-9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(T.bobAmpM);
  });
  it('a sky or very tall sector caps the cruise at cruiseMaxM over the floor', () => {
    const tall: FlyOpening = { floor: -2.5, ceil: 30, sky: true };
    expect(centre(heightTarget('idle', tall, BODY, { time: 0 }, T))).toBeCloseTo(-2.5 + T.cruiseMaxM, 9);
  });
  it('chasing: cruise from engageM out, the player\'s eye + eyeAboveM from closeM in, between in between', () => {
    const tall: FlyOpening = { floor: -2.5, ceil: 30, sky: true };
    const at = (d: number) => centre(heightTarget('chase', tall, BODY, { time: 3, distToPlayer: d, playerFeetY: -1.75 }, T));
    const cruise = -2.5 + T.cruiseMaxM, low = -1.75 + T.playerEyeM + T.eyeAboveM;
    expect(at(T.engageM + 5)).toBeCloseTo(cruise, 9);
    expect(at(T.closeM)).toBeCloseTo(low, 9);
    expect(at(1)).toBeCloseTo(low, 9);
    const mid = at((T.engageM + T.closeM) / 2);
    expect(mid).toBeCloseTo((cruise + low) / 2, 9);
  });
  it('is always clamped between floor + clearance and ceiling - the body', () => {
    const corridor: FlyOpening = { floor: 0, ceil: 2.25, sky: false };
    const [lo, hi] = fitBand(corridor, BODY, T);
    expect(lo).toBeCloseTo(T.floorClearM - BODY.bottom, 9);
    expect(hi).toBeCloseTo(2.25 - T.ceilClearM - BODY.top, 9);
    for (const mode of ['idle', 'chase'] as const)
      for (const feet of [-5, 0, 5]) {
        const y = heightTarget(mode, corridor, BODY, { time: 1, distToPlayer: 2, playerFeetY: feet }, T);
        expect(y).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(y).toBeLessThanOrEqual(hi + 1e-9);
      }
  });
});

describe('stepAltitude / floatMode', () => {
  it('rises and sinks at the float speeds, never snapping', () => {
    expect(stepAltitude(0, 10, 0.5, null, T)).toBeCloseTo(T.riseMps * 0.5, 9);
    expect(stepAltitude(0, -10, 0.5, null, T)).toBeCloseTo(-T.descendMps * 0.5, 9);
    expect(stepAltitude(0, 0.01, 0.5, null, T)).toBe(0.01);
  });
  it('a band that tightened above it floats it down at the descent speed', () => {
    expect(stepAltitude(3, 3, 0.1, [0, 1], T)).toBeCloseTo(3 - T.descendMps * 0.1, 9);
  });
  it('chases while it saw the player within lostSightS, then idles', () => {
    expect(floatMode(0)).toBe('chase');
    expect(floatMode(T.lostSightS - 0.01)).toBe('chase');
    expect(floatMode(T.lostSightS)).toBe('idle');
  });
});

describe('newChaseDir: Doom\'s P_NewChaseDir over 8 directions', () => {
  const all = () => true;
  const r = (v: number) => () => v;
  it('takes the diagonal toward the goal', () => {
    expect(newChaseDir([0, 0], [5, -5], -1, all, r(0.1))).toBe(1);              // +x, -z: north-east
    expect(newChaseDir([0, 0], [-5, 5], -1, all, r(0.1))).toBe(5);
  });
  it('then the larger axis, then the smaller', () => {
    const noDiag = (d: number) => d !== 1;
    expect(newChaseDir([0, 0], [5, -2], -1, noDiag, r(0.1))).toBe(0);
    expect(newChaseDir([0, 0], [2, -5], -1, noDiag, r(0.1))).toBe(2);
    expect(newChaseDir([0, 0], [5, -2], -1, d => d !== 1 && d !== 0, r(0.1))).toBe(2);
  });
  it('never turns round while anything else is open, and turns round last', () => {
    expect(newChaseDir([0, 0], [-5, 0], 0, d => d !== 0, r(0.1))).not.toBe(4);      // goal behind: not straight back
    expect(newChaseDir([0, 0], null, 0, d => d === 4, r(0.1))).toBe(4);
    expect(newChaseDir([0, 0], null, 0, () => false, r(0.1))).toBe(-1);
  });
  it('keeps its old direction with no goal', () => {
    expect(newChaseDir([0, 0], null, 3, all, r(0.9))).toBe(3);
  });
  it('the 8 directions are unit vectors, 45 degrees apart, 2 = our -z (Doom north)', () => {
    for (const [x, z] of DIRS) expect(Math.hypot(x, z)).toBeCloseTo(1, 9);
    expect(DIRS[2]).toEqual([0, -1]);
  });
});

describe('createFloater: a floater crosses a ledge and a pit toward the player', () => {
  const fly = (f: ReturnType<typeof createFloater>, from: Vec3, to: Vec3, seconds: number, feetY: number) => {
    let pos: Vec3 = from, refused = 0;
    const dt = 1 / 30;
    for (let i = 0; i < seconds / dt; i++) {
      f.step(dt, { pos, seen: true, player: { x: to[0], z: to[2], feetY } });
      const dx = to[0] - pos[0], dz = to[2] - pos[2], d = Math.hypot(dx, dz);
      if (d < 0.05) break;
      const s = Math.min(d, 0.8 * dt);
      const next: Vec3 = [pos[0] + dx / d * s, pos[1], pos[2] + dz / d * s];
      if (f.tryMove(pos, next)) pos = next; else refused++;
      const o = space.opening(pos[0], pos[2])!;
      expect(fitsAt(o, f.altitude, BODY)).toBe(true);
    }
    return { pos, refused };
  };
  it('starts at cruise height, not on the floor', () => {
    const f = createFloater(space, [-2.5, 0, -6], 7);
    expect(f.altitude + BODY.centre).toBeGreaterThan(T.cruiseFrac * 4 - T.bobAmpM - 1e-9);
  });
  it('from the pit to the ledge (a 2.5 m rise in all), fitting every step', () => {
    const f = createFloater(space, [6, -1, -6], 3);
    const { pos } = fly(f, [6, -1, -6], [2.5, 0, -7], 20, 0);
    expect(Math.hypot(pos[0] - 2.5, pos[2] + 7)).toBeLessThan(0.1);
    const g = fly(f, pos, [0, 1.5, -14], 30, 1.5);
    expect(Math.hypot(g.pos[0], g.pos[2] + 14)).toBeLessThan(0.1);
    expect(f.mode).toBe('chase');
  });
  it('sinks to fit under a lower ceiling before it moves on (Doom\'s floatok)', () => {
    const m = level().sectors!;
    m.sectors[1]!.ceil = 8;                       // B tall: it cruises high there; C (ceil 4) needs it lower
    const sp = createFloaterSpace(m, buildSectorGround(m), L.rooms, []);
    const f = createFloater(sp, [0, 0.5, -10.5], 11);
    for (let i = 0; i < 30; i++) f.step(1 / 30, { pos: [0, 0.5, -10.5], seen: false, player: null });
    const high = f.altitude;
    expect(high).toBeGreaterThan(fitBand(sp.opening(0, -13)!, BODY)[1] + 0.5);
    expect(f.tryMove([0, 0.5, -11.3], [0, 0.5, -11.5])).toBe(false);                  // its disc reaches C's ceiling
    for (let i = 0; i < 30; i++) f.step(1 / 30, { pos: [0, 0.5, -11.3], seen: false, player: null });
    expect(f.altitude).toBeCloseTo(high - T.descendMps, 1);                            // floating down, rate-limited
  });
  it('idle: wanders on chase-dir legs and stays near home', () => {
    const f = createFloater(space, [-2.5, 0, -6], 5);
    let pos: Vec3 = [-2.5, 0, -6], moved = 0, far = 0;
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 40; i++) {
      f.step(dt, { pos, seen: false, player: null });
      const tgt = f.legTarget(pos, dt);
      if (!tgt) continue;
      const dx = tgt[0] - pos[0], dz = tgt[2] - pos[2], d = Math.hypot(dx, dz);
      const next: Vec3 = [pos[0] + dx / d * 0.8 * dt, pos[1], pos[2] + dz / d * 0.8 * dt];
      if (f.tryMove(pos, next)) { moved += 0.8 * dt; pos = next; }
      far = Math.max(far, Math.hypot(pos[0] + 2.5, pos[2] + 6));
    }
    expect(moved).toBeGreaterThan(10);
    expect(far).toBeLessThan(T.leashM + 3);
    expect(f.mode).toBe('idle');
  });
});
