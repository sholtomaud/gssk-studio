import { describe, expect, test } from 'vitest';
import { appPath, compileRoute, matchRoute, publicPath } from '../../src/app/core/routes.ts';

describe('routes', () => {
  const routes = [
    { path: '/', component: 'library-page', title: 'Models' },
    { path: '/kernel', component: 'kernel-page', title: 'Kernel' },
    { path: '/model/:id', component: 'studio-page', title: 'Studio' },
  ].map(compileRoute);

  test('matches static paths, with or without a trailing slash', () => {
    expect(matchRoute(routes, '/')?.route.component).toBe('library-page');
    expect(matchRoute(routes, '/kernel')?.route.component).toBe('kernel-page');
    expect(matchRoute(routes, '/kernel/')?.route.component).toBe('kernel-page');
  });

  test('extracts and decodes params', () => {
    const m = matchRoute(routes, '/model/rent%20vs%20buy');
    expect(m?.route.component).toBe('studio-page');
    expect(m?.params).toEqual({ id: 'rent vs buy' });
  });

  test('returns null for unknown paths', () => {
    expect(matchRoute(routes, '/nope')).toBe(null);
    expect(matchRoute(routes, '/kernelx')).toBe(null);
  });

  test('escapes regex characters in static segments', () => {
    const [r] = [compileRoute({ path: '/a.b', component: 'x', title: 'x' })];
    expect(matchRoute([r!], '/axb')).toBe(null);
    expect(matchRoute([r!], '/a.b')?.route.component).toBe('x');
  });

  test('maps between public paths and app paths under a base', () => {
    expect(appPath('/gssk-studio/kernel', '/gssk-studio/')).toBe('/kernel');
    expect(appPath('/gssk-studio/', '/gssk-studio/')).toBe('/');
    expect(appPath('/gssk-studio', '/gssk-studio/')).toBe('/');
    expect(appPath('/kernel', '/')).toBe('/kernel');
    expect(publicPath('/kernel', '/gssk-studio/')).toBe('/gssk-studio/kernel');
    expect(publicPath('/', '/')).toBe('/');
  });
});
