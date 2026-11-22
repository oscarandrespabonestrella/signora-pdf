import { clampNormalizedRect } from '../coordinates';
import type { NormalizedRect, PageInfo, Point, SignatureAsset } from '../models';

/** Smallest width a placement can be resized to, as a fraction of the page width. */
export const MIN_PLACEMENT_WIDTH = 0.04;
/** Width given to a freshly placed signature, as a fraction of the page width. */
export const DEFAULT_PLACEMENT_WIDTH = 0.25;

/** A corner of a placement (north/south, west/east) in the unrotated, normalized page. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se';
/** The four resize handles, in clockwise order from the top-left. */
export const CORNERS: readonly Corner[] = ['nw', 'ne', 'se', 'sw'];

/** Generates an identifier for assets and placements. */
export function createId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${random}`;
}

/**
 * height / width of a placement in *normalized* units, for an asset with the
 * given aspect ratio (width / height in its own pixels) on a given page.
 */
export function normalizedHeightRatio(
  page: Pick<PageInfo, 'width' | 'height'>,
  aspectRatio: number,
): number {
  return page.width / page.height / (aspectRatio > 0 ? aspectRatio : 1);
}

/** Rectangle for a new placement of `asset`, centred on `center` and kept inside the page. */
export function createPlacementRect(
  asset: Pick<SignatureAsset, 'aspectRatio'>,
  page: Pick<PageInfo, 'width' | 'height'>,
  center: Point,
  widthFraction = DEFAULT_PLACEMENT_WIDTH,
): NormalizedRect {
  const ratio = normalizedHeightRatio(page, asset.aspectRatio);
  let width = Math.min(Math.max(widthFraction, MIN_PLACEMENT_WIDTH), 1);
  let height = width * ratio;
  if (height > 1) {
    height = 1;
    width = height / ratio;
  }
  return clampNormalizedRect({ x: center.x - width / 2, y: center.y - height / 2, width, height });
}

/** Moves a rectangle by a normalized delta, keeping it inside the page. */
export function moveRect(rect: NormalizedRect, dx: number, dy: number): NormalizedRect {
  return clampNormalizedRect({ ...rect, x: rect.x + dx, y: rect.y + dy });
}

/**
 * Resizes by dragging one corner while the opposite corner stays fixed and the
 * proportions are preserved. `pointer` is the pointer position (normalized);
 * `ratio` is height / width in normalized units (see {@link normalizedHeightRatio}).
 */
export function resizeRectFromCorner(
  rect: NormalizedRect,
  corner: Corner,
  pointer: Point,
  ratio: number,
  minWidth = MIN_PLACEMENT_WIDTH,
): NormalizedRect {
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';
  const anchor: Point = {
    x: west ? rect.x + rect.width : rect.x,
    y: north ? rect.y + rect.height : rect.y,
  };
  const dirX = west ? -1 : 1;
  const dirY = north ? -1 : 1;

  const fromX = (pointer.x - anchor.x) * dirX;
  const fromY = ((pointer.y - anchor.y) * dirY) / ratio;
  const roomX = west ? anchor.x : 1 - anchor.x;
  const roomY = (north ? anchor.y : 1 - anchor.y) / ratio;

  const width = Math.max(
    Math.min(Math.max(fromX, fromY), roomX, roomY),
    Math.min(minWidth, roomX, roomY),
  );
  const height = width * ratio;
  return {
    x: west ? anchor.x - width : anchor.x,
    y: north ? anchor.y - height : anchor.y,
    width,
    height,
  };
}

/** Scales a rectangle around its centre keeping proportions and staying inside the page. */
export function scaleRect(
  rect: NormalizedRect,
  factor: number,
  ratio: number,
  minWidth = MIN_PLACEMENT_WIDTH,
): NormalizedRect {
  const maxWidth = Math.min(1, 1 / ratio);
  const width = Math.min(Math.max(rect.width * factor, minWidth), maxWidth);
  const height = width * ratio;
  return clampNormalizedRect({
    x: rect.x + rect.width / 2 - width / 2,
    y: rect.y + rect.height / 2 - height / 2,
    width,
    height,
  });
}

/** Normalized position of a corner of the rectangle. */
export function cornerPoint(rect: NormalizedRect, corner: Corner): Point {
  return {
    x: corner === 'nw' || corner === 'sw' ? rect.x : rect.x + rect.width,
    y: corner === 'nw' || corner === 'ne' ? rect.y : rect.y + rect.height,
  };
}
