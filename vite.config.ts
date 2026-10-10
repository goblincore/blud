import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { resolve } from 'path';
import { saveFace, savePalette } from './src/lab/dev-save';
import { saveGameplayCapture } from './scripts/lib/game-telemetry-save';
import { saveDemo } from './scripts/lib/game-demo-save';
import { listModels, modelStoreRoot, readModelText } from './scripts/lib/upscale-model-store';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';

function readTelemetryBuild(cwd = process.cwd()) {
  try {
    return {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim().length > 0,
    };
  } catch { return { commit: 'unknown', dirty: true }; }
}
const telemetryBuild = readTelemetryBuild();

/** DEV-ONLY: the lab's save endpoints. Never part of a build. */
function labDevSave(): Plugin {
  return {
    name: 'blud-lab-dev-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/__lab/telemetry-build') {
          if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
          res.setHeader('content-type', 'application/json');
          res.setHeader('cache-control', 'no-store');
          res.end(JSON.stringify({ ...readTelemetryBuild(server.config.root), capturedAt: new Date().toISOString(), scope: 'working-tree-at-recording-start' }));
          return;
        }
        if (url.pathname === '/__lab/save-telemetry') {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`
            && req.headers.origin !== `https://${req.headers.host}`) { res.statusCode = 403; res.end(); return; }
          const chunks: Buffer[] = [];
          let bytes = 0, rejected = false;
          req.on('data', (chunk: Buffer) => {
            if (rejected) return;
            bytes += chunk.length;
            if (bytes > 16 * 1024 * 1024) {
              rejected = true; chunks.length = 0; res.statusCode = 413; res.end('Capture too large');
            } else chunks.push(chunk);
          });
          req.on('end', () => {
            if (rejected) return;
            res.setHeader('content-type', 'application/json');
            try { res.end(JSON.stringify(saveGameplayCapture(server.config.root, JSON.parse(Buffer.concat(chunks).toString('utf8'))))); }
            catch (error) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: String(error) })); }
          });
          return;
        }
        // Deterministic demo recordings (stage 3, 2026-09-14). A `.dem` is an
        // input log, saved like telemetry — the page posts the DemoFile and the
        // server owns the filename. Get one back for a replay at
        // /docs/dev-notes/demos/<name>.dem.json (Vite serves the project root).
        if (url.pathname === '/__lab/list-demos') {
          const dir = resolve(__dirname, 'docs/dev-notes/demos');
          const names = existsSync(dir)
            ? readdirSync(dir).filter(n => n.endsWith('.dem.json'))
              .map(n => ({ n, t: statSync(resolve(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t).map(x => x.n)
            : [];
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(names));
          return;
        }
        if (url.pathname === '/__lab/save-demo') {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`
            && req.headers.origin !== `https://${req.headers.host}`) { res.statusCode = 403; res.end(); return; }
          const chunks: Buffer[] = [];
          let bytes = 0, rejected = false;
          req.on('data', (chunk: Buffer) => {
            if (rejected) return;
            bytes += chunk.length;
            if (bytes > 16 * 1024 * 1024) {
              rejected = true; chunks.length = 0; res.statusCode = 413; res.end('Demo too large');
            } else chunks.push(chunk);
          });
          req.on('end', () => {
            if (rejected) return;
            res.setHeader('content-type', 'application/json');
            try { res.end(JSON.stringify(saveDemo(server.config.root, JSON.parse(Buffer.concat(chunks).toString('utf8'))))); }
            catch (error) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: String(error) })); }
          });
          return;
        }
        // Trained neural upscale models (docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §4).
        if (url.pathname === '/__lab/upscale-models' || url.pathname.startsWith('/__lab/upscale-model/')) {
          if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
          const store = modelStoreRoot(server.config.root);
          res.setHeader('content-type', 'application/json');
          res.setHeader('cache-control', 'no-store');
          if (url.pathname === '/__lab/upscale-models') { res.end(JSON.stringify(listModels(store))); return; }
          const text = readModelText(store, url.pathname.slice('/__lab/upscale-model/'.length));
          if (text === null) { res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: 'no such model' })); return; }
          res.end(text);
          return;
        }
        if (!url.pathname.startsWith('/__lab/save-')) return next();
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const name = url.searchParams.get('character') ?? '';
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          let result;
          if (url.pathname === '/__lab/save-face') result = saveFace(server.config.root, name, new Uint8Array(body));
          else if (url.pathname === '/__lab/save-palette') {
            try { result = savePalette(server.config.root, name, JSON.parse(body.toString('utf8'))); }
            catch (e) { result = { ok: false, error: `bad JSON: ${String(e)}` }; }
          } else { res.statusCode = 404; res.end(); return; }
          res.setHeader('content-type', 'application/json');
          res.statusCode = result.ok ? 200 : 400;
          res.end(JSON.stringify(result));
        });
      });
    },
  };
}

/**
 * THE SLOW GROUP. These 25 files were 83% of the suite's test time on the first CI run
 * (2026-10-07: 1142 s of 1371 s summed, seconds beside each): numerical sweeps and tests that shell
 * out to a CLI. A bare `npm test` leaves them out so a local run stays quick.
 *
 * They still run:
 *   - in CI, always (`VITEST_ALL=1`, .github/workflows/ci.yml);
 *   - whenever you NAME a test file or filter: `npx vitest run src/lab/sdf-zombie/cut-wound.test.ts`;
 *   - from `npm run test:changed` when their module changed (it names files);
 *   - `npm run test:slow` (only these) and `npm run test:all` (everything).
 *
 * pack-golden.test.ts (10 s) is deliberately NOT here: CI skips it (its pin is per-platform), so the
 * default local run is the only place it runs unprompted. Add a file when it passes ~10 s in CI.
 */
const SLOW_TESTS = [
  'src/lab/sdf-zombie/cut-wound.test.ts',                                      // 331 s
  'src/lab/sdf-zombie/webgpu/gib-carve.test.ts',                               // 125 s
  'src/lab/sdf-zombie/webgpu/skeleton-spike/volume.test.ts',                   // 123 s
  'src/lab/sdf-zombie/webgpu/wound-threat.test.ts',                            // 95 s
  'scripts/blob-measure.test.ts',                                              // 90 s
  'scripts/blob-depth.test.ts',                                                // 82 s
  'src/lab/sdf-zombie/webgpu/surface-nets-cpu.test.ts',                        // 27 s
  'src/lab/sdf-zombie/pack.test.ts',                                           // 27 s
  'src/lab/sdf-zombie/silhouette.test.ts',                                     // 22 s
  'src/lab/sdf-zombie/webgpu/gib-library.test.ts',                             // 21 s
  'src/lab/sdf-zombie/characters/bride-blob.test.ts',                          // 18 s
  'src/lab/sdf-zombie/characters/mouse-blob.test.ts',                          // 18 s
  'src/lab/sdf-zombie/motion.test.ts',                                         // 17 s
  'src/lab/sdf-zombie/webgpu/curl-volume-node.test.ts',                        // 15 s
  'src/lab/sdf-zombie/webgpu/gib-asset.test.ts',                               // 15 s
  'src/lab/sdf-zombie/webgpu/skeleton-spike/mesh.test.ts',                     // 14 s
  'src/lab/sdf-zombie/webgpu/game-actor.test.ts',                              // 13 s
  'src/lab/sdf-zombie/webgpu/impact-splash.test.ts',                           // 12 s
  'src/lab/sdf-zombie/webgpu/game-actor-soldier.test.ts',                      // 12 s
  'src/lab/sdf-zombie/half-blend-audit.test.ts',                               // 12 s
  'src/lab/sdf-zombie/head-split.test.ts',                                     // 11 s
  'src/lab/sdf-zombie/blob-checks.test.ts',                                    // 11 s
  'src/lab/sdf-zombie/characters/broodmother-blob.test.ts',                    // 10 s
  'src/lab/sdf-zombie/head-keepout.test.ts',                                   // 10 s
  'src/lab/sdf-zombie/webgpu/character-view.test.ts',                          // 10 s
];
for (const f of SLOW_TESTS) {
  if (!existsSync(resolve(__dirname, f))) throw new Error(`vite.config.ts SLOW_TESTS: no such file ${f}`);
}
/** A positional argument after the vitest command is a file filter: the caller asked for those files. */
const namesTestFiles = (() => {
  const args = process.argv.slice(2);
  const i = args.findIndex(a => a === 'run' || a === 'watch' || a === 'dev' || a === 'list' || a === 'related');
  return args.slice(i + 1).some(a => !a.startsWith('-'));
})();
const skipSlow = !process.env.VITEST_ALL && !namesTestFiles;

export default defineConfig({
  // Worktrees share node_modules, but must not overwrite another dev server's
  // optimized Three/TSL modules: mixed module copies collide on node IDs and
  // silently drop shader includes. Keep the optimizer cache in this checkout.
  cacheDir: resolve(__dirname, '.vite'),
  // Agent captures keep a headless Chrome profile (and scratch output) under
  // .lab-tmp/; watching it reloaded the owner's open game tab on every
  // profile write (2026-09-25 playtest).
  server: { watch: { ignored: ['**/.lab-tmp/**'] } },
  define: { 'import.meta.env.VITE_TELEMETRY_BUILD': JSON.stringify(telemetryBuild) },
  plugins: [labDevSave()],
  test: {
    // Plain Node by default: booting a DOM per file was the largest single cost of a run, and only 19
    // of 599 files touched one (2026-10-07). A test that needs `document`, `window`, `location` or
    // URL-relative fetches starts with the line `// @vitest-environment happy-dom`.
    environment: 'node',
    // Only collect the real app suite (co-located under src/). Without this,
    // vitest's default glob also scans committed model-benchmark scratch dirs
    // (docs/dev-notes/model-benchmarks/**) and sibling .claude worktrees, which
    // carry their own failing tests + nested node_modules.
    // scripts/ is in for the CLI tests that shell out to a tool (blob-measure);
    // they live beside their script because a test importing node builtins
    // cannot sit under src/ without breaking the app typecheck.
    //
    // The .mjs entries are LISTED rather than globbed, and that is deliberate:
    // scripts/**/*.test.mjs would also sweep in the `node:test` suites
    // (scripts/lib/normal-gradient-*.test.mjs, scripts/zombie-normal-gradient-check.test.mjs),
    // which are written for `node --test` and report "No test suite found" under
    // vitest. `npm test` has never covered them, and a config change must not
    // silently change what `npm test` means. Add a new .mjs vitest suite here.
    include: [
      'src/**/*.test.ts',
      'scripts/**/*.test.ts',
      'scripts/census-diff.test.mjs',
      'scripts/lib/demo-digest.test.mjs',
      'scripts/lib/layer-tolerance.test.mjs',
      'scripts/lib/demo-presented.test.mjs',
      'scripts/lib/png-write.test.mjs',
      'scripts/lib/hybrid-estimate.test.mjs',
      'scripts/lib/march-depth-guard.test.mjs',
      'scripts/sdf-melee-stage.test.mjs',
    ],
    exclude: ['**/node_modules/**', '**/.claude/**', 'docs/**', 'dist/**', ...(skipSlow ? SLOW_TESTS : [])],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        themePreview: resolve(__dirname, 'theme-preview.html'),
        sdfLab: resolve(__dirname, 'sdf-lab.html'),
        sdfLabWebgpu: resolve(__dirname, 'sdf-lab-webgpu.html'),
        sdfLabWebglBench: resolve(__dirname, 'sdf-lab-webgl-bench.html'),
        sdfLabWebgpuBench: resolve(__dirname, 'sdf-lab-webgpu-bench.html'),
        sdfBench: resolve(__dirname, 'sdf-bench.html'),
        humanoidSdfSpike: resolve(__dirname, 'humanoid-sdf-spike.html'),
        sdfHullSpike: resolve(__dirname, 'sdf-hull-spike.html'),
        sdfGame: resolve(__dirname, 'sdf-game.html'),
        sdfBloodCompare: resolve(__dirname, 'sdf-blood-compare.html'),
        sdfFlameLab: resolve(__dirname, 'sdf-flame-lab.html'),
        sdfDeferred: resolve(__dirname, 'sdf-deferred.html'),
      },
    },
  },
});
