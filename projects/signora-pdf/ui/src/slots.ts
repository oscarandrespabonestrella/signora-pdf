import { Directive, TemplateRef, inject, input } from '@angular/core';
import type { SigningSession } from 'signora-pdf';

/** Built-in replaceable sections of the viewer. Custom UIs may add their own names. */
export type SignoraSlotName =
  'toolbar' | 'empty' | 'loading' | 'error' | 'signatures' | (string & {});

/** Context passed to `signoraSlot` templates. */
export interface SignoraSlotContext {
  /** The session, as the implicit template variable (`let-session`). */
  readonly $implicit: SigningSession;
  readonly session: SigningSession;
}

/**
 * Replaces a section of the default UI with your own template:
 *
 * ```html
 * <signora-viewer>
 *   <ng-template signoraSlot="toolbar" let-session>
 *     <button (click)="session.nextPage()">Next</button>
 *   </ng-template>
 * </signora-viewer>
 * ```
 */
@Directive({ selector: 'ng-template[signoraSlot]' })
export class SignoraSlotDirective {
  readonly name = input.required<SignoraSlotName>({ alias: 'signoraSlot' });
  readonly template = inject<TemplateRef<SignoraSlotContext>>(TemplateRef);

  /* eslint-disable @typescript-eslint/no-unused-vars -- signature is dictated by Angular's template type checker */
  static ngTemplateContextGuard(
    _directive: SignoraSlotDirective,
    _context: unknown,
  ): _context is SignoraSlotContext {
    return true;
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
