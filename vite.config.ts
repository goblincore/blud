import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { resolve } from 'path';
import { saveFace, savePalette } from './src/lab/dev-save';
import { saveGameplayCapture } from './scripts/lib/game-telemetry-save';
import { execFileSync } from 'node:child_process';

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

export default defineConfig({
  // Worktrees share node_modules, but must not overwrite another dev server's
  // optimized Three/TSL modules: mixed module copies collide on node IDs and
  // silently drop shader includes. Keep the optimizer cache in this checkout.
  cacheDir: resolve(__dirname, '.vite'),
  define: { 'import.meta.env.VITE_TELEMETRY_BUILD': JSON.stringify(telemetryBuild) },
  plugins: [labDevSave()],
  test: {
    environment: 'happy-dom',
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
      'scripts/lib/demo-presented.test.mjs',
    ],
    exclude: ['**/node_modules/**', '**/.claude/**', 'docs/**', 'dist/**'],
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
        sdfDeferred: resolve(__dirname, 'sdf-deferred.html'),
      },
    },
  },
});
