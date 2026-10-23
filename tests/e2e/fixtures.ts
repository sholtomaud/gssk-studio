/**
 * The e2e `test`, with a guard on every page: a test fails if the app's own
 * origin answers any request with an error status (a missing asset such as
 * favicon.svg or /src/main.ts), or if the page throws or logs a console
 * error. Tests that expect one opt out with `allowErrors`.
 */
import { expect, test as base } from '@playwright/test';

export interface PageGuard {
  /** Errors matching any of these are expected in this test. */
  allowErrors: RegExp[];
}

export const test = base.extend<PageGuard & { pageGuard: void }>({
  allowErrors: [[], { option: true }],
  pageGuard: [
    async ({ page, baseURL, allowErrors }, use) => {
      const origin = new URL(baseURL!).origin;
      const problems: string[] = [];
      /** Deep links Pages answered with 404.html (Chrome also logs them as console errors). */
      const deepLinks = new Set<string>();
      const note = (msg: string) => {
        if (!allowErrors.some((re) => re.test(msg))) problems.push(msg);
      };
      page.on('response', (res) => {
        if (res.status() < 400 || new URL(res.url()).origin !== origin) return;
        // GitHub Pages answers a deep link (/<repo>/kernel) with 404.html, the
        // app shell, and status 404: expected for page navigations only.
        if (res.status() === 404 && res.request().isNavigationRequest()) {
          deepLinks.add(res.url());
          return;
        }
        note(`HTTP ${res.status()} ${res.url()}`);
      });
      page.on('pageerror', (err) => note(`Uncaught: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const at = msg.location().url;
        if (deepLinks.has(at) && msg.text().startsWith('Failed to load resource')) return;
        note(`Console error: ${msg.text()} (${at})`);
      });
      await use();
      expect(problems, 'the page loaded everything and logged no errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export type { Page, Route } from '@playwright/test';
