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

export const LIGHT_BUDGET: Readonly<Record<LightGroup, number>> = {
  street: 3,
  screen: 1,
  stall: 1,
  river: 1,
};
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
  const camPos = { x: 0, y: 0, z: 0 };
  return {
    group,
    count: total,
    update(dt, cam, gain) {
      timer -= dt;
      if (timer <= 0) {
        timer = 0.25;
        camPos.x = cam.x;
        camPos.y = cam.y;
        camPos.z = cam.z;
        const picked = pickLights(cands, camPos);
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
