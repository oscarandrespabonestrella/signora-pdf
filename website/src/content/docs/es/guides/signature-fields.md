---
title: Campos de firma en el PDF
description: Leer los campos de firma que ya tiene un PDF y crear campos vacíos para que un backend firme dentro de ellos.
---

Un **campo de firma** es una entrada AcroForm (`/FT /Sig`) que reserva un lugar de una página para
una firma digital. El `SignatureField` de Signora es el modelo que usa el visor para ese lugar;
estas dos funciones lo conectan con el PDF. Nada de esto firma: un campo está vacío hasta que tu
backend firma dentro de él.

## Leer los campos que ya tiene un documento

```ts
import { readSignatureFields } from 'signora-pdf/pdf-lib';

const fields = await readSignatureFields(pdfBytes);
// [{ id: 'Client', pdfName: 'Client', inDocument: true, pageIndex: 0, rect, label, required }]
```

```html
<signora-viewer [source]="pdf" [signatureFields]="fields" [freePlacement]="false" />
```

Devuelve los campos vacíos y visibles como `SignatureField`: `id` y `pdfName` son el nombre
completo del campo (`Contract.Client` si está anidado), `label` es su nombre alternativo (`/TU`) si
lo tiene y `required` sale de las banderas del campo. Quedan fuera los campos ya firmados y los
invisibles (rectángulo de tamaño cero). `inDocument: true` evita que se vuelvan a crear al exportar.
Para ver todos los campos, firmados o no, usa `inspectPdfSignatures()` ([validación](../validation/)).

## Crear los campos que define un diseño

Los campos colocados en el visor (`fieldsMode="edit"`) o construidos en código solo existen en la
sesión. Para escribirlos en el PDF:

```ts
const bytes = await session.exportPdf({ createFields: true });
```

Solo se crean los campos sin `inDocument`, como widgets de firma vacíos en su rectángulo
(imprimibles, con `/TU` y la bandera de obligatorio), en las páginas a las que apuntan. O
directamente:

```ts
import { addSignatureFields } from 'signora-pdf/pdf-lib';

const bytes = await addSignatureFields(pdfBytes, fields, { xrefFormat?, ignoreDocMdp? });
```

El resultado es una **actualización incremental**, sea cual sea el `mode` del writer: no cambia ningún
byte original, así que las firmas digitales que el documento ya tenga siguen siendo válidas. Añadir
campos a un documento certificado (DocMDP nivel 1 o 2) lanza `ChangesNotPermittedError`. Si el
documento no tiene AcroForm se crea; si lo tiene, se añaden los campos nuevos y se conservan los demás.

**Nombres.** Un campo se crea como `pdfName`, o si no con su etiqueta (o id) cambiando los puntos,
porque el punto separa los niveles de la jerarquía. Debe ser único entre todos los campos del
formulario y los nuevos, y sin puntos si pones tú `pdfName`; si no, se lanza
`SignatureFieldNameError` antes de escribir nada. Una página inexistente lanza `RangeError`.

Si usas tu propio writer, implementa el `writeSignatureFields()` opcional de `PdfWriterPort`;
`exportPdf({ createFields: true })` falla con un mensaje claro si falta.

## Firmar dentro de un campo

Envía el nombre del campo con la petición de firma y deja que tu backend firme dentro de él:

```ts
await workflow.sign({ certificateId, fieldName: field.pdfName });
```

Eso sirve para un campo que el PDF ya tiene (de `readSignatureFields()`). Un campo que solo existe en
la sesión hay que escribirlo antes: dale un `pdfName` (así sabes con qué nombre se crea) y deja que el
flujo lo cree durante la exportación visual:

```ts
session.addField({ id: 'client', pdfName: 'Client', pageIndex: 0, rect, required: true });
// ... el usuario lo rellena ...
await workflow.sign({
  certificateId,
  fieldName: 'Client',
  export: { createFields: true, requireAllFields: true },
});
```

`export` recibe las opciones de `session.exportPdf()` y no se envía al proveedor. Con
`requireAllFields`, la firma se detiene con `MissingSignatureFieldsError` antes de llamar al proveedor.

`fieldName` llega al servicio en los metadatos de la petición HTTP (ver
[firma digital](../digital-signing/)). El backend debe añadir su firma de forma incremental para que
sobrevivan las anteriores ([firmar un PDF ya firmado](../incremental-signing/)).

## Límites

- Los campos no llevan apariencia: algunos lectores no dibujan nada para un campo vacío hasta que
  se firma.
- Los PDF cifrados se rechazan (`EncryptedPdfError`). Los formularios XFA no se tocan.
- Un campo con varios widgets se lee a través del primero.
