import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The browser bundle contains only the PixiJS scene. It never reads env vars,
// so credentials cannot leak into it (envPrefix is set to something unused).
export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  base: './',
  envPrefix: 'PUBLIC_SCENE_',
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  logLevel: 'warn',
});
