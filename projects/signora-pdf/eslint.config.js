// @ts-check
const { defineConfig } = require('eslint/config');
const rootConfig = require('../../eslint.config.js');

module.exports = defineConfig([
  ...rootConfig,
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'signora',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'signora',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    // Architectural boundary: the core entry point and the UI entry point
    // must never import the rendering/writing engines directly.
    files: ['src/**/*.ts', 'ui/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['pdfjs-dist', 'pdfjs-dist/*', 'pdf-lib', 'pdf-lib/*'],
              message:
                'Core and UI must not depend on PDF.js or pdf-lib. Use the ports and put adapters in signora-pdf/pdfjs or signora-pdf/pdf-lib.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    rules: {},
  },
]);
