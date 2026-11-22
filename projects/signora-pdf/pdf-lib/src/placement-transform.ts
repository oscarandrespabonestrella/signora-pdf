import { toPdfUserSpace, type NormalizedRect, type PageInfo, type Rotation } from 'signora-pdf';

/** Arguments for pdf-lib's `page.drawImage()`. `rotate` is counter-clockwise degrees. */
export interface ImageDrawing {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotate: Rotation;
}

/**
 * Where and how to draw an image so that it appears upright, inside `rect`,
 * on a page that is displayed rotated by `/Rotate`.
 *
 * Pages are drawn in unrotated user space, so for a page shown rotated R degrees
 * clockwise the image must be rotated R degrees counter-clockwise. pdf-lib
 * rotates around the image's bottom-left corner, so the anchor is moved to the
 * corner of the target box that ends up there.
 */
export function computeImageDrawing(rect: NormalizedRect, page: PageInfo): ImageDrawing {
  const box = toPdfUserSpace(rect, page);
  // Size of the image as the reader sees it (before the page rotation).
  const swap = box.pageRotation === 90 || box.pageRotation === 270;
  const width = swap ? box.height : box.width;
  const height = swap ? box.width : box.height;

  switch (box.pageRotation) {
    case 90:
      return { x: box.x + box.width, y: box.y, width, height, rotate: 90 };
    case 180:
      return { x: box.x + box.width, y: box.y + box.height, width, height, rotate: 180 };
    case 270:
      return { x: box.x, y: box.y + box.height, width, height, rotate: 270 };
    default:
      return { x: box.x, y: box.y, width, height, rotate: 0 };
  }
}

/** Corners of a drawn image in PDF user space, in the order BL, BR, TR, TL of the *image*. */
export function imageCorners(drawing: ImageDrawing): readonly [number, number][] {
  const angle = (drawing.rotate * Math.PI) / 180;
  const cos = Math.round(Math.cos(angle));
  const sin = Math.round(Math.sin(angle));
  const at = (dx: number, dy: number): [number, number] => [
    drawing.x + dx * cos - dy * sin,
    drawing.y + dx * sin + dy * cos,
  ];
  return [at(0, 0), at(drawing.width, 0), at(drawing.width, drawing.height), at(0, drawing.height)];
}
