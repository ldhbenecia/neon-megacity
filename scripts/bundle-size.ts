// Usage: npm run size (after npm run build). ART_DIRECTION 11 JS budget, counted on the initial
// load (scripts index.html references; lazy chunks such as a ?debug-only panel are reported but
// not counted): target 260 KB gzip (warning), ceiling 400 KB gzip (fails).
import { bundleGzip } from './bundle';

const TARGET_KB = 260;
const LIMIT_KB = 400;

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
if (initial > TARGET_KB) {
  console.warn(
    `::warning::initial JS ${initial.toFixed(1)} KB gzip is over the ${TARGET_KB} KB target`,
  );
}
