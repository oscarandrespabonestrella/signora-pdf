import { Injectable, InjectionToken, inject } from '@angular/core';
import {
  RenderCancelledError,
  createSignoraFeature,
  normalizeRotation,
  SIGNORA_RENDERER,
  type PageInfo,
  type PdfDocumentHandle,
  type PdfRenderingPort,
  type PdfSource,
  type RenderHandle,
  type RenderOptions,
  type SignoraFeature,
} from 'signora-pdf';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

/** Options of {@link withPdfJsRenderer}. */
export interface PdfJsOptions {
  /**
   * URL of the PDF.js worker (`pdfjs-dist/build/pdf.worker.min.mjs`). It must
   * be served by your application, e.g. copied with an `assets` glob.
   * Defaults to `/assets/pdfjs/pdf.worker.min.mjs`.
   */
  readonly workerSrc?: string;
}

/** Where the PDF.js worker is loaded from when no `workerSrc` option is given. */
export const DEFAULT_PDFJS_WORKER_SRC = '/assets/pdfjs/pdf.worker.min.mjs';

/** Injection token holding the {@link PdfJsOptions}. Set by {@link withPdfJsRenderer}. */
export const SIGNORA_PDFJS_OPTIONS = new InjectionToken<PdfJsOptions>('SIGNORA_PDFJS_OPTIONS', {
  factory: () => ({}),
});

type PdfJsModule = typeof import('pdfjs-dist');

/** {@link PdfRenderingPort} implemented on top of PDF.js. */
@Injectable()
export class PdfJsRenderingAdapter implements PdfRenderingPort {
  private readonly options = inject(SIGNORA_PDFJS_OPTIONS);
  private modulePromise?: Promise<PdfJsModule>;

  async load(source: PdfSource): Promise<PdfDocumentHandle> {
    const pdfjs = await this.getModule();
    const params =
      typeof source === 'string' || source instanceof URL
        ? { url: source.toString() }
        : { data: await toBytes(source) };
    const task = pdfjs.getDocument(params);
    try {
      return new PdfJsDocumentHandle(task, await task.promise);
    } catch (error) {
      await task.destroy();
      throw error;
    }
  }

  private getModule(): Promise<PdfJsModule> {
    this.modulePromise ??= import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = this.options.workerSrc ?? DEFAULT_PDFJS_WORKER_SRC;
      return pdfjs;
    });
    return this.modulePromise;
  }
}

async function toBytes(source: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (source instanceof Blob) return new Uint8Array(await source.arrayBuffer());
  // PDF.js transfers the buffer to its worker, so always hand it a copy.
  return source instanceof Uint8Array ? source.slice() : new Uint8Array(source.slice(0));
}

class PdfJsDocumentHandle implements PdfDocumentHandle {
  readonly pageCount: number;
  private readonly pages = new Map<number, Promise<PDFPageProxy>>();

  constructor(
    private readonly task: PDFDocumentLoadingTask,
    private readonly doc: PDFDocumentProxy,
  ) {
    this.pageCount = doc.numPages;
  }

  async getPageInfo(pageIndex: number): Promise<PageInfo> {
    const page = await this.getPage(pageIndex);
    const rotation = normalizeRotation(page.rotate);
    const [x0, y0, x1, y1] = page.view;
    const swap = rotation === 90 || rotation === 270;
    return {
      index: pageIndex,
      width: swap ? y1 - y0 : x1 - x0,
      height: swap ? x1 - x0 : y1 - y0,
      rotation,
      view: [x0, y0, x1, y1],
    };
  }

  renderPage(pageIndex: number, canvas: HTMLCanvasElement, options: RenderOptions): RenderHandle {
    let cancelled = false;
    let task: { cancel(): void } | undefined;

    const done = (async () => {
      const page = await this.getPage(pageIndex);
      if (cancelled) throw new RenderCancelledError();

      const pixelRatio = options.pixelRatio ?? 1;
      const viewport = page.getViewport({
        scale: options.scale,
        rotation: page.rotate + options.rotation,
      });
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const renderTask = page.render({
        canvas,
        viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      task = renderTask;
      try {
        await renderTask.promise;
      } catch (error) {
        if (cancelled || (error as { name?: string }).name === 'RenderingCancelledException') {
          throw new RenderCancelledError();
        }
        throw error;
      }
    })();

    return {
      done,
      cancel: () => {
        cancelled = true;
        task?.cancel();
      },
    };
  }

  getData(): Promise<Uint8Array> {
    return this.doc.getData();
  }

  async destroy(): Promise<void> {
    this.pages.clear();
    await this.task.destroy();
  }

  private getPage(pageIndex: number): Promise<PDFPageProxy> {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.pageCount) {
      return Promise.reject(new RangeError(`Page index ${pageIndex} is out of range.`));
    }
    let page = this.pages.get(pageIndex);
    if (!page) {
      page = this.doc.getPage(pageIndex + 1);
      this.pages.set(pageIndex, page);
    }
    return page;
  }
}

/** Uses PDF.js to render documents. Requires `pdfjs-dist` to be installed. */
export function withPdfJsRenderer(options: PdfJsOptions = {}): SignoraFeature {
  return createSignoraFeature('renderer', [
    { provide: SIGNORA_PDFJS_OPTIONS, useValue: options },
    { provide: SIGNORA_RENDERER, useClass: PdfJsRenderingAdapter },
  ]);
}
