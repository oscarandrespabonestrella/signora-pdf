import { Injectable, InjectionToken, inject } from '@angular/core';
import {
  SIGNORA_WRITER,
  createSignoraFeature,
  hasDigitalSignature,
  type PdfWriterPort,
  type PlacedSignature,
  type SignatureAsset,
  type SignatureField,
  type SignoraFeature,
} from 'signora-pdf';
import type { PDFDocument, PDFImage } from 'pdf-lib';
import { appendVisualSignatures, type AppendVisualSignaturesOptions } from './incremental-writer';
import { pageInfo } from './page-info';
import { addSignatureFields } from './signature-fields-writer';
import { computeImageDrawing } from './placement-transform';
import { decodeSignatureImage } from './signature-image';

export { UnsupportedSignatureImageError } from './signature-image';

/** Options of {@link withPdfLibWriter}. */
export interface PdfLibWriterOptions {
  /**
   * How the signatures are written:
   *
   * - `'rewrite'` (default): the whole file is rewritten and the images are drawn on the page.
   *   This invalidates existing digital signatures, so a signed PDF is refused (see below).
   * - `'incremental'`: the original bytes are kept and the signatures are appended as stamp
   *   annotations in an incremental update. Existing digital signatures stay valid. See
   *   {@link appendVisualSignatures}.
   * - `'auto'`: incremental when the PDF already has a digital signature, rewrite otherwise.
   */
  readonly mode?: 'rewrite' | 'incremental' | 'auto';
  /**
   * In `'rewrite'` mode pdf-lib rewrites the whole file, which invalidates existing digital
   * signatures. By default the writer refuses to modify a PDF that already
   * contains one; set this to `true` to proceed anyway.
   */
  readonly allowInvalidatingExistingSignatures?: boolean;
  /** Options for the incremental modes. */
  readonly incremental?: AppendVisualSignaturesOptions;
}

/** Injection token holding the {@link PdfLibWriterOptions}. Set by {@link withPdfLibWriter}. */
export const SIGNORA_PDF_LIB_OPTIONS = new InjectionToken<PdfLibWriterOptions>(
  'SIGNORA_PDF_LIB_OPTIONS',
  { factory: () => ({}) },
);

/** The PDF already holds a digital signature that this modification would invalidate. */
export class PdfAlreadySignedError extends Error {
  constructor() {
    super(
      'The PDF already contains a digital signature; adding visual signatures would invalidate it.',
    );
    this.name = 'PdfAlreadySignedError';
  }
}

/**
 * {@link PdfWriterPort} implemented on top of pdf-lib. It draws each placed
 * signature as an image on its page, using the same normalized coordinates the
 * viewer uses, and respects the page's CropBox and `/Rotate`.
 *
 * This is a *visual* modification only. Digital (cryptographic) signing must be
 * done afterwards by a `DigitalSignatureProvider`.
 */
@Injectable()
export class PdfLibDocumentWriter implements PdfWriterPort {
  private readonly options = inject(SIGNORA_PDF_LIB_OPTIONS);

  /**
   * Adds empty signature fields as an incremental update, whatever the {@link
   * PdfLibWriterOptions.mode}: it never invalidates existing signatures. See {@link addSignatureFields}.
   */
  writeSignatureFields(pdf: Uint8Array, fields: readonly SignatureField[]): Promise<Uint8Array> {
    return addSignatureFields(pdf, fields, this.options.incremental);
  }

  async applyVisualSignatures(
    pdf: Uint8Array,
    placements: readonly PlacedSignature[],
  ): Promise<Uint8Array> {
    // Nothing to draw: keep the file as it is (rewriting it would invalidate existing signatures).
    if (placements.length === 0) return pdf.slice();
    const mode = this.options.mode ?? 'rewrite';
    if (mode === 'incremental' || (mode === 'auto' && hasDigitalSignature(pdf))) {
      return appendVisualSignatures(pdf, placements, this.options.incremental);
    }
    if (!this.options.allowInvalidatingExistingSignatures && hasDigitalSignature(pdf)) {
      throw new PdfAlreadySignedError();
    }

    const { PDFDocument, degrees } = await import('pdf-lib');
    const document = await PDFDocument.load(pdf);
    const pages = document.getPages();
    const images = new Map<string, PDFImage>();

    for (const placement of placements) {
      const page = pages[placement.pageIndex];
      if (!page) {
        throw new RangeError(
          `Placement "${placement.id}" targets missing page ${placement.pageIndex}.`,
        );
      }
      const image = await embed(document, images, placement.asset);
      const info = pageInfo(page, placement.pageIndex);
      const drawing = computeImageDrawing(placement.rect, info);
      page.drawImage(image, {
        x: drawing.x,
        y: drawing.y,
        width: drawing.width,
        height: drawing.height,
        rotate: degrees(drawing.rotate),
      });
    }

    return document.save();
  }
}

async function embed(
  document: PDFDocument,
  cache: Map<string, PDFImage>,
  asset: SignatureAsset,
): Promise<PDFImage> {
  const cached = cache.get(asset.id);
  if (cached) return cached;

  const { format, bytes } = decodeSignatureImage(asset);
  const image = format === 'png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);
  cache.set(asset.id, image);
  return image;
}

/** Uses pdf-lib to modify documents. Requires `pdf-lib` to be installed. */
export function withPdfLibWriter(options: PdfLibWriterOptions = {}): SignoraFeature {
  return createSignoraFeature('writer', [
    { provide: SIGNORA_PDF_LIB_OPTIONS, useValue: options },
    { provide: SIGNORA_WRITER, useClass: PdfLibDocumentWriter },
  ]);
}
