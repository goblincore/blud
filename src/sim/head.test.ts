// src/sim/head.test.ts
import { describe, it, expect } from 'vitest';
import { spawnHead, stepHeads, HEAD_MAX_AGE_TICS, type HeadState } from './head';
import { buildArenaGeometry } from './geometry';
import { fpFromMeters } from './fp';

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
});
