import { Component, computed, effect, output, signal } from '@angular/core';
import type { SignoraThemeTokens } from 'signora-pdf/ui';
import {
  FONT_CHOICES,
  THEME_PRESETS,
  TOKEN_CONTROLS,
  toHexColor,
  tokensToCss,
  type TokenControl,
} from '../themes';

/**
 * Live theme editor: pick a preset, then override individual design tokens.
 * Emits the resulting token map; the host applies it with `signoraTheme`.
 */
@Component({
  selector: 'app-theme-panel',
  templateUrl: './theme-panel.html',
  styleUrl: './theme-panel.css',
})
export class ThemePanel {
  protected readonly presets = THEME_PRESETS;
  protected readonly controls = TOKEN_CONTROLS;
  protected readonly fonts = FONT_CHOICES;

  protected readonly presetId = signal('default');
  protected readonly overrides = signal<Readonly<Record<string, string>>>({});
  protected readonly copied = signal(false);

  /** Preset tokens with the user's overrides on top. */
  readonly tokens = computed<SignoraThemeTokens>(() => {
    const preset = this.presets.find((p) => p.id === this.presetId())?.tokens ?? {};
    return { ...preset, ...this.overrides() };
  });
  protected readonly css = computed(() => tokensToCss(this.tokens()));

  /** Emits whenever the effective tokens change. */
  readonly tokensChange = output<SignoraThemeTokens>();

  constructor() {
    effect(() => this.tokensChange.emit(this.tokens()));
  }

  protected value(control: TokenControl): string {
    return this.tokens()[control.key] ?? control.fallback;
  }

  protected colorValue(control: TokenControl): string {
    return toHexColor(this.value(control));
  }

  /** Length controls are edited as a number of pixels. */
  protected pixels(control: TokenControl): number {
    return Number.parseFloat(this.value(control)) || 0;
  }

  protected selectPreset(event: Event): void {
    this.presetId.set((event.target as HTMLSelectElement).value);
    // A preset is a fresh starting point: drop manual overrides.
    this.overrides.set({});
  }

  protected set(control: TokenControl, event: Event): void {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    const value = control.kind === 'length' ? `${input.value}px` : input.value;
    this.overrides.update((all) => ({ ...all, [control.key]: value }));
  }

  protected reset(): void {
    this.presetId.set('default');
    this.overrides.set({});
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.css());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard access can be denied; the CSS is still visible to copy by hand.
    }
  }
}
