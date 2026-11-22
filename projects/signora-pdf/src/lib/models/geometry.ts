/** Clockwise rotation in degrees. Only right angles are valid in PDF. */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * Rectangle expressed as fractions (0..1) of the page's *visual* size, with the
 * origin at the top-left corner. "Visual" means the page as the document
 * author intended it to be displayed (the intrinsic `/Rotate` is applied) but
 * *without* any extra rotation the user applied in the viewer.
 *
 * This is the only coordinate space in which placements are stored, which makes
 * them independent from zoom, viewer rotation and screen resolution.
 */
export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Plain rectangle in an arbitrary unit (CSS pixels, PDF points...). Origin top-left. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Rectangle in PDF default user space: points, origin at the bottom-left corner. */
export interface PdfRect extends Rect {
  /**
   * Clockwise page rotation (`/Rotate`) the rectangle was computed against.
   * Content drawn into it must be rotated by this angle to look upright.
   */
  readonly pageRotation: Rotation;
}

/** A point in an arbitrary unit, with the origin at the top-left unless stated otherwise. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How a page is currently displayed in the viewer. */
export interface ViewportOptions {
  /** CSS pixels per PDF point. */
  readonly scale: number;
  /** Viewer rotation, added on top of the page's intrinsic rotation. */
  readonly rotation: Rotation;
}
