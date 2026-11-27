import { describe, expect, it, vi } from 'vitest';
import { CITY, generateLayout } from '../src/city/layout';
import { loadLayout, type LayoutWorker } from '../src/city/loadLayout';
import type { Layout } from '../src/city/types';

const reference = generateLayout(CITY.seed);

/** A fake worker that answers like the real one: the layout after a structured clone. */
function fakeWorker(fail = false): LayoutWorker {
  const w: LayoutWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: ({ seed }) => {
      queueMicrotask(() => {
        if (fail) w.onerror?.({ message: 'boom' } as ErrorEvent);
        else w.onmessage?.({ data: structuredClone(generateLayout(seed)) } as MessageEvent<Layout>);
      });
    },
    terminate: () => {},
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

describe('loadLayout', () => {
  it('the layout is plain data: the worker clone keeps no class instances or functions', () => {
    expect(unclonable(reference).slice(0, 5)).toEqual([]);
  });

  it('worker path: the cloned layout equals the main-thread one', async () => {
    expect(await loadLayout(CITY.seed, () => fakeWorker())).toStrictEqual(reference);
  });

  it('falls back to the main thread when there are no workers, creation throws or the worker fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadLayout(CITY.seed, null)).toStrictEqual(reference);
    expect(
      await loadLayout(CITY.seed, () => {
        throw new Error('blocked');
      }),
    ).toStrictEqual(reference);
    expect(await loadLayout(CITY.seed, () => fakeWorker(true))).toStrictEqual(reference);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
