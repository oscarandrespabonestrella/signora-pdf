---
title: Instalación
description: Instala signora-pdf desde npm y sirve el worker de PDF.js en una aplicación Angular.
---

[`signora-pdf`](https://www.npmjs.com/package/signora-pdf) está publicado en npm. Requiere
**Angular 22+**.

:::caution[Alfa]
La API puede cambiar antes de `1.0`. Fija la versión exacta en `package.json` mientras esté en alfa.
:::

## 1. Instala los paquetes

```bash
npm install signora-pdf pdfjs-dist
```

Añade pdf-lib solo si quieres exportar en el navegador el PDF con las firmas incrustadas:

```bash
npm install pdf-lib
```

Para inspeccionar y validar las firmas que ya tiene un PDF (`signora-pdf/validation`), añade también
PKI.js:

```bash
npm install pdf-lib pkijs asn1js
```

`pdfjs-dist`, `pdf-lib`, `pkijs` y `asn1js` son **dependencias peer opcionales**: instala solo lo que uses, o
implementa los puertos con otro motor. Cada motor vive en su propio punto de entrada, así que un
motor que no importas nunca acaba en tu bundle.

| Punto de entrada      | Contiene                                                 | Necesita             |
| --------------------- | -------------------------------------------------------- | -------------------- |
| `signora-pdf`         | modelos, puertos, coordenadas, `SigningSession`, DI      | solo Angular         |
| `signora-pdf/pdfjs`   | implementación del puerto de renderizado con PDF.js      | `pdfjs-dist`         |
| `signora-pdf/pdf-lib` | escritura con pdf-lib, actualizaciones incrementales, campos, DSS | `pdf-lib`   |
| `signora-pdf/ui`      | visor, página, barra, panel de firmas, directiva de tema | núcleo               |
| `signora-pdf/http`    | proveedores HTTP de firma digital y de certificados      | núcleo, `HttpClient` |
| `signora-pdf/validation` | inspeccionar y verificar firmas existentes, informes | `pdf-lib`, `pkijs`, `asn1js` |

## 2. Sirve el worker de PDF.js

PDF.js procesa los documentos en un web worker que tu aplicación debe servir. Añade un glob de
assets a las opciones de build de tu app en `angular.json`
(`projects.<tu-app>.architect.build.options.assets`):

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

Tras `ng serve`, `http://localhost:4200/assets/pdfjs/pdf.worker.min.mjs` debería cargar. Esa URL
es la que pasas a `withPdfJsRenderer({ workerSrc })` en el [inicio rápido](../quick-start/).

:::tip[¿Usas un agente de IA para programar?]
El paquete incluye una guía compacta con toda la API en `node_modules/signora-pdf/AGENTS.md`.
Indícale a tu agente que la lea en lugar de explorar el código fuente.
:::

## Solución de problemas

- **`Setting up fake worker failed` o un 404 de `pdf.worker.min.mjs`**: falta el glob de assets o
  `workerSrc` no coincide con su ruta de salida. Si tu app se sirve bajo una subruta, inclúyela
  (por ejemplo `/mi-app/assets/pdfjs/pdf.worker.min.mjs`).
- **El visor sale vacío o con altura cero**: `<signora-viewer>` ocupa su contenedor. Dale a él, o a
  su padre, una altura como `height: 80vh`.
- **`no PDF writer is registered`** al exportar: añade `withPdfLibWriter()` a `provideSignora()` e
  instala `pdf-lib`.
