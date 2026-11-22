import { Component, inject, signal } from '@angular/core';
import { SigningSession, type SignatureField } from 'signora-pdf';
import { SignoraViewerComponent } from 'signora-pdf/ui';

/** Named areas that must be signed, and a button that validates them. */
@Component({
  selector: 'app-example-fields',
  imports: [SignoraViewerComponent],
  providers: [SigningSession],
  host: { class: 'example' },
  template: `
    <div class="example-bar">
      <button type="button" (click)="check()">Validate</button>
      <span role="status">{{ status() }}</span>
    </div>
    <signora-viewer
      source="samples/contract.pdf"
      [showSignaturePanel]="true"
      [signatureFields]="fields"
      [freePlacement]="false"
    />
  `,
})
export class FieldsExample {
  private readonly session = inject(SigningSession);
  protected readonly status = signal('');

  protected readonly fields: SignatureField[] = [
    {
      id: 'client',
      pageIndex: 0,
      rect: { x: 0.1, y: 0.3, width: 0.3, height: 0.07 }, // normalized, origin top-left
      label: 'Client signature',
      required: true,
    },
    {
      id: 'witness',
      pageIndex: 0,
      rect: { x: 0.55, y: 0.3, width: 0.3, height: 0.07 },
      label: 'Witness',
    },
  ];

  protected check(): void {
    const { valid, missing } = this.session.validate();
    this.status.set(
      valid
        ? 'All required fields are signed.'
        : `Missing: ${missing.map((f) => f.label ?? f.id).join(', ')}`,
    );
  }
}
