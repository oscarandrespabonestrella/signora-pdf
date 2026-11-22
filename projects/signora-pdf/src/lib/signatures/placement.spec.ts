import type { PageInfo } from '../models';
import {
  CORNERS,
  MIN_PLACEMENT_WIDTH,
  cornerPoint,
  createPlacementRect,
  moveRect,
  normalizedHeightRatio,
  resizeRectFromCorner,
  scaleRect,
} from './placement';

const A4: Pick<PageInfo, 'width' | 'height'> = { width: 595, height: 842 };

describe('placement geometry', () => {
  it('keeps the asset proportions in page units', () => {
    // A 3:1 asset, 0.25 of the page width wide.
    const rect = createPlacementRect({ aspectRatio: 3 }, A4, { x: 0.5, y: 0.5 });
    expect((rect.width * A4.width) / (rect.height * A4.height)).toBeCloseTo(3, 9);
    expect(rect.x + rect.width / 2).toBeCloseTo(0.5, 9);
  });

  it('keeps new placements inside the page', () => {
    const rect = createPlacementRect({ aspectRatio: 3 }, A4, { x: 0.99, y: 0.01 });
    expect(rect.x + rect.width).toBeLessThanOrEqual(1);
    expect(rect.y).toBe(0);
  });

  it('fits very tall assets inside the page', () => {
    const rect = createPlacementRect({ aspectRatio: 0.05 }, A4, { x: 0.5, y: 0.5 }, 0.5);
    expect(rect.height).toBeLessThanOrEqual(1);
    expect(rect.y).toBeGreaterThanOrEqual(0);
  });

  it('moves and clamps', () => {
    const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.1 };
    expect(moveRect(rect, 0.1, 0.2)).toEqual({
      x: 0.2,
      y: 0.30000000000000004,
      width: 0.2,
      height: 0.1,
    });
    expect(moveRect(rect, 5, -5)).toEqual({ x: 0.8, y: 0, width: 0.2, height: 0.1 });
  });

  describe('resizeRectFromCorner', () => {
    const aspect = 2.5;
    const ratio = normalizedHeightRatio(A4, aspect);
    const rect = createPlacementRect({ aspectRatio: aspect }, A4, { x: 0.5, y: 0.5 }, 0.3);

    for (const corner of CORNERS) {
      it(`keeps the opposite corner fixed and the ratio when dragging ${corner}`, () => {
        const opposite = cornerPoint(
          rect,
          ({ nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' } as const)[corner],
        );
        const grab = cornerPoint(rect, corner);
        const out = resizeRectFromCorner(
          rect,
          corner,
          {
            x: grab.x + (corner.includes('w') ? -0.05 : 0.05),
            y: grab.y + (corner.includes('n') ? -0.05 : 0.05),
          },
          ratio,
        );

        const stillOpposite = cornerPoint(
          out,
          ({ nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' } as const)[corner],
        );
        expect(stillOpposite.x).toBeCloseTo(opposite.x, 9);
        expect(stillOpposite.y).toBeCloseTo(opposite.y, 9);
        expect(out.height / out.width).toBeCloseTo(ratio, 9);
        expect(out.width).toBeGreaterThan(rect.width);
      });
    }

    it('does not go below the minimum width or flip when dragged past the anchor', () => {
      const out = resizeRectFromCorner(rect, 'se', { x: 0, y: 0 }, ratio);
      expect(out.width).toBeCloseTo(MIN_PLACEMENT_WIDTH, 9);
      expect(out.x).toBeCloseTo(rect.x, 9);
    });

    it('stops at the page edge', () => {
      const out = resizeRectFromCorner(rect, 'se', { x: 5, y: 5 }, ratio);
      expect(out.x + out.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(out.y + out.height).toBeLessThanOrEqual(1 + 1e-9);
    });
  });

  it('scales around the centre and stays inside the page', () => {
    const ratio = normalizedHeightRatio(A4, 2);
    const rect = createPlacementRect({ aspectRatio: 2 }, A4, { x: 0.5, y: 0.5 }, 0.2);
    const bigger = scaleRect(rect, 1.5, ratio);
    expect(bigger.x + bigger.width / 2).toBeCloseTo(0.5, 9);
    expect(bigger.width).toBeCloseTo(0.3, 9);
    const huge = scaleRect(rect, 100, ratio);
    expect(huge.x).toBeGreaterThanOrEqual(0);
    expect(huge.x + huge.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(huge.y + huge.height).toBeLessThanOrEqual(1 + 1e-9);
  });
});
