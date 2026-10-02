// enableTrainedUpscale on a booted page: the stage-pass precompile vs the rAF loop.
//
// Regression (early-Z cost run, 2026-10-02): `__sdfGame.setUpscale({ trained })` paused the loop
// with setLoopRunning(false), precompiled the new stage's passes, and turned the loop back on with
// setLoopRunning(true) in a `finally` nothing awaited. Both calls wrote the loop's INTENT, so when
// that `finally` landed after a bench() had paused the loop for its own stepping, the rAF loop ran
// alongside the stepped frames and bench() never returned (every 16-body probe hit its 180 s
// bound with `loopRunning()` true). The precompile must SUSPEND the loop (warm-gate.ts), and the
// returned promise must settle only once the loop is back in its intended state.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableTrainedUpscale } from './game-render-leaves';
import { createLoopController } from './warm-gate';
import { createUpscaleModel, serializeUpscaleModel } from './upscale/upscale-model';
import type { GameContext } from './game-context';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Everything enableTrainedUpscale -> applyUpscaleAbMode -> applySdfScale touches, and no more.
 *  The loop is the REAL controller with game-main's wrap: handle.setLoopRunning sets intent. */
function fakeGame() {
  let running = true;
  const loop = createLoopController((on) => { running = on; }, true);
  const precompile = deferred<number>();
  const precompilePasses = vi.fn(() => precompile.promise);
  const ctx = {
    boot: {
      loopControl: loop,
      handle: { scene: {}, camera: { fov: 58 }, setLoopRunning: (on: boolean) => loop.set(on) },
      deferredApi: null,
    },
    render: {
      upscaleAb: { mode: 'native', config: null, model: null, modelName: null, fieldStyle: 'off' },
      upscaleAbLabel: { hidden: true, textContent: '' },
      postAa: { contentSize: { width: 800, height: 600 } },
      sdfScale: 1,
      sdfLayer: {
        upscaleStage: null,
        temporalAccum: { on: false },
        checkerAccum: false,
        targetSize: { width: 400, height: 300 },
        pixelConeK: 1,
        setScale: () => {},
        setSize: () => {},
        setConeGeometry: () => {},
        setUpscale: () => ({ on: true }),
        precompilePasses,
      },
    },
    goo: { layer: null },
    world: { actors: [] },
  } as unknown as GameContext;
  return { ctx, loop, precompile, precompilePasses, running: () => running };
}

function stubModelFetch() {
  const json = serializeUpscaleModel(createUpscaleModel('zero', 'rgb', 1));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => json })));
}

/** Lets every queued continuation run, so a stray un-awaited `finally` has landed before we look. */
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('enableTrainedUpscale (booted): stage precompile and the loop', () => {
  it('keeps a loop paused by bench() WHILE the precompile is in flight paused when it lands', async () => {
    stubModelFetch();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const g = fakeGame();
    const enabled = enableTrainedUpscale(g.ctx, 't16-rgb-v32');
    await vi.waitFor(() => expect(g.precompilePasses).toHaveBeenCalledTimes(1));
    expect(g.running()).toBe(false);          // nothing renders while the stage compiles

    g.ctx.boot.handle.setLoopRunning(false);  // bench(): pause for its own stepping
    g.precompile.resolve(7);
    await enabled;
    await settle();

    expect(g.loop.intent).toBe(false);
    expect(g.running()).toBe(false);          // the bug: the precompile restarted it
  });

  it('resolves only after the precompile has settled and the loop is running again', async () => {
    stubModelFetch();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const g = fakeGame();
    let resolved = false;
    const enabled = enableTrainedUpscale(g.ctx, 't16-rgb-v32').then((info) => { resolved = true; return info; });
    await vi.waitFor(() => expect(g.precompilePasses).toHaveBeenCalledTimes(1));
    await settle();
    expect(resolved).toBe(false);             // still compiling: a caller must not bench yet

    g.precompile.resolve(7);
    const info = await enabled;
    expect(info.on).toBe(true);
    expect(g.loop.suspended).toBe(false);
    expect(g.running()).toBe(true);           // already restored when the await returns
  });

  it('still resolves (and releases the loop) when the precompile fails', async () => {
    stubModelFetch();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = fakeGame();
    const enabled = enableTrainedUpscale(g.ctx, 't16-rgb-v32');
    await vi.waitFor(() => expect(g.precompilePasses).toHaveBeenCalledTimes(1));

    g.precompile.reject(new Error('pipeline creation failed'));
    const info = await enabled;
    expect(info.on).toBe(true);
    expect(warn).toHaveBeenCalledWith('[warm] upscale stage precompile failed', expect.any(Error));
    expect(g.loop.suspended).toBe(false);
    expect(g.running()).toBe(true);
  });
});
