import { clampNormalizedRect } from '../coordinates';
import type { NormalizedRect, PageInfo, Point, SignatureAsset, SignatureField } from '../models';
import { normalizedHeightRatio } from './placement';

/** Width given to a new field, as a fraction of the page width. */
export const DEFAULT_FIELD_WIDTH = 0.28;
/** Smallest width or height a field can be resized to, as a fraction of the page. */
export const MIN_FIELD_SIZE = 0.03;

/** Thrown by `exportPdf({ requireAllFields: true })` when required fields are empty. */
export class MissingSignatureFieldsError extends Error {
  constructor(readonly missing: readonly SignatureField[]) {
    super(
      `Required signature fields are empty: ${missing.map((f) => f.label ?? f.id).join(', ')}.`,
    );
    this.name = 'MissingSignatureFieldsError';
  }
}

/** Rectangle for a new field (a 3:1 box) centred on `center` and kept inside the page. */
export function createFieldRect(
  page: Pick<PageInfo, 'width' | 'height'>,
  center: Point,
): NormalizedRect {
  const width = DEFAULT_FIELD_WIDTH;
  const height = Math.min(width * normalizedHeightRatio(page, 3), 1);
  return clampNormalizedRect({ x: center.x - width / 2, y: center.y - height / 2, width, height });
}

/**
 * Largest rectangle with the asset's proportions that fits inside `field`, centred in it
 * (the signature is never cropped or stretched).
 */
export function fitRectInField(
  field: NormalizedRect,
  asset: Pick<SignatureAsset, 'aspectRatio'>,
  page: Pick<PageInfo, 'width' | 'height'>,
): NormalizedRect {
  const ratio = normalizedHeightRatio(page, asset.aspectRatio); // height / width, normalized
  let width = field.width;
  let height = width * ratio;
  if (height > field.height) {
    height = field.height;
    width = height / ratio;
  }
  return {
    x: field.x + (field.width - width) / 2,
    y: field.y + (field.height - height) / 2,
    width,
    height,
  };
}

/**
 * Resizes a field by dragging one corner while the opposite corner stays fixed. Proportions are
 * free, and the result stays inside the page and above {@link MIN_FIELD_SIZE}.
 */
export function resizeFieldFromCorner(
  rect: NormalizedRect,
  corner: 'nw' | 'ne' | 'sw' | 'se',
  pointer: Point,
): NormalizedRect {
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';
  const anchorX = west ? rect.x + rect.width : rect.x;
  const anchorY = north ? rect.y + rect.height : rect.y;
  const px = Math.min(Math.max(pointer.x, 0), 1);
  const py = Math.min(Math.max(pointer.y, 0), 1);
  const width = Math.max(Math.abs(px - anchorX), MIN_FIELD_SIZE);
  const height = Math.max(Math.abs(py - anchorY), MIN_FIELD_SIZE);
  const x = px < anchorX ? anchorX - width : anchorX;
  const y = py < anchorY ? anchorY - height : anchorY;
  return clampNormalizedRect({ x, y, width, height });
}
