---
title: Quick start
description: Show a PDF with a signature panel and export the signed result in a few minutes.
---

## 1. Register the SDK

```ts
// app.config.ts
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

## 2. Show the viewer

```ts
import { Component } from '@angular/core';
import { SignoraViewerComponent } from 'signora-pdf/ui';

@Component({
  imports: [SignoraViewerComponent],
  template: `<signora-viewer
    [source]="'/files/contract.pdf'"
    [showSignaturePanel]="true"
    style="height: 80vh"
  />`,
})
export class ContractPage {}
```

`source` accepts a URL string, `URL`, `Blob`/`File`, `ArrayBuffer` or `Uint8Array`.

## 3. Export the result

```ts
import { inject } from '@angular/core';
import { SigningSession } from 'signora-pdf';

const session = inject(SigningSession);
const bytes = await session.exportPdf(); // Uint8Array with the signatures embedded
```

Without the writer, `await session.exportCoordinates()` gives you where each signature goes so
your backend can draw it.

## Try it

import Demo from '../../../components/Demo.astro';

<Demo title="Signora PDF viewer demo" height={760} />

## Next steps

- [Viewer options](../../guides/viewer-options/): view modes, signature modes, fields, read-only.
- [Theming](../../guides/theming/): CSS variables, slots, translations.
- [Digital signing](../../guides/digital-signing/): hand the exported PDF to your backend.
