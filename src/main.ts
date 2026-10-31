import './styles/global.css';
import { Router } from './app/core/router.ts';
import { screens } from './app/screens.ts';
import { applyStoredTheme } from './app/theme.ts';
import './app/components/app-nav/app-nav.ts';
import { routeSignInReturn } from './app/openrouter.ts';

applyStoredTheme();

const outlet = document.querySelector<HTMLElement>('#router-outlet');
if (!outlet) throw new Error('index.html has no #router-outlet');

// Back from signing in at OpenRouter? Open Settings, which finishes it.
routeSignInReturn();
const router = new Router(outlet, import.meta.env.BASE_URL, 'GSSK Studio').register(screens);
void router.render();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // NFR-STO-005: works offline after first load.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err: unknown) => {
      console.warn('Service worker registration failed', err);
    });
  });
}
