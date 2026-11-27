import { defineConfig, devices } from '@playwright/test';
import { SWIFTSHADER_ARGS, localPort } from './tests/e2e/helpers';

const PORT = localPort('e2e');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: process.env.CI ? 360_000 : 90_000,
  // UI text (clock, HUD) updates in the frame loop; one SwiftShader frame on a CI runner can take
  // seconds, so the 5 s default is too tight there.
  expect: { timeout: process.env.CI ? 30_000 : 5_000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: process.env.CI ? { width: 960, height: 540 } : { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    // Skips the cosmetic boot motion (dolly-in, idle cinematic, long power ramp and loader fade):
    // several seconds per boot in SwiftShader. The boot-skeleton test opts back in. Not covered
    // by e2e on purpose: input during the boot dolly-in (only ~0.3 s of it is left after the
    // overlay goes on a fast machine, so a test would race it).
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Software WebGL so the tests run on GPU-less CI runners.
        launchOptions: { args: SWIFTSHADER_ARGS },
      },
    },
  ],
  webServer: {
    // CI runs `npm run build` in an earlier step, so only serve the existing dist/ there.
    command: `${process.env.CI ? '' : 'npx vite build && '}npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    // Never reuse: a server already on this port may be another worktree's build.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
