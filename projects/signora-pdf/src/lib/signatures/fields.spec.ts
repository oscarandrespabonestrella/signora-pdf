import { MIN_FIELD_SIZE, createFieldRect, fitRectInField, resizeFieldFromCorner } from './fields';

const A4 = { width: 595, height: 842 };

describe('signature field geometry', () => {
  it('fits a wide signature to the width of a field and centres it vertically', () => {
    const field = { x: 0.1, y: 0.2, width: 0.3, height: 0.2 };
    const rect = fitRectInField(field, { aspectRatio: 4 }, A4);
    expect(rect.width).toBeCloseTo(0.3);
    expect(rect.height).toBeLessThan(0.2);
    expect(rect.x).toBeCloseTo(0.1);
    expect(rect.y + rect.height / 2).toBeCloseTo(0.3);
  });

  it('fits a tall signature to the height of a field and centres it horizontally', () => {
    const field = { x: 0.1, y: 0.2, width: 0.3, height: 0.05 };
    const rect = fitRectInField(field, { aspectRatio: 1 }, A4);
    expect(rect.height).toBeCloseTo(0.05);
    expect(rect.width).toBeLessThan(0.3);
    expect(rect.x + rect.width / 2).toBeCloseTo(0.25);
  });

  it('keeps the signature proportions in PDF points', () => {
    const field = { x: 0, y: 0, width: 0.5, height: 0.5 };
    const rect = fitRectInField(field, { aspectRatio: 3 }, A4);
    expect((rect.width * A4.width) / (rect.height * A4.height)).toBeCloseTo(3);
  });

  it('creates new fields inside the page', () => {
    const rect = createFieldRect(A4, { x: 0.99, y: 0.01 });
    expect(rect.x + rect.width).toBeLessThanOrEqual(1);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect((rect.width * A4.width) / (rect.height * A4.height)).toBeCloseTo(3);
  });
});

describe('resizeFieldFromCorner', () => {
  const rect = { x: 0.2, y: 0.2, width: 0.3, height: 0.1 };

  it('keeps the opposite corner fixed', () => {
    const next = resizeFieldFromCorner(rect, 'se', { x: 0.7, y: 0.4 });
    expect(next).toMatchObject({ x: 0.2, y: 0.2 });
    expect(next.width).toBeCloseTo(0.5);
    expect(next.height).toBeCloseTo(0.2);
  });

  it('can be dragged past the anchor, flipping the box', () => {
    const next = resizeFieldFromCorner(rect, 'nw', { x: 0.6, y: 0.5 });
    expect(next.x).toBeCloseTo(0.5);
    expect(next.y).toBeCloseTo(0.3);
  });

  it('never gets smaller than the minimum and stays inside the page', () => {
    const tiny = resizeFieldFromCorner(rect, 'se', { x: 0.2, y: 0.2 });
    expect(tiny.width).toBeGreaterThanOrEqual(MIN_FIELD_SIZE);
    const outside = resizeFieldFromCorner(rect, 'se', { x: 5, y: -3 });
    expect(outside.x + outside.width).toBeLessThanOrEqual(1);
    expect(outside.y).toBeGreaterThanOrEqual(0);
  });
});
