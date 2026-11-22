import { toPdfUserSpace, type NormalizedRect, type PageInfo, type Rotation } from 'signora-pdf';
import { computeImageDrawing, imageCorners } from './placement-transform';

const RECT: NormalizedRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };

function page(rotation: Rotation, view: PageInfo['view']): PageInfo {
  const w = view[2] - view[0];
  const h = view[3] - view[1];
  const swap = rotation === 90 || rotation === 270;
  return { index: 0, width: swap ? h : w, height: swap ? w : h, rotation, view };
}

describe('computeImageDrawing', () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    for (const view of [
      [0, 0, 595, 842],
      [20, 30, 720, 530],
    ] as const) {
      it(`fills the target box exactly for /Rotate ${rotation}, view ${view.join(',')}`, () => {
        const info = page(rotation, view);
        const box = toPdfUserSpace(RECT, info);
        const corners = imageCorners(computeImageDrawing(RECT, info));
        const xs = corners.map((c) => c[0]);
        const ys = corners.map((c) => c[1]);
        expect(Math.min(...xs)).toBeCloseTo(box.x, 6);
        expect(Math.max(...xs)).toBeCloseTo(box.x + box.width, 6);
        expect(Math.min(...ys)).toBeCloseTo(box.y, 6);
        expect(Math.max(...ys)).toBeCloseTo(box.y + box.height, 6);
      });
    }
  }

  it('keeps the image size as the reader sees it', () => {
    const info = page(90, [0, 0, 595, 842]);
    const drawing = computeImageDrawing(RECT, info);
    expect(drawing.width).toBeCloseTo(RECT.width * info.width, 6);
    expect(drawing.height).toBeCloseTo(RECT.height * info.height, 6);
  });

  it('puts the image top-left corner at the visual top-left of the rectangle', () => {
    // Image corner TL = index 3. For each rotation, mapping it back to the
    // visual page (via fromPdf) must give the rectangle's top-left.
    for (const rotation of [0, 90, 180, 270] as const) {
      const info = page(rotation, [0, 0, 595, 842]);
      const [tlX, tlY] = imageCorners(computeImageDrawing(RECT, info))[3];
      const [x0, , , y1] = info.view;
      const rawX = tlX - x0;
      const rawY = y1 - tlY; // raw, top-left origin
      const rawW = rotation % 180 ? info.height : info.width;
      const rawH = rotation % 180 ? info.width : info.height;
      const visual = {
        0: [rawX, rawY],
        90: [rawH - rawY, rawX],
        180: [rawW - rawX, rawH - rawY],
        270: [rawY, rawW - rawX],
      }[rotation];
      expect(visual[0] / info.width).toBeCloseTo(RECT.x, 6);
      expect(visual[1] / info.height).toBeCloseTo(RECT.y, 6);
    }
  });
});
