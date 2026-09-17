// src/lab/sdf-zombie/webgpu/game-state-render.test.ts
//
// The render slice is a bag of mutable fields with no logic of its own, so the
// test pins the contract the codemod leans on: the factory hands out private
// objects (no shared arrays, objects or maps), the literal initializers are
// exactly what game-main.ts declares, and every old binding name resolves to a
// field that exists on the state.

import { describe, expect, it } from 'vitest';
import { RENDER_BINDINGS, makeRenderState } from './game-state-render';

describe('makeRenderState', () => {
  it('gives each call its own object', () => {
    expect(makeRenderState()).not.toBe(makeRenderState());
  });

  it('gives each call its own nested arrays, objects and maps', () => {
    const a = makeRenderState();
    const b = makeRenderState();
    expect(a.visibleActors).not.toBe(b.visibleActors);
    expect(a.adaptiveFrames).not.toBe(b.adaptiveFrames);
    expect(a.depthProbes).not.toBe(b.depthProbes);
    expect(a.refineBand).not.toBe(b.refineBand);
    expect(a.upscaleAb).not.toBe(b.upscaleAb);
    expect(a.skeletonSources).not.toBe(b.skeletonSources);
    expect(a.sharedVolumeAtlases).not.toBe(b.sharedVolumeAtlases);
    expect(a.skeletonVolumes).not.toBe(b.skeletonVolumes);
  });

  it('starts at the declared defaults', () => {
    const s = makeRenderState();
    // Literal initializers in game-main.ts:
    //   actorCullEnabled = true, refinedBodies = 0, sdfScale = 1.0,
    //   refineTailWanted = 'slim', boneMesh = false, bonesVisible = true,
    //   hullExclusionsEnabled = true, occluderDesired = true,
    //   frozenHullBuilt = false, boneRatioOverride = null, texProbe = null,
    //   and the empty arrays (visibleActors / adaptiveFrames / depthProbes).
    expect(s.actorCullEnabled).toBe(true);
    expect(s.refinedBodies).toBe(0);
    expect(s.sdfScale).toBe(1.0);
    expect(s.refineTailWanted).toBe('slim');
    expect(s.boneMesh).toBe(false);
    expect(s.bonesVisible).toBe(true);
    expect(s.frozenHullBuilt).toBe(false);
    expect(s.boneRatioOverride).toBeNull();
    expect(s.visibleActors).toEqual([]);
    expect(s.depthProbes).toEqual([]);
    expect(s.refineBand).toEqual({ near: 1.5, far: 3.5, hysteresis: 0.25 });
  });
});

describe('RENDER_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    // `object` (not `Record<string, unknown>`) so the interface needs no index
    // signature: `toHaveProperty` accepts any object.
    const s: object = makeRenderState();
    for (const [oldName, path] of Object.entries(RENDER_BINDINGS)) {
      expect(path.startsWith('render.'), `${oldName} must map into the render slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('render.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(RENDER_BINDINGS)).toHaveLength(35);
  });
});
