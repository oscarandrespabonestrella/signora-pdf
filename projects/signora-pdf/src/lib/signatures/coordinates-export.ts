import { toPdfUserSpace } from '../coordinates';
import type { NormalizedRect, PageInfo, PdfRect, PlacedSignature, SignatureKind } from '../models';

/** Options of {@link placementToCoordinates} and `SigningSession.exportCoordinates()`. */
export interface CoordinatesExportOptions {
  /** Include each signature image (`data:` URL) in the result. Defaults to `false`. */
  readonly includeImages?: boolean;
}

/**
 * Where a signature goes, without any pixels attached by default. This is what to
 * send to a backend that stamps the PDF itself.
 */
export interface SignatureCoordinates {
  /** Id of the placement. */
  readonly id: string;
  /** Id of the signature asset used (look it up in your own store). */
  readonly assetId: string;
  readonly kind: SignatureKind;
  readonly label?: string;
  /** Zero-based page index. */
  readonly pageIndex: number;
  /** Id of the signature field this signature fills, if any. */
  readonly fieldId?: string;
  /** Visual size of the page in PDF points, with its intrinsic rotation applied. */
  readonly page: { readonly width: number; readonly height: number; readonly rotation: number };
  /**
   * Position as fractions (0..1) of the visual page, origin top-left. Independent of
   * zoom, rotation and the page size: the most portable form.
   */
  readonly normalized: NormalizedRect;
  /**
   * Same box in PDF default user space (points, origin bottom-left, unrotated page),
   * ready to hand to most PDF libraries. `pageRotation` tells how to rotate the content.
   */
  readonly pdf: PdfRect;
  /** Signature image as a `data:` URL. Only present with `includeImages`. */
  readonly dataUrl?: string;
}

/** Converts a placement into backend-friendly {@link SignatureCoordinates}. */
export function placementToCoordinates(
  placement: PlacedSignature,
  page: PageInfo,
  options: CoordinatesExportOptions = {},
): SignatureCoordinates {
  const { asset } = placement;
  return {
    id: placement.id,
    assetId: asset.id,
    kind: asset.kind,
    ...(asset.label === undefined ? {} : { label: asset.label }),
    pageIndex: placement.pageIndex,
    ...(placement.fieldId === undefined ? {} : { fieldId: placement.fieldId }),
    page: { width: page.width, height: page.height, rotation: page.rotation },
    normalized: placement.rect,
    pdf: toPdfUserSpace(placement.rect, page),
    ...(options.includeImages ? { dataUrl: asset.dataUrl } : {}),
  };
}
