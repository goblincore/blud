// src/lab/sdf-zombie/webgpu/game-player.test.ts
//
// The player on sector ground (spec 2026-10-24 §6.2) and unchanged on flat ground.

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SECTOR_STEP_M } from './sector-def';
import type { LevelGround } from './level-ground';
import { eyeOf, PLAYER, resolveSegments, stepPlayer, type Mut3, type PlayerState } from './game-player';
import { FLAT_GROUND } from './level-ground';
import { buildSectorGround } from './sector-ground';
import { parseSectorLevel } from './sector-json';

const ground = () => buildSectorGround(parseSectorLevel(
  JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'))).sectors!);
const at = (x: number, y: number, z: number, yaw = 0): PlayerState => ({ pos: [x, y, z], vel: [0, 0, 0], yaw, pitch: 0, grounded: true });
const walk = (s: PlayerState, secs: number, g = ground(), x = 0, z = 1) => {
  for (let t = 0; t < secs; t += 1 / 60) stepPlayer(s, { x, z, jump: false }, 1 / 60, [], g);
  return s;
};

describe('resolveSegments', () => {
  it('pushes a circle off a segment to exactly its radius and reports the push', () => {
    const p: Mut3 = [0, 0, -0.1];
    const push = resolveSegments(p, [{ ax: -1, az: 0, bx: 1, bz: 0 }], 0.32);
    expect(p[2]).toBeCloseTo(-0.32, 6);
    expect(push![1]).toBeCloseTo(-0.22, 6);
  });
  it('leaves a circle clear of every segment alone', () => {
    const p: Mut3 = [0, 0, -1];
    expect(resolveSegments(p, [{ ax: -1, az: 0, bx: 1, bz: 0 }], 0.32)).toBeNull();
    expect(p).toEqual([0, 0, -1]);
  });
});

describe('stepPlayer on the sectors fixture', () => {
  it('walks up the 0.5 m step into B', () => {
    const s = walk(at(2.5, 0, -6), 1.5);                                   // forward is -z at yaw 0
    expect(s.pos[2]).toBeLessThan(-8.3);
    expect(s.pos[1]).toBeCloseTo(0.5, 6);
    expect(s.grounded).toBe(true);
  });
  it('is stopped by the 1.0 m ledge at C', () => {
    const s = walk(at(2.5, 0.5, -10), 3);
    expect(s.pos[2]).toBeGreaterThan(-12);
    expect(s.pos[2]).toBeCloseTo(-12 + PLAYER.radius, 2);
    expect(s.pos[1]).toBeCloseTo(0.5, 6);
  });
  it('drops into the pit D and cannot climb back', () => {
    const s = walk(at(2.5, 0, -6, Math.PI / 2), 2);                        // yaw pi/2 faces +x
    expect(s.pos[0]).toBeGreaterThan(4.3);
    expect(s.pos[1]).toBeCloseTo(-1, 6);
    s.yaw = -Math.PI / 2;
    walk(s, 2);
    expect(s.pos[0]).toBeCloseTo(4 + PLAYER.radius, 2);
  });
  it('is stopped by the column (a hole in A)', () => {
    const s = walk(at(0, 0, -1.5), 2);
    expect(s.pos[2]).toBeCloseTo(-3 + PLAYER.radius, 2);
  });
  it('eases the eye up a step instead of snapping', () => {
    const s = at(2.5, 0, -7.7);
    let first = NaN;
    for (let i = 0; i < 30; i++) {
      stepPlayer(s, { x: 0, z: 1, jump: false }, 1 / 60, [], ground());
      if (Number.isNaN(first) && s.pos[1] > 0.4) first = eyeOf(s)[1];
    }
    expect(first).toBeLessThan(0.5 + PLAYER.eye - 0.2);                    // the eye lags the feet on the frame they rise
    expect(eyeOf(s)[1]).toBeCloseTo(0.5 + PLAYER.eye, 6);                  // and has caught up a few frames later
  });
});

describe('stepPlayer on flat ground (room levels) is unchanged', () => {
  it('stands at y = 0 with the eye at PLAYER.eye and no lag', () => {
    const s = walk(at(0, 0, 0), 1, FLAT_GROUND as never);
    expect(s.pos[1]).toBe(0);
    expect(eyeOf(s)[1]).toBe(PLAYER.eye);
    expect(s.stepLag ?? 0).toBe(0);
  });
  it('the default ground is flat', () => {
    const s = at(0, 0, 0);
    for (let t = 0; t < 1; t += 1 / 60) stepPlayer(s, { x: 0, z: 1, jump: false }, 1 / 60, []);
    expect(s.pos[1]).toBe(0);
    expect(s.pos[2]).toBeLessThan(-2);
  });
});

describe('review fixes', () => {
  for (const dt of [1 / 60, 1 / 30]) {
    it(`climbs a step of exactly SECTOR_STEP_M at dt ${dt.toFixed(4)}`, () => {
      const raw = JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'));
      raw.sectors[1].floor = SECTOR_STEP_M;
      const g = buildSectorGround(parseSectorLevel(raw).sectors!);
      const s = at(2.5, 0, -6);
      for (let t = 0; t < 1.2; t += dt) stepPlayer(s, { x: 0, z: 1, jump: false }, dt, [], g);
      expect(s.pos[2]).toBeLessThan(-8.3);
      expect(s.pos[1]).toBeCloseTo(SECTOR_STEP_M, 6);
    });
  }

  it('puts a body that crossed a line back on the side it came from', () => {
    const wall = { ax: -1, az: 0, bx: 1, bz: 0 };
    const p: Mut3 = [0, 0, -0.05];
    resolveSegments(p, [wall], 0.32, [0, 0.5]);
    expect(p[2]).toBeCloseTo(0.32, 6);
    const q: Mut3 = [0, 0, 0.05];
    resolveSegments(q, [wall], 0.32, [0, -0.5]);
    expect(q[2]).toBeCloseTo(-0.32, 6);
  });

  it('a fast step through a wall ends on the from side', () => {
    const g: LevelGround = {
      floorAt: () => 0, ceilAt: () => Infinity,
      blockingNear: () => [{ ax: -1, az: 0, bx: 1, bz: 0 }],
    };
    const s = at(0, 0, 0.5);
    s.vel = [0, 0, -26.083];
    stepPlayer(s, { x: 0, z: 0, jump: false }, 1 / 30, [], g);
    expect(s.pos[2]).toBeCloseTo(0.32, 3);
  });

  it('zeroes horizontal velocity when a move leaves every sector', () => {
    const g: LevelGround = { floorAt: (x) => (x > 1 ? NaN : 0), ceilAt: () => Infinity, blockingNear: () => [] };
    const s = at(0.99, 0, 0);
    s.vel = [30, 0, 0];
    stepPlayer(s, { x: 0, z: 0, jump: false }, 1 / 30, [], g);
    expect(s.pos[0]).toBe(0.99);
    expect(s.vel[0]).toBe(0);
    expect(s.vel[2]).toBe(0);
  });

  it('flat ground never sets a lag, even when an overhang pushes the feet below 0', () => {
    const s = at(0, 0, 0);
    const box = { min: [-1, 1.5, -1] as const, max: [1, 2.5, 1] as const };   // underside 1.5 < height 1.75
    for (let i = 0; i < 10; i++) {
      stepPlayer(s, { x: 0, z: 0, jump: false }, 1 / 60, [box as never]);
      expect(s.stepLag ?? 0).toBe(0);
      expect(eyeOf(s)[1]).toBe(s.pos[1] + PLAYER.eye);
    }
  });
});

const fresh = (): PlayerState => ({ pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, grounded: true });

/** Jump while walking forward; frames until landing, the peak and the distance walked. */
function jump(airScale: number) {
  const s = fresh();
  let frames = 0, peak = 0;
  stepPlayer(s, { x: 0, z: 1, jump: true }, 1 / 60, [], FLAT_GROUND, airScale);
  for (frames = 1; frames < 2000 && !s.grounded; frames++) {
    stepPlayer(s, { x: 0, z: 1, jump: false }, 1 / 60, [], FLAT_GROUND, airScale);
    peak = Math.max(peak, s.pos[1]);
  }
  return { frames, peak, travelled: Math.hypot(s.pos[0], s.pos[2]) };
}

describe('stepPlayer airScale (bullet time shootdodge hang)', () => {
  it('keeps the jump height but stretches the airtime by 1/airScale', () => {
    const plain = jump(1), hang = jump(0.4);
    expect(hang.peak).toBeCloseTo(plain.peak, 1);
    expect(hang.frames / plain.frames).toBeGreaterThan(2.3);
    expect(hang.frames / plain.frames).toBeLessThan(2.7);
  });

  it('leaves the walk at full speed, so a hung jump carries further', () => {
    const plain = fresh(), hang = fresh();
    for (let i = 0; i < 60; i++) {
      stepPlayer(plain, { x: 0, z: 1, jump: false }, 1 / 60, []);
      stepPlayer(hang, { x: 0, z: 1, jump: false }, 1 / 60, [], FLAT_GROUND, 0.4);
    }
    expect(hang.pos).toEqual(plain.pos);
    expect(jump(0.4).travelled).toBeGreaterThan(jump(1).travelled * 2);
  });
});
