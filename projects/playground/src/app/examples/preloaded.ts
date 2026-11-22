import { Component } from '@angular/core';
import { SignoraViewerComponent, type PreloadedSignature } from 'signora-pdf/ui';

/** Signatures that are ready in the library as soon as the viewer opens. */
@Component({
  selector: 'app-example-preloaded',
  imports: [SignoraViewerComponent],
  host: { class: 'example' },
  template: `<signora-viewer
    source="samples/contract.pdf"
    [showSignaturePanel]="true"
    [signatureModes]="[]"
    [preloadedSignatures]="people"
  />`,
})
export class PreloadedExample {
  protected readonly people: PreloadedSignature[] = [
    { text: 'Ada Lovelace' }, // rendered with the first font
    { text: 'Grace Hopper', font: 'Classic', label: 'Grace (classic)' },
    // { image: '/signatures/alan.png', label: 'Alan' }, // URL, data: URL or Blob
  ];
}
