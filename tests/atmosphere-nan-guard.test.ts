import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LuminosityHighPassShader } from 'three/examples/jsm/shaders/LuminosityHighPassShader.js';
import { describe, expect, it } from 'vitest';
import { guardHighPass } from '../src/atmosphere/hdrGuard';

const SRC = join(__dirname, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

/** First argument of each GLSL pow( call (Math.pow is skipped). */
function powBases(code: string): string[] {
  const out: string[] = [];
  const re = /(?<![\w.])pow\s*\(/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let depth = 0;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < code.length; i++) {
      const ch = code[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) break;
    }
    out.push(code.slice(start, i).replace(/\s+/g, ' ').trim());
  }
  return out;
}

const SAFE_CALL = /^(max|clamp|abs|horizonSide)\s*\(/;

/** A bare literal, or one guard call that spans the whole base (not `clamp(t, 0, 1) - 0.2`). */
function safeBase(base: string): boolean {
  if (/^\d+(\.\d*)?$/.test(base)) return true;
  const m = SAFE_CALL.exec(base);
  if (!m) return false;
  let depth = 0;
  for (let i = m[0].length - 1; i < base.length; i++) {
    if (base[i] === '(') depth++;
    else if (base[i] === ')' && --depth === 0) return i === base.length - 1;
  }
  return false;
}

// file → bases known to be >= 0, with the reason. Remove an entry once its owner guards it.
const ALLOWED: Record<string, Record<string, string>> = {
  'lighting/sky.ts': { cs: 'cs = max(dot(dir, uSunDir), 0.0)' },
  'infra/index.ts': {
    'fogDensity * ${EMISSIVE_FOG_DENSITY_SCALE.toFixed(4)} * vFogDepth':
      'density and depth are >= 0; hangang-infra to use x * x',
  },
};

describe('NaN guard (black block bug)', () => {
  it('reads bloom input through finiteHdr in three’s high-pass shader', () => {
    const fs = guardHighPass(LuminosityHighPassShader.fragmentShader);
    expect(fs).toContain('vec4 texel = vec4( finiteHdr( texture2D( tDiffuse, vUv ).rgb ), 1.0 );');
    expect(fs.indexOf('vec3 finiteHdr')).toBeLessThan(fs.indexOf('void main()'));
  });

  it('fails loudly when the high-pass shader changes', () => {
    expect(() => guardHighPass('void main() { gl_FragColor = vec4(1.0); }')).toThrow(/NaN guard/);
  });

  it('accepts only bases fully wrapped by a guard', () => {
    const bases = powBases(
      'pow(max(x, 0.0), 2.0) pow(clamp(t, 0.0, 1.0) - 0.2, 2.2) pow(2.0, e) pow(1.0 - y, 1.4)',
    );
    expect(bases.map(safeBase)).toEqual([true, false, true, false]);
  });

  it('every GLSL pow() base is guarded against negatives', () => {
    const bad: string[] = [];
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      const code = readFileSync(file, 'utf8').replace(/Math\.pow/g, 'Math_pow');
      for (const base of powBases(code)) {
        if (safeBase(base) || ALLOWED[rel]?.[base]) continue;
        bad.push(`${rel}: pow(${base}, …)`);
      }
    }
    expect(bad).toEqual([]);
  });
});
