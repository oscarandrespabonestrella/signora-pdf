import { normalizeRotation, type PageInfo } from 'signora-pdf';
import type { PDFPage } from 'pdf-lib';

/** Geometry of a pdf-lib page in the form the core's coordinate functions expect. */
export function pageInfo(page: PDFPage, index: number): PageInfo {
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
