import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { SigningSession } from 'signora-pdf';
import { SIGNORA_LABELS, type SignoraLabels } from './labels';

/** Default toolbar: page navigation, zoom and rotation. Replaceable through the `toolbar` slot. */
@Component({
  selector: 'signora-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toolbar" role="toolbar" [attr.aria-label]="strings().toolbar">
      <div class="group">
        <button
          type="button"
          [attr.aria-label]="strings().previousPage"
          [title]="strings().previousPage"
          [disabled]="!session.canGoPrevious()"
          (click)="session.previousPage()"
        >
          ‹
        </button>
        <label class="page-field">
          <span class="visually-hidden">{{ strings().pageNumber }}</span>
          <input
            type="number"
            inputmode="numeric"
            min="1"
            [max]="session.pageCount()"
            [value]="session.currentPage()"
            [disabled]="!session.hasDocument()"
            (change)="onPageChange($event)"
          />
        </label>
        <span class="total" aria-hidden="true">/ {{ session.pageCount() }}</span>
        <button
          type="button"
          [attr.aria-label]="strings().nextPage"
          [title]="strings().nextPage"
          [disabled]="!session.canGoNext()"
          (click)="session.nextPage()"
        >
          ›
        </button>
      </div>

      <div class="group">
        <button
          type="button"
          [attr.aria-label]="strings().zoomOut"
          [title]="strings().zoomOut"
          [disabled]="!session.canZoomOut()"
          (click)="session.zoomOut()"
        >
          −
        </button>
        <output class="zoom" [attr.aria-label]="strings().zoomLevel"> {{ zoomPercent() }}% </output>
        <button
          type="button"
          [attr.aria-label]="strings().zoomIn"
          [title]="strings().zoomIn"
          [disabled]="!session.canZoomIn()"
          (click)="session.zoomIn()"
        >
          +
        </button>
      </div>

      <div class="group">
        <button
          type="button"
          [attr.aria-label]="strings().rotateCounterClockwise"
          [title]="strings().rotateCounterClockwise"
          [disabled]="!session.hasDocument()"
          (click)="session.rotateCounterClockwise()"
        >
          ↺
        </button>
        <button
          type="button"
          [attr.aria-label]="strings().rotateClockwise"
          [title]="strings().rotateClockwise"
          [disabled]="!session.hasDocument()"
          (click)="session.rotateClockwise()"
        >
          ↻
        </button>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: calc(var(--signora-space, 8px) * 2);
      min-height: var(--signora-toolbar-height, 48px);
      padding: 0 var(--signora-space, 8px);
      box-sizing: border-box;
      background: var(--signora-color-toolbar-bg, #fff);
      color: var(--signora-color-text, #1f2430);
      border-bottom: 1px solid var(--signora-color-border, #d5d9e2);
      font-family: var(--signora-font-family, system-ui, sans-serif);
    }
    .group {
      display: flex;
      align-items: center;
      gap: calc(var(--signora-space, 8px) / 2);
    }
    button,
    input {
      font: inherit;
      color: inherit;
    }
    button {
      min-width: 2rem;
      height: 2rem;
      border: 1px solid transparent;
      border-radius: var(--signora-radius, 8px);
      background: transparent;
      cursor: pointer;
      font-size: 1.1rem;
      line-height: 1;
    }
    button:hover:not(:disabled) {
      background: var(--signora-color-hover, #eef1f7);
    }
    button:disabled,
    input:disabled {
      opacity: var(--signora-disabled-opacity, 0.4);
      cursor: not-allowed;
    }
    :is(button, input):focus-visible {
      outline: 2px solid var(--signora-color-focus-ring, #3b5bdb);
      outline-offset: 1px;
    }
    input {
      width: 3.5rem;
      height: 2rem;
      padding: 0 calc(var(--signora-space, 8px) / 2);
      box-sizing: border-box;
      text-align: center;
      border: 1px solid var(--signora-color-border, #d5d9e2);
      border-radius: var(--signora-radius, 8px);
      background: var(--signora-color-surface, #fff);
    }
    .total,
    .zoom {
      min-width: 3rem;
      text-align: center;
      color: var(--signora-color-text-muted, #5b6475);
      font-variant-numeric: tabular-nums;
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
export class SignoraToolbarComponent {
  protected readonly session = inject(SigningSession);
  private readonly defaultLabels = inject(SIGNORA_LABELS);

  /** Partial overrides of the global labels, for this toolbar only. */
  readonly labels = input<Partial<SignoraLabels>>({});

  protected readonly strings = computed<SignoraLabels>(() => ({
    ...this.defaultLabels,
    ...this.labels(),
  }));
  protected readonly zoomPercent = computed(() => Math.round(this.session.zoom() * 100));

  protected onPageChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.session.goToPage(input.valueAsNumber);
    // Re-sync the field when the entered value was invalid or clamped.
    input.value = String(this.session.currentPage());
  }
}
