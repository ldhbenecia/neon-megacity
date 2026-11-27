// lil-gui is the developer panel (?debug only). Without it, modules still call
// ctx.gui.addFolder(...).add(...).name(...)... so they get a chainable no-op stand-in, and the
// library stays out of the first chunk (a dynamic import, fetched only with ?debug).
import type GUI from 'lil-gui';

/** Lists a module might iterate: empty instead of the stub, so loops do nothing. */
const LISTS = new Set<PropertyKey>([
  'children',
  'controllers',
  'folders',
  'controllersRecursive',
  'foldersRecursive',
]);

/**
 * Every property read and every call returns the stub itself. Exceptions: `then` (so it is not a
 * thenable), string conversion ('[gui stub]'), other symbols, and the child lists above.
 */
export function stubGui(): GUI {
  const stub: object = new Proxy(function stub() {}, {
    get: (_target, key) => {
      if (key === 'then') return undefined;
      if (key === 'toString' || key === Symbol.toPrimitive) return () => '[gui stub]';
      if (typeof key === 'symbol') return undefined;
      if (LISTS.has(key)) return [];
      return stub;
    },
    apply: () => stub,
  });
  // Cast: the proxy answers every lil-gui method the modules call (addFolder, add, name, onChange,
  // listen, disable, close, destroy, hide); none of them reads a value back.
  return stub as GUI;
}

export async function createGui(enabled: boolean): Promise<GUI> {
  if (!enabled) return stubGui();
  try {
    const { default: LilGui } = await import('lil-gui');
    return new LilGui({ title: 'City Controls' });
  } catch (err) {
    // A missing panel must never stop the city from booting.
    console.warn('[debug] lil-gui failed to load; continuing without the panel', err);
    return stubGui();
  }
}
