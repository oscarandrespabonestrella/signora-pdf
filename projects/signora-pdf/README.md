# signora-pdf

Modular, extensible and themeable Angular SDK for viewing and signing PDF documents.

> **Alpha.** The viewer, coordinate model and extension points are available; signature creation,
> placement, export and digital signing are on the roadmap.

> **Using an AI coding agent?** Point it at `node_modules/signora-pdf/AGENTS.md`: one compact file
> with the whole API and recipes, so it does not need to explore the package.

```bash
npm install signora-pdf pdfjs-dist
```

```ts
provideSignora(withPdfJsRenderer({ workerSrc: '/assets/pdfjs/pdf.worker.min.mjs' }));
```

```html
<signora-viewer [source]="url" />
```

| Entry point           | Contains                                         |
| --------------------- | ------------------------------------------------ |
| `signora-pdf`         | models, ports, coordinates, `SigningSession`, DI |
| `signora-pdf/pdfjs`   | PDF.js rendering adapter (peer: `pdfjs-dist`)    |
| `signora-pdf/pdf-lib` | pdf-lib writer adapter (peer: `pdf-lib`)         |
| `signora-pdf/ui`      | viewer, toolbar, slots, theme directive          |

Full documentation: https://github.com/oscarandrespabonestrella/signora-pdf#readme

MIT licensed.
