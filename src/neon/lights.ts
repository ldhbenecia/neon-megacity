import * as THREE from 'three';

export type LightGroup = 'street' | 'screen' | 'stall' | 'river';

export interface LightCandidate {
  group: LightGroup;
  x: number;
  y: number;
  z: number;
  color: [number, number, number];
  intensity: number;
  distance: number;
}

export type LightBudget = Readonly<Record<LightGroup, number>>;

/**
 * Per user tier (docs/PERF.md); high is the original set. The pool always holds the high count so
 * no program recompiles; lower tiers only fade slots to intensity 0. The lit shaders still loop
 * over every light, so this saves almost no GPU time: it is a look knob, not a speed knob.
 */
export const LIGHT_BUDGETS: Readonly<Record<'high' | 'medium' | 'low', LightBudget>> = {
  high: { street: 3, screen: 1, stall: 1, river: 1 },
  medium: { street: 2, screen: 1, stall: 1, river: 0 },
  low: { street: 0, screen: 0, stall: 0, river: 0 },
};
export const LIGHT_BUDGET: LightBudget = LIGHT_BUDGETS.high;
export const MAX_POINT_LIGHTS = 8;

export function pickLights(
  cands: readonly LightCandidate[],
  cam: { x: number; y: number; z: number },
  budget: Readonly<Record<LightGroup, number>> = LIGHT_BUDGET,
  maxRange = 600,
): number[] {
  const best: Record<LightGroup, { i: number; d: number }[]> = {
    street: [],
    screen: [],
    stall: [],
    river: [],
  };
  cands.forEach((c, i) => {
    const d = Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z);
    if (d > maxRange + c.distance) return;
    const list = best[c.group];
    const n = budget[c.group];
    if (list.length < n) {
      list.push({ i, d });
      list.sort((a, b) => a.d - b.d);
    } else if (n > 0 && d < (list[n - 1]?.d ?? Infinity)) {
      list[n - 1] = { i, d };
      list.sort((a, b) => a.d - b.d);
    }
  });
  return (Object.keys(best) as LightGroup[]).flatMap((g) => best[g].map((e) => e.i));
}

interface Slot {
  light: THREE.PointLight;
  target: number;
  current: number;
  level: number;
}

export interface LightPool {
  group: THREE.Group;
  update(dt: number, cam: THREE.Vector3, gain: number): void;
  /** Change the per-group budget; the light count stays fixed (no shader recompile). */
  setBudget(budget: LightBudget): void;
  readonly count: number;
  dispose(): void;
}

// The light count never changes (intensity fades instead), so shader programs never recompile.
export function createLightPool(cands: readonly LightCandidate[]): LightPool {
  const group = new THREE.Group();
  group.name = 'neon-point-lights';
  const total = Math.min(
    MAX_POINT_LIGHTS,
    Object.values(LIGHT_BUDGET).reduce((s, n) => s + n, 0),
  );
  const slots: Slot[] = [];
  for (let i = 0; i < total; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 40, 2);
    light.castShadow = false;
    group.add(light);
    slots.push({ light, target: -1, current: -1, level: 0 });
  }
  let timer = 0;
  let budget: LightBudget = LIGHT_BUDGET;
  const camPos = { x: 0, y: 0, z: 0 };
  return {
    group,
    count: total,
    setBudget(b) {
      budget = b;
      timer = 0;
    },
    update(dt, cam, gain) {
      timer -= dt;
      if (timer <= 0) {
        timer = 0.25;
        camPos.x = cam.x;
        camPos.y = cam.y;
        camPos.z = cam.z;
        const picked = pickLights(cands, camPos, budget);
        const wanted = new Set(picked);
        for (const s of slots)
          if (s.current >= 0 && wanted.has(s.current)) wanted.delete(s.current);
        const free = [...wanted];
        for (const s of slots) {
          if (s.current >= 0 && picked.includes(s.current)) s.target = s.current;
          else s.target = free.shift() ?? -1;
        }
      }
      for (const s of slots) {
        if (s.target !== s.current) {
          s.level = Math.max(0, s.level - dt / 0.15);
          if (s.level === 0) {
            s.current = s.target;
            const c = cands[s.current];
            if (c) {
              s.light.position.set(c.x, c.y, c.z);
              s.light.color.setRGB(c.color[0], c.color[1], c.color[2]);
              s.light.distance = c.distance;
            }
          }
        } else if (s.current >= 0) {
          s.level = Math.min(1, s.level + dt / 0.15);
        }
        const c = cands[s.current];
        s.light.intensity = c ? c.intensity * s.level * gain : 0;
      }
    },
    dispose() {
      for (const s of slots) s.light.dispose();
    },
  };
}
