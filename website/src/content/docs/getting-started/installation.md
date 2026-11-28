---
title: Installation
description: Install signora-pdf from npm and serve the PDF.js worker in an Angular application.
---

[`signora-pdf`](https://www.npmjs.com/package/signora-pdf) is published on npm. It requires
**Angular 22+**.

:::caution[Alpha]
The API may change before `1.0`. Pin the exact version in `package.json` while it is in alpha.
:::

## 1. Install the packages

```bash
npm install signora-pdf pdfjs-dist
```

Add pdf-lib only if you want to export the PDF with the signatures embedded in the browser:

```bash
npm install pdf-lib
```

To inspect and validate the signatures a PDF already has (`signora-pdf/validation`), add PKI.js too:

```bash
npm install pdf-lib pkijs asn1js
```

`pdfjs-dist`, `pdf-lib`, `pkijs` and `asn1js` are **optional peer dependencies**: install only what you use, or
implement the ports with another engine. Each engine lives in its own entry point, so an engine
you do not import never ends up in your bundle.

| Entry point           | Contains                                                | Needs              |
| --------------------- | ------------------------------------------------------- | ------------------ |
| `signora-pdf`         | models, ports, coordinates, `SigningSession`, DI        | Angular only       |
| `signora-pdf/pdfjs`   | PDF.js implementation of the rendering port             | `pdfjs-dist`       |
| `signora-pdf/pdf-lib` | pdf-lib writer, incremental updates, fields, DSS        | `pdf-lib`          |
| `signora-pdf/ui`      | viewer, page, toolbar, signature panel, theme directive | core               |
| `signora-pdf/http`    | HTTP digital signature and certificate providers        | core, `HttpClient` |
| `signora-pdf/validation` | inspect and verify existing signatures, reports | `pdf-lib`, `pkijs`, `asn1js` |

## 2. Serve the PDF.js worker

PDF.js parses documents in a web worker that your application must serve. Add an asset glob to
your app's build options in `angular.json` (`projects.<your-app>.architect.build.options.assets`):

```json title="angular.json"
"assets": [
  { "glob": "**/*", "input": "public" },
  {
    "glob": "pdf.worker.min.mjs",
    "input": "node_modules/pdfjs-dist/build",
    "output": "assets/pdfjs"
  }
]
```

After `ng serve`, `http://localhost:4200/assets/pdfjs/pdf.worker.min.mjs` should load. You pass
that URL to `withPdfJsRenderer({ workerSrc })` in the [quick start](../quick-start/).

:::tip[Using an AI coding agent?]
The package ships a compact guide with the whole API at `node_modules/signora-pdf/AGENTS.md`.
Point your agent at it instead of letting it explore the source.
:::

## Troubleshooting

- **`Setting up fake worker failed` or a 404 for `pdf.worker.min.mjs`**: the asset glob is missing
  or `workerSrc` does not match its output path. If your app is served under a sub-path, include it
  (for example `/my-app/assets/pdfjs/pdf.worker.min.mjs`).
- **The viewer is empty or zero pixels tall**: `<signora-viewer>` fills its container. Give it, or
  its parent, a height such as `height: 80vh`.
- **`no PDF writer is registered`** when exporting: add `withPdfLibWriter()` to `provideSignora()`
  and install `pdf-lib`.
