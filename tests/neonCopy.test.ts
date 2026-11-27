import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../src/city/layout';
import { buildCatalog, glyphCenterV, glyphSlotY } from '../src/neon/catalog';
import { hasHangul, hasHanja } from '../src/neon/content';
import { HANJA, OLD_NAMES } from './forbiddenPatterns';

const cat = buildCatalog(LAYOUT);
const HIGH = new Set(['crown', 'ring', 'line', 'logo', 'koi']);
const COMPLEX = /\d+단지$/;
const LOW = new Set(['band', 'blade', 'vtext', 'panel', 'ad', 'tent', 'paint']);

describe('neon copy rules', () => {
  it('uses no hanja anywhere', () => {
    for (const c of cat.cells) {
      expect(hasHanja(c.text)).toBe(false);
      expect(hasHanja(c.sub)).toBe(false);
      expect(`${c.text} ${c.sub}`).not.toMatch(HANJA);
    }
  });

  it('high-rise copy is English, street-level copy is at least 85% Korean', () => {
    const high = cat.cells.filter((c) => HIGH.has(c.kind) && !COMPLEX.test(c.key));
    expect(high.length).toBeGreaterThan(10);
    for (const c of high) expect(hasHangul(c.text + c.sub)).toBe(false);
    const complexes = cat.cells.filter((c) => c.kind === 'crown' && COMPLEX.test(c.key));
    expect(complexes.length).toBeGreaterThan(0);
    for (const c of complexes) expect(c.text).toMatch(COMPLEX);
    const low = cat.cells.filter((c) => LOW.has(c.kind));
    const korean = low.filter((c) => hasHangul(c.text)).length;
    expect(korean / low.length).toBeGreaterThanOrEqual(0.85);
  });

  it('never uses the old city names', () => {
    for (const c of cat.cells) {
      expect(`${c.text} ${c.sub}`).not.toMatch(/가람|GARAM/i);
      expect(`${c.text} ${c.sub}`).not.toMatch(OLD_NAMES);
    }
  });
});

describe('vertical sign glyph order', () => {
  it('glyph 0 sits at the top and v decreases monotonically down the sign', () => {
    const vertical = cat.cells.filter((c) => c.kind === 'vtext');
    expect(vertical.length).toBeGreaterThan(5);
    for (const c of vertical) {
      const glyphs = Array.from(c.text);
      expect(glyphs.length).toBe(c.chars);
      let prev = Infinity;
      for (let i = 0; i < glyphs.length; i++) {
        const v = glyphCenterV(c, i, cat.height);
        expect(v).toBeLessThan(prev);
        expect(v).toBeLessThanOrEqual(c.uv[1] + c.uv[3]);
        expect(v).toBeGreaterThanOrEqual(c.uv[1]);
        prev = v;
      }
      expect(glyphCenterV(c, 0, cat.height)).toBeGreaterThan(c.uv[1] + c.uv[3] / 2);
      expect(glyphSlotY(c.chars - 1, c.pw)).toBeLessThan(c.ph);
    }
  });
});
