import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'happy-dom',
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        themePreview: resolve(__dirname, 'theme-preview.html'),
      },
    },
  },
});
