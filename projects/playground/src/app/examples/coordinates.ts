import { Component, inject, signal } from '@angular/core';
import { SigningSession, type SignatureCoordinates } from 'signora-pdf';
import { SignoraViewerComponent } from 'signora-pdf/ui';

/** No PDF writer: ask the session where each signature goes and let your backend draw it. */
@Component({
  selector: 'app-example-coordinates',
  imports: [SignoraViewerComponent],
  providers: [SigningSession],
  host: { class: 'example' },
  template: `
    <div class="example-bar">
      <button type="button" (click)="read()">Read coordinates</button>
    </div>
    <signora-viewer source="samples/contract.pdf" [showSignaturePanel]="true" />
    @if (json(); as text) {
      <pre class="example-output" aria-label="Coordinates as JSON">{{ text }}</pre>
    }
  `,
})
export class CoordinatesExample {
  private readonly session = inject(SigningSession);
  protected readonly json = signal('');

  protected async read(): Promise<void> {
    // `normalized`: 0..1 of the visual page, top-left origin. `pdf`: points, bottom-left origin.
    const items: SignatureCoordinates[] = await this.session.exportCoordinates();
    this.json.set(JSON.stringify(items, null, 2));
  }
}
