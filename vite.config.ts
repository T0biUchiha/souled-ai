import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createDummyBackendPlugin } from './src/backend/vite-middleware';

export default defineConfig({
  plugins: [react(), createDummyBackendPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
