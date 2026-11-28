import { toPdfUserSpace, type PlacedSignature } from 'signora-pdf';
import type { PDFImage, PDFRef } from 'pdf-lib';
import { appendAnnotations } from './annotations';
import {
  ChangesNotPermittedError,
  IncrementalUpdate,
  readDocMdpPermission,
  type XrefFormat,
} from './incremental-update';
import { pageInfo } from './page-info';
import { computeImageDrawing } from './placement-transform';
import { decodeSignatureImage } from './signature-image';

/** Options of {@link appendVisualSignatures}. */
export interface AppendVisualSignaturesOptions {
  /** Kind of cross-reference section to write. By default the same kind the file ended with. */
  readonly xrefFormat?: XrefFormat;
  /**
   * Append even if the document is certified (DocMDP) with a level that does not allow
   * annotations. Readers will then report the certification as broken. Default `false`.
   */
  readonly ignoreDocMdp?: boolean;
}

/** Number as it appears in a content stream: no exponent, no trailing zeros. */
const num = (value: number): string => String(Number(value.toFixed(5)));

/**
 * Adds the placed signatures to a PDF as **stamp annotations with an appearance stream**, written
 * as an incremental update. The original bytes are untouched, so any digital signatures already in
 * the document keep covering exactly what they covered; a reader sees the result as a later
 * revision. Position, size and page rotation work exactly as in `PdfLibDocumentWriter`.
 *
 * This is the way to add visual signatures to a document that is already signed. The images are
 * annotations, not page content: unlike the rewrite mode, they remain separate objects.
 *
 * @throws {RangeError} if a placement targets a page the document does not have.
 * @throws {UnsupportedSignatureImageError} if an asset is not a PNG or JPEG data URL.
 * @throws {ChangesNotPermittedError} if a DocMDP certification forbids annotations.
 * @throws {EncryptedPdfError} if the document is encrypted.
 */
export async function appendVisualSignatures(
  pdf: Uint8Array,
  placements: readonly PlacedSignature[],
  options: AppendVisualSignaturesOptions = {},
): Promise<Uint8Array> {
  if (placements.length === 0) return pdf.slice();

  const update = await IncrementalUpdate.load(pdf);
  const { lib, document, context } = update;
  const { PDFString, PDFHexString } = lib;

  const permission = readDocMdpPermission(lib, document);
  if ((permission === 1 || permission === 2) && !options.ignoreDocMdp) {
    throw new ChangesNotPermittedError(permission);
  }

  // Check everything that can fail before creating objects.
  const pages = document.getPages();
  const decoded = new Map<string, ReturnType<typeof decodeSignatureImage>>();
  for (const placement of placements) {
    if (!pages[placement.pageIndex]) {
      throw new RangeError(
        `Placement "${placement.id}" targets missing page ${placement.pageIndex}.`,
      );
    }
    if (!decoded.has(placement.asset.id)) {
      decoded.set(placement.asset.id, decodeSignatureImage(placement.asset));
    }
  }

  const images = new Map<string, PDFImage>();
  for (const [id, { format, bytes }] of decoded) {
    images.set(
      id,
      format === 'png' ? await document.embedPng(bytes) : await document.embedJpg(bytes),
    );
  }
  await document.flush(); // creates the image objects

  const added = new Map<number, PDFRef[]>();
  for (const placement of placements) {
    const page = pages[placement.pageIndex];
    const info = pageInfo(page, placement.pageIndex);
    const box = toPdfUserSpace(placement.rect, info);
    const drawing = computeImageDrawing(placement.rect, info);

    // The image's matrix in page space; the form's BBox is the annotation's Rect, so no scaling.
    const angle = (drawing.rotate * Math.PI) / 180;
    const cos = Math.round(Math.cos(angle));
    const sin = Math.round(Math.sin(angle));
    const matrix = [
      drawing.width * cos,
      drawing.width * sin,
      -drawing.height * sin,
      drawing.height * cos,
      drawing.x,
      drawing.y,
    ];
    const rect = [box.x, box.y, box.x + box.width, box.y + box.height];

    const appearance = context.register(
      context.stream(`q ${matrix.map(num).join(' ')} cm /Im0 Do Q`, {
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: rect,
        Resources: { XObject: { Im0: images.get(placement.asset.id)!.ref } },
      }),
    );
    const annotation = context.register(
      context.obj({
        Type: 'Annot',
        Subtype: 'Stamp',
        Rect: rect,
        // Print (4) + Locked (128): it prints, and a reader should not let it be edited.
        F: 132,
        NM: PDFString.of(`signora-${placement.id}`),
        Contents: PDFHexString.fromText(placement.asset.label ?? 'Signature'),
        P: page.ref,
        AP: { N: appearance },
      }),
    );
    const list = added.get(placement.pageIndex) ?? [];
    list.push(annotation);
    added.set(placement.pageIndex, list);
  }

  for (const [pageIndex, refs] of added) {
    appendAnnotations(update, pages[pageIndex], refs);
  }
  return update.build(options.xrefFormat);
}
