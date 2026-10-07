// @vitest-environment happy-dom
// src/lab/sdf-zombie/webgpu/game-head-shot.test.ts
//
// What a gun round does to a zombie's head: the head-shot leaf against the real head split leaf, the real head damage
// leaf and a real actor, on a stub ctx and a view that swallows every call (no renderer, no WebGPU); and the actor's
// own half, the pop and the decapitation that asks first.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { makeZombie } from '../body';
import { sdBody } from '../validate';
import type { Primitive, Vec3 } from '../types';
import type { Wound } from '../damage';
import type { GameContext } from './game-context';
import { createZombieActor, type ZombieActor } from './game-actor';
import { createHeadDamage } from './game-head-damage';
import { createHeadSplit } from './game-head-split';
import { createHeadShot, slugSplitNormal } from './game-head-shot';
import { BURST_TUNING_DEFAULTS, decapitationRule, setBurstTuning } from '../head-burst';
import { headAlive, headShape } from './flame-anchors';
import { traceRaySurface } from './flail-strike';
import { woundFromSlug } from './game-weapon';
import tickSrc from './game-tick.ts?raw';
import spawnSrc from './game-spawn.ts?raw';

afterEach(() => setBurstTuning({ ...BURST_TUNING_DEFAULTS }));

interface Hooks {
  pops: { head: { origin: Vec3; prims: Primitive[] }; dir: Vec3; stump: Wound | null }[];
  severed: string[];
}
function fixture(o: { decapitate?: (c: { weapon: 'slug' | 'pellet' | 'other' }) => number | null } = {}) {
  const hooks: Hooks = { pops: [], severed: [] };
  const view = new Proxy({}, { get: () => () => {} });
  const a: ZombieActor = createZombieActor({
    id: 1, room: 0, body: buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {}), view: view as never,
    start: [0, 0, 0], seed: 3, bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, furniture: [],
    onSever: piece => { hooks.severed.push(piece.limb); },
    onHeadPop: (head, dir, stump) => { hooks.pops.push({ head, dir, stump }); },
    onDecapitate: o.decapitate ?? (({ weapon }) => decapitationRule(weapon)),
  });
  const ctx = { world: { actors: [a] }, demo: { wanderFrozen: true }, render: { frozenHullBuilt: true } } as unknown as GameContext;
  const damage = createHeadDamage(ctx, { headShape, gore: vi.fn(), burst: vi.fn(), bleed: vi.fn(), splitOpen: q => split.isOpen(q) });
  const split = createHeadSplit(ctx, { headDamaged: q => damage.has(q) });
  const opening = vi.fn((q: ZombieActor, p: Vec3, d: Vec3, s: undefined, k: 'pellet' | 'slug') => damage.burst(q, p, d, s, k));
  const bleed = vi.fn();
  const leaf = createHeadShot(ctx, { headShape, split, headDamaged: q => damage.has(q), opening: opening as never, bleed });
  const posed = a.posed();
  const c = headShape(posed)!.centre;
  /** Where a round along `dir`, through the point `off` from the head's centre, meets the posed body. */
  const on = (dir: Vec3, off: Vec3 = BROW): Vec3 => {
    const body = a.posed();
    const from: Vec3 = [c[0] + off[0] - dir[0] * 0.6, c[1] + off[1] - dir[1] * 0.6, c[2] + off[2] - dir[2] * 0.6];
    return traceRaySurface(q => sdBody(q, body), from, dir, 1.2)!;
  };
  return { a, leaf, split, damage, hooks, opening, bleed, on, centre: c };
}
const FRONT: Vec3 = [0, 0, -1], SIDE: Vec3 = [-1, 0, 0];
/** The rounds are aimed 3 cm over the head's centre: the brow from in front (the centre line meets the nose's tip,
 *  which is past the head ellipsoid's reach, BURST.maxHs), the temple from the side. */
const BROW: Vec3 = [0, 0.03, 0];

describe('the head-shot leaf: ordinary rounds', () => {
  it('a pellet on the head is left to the caller, and nothing about the head changes', () => {
    const f = fixture();
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'pellet')).toBe(false);
    expect(f.split.isOpen(f.a)).toBe(false);
    expect(f.damage.has(f.a)).toBe(false);
    expect(f.a.wounds()).toHaveLength(0);
    expect(f.opening).not.toHaveBeenCalled();
    expect(f.leaf.last(f.a.id)).toMatchObject({ rule: 'ordinary', kind: 'pellet', took: false });
  });
  it('a slug whose line runs wide of the head is ordinary', () => {
    const f = fixture();
    setBurstTuning({ splitFrac: 0.5 });
    const p = f.on(FRONT, [0.07, 0, 0]);
    expect(f.leaf.hit(f.a, p, FRONT, undefined, 'slug')).toBe(false);
    expect(f.leaf.last(f.a.id)!.rule).toBe('ordinary');
    expect(f.leaf.last(f.a.id)!.offset).toBeGreaterThan(0.5);
    expect(f.split.isOpen(f.a)).toBe(false);
  });
  it('a round on the torso is not judged at all', () => {
    const f = fixture();
    const torso = f.on(FRONT, [0, -0.45, 0]);
    expect(f.leaf.hit(f.a, torso, FRONT, undefined, 'slug')).toBe(false);
    expect(f.leaf.last(f.a.id)).toBeNull();
  });
  it('switched off, a centred slug is ordinary', () => {
    const f = fixture();
    setBurstTuning({ on: false });
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug')).toBe(false);
    expect(f.split.isOpen(f.a)).toBe(false);
  });
});

describe('the slug split', () => {
  it('a centred slug from the front opens the head left and right, to the full angle, and the zombie keeps its head', () => {
    const f = fixture();
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug')).toBe(true);
    expect(f.leaf.last(f.a.id)).toMatchObject({ rule: 'split', kind: 'slug', took: true });
    const st = f.split.state(f.a.id)!;
    expect(st.preset).toBe('middle');
    // Sprung toward the preset's full angle, as the axe's second chop leaves it.
    for (let i = 0; i < 240; i++) f.split.tick(1 / 60);
    const settled = f.split.state(f.a.id)!;
    expect(settled.target).toBeGreaterThan(0);
    expect(settled.angle).toBeCloseTo(settled.target, 2);
    expect(headAlive(f.a.posed())).toBe(true);
    // The split's cut faces are the slug's wound, and they bleed.
    expect(f.a.wounds().filter(w => w.headRegion === 'split+' || w.headRegion === 'split-').length).toBeGreaterThan(0);
    expect(f.bleed).toHaveBeenCalled();
    expect(f.hooks.pops).toHaveLength(0);
  });
  it('the opening fraction is the tuning\'s', () => {
    const full = fixture();
    full.leaf.hit(full.a, full.on(FRONT), FRONT, undefined, 'slug');
    const half = fixture();
    setBurstTuning({ splitOpen: 0.5 });
    half.leaf.hit(half.a, half.on(FRONT), FRONT, undefined, 'slug');
    expect(half.split.state(half.a.id)!.target).toBeCloseTo(full.split.state(full.a.id)!.target * 0.5, 5);
  });
  it('a centred slug from the side takes the face preset: the plane holds the shot and the head\'s up axis', () => {
    const f = fixture();
    expect(f.leaf.hit(f.a, f.on(SIDE), SIDE, undefined, 'slug')).toBe(true);
    expect(f.split.state(f.a.id)!.preset).toBe('face');
    expect(slugSplitNormal(FRONT, [0, 0, 0, 1]).map(v => Math.abs(v))).toEqual([1, 0, 0]);
    expect(slugSplitNormal(SIDE, [0, 0, 0, 1]).map(v => Math.abs(v))).toEqual([0, 0, 1]);
    // Straight down the up axis there is no such plane: left and right.
    expect(slugSplitNormal([0, -1, 0], [0, 0, 0, 1])).toEqual([1, 0, 0]);
  });
  it('an earlier ordinary slug wound on the head does not stop a later centred slug from splitting it', () => {
    const f = fixture();
    setBurstTuning({ splitFrac: 0.5 });
    const wide = f.on(FRONT, [0.07, 0.02, 0]);
    expect(f.leaf.hit(f.a, wide, FRONT, undefined, 'slug')).toBe(false);
    f.a.hitSlug(wide, FRONT);
    expect(f.a.wounds().length).toBeGreaterThan(0);
    if (!headAlive(f.a.posed())) throw new Error('fixture: one slug took the head off');
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug')).toBe(true);
    expect(f.split.isOpen(f.a)).toBe(true);
  });
  it('a head the flail has damaged is refused by the split: the centred slug is ordinary', () => {
    const f = fixture();
    expect(f.damage.hit(f.a, f.on(FRONT, [0, 0.03, 0]), FRONT, { meterCredit: 0.1, shove: 5, side: 'R' })).toBe(true);
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug')).toBe(false);
    expect(f.leaf.last(f.a.id)).toMatchObject({ rule: 'ordinary', took: false });
    expect(f.split.isOpen(f.a)).toBe(false);
  });
});

describe('the pop on a split head', () => {
  it('a second centred slug swells the open head for popSwellS and then bursts it: no flying head', () => {
    const f = fixture();
    f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug');
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug')).toBe(true);
    expect(f.leaf.last(f.a.id)).toMatchObject({ rule: 'pop', took: true });
    expect(f.a.headPopping()).toBe(true);
    expect(headAlive(f.a.posed())).toBe(true);
    expect(f.hooks.pops).toHaveLength(0);
    // Half the swell: the head is bigger and still on.
    const before = headShape(f.a.posed())!.axes[0];
    expect(f.a.advanceHeadPop(BURST_TUNING_DEFAULTS.popSwellS / 2)).toBe(true);
    expect(headShape(f.a.posed())!.axes[0]).toBeGreaterThan(before);
    expect(headAlive(f.a.posed())).toBe(true);
    // The rest of it: the burst.
    expect(f.a.advanceHeadPop(BURST_TUNING_DEFAULTS.popSwellS / 2 + 1e-6)).toBe(true);
    expect(f.a.headPopping()).toBe(false);
    expect(headAlive(f.a.posed())).toBe(false);
    expect(f.hooks.pops).toHaveLength(1);
    expect(f.hooks.pops[0]!.dir).toEqual(FRONT);
    expect(f.hooks.pops[0]!.head.prims.length).toBeGreaterThan(0);
    expect(f.hooks.severed).not.toContain('head');
    expect(f.a.advanceHeadPop(1 / 60)).toBe(false);
  });
  it('a round that lands while the head swells is ordinary, and the head pops once', () => {
    const f = fixture();
    f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug');
    f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug');
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug')).toBe(false);
    expect(f.a.beginHeadPop(FRONT, 0.1)).toBe(false);
    f.a.advanceHeadPop(1);
    expect(f.hooks.pops).toHaveLength(1);
  });
  it('popSwellS 0 bursts on the hit', () => {
    const f = fixture();
    setBurstTuning({ popSwellS: 0 });
    f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug');
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug')).toBe(true);
    expect(f.a.headPopping()).toBe(false);
    expect(headAlive(f.a.posed())).toBe(false);
    expect(f.hooks.pops).toHaveLength(1);
  });
  it('a pellet, or popOnSplit off, leaves the open head on', () => {
    const f = fixture();
    f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug');
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'pellet')).toBe(false);
    setBurstTuning({ popOnSplit: false });
    expect(f.leaf.hit(f.a, f.on(FRONT), FRONT, undefined, 'slug')).toBe(false);
    expect(f.a.headPopping()).toBe(false);
    expect(headAlive(f.a.posed())).toBe(true);
  });
});

describe('the decapitation asks first (the actor)', () => {
  const DIRS: Vec3[] = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  /** Round `n`'s hit on the neck: from the front, the back and each side in turn. */
  function neckHit(f: ReturnType<typeof fixture>, n: number): { at: Vec3; dir: Vec3 } {
    const dir = DIRS[n % 4]!, body = f.a.posed();
    const neck = body.prims.find(p => p.limb === 'head' && p.bone === 'neck') ?? body.prims.find(p => p.limb === 'head')!;
    const mid: Vec3 = [(neck.a[0] + neck.b[0]) / 2, (neck.a[1] + neck.b[1]) / 2, (neck.a[2] + neck.b[2]) / 2];
    return { at: traceRaySurface(q => sdBody(q, body), [mid[0] - dir[0] * 0.5, mid[1], mid[2] - dir[2] * 0.5], dir, 1) ?? mid, dir };
  }
  const headLeft = (f: ReturnType<typeof fixture>) => f.a.headPopping() || !headAlive(f.a.posed());
  /** Slugs into the neck from all round until the head leaves or swells. Returns how many it took (-1: it held). */
  function cutNeck(f: ReturnType<typeof fixture>, max = 40): number {
    for (let n = 1; n <= max; n++) {
      const h = neckHit(f, n);
      f.a.hitSlug(h.at, h.dir);
      if (headLeft(f)) return n;
    }
    return -1;
  }
  /** The same slugs but the last, so the neck is one round from cut. */
  function nearlyCut(f: ReturnType<typeof fixture>): number {
    setBurstTuning({ slugPop: false });
    const n = cutNeck(fixture());
    setBurstTuning({ ...BURST_TUNING_DEFAULTS });
    for (let k = 1; k < n; k++) { const h = neckHit(f, k); f.a.hitSlug(h.at, h.dir); }
    if (headLeft(f)) throw new Error('fixture: the head left early');
    return n;
  }
  it('a slug that cuts the head off pops it: the head holds through the swell, then bursts, and never flies', () => {
    const f = fixture();
    expect(cutNeck(f)).toBeGreaterThan(0);
    expect(f.a.headPopping()).toBe(true);
    expect(headAlive(f.a.posed())).toBe(true);
    expect(f.hooks.severed).not.toContain('head');
    // More slugs while it swells do not take it off either.
    cutNeck(f, 2);
    expect(f.hooks.severed).not.toContain('head');
    f.a.advanceHeadPop(BURST_TUNING_DEFAULTS.popSwellS + 0.01);
    expect(headAlive(f.a.posed())).toBe(false);
    expect(f.hooks.pops).toHaveLength(1);
    expect(f.hooks.severed).not.toContain('head');
    // The neck's stump is stamped, as the ordinary sever's is.
    expect(f.hooks.pops[0]!.stump).not.toBeNull();
  });
  it('popSwellS 0: the slug that cuts the head off bursts it in the same hit', () => {
    setBurstTuning({ popSwellS: 0 });
    const f = fixture();
    expect(cutNeck(f)).toBeGreaterThan(0);
    expect(f.a.headPopping()).toBe(false);
    expect(headAlive(f.a.posed())).toBe(false);
    expect(f.hooks.pops).toHaveLength(1);
    expect(f.hooks.severed).not.toContain('head');
  });
  it('a blast that cuts the head off sends it flying, as before: only the slug\'s decapitation pops', () => {
    const f = fixture();
    const n = nearlyCut(f);
    // The last round's wound, delivered as a blast's (the dynamite's path) instead of a slug's.
    const h = neckHit(f, n), body = f.a.posed();
    const w = woundFromSlug(body.prims, h.at, q => sdBody(q, body), f.a.pose().yaw);
    f.a.blast({ wounds: [w], meterCredit: 0, impulse: null });
    expect(f.a.headPopping()).toBe(false);
    // (The body, not the pose: a blast's own sever is posed at the actor's next step.)
    expect(f.a.body.clusters.find(c => c.limb === 'head')!.alive).toBe(false);
    expect(f.hooks.severed).toContain('head');
    expect(f.hooks.pops).toHaveLength(0);
  });
  it('slugPop off: the slug\'s decapitation is the flying head', () => {
    setBurstTuning({ slugPop: false });
    const f = fixture();
    expect(cutNeck(f)).toBeGreaterThan(0);
    expect(f.hooks.severed).toContain('head');
    expect(f.hooks.pops).toHaveLength(0);
  });
  it('the hook is told what cut the head off: a slug, a pellet volley with a slug in it, a blast', () => {
    const causes: string[] = [];
    const tell = ({ weapon }: { weapon: 'slug' | 'pellet' | 'other' }) => { causes.push(weapon); return null; };
    cutNeck(fixture({ decapitate: tell }));
    expect(causes).toEqual(['slug']);
    // One batch of rounds (a frame's worth): a pellet and the slug that cuts. The slug names the batch.
    const g = fixture({ decapitate: tell });
    const n = nearlyCut(g), h = neckHit(g, n);
    g.a.beginHits(); g.a.hitSlug(h.at, h.dir); g.a.hit(g.on(FRONT), FRONT); g.a.endHits();
    expect(causes).toEqual(['slug', 'slug']);
    const b = fixture({ decapitate: tell });
    const m = nearlyCut(b), hb = neckHit(b, m), body = b.a.posed();
    b.a.blast({ wounds: [woundFromSlug(body.prims, hb.at, q => sdBody(q, body), b.a.pose().yaw)], meterCredit: 0, impulse: null });
    expect(causes).toEqual(['slug', 'slug', 'other']);
  });
  it('pellets alone are a pellet\'s cause: the tail after a volley with no slug says so', () => {
    const causes: string[] = [];
    const f = fixture({ decapitate: ({ weapon }) => { causes.push(weapon); return null; } });
    const n = nearlyCut(f);
    // Pellets round the nearly cut neck until it goes (or 300 have landed: then the cause was never asked).
    for (let k = 0; k < 300 && !headLeft(f); k++) { const h = neckHit(f, n + k); f.a.hit(h.at, h.dir); }
    if (headLeft(f)) expect(causes).toEqual(['pellet']);
    else expect(causes).toEqual([]);
  });
  it('a body with no onHeadPop cannot pop: beginHeadPop refuses', () => {
    const view = new Proxy({}, { get: () => () => {} });
    const a = createZombieActor({ id: 2, room: 0, body: buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {}), view: view as never,
      start: [0, 0, 0], seed: 3, bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, furniture: [] });
    expect(a.beginHeadPop(FRONT, 0.1)).toBe(false);
    expect(a.headPopping()).toBe(false);
  });
});

describe('the wiring', () => {
  it('the projectile loop asks the head-shot leaf before it stamps a round\'s own wound', () => {
    expect(tickSrc).toContain('ctx.weapon.headShot?.hit(hitActor, hitPoint, dirN, p.shot, p.kind)');
    expect(tickSrc).not.toContain('ctx.weapon.headDamage?.burst(');
    expect(tickSrc).toContain('a.advanceHeadPop(dt)');
  });
  it('the zombie is spawned with the pop and with the decapitation rule', () => {
    expect(spawnSrc).toContain('onDecapitate: ({ weapon }');
    expect(spawnSrc).toContain('decapitationRule(weapon)');
    expect(spawnSrc).toContain("characterEntry(name).profile.soft || name === 'zombie'");
  });
});
