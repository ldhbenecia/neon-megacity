// The layout generator runs in the city worker (and, as a fallback, behind a dynamic import), so
// it must stay out of the first-load bundle: no static import path from the page entry may reach it.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
// boot.ts loads the app (main.ts, city/layout.ts) right away with dynamic imports; those chunks
// are first load too, so the walk starts from all three.
const ENTRIES = ['src/boot.ts', 'src/main.ts', 'src/city/layout.ts'].map((f) => join(ROOT, f));
const FORBIDDEN = join(ROOT, 'src/city/generate.ts');

/** Static `import … from` / `export … from` specifiers (dynamic `import()` is not matched). */
function staticImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+'([^']+)'/gms)) {
    const line = m[0];
    if (/^\s*import\s+type\s/u.test(line) || /^\s*export\s+type\s/u.test(line)) continue;
    out.push(m[1] as string);
  }
  for (const m of src.matchAll(/^\s*import\s+'([^']+)'/gm)) out.push(m[1] as string);
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (c.endsWith('.ts') && existsSync(c)) return c;
  }
  return null;
}

it('keeps the layout generator out of the first-load import graph', () => {
  const seen = new Set<string>(ENTRIES);
  const parent = new Map<string, string>();
  const queue = [...ENTRIES];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const spec of staticImports(file)) {
      const dep = resolveLocal(file, spec);
      if (!dep || seen.has(dep)) continue;
      seen.add(dep);
      parent.set(dep, file);
      queue.push(dep);
    }
  }
  const chain: string[] = [];
  for (let f: string | undefined = FORBIDDEN; f && seen.has(f); f = parent.get(f)) {
    chain.unshift(relative(ROOT, f));
  }
  expect(chain, chain.join(' → ')).toEqual([]);
  // Sanity: the walk does reach the app and the layout queries.
  expect(seen.has(join(ROOT, 'src/city/queries.ts'))).toBe(true);
  expect(seen.has(join(ROOT, 'src/buildings/roads.ts'))).toBe(true);
});
