// src/lab/sdf-zombie/webgpu/game-zap.test.ts
import { describe, expect, it } from 'vitest';
import type { GameContext } from './game-context';
import { stepZapLook, syncZapXray } from './game-zap';

type Look = { glow: number; invert: boolean; char: number } | null;
const body = (look: Look) => {
  const cfg = { x: 0, y: 0, z: 0, w: 0 };
  const a = { look, zapLook: () => a.look, view: { uniforms: { burnCfg: { value: cfg }, zapChar: { value: 0 } } } };
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
  it('writes the signed glow to the view and the char to its holding slot, and clears both when the zap ends', () => {
    const a = body({ glow: 0.75, invert: false, char: 0.2 }), b = body(null);
    a.view.uniforms.burnCfg.value.z = 0.1;   // the burn's own char
    const { ctx } = world([a, b]);
    stepZapLook(ctx);
    expect(a.view.uniforms.burnCfg.value.w).toBe(0.75);
    // The zap's char is NOT written to burnCfg.z: a crowd type's material takes its source view's burnCfg whole, so
    // every body of the type would char with it. It rides the holding slot, which only the body's record reads.
    expect(a.view.uniforms.burnCfg.value.z).toBe(0.1);
    expect(a.view.uniforms.zapChar.value).toBe(0.2);
    expect(b.view.uniforms.burnCfg.value.w).toBe(0);
    expect(b.view.uniforms.zapChar.value).toBe(0);
    a.look = { glow: 0.5, invert: true, char: 0.2 };
    stepZapLook(ctx);
    expect(a.view.uniforms.burnCfg.value.w).toBe(-0.5);
    // A corpse keeps its char with the glow out.
    a.look = { glow: 0, invert: false, char: 1 };
    stepZapLook(ctx);
    expect(a.view.uniforms.burnCfg.value.w).toBe(0);
    expect(a.view.uniforms.zapChar.value).toBe(1);
    // No look at all (the actor's endTear reset the zap): the char leaves the body with it.
    a.look = null;
    stepZapLook(ctx);
    expect(a.view.uniforms.burnCfg.value.w).toBe(0);
    expect(a.view.uniforms.zapChar.value).toBe(0);
    expect(a.view.uniforms.burnCfg.value.z).toBe(0.1);
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
