import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// linbpq's file server sets a correct Content-Type only for .js, .css, .pdf and
// images, sends no Cache-Control, and runs ## substitution on htm paths. So:
// everything is JS/CSS under /ui/, with content hashes in the names, and
// small assets are inlined. scripts/finish-dist.mjs enforces the rest.
export default defineConfig({
  plugins: [preact()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'ui',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'ui/[name]-[hash].js',
        chunkFileNames: 'ui/[name]-[hash].js',
        assetFileNames: 'ui/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 8083,
    proxy: { '/api': 'http://127.0.0.1:8008', '/Node': 'http://127.0.0.1:8008' },
  },
});
