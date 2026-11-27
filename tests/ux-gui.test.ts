import { describe, expect, it } from 'vitest';
import { createGui, stubGui } from '../src/ux/gui';

describe('stubGui', () => {
  it('answers the chains the modules use and does nothing', () => {
    const gui = stubGui();
    const params = { on: true };
    const folder = gui.addFolder('Atmosphere');
    folder
      .add(params, 'on')
      .name('On')
      .onChange(() => (params.on = false))
      .listen()
      .disable();
    folder.close();
    folder.destroy();
    gui.hide();
    expect(params.on).toBe(true);
  });

  it('is not a thenable, so awaiting it resolves to the stub', async () => {
    const gui = await createGui(false);
    expect(typeof (gui as unknown as { then?: unknown }).then).toBe('undefined');
    expect(() => gui.addFolder('x')).not.toThrow();
  });
});
