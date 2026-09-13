// src/lab/sdf-zombie/webgpu/blood-compare-main.test.ts
//
// Source tripwires + an import smoke test for the comparison page. Nothing
// here starts a GPU: importing the module runs bootstrap(), which bails out
// before createLabRenderer because the test DOM has no #app, and the
// module-level catch swallows that. What the import DOES prove is that the
// page's imports resolve and its top-level syntax is valid.

import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';

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

describe('blood comparison page — production reuse and candidates', () => {
  it('uses the shared production blood + goo functions, not a substitute sim', () => {
    for (const fn of [
      'createGooLayer', 'createBloodSim', 'burst', 'spawnWoundDroplets',
      'spawnImpactGout', 'stepBlood', 'connectionBlobsForSim', 'applyGameGooDefaults',
    ]) {
      expect(src, `${fn} must be used`).toContain(fn);
    }
  });

  it('exposes the four variants including the baseline original', () => {
    expect(src).toContain("id: 'original'");
    expect(src).toContain("id: 'smooth'");
    expect(src).toContain("id: 'original-connections'");
    expect(src).toContain("id: 'smooth-connections'");
  });

  it('re-renders ONE simulation under both split variants (no second sim)', () => {
    expect(src).toContain('renderVariant(variantById(splitA), rtA);');
    expect(src).toContain('renderVariant(variantById(splitB), rtB);');
    // Exactly one createBloodSim call.
    expect((src.match(/createBloodSim\(/g) ?? []).length).toBe(1);
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

  it('offers replay, pause/step, speed, orbit, background, obstacle, density scale', () => {
    for (const needle of [
      "'Replay'", "'Play'", "'Pause'", "'Step'", 'speedInput', 'attachOrbit',
      'bgNeutral', 'obstacle', 'densityInput', 'setDensityScale',
    ]) {
      expect(src, `${needle} must be present`).toContain(needle);
    }
  });

  it('reports resolution and density separately and exposes a capture API', () => {
    expect(src).toContain('gooLayer.densityDiagnostics');
    expect(src).toContain('output: { width: renderer.domElement.width, height: renderer.domElement.height }');
    expect(src).toContain('captureInstructions');
    expect(src).toContain('__bloodCompare');
  });

  it('never claims visual success in source (deferred acceptance)', () => {
    expect(src).toContain('Visual acceptance is PENDING');
    expect(src).toContain('NOT verified');
  });
});
