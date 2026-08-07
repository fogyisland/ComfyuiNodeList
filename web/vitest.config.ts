import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./tests/setup.ts'],
    setupFiles: ['./tests/jsdom-fix.ts'],
    environmentMatchGlobs: [
      ['tests/_components/**', 'jsdom'],
    ],
    testTimeout: 30000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});