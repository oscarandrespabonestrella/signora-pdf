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

## Read-only: `readOnly`

```html
<signora-viewer [source]="url" [readOnly]="true" />
```

Shows the placed signatures but nobody can place, select, move, resize or delete them, and the
signature panel is hidden. Placements added through `SigningSession` still appear, and
`coordinatesChange` keeps working. The layer has the same `readOnly` input if you compose your own
viewer.
