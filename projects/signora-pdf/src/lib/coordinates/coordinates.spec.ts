import type { NormalizedRect, PageInfo, Rotation, ViewportOptions } from '../models';
import {
  clampNormalizedRect,
  fromPdfUserSpace,
  fromViewportPoint,
  fromViewportRect,
  getViewportSize,
  normalizeRotation,
  toPdfUserSpace,
  toViewportPoint,
  toViewportRect,
} from './coordinates';

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

const A4: PageInfo = { index: 0, width: 595, height: 842, rotation: 0, view: [0, 0, 595, 842] };
const LETTER_LANDSCAPE: PageInfo = {
  index: 1,
  width: 792,
  height: 612,
  rotation: 0,
  view: [0, 0, 792, 612],
};
/** Raw 842x595 page displayed rotated by 90: visual size 595x842. */
const A4_ROTATED_90: PageInfo = {
  index: 2,
  width: 595,
  height: 842,
  rotation: 90,
  view: [0, 0, 842, 595],
};
const A4_ROTATED_270_CROPPED: PageInfo = {
  index: 3,
  width: 500,
  height: 700,
  rotation: 270,
  view: [20, 30, 720, 530],
};
const PAGES = [A4, LETTER_LANDSCAPE, A4_ROTATED_90, A4_ROTATED_270_CROPPED];

const RECT: NormalizedRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };

function expectRectClose(actual: object, expected: object, digits = 9): void {
  const a = actual as Record<string, number>;
  const e = expected as Record<string, number>;
  for (const key of ['x', 'y', 'width', 'height']) {
    expect(a[key]).toBeCloseTo(e[key], digits);
  }
}

describe('normalizeRotation', () => {
  it('wraps positive and negative multiples of 90', () => {
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-360)).toBe(0);
  });
});

describe('viewport conversion', () => {
  it('computes the viewport size, swapping axes for 90/270', () => {
    expect(getViewportSize(A4, { scale: 2, rotation: 0 })).toEqual({ width: 1190, height: 1684 });
    expect(getViewportSize(A4, { scale: 2, rotation: 90 })).toEqual({ width: 1684, height: 1190 });
    expect(getViewportSize(A4, { scale: 2, rotation: 180 })).toEqual({ width: 1190, height: 1684 });
  });

  it('maps a rectangle at scale 1 with no rotation', () => {
    const view = toViewportRect(RECT, A4, { scale: 1, rotation: 0 });
    expectRectClose(view, { x: 59.5, y: 168.4, width: 178.5, height: 84.2 });
  });

  it('moves the top-left corner to the top-right when rotated 90 degrees', () => {
    const corner: NormalizedRect = { x: 0, y: 0, width: 0.1, height: 0.1 };
    const view = toViewportRect(corner, A4, { scale: 1, rotation: 90 });
    // viewport is 842 wide: the corner box is flush with the right edge.
    expectRectClose(view, { x: 842 - 84.2, y: 0, width: 84.2, height: 59.5 });
  });

  it('moves the top-left corner to the bottom-right when rotated 180 degrees', () => {
    const corner: NormalizedRect = { x: 0, y: 0, width: 0.1, height: 0.1 };
    const view = toViewportRect(corner, A4, { scale: 1, rotation: 180 });
    expectRectClose(view, { x: 595 - 59.5, y: 842 - 84.2, width: 59.5, height: 84.2 });
  });

  for (const page of PAGES) {
    for (const rotation of ROTATIONS) {
      for (const scale of [0.5, 1, 1.3333, 3]) {
        const options: ViewportOptions = { scale, rotation };
        it(`round-trips page ${page.index} rotation ${rotation} scale ${scale}`, () => {
          const back = fromViewportRect(toViewportRect(RECT, page, options), page, options);
          expectRectClose(back, RECT);
        });
      }
    }
  }

  it('keeps the rectangle inside the viewport for every rotation', () => {
    for (const rotation of ROTATIONS) {
      const options: ViewportOptions = { scale: 1.5, rotation };
      const size = getViewportSize(A4, options);
      const view = toViewportRect({ x: 0, y: 0, width: 1, height: 1 }, A4, options);
      expectRectClose(view, { x: 0, y: 0, width: size.width, height: size.height });
    }
  });

  it('round-trips points (pointer events)', () => {
    for (const rotation of ROTATIONS) {
      const options: ViewportOptions = { scale: 1.25, rotation };
      const point = { x: 0.25, y: 0.75 };
      const back = fromViewportPoint(toViewportPoint(point, A4, options), A4, options);
      expect(back.x).toBeCloseTo(point.x, 9);
      expect(back.y).toBeCloseTo(point.y, 9);
    }
  });

  it('is independent of zoom once normalized', () => {
    const small = fromViewportRect(toViewportRect(RECT, A4, { scale: 1, rotation: 90 }), A4, {
      scale: 1,
      rotation: 90,
    });
    const large = fromViewportRect(toViewportRect(RECT, A4, { scale: 4, rotation: 90 }), A4, {
      scale: 4,
      rotation: 90,
    });
    expectRectClose(small, large);
  });
});

describe('PDF user space conversion', () => {
  it('flips the Y axis for an unrotated page', () => {
    const pdf = toPdfUserSpace(RECT, A4);
    expectRectClose(pdf, { x: 59.5, y: 842 - 168.4 - 84.2, width: 178.5, height: 84.2 });
    expect(pdf.pageRotation).toBe(0);
  });

  it('places the visual top-left corner at the raw bottom-left for /Rotate 90', () => {
    const pdf = toPdfUserSpace({ x: 0, y: 0, width: 0.1, height: 0.1 }, A4_ROTATED_90);
    expectRectClose(pdf, { x: 0, y: 0, width: 84.2, height: 59.5 });
    expect(pdf.pageRotation).toBe(90);
  });

  it('respects a CropBox that does not start at the origin', () => {
    const page: PageInfo = { ...A4, view: [10, 20, 605, 862] };
    const pdf = toPdfUserSpace({ x: 0, y: 0, width: 0.5, height: 0.5 }, page);
    // top-left of the CropBox is (10, 862); rect is 297.5 x 421 below it.
    expectRectClose(pdf, { x: 10, y: 862 - 421, width: 297.5, height: 421 });
  });

  for (const page of PAGES) {
    it(`round-trips page ${page.index} (rotation ${page.rotation})`, () => {
      expectRectClose(fromPdfUserSpace(toPdfUserSpace(RECT, page), page), RECT);
    });
  }

  it('keeps the placement anchored to the same visual spot as the viewport', () => {
    // The centre of the placement, seen in the viewport and in PDF space, must
    // describe the same point of the page for every intrinsic rotation.
    for (const page of PAGES) {
      const pdf = toPdfUserSpace(RECT, page);
      const back = fromPdfUserSpace(pdf, page);
      const view = toViewportRect(back, page, { scale: 1, rotation: 0 });
      expectRectClose(view, {
        x: RECT.x * page.width,
        y: RECT.y * page.height,
        width: RECT.width * page.width,
        height: RECT.height * page.height,
      });
    }
  });
});

describe('clampNormalizedRect', () => {
  it('moves rectangles that overflow back inside the page', () => {
    expect(clampNormalizedRect({ x: 0.9, y: -0.2, width: 0.3, height: 0.2 })).toEqual({
      x: 0.7,
      y: 0,
      width: 0.3,
      height: 0.2,
    });
  });

  it('shrinks rectangles larger than the page', () => {
    expect(clampNormalizedRect({ x: 0.2, y: 0.2, width: 2, height: 0.5 })).toEqual({
      x: 0,
      y: 0.2,
      width: 1,
      height: 0.5,
    });
  });
});
