import { defineConfig, devices } from '@playwright/test';
import { SWIFTSHADER_ARGS } from './tests/e2e/helpers';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: { width: 1280, height: 720 },
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
