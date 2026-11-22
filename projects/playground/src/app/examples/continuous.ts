import { Component } from '@angular/core';
import { SignoraViewerComponent } from 'signora-pdf/ui';

/** Every page in one scrollable column instead of one page at a time. */
@Component({
  selector: 'app-example-continuous',
  imports: [SignoraViewerComponent],
  host: { class: 'example' },
  template: `<signora-viewer
    source="samples/mixed-pages.pdf"
    viewMode="continuous"
    [showSignaturePanel]="true"
  />`,
})
export class ContinuousExample {}
