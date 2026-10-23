/**
 * Client-side router, after Boba. History API; screens are custom elements
 * loaded on demand from src/app/components/<tag>/<tag>.ts.
 */
import {
  appPath,
  compileRoute,
  matchRoute,
  publicPath,
  type CompiledRoute,
  type RouteDef,
} from './routes.ts';

const loaders = import.meta.glob<unknown>('../components/*-page/*-page.ts');

/** Fired on window after each navigation; detail is the matched route path. */
export const ROUTE_EVENT = 'app:route';

let active: Router | null = null;

/** Session flag: the path we reloaded for, so a screen that can't load reloads only once. */
const RELOADED = 'gssk-studio-route-reloaded';

/** Navigate to an app path from anywhere (e.g. after an action completes). */
export function navigate(path: string): void {
  active?.navigate(path);
}

export class Router {
  private readonly routes: CompiledRoute[] = [];
  private readonly outlet: HTMLElement;
  private readonly base: string;
  private readonly appTitle: string;
  current = '';
  /** Each render's number: a slower, older one never replaces a newer screen. */
  private seq = 0;

  constructor(outlet: HTMLElement, base: string, appTitle: string) {
    this.outlet = outlet;
    this.base = base;
    this.appTitle = appTitle;
    active = this;
    window.addEventListener('popstate', () => void this.render());
    document.addEventListener('click', (e) => this.interceptLink(e));
  }

  register(defs: RouteDef[]): this {
    for (const d of defs) this.routes.push(compileRoute(d));
    return this;
  }

  href(path: string): string {
    return publicPath(path, this.base);
  }

  navigate(path: string): void {
    const target = this.href(path);
    if (location.pathname !== target) history.pushState({}, '', target);
    void this.render();
  }

  async render(): Promise<void> {
    const mine = ++this.seq;
    const path = appPath(location.pathname, this.base);
    const match = matchRoute(this.routes, path);
    this.current = match?.route.path ?? path;
    window.dispatchEvent(new CustomEvent(ROUTE_EVENT, { detail: this.current }));

    if (!match) {
      this.outlet.replaceChildren(notFound());
      document.title = `Not found · ${this.appTitle}`;
      return;
    }
    const tag = match.route.component;
    if (!customElements.get(tag)) {
      const load = loaders[`../components/${tag}/${tag}.ts`];
      if (!load) throw new Error(`No component module for <${tag}>`);
      try {
        await load();
      } catch (err) {
        if (mine === this.seq) this.loadFailed(path, match.route.title, err);
        return;
      }
    }
    if (mine !== this.seq) return;
    sessionStorage.removeItem(RELOADED);
    const el = document.createElement(tag);
    Object.assign(el, match.route.props ?? {}, { params: match.params });
    this.outlet.replaceChildren(el);
    document.title = `${match.route.title} · ${this.appTitle}`;
    this.outlet.focus({ preventScroll: true });
  }

  /**
   * A screen's code didn't load: usually a new version was deployed since
   * this page loaded, and its files replaced the old ones. Load the page
   * again, once, to get the new version; if that fails too, say so.
   */
  private loadFailed(path: string, title: string, err: unknown): void {
    console.warn(`Could not load the ${title} screen`, err);
    if (sessionStorage.getItem(RELOADED) !== path) {
      sessionStorage.setItem(RELOADED, path);
      location.reload();
      return;
    }
    sessionStorage.removeItem(RELOADED);
    const el = document.createElement('section');
    el.className = 'screen';
    const h = document.createElement('h1');
    h.textContent = `${title} couldn't open`;
    const p = document.createElement('p');
    p.textContent =
      "Its part of the app didn't load. You may be offline, or a new version is on its way. Your data is safe.";
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Reload';
    b.onclick = () => location.reload();
    el.append(h, p, b);
    this.outlet.replaceChildren(el);
    document.title = `${title} · ${this.appTitle}`;
  }

  private interceptLink(e: MouseEvent): void {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const a = (e.target as Element | null)?.closest?.('a[data-route]');
    if (!(a instanceof HTMLAnchorElement)) return;
    e.preventDefault();
    this.navigate(a.dataset.route ?? '/');
  }
}

function notFound(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'screen';
  el.innerHTML = '<h1>Not found</h1><p>No screen at this address.</p>';
  return el;
}
