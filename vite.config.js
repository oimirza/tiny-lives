import { defineConfig } from 'vite';

// Relative asset paths so the built game works when hosted in a sub-folder (artifact link).
export default defineConfig({
  base: './',
  build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
});
