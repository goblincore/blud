// @vitest-environment happy-dom
// src/lab/sdf-zombie/webgpu/blood-compare-main.test.ts
//
// Mock-ordered tests for the page's per-variant render path plus source
// tripwires for the page shell. Nothing here starts a GPU: importing the
// module runs bootstrap(), which bails out before createLabRenderer because
// the test DOM has no #app, and the module-level catch swallows that. What
// the import DOES prove is that the page's imports resolve and its top-level
// syntax is valid.

import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import {
  renderVariantFrame, VARIANTS, COMPARE_OUTPUT, COMPARE_SOURCE_PRESETS,
  SHAPES, SPLASH_ORIGIN, SPLASH_DIRECTION, SPLASH_CROWN_SEC,
} from './blood-compare-main';
import type { BloodSim } from '../blood-sim';
import type { GooLayer, GooDensityBlob } from './goo-layer';

const PAGE = 'src/lab/sdf-zombie/webgpu/blood-compare-main.ts';
const src = readFileSync(PAGE, 'utf8');

describe('blood comparison page', () => {
  it('imports without throwing (module syntax + import resolution)', async () => {
    // The test DOM has no #app, so bootstrap rejects before it can construct a
    // renderer; the module-level catch logs it. Silence that expected log so
    // the suite output stays readable.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(import('./blood-compare-main')).resolves.toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('blood comparison page — per-variant render order (mock, no GPU)', () => {
  it('sets state, refreshes the camera, syncs the SAME sim/camera, then renders', () => {
    const calls: string[] = [];
    const sim = { droplets: [], splats: [], clocks: {} } as unknown as BloodSim;
    const camera = {
      updateMatrixWorld: () => calls.push('camera.updateMatrixWorld'),
    };
    const gooLayer = {
      setReconstruction: (m: string) => calls.push(`setReconstruction:${m}`),
      setExtraBlobs: (b: readonly unknown[]) => calls.push(`setExtraBlobs:${b.length}`),
      setOutputTarget: (t: unknown) => calls.push(`setOutputTarget:${t === null ? 'canvas' : 'rt'}`),
      sync: (s: unknown, c: unknown) => {
        calls.push('sync');
        // The SAME sim and camera objects, and no simulation advance between
        // the extras and the render.
        expect(s).toBe(sim);
        expect(c).toBe(camera);
      },
      render: (_c: unknown, between: () => void) => {
        calls.push('render:enter'); between(); calls.push('render:exit');
      },
    };
    const extras: GooDensityBlob[] = [{ x: 0, y: 1, z: 0, halfW: 0.1, halfH: 0.1, roll: 0 }];
    const deps = {
      gooLayer: gooLayer as unknown as GooLayer,
      sim,
      camera: camera as never,
      renderScene: (t: unknown) => calls.push(`scene:${t === null ? 'canvas' : 'rt'}`),
    } as unknown as Parameters<typeof renderVariantFrame>[0];

    renderVariantFrame(deps, VARIANTS[0]!, extras, null);

    // This exact order is the blocker fix: without the sync the density
    // instancer count stays zero and no blood is drawn for ANY variant.
    expect(calls).toEqual([
      'setReconstruction:original',
      'setExtraBlobs:1',
      'setOutputTarget:canvas',
      'camera.updateMatrixWorld',
      'sync',
      'render:enter',
      'scene:canvas',
      'render:exit',
    ]);
  });

  it('syncs again for the second wipe variant (per-variant, no advance)', () => {
    const syncs: string[] = [];
    const sim = { droplets: [], splats: [], clocks: {} } as unknown as BloodSim;
    const camera = { updateMatrixWorld: () => {} };
    const gooLayer = {
      setReconstruction: () => {},
      setExtraBlobs: () => {},
      setOutputTarget: () => {},
      sync: () => { syncs.push('sync'); },
      render: (_c: unknown, between: () => void) => between(),
    };
    const deps = {
      gooLayer: gooLayer as unknown as GooLayer,
      sim, camera: camera as never, renderScene: () => {},
    } as unknown as Parameters<typeof renderVariantFrame>[0];
    renderVariantFrame(deps, VARIANTS[0]!, [], null);
    renderVariantFrame(deps, VARIANTS[2]!, [], null);
    expect(syncs.length).toBe(2);
  });

  it('the page actually calls the exported ordering function for every variant', () => {
    expect(src).toContain('renderVariantFrame({');
  });
});

describe('blood comparison page — production reuse and candidates', () => {
  it('exposes the four variants including the baseline original', () => {
    expect(VARIANTS.length).toBe(4);
  });

  it('separates the 400x300 source grid from the fixed 800x600 output', () => {
    expect(COMPARE_OUTPUT).toEqual({ width: 800, height: 600 });
    expect(COMPARE_SOURCE_PRESETS[0]).toMatchObject({ width: 400, height: 300 });
  });

  it('seeds the simulation deterministically (no Math.random anywhere)', () => {
    expect(src).not.toContain('Math.random');
  });
});

describe('blood comparison page — Current slug vs Impact splash shape axis', () => {
  it('exposes exactly two shapes, separate from the filter variants', () => {
    expect(SHAPES.map(s => s.id)).toEqual(['current', 'splash']);
    expect(SHAPES.map(s => s.id)).not.toEqual(VARIANTS.map(v => v.id));
  });

  it('defaults to the new Impact splash frozen at its representative crown moment', () => {
    expect(SPLASH_CROWN_SEC).toBeGreaterThan(0);
    expect(SPLASH_CROWN_SEC).toBeLessThan(1.15);
  });

  it('puts the splash at the SAME wound origin as the current slug burst, spraying outward', () => {
    // The current burst fires spawnImpactGout at [0, 1.35, 0.55].
    expect(SPLASH_ORIGIN).toEqual([0, 1.35, 0.55]);
    // +Z is the OUTWARD wound normal toward the default camera, not world-up.
    expect(SPLASH_DIRECTION[2]).toBeGreaterThan(0);
    expect(SPLASH_DIRECTION[1]).toBe(0);
  });
});

describe('blood comparison page — density axis (blood-density spike)', () => {
  it('threads the emission pack through every spawn site of the second sim', () => {
    // The pack must be set BEFORE the t=0 prime.
    const m = src.match(/st\.pack = pack;[\s\S]{0,200}?primeScenarioInto\(st\)/);
    expect(m).not.toBeNull();
  });
});
