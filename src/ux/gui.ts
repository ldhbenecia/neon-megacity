// lil-gui is the developer panel (?debug only). Without it, modules still call
// ctx.gui.addFolder(...).add(...).name(...)... so they get a chainable no-op stand-in, and the
// library stays out of the first chunk (a dynamic import, fetched only with ?debug).
import type GUI from 'lil-gui';

/** Every property read and every call returns the stub itself; `then` is absent so it is not a thenable. */
export function stubGui(): GUI {
  const stub: object = new Proxy(function stub() {}, {
    get: (_target, key) => (key === 'then' ? undefined : stub),
    apply: () => stub,
  });
  // Cast: the proxy answers every lil-gui method the modules call (addFolder, add, name, onChange,
  // listen, disable, close, destroy, hide); none of them reads a value back.
  return stub as GUI;
}

export async function createGui(enabled: boolean): Promise<GUI> {
  if (!enabled) return stubGui();
  const { default: LilGui } = await import('lil-gui');
  return new LilGui({ title: 'City Controls' });
}
