import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths: the game is served from its own origin on Onceworlds.
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    assetsInlineLimit: 0,
  },
});
