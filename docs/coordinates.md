# Coordinates

Signatures must stay on the same spot of the page regardless of zoom, viewer rotation, screen size
or the page's own rotation. To achieve that, placements are stored in **normalized coordinates**
and converted only at the edges.

## The three spaces

| Space          | Unit               | Origin      | Used by                          |
| -------------- | ------------------ | ----------- | -------------------------------- |
| Normalized     | fraction 0..1      | top-left    | storage (`PlacedSignature.rect`) |
| Viewport       | CSS pixels         | top-left    | UI: pointer events, overlay      |
| PDF user space | points (1/72 inch) | bottom-left | PDF writers                      |

**Normalized** is relative to the page's _visual_ size: the visible box (CropBox, else MediaBox)
with the document's `/Rotate` applied, as the author intended it to be read, and without the
extra rotation the user applied in the viewer.

## Functions (`signora-pdf`)

| Function                                        | Direction                                            |
| ----------------------------------------------- | ---------------------------------------------------- |
| `toViewportRect(rect, page, {scale, rotation})` | normalized → CSS pixels of the rendered page         |
| `fromViewportRect(rect, page, options)`         | CSS pixels → normalized                              |
| `toViewportPoint` / `fromViewportPoint`         | same, for points such as pointer events              |
| `toPdfUserSpace(rect, page)`                    | normalized → PDF points, bottom-left, unrotated page |
| `fromPdfUserSpace(rect, page)`                  | inverse                                              |
| `getViewportSize(page, options)`                | rendered size, axes swapped at 90/270                |
| `clampNormalizedRect(rect)`                     | keep a placement inside the page                     |

`scale` is CSS pixels per PDF point (`SigningSession.scale()`, i.e. `zoom * 96/72`), and
`PageInfo` comes from `PdfDocumentHandle.getPageInfo(index)`.

## Rules of thumb

- Convert pointer positions with `fromViewportPoint` as soon as they enter your code; store only
  normalized values.
- Render overlays by calling `toViewportRect` on every change of zoom/rotation. Never cache pixels.
- For export, `toPdfUserSpace` returns the unrotated box plus `pageRotation`; content drawn there
  must be rotated by `pageRotation` to look upright.
- Pages can have different sizes and rotations in one document; always pass the `PageInfo` of the
  page the placement belongs to.

The test suite checks round trips over all four rotations, several page sizes, intrinsic
`/Rotate` values and a CropBox that does not start at the origin.

## Export

`signora-pdf/pdf-lib` turns a placement into a `drawImage` call with `computeImageDrawing()`:
`toPdfUserSpace()` gives the box in the unrotated page, and because pdf-lib rotates images
counter-clockwise around their bottom-left corner, a page with `/Rotate R` needs the image rotated
by `R` and its anchor moved to the matching corner of the box. This is covered by unit tests for
all four rotations and offset CropBoxes, and was checked end to end by exporting placements on
pages with `/Rotate` 0, 90, 180 and 270 and measuring where they render.

## Limitations of the export

- The output is a rewritten file (pdf-lib has no incremental update), so any existing digital
  signature is invalidated; the writer refuses such documents by default.
- Only PNG and JPEG assets can be embedded. The UI normalizes uploads to PNG.
- Encrypted PDFs are not supported.
