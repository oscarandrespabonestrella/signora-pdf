import { Injectable, InjectionToken, inject } from '@angular/core';
import {
  SIGNORA_WRITER,
  createSignoraFeature,
  hasDigitalSignature,
  normalizeRotation,
  type PageInfo,
  type PdfWriterPort,
  type PlacedSignature,
  type SignatureAsset,
  type SignoraFeature,
} from 'signora-pdf';
import type { PDFDocument, PDFImage } from 'pdf-lib';
import { computeImageDrawing } from './placement-transform';

/** Options of {@link withPdfLibWriter}. */
export interface PdfLibWriterOptions {
  /**
   * pdf-lib rewrites the whole file, which invalidates existing digital
   * signatures. By default the writer refuses to modify a PDF that already
   * contains one; set this to `true` to proceed anyway.
   */
  readonly allowInvalidatingExistingSignatures?: boolean;
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

/** A signature asset could not be decoded into an embeddable image. */
export class UnsupportedSignatureImageError extends Error {
  constructor(assetId: string) {
    super(`Signature asset "${assetId}" is not a PNG or JPEG data URL.`);
    this.name = 'UnsupportedSignatureImageError';
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

  async applyVisualSignatures(
    pdf: Uint8Array,
    placements: readonly PlacedSignature[],
  ): Promise<Uint8Array> {
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

function pageInfo(page: ReturnType<PDFDocument['getPages']>[number], index: number): PageInfo {
  const { x, y, width, height } = page.getCropBox();
  const rotation = normalizeRotation(page.getRotation().angle);
  const swap = rotation === 90 || rotation === 270;
  return {
    index,
    width: swap ? height : width,
    height: swap ? width : height,
    rotation,
    view: [x, y, x + width, y + height],
  };
}

async function embed(
  document: PDFDocument,
  cache: Map<string, PDFImage>,
  asset: SignatureAsset,
): Promise<PDFImage> {
  const cached = cache.get(asset.id);
  if (cached) return cached;

  const match = /^data:image\/(png|jpe?g);base64,(.*)$/s.exec(asset.dataUrl);
  if (!match) throw new UnsupportedSignatureImageError(asset.id);
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  const image =
    match[1] === 'png' ? await document.embedPng(bytes) : await document.embedJpg(bytes);
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
