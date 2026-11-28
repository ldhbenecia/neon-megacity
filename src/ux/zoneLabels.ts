import type { PerspectiveCamera } from 'three';
import { Matrix4, Vector3 } from 'three';
import { surfaceHeight } from '../city/layout';
import { MAJOR_KINDS, districtViews, type DistrictView } from './presets';

/** Height above the ground where labels start to show, and where they are fully shown (m). */
export const LABEL_FADE = [600, 900] as const;
/** Below this opacity a label is too faint to aim at: clicks go through to the city. */
const CLICK_ALPHA = 0.5;
/** A press that moves farther than this (px) is an orbit drag, handed to the canvas. */
const DRAG_PX = 5;

/** Quarters that get a label: the emphasised ones plus the palace and the showroom strip. */
const LABEL_KINDS = new Set([...MAJOR_KINDS, 'palace', 'showroom']);

/** HUD surfaces a label must not cover. */
const BLOCKERS =
  '#panel, #hud-card, #timeline, #panel-toggle, .hud-brand, #hud-hint, #help, #hud-toast, .touch-pad';

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
  /** `shown`: the HUD is visible and no fly/cinematic mode is on. */
  update(camera: PerspectiveCamera, shown: boolean): void;
  dispose(): void;
}

/**
 * No occlusion test: from LABEL_FADE[0] up, hills and towers no longer stand between the camera
 * and a quarter's centre.
 */
export function createZoneLabels(
  root: HTMLElement,
  canvas: HTMLElement,
  onPick: (zoneId: string) => void,
): ZoneLabels {
  const hud = root.parentElement ?? root;
  const zones = labelZones();
  const off: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(
    el: EventTarget,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void => {
    el.addEventListener(type, fn as EventListener, opts);
    off.push(() => el.removeEventListener(type, fn as EventListener, opts));
  };

  let press: { x: number; y: number; id: number; handed: boolean } | null = null;
  const buttons = zones.map((z) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'zone-label';
    b.textContent = z.name;
    b.dataset.zone = z.id;
    b.setAttribute('aria-label', `${z.name}(으)로 이동`);
    on(b, 'click', () => onPick(z.id));
    // Wheel zoom stays with the rig, which only takes wheels aimed at the canvas.
    on(
      b,
      'wheel',
      (e) => {
        e.preventDefault();
        canvas.dispatchEvent(new WheelEvent('wheel', e));
      },
      { passive: false },
    );
    on(b, 'pointerdown', (e) => {
      press = { x: e.clientX, y: e.clientY, id: e.pointerId, handed: false };
    });
    on(b, 'pointermove', (e) => {
      if (!press || press.handed || e.pointerId !== press.id) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_PX) return;
      // A drag that starts on a label orbits like one on the canvas: OrbitControls captures the
      // pointer on the canvas from here, so the release is no click on the label.
      press.handed = true;
      root.classList.add('is-passing');
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          isPrimary: e.isPrimary,
          button: 0,
          buttons: e.buttons,
          clientX: press.x,
          clientY: press.y,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    root.append(b);
    return b;
  });
  on(window, 'pointerup', () => {
    press = null;
    root.classList.remove('is-passing');
  });

  const anchors = zones.map((z) => {
    const { x, z: zz } = z.target;
    return new Vector3(x, surfaceHeight(x, zz) + 20, zz);
  });
  let sizes: { w: number; h: number }[] | null = null;
  let blocked: LabelBox[] | null = null;
  const blockerEls = [...document.querySelectorAll<HTMLElement>(BLOCKERS)];
  const markLayout = (): void => {
    blocked = null;
  };
  on(window, 'resize', () => {
    sizes = null;
    markLayout();
  });
  // Panels, cards and hints open and close through attributes on themselves or on #hud.
  const mo = new MutationObserver(markLayout);
  for (const el of [hud, ...blockerEls]) {
    mo.observe(el, {
      attributes: true,
      attributeFilter: ['hidden', 'class', 'data-panel', 'data-card', 'data-help'],
    });
  }
  const ro = new ResizeObserver(markLayout);
  for (const el of blockerEls) ro.observe(el);

  const lastView = new Matrix4();
  const view = new Matrix4();
  let lastAlpha = -1;
  let showing = false;
  const p = new Vector3();

  return {
    update(camera, shown) {
      const alpha = shown
        ? labelAlpha(camera.position.y - surfaceHeight(camera.position.x, camera.position.z))
        : 0;
      if (alpha === 0) {
        if (showing) root.hidden = true;
        showing = false;
        return;
      }
      if (!showing) {
        root.hidden = false;
        showing = true;
        lastAlpha = -1;
      }
      view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      if (alpha === lastAlpha && blocked && sizes && view.equals(lastView)) return;
      lastView.copy(view);
      if (alpha !== lastAlpha) {
        root.style.opacity = String(alpha);
        root.classList.toggle('is-faint', alpha < CLICK_ALPHA);
        lastAlpha = alpha;
      }
      if (!sizes) {
        // Laid-out labels only: a hidden one measures 0 x 0 and would never collide.
        for (const b of buttons) b.hidden = false;
        const measured = buttons.map((b) => ({ w: b.offsetWidth, h: b.offsetHeight }));
        if (measured.some((m) => m.w === 0)) return;
        sizes = measured;
      }
      blocked ??= blockerEls
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
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const s = sizes;
      const boxes = anchors.map((a, i) => {
        p.copy(a).project(camera);
        if (p.z > 1 || p.z < -1) return null;
        const { w, h } = s[i] ?? { w: 0, h: 0 };
        const x = ((p.x + 1) / 2) * vw - w / 2;
        const y = ((1 - p.y) / 2) * vh - h / 2;
        if (x < 0 || y < 0 || x + w > vw || y + h > vh) return null;
        return { x, y, w, h };
      });
      const visible = placeLabels(boxes, blocked);
      const focused = document.activeElement;
      buttons.forEach((b, i) => {
        const box = boxes[i];
        // A focused label stays put, so keyboard focus never drops to the page.
        const keep = visible[i] === true || (b === focused && box != null);
        b.hidden = !keep;
        if (keep && box) b.style.transform = `translate(${box.x}px, ${box.y}px)`;
      });
    },
    dispose() {
      mo.disconnect();
      ro.disconnect();
      for (const f of off) f();
      for (const b of buttons) b.remove();
      root.hidden = true;
      root.style.opacity = '';
      root.classList.remove('is-faint', 'is-passing');
    },
  };
}
