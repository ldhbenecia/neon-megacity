import { defineConfig } from 'vite';

export default defineConfig({
  // Relative by default so dev, preview and e2e work from any path.
  // The Pages workflow sets BASE_PATH=/neon-megacity/ for the project site.
  base: process.env.BASE_PATH ?? './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
