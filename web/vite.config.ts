import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const sharedSrc = fileURLToPath(new URL('../shared/src', import.meta.url));

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      '@shared': sharedSrc,
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
