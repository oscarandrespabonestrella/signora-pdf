import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  effect,
  ElementRef,
  inject,
  input,
  output,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import {
  SigningSession,
  type PdfSource,
  type PlacedSignature,
  type SignatureField,
  type SignatureCoordinates,
} from 'signora-pdf';
import { SignoraFieldEditorComponent } from './field-editor.component';
import { SIGNORA_LABELS } from './labels';
import { SignoraPageComponent } from './page.component';
import { SignoraSignatureLayerComponent, type FieldsMode } from './signature-layer.component';
import {
  ALL_SIGNATURE_MODES,
  SignoraSignaturePanelComponent,
  type SignatureMode,
} from './signature-panel.component';
import { resolvePreloadedSignatures, type PreloadedSignature } from './signature-preload';
import { SIGNORA_SIGNATURE_FONTS, readInkColor } from './signature-render';
import { SignoraSlotDirective, type SignoraSlotName } from './slots';
import { SignoraToolbarComponent } from './toolbar.component';

/** How pages are laid out: one at a time, or all of them in one scrollable column. */
export type ViewMode = 'paged' | 'continuous';

/**
 * Default viewer: toolbar, status handling and the current page. Every
 * section can be replaced with a `signoraSlot` template, and everything
 * is themed through `--signora-*` CSS variables.
 */
@Component({
  selector: 'signora-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    SignoraPageComponent,
    SignoraFieldEditorComponent,
    SignoraSignatureLayerComponent,
    SignoraSignaturePanelComponent,
    SignoraToolbarComponent,
  ],
  host: { '(keydown)': 'onKeydown($event)' },
  template: `
    <section class="viewer" role="region" [attr.aria-label]="labels.viewer">
      @if (showToolbar()) {
        @if (toolbarSlot(); as slot) {
          <ng-container [ngTemplateOutlet]="slot" [ngTemplateOutletContext]="context" />
        } @else {
          <signora-toolbar />
        }
      }

      @if (fieldsMode() === 'edit' && !readOnly()) {
        <signora-field-editor />
      }

      <div class="body">
        <div
          #stage
          class="stage"
          [class.continuous]="viewMode() === 'continuous'"
          tabindex="0"
          role="group"
          [attr.aria-label]="labels.pages"
        >
          @switch (session.status()) {
            @case ('ready') {
              @for (index of visiblePages(); track index) {
                <div #pageBox class="page-box" [attr.data-page]="index + 1">
                  <signora-page #page [pageIndex]="index" [lazy]="viewMode() === 'continuous'">
                    <signora-signature-layer
                      [pageIndex]="index"
                      [info]="page.info()"
                      [readOnly]="readOnly()"
                      [fieldsMode]="fieldsMode()"
                      [freePlacement]="freePlacement()"
                    />
                    @if (index === session.currentPage() - 1) {
                      <ng-container [ngTemplateOutlet]="overlay" />
                    }
                  </signora-page>
                </div>
              }
            }
            @case ('loading') {
              @if (loadingSlot(); as slot) {
                <ng-container [ngTemplateOutlet]="slot" [ngTemplateOutletContext]="context" />
              } @else {
                <p class="message" role="status">{{ labels.loading }}</p>
              }
            }
            @case ('error') {
              @if (errorSlot(); as slot) {
                <ng-container [ngTemplateOutlet]="slot" [ngTemplateOutletContext]="context" />
              } @else {
                <p class="message" role="alert">{{ labels.error }}</p>
              }
            }
            @default {
              @if (emptySlot(); as slot) {
                <ng-container [ngTemplateOutlet]="slot" [ngTemplateOutletContext]="context" />
              } @else {
                <p class="message">{{ labels.empty }}</p>
              }
            }
          }
        </div>

        @if (showSignaturePanel() && !readOnly() && fieldsMode() !== 'edit') {
          <aside class="side">
            @if (signaturesSlot(); as slot) {
              <ng-container [ngTemplateOutlet]="slot" [ngTemplateOutletContext]="context" />
            } @else {
              <signora-signature-panel
                [builtInTabs]="builtInModes()"
                [providerTabs]="signatureModes().includes('other')"
              />
            }
          </aside>
        }
      </div>

      <p class="visually-hidden" aria-live="polite">{{ liveMessage() }}</p>
    </section>
    <ng-template #overlay><ng-content /></ng-template>
  `,
  styles: `
    :host {
      display: block;
      min-height: 0;
    }
    .viewer {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: inherit;
      background: var(--signora-color-bg, #e9ecf1);
      color: var(--signora-color-text, #1f2430);
      font-family: var(--signora-font-family, system-ui, sans-serif);
      border: 1px solid var(--signora-color-border, #d5d9e2);
      border-radius: var(--signora-radius-lg, min(var(--signora-radius, 8px), 16px));
      overflow: hidden;
    }
    .stage:focus-visible {
      outline: 2px solid var(--signora-color-focus-ring, #3b5bdb);
      outline-offset: -2px;
    }
    .body {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    .side {
      flex: none;
      width: var(--signora-panel-width, 340px);
      overflow: auto;
      border-left: 1px solid var(--signora-color-border, #d5d9e2);
      background: var(--signora-color-panel-bg, var(--signora-color-toolbar-bg, #fff));
    }
    .stage {
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      display: grid;
      justify-content: safe center;
      align-content: start;
      padding: calc(var(--signora-space, 8px) * 3);
    }
    .stage.continuous {
      row-gap: calc(var(--signora-space, 8px) * 3);
    }
    .message {
      margin: calc(var(--signora-space, 8px) * 6) 0;
      color: var(--signora-color-text-muted, #5b6475);
      text-align: center;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class SignoraViewerComponent {
  protected readonly session = inject(SigningSession);
  protected readonly labels = inject(SIGNORA_LABELS);
  private readonly slots = contentChildren(SignoraSlotDirective);

  /** Document to display. Changing it loads the new document. */
  readonly source = input<PdfSource | null | undefined>(null);
  readonly showToolbar = input(true);
  /** Shows the signature panel (draw, type, upload, organization) next to the page. */
  readonly showSignaturePanel = input(false);
  /**
   * `paged` shows one page at a time (default); `continuous` stacks every page in one
   * scrollable column. The toolbar, keyboard and `goToPage` work in both: in continuous
   * mode they scroll to the page, and scrolling updates the current page.
   */
  readonly viewMode = input<ViewMode>('paged');
  /**
   * Which ways of providing a signature the panel offers: `draw`, `type`, `upload` and
   * `other` (tabs of registered providers, such as organization signatures). Defaults to all.
   */
  readonly signatureModes = input<readonly SignatureMode[]>(ALL_SIGNATURE_MODES);
  /**
   * Signatures available from the start, ready to place: ready assets, names to render
   * as typed signatures (`{ text: 'Ada Lovelace' }`) or images (`{ image: url }`).
   * Replacing the list adds the new ones; it never removes the library.
   */
  readonly preloadedSignatures = input<readonly PreloadedSignature[]>([]);

  /**
   * Read-only mode: shows the placed signatures, but nobody can place, move, resize or delete
   * them, and the signature panel is hidden. Placements set through `SigningSession` still show.
   */
  readonly readOnly = input(false);
  /**
   * Signature fields: reserved, named areas that users fill with a signature. Replaces the
   * fields whenever it changes or a document is loaded; signatures stay in fields whose id
   * remains. Feed `(fieldsChange)` back into it, or ignore that output, as you prefer.
   */
  readonly signatureFields = input<readonly SignatureField[]>([]);
  /**
   * `fill` (default): users fill the fields. `edit`: users create, move, resize, name and delete
   * the fields instead (for whoever lays out the document); signatures cannot be placed.
   */
  readonly fieldsMode = input<FieldsMode>('fill');
  /** When `false`, signatures can only go inside a signature field. Defaults to `true`. */
  readonly freePlacement = input(true);
  /** Emits the signature fields every time they change, including edits made in `edit` mode. */
  readonly fieldsChange = output<readonly SignatureField[]>();

  /** Whether `coordinatesChange` includes each signature image as a `data:` URL. */
  readonly coordinatesIncludeImages = input(false);

  /**
   * Emits where every signature is (normalized and PDF-point boxes, see
   * `SignatureCoordinates`) every time the placements change. Images are left out unless
   * `coordinatesIncludeImages` is set, so it is light enough to send to a backend.
   */
  readonly coordinatesChange = output<readonly SignatureCoordinates[]>();

  /** Emits the placed signatures every time they change (also with an empty list). */
  readonly placementsChange = output<readonly PlacedSignature[]>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fonts = inject(SIGNORA_SIGNATURE_FONTS);
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly pageBoxes = viewChildren<ElementRef<HTMLElement>>('pageBox');
  /** Page last reported by scrolling, so it is not scrolled to again. */
  private scrollPage: number | null = null;

  protected readonly builtInModes = computed(() =>
    this.signatureModes().filter((mode): mode is 'draw' | 'type' | 'upload' => mode !== 'other'),
  );
  protected readonly visiblePages = computed(() => {
    const count = this.session.pageCount();
    if (count === 0) return [];
    return this.viewMode() === 'continuous'
      ? Array.from({ length: count }, (_, i) => i)
      : [this.session.currentPage() - 1];
  });

  protected readonly toolbarSlot = this.slotTemplate('toolbar');
  protected readonly emptySlot = this.slotTemplate('empty');
  protected readonly loadingSlot = this.slotTemplate('loading');
  protected readonly errorSlot = this.slotTemplate('error');
  protected readonly signaturesSlot = this.slotTemplate('signatures');
  protected readonly context = { $implicit: this.session, session: this.session };

  protected readonly liveMessage = computed(() =>
    this.session.hasDocument()
      ? this.labels.pageOf(this.session.currentPage(), this.session.pageCount())
      : '',
  );

  constructor() {
    effect(() => {
      const source = this.source();
      if (source) untracked(() => void this.session.load(source));
    });

    effect((onCleanup) => {
      const items = this.preloadedSignatures();
      if (items.length === 0) return;
      let stale = false;
      onCleanup(() => (stale = true));
      void resolvePreloadedSignatures(
        items,
        { fonts: this.fonts, color: readInkColor(this.host.nativeElement) },
        (item, error) =>
          console.warn('[signora] A preloaded signature could not be loaded', item, error),
      ).then((assets) => {
        if (!stale) this.session.addAssets(assets);
      });
    });

    effect(() => this.placementsChange.emit(this.session.placements()));

    effect(() => this.fieldsChange.emit(this.session.fields()));

    // Fields come from the input: apply them to every new document, and whenever they change.
    effect(() => {
      const fields = this.signatureFields();
      if (!this.session.document()) return;
      untracked(() => {
        if (fields !== this.session.fields()) this.session.setFields(fields);
      });
    });

    effect((onCleanup) => {
      const placements = this.session.placements();
      const includeImages = this.coordinatesIncludeImages();
      if (placements.length === 0) {
        this.coordinatesChange.emit([]);
        return;
      }
      if (!this.session.hasDocument()) return;
      let stale = false;
      onCleanup(() => (stale = true));
      this.session.exportCoordinates({ includeImages }).then(
        (coordinates) => {
          if (!stale) this.coordinatesChange.emit(coordinates);
        },
        (error: unknown) => console.warn('[signora] Could not compute coordinates', error),
      );
    });

    // Read-only: nothing can stay armed for placing.
    effect(() => {
      if (this.readOnly()) untracked(() => this.session.arm(null));
    });

    // Continuous mode: scrolling decides the current page...
    effect((onCleanup) => {
      const stage = this.stage()?.nativeElement;
      const boxes = this.pageBoxes();
      if (this.viewMode() !== 'continuous' || !stage || boxes.length === 0) return;
      if (typeof IntersectionObserver === 'undefined') return;
      const ratios = new Map<number, number>();
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset['page']);
            ratios.set(page, entry.isIntersecting ? entry.intersectionRatio : 0);
          }
          let best = 0;
          let bestRatio = 0;
          for (const [page, ratio] of ratios) {
            if (ratio > bestRatio || (ratio === bestRatio && ratio > 0 && page < best)) {
              best = page;
              bestRatio = ratio;
            }
          }
          if (best > 0 && best !== this.session.currentPage()) {
            this.scrollPage = best;
            this.session.goToPage(best);
          }
        },
        { root: stage, threshold: [0, 0.25, 0.5, 0.75, 1] },
      );
      for (const box of boxes) observer.observe(box.nativeElement);
      onCleanup(() => observer.disconnect());
    });

    // ...and going to a page (toolbar, keyboard, API) scrolls to it.
    effect(() => {
      const page = this.session.currentPage();
      const stage = this.stage()?.nativeElement;
      const boxes = this.pageBoxes();
      if (this.viewMode() !== 'continuous' || !stage || boxes.length === 0) return;
      if (page === this.scrollPage) return;
      this.scrollPage = page;
      const box = boxes.find((b) => b.nativeElement.dataset['page'] === String(page));
      if (!box || typeof stage.scrollTo !== 'function') return;
      const top =
        box.nativeElement.getBoundingClientRect().top -
        stage.getBoundingClientRect().top +
        stage.scrollTop;
      stage.scrollTo({ top, behavior: 'auto' });
    });
  }

  private slotTemplate(name: SignoraSlotName) {
    return computed(() => this.slots().find((slot) => slot.name() === name)?.template ?? null);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (
      target.closest(
        'input, textarea, select, [contenteditable="true"], aside, [data-signora-placement], [data-signora-field]',
      )
    ) {
      return;
    }

    switch (event.key) {
      case 'ArrowLeft':
      case 'PageUp':
        this.session.previousPage();
        break;
      case 'ArrowRight':
      case 'PageDown':
        this.session.nextPage();
        break;
      case '+':
      case '=':
        this.session.zoomIn();
        break;
      case '-':
        this.session.zoomOut();
        break;
      case 'r':
        this.session.rotateClockwise();
        break;
      default:
        return;
    }
    event.preventDefault();
  }
}
