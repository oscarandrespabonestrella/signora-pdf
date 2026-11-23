# signora-pdf

Modular, extensible and themeable Angular SDK to view PDFs, place visual signatures and hand the
result to your backend for a digital signature.

**[Documentation](https://oscarandrespabonestrella.github.io/signora-pdf/)** ·
**[Live demo](https://oscarandrespabonestrella.github.io/signora-pdf/demos/)** ·
**[API reference](https://oscarandrespabonestrella.github.io/signora-pdf/api/)** ·
[GitHub](https://github.com/oscarandrespabonestrella/signora-pdf) ·
[Español](https://oscarandrespabonestrella.github.io/signora-pdf/es/)

> **Alpha.** Viewer, signature creation and placement, export with pdf-lib and the digital signing
> client are in place. The API may change before `1.0`.

> **Using an AI coding agent?** Point it at `node_modules/signora-pdf/AGENTS.md`: one compact file
> with the whole API and recipes, so it does not need to explore the package.

## Install

Requires Angular 22+.

```bash
npm install signora-pdf pdfjs-dist
npm install pdf-lib # only to export the PDF with the signatures embedded
```

Serve the PDF.js worker with an asset glob in `angular.json`:

```json
{ "glob": "pdf.worker.min.mjs", "input": "node_modules/pdfjs-dist/build", "output": "assets/pdfjs" }
```

## Use

```ts
// app.config.ts
import { provideSignora } from 'signora-pdf';
import { withPdfJsRenderer } from 'signora-pdf/pdfjs';
import { withPdfLibWriter } from 'signora-pdf/pdf-lib';

export const appConfig: ApplicationConfig = {
  providers: [
    provideSignora(
      withPdfJsRenderer({ workerSrc: '/assets/pdfjs/pdf.worker.min.mjs' }),
      withPdfLibWriter(),
    ),
  ],
};
```

```ts
import { SignoraViewerComponent } from 'signora-pdf/ui';

@Component({
  imports: [SignoraViewerComponent],
  template: `<signora-viewer [source]="url" [showSignaturePanel]="true" style="height: 80vh" />`,
})
export class ContractPage {
  url = '/files/contract.pdf';
}
```

Then `await inject(SigningSession).exportPdf()` returns the PDF with the signatures embedded. Full
walkthrough: [Quick start](https://oscarandrespabonestrella.github.io/signora-pdf/getting-started/quick-start/).

## Entry points

| Entry point           | Contains                                         | Needs              |
| --------------------- | ------------------------------------------------ | ------------------ |
| `signora-pdf`         | models, ports, coordinates, `SigningSession`, DI | Angular only       |
| `signora-pdf/pdfjs`   | PDF.js rendering adapter                         | `pdfjs-dist`       |
| `signora-pdf/pdf-lib` | pdf-lib writer adapter                           | `pdf-lib`          |
| `signora-pdf/ui`      | viewer, toolbar, signature panel, slots, theming | core               |
| `signora-pdf/http`    | HTTP digital signature and certificate providers | core, `HttpClient` |

MIT licensed.
