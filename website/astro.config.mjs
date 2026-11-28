// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const repo = 'https://github.com/oscarandrespabonestrella/signora-pdf';

export default defineConfig({
  // The examples read their source from the playground, one level above the site.
  vite: { server: { fs: { allow: ['..'] } } },
  site: 'https://oscarandrespabonestrella.github.io',
  base: '/signora-pdf',
  integrations: [
    starlight({
      title: 'Signora PDF',
      description: 'Angular SDK to view PDFs, place visual signatures and add digital signatures.',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        es: { label: 'Español', lang: 'es' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/website/` },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Getting started',
          translations: { es: 'Primeros pasos' },
          items: [
            { slug: 'getting-started/installation' },
            { slug: 'getting-started/quick-start' },
          ],
        },
        {
          label: 'Guides',
          translations: { es: 'Guías' },
          items: [
            { slug: 'guides/viewer-options' },
            { slug: 'guides/theming' },
            { slug: 'guides/digital-signing' },
            { slug: 'guides/incremental-signing' },
            { slug: 'guides/signature-fields' },
            { slug: 'guides/validation' },
          ],
        },
        {
          label: 'Concepts',
          translations: { es: 'Conceptos' },
          items: [{ slug: 'concepts/architecture' }, { slug: 'concepts/coordinates' }],
        },
        {
          label: 'Examples',
          translations: { es: 'Ejemplos' },
          items: [
            { slug: 'examples/viewer' },
            { slug: 'examples/signatures' },
            { slug: 'examples/fields' },
            { slug: 'examples/pdf-fields' },
            { slug: 'examples/export' },
            { slug: 'examples/incremental' },
            { slug: 'examples/validation' },
            { slug: 'examples/theming' },
          ],
        },
        { slug: 'demos' },
        {
          label: 'Reference',
          translations: { es: 'Referencia' },
          items: [
            {
              label: 'API reference (TypeDoc)',
              translations: { es: 'Referencia de la API (TypeDoc)' },
              link: '/api/',
              attrs: { target: '_blank' },
            },
          ],
        },
      ],
    }),
  ],
});
