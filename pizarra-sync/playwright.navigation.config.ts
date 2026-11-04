import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Exercise the minified production bundle, with a local Worker and no real accounts.
export default defineConfig({
  ...base,
  testMatch: 'navigation-performance.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { ...base.use, trace: 'retain-on-failure' },
  webServer: [
    { command: 'pnpm --filter @komuboard/worker dev', url: 'http://127.0.0.1:8787/health', timeout: 120_000, reuseExistingServer: false, env: { WRANGLER_SEND_METRICS: 'false' } },
    { command: 'pnpm --filter @komuboard/client-web preview', url: 'http://127.0.0.1:5173', timeout: 60_000, reuseExistingServer: false },
  ],
});
