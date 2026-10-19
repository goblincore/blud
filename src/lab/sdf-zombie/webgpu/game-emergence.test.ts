// src/lab/sdf-zombie/webgpu/game-emergence.test.ts
//
// The goblin puppet's SDF layer bindings in the game (game-emergence.ts puppetGpuOpts). REGRESSION: the puppet bound the game's
// outer-hull shell, which the game builds every tick from ctx.world.actors only; he is not an actor, so no hull instance covered him,
// the march read shellOut 0 at every pixel of his proxy and discarded them all (hull-bounds.wgsl.ts): the goblin was never drawn in
// the Flat (0 march-target hits with the shell on, 4022 with it off, held at t 5.5, 320x240 boot).
import { describe, expect, it } from 'vitest';
import { puppetGpuOpts, type PuppetLayerDeps } from './game-emergence';

const layer = {
  cone: { tag: 'cone' }, occluder: { tag: 'occluder' }, prev: { tag: 'prev' }, lastFrame: { tag: 'lastFrame' },
  depthPre: { tag: 'depthPre' }, refineSource: null,
} as unknown as PuppetLayerDeps;

describe('puppetGpuOpts', () => {
  it('never binds the outer-hull shell (the hull holds the actors only: a bound shell discards every pixel of him)', () => {
    const o = puppetGpuOpts(layer, { deferred: false, lab: false });
    expect(o.shell).toBeUndefined();
    expect(o.cone).toBe(layer.cone);
    expect(o.occluder).toBe(layer.occluder);
    expect(o.prev).toBe(layer.prev);
    expect(o.lastFrame).toBe(layer.lastFrame);
    expect(o.depthPre).toBe(layer.depthPre);
    expect(o.refine).toBeUndefined();
  });
  it('the lab A/B binds the cone and the occluder only', () => {
    expect(puppetGpuOpts(layer, { deferred: false, lab: true })).toEqual({ cone: layer.cone, occluder: layer.occluder });
  });
  it('deferred mode is a surface producer, level-only shadows', () => {
    expect(puppetGpuOpts(layer, { deferred: true, lab: false })).toEqual({ output: 'surface', shadowReceiver: 'level-only' });
  });
});
