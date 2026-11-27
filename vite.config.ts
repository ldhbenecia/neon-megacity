import { defineConfig, type Plugin } from 'vite';

/**
 * src/boot.ts imports the app (src/main.ts) only after the city worker returned the layout. These
 * modulepreload links let the browser download the app chunks in parallel with that work.
 */
function preloadApp(): Plugin {
  let base = './';
  return {
    name: 'hangang-preload-app',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return [];
        const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
        const app = chunks.find((c) => c.facadeModuleId?.endsWith('/src/main.ts'));
        if (!app) return [];
        const files = new Set<string>();
        const visit = (file: string): void => {
          if (files.has(file)) return;
          files.add(file);
          const chunk = chunks.find((c) => c.fileName === file);
          for (const dep of chunk?.imports ?? []) visit(dep);
        };
        visit(app.fileName);
        return [...files].map((file) => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: true, href: base + file },
          injectTo: 'head' as const,
        }));
      },
    },
  };
}

export default defineConfig({
  // Relative by default so dev, preview and e2e work from any path.
  // The Pages workflow sets BASE_PATH=/neon-megacity/ for the project site.
  base: process.env.BASE_PATH ?? './',
  plugins: [preloadApp()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  // The city worker is an ES module worker (it shares the layout generator chunk).
  worker: { format: 'es' },
});
