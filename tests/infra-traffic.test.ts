// Neon's highway traffic on the curves infra publishes (InfraApi.curves = drawn deck only): the
// streams stay populated, and every path point lies on a drawn deck, with no straight jump
// bridging two separate stretches.
import { CatmullRomCurve3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CITY, LAYOUT, deckHeightAt, type Vec3 } from '../src/city/layout';
import { hwPath, nearestOnPath, visiblePoints } from '../src/infra/highways';
import { highwayPath, vehicleStreams, type Path } from '../src/neon/lanes';

/** Same sample count neon/index.ts uses for highway curves. */
const CURVE_SAMPLES = 400;

/** InfraApi.curves exactly as src/infra/index.ts builds them. */
function publishedCurve(id: string): CatmullRomCurve3 | null {
  const hw = LAYOUT.highways.find((h) => h.id === id)!;
  const pts = visiblePoints(hwPath(hw));
  if (pts.length < 2) return null;
  const v = pts.map((p) => new Vector3(p[0], p[1], p[2]));
  return new CatmullRomCurve3(v, hw.closed, 'centripetal');
}

function highwayPaths(): Path[] {
  const out: Path[] = [];
  for (const hw of LAYOUT.highways) {
    const curve = publishedCurve(hw.id);
    if (!curve) continue;
    const s: Vec3[] = curve.getSpacedPoints(CURVE_SAMPLES).map((v) => ({ x: v.x, y: v.y, z: v.z }));
    out.push(highwayPath(hw.id, s, hw.closed));
  }
  return out;
}

describe('neon traffic on the trimmed highway curves', () => {
  const paths = highwayPaths();

  it('every highway still gets a path and vehicles', () => {
    expect(paths.map((p) => p.id).sort()).toEqual(LAYOUT.highways.map((h) => h.id).sort());
    const vehicles = vehicleStreams(paths, LAYOUT.highways);
    paths.forEach((p, i) => {
      expect(vehicles.filter((v) => v.path === i).length, p.id).toBeGreaterThan(0);
    });
  });

  it('every path point sits on the drawn deck (in the map, on the centerline, at deck height)', () => {
    for (const p of paths) {
      const hw = LAYOUT.highways.find((h) => h.id === p.id)!;
      const full = hwPath(hw);
      for (const q of p.points) {
        // A portal end runs PORTAL_TRAFFIC (6 m) into its block past the edge pad (10 m).
        expect(Math.abs(q.x), p.id).toBeLessThanOrEqual(CITY.halfX + 10 + 6 + 1e-6);
        expect(Math.abs(q.z), p.id).toBeLessThanOrEqual(CITY.halfZ + 10 + 6 + 1e-6);
        const n = nearestOnPath(full, q.x, q.z);
        expect(n.d, `${p.id} off its centerline`).toBeLessThan(0.5);
        expect(Math.abs(n.y - q.y), p.id).toBeLessThan(0.5);
        if (Math.abs(q.x) <= CITY.halfX && Math.abs(q.z) <= CITY.halfZ) {
          expect(deckHeightAt(LAYOUT, q.x, q.z), `${p.id} over no deck`).not.toBeNull();
        }
      }
    }
  });

  it('no straight jump between samples (stretches are never bridged)', () => {
    for (const p of paths) {
      const step = p.length / (p.points.length - 1);
      for (let i = 1; i < p.points.length; i++) {
        const a = p.points[i - 1]!;
        const b = p.points[i]!;
        expect(Math.hypot(b.x - a.x, b.z - a.z), p.id).toBeLessThan(step * 1.5 + 1e-6);
      }
    }
  });
});
