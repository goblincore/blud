/** Dev-only GPU parity and isolated-stage timing, dynamically loaded by the debug probe.
 * The dense stage uses the ORIGINAL generated shaders, with no culling branch.
 * Both stages read the exact same captured march texels; no simulation/render work
 * runs between them. Compilation, readbacks and setup are outside timing. Fences include JS submission. */
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createUpscaleStage } from './upscale-stage';
import { readFloatTarget, type SelfCheckDeps } from './upscale-selfcheck';

export async function runUpscaleCullingCheck(deps: SelfCheckDeps, opts: { frames?: number; repeats?: number; synthetic?: boolean } = {}) {
  const original = deps.layer.upscaleStage;
  if (!original || original.config.model !== 't16' || original.config.layout !== 'sp' || original.model.head) throw new Error('Requires default t16/sp without a head');
  const captured = await readFloatTarget(deps.renderer, deps.layer.marchTarget);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  const clock = Performance.prototype.now.bind(performance);
  const fixtures: { name: string; w: number; h: number; data: Float32Array }[] = [{ name: 'game', ...captured }];
  if (opts.synthetic) {
    // Odd/non-tile-aligned sizes plus an image smaller than the dependency radius.
    for (const [w, h] of [[35, 27], [3, 5], [400, 300]]) {
      for (const mode of ['empty', 'full', 'edges', 'isolated', 'holes']) {
        const data = new Float32Array(w! * h! * 4);
        for (let y = 0; y < h!; y++) for (let x = 0; x < w!; x++) {
          const k = (y * w! + x) * 4;
          const hit = mode === 'full' || (mode === 'edges' && (x === 0 || y === 0 || x === w! - 1 || y === h! - 1))
            || (mode === 'isolated' && x % 17 === 8 && y % 19 === 7)
            || (mode === 'holes' && !((x % 21) < 15 && (y % 23) < 17));
          data[k] = ((x * 17 + y * 23) % 41) / 13;
          data[k + 1] = ((x * 13 + y * 11) % 53) / 17;
          data[k + 2] = ((x * 7 + y * 29) % 61) / 19;
          data[k + 3] = hit ? 0.2 + ((x + y) % 13) / 20 : 1;
        }
        fixtures.push({ name: `${mode}-${w}x${h}`, w: w!, h: h!, data });
      }
    }
  }
  const results = [];
  for (const fixture of fixtures) {
    const input = new THREE.DataTexture(fixture.data, fixture.w, fixture.h, THREE.RGBAFormat, THREE.FloatType);
    input.needsUpdate = true;
    const stages = [false, true].map(emptyTileCulling => createUpscaleStage(original.config, input, uniform(1), original.model,
      undefined, undefined, undefined, { emptyTileCulling }));
    try {
      for (const stage of stages) {
        stage.setSize(fixture.w, fixture.h, fixture.w * 2, fixture.h * 2);
        stage.setSharpen(original.sharpen);
        stage.setSharpenMode(original.sharpenMode);
        await stage.precompile(deps.renderer, camera);
      }
      const images = [];
      for (const stage of stages) {
        stage.render(deps.renderer, camera, deps.camera);
        await deps.resolveGpu();
        images.push(await readFloatTarget(deps.renderer, stage.output));
      }
      const a = images[0]!.data, b = images[1]!.data;
      const ab = new Uint32Array(a.buffer), bb = new Uint32Array(b.buffer);
      let different = 0, coverageMismatch = 0, depthMismatch = 0, nonfinite = 0, maxAbs = 0, covered = 0;
      for (let k = 0; k < a.length; k++) {
        if (ab[k] !== bb[k]) different++;
        if (!Number.isFinite(a[k]) || !Number.isFinite(b[k])) nonfinite++;
        maxAbs = Math.max(maxAbs, Math.abs(a[k]! - b[k]!));
        if (k % 4 === 3) {
          if (a[k]! < 1) covered++;
          if ((a[k]! < 1) !== (b[k]! < 1)) coverageMismatch++;
          if (ab[k] !== bb[k]) depthMismatch++;
        }
      }
      const mask = stages[1]!.targetFor('activeTiles');
      const raw = await deps.renderer.readRenderTargetPixelsAsync(mask, 0, 0, mask.width, mask.height);
      const stride = Math.ceil(mask.width * 4 / 256) * 256;
      let active = 0;
      for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (raw[y * stride + x * 4]! > 0) active++;
      const rows: { rep: number; mode: string; times: number[] }[] = [];
      // Warm both paths before alternating balanced pairs. Full-frame measurements
      // are separate; these fences measure only the upscaler submission and GPU work.
      if (['game', 'empty-400x300', 'full-400x300'].includes(fixture.name) && (opts.frames ?? 32) > 0) {
        for (const stage of stages) for (let i = 0; i < 60; i++) { stage.render(deps.renderer, camera, deps.camera); await deps.resolveGpu(); }
        for (let rep = 0; rep < (opts.repeats ?? 4); rep++) {
          for (const j of rep % 2 ? [1, 0] : [0, 1]) {
            const stage = stages[j]!;
            const times = [];
            for (let i = 0; i < (opts.frames ?? 32); i++) {
              const t = clock(); stage.render(deps.renderer, camera, deps.camera); await deps.resolveGpu(); times.push(clock() - t);
            }
            rows.push({ rep, mode: j ? 'culled' : 'dense', times });
          }
        }
      }
      // Reuse the same textures after all coverage disappears: stale feature
      // texels must never survive a newly empty mask (no target clears run).
      const empty = new Float32Array(fixture.data.length);
      for (let k = 3; k < empty.length; k += 4) empty[k] = 1;
      input.image.data = empty;
      input.needsUpdate = true;
      const sparse = stages[1]!;
      sparse.render(deps.renderer, camera, deps.camera);
      await deps.resolveGpu();
      const cleared = await readFloatTarget(deps.renderer, sparse.output);
      let staleBackgroundMismatch = 0;
      for (let k = 0; k < cleared.data.length; k++) if (cleared.data[k] !== (k % 4 === 3 ? 1 : 0)) staleBackgroundMismatch++;
      results.push({ fixture: fixture.name, size: [fixture.w, fixture.h], different, coverageMismatch, depthMismatch, nonfinite, maxAbs, covered, staleBackgroundMismatch,
        activeTiles: active, totalTiles: mask.width * mask.height, rows });
    } finally {
      stages.forEach(stage => stage.dispose());
      input.dispose();
    }
  }
  return { weightHash: original.model.weightHash, sharpen: original.sharpen, results };
}
