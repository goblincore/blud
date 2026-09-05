import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['seeded-rng.test.ts'],
  },
});
