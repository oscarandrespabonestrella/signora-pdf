import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  CSS_UNITS,
  SigningSession,
  normalizedHeightRatio,
  provideSignora,
  withRenderer,
  type NormalizedRect,
  type PageInfo,
} from 'signora-pdf';
import { A4, ASSET, InstantRenderer, key, pointer } from './fake-pdf.testing';
import { SignoraSignatureLayerComponent } from './signature-layer.component';

@Component({
  imports: [SignoraSignatureLayerComponent],
  template: `<signora-signature-layer [pageIndex]="0" [info]="info()" />`,
})
class Host {
  readonly info = signal<PageInfo | null>(A4);
}

const S = CSS_UNITS; // px per point at 100% zoom
// Proportions must match the asset (3:1), as placements created by the library always do.
const RECT: NormalizedRect = {
  x: 0.2,
  y: 0.3,
  width: 0.25,
  height: 0.25 * normalizedHeightRatio(A4, ASSET.aspectRatio),
};

describe('SignoraSignatureLayerComponent', () => {
  let fixture: ComponentFixture<Host>;
  let session: SigningSession;

  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const el = <T extends HTMLElement>(selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
  const placement = () => session.placements()[0];
  const addPlacement = (id = 'p1', pageIndex = 0) =>
    session.addPlacement({ id, asset: ASSET, pageIndex, rect: RECT });

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideSignora(withRenderer(InstantRenderer))] });
    session = TestBed.inject(SigningSession);
    await session.load('doc.pdf');
    fixture = TestBed.createComponent(Host);
    await settle();
  });

  describe('rendering', () => {
    it('renders nothing until the page geometry is known', async () => {
      addPlacement();
      fixture.componentInstance.info.set(null);
      await settle();
      expect(el('.placement')).toBeNull();
    });

    it('renders only the placements of its page, with accessible names', async () => {
      addPlacement('here', 0);
      addPlacement('elsewhere', 1);
      await settle();
      const items = fixture.nativeElement.querySelectorAll('.placement');
      expect(items.length).toBe(1);
      expect(items[0].getAttribute('role')).toBe('group');
      expect(items[0].getAttribute('aria-label')).toBe('Ada 1');
    });

    it('positions the box from the normalized rectangle, zoom and rotation', async () => {
      addPlacement();
      await settle();
      const box = el('.placement')!;
      expect(Number.parseFloat(box.style.left)).toBeCloseTo(RECT.x * A4.width * S, 2);
      expect(Number.parseFloat(box.style.width)).toBeCloseTo(RECT.width * A4.width * S, 2);

      session.rotateClockwise();
      await settle();
      // Rotated 90°: box width becomes the placement's height in page units.
      expect(Number.parseFloat(el('.placement')!.style.width)).toBeCloseTo(
        RECT.height * A4.height * S,
        2,
      );
      expect(el('.art')!.style.transform).toContain('rotate(90deg)');
    });

    it('shows handles and a remove button only for the selected placement', async () => {
      addPlacement();
      await settle();
      expect(fixture.nativeElement.querySelectorAll('.handle').length).toBe(0);
      session.selectPlacement('p1');
      await settle();
      expect(fixture.nativeElement.querySelectorAll('.handle').length).toBe(4);
      expect(el('.remove')).not.toBeNull();
    });
  });

  describe('placing', () => {
    it('places the armed asset centred on the click and selects it', async () => {
      session.arm(ASSET);
      await settle();
      pointer(el('.layer')!, 'pointerdown', 400, 300);
      await settle();

      expect(session.placements().length).toBe(1);
      const { rect, pageIndex } = placement();
      expect(pageIndex).toBe(0);
      expect(rect.x + rect.width / 2).toBeCloseTo(400 / (A4.width * S), 6);
      expect(rect.y + rect.height / 2).toBeCloseTo(300 / (A4.height * S), 6);
      expect(session.selectedPlacementId()).toBe(placement().id);
      expect(session.armedAsset()).toBeNull();
    });

    it('keeps the asset proportions', async () => {
      session.arm(ASSET); // aspect 3
      pointer(el('.layer')!, 'pointerdown', 400, 300);
      const { rect } = placement();
      expect((rect.width * A4.width) / (rect.height * A4.height)).toBeCloseTo(3, 6);
    });

    it('places at the right spot even when the view is rotated', async () => {
      session.setRotation(180);
      session.arm(ASSET);
      await settle();
      // Viewport click at (100, 100) of a page rotated 180° is near the page's bottom-right.
      pointer(el('.layer')!, 'pointerdown', 100, 100);
      const { rect } = placement();
      expect(rect.x + rect.width / 2).toBeCloseTo(1 - 100 / (A4.width * S), 6);
      expect(rect.y + rect.height / 2).toBeCloseTo(1 - 100 / (A4.height * S), 6);
    });

    it('deselects when clicking the empty page and nothing is armed', async () => {
      addPlacement();
      session.selectPlacement('p1');
      await settle();
      pointer(el('.layer')!, 'pointerdown', 10, 10);
      expect(session.selectedPlacementId()).toBeNull();
      expect(session.placements().length).toBe(1);
    });
  });

  describe('pointer interaction', () => {
    it('moves a placement by the pointer delta, clamped to the page', async () => {
      addPlacement();
      await settle();
      const box = el('.placement')!;
      pointer(box, 'pointerdown', 200, 200);
      pointer(box, 'pointermove', 260, 300);
      expect(placement().rect.x).toBeCloseTo(RECT.x + 60 / (A4.width * S), 6);
      expect(placement().rect.y).toBeCloseTo(RECT.y + 100 / (A4.height * S), 6);

      pointer(box, 'pointermove', 99999, 99999);
      expect(placement().rect.x + placement().rect.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(placement().rect.y + placement().rect.height).toBeLessThanOrEqual(1 + 1e-9);

      pointer(box, 'pointerup', 0, 0);
      const settled = placement().rect;
      pointer(box, 'pointermove', 10, 10); // after release: ignored
      expect(placement().rect).toEqual(settled);
    });

    it('selects on pointer down', async () => {
      addPlacement();
      await settle();
      pointer(el('.placement')!, 'pointerdown', 200, 200);
      expect(session.selectedPlacementId()).toBe('p1');
    });

    it('resizes from the south-east handle keeping proportions and the north-west corner', async () => {
      addPlacement();
      session.selectPlacement('p1');
      await settle();
      const before = placement().rect;
      const handle = el('.handle[data-corner="se"]')!;
      const startX = (before.x + before.width) * A4.width * S;
      const startY = (before.y + before.height) * A4.height * S;

      pointer(handle, 'pointerdown', startX, startY);
      pointer(handle, 'pointermove', startX + 60, startY);
      const after = placement().rect;
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
      expect(after.width).toBeCloseTo(before.width + 60 / (A4.width * S), 6);
      expect(after.height / after.width).toBeCloseTo(before.height / before.width, 9);
    });

    it('puts handles on the true visual corners when rotated', async () => {
      addPlacement();
      session.selectPlacement('p1');
      session.setRotation(90);
      await settle();
      // The normalized north-west corner of a 90° view is the visual north-east one.
      const nw = el('.handle[data-corner="nw"]')!;
      const box = el('.placement')!;
      expect(Number.parseFloat(nw.style.left)).toBeCloseTo(Number.parseFloat(box.style.width), 2);
      expect(Number.parseFloat(nw.style.top)).toBeCloseTo(0, 2);
    });
  });

  describe('keyboard', () => {
    beforeEach(async () => {
      addPlacement();
      await settle();
    });

    it('nudges by 4px and by 20px with Shift, in what the user sees', async () => {
      const box = el('.placement')!;
      key(box, 'ArrowRight');
      expect(placement().rect.x).toBeCloseTo(RECT.x + 4 / (A4.width * S), 6);
      key(box, 'ArrowDown', { shiftKey: true });
      expect(placement().rect.y).toBeCloseTo(RECT.y + 20 / (A4.height * S), 6);
    });

    it('follows the visual direction when the view is rotated 90°', async () => {
      session.setRotation(90);
      await settle();
      const box = el('.placement')!;
      // Rotated clockwise: visual right is the page's "up", visual down is the page's "right".
      key(box, 'ArrowRight');
      expect(placement().rect.y).toBeCloseTo(RECT.y - 4 / (A4.height * S), 6);
      expect(placement().rect.x).toBeCloseTo(RECT.x, 9);
      key(box, 'ArrowDown');
      expect(placement().rect.x).toBeCloseTo(RECT.x + 4 / (A4.width * S), 6);
    });

    it('scales with + and -', async () => {
      const box = el('.placement')!;
      key(box, '+');
      expect(placement().rect.width).toBeCloseTo(RECT.width * 1.05, 6);
      key(box, '-');
      key(box, '-');
      expect(placement().rect.width).toBeCloseTo(RECT.width * 1.05 * 0.95 * 0.95, 6);
    });

    it('deletes with Delete and Backspace and prevents page navigation keys from bubbling', async () => {
      const event = key(el('.placement')!, 'ArrowLeft');
      expect(event.defaultPrevented).toBe(true);
      key(el('.placement')!, 'Delete');
      expect(session.placements().length).toBe(0);
      await settle();
      addPlacement('p2');
      await settle();
      key(el('.placement')!, 'Backspace');
      expect(session.placements().length).toBe(0);
    });

    it('deselects with Escape', async () => {
      el('.placement')!.focus();
      expect(session.selectedPlacementId()).toBe('p1');
      key(el('.placement')!, 'Escape');
      expect(session.selectedPlacementId()).toBeNull();
    });

    it('ignores unrelated keys and modified shortcuts', async () => {
      const box = el('.placement')!;
      expect(key(box, 'a').defaultPrevented).toBe(false);
      expect(key(box, 'Delete', { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(session.placements().length).toBe(1);
    });

    it('removes with the on-screen button', async () => {
      session.selectPlacement('p1');
      await settle();
      el<HTMLButtonElement>('.remove')!.click();
      expect(session.placements().length).toBe(0);
    });
  });
});
