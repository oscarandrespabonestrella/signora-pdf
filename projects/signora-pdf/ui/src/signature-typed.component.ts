import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { SignatureAsset } from 'signora-pdf';
import { SIGNORA_LABELS } from './labels';
import { SIGNORA_SIGNATURE_FONTS, readInkColor, typedSignatureToAsset } from './signature-render';

/** Typed signature: a name rendered with a configurable list of fonts. */
@Component({
  selector: 'signora-signature-typed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fields">
      <label class="field">
        <span>{{ labels.typeInput }}</span>
        <input
          #field
          type="text"
          autocomplete="off"
          maxlength="60"
          [placeholder]="labels.typePlaceholder"
          [value]="text()"
          (input)="text.set($any($event.target).value)"
        />
      </label>
      <label class="field">
        <span>{{ labels.typeFont }}</span>
        <select [value]="fontIndex()" (change)="fontIndex.set(+$any($event.target).value)">
          @for (font of fonts; track font.label; let i = $index) {
            <option [value]="i">{{ font.label }}</option>
          }
        </select>
      </label>
    </div>

    <div class="preview" role="img" [attr.aria-label]="labels.typePreview">
      @if (preview(); as asset) {
        <img [src]="asset.dataUrl" alt="" />
      }
    </div>

    <div class="actions">
      <button type="button" class="primary" [disabled]="!preview()" (click)="use()">
        {{ labels.useSignature }}
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .fields {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: var(--signora-space, 8px);
    }
    .field {
      display: grid;
      gap: calc(var(--signora-space, 8px) / 2);
      font-size: 0.85em;
      color: var(--signora-color-text-muted, #5b6475);
    }
    input,
    select,
    button {
      font: inherit;
      color: var(--signora-color-text, #1f2430);
      padding: 0.4rem 0.6rem;
      border: 1px solid var(--signora-color-border, #d5d9e2);
      border-radius: var(--signora-radius, 8px);
      background: var(--signora-color-surface, #fff);
    }
    .preview {
      display: grid;
      place-items: center;
      min-height: 110px;
      margin-top: var(--signora-space, 8px);
      padding: var(--signora-space, 8px);
      border: 1px dashed var(--signora-color-border, #d5d9e2);
      border-radius: var(--signora-radius-lg, min(var(--signora-radius, 8px), 16px));
      background: var(--signora-signature-bg, var(--signora-page-bg, #fff));
    }
    .preview img {
      max-width: 100%;
      max-height: 90px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--signora-space, 8px);
    }
    button {
      cursor: pointer;
    }
    button.primary {
      background: var(--signora-color-accent, #3b5bdb);
      border-color: var(--signora-color-accent, #3b5bdb);
      color: var(--signora-color-accent-contrast, #fff);
    }
    button:disabled {
      opacity: var(--signora-disabled-opacity, 0.4);
      cursor: not-allowed;
    }
    :is(input, select, button):focus-visible {
      outline: 2px solid var(--signora-color-focus-ring, #3b5bdb);
      outline-offset: 1px;
    }
  `,
})
export class SignoraSignatureTypedComponent {
  protected readonly labels = inject(SIGNORA_LABELS);
  protected readonly fonts = inject(SIGNORA_SIGNATURE_FONTS);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  protected readonly text = signal('');
  protected readonly fontIndex = signal(0);
  protected readonly preview = signal<SignatureAsset | null>(null);

  /** Emits when the user confirms the typed signature. */
  readonly created = output<SignatureAsset>();

  constructor() {
    effect((onCleanup) => {
      const text = this.text();
      const font = this.fonts[this.fontIndex()] ?? this.fonts[0];
      let stale = false;
      onCleanup(() => (stale = true));
      if (!font) return;
      void typedSignatureToAsset(text, font, readInkColor(this.field().nativeElement)).then(
        (asset) => {
          if (!stale) this.preview.set(asset);
        },
      );
    });
  }

  protected use(): void {
    const asset = this.preview();
    if (!asset) return;
    this.created.emit(asset);
    this.text.set('');
  }
}
