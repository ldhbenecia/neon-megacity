// Zone names over the map when the camera is high (topdown, wide overviews): a sense of where
// each quarter lies. The minimap in the panel is the way to move; these only orient, and a click
// flies there too. Down near the streets they fade out.
import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import { surfaceHeight } from '../city/layout';
import { MAJOR_KINDS, districtViews, type DistrictView } from './presets';

/** Height above the ground where labels start to show, and where they are fully shown (m). */
export const LABEL_FADE = [600, 900] as const;

/** Quarters that get a label: the emphasised ones plus the palace and the showroom strip. */
const LABEL_KINDS = new Set([...MAJOR_KINDS, 'palace', 'showroom']);

export function labelAlpha(heightAboveGround: number): number {
  const [a, b] = LABEL_FADE;
  return Math.min(1, Math.max(0, (heightAboveGround - a) / (b - a)));
}

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Which labels to show, in priority order: a label that overlaps an already placed one, or a
 * blocked area (panel, card, HUD rows), is dropped.
 */
export function placeLabels(
  boxes: readonly (LabelBox | null)[],
  blocked: readonly LabelBox[],
): boolean[] {
  const placed: LabelBox[] = [];
  const hit = (a: LabelBox, b: LabelBox): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  return boxes.map((box) => {
    if (!box || blocked.some((b) => hit(box, b)) || placed.some((p) => hit(box, p))) return false;
    placed.push(box);
    return true;
  });
}

export function labelZones(): DistrictView[] {
  return districtViews().filter((d) => LABEL_KINDS.has(d.kind));
}

export interface ZoneLabels {
  update(camera: PerspectiveCamera): void;
  dispose(): void;
}

export function createZoneLabels(
  root: HTMLElement,
  onPick: (zoneId: string) => void,
  blockers: () => readonly Element[],
): ZoneLabels {
  const zones = labelZones();
  const buttons = zones.map((z) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'zone-label';
    b.textContent = z.name;
    b.dataset.zone = z.id;
    b.setAttribute('aria-label', `${z.name}(으)로 이동`);
    b.addEventListener('click', () => onPick(z.id));
    root.append(b);
    return b;
  });
  const anchors = zones.map((z) => {
    const { x, z: zz } = z.target;
    return new Vector3(x, surfaceHeight(x, zz) + 20, zz);
  });
  const sizes: { w: number; h: number }[] = [];
  const p = new Vector3();
  let shown = false;

  return {
    update(camera) {
      const alpha = labelAlpha(
        camera.position.y - surfaceHeight(camera.position.x, camera.position.z),
      );
      if (alpha === 0) {
        if (shown) root.hidden = true;
        shown = false;
        return;
      }
      if (!shown) {
        root.hidden = false;
        // Measured once, while every label is laid out (a hidden one measures 0).
        if (sizes.length === 0) {
          for (const b of buttons) sizes.push({ w: b.offsetWidth, h: b.offsetHeight });
        }
      }
      shown = true;
      root.style.opacity = String(alpha);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const boxes = anchors.map((a, i) => {
        p.copy(a).project(camera);
        if (p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return null;
        const s = sizes[i] ?? { w: 0, h: 0 };
        const cx = ((p.x + 1) / 2) * vw;
        const cy = ((1 - p.y) / 2) * vh;
        return { x: cx - s.w / 2, y: cy - s.h / 2, w: s.w, h: s.h };
      });
      const blocked = blockers()
        .filter(
          // A closed panel keeps its box for the exit animation: only what is really shown blocks.
          (el) =>
            !el.closest('[hidden]') &&
            el.getClientRects().length > 0 &&
            getComputedStyle(el).visibility !== 'hidden',
        )
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        });
      const visible = placeLabels(boxes, blocked);
      buttons.forEach((b, i) => {
        const box = boxes[i];
        b.hidden = !visible[i];
        if (visible[i] && box) b.style.transform = `translate(${box.x}px, ${box.y}px)`;
      });
    },
    dispose() {
      for (const b of buttons) b.remove();
    },
  };
}
