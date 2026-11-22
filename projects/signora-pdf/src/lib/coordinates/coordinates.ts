import type {
  NormalizedRect,
  PageInfo,
  PdfRect,
  Point,
  Rect,
  Rotation,
  ViewportOptions,
} from '../models';

/*
 * Coordinate model
 * ----------------
 * Three spaces are involved:
 *
 *  1. Normalized: fractions (0..1) of the page's visual size, origin top-left.
 *     This is how placements are stored.
 *  2. Viewport: CSS pixels of the rendered page, including zoom and the
 *     viewer rotation, origin top-left. This is what the UI works with.
 *  3. PDF user space: points, origin bottom-left, in the page's *unrotated*
 *     coordinate system inside its CropBox. This is what PDF writers need.
 *
 * Every function here is pure and framework independent.
 */

const RIGHT_ANGLES: readonly Rotation[] = [0, 90, 180, 270];

/** Normalises any multiple of 90 degrees (positive or negative) into a {@link Rotation}. */
export function normalizeRotation(degrees: number): Rotation {
  const normalized = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
  return RIGHT_ANGLES.includes(normalized as Rotation) ? (normalized as Rotation) : 0;
}

/**
 * Rotates a rectangle clockwise inside a frame of `frameWidth` x `frameHeight`
 * (the size of the frame *before* rotating). Returns the rectangle in the
 * rotated frame.
 */
export function rotateRect(
  rect: Rect,
  rotation: Rotation,
  frameWidth: number,
  frameHeight: number,
): Rect {
  const { x, y, width, height } = rect;
  switch (rotation) {
    case 90:
      return { x: frameHeight - (y + height), y: x, width: height, height: width };
    case 180:
      return { x: frameWidth - (x + width), y: frameHeight - (y + height), width, height };
    case 270:
      return { x: y, y: frameWidth - (x + width), width: height, height: width };
    default:
      return { x, y, width, height };
  }
}

/**
 * Inverse of {@link rotateRect}. `frameWidth` and `frameHeight` are the size of
 * the frame *before* rotating (i.e. the target frame of this operation).
 */
export function unrotateRect(
  rect: Rect,
  rotation: Rotation,
  frameWidth: number,
  frameHeight: number,
): Rect {
  const { x, y, width, height } = rect;
  switch (rotation) {
    case 90:
      return { x: y, y: frameHeight - x - width, width: height, height: width };
    case 180:
      return { x: frameWidth - x - width, y: frameHeight - y - height, width, height };
    case 270:
      return { x: frameWidth - y - height, y: x, width: height, height: width };
    default:
      return { x, y, width, height };
  }
}

/** Size in CSS pixels of a page rendered with the given viewport options. */
export function getViewportSize(
  page: Pick<PageInfo, 'width' | 'height'>,
  options: ViewportOptions,
): { width: number; height: number } {
  const swap = options.rotation === 90 || options.rotation === 270;
  return {
    width: (swap ? page.height : page.width) * options.scale,
    height: (swap ? page.width : page.height) * options.scale,
  };
}

/** Normalized rectangle -> rectangle in CSS pixels of the rendered page. */
export function toViewportRect(
  rect: NormalizedRect,
  page: Pick<PageInfo, 'width' | 'height'>,
  options: ViewportOptions,
): Rect {
  const points: Rect = {
    x: rect.x * page.width,
    y: rect.y * page.height,
    width: rect.width * page.width,
    height: rect.height * page.height,
  };
  const r = rotateRect(points, options.rotation, page.width, page.height);
  const s = options.scale;
  return { x: r.x * s, y: r.y * s, width: r.width * s, height: r.height * s };
}

/** Rectangle in CSS pixels of the rendered page -> normalized rectangle. */
export function fromViewportRect(
  rect: Rect,
  page: Pick<PageInfo, 'width' | 'height'>,
  options: ViewportOptions,
): NormalizedRect {
  const s = options.scale;
  const points = unrotateRect(
    { x: rect.x / s, y: rect.y / s, width: rect.width / s, height: rect.height / s },
    options.rotation,
    page.width,
    page.height,
  );
  return {
    x: points.x / page.width,
    y: points.y / page.height,
    width: points.width / page.width,
    height: points.height / page.height,
  };
}

/** Point in CSS pixels of the rendered page (e.g. a pointer event) -> normalized point. */
export function fromViewportPoint(
  point: Point,
  page: Pick<PageInfo, 'width' | 'height'>,
  options: ViewportOptions,
): Point {
  const { x, y } = fromViewportRect({ ...point, width: 0, height: 0 }, page, options);
  return { x, y };
}

/** Normalized point -> point in CSS pixels of the rendered page. */
export function toViewportPoint(
  point: Point,
  page: Pick<PageInfo, 'width' | 'height'>,
  options: ViewportOptions,
): Point {
  const { x, y } = toViewportRect({ ...point, width: 0, height: 0 }, page, options);
  return { x, y };
}

function rawFrame(page: PageInfo): { width: number; height: number } {
  const swap = page.rotation === 90 || page.rotation === 270;
  return { width: swap ? page.height : page.width, height: swap ? page.width : page.height };
}

/**
 * Normalized rectangle -> PDF default user space (points, origin bottom-left,
 * unrotated page). The result is the box in which a writer must draw.
 */
export function toPdfUserSpace(rect: NormalizedRect, page: PageInfo): PdfRect {
  const visual: Rect = {
    x: rect.x * page.width,
    y: rect.y * page.height,
    width: rect.width * page.width,
    height: rect.height * page.height,
  };
  const frame = rawFrame(page);
  const raw = unrotateRect(visual, page.rotation, frame.width, frame.height);
  const [x0, , , y1] = page.view;
  return {
    x: x0 + raw.x,
    y: y1 - raw.y - raw.height,
    width: raw.width,
    height: raw.height,
    pageRotation: page.rotation,
  };
}

/** Inverse of {@link toPdfUserSpace}. */
export function fromPdfUserSpace(rect: Rect, page: PageInfo): NormalizedRect {
  const [x0, , , y1] = page.view;
  const raw: Rect = {
    x: rect.x - x0,
    y: y1 - rect.y - rect.height,
    width: rect.width,
    height: rect.height,
  };
  const frame = rawFrame(page);
  const visual = rotateRect(raw, page.rotation, frame.width, frame.height);
  return {
    x: visual.x / page.width,
    y: visual.y / page.height,
    width: visual.width / page.width,
    height: visual.height / page.height,
  };
}

/**
 * Keeps a normalized rectangle inside the page: it is first shrunk if larger
 * than the page and then moved so that it does not overflow.
 */
export function clampNormalizedRect(rect: NormalizedRect): NormalizedRect {
  const width = Math.min(Math.max(rect.width, 0), 1);
  const height = Math.min(Math.max(rect.height, 0), 1);
  return {
    x: Math.min(Math.max(rect.x, 0), 1 - width),
    y: Math.min(Math.max(rect.y, 0), 1 - height),
    width,
    height,
  };
}
