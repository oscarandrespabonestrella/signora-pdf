import { Component } from '@angular/core';
import { SigningSession } from 'signora-pdf';
import { SignoraSlotDirective, SignoraViewerComponent } from 'signora-pdf/ui';

/** Replace the toolbar with your own template; it receives the session. */
@Component({
  selector: 'app-example-custom-toolbar',
  imports: [SignoraViewerComponent, SignoraSlotDirective],
  providers: [SigningSession],
  host: { class: 'example' },
  template: `
    <signora-viewer source="samples/mixed-pages.pdf">
      <ng-template signoraSlot="toolbar" let-session>
        <div class="example-bar">
          <button
            type="button"
            [disabled]="!session.canGoPrevious()"
            (click)="session.previousPage()"
          >
            Back
          </button>
          <span>Page {{ session.currentPage() }} of {{ session.pageCount() }}</span>
          <button type="button" [disabled]="!session.canGoNext()" (click)="session.nextPage()">
            Next
          </button>
          <button type="button" (click)="session.rotateClockwise()">Rotate</button>
        </div>
      </ng-template>
    </signora-viewer>
  `,
})
export class CustomToolbarExample {}
