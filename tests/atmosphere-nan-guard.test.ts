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

const SAFE_BASE = /^(max|clamp|abs|horizonSide)\s*\(|^\d+(\.\d*)?$/;

// file → bases known to be >= 0, with the reason. Remove an entry once its owner guards it.
const ALLOWED: Record<string, Record<string, string>> = {
  'lighting/sky.ts': { cs: 'cs = max(dot(dir, uSunDir), 0.0)' },
  'neon/glow.ts': {
    'fogDensity * 0.55 * dist': 'density and distance are >= 0; replaced by x * x in #63',
    '1.0 - vUv.y': 'NaN when vUv.y > 1; guarded in #63, remove this entry then',
  },
  'neon/glsl.ts': {
    'fogDensity * 0.55 * vFogDepth': 'density and depth are >= 0; hangang-neon to use x * x',
  },
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

  it('every GLSL pow() base is guarded against negatives', () => {
    const bad: string[] = [];
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      const code = readFileSync(file, 'utf8').replace(/Math\.pow/g, 'Math_pow');
      for (const base of powBases(code)) {
        if (SAFE_BASE.test(base) || ALLOWED[rel]?.[base]) continue;
        bad.push(`${rel}: pow(${base}, …)`);
      }
    }
    expect(bad).toEqual([]);
  });
});
