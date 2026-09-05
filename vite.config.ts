import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { resolve } from 'path';
import { saveFace, savePalette } from './src/lab/dev-save';

/** DEV-ONLY: the lab's save endpoints. Never part of a build. */
function labDevSave(): Plugin {
  return {
    name: 'blud-lab-dev-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
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
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
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
      },
    },
  },
});
