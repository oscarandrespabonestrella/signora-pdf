---
title: Instalación
description: Instala signora-pdf y sus motores PDF opcionales en una aplicación Angular.
---

Signora PDF requiere **Angular 22+**.

```bash
npm install signora-pdf pdfjs-dist
# solo si quieres exportar el PDF con las firmas incrustadas:
npm install pdf-lib
```

`pdfjs-dist` y `pdf-lib` son **dependencias peer opcionales**: instala solo lo que uses, o
implementa los puertos con otro motor.

| Punto de entrada      | Contiene                                                       | Necesita           |
| --------------------- | -------------------------------------------------------------- | ------------------ |
| `signora-pdf`         | modelos, puertos, coordenadas, `SigningSession`, DI            | solo Angular       |
| `signora-pdf/pdfjs`   | implementación del puerto de renderizado con PDF.js            | `pdfjs-dist`       |
| `signora-pdf/pdf-lib` | implementación del puerto de escritura con pdf-lib             | `pdf-lib`          |
| `signora-pdf/ui`      | visor, página, barra, panel de firmas, directiva de tema       | núcleo             |
| `signora-pdf/http`    | proveedores HTTP de firma digital y de certificados            | núcleo, `HttpClient` |

## Sirve el worker de PDF.js

Tu aplicación debe servir el worker de PDF.js. Con un glob de assets en `angular.json`:

```json
{
  "glob": "pdf.worker.min.mjs",
  "input": "node_modules/pdfjs-dist/build",
  "output": "assets/pdfjs"
}
```

Después pasa su URL a `withPdfJsRenderer({ workerSrc })`, como en el [inicio rápido](../quick-start/).
