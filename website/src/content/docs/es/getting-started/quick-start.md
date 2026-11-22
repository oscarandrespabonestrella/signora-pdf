---
title: Inicio rápido
description: Muestra un PDF con panel de firmas y exporta el resultado firmado en pocos minutos.
---

## 1. Registra el SDK

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
      withPdfLibWriter(), // solo hace falta para exportPdf()
    ),
  ],
};
```

## 2. Muestra el visor

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

`source` acepta una URL (string o `URL`), `Blob`/`File`, `ArrayBuffer` o `Uint8Array`.

## 3. Exporta el resultado

```ts
import { inject } from '@angular/core';
import { SigningSession } from 'signora-pdf';

const session = inject(SigningSession);
const bytes = await session.exportPdf(); // Uint8Array con las firmas incrustadas
```

Sin el writer, `await session.exportCoordinates()` te da dónde va cada firma para que tu backend
la dibuje.

## Pruébalo

import Demo from '../../../../components/Demo.astro';

<Demo title="Demo del visor de Signora PDF" height={760} />

## Siguientes pasos

- [Opciones del visor](../../guides/viewer-options/): modos de vista, modos de firma, campos, solo lectura.
- [Temas](../../guides/theming/): variables CSS, slots, traducciones.
- [Firma digital](../../guides/digital-signing/): entrega el PDF exportado a tu backend.
