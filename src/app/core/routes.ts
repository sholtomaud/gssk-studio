/** Route matching, kept free of DOM access so it is unit-testable. */
export interface RouteDef {
  path: string;
  component: string;
  title: string;
  /** Static properties assigned to the component element. */
  props?: Record<string, unknown>;
}

export interface CompiledRoute extends RouteDef {
  regex: RegExp;
  paramNames: string[];
}

export interface RouteMatch {
  route: CompiledRoute;
  params: Record<string, string>;
}

export function compileRoute(def: RouteDef): CompiledRoute {
  const path = def.path.startsWith('/') ? def.path : `/${def.path}`;
  const paramNames: string[] = [];
  const source = path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { ...def, path, regex: new RegExp(`^${source}/?$`), paramNames };
}

export function matchRoute(routes: readonly CompiledRoute[], path: string): RouteMatch | null {
  for (const route of routes) {
    const m = route.regex.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1] ?? '')));
      return { route, params };
    }
  }
  return null;
}

/**
 * The app path for a pathname under a base URL, e.g. ('/budget-app/ledger',
 * '/budget-app/') → '/ledger'.
 */
export function appPath(pathname: string, base: string): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  if (b !== '/' && (pathname === b.slice(0, -1) || pathname.startsWith(b))) {
    return `/${pathname.slice(b.length)}`;
  }
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

export function publicPath(path: string, base: string): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  return b + path.replace(/^\/+/, '');
}
