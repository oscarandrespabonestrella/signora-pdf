# Viewer options

Inputs of `<signora-viewer>` that change what the integrator offers. All are optional, and the
defaults keep the previous behavior.

## Page layout: `viewMode`

```html
<signora-viewer [source]="url" viewMode="continuous" />
```

- `paged` (default): one page at a time; the toolbar and keyboard move between pages.
- `continuous`: every page in one scrollable column. Scrolling updates the current page, and
  going to a page (toolbar, keyboard, `session.goToPage()`) scrolls to it. Pages far from the
  visible area are drawn only when they get close, but keep their size so the scroll stays accurate.

Content projected into the viewer (`<ng-content>`) is placed over the current page in both modes.

## Signature modes: `signatureModes`

```html
<signora-viewer [showSignaturePanel]="true" [signatureModes]="['type', 'upload']" />
```

Choose which ways of providing a signature the panel offers: `draw`, `type`, `upload` and `other`
(the tabs of registered providers, such as `withOrganizationSignatures()`). The default is all of
them. With an empty list the panel shows only the signature library. On `<signora-signature-panel>`
the same thing is `builtInTabs` plus `providerTabs` (`true`, `false` or a list of provider ids).

## Collapsible signature panel: `signaturePanelBreakpoint`

```html
<signora-viewer [showSignaturePanel]="true" [signaturePanelBreakpoint]="760" />
```

The panel has a button on its edge that collapses and expands it. When the viewer is narrower than
`signaturePanelBreakpoint` pixels (default `760`) the panel starts collapsed, so the page keeps the
space; wider than that it starts open. Use `0` to never collapse automatically. Once the user
clicks the button, their choice is kept while the viewer is resized. Translate the button with the
`showSignaturePanel` and `hideSignaturePanel` labels.

## Preloading signatures: `preloadedSignatures`

```html
<signora-viewer [preloadedSignatures]="people" />
```

```ts
people: PreloadedSignature[] = [
  { text: 'Ada Lovelace' },                          // rendered with the first font
  { text: 'Grace Hopper', font: 'Classic' },         // font by label, or a SignatureFont
  { image: '/signatures/alan.png', label: 'Alan' },  // URL, data: URL or Blob
  readyMadeAsset,                                    // an existing SignatureAsset
];
```

They appear in the signature library, ready to click or drag onto a page. Items that cannot be
loaded are skipped with a console warning. Without the UI, use `session.addAssets(assets)` or
`resolvePreloadedSignatures()` from `signora-pdf/ui`.

## Coordinates only (no PDF drawing in the browser)

When your backend draws the signatures, skip the writer (`withPdfLibWriter()`) and ask the session
where each signature goes:

```ts
const placements = await session.exportCoordinates(); // no images
const withImages = await session.exportCoordinates({ includeImages: true });
```

Each item is a `SignatureCoordinates`: `pageIndex`, the page size and rotation, `normalized` (0..1
fractions of the visual page, origin top-left) and `pdf` (points in PDF user space, origin
bottom-left, with `pageRotation`). Use `normalized` when your backend works on the visual page and
`pdf` when it uses a PDF library directly.

Two outputs on the viewer report changes:

- `(coordinatesChange)` emits the `SignatureCoordinates[]` above after every change (an empty
  list when none are left). Images are left out unless `[coordinatesIncludeImages]="true"`.
- `(placementsChange)` emits the raw `PlacedSignature[]` (normalized box plus the full asset,
  image included).

## Signature fields

A field is a reserved, named area of a page that gets a signature. Unlike a free placement it says
_where_ a signature is expected, can be required, and is reported to your backend.

```ts
const fields: SignatureField[] = [
  {
    id: 'client',
    pageIndex: 0,
    rect: { x: 0.1, y: 0.72, width: 0.3, height: 0.07 }, // normalized, origin top-left
    label: 'Client signature',
    required: true,
  },
];
```

```html
<signora-viewer
  [signatureFields]="fields"
  [freePlacement]="false"
  [showSignaturePanel]="true"
  (fieldsChange)="fields = $event"
/>
```

**Filling.** Empty fields are dashed boxes with their label (and `*` when required). A user clicks a
field and then creates or picks a signature, or arms a signature and clicks the field, or drags one
from the list onto it (`Enter` and `Space` work on a focused field). The signature is fitted and
centred inside the field, never cropped or stretched. It stays there: it cannot be moved or
resized, only cleared (`Delete`), which empties the field and keeps it. With `[freePlacement]="false"`
signatures can only go in fields.

**Validating.** `session.validate()` returns `{ valid, missing }`. `session.exportPdf({ requireAllFields: true })`
rejects with `MissingSignatureFieldsError` while a required field is empty, and
`session.missingRequiredFields()` is a signal for disabling a button. Coordinates exported with
`exportCoordinates()` / `(coordinatesChange)` include the `fieldId` of each signature.

**Editing.** `[fieldsMode]="'edit'"` is for whoever lays the document out: an editor bar appears (add a
field, name it, mark it required, delete it), fields are moved and resized on the page (mouse,
touch or arrow keys; `Delete` removes), and signatures cannot be placed. Read the result from
`(fieldsChange)` or `session.fields()` and store it: it is what you pass as `signatureFields` to the
people who sign.

**Input and output.** `signatureFields` is applied whenever it changes and to every document that
loads (fields belong to a document). Feeding `(fieldsChange)` back into it is safe. Without the UI:
`setFields`, `addField`, `updateField`, `removeField`, `fillField(id, asset)`, `clearField(id)`.

Theme tokens: `--signora-field-color`, `--signora-field-bg`, `--signora-field-text`.

## Read-only: `readOnly`

```html
<signora-viewer [source]="url" [readOnly]="true" />
```

Shows the placed signatures but nobody can place, select, move, resize or delete them, and the
signature panel is hidden. Placements added through `SigningSession` still appear, and
`coordinatesChange` keeps working. The layer has the same `readOnly` input if you compose your own
viewer.
