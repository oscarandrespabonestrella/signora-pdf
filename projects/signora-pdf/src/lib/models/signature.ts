import type { NormalizedRect } from './geometry';

/** Where a signature asset comes from. Open-ended: use your own string for custom kinds. */
export type SignatureKind = 'drawn' | 'typed' | 'image' | 'organization' | (string & {});

/**
 * A reusable visual signature, stamp or logo, rendered as a raster or vector
 * image. Produced by a {@link SignatureProvider}.
 */
export interface SignatureAsset {
  readonly id: string;
  readonly kind: SignatureKind;
  readonly label?: string;
  /** `data:` URL (PNG/JPEG/SVG). */
  readonly dataUrl: string;
  /** Intrinsic width / height, used to keep proportions while resizing. */
  readonly aspectRatio: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** An instance of a signature asset positioned on a page. */
export interface PlacedSignature {
  readonly id: string;
  readonly asset: SignatureAsset;
  /** Zero-based page index. */
  readonly pageIndex: number;
  readonly rect: NormalizedRect;
}
