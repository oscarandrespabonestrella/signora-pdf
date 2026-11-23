---
title: Quick start
description: Show a PDF with a signature panel and download the signed result in a few minutes.
---

This page assumes you followed [Installation](../installation/): the packages are installed and
the PDF.js worker is served at `/assets/pdfjs/pdf.worker.min.mjs`.

## 1. Register the SDK

```ts title="src/app/app.config.ts"
import { ApplicationConfig } from '@angular/core';
import { provideSignora } from 'signora-pdf';
import { withPdfJsRenderer } from 'signora-pdf/pdfjs';
import { withPdfLibWriter } from 'signora-pdf/pdf-lib';

export const appConfig: ApplicationConfig = {
  providers: [
    provideSignora(
      withPdfJsRenderer({ workerSrc: '/assets/pdfjs/pdf.worker.min.mjs' }),
      withPdfLibWriter(), // only needed for exportPdf()
    ),
  ],
};
```

## 2. Show the viewer and export the result

Put a PDF in `public/contract.pdf` (or use any URL your app can fetch) and create a component:

```ts title="src/app/contract-page.ts"
import { Component, inject } from '@angular/core';
import { SigningSession } from 'signora-pdf';
import { SignoraViewerComponent } from 'signora-pdf/ui';

@Component({
  selector: 'app-contract-page',
  imports: [SignoraViewerComponent],
  // One session per document: the viewer and this component share it.
  providers: [SigningSession],
  template: `
    <button type="button" [disabled]="session.placements().length === 0" (click)="download()">
      Download signed PDF
    </button>
    <signora-viewer source="contract.pdf" [showSignaturePanel]="true" style="height: 80vh" />
  `,
})
export class ContractPage {
  protected readonly session = inject(SigningSession);

  protected async download(): Promise<void> {
    const bytes = await this.session.exportPdf(); // Uint8Array with the signatures embedded
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'signed.pdf';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
```

`source` accepts a URL string, `URL`, `Blob`/`File`, `ArrayBuffer` or `Uint8Array`.

Run `ng serve`, draw or type a signature in the panel, click it, click the page to place it, then
download the result.

:::note[Signing on the server instead?]
Skip `withPdfLibWriter()` and call `session.exportCoordinates()`: it returns where each signature
goes, so your backend can draw it. See [Digital signing](../../guides/digital-signing/).
:::

## Try it

import Demo from '../../../components/Demo.astro';

<Demo title="Signora PDF viewer demo" height={760} />

## Next steps

- [Examples](../../examples/viewer/): every feature with a live demo and the code that runs it.
- [Viewer options](../../guides/viewer-options/): view modes, signature modes, fields, read-only.
- [Theming](../../guides/theming/): CSS variables, slots, translations.
- [Digital signing](../../guides/digital-signing/): hand the exported PDF to your backend.
- [API reference](/signora-pdf/api/): every class, function and type.
