import { Component, inject, signal } from '@angular/core';
import { SigningSession } from 'signora-pdf';
import { SignoraViewerComponent } from 'signora-pdf/ui';
import { appendVisualSignatures } from 'signora-pdf/pdf-lib';
import { formatValidationReport, validatePdfSignatures } from 'signora-pdf/validation';

/**
 * Add a visual signature to a PDF that is already digitally signed, without invalidating it. The
 * original bytes are kept and the signature is appended as an incremental update; validating the
 * result shows the first signature is still intact (with a warning that a later revision exists).
 */
@Component({
  selector: 'app-example-append-signature',
  imports: [SignoraViewerComponent],
  providers: [SigningSession],
  host: { class: 'example' },
  template: `
    <div class="example-bar">
      <button type="button" [disabled]="session.placements().length === 0" (click)="append()">
        Add to the signed PDF
      </button>
      @if (download(); as url) {
        <a [href]="url" download="signed-and-stamped.pdf">Download</a>
      }
    </div>
    @if (summary()) {
      <pre>{{ summary() }}</pre>
    }
    <signora-viewer source="samples/signed.pdf" [showSignaturePanel]="true" />
  `,
})
export class AppendSignatureExample {
  protected readonly session = inject(SigningSession);
  protected readonly summary = signal('');
  protected readonly download = signal('');

  protected async append(): Promise<void> {
    const original = new Uint8Array(await (await fetch('samples/signed.pdf')).arrayBuffer());
    const output = await appendVisualSignatures(original, this.session.placements());

    const report = await validatePdfSignatures(output);
    this.summary.set(
      `Original kept byte for byte: ${original.every((byte, i) => output[i] === byte)}\n` +
        formatValidationReport(report),
    );
    this.download.set(
      URL.createObjectURL(new Blob([output as BlobPart], { type: 'application/pdf' })),
    );
  }
}
