// Data a module would otherwise build in its init, made off the main thread at boot (src/boot.ts).
// main.ts awaits a module's entry right before its init; the module takes it or builds as usual.
// An entry is used only with the layout it was built from; a failed or missing one is null and
// the module then builds it itself.
import type { BuildingsPrebuilt, TerrainPrebuilt } from '../city/loadLayout';
import type { Layout } from '../city/types';

/** What the city worker can build, by module name. */
export interface Prebuilt {
  terrain: TerrainPrebuilt;
  buildings: BuildingsPrebuilt;
}

const pending = new Map<string, Promise<unknown>>();
const ready = new Map<string, { value: unknown; layout: Layout }>();

export function providePrebuilt<K extends keyof Prebuilt>(
  module: K,
  data: Promise<Prebuilt[K] | null>,
  layout: Promise<Layout>,
): void {
  pending.set(
    module,
    Promise.all([data, layout]).then(
      ([value, l]) => {
        if (value != null) ready.set(module, { value, layout: l });
      },
      () => {},
    ),
  );
}

/** Resolves once the module's entry (if any) has arrived or failed. */
export function awaitPrebuilt(module: string): Promise<unknown> {
  return pending.get(module) ?? Promise.resolve();
}

/** The module's entry, once and only for `layout`: a second init builds by itself. */
export function takePrebuilt<K extends keyof Prebuilt>(
  module: K,
  layout: Layout,
): Prebuilt[K] | null {
  const e = ready.get(module);
  ready.delete(module);
  return e && e.layout === layout ? (e.value as Prebuilt[K]) : null;
}
