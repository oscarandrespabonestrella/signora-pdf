import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  SigningSession,
  provideSignora,
  withOrganizationSignatures,
  withRenderer,
  type PlacedSignature,
  type SignatureCoordinates,
} from 'signora-pdf';
import { ASSET, InstantRenderer, pointer } from './fake-pdf.testing';
import type { SignatureMode } from './signature-panel.component';
import type { PreloadedSignature } from './signature-preload';
import { SignoraViewerComponent, type ViewMode } from './viewer.component';

@Component({
  imports: [SignoraViewerComponent],
  template: `<signora-viewer
    source="x.pdf"
    [viewMode]="mode()"
    [showSignaturePanel]="true"
    [signatureModes]="modes()"
    [preloadedSignatures]="preloaded()"
    [readOnly]="readOnly()"
    [coordinatesIncludeImages]="withImages()"
    (placementsChange)="changes.push($event)"
    (coordinatesChange)="coords.push($event)"
  />`,
})
class Host {
  readonly mode = signal<ViewMode>('paged');
  readonly modes = signal<readonly SignatureMode[]>(['upload', 'other']);
  readonly preloaded = signal<readonly PreloadedSignature[]>([]);
  readonly readOnly = signal(false);
  readonly withImages = signal(false);
  readonly changes: (readonly PlacedSignature[])[] = [];
  readonly coords: (readonly SignatureCoordinates[])[] = [];
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
}
const all = (fixture: ComponentFixture<unknown>, selector: string) =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(selector));

describe('viewer view mode, signature modes and preloading', () => {
  let fixture: ComponentFixture<Host>;
  let session: SigningSession;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideSignora(
          withRenderer(InstantRenderer),
          withOrganizationSignatures({
            label: 'Acme',
            assets: [{ id: 'o1', kind: 'organization', dataUrl: 'data:,a', aspectRatio: 2 }],
          }),
        ),
      ],
    });
    fixture = TestBed.createComponent(Host);
    session = TestBed.inject(SigningSession);
    await settle(fixture);
  });

  it('shows one page when paged and every page when continuous', async () => {
    expect(all(fixture, 'signora-page').length).toBe(1);
    fixture.componentInstance.mode.set('continuous');
    await settle(fixture);
    expect(all(fixture, 'signora-page').length).toBe(3);
    expect(all(fixture, '.page-box').map((b) => b.dataset['page'])).toEqual(['1', '2', '3']);
    fixture.componentInstance.mode.set('paged');
    await settle(fixture);
    expect(all(fixture, 'signora-page').length).toBe(1);
  });

  it('keeps one signature layer per page in continuous mode', async () => {
    fixture.componentInstance.mode.set('continuous');
    await settle(fixture);
    expect(all(fixture, 'signora-signature-layer').length).toBe(3);
  });

  it('only offers the enabled signature modes', async () => {
    const tabs = () => all(fixture, '[role=tab]').map((t) => t.textContent?.trim());
    expect(tabs()).toEqual(['Upload', 'Acme']);

    fixture.componentInstance.modes.set(['upload']);
    await settle(fixture);
    expect(tabs()).toEqual(['Upload']);

    fixture.componentInstance.modes.set(['other']);
    await settle(fixture);
    expect(tabs()).toEqual(['Acme']);
    expect(all(fixture, '[role=tab][aria-selected=true]').length).toBe(1);
  });

  it('shows no tabs when every mode is disabled, keeping the library', async () => {
    fixture.componentInstance.modes.set([]);
    await settle(fixture);
    expect(all(fixture, '[role=tab]').length).toBe(0);
    expect(all(fixture, 'signora-signature-panel').length).toBe(1);
  });

  it('preloads several signatures at once into the library', async () => {
    fixture.componentInstance.preloaded.set([
      ASSET,
      { ...ASSET, id: 'asset-2', label: 'Grace' },
      { ...ASSET, id: 'asset-3', label: 'Alan' },
    ]);
    await settle(fixture);
    expect(session.assets().map((a) => a.id)).toEqual(['asset-1', 'asset-2', 'asset-3']);
    fixture.detectChanges();
    expect(all(fixture, '.library-item').length).toBe(3);
  });

  it('emits placementsChange', async () => {
    const before = fixture.componentInstance.changes.length;
    session.addPlacement({
      id: 'p',
      asset: ASSET,
      pageIndex: 0,
      rect: { x: 0, y: 0, width: 0.2, height: 0.1 },
    });
    await settle(fixture);
    expect(fixture.componentInstance.changes.length).toBeGreaterThan(before);
    expect(fixture.componentInstance.changes.at(-1)?.map((p) => p.id)).toEqual(['p']);
  });

  const place = () =>
    session.addPlacement({
      id: 'p',
      asset: ASSET,
      pageIndex: 0,
      rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
    });

  it('emits coordinatesChange without images by default, and with them on request', async () => {
    place();
    await settle(fixture);
    const last = () => fixture.componentInstance.coords.at(-1)!;
    expect(last()).toHaveLength(1);
    expect(last()[0]).toMatchObject({ id: 'p', assetId: 'asset-1', pageIndex: 0 });
    expect(last()[0].pdf.pageRotation).toBe(0);
    expect('dataUrl' in last()[0]).toBe(false);

    fixture.componentInstance.withImages.set(true);
    await settle(fixture);
    expect(last()[0].dataUrl).toBe(ASSET.dataUrl);

    session.removePlacement('p');
    await settle(fixture);
    expect(last()).toEqual([]);
  });

  describe('read-only', () => {
    beforeEach(async () => {
      place();
      fixture.componentInstance.readOnly.set(true);
      await settle(fixture);
    });

    it('hides the signature panel but still shows the placed signature', () => {
      expect(all(fixture, 'signora-signature-panel').length).toBe(0);
      expect(all(fixture, '[data-signora-placement]').length).toBe(1);
    });

    it('does not allow selecting, editing or removing', async () => {
      const placement = all(fixture, '[data-signora-placement]')[0];
      expect(placement.hasAttribute('tabindex')).toBe(false);
      pointer(placement, 'pointerdown', 10, 10);
      placement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      await settle(fixture);
      expect(session.placements()).toHaveLength(1);
      expect(session.selectedPlacementId()).toBeNull();
      expect(all(fixture, '.handle, .remove').length).toBe(0);
    });

    it('disarms a pending signature and ignores clicks on the page', async () => {
      fixture.componentInstance.readOnly.set(false);
      await settle(fixture);
      session.arm(ASSET);
      fixture.componentInstance.readOnly.set(true);
      await settle(fixture);
      expect(session.armedAsset()).toBeNull();
      session.arm(ASSET); // armed through the API: the layer still refuses to place
      const layer = all(fixture, '.layer')[0];
      pointer(layer, 'pointerdown', 50, 50);
      await settle(fixture);
      expect(session.placements()).toHaveLength(1);
    });
  });
});
