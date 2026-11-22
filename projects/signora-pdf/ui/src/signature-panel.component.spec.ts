import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  SigningSession,
  provideSignora,
  withOrganizationSignatures,
  withRenderer,
  type SignatureAsset,
} from 'signora-pdf';
import { ASSET, InstantRenderer, key } from './fake-pdf.testing';
import { SignoraSignaturePanelComponent } from './signature-panel.component';
import { SignoraSignatureUploadComponent } from './signature-upload.component';

const ORG: readonly SignatureAsset[] = [
  { id: 'org-1', kind: 'organization', label: 'Approved', dataUrl: 'data:,a', aspectRatio: 2 },
  { id: 'org-2', kind: 'organization', label: 'Logo', dataUrl: 'data:,b', aspectRatio: 1 },
];

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('SignoraSignaturePanelComponent', () => {
  let fixture: ComponentFixture<SignoraSignaturePanelComponent>;
  let session: SigningSession;
  const all = <T extends HTMLElement>(selector: string) =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<T>(selector));
  const tab = (name: string) => all('[role=tab]').find((t) => t.textContent?.trim() === name)!;

  async function create(assets: SignatureAsset[] | (() => Promise<SignatureAsset[]>) = [...ORG]) {
    TestBed.configureTestingModule({
      providers: [
        provideSignora(
          withRenderer(InstantRenderer),
          withOrganizationSignatures({ label: 'Acme', assets }),
        ),
      ],
    });
    session = TestBed.inject(SigningSession);
    fixture = TestBed.createComponent(SignoraSignaturePanelComponent);
    // The draw pad needs a real canvas, which jsdom lacks: use the tabs that do not.
    fixture.componentRef.setInput('builtInTabs', ['upload']);
    await settle(fixture);
    await settle(fixture);
  }

  it('exposes accessible tabs: built-ins plus one per provider listing assets', async () => {
    await create();
    expect(all('[role=tablist]').length).toBe(1);
    expect(all('[role=tab]').map((t) => t.textContent?.trim())).toEqual(['Upload', 'Acme']);
    expect(tab('Upload').getAttribute('aria-selected')).toBe('true');
    expect(tab('Acme').getAttribute('aria-selected')).toBe('false');
    expect(tab('Acme').getAttribute('tabindex')).toBe('-1');
    const panel = all('[role=tabpanel]')[0];
    expect(panel.getAttribute('aria-labelledby')).toBe(tab('Upload').id);
    expect(tab('Upload').getAttribute('aria-controls')).toBe(panel.id);
  });

  it('lists the provider assets and arms one when chosen', async () => {
    await create();
    tab('Acme').click();
    await settle(fixture);
    const cards = all<HTMLButtonElement>('[role=tabpanel] .asset');
    expect(cards.map((c) => c.textContent?.trim())).toEqual(['Approved', 'Logo']);

    cards[0].click();
    await settle(fixture);
    expect(session.armedAsset()?.id).toBe('org-1');
    expect(all('.armed[role=status]').length).toBe(1);
    // The chosen asset joins the "ready to place" list and is marked pressed.
    const library = all<HTMLButtonElement>('.library-item .asset');
    expect(library.length).toBe(1);
    expect(library[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('supports cancelling and removing from the library', async () => {
    await create();
    session.arm(ASSET);
    await settle(fixture);
    all<HTMLButtonElement>('.armed .link')[0].click();
    expect(session.armedAsset()).toBeNull();
    await settle(fixture);
    all<HTMLButtonElement>('.library-item .remove')[0].click();
    expect(session.assets().length).toBe(0);
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain('Create or choose a signature above.');
  });

  it('does not impose a heading level on the host page', async () => {
    await create();
    session.addAsset(ASSET);
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('h1,h2,h3,h4,h5,h6')).toBeNull();
    const title = fixture.nativeElement.querySelector('#signora-library-title');
    expect(title?.textContent?.trim()).toBe('Ready to place');
    // The list of ready signatures is named by that title.
    expect(
      fixture.nativeElement.querySelector('ul[aria-labelledby="signora-library-title"]'),
    ).not.toBeNull();
  });

  it('makes library cards draggable for drop onto a page', async () => {
    await create();
    session.addAsset(ASSET);
    await settle(fixture);
    expect(all('.library-item .asset')[0].getAttribute('draggable')).toBe('true');
  });

  it('navigates tabs with the keyboard, wrapping around', async () => {
    await create();
    key(tab('Upload'), 'ArrowRight');
    await settle(fixture);
    expect(tab('Acme').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Acme'));

    key(tab('Acme'), 'ArrowRight');
    await settle(fixture);
    expect(tab('Upload').getAttribute('aria-selected')).toBe('true');

    key(tab('Upload'), 'End');
    await settle(fixture);
    expect(tab('Acme').getAttribute('aria-selected')).toBe('true');
    key(tab('Acme'), 'Home');
    await settle(fixture);
    expect(tab('Upload').getAttribute('aria-selected')).toBe('true');
  });

  it('shows an empty message when a provider fails or returns nothing', async () => {
    await create(() => Promise.reject(new Error('offline')));
    tab('Acme').click();
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain(
      'No organization signatures are available.',
    );
  });

  it('loads provider assets asynchronously', async () => {
    await create(() => new Promise((resolve) => setTimeout(() => resolve([...ORG]), 10)));
    tab('Acme').click();
    await vi.waitFor(() => expect(all('[role=tabpanel] .asset').length).toBe(2));
  });
});

describe('SignoraSignatureUploadComponent', () => {
  let fixture: ComponentFixture<SignoraSignatureUploadComponent>;
  const created: SignatureAsset[] = [];

  beforeEach(async () => {
    created.length = 0;
    TestBed.configureTestingModule({ providers: [provideSignora(withRenderer(InstantRenderer))] });
    fixture = TestBed.createComponent(SignoraSignatureUploadComponent);
    fixture.componentInstance.created.subscribe((a) => created.push(a));
    fixture.componentRef.setInput('maxBytes', 100);
    await settle(fixture);
  });

  async function choose(file: File): Promise<void> {
    const input = fixture.nativeElement.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: { item: () => file, length: 1 },
      configurable: true,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(fixture);
    await settle(fixture);
  }
  const alert = () => fixture.nativeElement.querySelector('[role=alert]')?.textContent?.trim();

  it('only accepts image types', async () => {
    expect(fixture.nativeElement.querySelector('input').accept).toBe(
      'image/png,image/jpeg,image/webp,image/svg+xml',
    );
  });

  it('rejects files that are not images', async () => {
    await choose(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(alert()).toBe('That file is not a supported image.');
    expect(created).toEqual([]);
  });

  it('rejects files over the size limit', async () => {
    await choose(new File(['x'.repeat(500)], 'big.png', { type: 'image/png' }));
    expect(alert()).toBe('That image is too large.');
    expect(created).toEqual([]);
  });

  it('reports undecodable images instead of failing silently', async () => {
    // jsdom cannot decode images, which exercises the failure path.
    await choose(new File(['x'], 'broken.png', { type: 'image/png' }));
    expect(alert()).toBe('That file is not a supported image.');
  });
});
