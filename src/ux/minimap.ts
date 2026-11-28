// Small map of the city in the control panel: zones, river and bridges drawn once from the
// layout, plus the camera's position and heading. Clicking a zone flies there.
import { CITY, LAYOUT, riverWidthAt, zoneAt } from '../city/layout';
import { MAJOR_KINDS } from './presets';

export interface MapTransform {
  toMap(x: number, z: number): { px: number; py: number };
  toWorld(px: number, py: number): { x: number; z: number };
}

/** World XZ (north = -Z up) to canvas pixels, the map's extent filling `w` x `h`. */
export function mapTransform(halfX: number, halfZ: number, w: number, h: number): MapTransform {
  const sx = w / (halfX * 2);
  const sz = h / (halfZ * 2);
  return {
    toMap: (x, z) => ({ px: (x + halfX) * sx, py: (z + halfZ) * sz }),
    toWorld: (px, py) => ({ x: px / sx - halfX, z: py / sz - halfZ }),
  };
}

export interface Minimap {
  /** Camera ground position and view direction (XZ); redraws only when the change would show. */
  update(x: number, z: number, dirX: number, dirZ: number): void;
  dispose(): void;
}

export function createMinimap(
  canvas: HTMLCanvasElement,
  onPick: (zoneId: string) => void,
  canPick: (zoneId: string) => boolean,
): Minimap {
  // Set once here, not in the resize callback: changing the observed box there loops the observer.
  canvas.style.aspectRatio = `${CITY.halfX} / ${CITY.halfZ}`;
  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas');
  let t = mapTransform(CITY.halfX, CITY.halfZ, 1, 1);
  let cam = { x: NaN, z: NaN };
  // null while looking almost straight down: no meaningful heading to show.
  let yaw: number | null = null;
  let width = 0;
  let dpr = 0;

  const drawBase = (): void => {
    const w = width;
    const h = w * (CITY.halfZ / CITY.halfX);
    canvas.width = base.width = Math.round(w * dpr);
    canvas.height = base.height = Math.round(h * dpr);
    t = mapTransform(CITY.halfX, CITY.halfZ, canvas.width, canvas.height);
    const g = base.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, base.width, base.height);
    for (const zone of LAYOUT.districts) {
      if (zone.kind === 'riverside') continue;
      g.beginPath();
      zone.polygon.forEach((q, i) => {
        const p = t.toMap(q.x, q.z);
        if (i === 0) g.moveTo(p.px, p.py);
        else g.lineTo(p.px, p.py);
      });
      g.closePath();
      const major = MAJOR_KINDS.has(zone.kind);
      g.fillStyle = major ? 'rgba(25, 242, 230, 0.12)' : 'rgba(25, 242, 230, 0.05)';
      g.fill();
      g.strokeStyle = 'rgba(25, 242, 230, 0.22)';
      g.lineWidth = dpr;
      g.stroke();
    }
    // River: the centre line stroked at the local channel width.
    const scale = canvas.width / (CITY.halfX * 2);
    g.strokeStyle = 'rgba(24, 66, 84, 0.95)';
    g.lineCap = 'round';
    const pts = LAYOUT.river.samples;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      g.lineWidth = Math.max(1, riverWidthAt((a.x + b.x) / 2) * scale);
      const pa = t.toMap(a.x, a.z);
      const pb = t.toMap(b.x, b.z);
      g.beginPath();
      g.moveTo(pa.px, pa.py);
      g.lineTo(pb.px, pb.py);
      g.stroke();
    }
    g.strokeStyle = 'rgba(220, 239, 237, 0.75)';
    g.lineWidth = 1.5 * dpr;
    for (const br of LAYOUT.bridges) {
      const pa = t.toMap(br.landA.x, br.landA.z);
      const pb = t.toMap(br.landB.x, br.landB.z);
      g.beginPath();
      g.moveTo(pa.px, pa.py);
      g.lineTo(pb.px, pb.py);
      g.stroke();
    }
  };

  const draw = (): void => {
    if (!ctx || width === 0) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    if (!Number.isFinite(cam.x)) return;
    const p = t.toMap(cam.x, cam.z);
    if (yaw !== null) {
      ctx.fillStyle = 'rgba(255, 42, 58, 0.35)';
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.arc(p.px, p.py, 16 * dpr, yaw - 0.45, yaw + 0.45);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#ff2a3a';
    ctx.beginPath();
    ctx.arc(p.px, p.py, 3 * dpr, 0, Math.PI * 2);
    ctx.fill();
  };

  const zoneUnder = (e: PointerEvent): string | null => {
    const r = canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * canvas.width;
    const py = ((e.clientY - r.top) / r.height) * canvas.height;
    const w = t.toWorld(px, py);
    const id = zoneAt(w.x, w.z).id;
    return canPick(id) ? id : null;
  };
  const onClick = (e: PointerEvent): void => {
    const id = zoneUnder(e);
    if (id) onPick(id);
  };
  const onMove = (e: PointerEvent): void => {
    canvas.style.cursor = zoneUnder(e) ? 'pointer' : 'default';
  };
  canvas.addEventListener('click', onClick as EventListener);
  canvas.addEventListener('pointermove', onMove);

  // The panel starts hidden (0 px wide): draw once it has a size, and again when its width or the
  // pixel ratio changes. The height comes from CSS aspect-ratio, never from here.
  const resize = (): void => {
    const w = canvas.clientWidth;
    const r = Math.min(window.devicePixelRatio || 1, 2);
    if (w === 0 || (w === width && r === dpr)) return;
    width = w;
    dpr = r;
    drawBase();
    draw();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  let dprQuery: MediaQueryList | null = null;
  const watchDpr = (): void => {
    dprQuery?.removeEventListener('change', onDpr);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', onDpr);
  };
  function onDpr(): void {
    resize();
    watchDpr();
  }
  watchDpr();

  return {
    update(x, z, dirX, dirZ) {
      const nextYaw = Math.hypot(dirX, dirZ) < 0.05 ? null : Math.atan2(dirZ, dirX);
      const turned =
        (nextYaw === null) !== (yaw === null) ||
        (nextYaw !== null && yaw !== null && Math.abs(nextYaw - yaw) >= 0.05);
      if (Math.hypot(x - cam.x, z - cam.z) < 8 && !turned) return;
      cam = { x, z };
      yaw = nextYaw;
      draw();
    },
    dispose() {
      ro.disconnect();
      dprQuery?.removeEventListener('change', onDpr);
      base.width = base.height = 0;
      canvas.removeEventListener('click', onClick as EventListener);
      canvas.removeEventListener('pointermove', onMove);
    },
  };
}
