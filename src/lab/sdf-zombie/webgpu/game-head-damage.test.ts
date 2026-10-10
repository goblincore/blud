// @vitest-environment happy-dom
// src/lab/sdf-zombie/webgpu/game-head-damage.test.ts
//
// The head damage leaf and the head split do not mix (game-head-split.ts): while a head is split open the leaf declines
// both of its ways in (the flail's ladder, the slug burst), and it reports whether it holds state for a head so the
// split can refuse one. The real leaf and a real actor against a stub ctx and a view that swallows every call: no
// renderer, no WebGPU.
import { describe, expect, it, vi } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { makeZombie } from '../body';
import { sdBody } from '../validate';
import type { Vec3 } from '../types';
import type { GameContext } from './game-context';
import { createZombieActor, type ZombieActor } from './game-actor';
import { createHeadDamage, type HeadDamageDeps } from './game-head-damage';
import { createHeadSeams } from './game-seams-head';
import { headShape } from './flame-anchors';
import { traceRaySurface } from './flail-strike';
import flailSrc from './game-flail.ts?raw';
import mainSrc from './game-main.ts?raw';

function freshActor(id = 1): ZombieActor {
  const view = new Proxy({}, { get: () => () => {} });
  return createZombieActor({ id, room: 0, body: buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {}), view: view as never,
    start: [0, 0, 0], seed: 3, bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, furniture: [] });
}

function fixture(splitOpen?: (a: ZombieActor) => boolean) {
  const a = freshActor();
  const ctx = { world: { actors: [a] }, demo: { wanderFrozen: true } };
  const deps: HeadDamageDeps = { headShape, gore: vi.fn(), burst: vi.fn(), bleed: vi.fn(), splitOpen };
  const leaf = createHeadDamage(ctx as unknown as GameContext, deps);
  // The brow, from in front of the face.
  const posed = a.posed();
  const c = headShape(posed)!.centre;
  const dir: Vec3 = [0, 0, -1];
  const point = traceRaySurface(q => sdBody(q, posed), [c[0], c[1] + 0.03, c[2] + 0.6], dir, 1)!;
  return { a, leaf, deps, point, dir };
}
const FEEL = { meterCredit: 0.1, shove: 5, side: 'R' as const };

describe('head damage holds state for a head it has hit', () => {
  it('has(a) is false on a fresh head and true once the flail\'s ladder or a burst has touched it', () => {
    const f = fixture();
    expect(f.leaf.has(f.a)).toBe(false);
    expect(f.leaf.hit(f.a, f.point, f.dir, FEEL)).toBe(true);
    expect(f.leaf.has(f.a)).toBe(true);
    expect(f.a.wounds().some(w => w.headSlot === 'keep')).toBe(true);
    f.leaf.forget(f.a.id);
    expect(f.leaf.has(f.a)).toBe(false);

    const g = fixture();
    expect(g.leaf.burst(g.a, g.point, g.dir, undefined, 'slug')).toBe(true);
    expect(g.leaf.has(g.a)).toBe(true);
  });
});

describe('a split head is not head damage\'s: both ways in decline', () => {
  it('hit() returns false and does nothing (no state, no wound, no blood): the flail then stamps its plain crater', () => {
    const f = fixture(() => true);
    expect(f.leaf.hit(f.a, f.point, f.dir, FEEL)).toBe(false);
    expect(f.leaf.has(f.a)).toBe(false);
    expect(f.leaf.debug(f.a.id)).toBeNull();
    expect(f.a.wounds()).toHaveLength(0);
    expect(f.deps.bleed).not.toHaveBeenCalled();
    expect(f.deps.gore).not.toHaveBeenCalled();
  });
  it('burst() returns false and does nothing: the caller takes the ordinary slug / pellet path', () => {
    const f = fixture(() => true);
    for (const kind of ['slug', 'pellet'] as const) expect(f.leaf.burst(f.a, f.point, f.dir, undefined, kind)).toBe(false);
    expect(f.leaf.has(f.a)).toBe(false);
    expect(f.a.wounds()).toHaveLength(0);
    expect(f.deps.burst).not.toHaveBeenCalled();
  });
  it('the predicate is asked per actor: another actor\'s closed head still takes the ladder', () => {
    const f = fixture(a => a.id === 99);
    expect(f.leaf.hit(f.a, f.point, f.dir, FEEL)).toBe(true);
    expect(f.leaf.has(f.a)).toBe(true);
  });
  it('the head.hit seam reports the leaf\'s answer: true for a hit taken, false for one declined or with no actor', () => {
    const open = new Set<number>();
    const f = fixture(a => open.has(a.id));
    const ctx = { world: { actors: [f.a] }, weapon: { headDamage: f.leaf } };
    const hit = (id: number) => createHeadSeams(ctx as unknown as GameContext).head.hit(id, ...f.point, ...f.dir);
    expect(hit(99)).toBe(false);
    open.add(f.a.id);
    expect(hit(f.a.id)).toBe(false);
    expect(f.leaf.has(f.a)).toBe(false);
    open.clear();
    expect(hit(f.a.id)).toBe(true);
    expect(f.leaf.has(f.a)).toBe(true);
  });
  it('the flail falls through to its plain crater when the ladder declines (source pin: the flail has no harness)', () => {
    expect(flailSrc).toContain('if (region && deps.headHit?.(a, h.point, h.dir, { meterCredit: f.meterCredit, shove: f.shove, side, gain })) {');
    // With no head damage leaf the hit still counts as taken (no plain crater), as before the split existed.
    expect(mainSrc).toContain('headHit: (a, p, d, f) => ctx.weapon.headDamage?.hit(a, p, d, f) ?? true,');
  });
});
