import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/**
 * Where the app is served. CI sets E2E_BASE to the GitHub Pages path
 * (/<repo>/) and E2E_SITE to the site the `build` job produced, so the
 * tests run against exactly the files that will be deployed. Locally the
 * app is built and served at /.
 */
const BASE = process.env.E2E_BASE ?? '/';
const SITE = process.env.E2E_SITE;
const URL = `http://localhost:${PORT}${BASE}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Tests navigate with relative paths (page.goto('settings')), so they
    // work under any base.
    baseURL: URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // E2E runs against the production build (CSP and the service worker are
    // build-only), served the way GitHub Pages serves it: real 404s, and
    // 404.html for deep links. With E2E_SITE, against that prebuilt site.
    command: SITE
      ? `node scripts/serve-pages.ts ${SITE} ${BASE} ${PORT}`
      : `npm run build && node scripts/serve-pages.ts dist ${BASE} ${PORT}`,
    env: { BASE_PATH: BASE },
    url: URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
