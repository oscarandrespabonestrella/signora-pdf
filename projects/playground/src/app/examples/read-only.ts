import { Component, effect, inject, untracked } from '@angular/core';
import { SigningSession } from 'signora-pdf';
import { SignoraViewerComponent, typedSignatureToAsset } from 'signora-pdf/ui';

/** Shows signatures that already exist; nobody can add, move or delete them. */
@Component({
  selector: 'app-example-read-only',
  imports: [SignoraViewerComponent],
  providers: [SigningSession],
  host: { class: 'example' },
  template: `<signora-viewer source="samples/contract.pdf" [readOnly]="true" />`,
})
export class ReadOnlyExample {
  private readonly session = inject(SigningSession);

  constructor() {
    // Loading a document resets its placements, so add them once it is ready.
    effect(() => {
      if (this.session.status() === 'ready') untracked(() => void this.showExisting());
    });
  }

  private async showExisting(): Promise<void> {
    // In a real app these placements come from your backend.
    const asset = await typedSignatureToAsset(
      'Ada Lovelace',
      { label: 'Classic', family: 'Georgia, serif', style: 'italic' },
      '#1b1f3b',
    );
    if (!asset) return;
    this.session.addPlacement({
      id: 'existing',
      asset,
      pageIndex: 0,
      rect: { x: 0.1, y: 0.3, width: 0.3, height: 0.055 }, // normalized, origin top-left
    });
  }
}
