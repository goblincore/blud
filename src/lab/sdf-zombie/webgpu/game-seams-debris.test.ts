// src/lab/sdf-zombie/webgpu/game-seams-debris.test.ts — the debris seams' drivers on a stub context.
// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
// The seams import game-hit-trace, whose import chain reads `location` at module load (a browser global).
vi.hoisted(() => { (globalThis as { location?: unknown }).location ??= new URL('http://localhost/sdf-game.html'); });
import { createDebrisSeams } from './game-seams-debris';
import { createBloodSim } from '../blood-sim';
import { parseSectorLevel } from './sector-json';
import { buildSectorGround } from './sector-ground';
import { FLAT_GROUND } from './level-ground';
import type { GameContext } from './game-context';
import type { ActorBlastEffect } from './game-actor';

function actor(id: number, state: { collapsed?: boolean; tearing?: boolean } = {}) {
  const blasts: ActorBlastEffect[] = [];
  return {
    blasts,
    a: {
      id,
      tearing: () => state.tearing ?? false,
      motionFrame: () => (state.collapsed === undefined ? null : { collapsed: state.collapsed }),
      blast: (e: ActorBlastEffect) => { blasts.push(e); },
    },
  };
}

const ctxWith = (actors: unknown[], level: unknown = { def: {}, ground: FLAT_GROUND }) =>
  ({ world: { actors, level }, vfx: { bloodSim: createBloodSim() } }) as unknown as GameContext;

describe('collapseActor', () => {
  it('drops a standing actor with no blast reaction (no stagger before the fall)', () => {
    const s = actor(1, { collapsed: false });
    expect(createDebrisSeams(ctxWith([s.a])).collapseActor(1)).toBe(true);
    expect(s.blasts).toEqual([{ wounds: [], meterCredit: 0, impulse: null, forceCollapse: true, reaction: 'none' }]);
  });
  it('touches nothing for an actor that is down, tearing apart, or gone', () => {
    const down = actor(1, { collapsed: true }), tearing = actor(2, { tearing: true });
    const seams = createDebrisSeams(ctxWith([down.a, tearing.a]));
    expect(seams.collapseActor(1)).toBe(false);
    expect(seams.collapseActor(2)).toBe(false);
    expect(seams.collapseActor(3)).toBe(false);
    expect(down.blasts).toHaveLength(0);
    expect(tearing.blasts).toHaveLength(0);
  });
});

describe('bloodBurstAt', () => {
  it('room levels: the shipped burst (no floorY on the drops)', () => {
    const ctx = ctxWith([]);
    expect(createDebrisSeams(ctx).bloodBurstAt(0, 1, 0)).toBeGreaterThan(0);
    expect(ctx.vfx.bloodSim.droplets.every((d) => !('floorY' in d))).toBe(true);
  });
  it('sector levels: the drops carry the floor under the point (the real seat path)', () => {
    const map = parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'))).sectors!;
    const ctx = ctxWith([], { def: { sectors: map }, ground: buildSectorGround(map) });
    createDebrisSeams(ctx).bloodBurstAt(0, 1.5, -10);              // over B, floor 0.5
    expect(ctx.vfx.bloodSim.droplets.length).toBeGreaterThan(0);
    expect(ctx.vfx.bloodSim.droplets.every((d) => d.floorY === 0.5)).toBe(true);
  });
});
