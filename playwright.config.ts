// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, devices } from '@playwright/test';

const PORT = 8123;
const E2E_DATABASE_URL = `${process.env.DATABASE_URL ?? 'postgresql://klui:klui@127.0.0.1:5432/klui_test'}${
  (process.env.DATABASE_URL ?? '').includes('?') ? '&' : '?'
}schema=e2e`;

/**
 * Browser tests run against the BUILT server on its own port (D-52): the Vite
 * dev server is cross-origin, and every cookie test would fail for the wrong
 * reason. `npm run test:e2e` builds, resets the e2e schema, then runs this.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node server/dist/server.js',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'test',
      KLUI_ENV: 'development',
      KLUI_PORT: String(PORT),
      KLUI_LOG_LEVEL: 'warn',
      KLUI_SECRETS_DIR: '/tmp/klui-e2e-secrets',
      // Explicit, so an inherited .env or shell variable cannot make the CSRF
      // origin check compare the browser's origin with a different host.
      KLUI_PUBLIC_URL: `http://127.0.0.1:${PORT}`,
      DATABASE_URL: E2E_DATABASE_URL,
    },
  },
});
