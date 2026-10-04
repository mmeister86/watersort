import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
  plugins: [
    VitePWA({
      // Take updates in the background and register manually from main.ts so a
      // running level is never interrupted by a reload.
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: {
        name: 'Water Sort',
        short_name: 'Water Sort',
        description: 'Wasser-Sortier-Puzzle für die Familie.',
        lang: 'de',
        display: 'standalone',
        orientation: 'any',
        // Mirrors `--bg` in web/src/styles.css and the theme-color meta tag.
        theme_color: '#0b1120',
        background_color: '#0b1120',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell only. Levels are generated locally, so precaching the shell
        // is enough for full offline play. The generated manifest and the
        // manifest icons are added by the plugin itself (includeManifestIcons),
        // so they are intentionally not matched here to avoid duplicate entries.
        globPatterns: ['**/*.{js,css,html}'],
        navigateFallback: 'index.html',
        // The API is never cached, neither by the precache nor at runtime.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: 'NetworkOnly',
          },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
