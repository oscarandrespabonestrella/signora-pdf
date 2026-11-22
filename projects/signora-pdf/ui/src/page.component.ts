import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RenderCancelledError, SigningSession, getViewportSize, type PageInfo } from 'signora-pdf';
import { SIGNORA_LABELS } from './labels';

/**
 * Renders one page of the session's document and exposes an overlay layer,
 * sized exactly like the page, for projected content (e.g. signatures).
 */
@Component({
  selector: 'signora-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="page"
      [style.width.px]="size()?.width"
      [style.height.px]="size()?.height"
      [attr.aria-busy]="rendering()"
    >
      <canvas #canvas role="img" [attr.aria-label]="labels.pageAlt(pageIndex() + 1)"></canvas>
      <div class="overlay"><ng-content /></div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      width: max-content;
    }
    .page {
      position: relative;
      min-width: 1px;
      min-height: 1px;
      background: var(--signora-page-bg, #fff);
      box-shadow: var(
        --signora-page-shadow,
        0 1px 3px rgb(0 0 0 / 0.25),
        0 8px 24px rgb(0 0 0 / 0.12)
      );
    }
    canvas {
      display: block;
    }
    .overlay {
      position: absolute;
      inset: 0;
      overflow: hidden;
    }
  `,
})
export class SignoraPageComponent {
  private readonly session = inject(SigningSession);
  protected readonly labels = inject(SIGNORA_LABELS);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly _info = signal<PageInfo | null>(null);
  private readonly _rendering = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly inView = signal(true);

  /** Zero-based index of the page to render. */
  readonly pageIndex = input.required<number>();
  /**
   * Draws the page only while it is near the visible area (for long documents shown in
   * continuous mode). The empty page keeps its size, so scrolling stays accurate.
   */
  readonly lazy = input(false);

  /** Geometry of the page, once known. */
  readonly info = this._info.asReadonly();
  readonly rendering = this._rendering.asReadonly();
  /** Size of the rendered page in CSS pixels, once known. */
  readonly size = computed(() => {
    const info = this._info();
    return info ? getViewportSize(info, this.session.viewport()) : null;
  });

  constructor() {
    effect((onCleanup) => {
      if (!this.lazy() || typeof IntersectionObserver === 'undefined') {
        this.inView.set(true);
        return;
      }
      this.inView.set(false);
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) this.inView.set(true);
        },
        { rootMargin: '600px 0px' },
      );
      observer.observe(this.host.nativeElement);
      onCleanup(() => observer.disconnect());
    });

    effect((onCleanup) => {
      const document = this.session.document();
      const index = this.pageIndex();
      let stale = false;
      onCleanup(() => (stale = true));
      this._info.set(null);
      void document?.getPageInfo(index).then(
        (info) => {
          if (!stale) this._info.set(info);
        },
        () => undefined,
      );
    });

    effect((onCleanup) => {
      const document = this.session.document();
      const viewport = this.session.viewport();
      const index = this.pageIndex();
      if (!document || !this._info() || !this.inView()) return;

      const handle = document.renderPage(index, this.canvas().nativeElement, {
        ...viewport,
        pixelRatio: globalThis.devicePixelRatio || 1,
      });
      this._rendering.set(true);
      onCleanup(() => handle.cancel());
      handle.done.then(
        () => this._rendering.set(false),
        (error: unknown) => {
          if (!(error instanceof RenderCancelledError)) {
            this._rendering.set(false);
            console.error('[signora] Page render failed', error);
          }
        },
      );
    });
  }
}
