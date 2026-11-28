import { Component, inject, signal } from '@angular/core';
import { SigningSession, type SignatureField } from 'signora-pdf';
import { SignoraViewerComponent } from 'signora-pdf/ui';
import { readSignatureFields } from 'signora-pdf/pdf-lib';

/**
 * Turn the fields laid out on a document into real PDF signature fields (AcroForm `/Sig`), so a
 * backend can sign into them by name, then read them back from the file. Nothing is signed here.
 */
@Component({
  selector: 'app-example-pdf-signature-fields',
  imports: [SignoraViewerComponent],
  providers: [SigningSession],
  host: { class: 'example' },
  template: `
    <div class="example-bar">
      <button type="button" [disabled]="session.fields().length === 0" (click)="create()">
        Create the signature fields in the PDF
      </button>
      @if (download(); as url) {
        <a [href]="url" download="with-signature-fields.pdf">Download</a>
      }
    </div>
    @if (readBack().length > 0) {
      <pre class="example-output" aria-label="Fields read back from the PDF">{{ summary() }}</pre>
    }
    <signora-viewer source="samples/contract.pdf" fieldsMode="edit" />
  `,
})
export class PdfSignatureFieldsExample {
  protected readonly session = inject(SigningSession);
  protected readonly download = signal('');
  protected readonly readBack = signal<readonly SignatureField[]>([]);
  protected readonly summary = signal('');

  protected async create(): Promise<void> {
    // Fields that are not in the document yet are created; the result is an incremental update.
    const bytes = await this.session.exportPdf({ createFields: true });
    this.download.set(
      URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })),
    );

    // Read them back, as an application receiving this file would.
    const fields = await readSignatureFields(bytes);
    this.readBack.set(fields);
    this.summary.set(
      fields
        .map(
          (f) => `${f.pdfName}  page ${f.pageIndex + 1}  ${f.required ? 'required' : 'optional'}`,
        )
        .join('\n'),
    );
  }
}
