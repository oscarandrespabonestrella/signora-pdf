import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import type { SignatureAsset } from 'signora-pdf';
import { SIGNORA_LABELS } from './labels';
import { rasterizeToAsset } from './signature-render';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** Upload an image of a signature, logo or stamp. It is normalized to PNG. */
@Component({
  selector: 'signora-signature-upload',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="choose">
      <input type="file" [accept]="accept" (change)="onChange($event)" />
      <span>{{ labels.uploadChoose }}</span>
    </label>
    <p class="help">{{ labels.uploadHelp }}</p>
    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .choose {
      position: relative;
      display: inline-block;
      padding: 0.45rem 0.9rem;
      border-radius: var(--signora-radius, 8px);
      background: var(--signora-color-accent, #3b5bdb);
      color: var(--signora-color-accent-contrast, #fff);
      cursor: pointer;
    }
    .choose:has(input:focus-visible) {
      outline: 2px solid var(--signora-color-focus-ring, #3b5bdb);
      outline-offset: 2px;
    }
    input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .help {
      color: var(--signora-color-text-muted, #5b6475);
      font-size: 0.85em;
    }
    .error {
      color: var(--signora-color-danger, #c92a2a);
    }
  `,
})
export class SignoraSignatureUploadComponent {
  protected readonly labels = inject(SIGNORA_LABELS);
  protected readonly accept = ACCEPTED.join(',');
  protected readonly error = signal<string | null>(null);

  /** Largest accepted file, in bytes. */
  readonly maxBytes = input(2 * 1024 * 1024);
  readonly created = output<SignatureAsset>();

  protected async onChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    input.value = '';
    if (!file) return;

    this.error.set(null);
    if (!ACCEPTED.includes(file.type)) {
      this.error.set(this.labels.uploadInvalid);
      return;
    }
    if (file.size > this.maxBytes()) {
      this.error.set(this.labels.uploadTooLarge);
      return;
    }
    try {
      const asset = await rasterizeToAsset(file, {
        kind: 'image',
        label: file.name.replace(/\.[^.]+$/, ''),
      });
      this.created.emit(asset);
    } catch {
      this.error.set(this.labels.uploadInvalid);
    }
  }
}
