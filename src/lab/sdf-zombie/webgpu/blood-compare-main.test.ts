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
} from './blood-compare-main';
import type { BloodSim } from '../blood-sim';
import type { GooLayer, GooDensityBlob } from './goo-layer';

const PAGE = 'src/lab/sdf-zombie/webgpu/blood-compare-main.ts';
const src = readFileSync(PAGE, 'utf8');
const html = readFileSync('sdf-blood-compare.html', 'utf8');
const vite = readFileSync('vite.config.ts', 'utf8');

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

  it('the html shell mounts the page module and the UI slots', () => {
    expect(html).toContain('/src/lab/sdf-zombie/webgpu/blood-compare-main.ts');
    expect(html).toContain('id="app"');
    expect(html).toContain('id="controls"');
    expect(html).toContain('id="diag"');
    expect(html).toContain('id="errors"');
  });

  it('vite registers the page as a build entry', () => {
    expect(vite).toContain("sdfBloodCompare: resolve(__dirname, 'sdf-blood-compare.html')");
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
    // One BloodSim only; the two wipe variants re-render the SAME frame.
    expect((src.match(/createBloodSim\(/g) ?? []).length).toBe(1);
  });
});

describe('blood comparison page — production reuse and candidates', () => {
  it('uses the shared production blood + goo + view functions', () => {
    for (const fn of [
      'createGooLayer', 'createBloodSim', 'burst', 'spawnWoundDroplets',
      'spawnImpactGout', 'stepBlood', 'connectionBlobsForSim', 'applyGameGooDefaults',
      'createBloodView',
    ]) {
      expect(src, `${fn} must be used`).toContain(fn);
    }
  });

  it('uses the game blood view options and visibility (mist + splats on, beads off)', () => {
    expect(src).toContain('dropletDepthWrite: true');
    expect(src).toContain('dropletViewScale: 0.5');
    expect(src).toContain('stretch: { k: 0.5, max: 3.5, thin: true }');
    expect(src).toContain('mist: true');
    expect(src).toContain('ribbons: true');
    expect(src).toContain('bloodView.setBeadsVisible(false)');
    expect(src).toContain('bloodView.setMistVisible(true)');
    expect(src).toContain('bloodView.dispose()');
    expect(src).toContain('bloodView.sync(sim, camera)');
    // Per-layer attribution toggles.
    expect(src).toContain('gooVisible');
    expect(src).toContain('mistVisible');
  });

  it('exposes the four variants including the baseline original', () => {
    expect(src).toContain("id: 'original'");
    expect(src).toContain("id: 'smooth'");
    expect(src).toContain("id: 'original-connections'");
    expect(src).toContain("id: 'smooth-connections'");
    expect(VARIANTS.length).toBe(4);
  });

  it('separates the 400x300 source grid from the fixed 800x600 output', () => {
    expect(COMPARE_OUTPUT).toEqual({ width: 800, height: 600 });
    expect(COMPARE_SOURCE_PRESETS[0]).toMatchObject({ width: 400, height: 300 });
    expect(src).toContain('gooLayer.setSize(sourceW, sourceH)');
    expect(src).toContain("mode: 'fixed', width: COMPARE_OUTPUT.width, height: COMPARE_OUTPUT.height");
  });

  it('labels the split a full-size wipe, not a squashed side-by-side', () => {
    expect(src).toContain('wipe');
    expect(src).toContain('wipe at ');
    // The old half-canvas squashed blit must be gone.
    expect(src).not.toContain('const halfW = Math.max(1, Math.floor(w / 2));');
    expect(src).toContain('const cut = Math.max(1, Math.min(w - 1, Math.round(w * wipePos)));');
  });

  it('starts paused: the loop is stopped after one present', () => {
    expect(src).toContain('handle.setLoopRunning(false);');
    // The loop restarts only from the two explicit play paths (the Play button
    // and the __bloodCompare.play API), never during bootstrap.
    const startCalls = src.match(/setLoopRunning\(true\)/g) ?? [];
    expect(startCalls.length).toBe(2);
    const playSets = src.match(/playing = true; handle\.setLoopRunning\(true\)/g) ?? [];
    expect(playSets.length).toBe(2);
  });

  it('seeds the simulation deterministically (no Math.random anywhere)', () => {
    expect(src).not.toContain('Math.random');
    expect(src).toContain('makeSeededRng(seed)');
    expect(src).toContain('seed, frame, scenario');
  });

  it('tags every emission site with a stable stream id', () => {
    expect(src).toContain('streamSeq++');
    expect(src).toContain('scenarioStream');
    // No proximity-derived tagging helper remains.
    expect(src).not.toContain('tagNew');
  });

  it('offers replay, pause/step, speed, orbit, background, obstacle, source and density', () => {
    for (const needle of [
      "'Replay'", "'Play'", "'Pause'", "'Step'", 'speedInput', 'attachOrbit',
      'bgNeutral', 'obstacle', 'densityInput', 'setDensityScale', 'sourceSelect',
    ]) {
      expect(src, `${needle} must be present`).toContain(needle);
    }
  });

  it('reports source, density and output separately and exposes a capture API', () => {
    expect(src).toContain('gooLayer.densityDiagnostics');
    expect(src).toContain('source: { width: sourceW, height: sourceH }');
    expect(src).toContain('output: { width: renderer.domElement.width, height: renderer.domElement.height }');
    expect(src).toContain('captureInstructions');
    expect(src).toContain('__bloodCompare');
  });

  it('never claims visual success in source (deferred acceptance)', () => {
    expect(src).toContain('Visual acceptance is PENDING');
    expect(src).toContain('NOT verified');
  });
});
