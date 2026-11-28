# Signing an already signed PDF

Adding anything to a PDF that carries a digital signature normally destroys the signature: a
digital signature covers exact bytes, and the default writer (`mode: 'rewrite'`) rewrites the whole
file, so it refuses signed PDFs when it has signatures to add (with no placements it returns the bytes
unchanged). An **incremental update** avoids that. It appends the change after
the end of the file and leaves every original byte untouched, so earlier signatures keep covering
exactly what they covered. Readers see it as a later revision.

```ts
import { appendVisualSignatures } from 'signora-pdf/pdf-lib';

const output = await appendVisualSignatures(pdfBytes, session.placements());
```

Or let the session do it, through the writer:

```ts
provideSignora(withPdfJsRenderer(), withPdfLibWriter({ mode: 'auto' }));
// session.exportPdf() now appends to signed PDFs and rewrites unsigned ones
```

| `mode`                | Behaviour                                                                               |
| --------------------- | --------------------------------------------------------------------------------------- |
| `'rewrite'` (default) | Whole file rewritten, images drawn on the page. A signed PDF is refused. **Unchanged.** |
| `'incremental'`       | Always appended as an incremental update.                                               |
| `'auto'`              | Incremental when the PDF already has a digital signature, rewrite otherwise.            |

## What is written

Each placed signature becomes a **stamp annotation** with an appearance stream that draws the
image, on the page it was placed on. Position, size and `/Rotate` handling are the same as in
rewrite mode (`computeImageDrawing`), so a signature lands in the same place either way. The update
adds the new objects, a cross-reference section and a trailer with `/Prev`. It uses a classic
table or an xref stream matching what the file ended with (`incremental: { xrefFormat }` overrides
it). Only the page object (or the `/Annots` array, if it is indirect) is rewritten.

Differences from rewrite mode: the images are annotations (separate objects a PDF editor can
select and remove), not page content. They are marked print and locked.

## Validating the result

```ts
const report = await validatePdfSignatures(output);
// the original signatures stay 'valid', each with the warning REVISIONS_AFTER_SIGNATURE
```

That warning is expected: bytes now follow the signed range. `result.laterRevisions` says what they
are (here, `annotation`), see [validation.md](validation.md). Any change inside the signed bytes
would still be `DIGEST_MISMATCH`.

## Certified documents

A document certified with DocMDP restricts later changes. Level 3 allows annotations; levels 1 and
2 do not, and readers then report the certification as broken. `appendVisualSignatures` throws
`ChangesNotPermittedError` for levels 1 and 2 unless you pass `{ ignoreDocMdp: true }`.

## Limits

- **Encrypted PDFs** are refused (`EncryptedPdfError`): new objects would need encrypting.
- The update's objects are written plainly (not in object streams); files over 4 GiB are refused.
- It does **not** create signature fields or sign: the digital signature of the new revision is
  made by your backend, which must also append incrementally for the earlier signatures to
  survive. Order: place visual signatures, export with `'auto'`, then sign the result.
- Errors: `RangeError` (missing page), `UnsupportedSignatureImageError`, `IncrementalUpdateError`.

## Building other updates

`IncrementalUpdate` is the low-level piece: load a PDF, `register()` new objects or `replace()`
existing ones built with pdf-lib, then `build()` the bytes.
