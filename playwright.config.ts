import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config();

const ENV = (process.env.BASE_ENV ?? 'dev') as 'dev' | 'prod';

const BASE_URLS: Record<'dev' | 'prod', string> = {
  dev:  'https://devapp.paxel.ai',
  prod: 'https://app.paxel.ai', // TODO: Confirm exact PROD base URL before running prod suite
};

export default defineConfig({
  testDir: './tests',

  // Global timeout per test (60s for heavy dashboard loads)
  timeout: 60_000,

  // Retry once on failure; retry twice in CI
  retries: process.env.CI ? 2 : 1,

  // IMPORTANT: workers=1 — tests must run sequentially per QA execution order rule
  workers: 1,

  reporter: [
    ['list'],
    ['html',  { outputFolder: 'playwright-report', open: 'never' }],
    ['json',  { outputFile: 'dashboard/qa-results.json' }],
  ],

  use: {
    baseURL:    BASE_URLS[ENV],
    // When running via the dashboard (HEADLESS=1 is set by server.js), run hidden
    // so the left panel is the only view. Otherwise show the browser for local dev.
    headless:   process.env.HEADLESS === '1',
    screenshot: 'only-on-failure',
    video:      'retain-on-failure',
    trace:      'on-first-retry',
    viewport:   { width: 1440, height: 900 },

    launchOptions: {
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-features=Translate,AutomationControlled',
      '--homepage=about:blank',
      '--incognito',
    ],
  },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
