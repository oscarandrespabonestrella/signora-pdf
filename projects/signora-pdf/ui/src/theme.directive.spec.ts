import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SignoraThemeDirective, type SignoraThemeTokens } from './theme.directive';

@Component({
  imports: [SignoraThemeDirective],
  template: `<div class="host" [signoraTheme]="tokens()"></div>`,
})
class Host {
  readonly tokens = signal<SignoraThemeTokens | null>({ 'color-accent': '#e11d48', radius: '4px' });
}

describe('SignoraThemeDirective', () => {
  async function create() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const style = (fixture.nativeElement.querySelector('.host') as HTMLElement).style;
    return { fixture, style };
  }

  it('applies tokens as --signora-* custom properties', async () => {
    const { style } = await create();
    expect(style.getPropertyValue('--signora-color-accent')).toBe('#e11d48');
    expect(style.getPropertyValue('--signora-radius')).toBe('4px');
  });

  it('removes tokens that are no longer present when the theme changes', async () => {
    const { fixture, style } = await create();
    fixture.componentInstance.tokens.set({ radius: '12px' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(style.getPropertyValue('--signora-radius')).toBe('12px');
    expect(style.getPropertyValue('--signora-color-accent')).toBe('');
  });

  it('clears everything for a null theme', async () => {
    const { fixture, style } = await create();
    fixture.componentInstance.tokens.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(style.length).toBe(0);
  });
});
