import type { PageInfo, PdfSource, Rotation } from '../models';

/** How a page should be drawn into a canvas. */
export interface RenderOptions {
  /** CSS pixels per PDF point. */
  readonly scale: number;
  /** Viewer rotation on top of the page's intrinsic rotation. */
  readonly rotation: Rotation;
  /** Device pixel ratio used to size the canvas backing store. Defaults to 1. */
  readonly pixelRatio?: number;
}

/** A render in progress: await `done` or call `cancel()`. */
export interface RenderHandle {
  /** Settles when drawing finished. Rejects with {@link RenderCancelledError} if cancelled. */
  readonly done: Promise<void>;
  cancel(): void;
}

/** Rejection reason of `RenderHandle.done` when a render was cancelled. */
export class RenderCancelledError extends Error {
  constructor() {
    super('Render cancelled');
    this.name = 'RenderCancelledError';
  }
}

/** A loaded document. All pages are addressed by zero-based index. */
export interface PdfDocumentHandle {
  readonly pageCount: number;
  getPageInfo(pageIndex: number): Promise<PageInfo>;
  /** Draws the page into `canvas`, resizing its backing store as needed. */
  renderPage(pageIndex: number, canvas: HTMLCanvasElement, options: RenderOptions): RenderHandle;
  /** The original bytes, needed later by the writer. */
  getData(): Promise<Uint8Array>;
  destroy(): Promise<void>;
}

/**
 * Port implemented by rendering engines. The PDF.js adapter lives in
 * `signora-pdf/pdfjs`; implement this to plug in any other engine.
 */
export interface PdfRenderingPort {
  load(source: PdfSource): Promise<PdfDocumentHandle>;
}
