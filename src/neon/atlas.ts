import * as THREE from 'three';
import { MATERIAL, NEON } from '../core/palette';
import { createRng, type Rng } from '../core/random';
import { glyphSlotY, verticalGlyphs, type Catalog, type Cell } from './catalog';

export const FONT = '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
function mixCss(hex: number, toward: number, t: number): string {
  const a = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const b = [(toward >> 16) & 255, (toward >> 8) & 255, toward & 255];
  const c = a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * t));
  return `rgb(${c[0] ?? 0},${c[1] ?? 0},${c[2] ?? 0})`;
}
const WHITE = 0xffffff;
const BOARD = MATERIAL.facadeDark;
const BLACK = 0x000000;

type G = CanvasRenderingContext2D;

function roundRect(g: G, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function tube(g: G, color: number, lw: number): void {
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.shadowColor = css(color);
  g.strokeStyle = css(color);
  g.lineWidth = lw;
  g.shadowBlur = lw * 4;
  g.stroke();
  g.shadowBlur = 0;
  g.lineWidth = lw * 0.45;
  g.strokeStyle = mixCss(color, WHITE, 0.7);
  g.stroke();
}

function glowText(
  g: G,
  text: string,
  x: number,
  y: number,
  size: number,
  color: number,
  maxW: number,
  mode: 'neon' | 'dark' | 'tube',
  weight = 800,
): void {
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  if (mode === 'dark') {
    g.shadowBlur = 0;
    g.fillStyle = css(BLACK);
    g.fillText(text, x, y, maxW);
    return;
  }
  g.shadowColor = css(color);
  if (mode === 'tube') {
    const lw = Math.max(2, size * 0.07);
    g.lineWidth = lw;
    g.strokeStyle = css(color);
    g.shadowBlur = size * 0.35;
    g.strokeText(text, x, y, maxW);
    g.shadowBlur = 0;
    g.lineWidth = lw * 0.4;
    g.strokeStyle = mixCss(color, WHITE, 0.75);
    g.strokeText(text, x, y, maxW);
    return;
  }
  g.fillStyle = css(color);
  g.shadowBlur = size * 0.35;
  g.fillText(text, x, y, maxW);
  g.shadowBlur = 0;
  g.fillStyle = mixCss(color, WHITE, 0.55);
  g.fillText(text, x, y, maxW);
}

function board(g: G, w: number, h: number, color: number, lightbox: boolean): void {
  g.fillStyle = css(BOARD);
  g.fillRect(0, 0, w, h);
  if (lightbox) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, mixCss(color, WHITE, 0.25));
    grad.addColorStop(1, mixCss(color, BLACK, 0.25));
    g.globalAlpha = 0.55;
    g.fillStyle = grad;
    g.fillRect(2, 2, w - 4, h - 4);
    g.globalAlpha = 1;
  }
}

function drawBand(g: G, c: Cell, rng: Rng): void {
  const col = NEON[c.color].hex;
  const style = rng.int(0, 2);
  board(g, c.pw, c.ph, col, style === 1);
  if (style === 2) {
    roundRect(g, 5, 5, c.pw - 10, c.ph - 10, 8);
    tube(g, NEON[rng.pick(['neonCyan', 'neonOrange', 'neonRed'] as const)].hex, 2.5);
  }
  const mode = style === 1 ? 'dark' : 'neon';
  if (c.sub) {
    glowText(g, c.text, c.pw * 0.42, c.ph * 0.54, c.ph * 0.58, col, c.pw * 0.7, mode, 900);
    glowText(g, c.sub, c.pw * 0.86, c.ph * 0.54, c.ph * 0.32, col, c.pw * 0.2, mode, 700);
  } else {
    glowText(g, c.text, c.pw / 2, c.ph * 0.54, c.ph * 0.6, col, c.pw * 0.9, mode, 900);
  }
}

function drawVerticalGlyphs(
  g: G,
  c: Cell,
  glyphs: string[],
  cellPx: number,
  rng: Rng,
  framed: boolean,
): void {
  const col = NEON[c.color].hex;
  const lightbox = rng.chance(0.3);
  board(g, c.pw, c.ph, col, lightbox);
  if (framed) {
    roundRect(g, 4, 4, c.pw - 8, c.ph - 8, 6);
    tube(g, col, 2.5);
  }
  glyphs.forEach((ch, i) => {
    const y = glyphSlotY(i, cellPx);
    glowText(
      g,
      ch,
      c.pw / 2,
      y,
      cellPx * 0.74,
      col,
      c.pw * 0.9,
      lightbox ? 'dark' : rng.chance(0.3) ? 'tube' : 'neon',
      900,
    );
  });
}

function drawBlade(g: G, c: Cell, rng: Rng): void {
  const glyphs = verticalGlyphs(c.text.split(' ')[0] ?? c.text).slice(0, 5);
  const step = c.ph / Math.max(glyphs.length, 3);
  drawVerticalGlyphs(g, { ...c }, glyphs, Math.min(step, c.pw * 1.1), rng, rng.chance(0.6));
}

function drawVText(g: G, c: Cell, rng: Rng): void {
  drawVerticalGlyphs(g, c, Array.from(c.text), c.pw, rng, true);
}

function drawCrown(g: G, c: Cell, rng: Rng): void {
  g.fillStyle = css(BOARD);
  g.fillRect(0, 0, c.pw, c.ph);
  const col = NEON[c.color].hex;
  const accent = NEON[rng.pick(['neonCyan', 'neonOrange', 'neonRed'] as const)].hex;
  g.beginPath();
  g.arc(c.ph * 0.55, c.ph / 2, c.ph * 0.3, 0, Math.PI * 2);
  tube(g, accent, 4);
  g.beginPath();
  g.moveTo(c.ph * 0.3, c.ph * 0.8);
  g.lineTo(c.ph * 0.8, c.ph * 0.2);
  tube(g, accent, 4);
  const x0 = c.ph * 1.1;
  const w = c.pw - x0 - 10;
  if (c.sub) {
    glowText(g, c.text, x0 + w * 0.42, c.ph * 0.54, c.ph * 0.56, col, w * 0.66, 'neon', 900);
    glowText(g, c.sub, x0 + w * 0.86, c.ph * 0.54, c.ph * 0.26, accent, w * 0.28, 'neon', 700);
  } else {
    glowText(g, c.text, x0 + w / 2, c.ph * 0.54, c.ph * 0.56, col, w * 0.95, 'neon', 900);
  }
}

function drawPanel(g: G, c: Cell, rng: Rng): void {
  const col = NEON[c.color].hex;
  const lightbox = rng.chance(0.5);
  board(g, c.pw, c.ph, col, lightbox);
  roundRect(g, 4, 4, c.pw - 8, c.ph - 8, 6);
  tube(g, col, 2);
  glowText(
    g,
    c.text,
    c.pw / 2,
    c.ph * 0.54,
    c.ph * 0.56,
    col,
    c.pw * 0.84,
    lightbox ? 'dark' : 'neon',
    900,
  );
}

function drawRing(g: G, c: Cell): void {
  g.fillStyle = css(BLACK);
  g.fillRect(0, 0, c.pw, c.ph);
  const col = NEON[c.color].hex;
  g.font = `900 ${c.ph * 0.62}px ${FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const seg = `${c.text}   `;
  const tw = g.measureText(seg).width;
  for (let x = 8, k = 0; x < c.pw && k < 6; x += tw, k++) {
    g.shadowColor = css(col);
    g.shadowBlur = 8;
    g.fillStyle = css(k % 2 ? col : NEON.neonWhite.hex);
    g.fillText(seg, x, c.ph * 0.54);
  }
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(0,0,0,0.75)';
  for (let y = 0; y < c.ph; y += 4) g.fillRect(0, y, c.pw, 1);
  for (let x = 0; x < c.pw; x += 4) g.fillRect(x, 0, 1, c.ph);
}

function drawLine(g: G, c: Cell): void {
  g.fillStyle = css(BLACK);
  g.fillRect(0, 0, c.pw, c.ph);
  glowText(
    g,
    c.text,
    c.pw / 2,
    c.ph * 0.54,
    c.ph * 0.6,
    NEON[c.color].hex,
    c.pw * 0.94,
    'neon',
    900,
  );
}

function drawAd(g: G, c: Cell): void {
  const col = NEON[c.color].hex;
  const grad = g.createLinearGradient(0, 0, 0, c.ph);
  grad.addColorStop(0, mixCss(col, BLACK, 0.2));
  grad.addColorStop(1, mixCss(col, BLACK, 0.75));
  g.fillStyle = grad;
  g.fillRect(0, 0, c.pw, c.ph);
  g.beginPath();
  g.arc(c.pw / 2, c.ph * 0.36, c.pw * 0.26, 0, Math.PI * 2);
  g.fillStyle = mixCss(col, WHITE, 0.6);
  g.fill();
  glowText(g, c.text, c.pw / 2, c.ph * 0.72, c.pw * 0.17, WHITE, c.pw * 0.9, 'neon', 900);
  glowText(g, c.sub, c.pw / 2, c.ph * 0.86, c.pw * 0.11, WHITE, c.pw * 0.9, 'neon', 700);
}

function drawTent(g: G, c: Cell): void {
  const col = NEON[c.color].hex;
  g.fillStyle = mixCss(col, BLACK, 0.35);
  g.fillRect(0, 0, c.pw, c.ph);
  glowText(
    g,
    c.text,
    c.pw / 2,
    c.ph * 0.55,
    c.ph * 0.62,
    NEON.neonWhite.hex,
    c.pw * 0.9,
    'neon',
    900,
  );
}

function drawLogo(g: G, c: Cell, idx: number): void {
  g.fillStyle = css(BLACK);
  g.fillRect(0, 0, c.pw, c.ph);
  const col = NEON[c.color].hex;
  const alt = NEON[idx % 2 ? 'neonOrange' : 'neonCyan'].hex;
  const cx = c.pw / 2;
  const cy = c.ph * 0.4;
  const R = c.ph * 0.26;
  g.beginPath();
  switch (idx % 6) {
    case 0:
      g.arc(cx, cy, R, 0, Math.PI * 2);
      tube(g, col, 6);
      g.beginPath();
      g.moveTo(cx - R, cy + R);
      g.lineTo(cx + R, cy - R);
      tube(g, alt, 6);
      break;
    case 1:
      g.arc(cx, cy, R, 0, Math.PI * 2);
      tube(g, alt, 5);
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        g.lineTo(cx + Math.cos(a) * R * 0.75, cy + Math.sin(a) * R * 0.75);
      }
      g.closePath();
      tube(g, col, 6);
      break;
    case 2:
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(cx, cy + R * 0.4, R * (1 - i * 0.3), Math.PI, Math.PI * 2);
        tube(g, i === 1 ? alt : col, 5);
      }
      break;
    case 3:
      g.moveTo(cx - R, cy + R * 0.6);
      g.lineTo(cx - R * 0.2, cy - R);
      g.moveTo(cx - R * 0.1, cy + R * 0.6);
      g.lineTo(cx + R * 0.7, cy - R);
      tube(g, col, 6);
      g.beginPath();
      g.moveTo(cx - R * 1.1, cy + R * 0.9);
      g.quadraticCurveTo(cx, cy + R * 0.4, cx + R * 1.1, cy + R * 0.9);
      tube(g, alt, 4);
      break;
    case 4:
      g.rect(cx - R * 0.6, cy - R * 0.6, R * 1.2, R * 1.2);
      tube(g, col, 5);
      g.beginPath();
      for (let i = -1; i <= 1; i++) {
        g.moveTo(cx + i * R * 0.35, cy - R * 0.6);
        g.lineTo(cx + i * R * 0.35, cy - R);
        g.moveTo(cx + i * R * 0.35, cy + R * 0.6);
        g.lineTo(cx + i * R * 0.35, cy + R);
      }
      tube(g, alt, 3);
      break;
    default:
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      }
      g.closePath();
      tube(g, col, 5);
      g.beginPath();
      g.arc(cx, cy, R * 0.25, 0, Math.PI * 2);
      tube(g, alt, 5);
  }
  glowText(g, c.text, cx, c.ph * 0.8, c.ph * 0.12, col, c.pw * 0.92, 'neon', 900);
  glowText(g, c.sub, cx, c.ph * 0.92, c.ph * 0.07, alt, c.pw * 0.85, 'neon', 700);
}

function drawKoi(g: G, c: Cell): void {
  g.fillStyle = css(BLACK);
  g.fillRect(0, 0, c.pw, c.ph);
  const col = NEON[c.color].hex;
  const s = c.pw;
  g.save();
  g.translate(s / 2, s / 2);
  g.rotate(-0.5);
  g.beginPath();
  g.moveTo(-s * 0.36, 0);
  g.bezierCurveTo(-s * 0.2, -s * 0.16, s * 0.18, -s * 0.13, s * 0.3, 0);
  g.bezierCurveTo(s * 0.18, s * 0.13, -s * 0.2, s * 0.16, -s * 0.36, 0);
  tube(g, col, 4);
  g.beginPath();
  g.moveTo(s * 0.28, 0);
  g.quadraticCurveTo(s * 0.38, -s * 0.02, s * 0.45, -s * 0.13);
  g.quadraticCurveTo(s * 0.4, 0, s * 0.45, s * 0.13);
  g.quadraticCurveTo(s * 0.38, s * 0.02, s * 0.28, 0);
  tube(g, NEON.neonOrange.hex, 3);
  g.beginPath();
  g.moveTo(-s * 0.12, s * 0.09);
  g.quadraticCurveTo(-s * 0.05, s * 0.22, s * 0.02, s * 0.1);
  g.moveTo(-s * 0.12, -s * 0.09);
  g.quadraticCurveTo(-s * 0.05, -s * 0.22, s * 0.02, -s * 0.1);
  tube(g, col, 2.5);
  g.beginPath();
  g.arc(-s * 0.27, -s * 0.03, s * 0.015, 0, Math.PI * 2);
  tube(g, NEON.neonWhite.hex, 2);
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(-s * 0.12 + i * s * 0.08, 0, s * 0.04, -Math.PI / 2, Math.PI / 2);
    tube(g, col, 1.5);
  }
  g.restore();
}

export interface Atlas {
  texture: THREE.CanvasTexture;
  catalog: Catalog;
}

export function buildAtlas(catalog: Catalog, renderer: THREE.WebGLRenderer, seed = 5353): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = catalog.width;
  canvas.height = catalog.height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable for the neon atlas');
  g.fillStyle = css(BLACK);
  g.fillRect(0, 0, canvas.width, canvas.height);
  const rng = createRng(seed);
  let logoIdx = 0;
  for (const c of catalog.cells) {
    g.save();
    g.beginPath();
    g.rect(c.px, c.py, c.pw, c.ph);
    g.clip();
    g.translate(c.px, c.py);
    switch (c.kind) {
      case 'band':
        drawBand(g, c, rng);
        break;
      case 'blade':
        drawBlade(g, c, rng);
        break;
      case 'vtext':
        drawVText(g, c, rng);
        break;
      case 'crown':
        drawCrown(g, c, rng);
        break;
      case 'panel':
        drawPanel(g, c, rng);
        break;
      case 'ring':
        drawRing(g, c);
        break;
      case 'line':
        drawLine(g, c);
        break;
      case 'ad':
        drawAd(g, c);
        break;
      case 'tent':
        drawTent(g, c);
        break;
      case 'logo':
        drawLogo(g, c, logoIdx++);
        break;
      case 'koi':
        drawKoi(g, c);
        break;
    }
    g.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return { texture, catalog };
}
