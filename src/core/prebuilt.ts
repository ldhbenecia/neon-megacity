// Data a module would otherwise build in its init, made off the main thread at boot (src/boot.ts).
// main.ts awaits a module's entry right before its init; the module takes it or builds as usual.
// A failed or missing entry is null: the module then builds it itself.
import type { TerrainPrebuilt } from '../city/loadLayout';

/** What the city worker can build, by module name. */
export interface Prebuilt {
  terrain: TerrainPrebuilt;
}
const pending = new Map<string, Promise<unknown>>();
const ready = new Map<string, unknown>();

export function providePrebuilt<K extends keyof Prebuilt>(
  module: K,
  data: Promise<Prebuilt[K] | null>,
): void {
  pending.set(
    module,
    data.then(
      (v) => {
        if (v != null) ready.set(module, v);
      },
      () => {},
    ),
  );
}

/** Resolves once the module's entry (if any) has arrived or failed. */
export function awaitPrebuilt(module: string): Promise<unknown> {
  return pending.get(module) ?? Promise.resolve();
}

/** The module's entry, once: a second init builds by itself. */
export function takePrebuilt<K extends keyof Prebuilt>(module: K): Prebuilt[K] | null {
  const v = ready.get(module);
  ready.delete(module);
  return (v as Prebuilt[K] | undefined) ?? null;
}
