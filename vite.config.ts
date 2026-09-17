import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createDummyBackendPlugin } from './src/backend/vite-middleware';

export default defineConfig({
  plugins: [react(), createDummyBackendPlugin({ failureRate: process.env.PLAYWRIGHT_TEST === '1' ? 0 : undefined })],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
