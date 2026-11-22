import { Component } from '@angular/core';
import { SignoraViewerComponent, type SignatureMode } from 'signora-pdf/ui';

/** Offer only some ways of providing a signature. */
@Component({
  selector: 'app-example-signature-modes',
  imports: [SignoraViewerComponent],
  host: { class: 'example' },
  template: `<signora-viewer
    source="samples/contract.pdf"
    [showSignaturePanel]="true"
    [signatureModes]="modes"
  />`,
})
export class SignatureModesExample {
  // 'draw' | 'type' | 'upload' | 'other' (tabs of registered providers). Default: all.
  protected readonly modes: SignatureMode[] = ['type', 'upload'];
}
