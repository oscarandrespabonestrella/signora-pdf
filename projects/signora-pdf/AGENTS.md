# signora-pdf: guide for AI agents and LLMs

Angular SDK to **view PDFs and place visual signatures**, optionally followed by a **digital
signature made by your backend**. Read this file instead of exploring the source. Every name below
exists in the published types.

- Package: `signora-pdf` (Angular 22+, standalone components, signals).
- Entry points: `signora-pdf` (core, no UI/engine deps), `signora-pdf/ui` (components),
  `signora-pdf/pdfjs` (renderer, needs `pdfjs-dist`), `signora-pdf/pdf-lib` (writer, needs `pdf-lib`),
  `signora-pdf/http` (digital signing over HTTP).
- It never performs cryptography. A visual signature is an image on the page, not a digital signature.

## Minimal setup (3 steps)

```bash
npm i signora-pdf pdfjs-dist pdf-lib   # pdf-lib only if you export a PDF in the browser
```

Serve the PDF.js worker, for example in `angular.json` assets:
`{ "glob": "pdf.worker.min.mjs", "input": "node_modules/pdfjs-dist/build", "output": "assets/pdfjs" }`.

```ts
// app.config.ts
import { provideSignora } from 'signora-pdf';
import { withPdfJsRenderer } from 'signora-pdf/pdfjs';
import { withPdfLibWriter } from 'signora-pdf/pdf-lib';

providers: [
  provideSignora(
    withPdfJsRenderer(), // workerSrc defaults to '/assets/pdfjs/pdf.worker.min.mjs'
    withPdfLibWriter(), // optional: only for session.exportPdf()
  ),
];
```

```ts
import { SignoraViewerComponent } from 'signora-pdf/ui';

@Component({
  imports: [SignoraViewerComponent],
  template: `<signora-viewer [source]="url" [showSignaturePanel]="true" style="height: 80vh" />`,
})
export class Page {}
```

The viewer fills its host: **give the host a height**. `source` accepts a URL string, `URL`, `Blob`,
`File`, `ArrayBuffer` or `Uint8Array`.

## `<signora-viewer>` inputs and outputs

| Name                               | Type / default                                     | Effect                                                                                                                  |
| ---------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `source`                           | `PdfSource \| null` = `null`                       | Document to show; changing it loads another.                                                                            |
| `showToolbar`                      | `boolean` = `true`                                 | Page navigation, zoom, rotation.                                                                                        |
| `showSignaturePanel`               | `boolean` = `false`                                | Panel to create/choose signatures.                                                                                      |
| `viewMode`                         | `'paged' \| 'continuous'` = `'paged'`              | One page at a time, or every page in one scroll.                                                                        |
| `signatureModes`                   | `('draw'\|'type'\|'upload'\|'other')[]` = all four | Which tabs the panel offers. `other` = provider tabs (e.g. organization signatures). `[]` = library only.               |
| `preloadedSignatures`              | `PreloadedSignature[]` = `[]`                      | Signatures ready from the start: `SignatureAsset`, `{ text, font?, label? }`, `{ image, label? }`.                      |
| `readOnly`                         | `boolean` = `false`                                | Show placed signatures; nobody can place/move/resize/delete; panel hidden.                                              |
| `coordinatesIncludeImages`         | `boolean` = `false`                                | Include `dataUrl` in `coordinatesChange`.                                                                               |
| `signatureFields`                  | `SignatureField[]` = `[]`                          | Reserved, named areas to sign. Applied to every loaded document; see Signature fields.                                  |
| `fieldsMode`                       | `'fill' \| 'edit'` = `'fill'`                      | `fill`: users fill the fields. `edit`: users create, move, resize, name and delete fields; signatures cannot be placed. |
| `freePlacement`                    | `boolean` = `true`                                 | `false`: signatures can only go inside a field.                                                                         |
| `(fieldsChange)`                   | `SignatureField[]`                                 | The fields after every change, including edits made in `edit` mode.                                                     |
| `(coordinatesChange)`              | `SignatureCoordinates[]`                           | Where every signature is, after each change (`[]` when none).                                                           |
| `(placementsChange)`               | `PlacedSignature[]`                                | Raw placements, with the full asset and image.                                                                          |
| `[signoraTheme]` (directive)       | `SignoraThemeTokens`                               | Theme tokens, e.g. `{ 'color-accent': '#e11d48', radius: '12px' }`.                                                     |
| `<ng-template signoraSlot="name">` | slots: `toolbar empty loading error signatures`    | Replace a section; the template receives the `SigningSession` as `$implicit` and `session`.                             |

Other components in `signora-pdf/ui`: `SignoraToolbarComponent`, `SignoraPageComponent`,
`SignoraSignatureLayerComponent` (has `readOnly`, `fieldsMode`, `freePlacement`), `SignoraFieldEditorComponent`, `SignoraSignaturePanelComponent` (`builtInTabs`,
`providerTabs`), `SignoraSignaturePadComponent`, `SignoraSignatureTypedComponent`,
`SignoraSignatureUploadComponent`. Compose them yourself with `SigningSession` for a custom UI.

## `SigningSession` (inject it; one per app by default)

State (all signals): `document`, `status` (`'idle'|'loading'|'ready'|'error'`), `error`,
`currentPage` (1-based), `pageCount`, `hasDocument`, `zoom`, `rotation`, `placements`, `assets`,
`armedAsset`, `selectedPlacementId`, `selectedPlacement`, `fields`, `selectedFieldId`, `selectedField`,
`addingField`, `filledFieldIds`, `missingRequiredFields`, `viewport`, `scale`, `canGoPrevious`,
`canGoNext`, `canZoomIn`, `canZoomOut`.

Methods: `load(source)`, `close()`, `goToPage(n)`, `nextPage()`, `previousPage()`, `setZoom(z)`,
`zoomIn()`, `zoomOut()`, `setRotation(deg)`, `rotateClockwise()`, `rotateCounterClockwise()`,
`addPlacement(p)`, `updatePlacement(id, patch)`, `removePlacement(id)`, `clearPlacements()`,
`selectPlacement(id)`, `addAsset(a)`, `addAssets(list)`, `removeAsset(id)`, `arm(asset | null)`,
`setFields(list)`, `addField(f)`, `updateField(id, patch)`, `removeField(id)`, `clearFields()`,
`selectField(id)`, `armFieldCreation(on)`, `fillField(id, asset)`, `clearField(id)`, `validate()`,
`exportPdf({ requireAllFields? }): Promise<Uint8Array>` (needs a writer), `exportCoordinates({ includeImages? })`
(needs no writer).

## Recipes

**Download the signed PDF in the browser** (needs `withPdfLibWriter()`):

```ts
const bytes = await session.exportPdf();
const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
```

**Backend draws the signatures (coordinates only).** Do not register a writer. Either bind
`(coordinatesChange)` or call `await session.exportCoordinates()`. Each item:

```ts
{ id, assetId, kind, label?, pageIndex /* 0-based */,
  page: { width, height, rotation },           // PDF points, visual size
  normalized: { x, y, width, height },          // 0..1 of the visual page, origin TOP-left
  pdf: { x, y, width, height, pageRotation },   // PDF points, origin BOTTOM-left, unrotated page
  dataUrl? }                                    // only with includeImages
```

Use `pdf` with PDF libraries, `normalized` when the backend rasterizes the page.

**Signature fields** (reserved, named areas; the base for forms and contracts):

```ts
const fields: SignatureField[] = [
  {
    id: 'client',
    pageIndex: 0,
    rect: { x: 0.1, y: 0.72, width: 0.3, height: 0.07 },
    label: 'Client signature',
    required: true,
  },
];
```

```html
<signora-viewer
  [signatureFields]="fields"
  [freePlacement]="false"
  (fieldsChange)="fields = $event"
/>
```

`rect` is normalized like placements. Users click a field, then create or pick a signature (or arm one
and click the field, or drag it onto the field): it is fitted and centred inside the field and cannot
be moved, only cleared (`Delete`). Check `session.validate()` (`{ valid, missing }`) or call
`session.exportPdf({ requireAllFields: true })`, which rejects with `MissingSignatureFieldsError`.
`exportCoordinates()` items carry `fieldId`. For whoever lays the document out, `[fieldsMode]="'edit'"`
shows an editor (add, name, required, delete) and lets fields be moved and resized on the page; read
the result from `(fieldsChange)` or `session.fields()`. Theme: `--signora-field-color`,
`--signora-field-bg`, `--signora-field-text`.

**Several signatures available at once:**

```html
<signora-viewer
  [preloadedSignatures]="[{ text: 'Ada Lovelace' }, { image: '/sig/alan.png', label: 'Alan' }]"
/>
```

**Only typing and uploading allowed:** `[signatureModes]="['type', 'upload']"`.

**Show a finished document without editing:** `[readOnly]="true"` and add the placements with
`session.addPlacement({ id, asset, pageIndex, rect })` (`rect` normalized).

**Predefined organization signatures/stamps:**
`provideSignora(..., withOrganizationSignatures({ assets: [...] | () => Promise<SignatureAsset[]> }))`.
Assets are PNG/JPEG `data:` URLs (`{ id, kind, label?, dataUrl, aspectRatio }`).

**Digital signature through your backend** (`signora-pdf/http`, needs `provideHttpClient()`):

```ts
provideSignora(
  withPdfJsRenderer(),
  withPdfLibWriter(),
  withHttpDigitalSigner({ signUrl: '/api/sign' }),
  withHttpCertificateProvider({ url: '/api/certificates' }),
);

const workflow = inject(SigningWorkflow);
const result = await workflow.sign({ certificateId, level: 'B-T', reason: '...' });
result.pdf; // Uint8Array
result.cryptographic; // true only if the backend really signed
```

Backend contract: `POST signUrl` multipart (`pdf` file, `metadata` JSON) returns the signed
`application/pdf`; `GET certificates url` returns `[{ id, subject, issuer?, validFrom?, validTo? }]`.
Custom providers: implement `DigitalSignatureProvider` / `CertificateProvider` and register with
`withDigitalSigner()` / `withCertificateProvider()`.

**Translate or rename texts:** provide `SIGNORA_LABELS` with `{ ...DEFAULT_SIGNORA_LABELS, nextPage: '...' }`.

**Theme:** CSS variables on any ancestor, or `[signoraTheme]`. Main tokens: `--signora-color-accent`,
`--signora-color-bg`, `--signora-color-text`, `--signora-color-border`, `--signora-radius`,
`--signora-font-family`, `--signora-signature-ink`, `--signora-panel-width`. Full list: `docs/theming.md`.

**Custom engines:** implement `PdfRenderingPort` / `PdfWriterPort` / `SignatureProvider` and register
with `withRenderer()` / `withWriter()` / `withSignatureProvider()`.

## Gotchas

- Placements are stored **normalized** (0..1, origin top-left of the visual page); they survive zoom
  and rotation. Convert with `toPdfUserSpace(rect, pageInfo)` / `fromPdfUserSpace`.
- `exportPdf()` throws if no writer is registered, and the writer refuses PDFs that already carry a
  digital signature (it would invalidate it). Place visual signatures first, sign digitally last.
- Signature images must be PNG/JPEG data URLs to be embedded; `rasterizeToAsset(blobOrUrl)` converts.
- `provideSignora()` registers one `SigningSession` for the app. For an isolated one (a dialog, a second
  document) add `providers: [SigningSession]` to that component.
- Continuous mode draws far pages lazily; projected `<ng-content>` goes over the current page only.
- The PDF.js worker must be reachable at `workerSrc`; a 404 there is the usual "blank page" cause.
- Do not invent inputs: if a name is not in this file, check `docs/viewer-options.md` or the types.

More: `README.md`, `docs/viewer-options.md`, `docs/coordinates.md`, `docs/digital-signing.md`,
`docs/theming.md`, `docs/architecture.md`.
