# Signature fields in the PDF

A **signature field** is an AcroForm entry (`/FT /Sig`) that reserves a place on a page for a
digital signature. Signora's `SignatureField` is the viewer's model of such a place; these two
functions connect it with the PDF itself. Nothing here signs: a field is empty until your backend
signs into it.

## Read the fields a document already has

```ts
import { readSignatureFields } from 'signora-pdf/pdf-lib';

const fields = await readSignatureFields(pdfBytes);
// [{ id: 'Client', pdfName: 'Client', inDocument: true, pageIndex: 0, rect, label, required }]
```

```html
<signora-viewer [source]="pdf" [signatureFields]="fields" [freePlacement]="false" />
```

It returns the empty, visible fields as `SignatureField`s: `id` and `pdfName` are the fully
qualified field name (`Contract.Client` for a nested field), `label` is the field's alternate name
(`/TU`) if it has one, and `required` comes from the field flags. Fields that are already signed,
and invisible ones (a zero-size rectangle), are left out. `inDocument: true` tells exporting not to
create them again. Use `inspectPdfSignatures()` ([validation](validation.md)) to see every field,
signed or not.

## Create the fields a layout defines

Fields laid out in the viewer (`fieldsMode="edit"`) or built in code exist only in the session. To
write them into the PDF:

```ts
const bytes = await session.exportPdf({ createFields: true });
```

Only fields without `inDocument` are created, as empty signature widgets at their rectangle
(printable, with `/TU` and the required flag), on the pages they target. Or call it directly:

```ts
import { addSignatureFields } from 'signora-pdf/pdf-lib';

const bytes = await addSignatureFields(pdfBytes, fields, { xrefFormat?, ignoreDocMdp? });
```

The result is an **incremental update**, whatever the writer's `mode`: no original byte changes, so
digital signatures the document already has stay valid. Adding fields to a certified document
(DocMDP level 1 or 2) throws `ChangesNotPermittedError`. The AcroForm is created if the document
has none, otherwise the new fields are added to it and its other fields are kept.

**Names.** A field is created as `pdfName`, or else its label (or id) with the dots replaced,
because a dot separates the levels of the hierarchy. It must be unique among every field of the form
and the new ones, and have no dot if you set `pdfName` yourself; otherwise `SignatureFieldNameError`
is thrown, before anything is written. A page that does not exist throws `RangeError`.

If you use your own writer, implement the optional `writeSignatureFields()` of `PdfWriterPort`;
`exportPdf({ createFields: true })` fails clearly without it.

## Signing into a field

Send the field's name with the signing request and let your backend sign into it:

```ts
await workflow.sign({ certificateId, fieldName: field.pdfName });
```

That works for a field the PDF already has (from `readSignatureFields()`). A field that exists only in
the session must be written first: give it a `pdfName` (so you know the name it is created with) and
let the workflow create it during the visual export:

```ts
session.addField({ id: 'client', pdfName: 'Client', pageIndex: 0, rect, required: true });
// ... the user fills it ...
await workflow.sign({
  certificateId,
  fieldName: 'Client',
  export: { createFields: true, requireAllFields: true },
});
```

`export` takes the options of `session.exportPdf()` and is not sent to the provider. With
`requireAllFields`, signing stops with `MissingSignatureFieldsError` before the provider is called.

`fieldName` reaches the service in the metadata of the HTTP request (see
[digital-signing.md](digital-signing.md)). The backend must append its signature incrementally so the
earlier ones survive ([incremental-signing.md](incremental-signing.md)).

## Limits

- Fields get no appearance: some readers draw nothing for an empty field until it is signed.
- Encrypted PDFs are refused (`EncryptedPdfError`). XFA forms are not touched.
- Radio-like constructs such as one field with several widgets are read through their first widget.
