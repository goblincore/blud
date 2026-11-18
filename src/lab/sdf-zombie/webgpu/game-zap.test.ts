// src/lab/sdf-zombie/webgpu/game-zap.test.ts
import { describe, expect, it } from 'vitest';
import type { GameContext } from './game-context';
import { stepZapLook, syncZapXray } from './game-zap';

type Look = { glow: number; invert: boolean; char: number } | null;
const body = (look: Look) => {
  const cfg = { x: 0, y: 0, z: 0, w: 0 };
  const a = { look, zapLook: () => a.look, view: { uniforms: { burnCfg: { value: cfg } } } };
  return a;
};
const world = (actors: ReturnType<typeof body>[]) => {
  const syncs: number[] = [];
  const ctx = {
    world: { actors },
    render: { segMeshRenderer: { syncZap: (zapOf: (o: unknown) => number) => { syncs.push(actors.reduce((n, a) => n + (zapOf(a) !== 0 ? 1 : 0), 0)); } } },
  } as unknown as GameContext;
  return { ctx, syncs };
};

describe('the zap look in the game', () => {
  it('writes the signed glow and the char to the view, and clears the glow when the zap ends', () => {
    const a = body({ glow: 0.75, invert: false, char: 0.2 }), b = body(null);
    const { ctx } = world([a, b]);
    stepZapLook(ctx);
    expect(a.view.uniforms.burnCfg.value.w).toBe(0.75);
    expect(a.view.uniforms.burnCfg.value.z).toBe(0.2);
    expect(b.view.uniforms.burnCfg.value.w).toBe(0);
    a.look = { glow: 0.5, invert: true, char: 0.2 };
    stepZapLook(ctx);
    expect(a.view.uniforms.burnCfg.value.w).toBe(-0.5);
    a.look = null;
    stepZapLook(ctx);
    expect(a.view.uniforms.burnCfg.value.w).toBe(0);
  });

  it('syncs the skeleton while a body glows and for one frame after, then does no work', () => {
    const a = body({ glow: 0.75, invert: true, char: 0 });
    const { ctx, syncs } = world([a]);
    syncZapXray(ctx);
    expect(syncs).toEqual([]);
    stepZapLook(ctx); syncZapXray(ctx);
    expect(syncs).toEqual([1]);
    a.look = null;
    stepZapLook(ctx); syncZapXray(ctx);
    expect(syncs).toEqual([1, 0]);
    syncZapXray(ctx);
    expect(syncs).toEqual([1, 0]);
  });

  it('lets go of a glowing body that left the world: a cast rebuild empties the set', () => {
    const actors = [body({ glow: 0.75, invert: false, char: 0 }), body({ glow: 0.4, invert: false, char: 0 })];
    const { ctx, syncs } = world(actors);
    stepZapLook(ctx); syncZapXray(ctx);
    expect(syncs).toEqual([2]);
    actors.length = 0;
    // The one frame after, which clears the bones; then nothing: the set is empty though neither zap ever ended.
    stepZapLook(ctx); syncZapXray(ctx);
    stepZapLook(ctx); syncZapXray(ctx);
    stepZapLook(ctx); syncZapXray(ctx);
    expect(syncs).toEqual([2, 0]);
  });
});
