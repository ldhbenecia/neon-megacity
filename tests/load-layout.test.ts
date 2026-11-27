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

describe('loadLayout', () => {
  it('worker path: the cloned layout equals the main-thread one', async () => {
    expect(await loadLayout(CITY.seed, () => fakeWorker())).toEqual(reference);
  });

  it('falls back to the main thread when there are no workers, creation throws or the worker fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadLayout(CITY.seed, null)).toEqual(reference);
    expect(
      await loadLayout(CITY.seed, () => {
        throw new Error('blocked');
      }),
    ).toEqual(reference);
    expect(await loadLayout(CITY.seed, () => fakeWorker(true))).toEqual(reference);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
