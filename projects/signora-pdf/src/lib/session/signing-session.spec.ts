import { TestBed } from '@angular/core/testing';
import type { PageInfo } from '../models';
import type { PdfDocumentHandle, PdfRenderingPort } from '../ports';
import { provideSignora, withRenderer, withWriter } from '../providers';
import { MAX_ZOOM, MIN_ZOOM, SigningSession } from './signing-session';

class FakeHandle implements PdfDocumentHandle {
  destroyed = false;
  constructor(readonly pageCount: number) {}
  getPageInfo(index: number): Promise<PageInfo> {
    return Promise.resolve({
      index,
      width: 595,
      height: 842,
      rotation: 0,
      view: [0, 0, 595, 842],
    });
  }
  renderPage(): never {
    throw new Error('not needed');
  }
  getData(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }
  destroy(): Promise<void> {
    this.destroyed = true;
    return Promise.resolve();
  }
}

class FakeRenderer implements PdfRenderingPort {
  static pending: { resolve: (h: FakeHandle) => void; reject: (e: unknown) => void }[] = [];
  load(): Promise<PdfDocumentHandle> {
    return new Promise((resolve, reject) => FakeRenderer.pending.push({ resolve, reject }));
  }
}

describe('SigningSession', () => {
  let session: SigningSession;

  beforeEach(() => {
    FakeRenderer.pending = [];
    TestBed.configureTestingModule({ providers: [provideSignora(withRenderer(FakeRenderer))] });
    session = TestBed.inject(SigningSession);
  });

  async function loadWith(pages: number): Promise<FakeHandle> {
    const loading = session.load('x.pdf');
    const handle = new FakeHandle(pages);
    FakeRenderer.pending.at(-1)!.resolve(handle);
    await loading;
    return handle;
  }

  it('starts idle and ready after loading', async () => {
    expect(session.status()).toBe('idle');
    await loadWith(3);
    expect(session.status()).toBe('ready');
    expect(session.pageCount()).toBe(3);
    expect(session.currentPage()).toBe(1);
  });

  it('clamps page navigation to the document', async () => {
    await loadWith(3);
    session.goToPage(99);
    expect(session.currentPage()).toBe(3);
    session.nextPage();
    expect(session.currentPage()).toBe(3);
    expect(session.canGoNext()).toBe(false);
    session.goToPage(-4);
    expect(session.currentPage()).toBe(1);
    expect(session.canGoPrevious()).toBe(false);
  });

  it('clamps zoom and derives the viewport scale', () => {
    session.setZoom(100);
    expect(session.zoom()).toBe(MAX_ZOOM);
    expect(session.canZoomIn()).toBe(false);
    session.setZoom(0);
    expect(session.zoom()).toBe(MIN_ZOOM);
    session.setZoom(1);
    expect(session.viewport().scale).toBeCloseTo(96 / 72);
  });

  it('wraps rotation in both directions', () => {
    session.rotateClockwise();
    expect(session.rotation()).toBe(90);
    session.rotateCounterClockwise();
    session.rotateCounterClockwise();
    expect(session.rotation()).toBe(270);
  });

  it('discards a stale load and releases its handle', async () => {
    const first = session.load('a.pdf');
    const second = session.load('b.pdf');
    const staleHandle = new FakeHandle(1);
    const currentHandle = new FakeHandle(5);
    FakeRenderer.pending[0].resolve(staleHandle);
    FakeRenderer.pending[1].resolve(currentHandle);
    await Promise.all([first, second]);
    expect(staleHandle.destroyed).toBe(true);
    expect(session.pageCount()).toBe(5);
  });

  it('resets the page and rotation when a new document loads', async () => {
    await loadWith(3);
    session.goToPage(3);
    session.rotateClockwise();
    await loadWith(2);
    expect(session.currentPage()).toBe(1);
    expect(session.rotation()).toBe(0);
  });

  it('releases the previous document when a new one loads', async () => {
    const previous = await loadWith(2);
    await loadWith(4);
    expect(previous.destroyed).toBe(true);
  });

  it('reports load errors', async () => {
    const loading = session.load('broken.pdf');
    FakeRenderer.pending[0].reject(new Error('boom'));
    await loading;
    expect(session.status()).toBe('error');
    expect(session.error()).toBeInstanceOf(Error);
  });

  it('manages placements', async () => {
    await loadWith(1);
    const placement = {
      id: 'p1',
      pageIndex: 0,
      rect: { x: 0, y: 0, width: 0.2, height: 0.1 },
      asset: { id: 'a', kind: 'drawn', dataUrl: 'data:,', aspectRatio: 2 },
    } as const;
    session.addPlacement(placement);
    session.updatePlacement('p1', {
      pageIndex: 0,
      rect: { x: 0.5, y: 0.5, width: 0.2, height: 0.1 },
    });
    expect(session.placements()[0].rect.x).toBe(0.5);
    session.removePlacement('p1');
    expect(session.placements()).toEqual([]);
  });

  it('closes the document', async () => {
    const handle = await loadWith(2);
    await session.close();
    expect(handle.destroyed).toBe(true);
    expect(session.status()).toBe('idle');
    expect(session.hasDocument()).toBe(false);
  });

  describe('exportPdf', () => {
    const placement = {
      id: 'p',
      pageIndex: 0,
      rect: { x: 0, y: 0, width: 0.1, height: 0.1 },
      asset: { id: 'a', kind: 'drawn', dataUrl: 'data:,', aspectRatio: 1 },
    } as const;

    it('rejects without a document', async () => {
      await expect(session.exportPdf()).rejects.toThrow('no document');
    });

    it('rejects with a helpful message when no writer is registered', async () => {
      await loadWith(1);
      await expect(session.exportPdf()).rejects.toThrow('withPdfLibWriter');
    });

    it('hands the original bytes and the placements to the writer', async () => {
      const calls: { bytes: Uint8Array; count: number }[] = [];
      class FakeWriter {
        applyVisualSignatures(bytes: Uint8Array, placements: readonly unknown[]) {
          calls.push({ bytes, count: placements.length });
          return Promise.resolve(new Uint8Array([1, 2, 3]));
        }
      }
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideSignora(withRenderer(FakeRenderer), withWriter(FakeWriter))],
      });
      session = TestBed.inject(SigningSession);
      await loadWith(1);
      session.addPlacement(placement);
      expect(await session.exportPdf()).toEqual(new Uint8Array([1, 2, 3]));
      expect(calls).toEqual([{ bytes: new Uint8Array(), count: 1 }]);
    });
  });

  describe('signature library', () => {
    const asset = { id: 'a1', kind: 'drawn', dataUrl: 'data:,', aspectRatio: 2 } as const;
    const placement = {
      id: 'p',
      asset,
      pageIndex: 0,
      rect: { x: 0, y: 0, width: 0.1, height: 0.1 },
    } as const;

    it('dedupes assets by id and arms them', () => {
      session.addAsset(asset);
      session.addAsset({ ...asset, label: 'dup' });
      expect(session.assets().length).toBe(1);
      session.arm(asset);
      expect(session.armedAsset()?.id).toBe('a1');
      session.arm(null);
      expect(session.armedAsset()).toBeNull();
    });

    it('clears the armed asset when it is removed', () => {
      session.arm(asset);
      session.removeAsset('a1');
      expect(session.armedAsset()).toBeNull();
      expect(session.assets()).toEqual([]);
    });

    it('selects placements and clears the selection when one is removed', async () => {
      await loadWith(1);
      session.addPlacement(placement);
      session.selectPlacement('p');
      expect(session.selectedPlacement()?.id).toBe('p');
      session.removePlacement('p');
      expect(session.selectedPlacementId()).toBeNull();
    });

    it('keeps the library but drops placements and armed state when a document loads', async () => {
      await loadWith(1);
      session.arm(asset);
      session.addPlacement(placement);
      await loadWith(2);
      expect(session.placements()).toEqual([]);
      expect(session.armedAsset()).toBeNull();
      expect(session.assets().length).toBe(1);
    });
  });
  describe('preloading and coordinates', () => {
    const asset = (id: string) => ({
      id,
      kind: 'typed',
      label: id,
      dataUrl: 'data:image/png;base64,AA==',
      aspectRatio: 2,
    });

    it('addAssets adds several assets at once and ignores known ids', () => {
      session.addAsset(asset('a'));
      session.addAssets([asset('a'), asset('b'), asset('b'), asset('c')]);
      expect(session.assets().map((a) => a.id)).toEqual(['a', 'b', 'c']);
    });

    it('exportCoordinates needs no writer and omits images by default', async () => {
      await loadWith(2);
      session.addPlacement({
        id: 'p1',
        asset: asset('a'),
        pageIndex: 1,
        rect: { x: 0.1, y: 0.2, width: 0.25, height: 0.05 },
      });
      const [c] = await session.exportCoordinates();
      expect(c).toMatchObject({
        id: 'p1',
        assetId: 'a',
        pageIndex: 1,
        page: { width: 595, height: 842, rotation: 0 },
        normalized: { x: 0.1, y: 0.2, width: 0.25, height: 0.05 },
      });
      expect(c.pdf.x).toBeCloseTo(59.5);
      expect(c.pdf.y).toBeCloseTo(842 - 0.2 * 842 - 0.05 * 842);
      expect('dataUrl' in c).toBe(false);
      const [withImage] = await session.exportCoordinates({ includeImages: true });
      expect(withImage.dataUrl).toBe('data:image/png;base64,AA==');
    });

    it('exportCoordinates rejects without a document', async () => {
      await expect(session.exportCoordinates()).rejects.toThrow(/no document/);
    });
  });
});
