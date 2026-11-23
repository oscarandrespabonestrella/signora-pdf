---
title: Inicio rápido
description: Muestra un PDF con panel de firmas y descarga el resultado firmado en pocos minutos.
---

Esta página asume que seguiste la [Instalación](../installation/): los paquetes están instalados y
el worker de PDF.js se sirve en `/assets/pdfjs/pdf.worker.min.mjs`.

## 1. Registra el SDK

```ts title="src/app/app.config.ts"
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

## 2. Muestra el visor y exporta el resultado

Pon un PDF en `public/contract.pdf` (o usa cualquier URL que tu app pueda descargar) y crea un
componente:

```ts title="src/app/contract-page.ts"
import { Component, inject } from '@angular/core';
import { SigningSession } from 'signora-pdf';
import { SignoraViewerComponent } from 'signora-pdf/ui';

@Component({
  selector: 'app-contract-page',
  imports: [SignoraViewerComponent],
  // Una sesión por documento: el visor y este componente la comparten.
  providers: [SigningSession],
  template: `
    <button type="button" [disabled]="session.placements().length === 0" (click)="download()">
      Descargar PDF firmado
    </button>
    <signora-viewer source="contract.pdf" [showSignaturePanel]="true" style="height: 80vh" />
  `,
})
export class ContractPage {
  protected readonly session = inject(SigningSession);

  protected async download(): Promise<void> {
    const bytes = await this.session.exportPdf(); // Uint8Array con las firmas incrustadas
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'signed.pdf';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
```

`source` acepta una URL (string o `URL`), `Blob`/`File`, `ArrayBuffer` o `Uint8Array`.

Ejecuta `ng serve`, dibuja o escribe una firma en el panel, haz clic en ella, haz clic en la página
para colocarla y descarga el resultado.

:::note[¿Firmas en el servidor?]
Omite `withPdfLibWriter()` y llama a `session.exportCoordinates()`: devuelve dónde va cada firma
para que tu backend la dibuje. Consulta [Firma digital](../../guides/digital-signing/).
:::

## Pruébalo

import Demo from '../../../../components/Demo.astro';

<Demo title="Demo del visor de Signora PDF" height={760} />

## Siguientes pasos

- [Ejemplos](../../examples/viewer/): cada funcionalidad con demo en vivo y el código que la ejecuta.
- [Opciones del visor](../../guides/viewer-options/): modos de vista, modos de firma, campos, solo lectura.
- [Temas](../../guides/theming/): variables CSS, slots, traducciones.
- [Firma digital](../../guides/digital-signing/): entrega el PDF exportado a tu backend.
- [Referencia de la API](/signora-pdf/api/): todas las clases, funciones y tipos.
