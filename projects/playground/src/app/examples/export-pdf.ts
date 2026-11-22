import { Component, inject } from '@angular/core';
import { SigningSession } from 'signora-pdf';
import { SignoraViewerComponent } from 'signora-pdf/ui';

/** Embed the placed signatures in a new PDF (needs `withPdfLibWriter()`) and download it. */
@Component({
  selector: 'app-example-export-pdf',
  imports: [SignoraViewerComponent],
  providers: [SigningSession],
  host: { class: 'example' },
  template: `
    <div class="example-bar">
      <button type="button" [disabled]="session.placements().length === 0" (click)="download()">
        Download PDF
      </button>
    </div>
    <signora-viewer source="samples/contract.pdf" [showSignaturePanel]="true" />
  `,
})
export class ExportPdfExample {
  protected readonly session = inject(SigningSession);

  protected async download(): Promise<void> {
    const bytes = await this.session.exportPdf();
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'signed.pdf';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
