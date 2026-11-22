import { Directive, ElementRef, effect, inject, input } from '@angular/core';

/** Design tokens understood by the default UI (set as `--signora-<name>`). */
export type SignoraThemeTokens = Readonly<Record<string, string>>;

/**
 * Applies design tokens as CSS custom properties on the host element, so
 * everything inside it is themed. Keys are token names without the
 * `--signora-` prefix, e.g. `{ 'color-accent': '#e11d48' }`.
 *
 * Plain CSS works too: set the same `--signora-*` variables on any ancestor.
 */
@Directive({ selector: '[signoraTheme]' })
export class SignoraThemeDirective {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly tokens = input<SignoraThemeTokens | null | undefined>(null, { alias: 'signoraTheme' });

  constructor() {
    effect((onCleanup) => {
      const tokens = this.tokens() ?? {};
      const names = Object.keys(tokens).map((name) => `--signora-${name}`);
      names.forEach((name, i) => this.element.style.setProperty(name, Object.values(tokens)[i]));
      onCleanup(() => names.forEach((name) => this.element.style.removeProperty(name)));
    });
  }
}
