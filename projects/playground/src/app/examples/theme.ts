import { Component, computed, signal } from '@angular/core';
import {
  SignoraThemeDirective,
  SignoraViewerComponent,
  type SignoraThemeTokens,
} from 'signora-pdf/ui';

const THEMES: Record<string, SignoraThemeTokens> = {
  default: {},
  rose: { 'color-accent': '#e11d48', radius: '999px' },
  midnight: {
    'color-bg': '#0f1220',
    'color-toolbar-bg': '#171a2e',
    'color-panel-bg': '#171a2e',
    'color-surface': '#1f2340',
    'color-text': '#e8eaf6',
    'color-text-muted': '#a3a9c9',
    'color-border': '#2d3258',
    'color-hover': '#232850',
    'color-accent': '#8da2ff',
    'color-accent-contrast': '#0f1220',
  },
};

/** Restyle with CSS variables; the keys omit the `--signora-` prefix. */
@Component({
  selector: 'app-example-theme',
  imports: [SignoraViewerComponent, SignoraThemeDirective],
  host: { class: 'example' },
  template: `
    <div class="example-bar" role="group" aria-label="Theme">
      @for (name of names; track name) {
        <button type="button" [attr.aria-pressed]="name === current()" (click)="current.set(name)">
          {{ name }}
        </button>
      }
    </div>
    <signora-viewer
      source="samples/contract.pdf"
      [showSignaturePanel]="true"
      [signoraTheme]="theme()"
    />
  `,
})
export class ThemeExample {
  protected readonly names = Object.keys(THEMES);
  protected readonly current = signal('rose');
  protected readonly theme = computed(() => THEMES[this.current()]);
}
