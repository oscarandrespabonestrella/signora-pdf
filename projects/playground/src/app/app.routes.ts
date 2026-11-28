import { Type } from '@angular/core';
import { Routes } from '@angular/router';

/** Single-feature examples. Their source is shown next to each demo in the documentation. */
const EXAMPLES: Record<string, () => Promise<Type<unknown>>> = {
  basic: () => import('./examples/basic').then((m) => m.BasicExample),
  continuous: () => import('./examples/continuous').then((m) => m.ContinuousExample),
  'read-only': () => import('./examples/read-only').then((m) => m.ReadOnlyExample),
  'signature-modes': () =>
    import('./examples/signature-modes').then((m) => m.SignatureModesExample),
  preloaded: () => import('./examples/preloaded').then((m) => m.PreloadedExample),
  fields: () => import('./examples/fields').then((m) => m.FieldsExample),
  'fields-editor': () => import('./examples/fields-editor').then((m) => m.FieldsEditorExample),
  coordinates: () => import('./examples/coordinates').then((m) => m.CoordinatesExample),
  'export-pdf': () => import('./examples/export-pdf').then((m) => m.ExportPdfExample),
  'pdf-signature-fields': () =>
    import('./examples/pdf-signature-fields').then((m) => m.PdfSignatureFieldsExample),
  'append-signature': () =>
    import('./examples/append-signature').then((m) => m.AppendSignatureExample),
  'validate-signatures': () =>
    import('./examples/validate-signatures').then((m) => m.ValidateSignaturesExample),
  theme: () => import('./examples/theme').then((m) => m.ThemeExample),
  'custom-toolbar': () => import('./examples/custom-toolbar').then((m) => m.CustomToolbarExample),
};

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
  ...Object.entries(EXAMPLES).map(([name, loadComponent]) => ({
    path: `examples/${name}`,
    title: `${name} · Signora PDF example`,
    loadComponent,
  })),
  { path: '**', redirectTo: '' },
];
