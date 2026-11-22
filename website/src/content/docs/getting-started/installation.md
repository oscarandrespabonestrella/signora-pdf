---
title: Installation
description: Install signora-pdf and its optional PDF engines in an Angular application.
---

Signora PDF requires **Angular 22+**.

```bash
npm install signora-pdf pdfjs-dist
# only if you want to export the PDF with the signatures embedded:
npm install pdf-lib
```

`pdfjs-dist` and `pdf-lib` are **optional peer dependencies**: install only what you use, or
implement the ports with another engine.

| Entry point           | Contains                                                      | Needs              |
| --------------------- | ------------------------------------------------------------- | ------------------ |
| `signora-pdf`         | models, ports, coordinates, `SigningSession`, DI              | Angular only       |
| `signora-pdf/pdfjs`   | PDF.js implementation of the rendering port                   | `pdfjs-dist`       |
| `signora-pdf/pdf-lib` | pdf-lib implementation of the writer port                     | `pdf-lib`          |
| `signora-pdf/ui`      | viewer, page, toolbar, signature panel, theme directive       | core               |
| `signora-pdf/http`    | HTTP digital signature and certificate providers              | core, `HttpClient` |

## Serve the PDF.js worker

Your application must serve the PDF.js worker. With an asset glob in `angular.json`:

```json
{
  "glob": "pdf.worker.min.mjs",
  "input": "node_modules/pdfjs-dist/build",
  "output": "assets/pdfjs"
}
```

Then pass its URL to `withPdfJsRenderer({ workerSrc })`, as shown in the [quick start](../quick-start/).
