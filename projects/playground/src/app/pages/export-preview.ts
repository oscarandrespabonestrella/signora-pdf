import { Component, ElementRef, afterNextRender, input, output, viewChild } from '@angular/core';
import { SigningSession } from 'signora-pdf';
import { SignoraViewerComponent } from 'signora-pdf/ui';

/**
 * Modal preview of the exported PDF. It has its own `SigningSession`, so it
 * is an independent viewer of the *result*, not of the document being edited.
 */
@Component({
  selector: 'app-export-preview',
  imports: [SignoraViewerComponent],
  providers: [SigningSession],
  template: `
    <dialog #dialog aria-labelledby="preview-title" (close)="closed.emit()">
      <header>
        <h2 id="preview-title">Preview of the exported PDF</h2>
        <button type="button" (click)="dialog.close()">Close</button>
      </header>
      <signora-viewer class="viewer" [source]="bytes()" />
    </dialog>
  `,
  styles: `
    dialog {
      width: min(960px, 94vw);
      height: 88vh;
      padding: 0;
      border: 1px solid var(--pg-border);
      border-radius: 10px;
      background: var(--pg-surface);
      color: var(--pg-text);
    }
    dialog[open] {
      display: flex;
      flex-direction: column;
    }
    dialog::backdrop {
      background: rgb(15 18 32 / 0.55);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.6rem 1rem;
      border-bottom: 1px solid var(--pg-border);
    }
    h2 {
      margin: 0;
      font-size: 1rem;
    }
    header button {
      padding: 0.35rem 0.8rem;
      border: 1px solid var(--pg-border);
      border-radius: 6px;
      background: var(--pg-surface);
      color: inherit;
      cursor: pointer;
    }
    .viewer {
      flex: 1;
      min-height: 0;
      margin: 0.75rem;
    }
  `,
})
export class ExportPreview {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly bytes = input.required<Uint8Array>();
  readonly closed = output();

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }
}
