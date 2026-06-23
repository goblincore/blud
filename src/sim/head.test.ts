// src/sim/head.test.ts
import { describe, it, expect } from 'vitest';
import { spawnHead, stepHeads, kickHeads, HEAD_MAX_AGE_TICS,
         KICK_UP, KICK_COOLDOWN_TICS, KICK_MAX_HEIGHT, type HeadState } from './head';
import { buildArenaGeometry } from './geometry';
import { fpFromMeters, metersPerSecToFp } from './fp';
import { createPlayerState } from './player';

const GEO = buildArenaGeometry();

describe('head physics', () => {
  it('falls under gravity and comes to rest on the floor', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, 0, fpFromMeters(5), 0, 0, 0, 0, 0);
    for (let t = 1; t <= 600; t++) stepHeads(heads, GEO, t);
    expect(heads.length).toBe(1);
    expect(heads[0]!.y).toBe(0);
    expect(heads[0]!.resting).toBe(true);
  });

  it('bounces off the floor before resting (elastic > 0)', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, 0, fpFromMeters(3), 0, 0, 0, 0, 0);
    let bounced = false;
    for (let t = 1; t <= 200; t++) {
      const beforeVy = heads[0]!.vy;
      stepHeads(heads, GEO, t);
      if (beforeVy < 0 && heads[0]!.vy > 0) bounced = true; // velocity flipped up at the floor
    }
    expect(bounced).toBe(true);
  });

  it('decrements the kick cooldown each tic', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, 0, 0, 0, 0, 0, 0, 0);
    heads[0]!.kickCooldownTics = 3;
    stepHeads(heads, GEO, 1);
    expect(heads[0]!.kickCooldownTics).toBe(2);
  });

  it('despawns after HEAD_MAX_AGE_TICS', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, 0, fpFromMeters(1), 0, 0, 0, 0, 0);
    for (let t = 1; t <= HEAD_MAX_AGE_TICS; t++) stepHeads(heads, GEO, t);
    expect(heads.length).toBe(0);
  });

  it('floor friction brings a sliding head to rest (no infinite hockey-puck glide)', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, 0, 0, 0, metersPerSecToFp(5), 0, 0, 0); // on the floor, sliding +X at 5 m/s
    for (let t = 1; t <= 240; t++) stepHeads(heads, GEO, t);
    expect(heads[0]!.vx).toBe(0);                       // friction stopped it (was: glides forever)
    expect(heads[0]!.vz).toBe(0);
    expect(heads[0]!.x).toBeLessThan(fpFromMeters(2));  // bounded skid, not a glide across the arena
  });
});

describe('head kick', () => {
  it('kicks a nearby grounded head along the player facing', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, fpFromMeters(0.3), 0, 0, 0, 0, 0, 0); // 0.3 m to +X, on the floor
    const player = createPlayerState();
    player.x = 0; player.z = 0; player.yaw = 1536; // yaw 1536 -> forward = +X (sim yaw is CCW: 0->-Z, 1536->+X)
    kickHeads(player, heads);
    expect(heads[0]!.vx).toBeGreaterThan(0);          // booted toward +X
    expect(heads[0]!.vy).toBe(KICK_UP);               // pops up
    expect(heads[0]!.kickCooldownTics).toBe(KICK_COOLDOWN_TICS);
  });

  it('launches the head into the air on a kick (vertical pop, soccer-ball arc)', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, fpFromMeters(0.3), 0, 0, 0, 0, 0, 0);
    const player = createPlayerState();
    player.yaw = 1536; // forward = +X
    kickHeads(player, heads);
    expect(heads[0]!.vy).toBeGreaterThan(metersPerSecToFp(4)); // clearly launches up (not a 12 cm twitch)
    let maxY = 0;
    for (let t = 1; t <= 60; t++) { stepHeads(heads, GEO, t); maxY = Math.max(maxY, heads[0]!.y); }
    expect(maxY).toBeGreaterThan(fpFromMeters(0.3));          // rises a real arc off the floor
  });

  it('does not kick a head out of reach', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, fpFromMeters(2), 0, 0, 0, 0, 0, 0); // 2 m away
    const player = createPlayerState();
    kickHeads(player, heads);
    expect(heads[0]!.vx).toBe(0);
    expect(heads[0]!.kickCooldownTics).toBe(0);
  });

  it('does not kick a head airborne above KICK_MAX_HEIGHT', () => {
    const heads: HeadState[] = [];
    const highY = KICK_MAX_HEIGHT + fpFromMeters(0.5);
    spawnHead(heads, fpFromMeters(0.2), highY, 0, 0, 0, 0, 0);
    const player = createPlayerState();
    kickHeads(player, heads);
    expect(heads[0]!.vx).toBe(0);
  });

  it('respects the kick cooldown (no re-kick while cooling down)', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, fpFromMeters(0.2), 0, 0, 0, 0, 0, 0);
    const player = createPlayerState();
    player.yaw = 512;
    kickHeads(player, heads);                 // first kick sets cooldown
    heads[0]!.vx = 0; heads[0]!.vy = 0;        // pretend the head stopped, cooldown still active
    kickHeads(player, heads);                 // still cooling down -> ignored
    expect(heads[0]!.vx).toBe(0);
  });
});
