import type {
  PageInfo,
  PdfDocumentHandle,
  PdfRenderingPort,
  RenderHandle,
  SignatureAsset,
} from 'signora-pdf';

/** Test doubles shared by the UI specs. Excluded from the published package. */

export const A4: PageInfo = {
  index: 0,
  width: 595,
  height: 842,
  rotation: 0,
  view: [0, 0, 595, 842],
};

export const ASSET: SignatureAsset = {
  id: 'asset-1',
  kind: 'drawn',
  label: 'Ada',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  aspectRatio: 3,
};

export class FakeHandle implements PdfDocumentHandle {
  readonly rendered: number[] = [];
  destroyed = false;
  constructor(readonly pageCount = 3) {}
  getPageInfo(index: number): Promise<PageInfo> {
    return Promise.resolve({ ...A4, index });
  }
  renderPage(index: number): RenderHandle {
    this.rendered.push(index);
    return { done: Promise.resolve(), cancel: () => undefined };
  }
  getData(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
  }
  destroy(): Promise<void> {
    this.destroyed = true;
    return Promise.resolve();
  }
}

/** A renderer whose loads are settled by the test, to observe the loading state. */
export class FakeRenderer implements PdfRenderingPort {
  static pending: { resolve: (h: FakeHandle) => void; reject: (e: unknown) => void }[] = [];
  static reset(): void {
    FakeRenderer.pending = [];
  }
  load(): Promise<PdfDocumentHandle> {
    return new Promise((resolve, reject) => FakeRenderer.pending.push({ resolve, reject }));
  }
}

/** A renderer that resolves immediately with a fresh handle. */
export class InstantRenderer implements PdfRenderingPort {
  static last: FakeHandle | null = null;
  load(): Promise<PdfDocumentHandle> {
    InstantRenderer.last = new FakeHandle();
    return Promise.resolve(InstantRenderer.last);
  }
}

/** Dispatches a pointer-like event. jsdom has no PointerEvent, and Angular listens by type. */
export function pointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
): void {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
  );
}

export function key(target: Element, name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}
