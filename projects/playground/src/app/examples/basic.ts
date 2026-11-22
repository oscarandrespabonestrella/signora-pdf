import { Component } from '@angular/core';
import { SignoraViewerComponent } from 'signora-pdf/ui';

/** The smallest useful viewer: a PDF and the signature panel. */
@Component({
  selector: 'app-example-basic',
  imports: [SignoraViewerComponent],
  host: { class: 'example' },
  template: `<signora-viewer source="samples/contract.pdf" [showSignaturePanel]="true" />`,
})
export class BasicExample {}
