import type { Rotation } from './geometry';

/** Geometry of a PDF page, in PDF points (1/72 inch). */
export interface PageInfo {
  /** Zero-based page index. */
  readonly index: number;
  /** Visual width: the visible box with the intrinsic `/Rotate` applied. */
  readonly width: number;
  /** Visual height: the visible box with the intrinsic `/Rotate` applied. */
  readonly height: number;
  /** Intrinsic page rotation (`/Rotate`). */
  readonly rotation: Rotation;
  /**
   * Visible box (CropBox, falling back to MediaBox) in unrotated PDF user
   * space: `[x0, y0, x1, y1]`, origin at the bottom-left.
   */
  readonly view: readonly [number, number, number, number];
}
