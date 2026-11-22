import { Component } from '@angular/core';
import { SigningSession } from 'signora-pdf';
import { SignoraSlotDirective, SignoraViewerComponent } from 'signora-pdf/ui';

/**
 * Replaces the toolbar and the empty state with application templates.
 * Only the public API of the library is used; no library code is modified.
 */
@Component({
  selector: 'app-custom-templates-demo',
  imports: [SignoraViewerComponent, SignoraSlotDirective],
  // An independent session: this viewer does not share state with the other demo.
  providers: [SigningSession],
  templateUrl: './custom-templates-demo.html',
  styleUrl: './custom-templates-demo.css',
})
export class CustomTemplatesDemo {
  protected readonly source = 'samples/mixed-pages.pdf';
}
