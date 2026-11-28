// Usage: npm run size (after npm run build). ART_DIRECTION 11 JS budget, counted on the initial
// load (scripts index.html references; lazy chunks such as a ?debug-only panel are reported but
// not counted): target 330 KB gzip (warning; docs/PERF.md "JS bundle", update), ceiling 400 KB
// gzip (fails).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleGzip } from './bundle';

const TARGET_KB = 330;
const LIMIT_KB = 400;
/**
 * The city worker (layout generator, terrain and road geometry, three-lite) is ~54 KB; with a
 * broken three-lite alias it grows by ~8 KB, too little for a size limit to tell apart. The reliable sign is three's entry
 * module (Three.Core.js), whose import-time `__THREE__` registration survives tree-shaking; the
 * class modules three-lite uses do not contain it. Checked by building without the alias. The
 * size limit only catches large growth (e.g. a whole new module pulled into the worker).
 */
const WORKER_LIMIT_KB = 60;
const THREE_CORE_MARKER = '__THREE__';

let files;
try {
  files = bundleGzip();
} catch (err) {
  console.error(String(err));
  process.exit(1);
}
const kb = (b: number): string => (b / 1024).toFixed(1);
for (const f of files)
  console.log(`${f.initial ? 'initial' : 'lazy   '}  ${f.file}  ${kb(f.gzip)} KB gzip`);
const initial = files.filter((f) => f.initial).reduce((a, f) => a + f.gzip, 0) / 1024;
const all = files.reduce((a, f) => a + f.gzip, 0) / 1024;
console.log(
  `initial ${initial.toFixed(1)} KB gzip, all ${all.toFixed(1)} KB (target ${TARGET_KB}, ceiling ${LIMIT_KB})`,
);
if (initial === 0) {
  console.error('no script referenced from dist/index.html');
  process.exit(1);
}
if (initial > LIMIT_KB) {
  console.error(`initial JS over the ${LIMIT_KB} KB gzip ceiling`);
  process.exit(1);
}
const worker = files.find((f) => f.file.includes('layout.worker'));
if (!worker) {
  console.error('no city worker chunk (layout.worker) in dist/assets');
  process.exit(1);
}
if (readFileSync(join('dist', worker.file), 'utf8').includes(THREE_CORE_MARKER)) {
  console.error(
    `city worker contains three's entry module (${THREE_CORE_MARKER}): the three-lite alias stopped working (vite.config.ts threeLite)`,
  );
  process.exit(1);
}
if (worker.gzip / 1024 > WORKER_LIMIT_KB) {
  console.error(`city worker ${kb(worker.gzip)} KB gzip is over ${WORKER_LIMIT_KB} KB`);
  process.exit(1);
}
if (initial > TARGET_KB) {
  console.warn(
    `::warning::initial JS ${initial.toFixed(1)} KB gzip is over the ${TARGET_KB} KB target`,
  );
}
