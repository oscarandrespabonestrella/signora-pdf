import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { SigningSession, provideSignora, withRenderer } from 'signora-pdf';
import { A4, FakeHandle, FakeRenderer, InstantRenderer, key } from './fake-pdf.testing';
import { DEFAULT_SIGNORA_LABELS, SIGNORA_LABELS } from './labels';
import { SignoraSlotDirective } from './slots';
import { SignoraViewerComponent } from './viewer.component';

@Component({
  imports: [SignoraViewerComponent],
  template: `<signora-viewer
    [source]="source()"
    [showToolbar]="toolbar()"
    [showSignaturePanel]="panel()"
  />`,
})
class PlainHost {
  readonly source = signal<string | null>(null);
  readonly toolbar = signal(true);
  readonly panel = signal(false);
}

@Component({
  imports: [SignoraViewerComponent, SignoraSlotDirective],
  template: `
    <signora-viewer [source]="'x.pdf'">
      <ng-template signoraSlot="toolbar" let-session>
        <button class="custom-next" (click)="session.nextPage()">next</button>
        <span class="custom-page">{{ session.currentPage() }}</span>
      </ng-template>
      <ng-template signoraSlot="loading"><p class="custom-loading">wait</p></ng-template>
      <ng-template signoraSlot="error"><p class="custom-error">broken</p></ng-template>
    </signora-viewer>
  `,
})
class SlottedHost {}

@Component({
  imports: [SignoraViewerComponent, SignoraSlotDirective],
  template: `
    <signora-viewer>
      <ng-template signoraSlot="empty"><p class="custom-empty">Pick a file</p></ng-template>
    </signora-viewer>
  `,
})
class EmptySlotHost {}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

const q = <T extends Element>(fixture: ComponentFixture<unknown>, selector: string): T | null =>
  (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
const all = (fixture: ComponentFixture<unknown>, selector: string): HTMLElement[] =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(selector));
const button = (fixture: ComponentFixture<unknown>, label: string): HTMLButtonElement =>
  all(fixture, 'button').find((b) => b.getAttribute('aria-label') === label) as HTMLButtonElement;

describe('SignoraViewerComponent', () => {
  describe('with a manually controlled renderer', () => {
    beforeEach(() => {
      FakeRenderer.reset();
      TestBed.configureTestingModule({ providers: [provideSignora(withRenderer(FakeRenderer))] });
    });

    it('goes through empty, loading, ready and error states', async () => {
      const fixture = TestBed.createComponent(PlainHost);
      await settle(fixture);
      expect(q(fixture, '.message')?.textContent).toContain(DEFAULT_SIGNORA_LABELS.empty);

      fixture.componentInstance.source.set('a.pdf');
      await settle(fixture);
      expect(q(fixture, '[role=status].message')?.textContent).toContain(
        DEFAULT_SIGNORA_LABELS.loading,
      );

      FakeRenderer.pending[0].resolve(new FakeHandle(3));
      await settle(fixture);
      expect(q(fixture, 'signora-page canvas')).not.toBeNull();
      expect(q(fixture, '.visually-hidden[aria-live]')?.textContent).toContain('Page 1 of 3');

      fixture.componentInstance.source.set('b.pdf');
      await settle(fixture);
      FakeRenderer.pending[1].reject(new Error('bad file'));
      await settle(fixture);
      expect(q(fixture, '[role=alert]')?.textContent).toContain(DEFAULT_SIGNORA_LABELS.error);
    });

    it('lets templates replace the toolbar, loading and error sections', async () => {
      const fixture = TestBed.createComponent(SlottedHost);
      await settle(fixture);
      expect(q(fixture, '.custom-loading')).not.toBeNull();
      expect(q(fixture, 'signora-toolbar')).toBeNull();

      FakeRenderer.pending[0].resolve(new FakeHandle(3));
      await settle(fixture);
      expect(q(fixture, '.custom-page')?.textContent).toBe('1');
      q<HTMLButtonElement>(fixture, '.custom-next')?.click();
      await settle(fixture);
      expect(q(fixture, '.custom-page')?.textContent).toBe('2');
    });

    it('shows a custom error template', async () => {
      const fixture = TestBed.createComponent(SlottedHost);
      await settle(fixture);
      FakeRenderer.pending[0].reject(new Error('nope'));
      await settle(fixture);
      expect(q(fixture, '.custom-error')?.textContent).toBe('broken');
      expect(q(fixture, '[role=alert]')).toBeNull();
    });

    it('lets a template replace the empty state', async () => {
      const fixture = TestBed.createComponent(EmptySlotHost);
      await settle(fixture);
      expect(q(fixture, '.custom-empty')?.textContent).toBe('Pick a file');
    });
  });

  describe('with a loaded document', () => {
    let fixture: ComponentFixture<PlainHost>;
    let session: SigningSession;

    beforeEach(async () => {
      TestBed.configureTestingModule({
        providers: [provideSignora(withRenderer(InstantRenderer))],
      });
      fixture = TestBed.createComponent(PlainHost);
      session = TestBed.inject(SigningSession);
      fixture.componentInstance.source.set('doc.pdf');
      await settle(fixture);
      await settle(fixture);
    });

    it('asks the renderer to draw the current page and redraws on zoom and rotation', async () => {
      const handle = InstantRenderer.last!;
      expect(handle.rendered).toContain(0);
      const before = handle.rendered.length;
      session.zoomIn();
      await settle(fixture);
      expect(handle.rendered.length).toBeGreaterThan(before);
      const afterZoom = handle.rendered.length;
      session.rotateClockwise();
      await settle(fixture);
      expect(handle.rendered.length).toBeGreaterThan(afterZoom);
      session.nextPage();
      await settle(fixture);
      expect(handle.rendered.at(-1)).toBe(1);
    });

    it('sizes the page from its geometry, zoom and rotation', async () => {
      const page = q<HTMLElement>(fixture, '.page')!;
      const scale = session.scale();
      expect(Number.parseFloat(page.style.width)).toBeCloseTo(A4.width * scale, 2);
      session.rotateClockwise();
      await settle(fixture);
      expect(Number.parseFloat(q<HTMLElement>(fixture, '.page')!.style.width)).toBeCloseTo(
        A4.height * scale,
        2,
      );
    });

    it('navigates with the keyboard from the viewer', async () => {
      const region = q<HTMLElement>(fixture, '.stage')!;
      key(region, 'ArrowRight');
      expect(session.currentPage()).toBe(2);
      key(region, 'PageDown');
      expect(session.currentPage()).toBe(3);
      key(region, 'ArrowLeft');
      expect(session.currentPage()).toBe(2);
      key(region, '+');
      expect(session.zoom()).toBeGreaterThan(1);
      key(region, 'r');
      expect(session.rotation()).toBe(90);
    });

    it('does not steal keys from text fields or modified shortcuts', async () => {
      const field = q<HTMLInputElement>(fixture, 'input[type=number]')!;
      const event = key(field, 'ArrowRight');
      expect(session.currentPage()).toBe(1);
      expect(event.defaultPrevented).toBe(false);

      key(q(fixture, '.stage')!, 'ArrowRight', { ctrlKey: true });
      expect(session.currentPage()).toBe(1);
    });

    it('has one keyboard focus stop: the scrollable page area, with an accessible name', async () => {
      const stage = q<HTMLElement>(fixture, '.stage')!;
      expect(stage.getAttribute('tabindex')).toBe('0');
      expect(stage.getAttribute('role')).toBe('group');
      expect(stage.getAttribute('aria-label')).toBe(DEFAULT_SIGNORA_LABELS.pages);
      // The wrapping region is named but is not a second tab stop.
      const region = q<HTMLElement>(fixture, '[role=region]')!;
      expect(region.getAttribute('aria-label')).toBe(DEFAULT_SIGNORA_LABELS.viewer);
      expect(region.hasAttribute('tabindex')).toBe(false);
    });

    it('hides the toolbar on request', async () => {
      expect(q(fixture, 'signora-toolbar')).not.toBeNull();
      fixture.componentInstance.toolbar.set(false);
      await settle(fixture);
      expect(q(fixture, 'signora-toolbar')).toBeNull();
    });

    it('shows the signature panel only when asked, and keys inside it do not navigate', async () => {
      expect(q(fixture, 'aside')).toBeNull();
      fixture.componentInstance.panel.set(true);
      await settle(fixture);
      const aside = q<HTMLElement>(fixture, 'aside')!;
      expect(aside.querySelector('[role=tablist]')).not.toBeNull();
      key(aside.querySelector('[role=tab]')!, 'PageDown');
      expect(session.currentPage()).toBe(1);
    });
  });

  describe('toolbar', () => {
    let fixture: ComponentFixture<PlainHost>;
    let session: SigningSession;

    beforeEach(async () => {
      TestBed.configureTestingModule({
        providers: [provideSignora(withRenderer(InstantRenderer))],
      });
      fixture = TestBed.createComponent(PlainHost);
      session = TestBed.inject(SigningSession);
      fixture.componentInstance.source.set('doc.pdf');
      await settle(fixture);
      await settle(fixture);
    });

    it('disables controls at the document edges', async () => {
      expect(button(fixture, 'Previous page').disabled).toBe(true);
      expect(button(fixture, 'Next page').disabled).toBe(false);
      session.goToPage(3);
      await settle(fixture);
      expect(button(fixture, 'Next page').disabled).toBe(true);
      expect(button(fixture, 'Previous page').disabled).toBe(false);
    });

    it('drives the session from its buttons and page field', async () => {
      button(fixture, 'Next page').click();
      expect(session.currentPage()).toBe(2);
      button(fixture, 'Zoom in').click();
      expect(session.zoom()).toBeCloseTo(1.25);
      button(fixture, 'Rotate clockwise').click();
      expect(session.rotation()).toBe(90);
      button(fixture, 'Rotate counter-clockwise').click();
      expect(session.rotation()).toBe(0);

      const field = q<HTMLInputElement>(fixture, 'input[type=number]')!;
      field.value = '99';
      field.dispatchEvent(new Event('change', { bubbles: true }));
      expect(session.currentPage()).toBe(3);
      expect(field.value).toBe('3'); // out-of-range input is re-synced
    });

    it('shows the zoom as a percentage', async () => {
      session.setZoom(1.5);
      await settle(fixture);
      expect(q(fixture, 'output.zoom')?.textContent?.trim()).toBe('150%');
    });
  });

  it('uses translated labels from SIGNORA_LABELS', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideSignora(withRenderer(InstantRenderer)),
        {
          provide: SIGNORA_LABELS,
          useValue: {
            ...DEFAULT_SIGNORA_LABELS,
            nextPage: 'Página siguiente',
            empty: 'Sin documento',
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(PlainHost);
    await settle(fixture);
    expect(button(fixture, 'Página siguiente')).toBeDefined();
    expect(q(fixture, '.message')?.textContent).toContain('Sin documento');
  });
});
