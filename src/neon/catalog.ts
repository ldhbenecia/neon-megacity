import { CORPS, type Layout } from '../city/layout';
import type { NeonName } from '../core/palette';
import {
  AD_COPY,
  CARGO_CROWN,
  CORP_EN,
  SCREEN_LINES,
  GENERIC_BANDS,
  GENERIC_BLADES,
  GENERIC_COLORS,
  GENERIC_VTEXT,
  PANEL_WORDS,
  RING_COPY,
  SHOPS,
  TENT_COPY,
  type CellKind,
} from './content';

export interface CellSpec {
  kind: CellKind;
  text: string;
  sub: string;
  color: NeonName;
  pw: number;
  ph: number;
  chars: number;
  key: string;
}

export interface Cell extends CellSpec {
  index: number;
  px: number;
  py: number;
  uv: readonly [number, number, number, number];
  aspect: number;
}

export interface Catalog {
  width: number;
  height: number;
  cells: readonly Cell[];
  byKind: Readonly<Record<CellKind, readonly number[]>>;
}

export const ATLAS_WIDTH = 2048;
export const VCHAR_PX = 96;
const PAD = 2;

// Glyph 0 is drawn at the cell top; with CanvasTexture flipY its v is the largest, so vertical
// text reads top to bottom. Atlas drawing and tests must both go through this function.
export function glyphSlotY(i: number, cellPx: number): number {
  return cellPx * (i + 0.5);
}

export function glyphCenterV(cell: Cell, i: number, atlasHeight: number): number {
  return 1 - (cell.py + glyphSlotY(i, cell.pw)) / atlasHeight;
}

export function verticalGlyphs(text: string): string[] {
  return Array.from(text.replace(/\s+/g, '')).slice(0, 6);
}

function color(i: number): NeonName {
  return GENERIC_COLORS[i % GENERIC_COLORS.length] as NeonName;
}

function specs(complexes: readonly string[]): CellSpec[] {
  const out: CellSpec[] = [];
  const add = (kind: CellKind, text: string, sub: string, c: NeonName, pw: number, ph: number) =>
    out.push({ kind, text, sub, color: c, pw, ph, chars: 0, key: text });
  const crown = (key: string, text: string, sub: string) =>
    out.push({ kind: 'crown', text, sub, color: 'neonWhite', pw: 512, ph: 80, chars: 0, key });
  SHOPS.forEach((s) => {
    if (s.kind === 'band') add('band', s.name, s.sub, s.color, 512, 64);
    if (s.kind === 'blade') add('blade', s.name, s.sub, s.color, 64, 320);
    if (s.kind === 'vtext') {
      const g = verticalGlyphs(s.name.split(' ')[0] ?? s.name);
      out.push({
        kind: 'vtext',
        text: g.join(''),
        sub: s.sub,
        color: s.color,
        pw: VCHAR_PX,
        ph: VCHAR_PX * g.length,
        chars: g.length,
        key: s.name,
      });
    }
  });
  GENERIC_BANDS.forEach((b, i) => add('band', b.name, b.sub, color(i), 512, 64));
  GENERIC_BLADES.forEach((t, i) => add('blade', t, '', color(i + 3), 64, 320));
  GENERIC_VTEXT.forEach((t, i) => {
    const g = verticalGlyphs(t);
    out.push({
      kind: 'vtext',
      text: g.join(''),
      sub: '',
      color: color(i + 5),
      pw: VCHAR_PX,
      ph: VCHAR_PX * g.length,
      chars: g.length,
      key: t,
    });
  });
  CORPS.forEach((c) => crown(c, CORP_EN[c].name, CORP_EN[c].tag));
  complexes.forEach((c) => crown(c, c, ''));
  crown(CARGO_CROWN.name, CARGO_CROWN.name, CARGO_CROWN.tag);
  PANEL_WORDS.forEach((t, i) => add('panel', t, '', color(i + 1), 128, 80));
  RING_COPY.forEach((t, i) => add('ring', t, '', i % 2 ? 'neonCyan' : 'neonOrange', 1024, 64));
  AD_COPY.forEach((a, i) => add('ad', a.name, a.sub, color(i + 2), 128, 192));
  TENT_COPY.forEach((t) => add('tent', t, '', 'neonOrange', 256, 64));
  SCREEN_LINES.forEach((t, i) => add('line', t, '', i % 2 ? 'neonCyan' : 'neonOrange', 512, 64));
  CORPS.forEach((c, i) =>
    add('logo', CORP_EN[c].name, CORP_EN[c].tag, i % 2 ? 'neonCyan' : 'neonOrange', 256, 256),
  );
  add('koi', 'HANGANG KOI', '', 'neonCyan', 256, 256);
  return out;
}

export function buildCatalog(L: Pick<Layout, 'buildings'>): Catalog {
  const complexes = [
    ...new Set(L.buildings.map((b) => b.tags.complex).filter((c): c is string => !!c)),
  ];
  const list = specs(complexes);
  const order = list.map((_, i) => i).sort((a, b) => (list[b]?.ph ?? 0) - (list[a]?.ph ?? 0));
  const pos: { x: number; y: number }[] = list.map(() => ({ x: 0, y: 0 }));
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const i of order) {
    const s = list[i] as CellSpec;
    const w = s.pw + PAD * 2;
    if (x + w > ATLAS_WIDTH) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    pos[i] = { x: x + PAD, y: y + PAD };
    x += w;
    rowH = Math.max(rowH, s.ph + PAD * 2);
  }
  const height = Math.ceil((y + rowH) / 64) * 64;
  const W = ATLAS_WIDTH;
  const byKind: Record<CellKind, number[]> = {
    band: [],
    blade: [],
    vtext: [],
    crown: [],
    panel: [],
    ring: [],
    line: [],
    ad: [],
    tent: [],
    logo: [],
    koi: [],
  };
  const cells: Cell[] = list.map((s, index) => {
    const p = pos[index] as { x: number; y: number };
    byKind[s.kind].push(index);
    // Half-texel inset so bilinear / mip sampling never bleeds into the neighbouring cell.
    const u0 = (p.x + 0.5) / W;
    const u1 = (p.x + s.pw - 0.5) / W;
    const vTop = 1 - (p.y + 0.5) / height;
    const vBot = 1 - (p.y + s.ph - 0.5) / height;
    return {
      ...s,
      index,
      px: p.x,
      py: p.y,
      uv: [u0, vBot, u1 - u0, vTop - vBot],
      aspect: s.pw / s.ph,
    };
  });
  return { width: W, height, cells, byKind };
}
