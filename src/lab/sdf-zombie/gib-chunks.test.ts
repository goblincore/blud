// src/lab/sdf-zombie/gib-chunks.test.ts
import { describe, it, expect } from 'vitest';
import { makeChunk, stepChunk, type Chunk } from './gib-chunks';

const spawn = (): Chunk => makeChunk('armL', [0, 1.5, 0], [1.2, 2.0, 0.3], 0.12);

describe('stepChunk', () => {
  it('falls under gravity', () => {
    let c = spawn();
    const y0 = c.pos[1];
    for (let i = 0; i < 30; i++) c = stepChunk(c, 1 / 60);
    expect(c.pos[1]).toBeLessThan(y0 + 2.0 * 0.5); // below the ballistic apex of vy=2
  });

  it('never sinks below the floor', () => {
    let c = spawn();
    for (let i = 0; i < 600; i++) {
      c = stepChunk(c, 1 / 60);
      expect(c.pos[1]).toBeGreaterThanOrEqual(c.radius - 1e-6);
    }
  });

  it('loses energy on each bounce and comes to rest', () => {
    let c = spawn();
    for (let i = 0; i < 1200; i++) c = stepChunk(c, 1 / 60);
    expect(Math.abs(c.vel[1])).toBeLessThan(0.02);
    expect(c.pos[1]).toBeCloseTo(c.radius, 2);
  });

  it('squashes on impact and relaxes back to unit scale', () => {
    let c = spawn();
    let sawSquash = false;
    for (let i = 0; i < 200; i++) {
      c = stepChunk(c, 1 / 60);
      if (c.squash > 0.05) sawSquash = true;
    }
    expect(sawSquash).toBe(true);
    for (let i = 0; i < 400; i++) c = stepChunk(c, 1 / 60);
    expect(c.squash).toBeCloseTo(0, 2);
  });

  it('tumbles while airborne and stops spinning at rest', () => {
    let c = spawn();
    let midSpin = 0;
    for (let i = 0; i < 40; i++) { c = stepChunk(c, 1 / 60); midSpin = Math.abs(c.spin); }
    expect(midSpin).toBeGreaterThan(0);
    for (let i = 0; i < 1200; i++) c = stepChunk(c, 1 / 60);
    expect(Math.abs(c.spin)).toBeLessThan(0.05);
  });

  it('stays finite under an absurd launch velocity', () => {
    let c = makeChunk('legL', [0, 1, 0], [1e5, 1e5, 1e5], 0.1);
    for (let i = 0; i < 300; i++) c = stepChunk(c, 1 / 60);
    for (const v of [...c.pos, ...c.vel, c.spin, c.squash]) expect(Number.isFinite(v)).toBe(true);
  });
});
