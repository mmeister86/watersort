import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const sharedSrc = fileURLToPath(new URL('../shared/src', import.meta.url));

// The server is bundled so that the `@shared/*` path alias is inlined and the
// output is a single runnable `dist/index.js` (tsc does not rewrite path
// aliases). Node built-ins and node_modules dependencies stay external.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': sharedSrc,
    },
  },
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        format: 'es',
      },
    },
  },
});
