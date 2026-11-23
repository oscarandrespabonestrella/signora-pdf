# Signora PDF

> A modular, extensible and themeable Angular SDK for viewing and signing PDF documents.

[![CI](https://github.com/oscarandrespabonestrella/signora-pdf/actions/workflows/ci.yml/badge.svg)](https://github.com/oscarandrespabonestrella/signora-pdf/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/signora-pdf?label=npm&color=cb3837)](https://www.npmjs.com/package/signora-pdf)
[![Docs](https://github.com/oscarandrespabonestrella/signora-pdf/actions/workflows/docs.yml/badge.svg)](https://oscarandrespabonestrella.github.io/signora-pdf/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[Documentation](https://oscarandrespabonestrella.github.io/signora-pdf/)** · **[Live demo](https://oscarandrespabonestrella.github.io/signora-pdf/demos/)** ·
**[API reference](https://oscarandrespabonestrella.github.io/signora-pdf/api/)** · **[npm](https://www.npmjs.com/package/signora-pdf)** ·
[Documentación en español](https://oscarandrespabonestrella.github.io/signora-pdf/es/)

**Status: `0.1.0-alpha`.** The architecture, the public API of the core and the viewer are in
place, you can create and place visual signatures, export the result as a new PDF, and hand it
to a signing backend for a digital signature ([docs](docs/digital-signing.md)). The library does
not ship a backend or any cryptography. The API may change before `1.0`.

![Signing a contract in the playground: a hand-drawn signature on the signature line and an organization stamp, with the signature panel on the right](docs/images/viewer-signing.png)

<table>
  <tr>
    <td width="50%"><img src="docs/images/theme-midnight.png" alt="The same viewer with a dark theme; the drawing pad stays white so ink is visible"><br><sub><b>Theming</b> with CSS variables: a dark preset.</sub></td>
    <td width="50%"><img src="docs/images/theme-editor.png" alt="The live theme editor open on a rounded theme with a purple accent, showing the generated CSS"><br><sub><b>Live theme editor</b> that generates the CSS to paste.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/rotated-page.png" alt="A page that has its own 90 degree rotation, with a signature placed upright"><br><sub>Pages with their own <code>/Rotate</code>: placements stay put and upright.</sub></td>
    <td><img src="docs/images/export-preview.png" alt="Preview of the exported PDF with the stamp embedded"><br><sub>Export and preview of the real result.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/custom-templates.png" alt="The viewer with an application-defined toolbar"><br><sub>Replace any section with your own template.</sub></td>
    <td><img src="docs/images/digital-signing.png" alt="The digital signing page showing a simulated result clearly labelled as not digitally signed"><br><sub>Digital signing through a provider; the simulated one says it is <b>not</b> signed.</sub></td>
  </tr>
</table>

## What works today

| Area                                                                              | State                               |
| --------------------------------------------------------------------------------- | ----------------------------------- |
| PDF viewer (PDF.js): load from URL, Blob, ArrayBuffer                             | ✅                                  |
| Page navigation, zoom, rotation, keyboard shortcuts                               | ✅                                  |
| Normalized coordinate model (zoom, rotation, `/Rotate`, CropBox)                  | ✅                                  |
| Headless `SigningSession` (signals) + ports for every engine                      | ✅                                  |
| Theming with `--signora-*` design tokens, template slots                          | ✅                                  |
| Signature creation: draw (mouse, touch, stylus), type, upload, organization       | ✅                                  |
| Drag, resize, keyboard and drag-and-drop placement; multiple signatures and pages | ✅                                  |
| Visual export with pdf-lib (`session.exportPdf()`), CropBox and `/Rotate` aware   | ✅                                  |
| Digital signing through your backend (HTTP provider, PAdES levels as metadata)    | ✅ client side; the server is yours |

## Design in one minute

The SDK is split in entry points so that dependencies are enforced by packaging, not discipline:

| Entry point           | Contains                                                      | Depends on         |
| --------------------- | ------------------------------------------------------------- | ------------------ |
| `signora-pdf`         | models, ports (interfaces), coordinates, `SigningSession`, DI | Angular only       |
| `signora-pdf/pdfjs`   | PDF.js implementation of the rendering port                   | `pdfjs-dist`       |
| `signora-pdf/pdf-lib` | pdf-lib implementation of the writer port                     | `pdf-lib`          |
| `signora-pdf/ui`      | viewer, page, toolbar, template slots, theme directive        | core               |
| `signora-pdf/http`    | HTTP digital signature and certificate providers              | core, `HttpClient` |

`pdfjs-dist` and `pdf-lib` are **optional peer dependencies**: install only what you use, or
implement the ports with another engine. Cryptographic signing is deliberately separate from
visual signing, and the library never implements cryptography itself.
Read [docs/architecture.md](docs/architecture.md) for details.

## Installation

```bash
npm install signora-pdf pdfjs-dist
# for visual export:
npm install pdf-lib
```

Requires Angular 22+. Step-by-step setup: [Installation](https://oscarandrespabonestrella.github.io/signora-pdf/getting-started/installation/)
and [Quick start](https://oscarandrespabonestrella.github.io/signora-pdf/getting-started/quick-start/).

Serve the PDF.js worker from your app, for example with an asset glob in `angular.json`:

```json
{
  "glob": "pdf.worker.min.mjs",
  "input": "node_modules/pdfjs-dist/build",
  "output": "assets/pdfjs"
}
```

## Usage

```ts
// app.config.ts
import { provideSignora } from 'signora-pdf';
import { withPdfJsRenderer } from 'signora-pdf/pdfjs';

export const appConfig: ApplicationConfig = {
  providers: [provideSignora(withPdfJsRenderer({ workerSrc: '/assets/pdfjs/pdf.worker.min.mjs' }))],
};
```

```ts
import { Component } from '@angular/core';
import { SignoraViewerComponent } from 'signora-pdf/ui';

@Component({
  imports: [SignoraViewerComponent],
  template: `<signora-viewer [source]="'/files/contract.pdf'" style="height: 80vh" />`,
})
export class ContractPage {}
```

`source` accepts a URL string, `URL`, `Blob`/`File`, `ArrayBuffer` or `Uint8Array`.

### Customize without forking

Theme with CSS variables, on any ancestor or through the directive:

```html
<signora-viewer [signoraTheme]="{ 'color-accent': '#e11d48', radius: '999px' }" />
```

Replace sections with your own templates:

```html
<signora-viewer [source]="url">
  <ng-template signoraSlot="toolbar" let-session>
    <button (click)="session.previousPage()">Back</button>
    {{ session.currentPage() }} / {{ session.pageCount() }}
    <button (click)="session.nextPage()">Next</button>
  </ng-template>
</signora-viewer>
```

See [docs/theming.md](docs/theming.md) for the full token list.

### Options

`viewMode="continuous"` shows all pages in one scroll; `[signatureModes]` turns draw, type,
upload and provider tabs on or off; `[preloadedSignatures]` makes several signatures available
from the start; `(coordinatesChange)` / `session.exportCoordinates()` return just the positions for a
backend that stamps the PDF itself; `[readOnly]` shows signatures without editing. See [docs/viewer-options.md](docs/viewer-options.md).

### Headless

Skip `signora-pdf/ui` and build your own interface on `SigningSession` and the pure functions in
`signora-pdf` (`toViewportRect`, `fromViewportRect`, `toPdfUserSpace`...). Placements are stored
in normalized page coordinates, independent of zoom and rotation; see
[docs/coordinates.md](docs/coordinates.md).

## Documentation

- **For AI agents and LLMs:** [`llms.txt`](llms.txt) and [`llms-full.txt`](llms-full.txt), a single
  compact guide with every input, method and recipe. It also ships in the package as
  `node_modules/signora-pdf/AGENTS.md`, so a coding agent can read it instead of exploring the
  source. Regenerate with `npm run docs:ai`; CI checks it stays complete.
- **[Documentation site](https://oscarandrespabonestrella.github.io/signora-pdf/)** (English and Spanish): guides, live examples with their source,
  and the [demos](https://oscarandrespabonestrella.github.io/signora-pdf/demos/).
- [Architecture](docs/architecture.md) · [Coordinates](docs/coordinates.md) · [Theming](docs/theming.md) · [Viewer options](docs/viewer-options.md)
  · [Digital signing](docs/digital-signing.md) · [Roadmap](docs/roadmap.md)
- **[API reference](https://oscarandrespabonestrella.github.io/signora-pdf/api/)**, generated from the source with TypeDoc. Locally:
  `npm run docs:api`, then open `docs/api/index.html`.

## Develop

```bash
npm install
npm start               # playground at http://localhost:4200
npm test                # unit tests (Vitest)
npm run lint
npm run build:lib       # builds dist/signora-pdf
npm run docs:api        # generates the API reference in docs/api
npm run screenshots     # recaptures docs/images (needs npm start running and Edge/Chrome)
npm run pack:lib        # builds and creates the npm tarball in dist/
npm run docs:site       # builds the documentation site into website/dist
```

## Release

1. Bump `version` in `projects/signora-pdf/package.json` and update [CHANGELOG.md](CHANGELOG.md).
2. Merge to `main`, then tag it: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. Run the **Release** workflow from the tag: `gh workflow run release.yml --ref vX.Y.Z`.

The workflow publishes with npm [trusted publishing](https://docs.npmjs.com/trusted-publishers)
and provenance, no token needed. Versions with a pre-release suffix (`-alpha.1`) go to the `next`
dist-tag; the rest go to `latest`. The documentation site deploys on every push to `main`.

The playground consumes the library only through its public API (`signora-pdf/*`).
See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
