import { defineConfig, devices } from '@playwright/test';
import { SWIFTSHADER_ARGS } from './tests/e2e/helpers';

// E2E_PORT lets several local worktrees run e2e at the same time.
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: process.env.CI ? 360_000 : 90_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: process.env.CI ? { width: 960, height: 540 } : { width: 1280, height: 720 },
    trace: 'retain-on-failure',
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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
