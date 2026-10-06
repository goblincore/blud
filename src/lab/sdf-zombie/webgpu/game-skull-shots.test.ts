// src/lab/sdf-zombie/webgpu/game-skull-shots.test.ts
//
// The leaf's own part: which actors a projectile's step is cast at, and with what. The cast itself is the renderer's
// (skeleton-spike/mesh-renderer.test.ts) on the pure rule (skeleton-spike/skull-split-hit.test.ts).
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Projectile } from './game-weapon';
import { skullPasses } from './game-skull-shots';
import mainSrc from './game-main.ts?raw';

type Pass = { owner: unknown; sources: unknown; from: Vec3; to: Vec3; direction: Vec3; kind: string; by: unknown };

function fixture(o: { renderer?: boolean } = {}) {
  const actor = (id: number, split: boolean) => ({ id, view: { splitDrawn: split ? { preset: 'middle' } : null } }) as unknown as ZombieActor;
  const open = actor(1, true), shut = actor(2, false), other = actor(3, true), bare = actor(4, true);
  const passes: Pass[] = [];
  const sources = new Map<ZombieActor, { sources: unknown[] }>([[open, { sources: ['open'] }], [shut, { sources: ['shut'] }], [other, { sources: ['other'] }]]);
  const renderer = {
    skullPass: (owner: unknown, src: unknown, from: Vec3, to: Vec3, direction: Vec3, kind: string, by: unknown) => {
      passes.push({ owner, sources: src, from, to, direction, kind, by });
      return owner === open ? 1 : 0;
    },
  };
  const ctx = { render: { segMeshRenderer: o.renderer === false ? null : renderer, skeletonSources: sources }, world: { actors: [open, shut, other, bare] } } as unknown as GameContext;
  const p: Projectile = { pos: [0, 1.6, -1], vel: [0, -3, -4], ageSec: 0.1, radius: 0.055, kind: 'slug' };
  return { ctx, p, passes, open, shut, other, bare };
}

describe('skullPasses: a projectile\'s step at the open skulls it did not stop in', () => {
  const from: Vec3 = [0, 1.9, -0.6];

  it('a step that met no flesh: every actor whose split is drawn and that has bone meshes is passed the whole step, the projectile with it', () => {
    const f = fixture();
    expect(skullPasses(f.ctx, f.p, from, null, null)).toBe(1);
    expect(f.passes.map(q => q.owner)).toEqual([f.open, f.other]);
    for (const q of f.passes) {
      expect(q.from).toBe(from);
      expect(q.to).toBe(f.p.pos);
      expect(q.direction).toEqual([0, -0.6, -0.8]);
      expect(q.kind).toBe('slug');
      expect(q.by).toBe(f.p);
    }
    expect(f.passes.map(q => q.sources)).toEqual([['open'], ['other']]);
  });

  it('a step stopped in an actor\'s flesh: that actor is the impact\'s, and the others are passed only as far as the stop', () => {
    const f = fixture(), at: Vec3 = [0, 1.75, -0.8];
    expect(skullPasses(f.ctx, f.p, from, f.open, at)).toBe(0);
    expect(f.passes.map(q => [q.owner, q.to])).toEqual([[f.other, at]]);
    // Stopped in a closed head: both open skulls are passed, to the stop.
    f.passes.length = 0;
    skullPasses(f.ctx, f.p, from, f.shut, at);
    expect(f.passes.map(q => [q.owner, q.to])).toEqual([[f.open, at], [f.other, at]]);
  });

  it('no bone meshes, no cast; no open head, no work', () => {
    const none = fixture({ renderer: false });
    expect(skullPasses(none.ctx, none.p, from, null, null)).toBe(0);
    const f = fixture();
    for (const a of [f.open, f.other, f.bare]) (a.view as unknown as { splitDrawn: unknown }).splitDrawn = null;
    expect(skullPasses(f.ctx, f.p, from, null, null)).toBe(0);
    expect(f.passes).toHaveLength(0);
  });

  it('the projectile loop calls it after the flesh trace, and hands the impact the step\'s start and the projectile', () => {
    const trace = mainSrc.indexOf('const hp = traceProjectile(from, p.pos, q => sdBody(q, posedA));');
    const pass = mainSrc.indexOf('skullPasses(ctx, p, from, hitActor, hitPoint);');
    const impact = mainSrc.indexOf('ctx.render.segMeshRenderer.impact(hitActor, sources, hitPoint, dirN, p.kind, { from, by: p });');
    expect(trace).toBeGreaterThan(0);
    expect(pass).toBeGreaterThan(trace);
    expect(impact).toBeGreaterThan(pass);
    expect(mainSrc.match(/skullPasses\(/g)).toHaveLength(1);
  });
});
