import type { SignoraThemeTokens } from 'signora-pdf/ui';

export interface ThemePreset {
  readonly id: string;
  readonly label: string;
  readonly tokens: SignoraThemeTokens;
}

/** Example themes: just sets of `--signora-*` design tokens. */
export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: 'default', label: 'Default', tokens: {} },
  {
    id: 'midnight',
    label: 'Midnight',
    tokens: {
      'color-bg': '#0f1220',
      'color-toolbar-bg': '#171b2e',
      'color-surface': '#171b2e',
      'color-text': '#e7e9f4',
      'color-text-muted': '#9aa3c0',
      'color-border': '#2b3150',
      'color-hover': '#232845',
      'color-focus-ring': '#8ea2ff',
      'color-accent': '#8ea2ff',
      'color-accent-contrast': '#0f1220',
      'page-shadow': '0 0 0 1px #2b3150, 0 12px 32px rgb(0 0 0 / 0.5)',
    },
  },
  {
    id: 'rose',
    label: 'Rose, rounded',
    tokens: {
      'color-bg': '#fdf2f4',
      'color-toolbar-bg': '#ffffff',
      'color-hover': '#ffe3e8',
      'color-focus-ring': '#e11d48',
      'color-accent': '#be123c',
      'color-border': '#f3c6d0',
      radius: '999px',
      'font-family': 'Georgia, serif',
    },
  },
];

export type TokenKind = 'color' | 'length' | 'font';

export interface TokenControl {
  readonly key: string;
  readonly label: string;
  readonly kind: TokenKind;
  /** What the library uses when nothing overrides the token. */
  readonly fallback: string;
}

/** Tokens editable in the live theme panel. Defaults mirror the library fallbacks. */
export const TOKEN_CONTROLS: readonly TokenControl[] = [
  { key: 'color-accent', label: 'Accent', kind: 'color', fallback: '#3b5bdb' },
  { key: 'color-accent-contrast', label: 'Text on accent', kind: 'color', fallback: '#ffffff' },
  { key: 'color-bg', label: 'Viewer background', kind: 'color', fallback: '#e9ecf1' },
  { key: 'color-toolbar-bg', label: 'Toolbar / panel', kind: 'color', fallback: '#ffffff' },
  { key: 'color-text', label: 'Text', kind: 'color', fallback: '#1f2430' },
  { key: 'color-border', label: 'Borders', kind: 'color', fallback: '#d5d9e2' },
  { key: 'signature-ink', label: 'Signature ink', kind: 'color', fallback: '#1b1f3b' },
  { key: 'radius', label: 'Corner radius', kind: 'length', fallback: '8px' },
  { key: 'space', label: 'Spacing unit', kind: 'length', fallback: '8px' },
  { key: 'font-family', label: 'Font', kind: 'font', fallback: 'system-ui, sans-serif' },
];

export const FONT_CHOICES: readonly { label: string; value: string }[] = [
  { label: 'System', value: 'system-ui, sans-serif' },
  { label: 'Serif', value: 'Georgia, serif' },
  { label: 'Monospace', value: 'ui-monospace, Consolas, monospace' },
];

/** `<input type="color">` only accepts `#rrggbb`. */
export function toHexColor(value: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#000000';
}

/** The CSS a consumer would paste to get the same look. */
export function tokensToCss(tokens: SignoraThemeTokens, selector = 'signora-viewer'): string {
  const lines = Object.entries(tokens).map(([key, value]) => `  --signora-${key}: ${value};`);
  return lines.length
    ? `${selector} {\n${lines.join('\n')}\n}`
    : `/* default theme: no overrides */`;
}
