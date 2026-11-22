import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Viewer · Signora PDF playground',
    loadComponent: () => import('./pages/viewer-demo').then((m) => m.ViewerDemo),
  },
  {
    path: 'custom-templates',
    title: 'Custom templates · Signora PDF playground',
    loadComponent: () => import('./pages/custom-templates-demo').then((m) => m.CustomTemplatesDemo),
  },
  {
    path: 'digital-signing',
    title: 'Digital signing · Signora PDF playground',
    loadComponent: () => import('./pages/digital-signing-demo').then((m) => m.DigitalSigningDemo),
  },
  { path: '**', redirectTo: '' },
];
