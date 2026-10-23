/** The app's screens (SPEC §12). Each component loads on first visit. */
import type { RouteDef } from './core/routes.ts';

export const screens: RouteDef[] = [
  { path: '/', component: 'library-page', title: 'Models' },
  { path: '/model/:id', component: 'studio-page', title: 'Studio' },
  { path: '/kernel', component: 'kernel-page', title: 'Kernel' },
];
