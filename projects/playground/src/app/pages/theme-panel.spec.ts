import { TestBed } from '@angular/core/testing';
import type { SignoraThemeTokens } from 'signora-pdf/ui';
import { THEME_PRESETS, toHexColor, tokensToCss } from '../themes';
import { ThemePanel } from './theme-panel';

describe('theme helpers', () => {
  it('normalizes colors for <input type="color">', () => {
    expect(toHexColor('#fff')).toBe('#ffffff');
    expect(toHexColor('#1B1F3B')).toBe('#1b1f3b');
    expect(toHexColor('rebeccapurple')).toBe('#000000');
  });

  it('prints the CSS a consumer would paste', () => {
    expect(tokensToCss({})).toContain('no overrides');
    expect(tokensToCss({ radius: '4px', 'color-accent': '#e11d48' })).toBe(
      'signora-viewer {\n  --signora-radius: 4px;\n  --signora-color-accent: #e11d48;\n}',
    );
  });

  it('only ships presets made of known token names', () => {
    for (const preset of THEME_PRESETS) {
      for (const key of Object.keys(preset.tokens)) expect(key).toMatch(/^[a-z][a-z-]*$/);
    }
  });
});

describe('ThemePanel', () => {
  async function create() {
    const fixture = TestBed.createComponent(ThemePanel);
    const emitted: SignoraThemeTokens[] = [];
    fixture.componentInstance.tokensChange.subscribe((t) => emitted.push(t));
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const input = (token: string) =>
      root.querySelector<HTMLInputElement>(`[data-token="${token}"]`)!;
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    return { fixture, emitted, root, input, settle };
  }

  it('starts with no overrides', async () => {
    const { emitted } = await create();
    expect(emitted.at(-1)).toEqual({});
  });

  it('turns control changes into tokens', async () => {
    const { emitted, input, settle } = await create();
    const accent = input('color-accent');
    accent.value = '#e11d48';
    accent.dispatchEvent(new Event('input', { bubbles: true }));
    const radius = input('radius');
    radius.value = '16';
    radius.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(emitted.at(-1)).toEqual({ 'color-accent': '#e11d48', radius: '16px' });
  });

  it('shows the generated CSS and resets', async () => {
    const { root, emitted, input, settle } = await create();
    const accent = input('color-accent');
    accent.value = '#00ff00';
    accent.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(root.querySelector('textarea')!.value).toContain('--signora-color-accent: #00ff00;');

    Array.from(root.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Reset')!
      .click();
    await settle();
    expect(emitted.at(-1)).toEqual({});
    expect(root.querySelector('textarea')!.value).toContain('no overrides');
  });

  it('a preset replaces manual overrides', async () => {
    const { root, emitted, input, settle } = await create();
    const accent = input('color-accent');
    accent.value = '#00ff00';
    accent.dispatchEvent(new Event('input', { bubbles: true }));
    const select = root.querySelector('select')!;
    select.value = 'midnight';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const tokens = emitted.at(-1)!;
    expect(tokens['color-bg']).toBe('#0f1220');
    expect(tokens['color-accent']).toBe('#8ea2ff'); // the preset's, not the manual green
  });
});
