import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    // Only collect the real app suite (co-located under src/). Without this,
    // vitest's default glob also scans committed model-benchmark scratch dirs
    // (docs/dev-notes/model-benchmarks/**) and sibling .claude worktrees, which
    // carry their own failing tests + nested node_modules.
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.claude/**', 'docs/**', 'dist/**'],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        themePreview: resolve(__dirname, 'theme-preview.html'),
        sdfLab: resolve(__dirname, 'sdf-lab.html'),
        sdfLabWebgpu: resolve(__dirname, 'sdf-lab-webgpu.html'),
      },
    },
  },
});
