import { describe, expect, it, vi } from 'vitest';
import { CITY, generateLayout } from '../src/city/layout';
import {
  loadCity,
  type CityMessage,
  type LayoutWorker,
  type TerrainPrebuilt,
} from '../src/city/loadLayout';

const reference = generateLayout(CITY.seed);
const TERRAIN = { ground: 'g', channel: 'c' } as unknown as TerrainPrebuilt;

type Script = 'ok' | 'error' | 'layout-then-error' | 'layout-then-silence';

/** A fake worker that answers like the real one: the layout (structured clone), then terrain. */
function fakeWorker(script: Script = 'ok'): LayoutWorker & { terminated: number } {
  const w: LayoutWorker & { terminated: number } = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminated: 0,
    postMessage: ({ seed }) => {
      queueMicrotask(() => {
        if (script === 'error') {
          w.onerror?.({ message: 'boom' } as ErrorEvent);
          return;
        }
        const send = (data: CityMessage): void => {
          w.onmessage?.({ data } as MessageEvent<CityMessage>);
        };
        send({ kind: 'layout', layout: structuredClone(generateLayout(seed)) });
        if (script === 'ok') send({ kind: 'terrain', terrain: TERRAIN });
        if (script === 'layout-then-error') w.onerror?.({ message: 'late' } as ErrorEvent);
      });
    },
    terminate: () => {
      w.terminated++;
    },
  };
  return w;
}

/** Paths of values a structured clone would not keep as they are (class instances, functions). */
function unclonable(v: unknown, path = 'layout', out: string[] = []): string[] {
  if (typeof v === 'function') out.push(path);
  if (v === null || typeof v !== 'object') return out;
  const proto: unknown = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== Array.prototype) out.push(path);
  for (const [k, c] of Object.entries(v)) unclonable(c, `${path}.${k}`, out);
  return out;
}

describe('loadCity', () => {
  it('the layout is plain data: the worker clone keeps no class instances or functions', () => {
    expect(unclonable(reference).slice(0, 5)).toEqual([]);
  });

  it('worker path: the cloned layout equals the main-thread one, then terrain arrives', async () => {
    const w = fakeWorker();
    const city = loadCity(CITY.seed, () => w);
    expect(await city.layout).toStrictEqual(reference);
    expect(await city.terrain).toBe(TERRAIN);
    expect(w.terminated).toBe(1);
  });

  it('falls back to the main thread when there are no workers, creation throws or the worker fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const make of [
      null,
      () => {
        throw new Error('blocked');
      },
      () => fakeWorker('error'),
    ]) {
      const city = loadCity(CITY.seed, make);
      expect(await city.layout).toStrictEqual(reference);
      expect(await city.terrain).toBeNull();
    }
    warn.mockRestore();
  });

  it('a worker error after the layout keeps the layout and leaves terrain to init', async () => {
    const w = fakeWorker('layout-then-error');
    const city = loadCity(CITY.seed, () => w);
    expect(await city.layout).toStrictEqual(reference);
    expect(await city.terrain).toBeNull();
    expect(w.terminated).toBeGreaterThan(0);
  });

  it('a worker that goes silent after the layout times out: terrain null, worker terminated', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = fakeWorker('layout-then-silence');
    const city = loadCity(CITY.seed, () => w, 20);
    expect(await city.layout).toStrictEqual(reference);
    expect(await city.terrain).toBeNull();
    expect(w.terminated).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
