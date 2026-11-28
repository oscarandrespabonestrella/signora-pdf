---
title: Firmar un PDF ya firmado
description: Añadir firmas visuales a un PDF con firmas digitales sin invalidarlas, con una actualización incremental.
---

Añadir algo a un PDF que lleva una firma digital normalmente la destruye: una firma digital cubre
bytes exactos y el writer por defecto (`mode: 'rewrite'`) reescribe todo el archivo, por eso rechaza
los PDF firmados cuando tiene firmas que añadir (sin colocaciones devuelve los bytes sin cambios). Una **actualización incremental** lo evita: añade el cambio al final y deja
intactos todos los bytes originales, de modo que las firmas anteriores siguen cubriendo exactamente
lo mismo. Los lectores lo ven como una revisión posterior.

```ts
import { appendVisualSignatures } from 'signora-pdf/pdf-lib';

const output = await appendVisualSignatures(pdfBytes, session.placements());
```

O que lo haga la sesión, a través del writer:

```ts
provideSignora(withPdfJsRenderer(), withPdfLibWriter({ mode: 'auto' }));
// session.exportPdf() añade a los PDF firmados y reescribe los no firmados
```

| `mode`                | Comportamiento                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `'rewrite'` (defecto) | Se reescribe todo el archivo y las imágenes se dibujan en la página. Rechaza PDF firmados. **Sin cambios.** |
| `'incremental'`       | Siempre se añade como actualización incremental.                                            |
| `'auto'`              | Incremental si el PDF ya tiene firma digital, reescritura si no.                            |

## Qué se escribe

Cada firma colocada se convierte en una **anotación de sello** con un stream de apariencia que
dibuja la imagen, en la página donde se colocó. La posición, el tamaño y el manejo de `/Rotate` son
los mismos que en modo reescritura (`computeImageDrawing`), así que la firma cae en el mismo sitio.
La actualización añade los objetos nuevos, una sección de referencias cruzadas y un trailer con
`/Prev`, con tabla clásica o xref stream según cómo terminaba el archivo
(`incremental: { xrefFormat }` lo cambia). Solo se reescribe el objeto de la página (o el array
`/Annots`, si es indirecto).

Diferencias con la reescritura: las imágenes son anotaciones (objetos separados que un editor de PDF
puede seleccionar y quitar), no contenido de la página. Se marcan como imprimibles y bloqueadas.

## Validar el resultado

```ts
const report = await validatePdfSignatures(output);
// las firmas originales siguen 'valid', cada una con el aviso REVISIONS_AFTER_SIGNATURE
```

Ese aviso es esperable: ahora hay bytes después del rango firmado. `result.laterRevisions` dice qué
son (aquí, `annotation`), ver [validación](../validation/). Cualquier cambio dentro de los bytes
firmados seguiría siendo `DIGEST_MISMATCH`.

## Documentos certificados

Un documento certificado con DocMDP restringe cambios posteriores. El nivel 3 permite anotaciones;
los niveles 1 y 2 no, y los lectores marcan entonces la certificación como rota.
`appendVisualSignatures` lanza `ChangesNotPermittedError` para los niveles 1 y 2 salvo que pases
`{ ignoreDocMdp: true }`.

## Límites

- Los **PDF cifrados** se rechazan (`EncryptedPdfError`): habría que cifrar los objetos nuevos.
- Los objetos de la actualización se escriben en claro (no en object streams); no se admiten
  archivos de más de 4 GiB.
- **No** crea campos de firma ni firma: la firma digital de la nueva revisión la hace tu backend,
  que también debe añadir de forma incremental para que sobrevivan las firmas anteriores. Orden:
  colocar firmas visuales, exportar con `'auto'`, y después firmar el resultado.
- Errores: `RangeError` (página inexistente), `UnsupportedSignatureImageError`,
  `IncrementalUpdateError`.

## Otras actualizaciones

`IncrementalUpdate` es la pieza de bajo nivel: carga un PDF, `register()` objetos nuevos o
`replace()` existentes construidos con pdf-lib, y `build()` devuelve los bytes.
