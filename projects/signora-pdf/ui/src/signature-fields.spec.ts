import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  CSS_UNITS,
  SigningSession,
  provideSignora,
  withRenderer,
  type SignatureField,
} from 'signora-pdf';
import { ASSET, InstantRenderer, key, pointer } from './fake-pdf.testing';
import type { FieldsMode } from './signature-layer.component';
import { SignoraViewerComponent } from './viewer.component';

const S = CSS_UNITS;
const FIELD: SignatureField = {
  id: 'client',
  pageIndex: 0,
  rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
  label: 'Client signature',
  required: true,
};
const OTHER: SignatureField = {
  id: 'witness',
  pageIndex: 0,
  rect: { x: 0.1, y: 0.4, width: 0.3, height: 0.1 },
};

@Component({
  imports: [SignoraViewerComponent],
  template: `<signora-viewer
    [source]="source()"
    [showSignaturePanel]="true"
    [signatureFields]="fields()"
    [fieldsMode]="mode()"
    [freePlacement]="free()"
    [readOnly]="ro()"
    (fieldsChange)="emitted.push($event)"
  />`,
})
class Host {
  readonly source = signal('a.pdf');
  readonly fields = signal<readonly SignatureField[]>([FIELD, OTHER]);
  readonly mode = signal<FieldsMode>('fill');
  readonly free = signal(true);
  readonly ro = signal(false);
  readonly emitted: (readonly SignatureField[])[] = [];
}

describe('signature fields in the viewer', () => {
  let fixture: ComponentFixture<Host>;
  let session: SigningSession;

  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  const all = (selector: string) =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(selector));
  const field = (id: string) => all('.field').find((f) => f.dataset['fieldId'] === id)!;
  /** Pixel position inside the first page for a normalized point (box is 0,0 in jsdom). */
  const px = (x: number, y: number) => ({ x: x * 595 * S, y: y * 842 * S });

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideSignora(withRenderer(InstantRenderer))] });
    fixture = TestBed.createComponent(Host);
    session = TestBed.inject(SigningSession);
    await settle();
  });

  it('shows the fields with their label, required mark and accessible name', () => {
    expect(all('.field')).toHaveLength(2);
    expect(field('client').textContent).toContain('Client signature');
    expect(field('client').textContent).toContain('*');
    expect(field('client').getAttribute('aria-label')).toContain('required');
    expect(field('client').getAttribute('role')).toBe('button');
    expect(field('witness').textContent).toContain('Signature field');
  });

  it('fills the field that is chosen when a signature is picked next', async () => {
    pointer(field('client'), 'pointerdown', 10, 10);
    await settle();
    expect(session.selectedFieldId()).toBe('client');
    session.arm(ASSET);
    await settle();
    expect(session.placements()).toHaveLength(1);
    expect(session.placements()[0].fieldId).toBe('client');
    expect(field('client').classList).toContain('filled');
    expect(session.validate().valid).toBe(true);
  });

  it('fills a field with the armed signature on click, or with Enter', async () => {
    session.arm(ASSET);
    pointer(field('client'), 'pointerdown', 10, 10);
    await settle();
    expect(session.placements().map((p) => p.fieldId)).toEqual(['client']);

    session.selectField(null);
    session.arm(ASSET);
    field('witness').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await settle();
    expect(session.placements().map((p) => p.fieldId)).toEqual(['client', 'witness']);
  });

  it('puts a signature clicked on the page into the empty field under it', async () => {
    session.arm(ASSET);
    const layer = all('.layer')[0];
    const point = px(0.2, 0.15);
    pointer(layer, 'pointerdown', point.x, point.y);
    await settle();
    expect(session.placements()).toHaveLength(1);
    expect(session.placements()[0].fieldId).toBe('client');
  });

  it('only allows signatures inside fields when freePlacement is off', async () => {
    fixture.componentInstance.free.set(false);
    await settle();
    session.arm(ASSET);
    const point = px(0.7, 0.8);
    pointer(all('.layer')[0], 'pointerdown', point.x, point.y);
    await settle();
    expect(session.placements()).toHaveLength(0);
    expect(session.armedAsset()).not.toBeNull();
  });

  it('keeps a signature in its field: no handles, no dragging, no arrow moves', async () => {
    await session.fillField('client', ASSET);
    await settle();
    const placement = all('[data-signora-placement]')[0];
    const before = { ...session.placements()[0].rect };
    pointer(placement, 'pointerdown', 20, 20);
    pointer(placement, 'pointermove', 200, 200);
    pointer(placement, 'pointerup', 200, 200);
    key(placement, 'ArrowRight');
    await settle();
    expect(session.placements()[0].rect).toEqual(before);
    expect(all('.handle')).toHaveLength(0);
  });

  it('Delete empties the field and keeps it', async () => {
    await session.fillField('client', ASSET);
    await settle();
    const placement = all('[data-signora-placement]')[0];
    pointer(placement, 'pointerdown', 20, 20);
    key(placement, 'Delete');
    await settle();
    expect(session.placements()).toHaveLength(0);
    expect(session.fields()).toHaveLength(2);
    expect(field('client').classList).not.toContain('filled');
  });

  it('applies the fields to every document that is loaded', async () => {
    await session.fillField('client', ASSET);
    fixture.componentInstance.source.set('b.pdf');
    await settle();
    expect(session.fields().map((f) => f.id)).toEqual(['client', 'witness']);
    expect(session.placements()).toHaveLength(0);
  });

  it('emits fieldsChange', async () => {
    expect(fixture.componentInstance.emitted.at(-1)?.map((f) => f.id)).toEqual([
      'client',
      'witness',
    ]);
  });

  it('read-only mode shows the fields but they cannot be used', async () => {
    fixture.componentInstance.ro.set(true);
    await settle();
    expect(all('.field')).toHaveLength(2);
    expect(field('client').getAttribute('role')).toBe('group');
    session.arm(ASSET);
    pointer(field('client'), 'pointerdown', 10, 10);
    await settle();
    expect(session.placements()).toHaveLength(0);
  });

  describe('edit mode', () => {
    beforeEach(async () => {
      fixture.componentInstance.mode.set('edit');
      await settle();
    });

    it('shows the editor and hides the signature panel', () => {
      expect(all('signora-field-editor')).toHaveLength(1);
      expect(all('signora-signature-panel')).toHaveLength(0);
    });

    it('adds a field where the page is clicked, selects it and can name it', async () => {
      const add = all('signora-field-editor button.add')[0];
      add.click();
      await settle();
      expect(session.addingField()).toBe(true);
      const point = px(0.5, 0.6);
      pointer(all('.layer')[0], 'pointerdown', point.x, point.y);
      await settle();
      expect(session.fields()).toHaveLength(3);
      expect(session.addingField()).toBe(false);
      const created = session.selectedField()!;
      expect(created.pageIndex).toBe(0);
      expect(created.rect.x).toBeGreaterThan(0.3);

      const name = all('signora-field-editor input[type=text]')[0] as HTMLInputElement;
      name.value = 'Witness 2';
      name.dispatchEvent(new Event('input'));
      const required = all('signora-field-editor input[type=checkbox]')[0] as HTMLInputElement;
      required.checked = true;
      required.dispatchEvent(new Event('change'));
      await settle();
      expect(session.selectedField()).toMatchObject({ label: 'Witness 2', required: true });
    });

    it('moves and resizes a field, and removes it', async () => {
      const el = field('client');
      pointer(el, 'pointerdown', 10, 10);
      await settle();
      expect(session.selectedFieldId()).toBe('client');
      pointer(el, 'pointermove', 10 + 0.2 * 595 * S, 10);
      pointer(el, 'pointerup', 10, 10);
      await settle();
      expect(session.fields().find((f) => f.id === 'client')!.rect.x).toBeCloseTo(0.3, 1);

      const handle = all('.field .handle[data-corner=se]')[0];
      const rect = session.fields().find((f) => f.id === 'client')!.rect;
      pointer(handle, 'pointerdown', 0, 0);
      const corner = px(rect.x + rect.width + 0.1, rect.y + rect.height);
      pointer(handle, 'pointermove', corner.x, corner.y);
      pointer(handle, 'pointerup', corner.x, corner.y);
      await settle();
      expect(session.fields().find((f) => f.id === 'client')!.rect.width).toBeCloseTo(0.4, 1);

      all('.field .remove')[0].click();
      await settle();
      expect(session.fields().map((f) => f.id)).toEqual(['witness']);
    });

    it('does not place signatures while editing fields', async () => {
      session.arm(ASSET);
      const point = px(0.7, 0.8);
      pointer(all('.layer')[0], 'pointerdown', point.x, point.y);
      await settle();
      expect(session.placements()).toHaveLength(0);
    });
  });
});
