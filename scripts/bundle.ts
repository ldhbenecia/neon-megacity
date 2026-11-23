// Shared by scripts/bundle-size.ts (CI budget) and scripts/perf.ts (report).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

export interface BundleFile {
  file: string;
  raw: number;
  gzip: number;
  /** Referenced from dist/index.html (`<script src>` or `<link rel="modulepreload">`). */
  initial: boolean;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Every .js / .mjs under dist/, gzip level 9. Throws if dist/ has not been built. */
export function bundleGzip(distDir = 'dist'): BundleFile[] {
  const dist = resolve(distDir);
  const indexHtml = join(dist, 'index.html');
  if (!existsSync(indexHtml)) throw new Error(`${indexHtml} missing: run npm run build first`);
  const html = readFileSync(indexHtml, 'utf8');
  const referenced = new Set(
    [...html.matchAll(/(?:src|href)="\.?\/?([^"]+\.m?js)"/g)].map((m) => m[1] ?? ''),
  );
  return walk(dist)
    .filter((f) => /\.m?js$/.test(f))
    .map((f) => {
      const buf = readFileSync(f);
      const file = relative(dist, f);
      return {
        file,
        raw: buf.length,
        gzip: gzipSync(buf, { level: 9 }).length,
        initial: referenced.has(file),
      };
    });
}
