import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HANJA, OLD_NAMES } from './forbiddenPatterns';

// The city is 한강 (future Seoul): the dropped city and river names and hanja must not come back
// in code or UI text. Docs are not scanned: they record the v2 → v3 history on purpose.
const ROOT = join(import.meta.dirname, '..');
const SCAN = ['src', 'scripts', 'tests', '.github', 'index.html'];
// These two files spell out the patterns themselves.
const SKIP = new Set([relative(ROOT, import.meta.filename), 'tests/forbiddenPatterns.ts']);

function files(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

function offenders(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of SCAN.flatMap((p) => files(join(ROOT, p)))) {
    const rel = relative(ROOT, file);
    if (SKIP.has(rel)) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${rel}:${i + 1}`);
      });
  }
  return hits;
}

describe('forbidden names', () => {
  it('has no dropped city or river names', () => {
    expect(offenders(OLD_NAMES)).toEqual([]);
  });

  it('has no hanja', () => {
    expect(offenders(HANJA)).toEqual([]);
  });
});
