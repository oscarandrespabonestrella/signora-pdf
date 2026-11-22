import { Component, computed, signal } from '@angular/core';
import { type SignatureField } from 'signora-pdf';
import { SignoraViewerComponent } from 'signora-pdf/ui';

/** Lay out the fields on the document, then store the result for the people who sign. */
@Component({
  selector: 'app-example-fields-editor',
  imports: [SignoraViewerComponent],
  host: { class: 'example' },
  template: `
    <signora-viewer
      source="samples/contract.pdf"
      fieldsMode="edit"
      (fieldsChange)="fields.set($event)"
    />
    <pre class="example-output" aria-label="Fields as JSON">{{ json() }}</pre>
  `,
})
export class FieldsEditorExample {
  protected readonly fields = signal<readonly SignatureField[]>([]);
  // Save this JSON, then pass it as [signatureFields] to the people who sign.
  protected readonly json = computed(() => JSON.stringify(this.fields(), null, 2));
}
