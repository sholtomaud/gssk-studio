import { BaseComponent, define } from '../../core/base-component.ts';
import { ROUTE_EVENT } from '../../core/router.ts';
import { simWorker } from '../../sim-client.ts';
import { applyTheme, storedTheme, type Theme } from '../../theme.ts';
import { icon } from '../../ui.ts';
import template from './app-nav.html?raw';
import style from './app-nav.css?raw';

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };

export class AppNav extends BaseComponent {
  private readonly onRoute = (e: Event) => this.mark((e as CustomEvent<string>).detail);

  constructor() {
    super(template, style);
  }

  override init(): void {
    window.addEventListener(ROUTE_EVENT, this.onRoute);
    const theme = this.$<HTMLButtonElement>('.theme');
    const show = () => {
      const t = storedTheme();
      theme.replaceChildren(icon(t === 'dark' ? 'moon' : 'sun'));
      theme.title = `Theme: ${t} (switch)`;
    };
    theme.onclick = () => {
      applyTheme(NEXT[storedTheme()]);
      show();
    };
    show();
    const k = this.$('.kstate');
    simWorker()
      .kernelInfo()
      .then((info) => {
        k.textContent = `GSSK ${info.version} · verified`;
        k.classList.add('good');
      })
      .catch((err: unknown) => {
        k.textContent = 'Kernel refused';
        k.classList.add('critical');
        k.title = err instanceof Error ? err.message : String(err);
      });
  }

  override destroy(): void {
    window.removeEventListener(ROUTE_EVENT, this.onRoute);
  }

  private mark(path: string): void {
    for (const a of this.querySelectorAll<HTMLAnchorElement>('.links a')) {
      const m = a.dataset.match ?? '';
      const current = m === '/' ? path === '/' || path.startsWith('/model') : path.startsWith(m);
      if (current) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }
}

define('app-nav', AppNav);
