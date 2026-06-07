import './tests/e2e/support/utils/load-env';
import { defineConfig, devices } from '@playwright/test';

const isCi = !!process.env.CI;

/**
 * One Playwright project so UI / HTML report “run all” includes every spec (guest + wallet chain).
 * Wallet specs share a worker-scoped WC fixture — use a single worker and no file-parallelism so
 * `trade/*` and `transfer/*` stay one session in order.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: isCi ? 2 : 0,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never', host: '127.0.0.1' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
  ],

  use: {
    /** Visible Chrome only when `PW_HEADED=1` (e.g. `npm run test:e2e:headed`). Default: headless. */
    headless: process.env.PW_HEADED !== '1',
    baseURL: process.env.APP_URL ?? 'https://near.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'e2e',
      testMatch: '**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
