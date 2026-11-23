// Usage: npm run size (after npm run build). JS bundle budget from ART_DIRECTION 11: gzip total of
// dist/assets/*.js, target 260 KB (warning), ceiling 400 KB (fails).
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const TARGET_KB = 260;
const LIMIT_KB = 400;

const dir = resolve('dist/assets');
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
if (files.length === 0) {
  console.error('no dist/assets/*.js: run npm run build first');
  process.exit(1);
}
let total = 0;
for (const f of files) {
  const kb = gzipSync(readFileSync(resolve(dir, f)), { level: 9 }).length / 1024;
  total += kb;
  console.log(`${f}  ${kb.toFixed(1)} KB gzip`);
}
console.log(`total ${total.toFixed(1)} KB gzip (target ${TARGET_KB}, ceiling ${LIMIT_KB})`);
if (total > LIMIT_KB) {
  console.error(`JS bundle over the ${LIMIT_KB} KB gzip ceiling`);
  process.exit(1);
}
if (total > TARGET_KB)
  console.warn(
    `::warning::JS bundle ${total.toFixed(1)} KB gzip is over the ${TARGET_KB} KB target`,
  );
