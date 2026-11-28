import type { SignatureField } from 'signora-pdf';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  degrees,
  type PDFRef,
} from 'pdf-lib';
import { inspectPdfSignatures } from '../../validation/src/inspect-signatures';
import { buildSignatureFixture } from '../../validation/src/signature-fixtures.testing';
import {
  TEST_ROOT_CA_PEM,
  twoSignaturesPdf,
  validRsaPdf,
} from '../../validation/src/signed-fixtures.testing';
import { validatePdfSignatures } from '../../validation/src/validate-signatures';
import { readSignatureFields } from './form-fields';
import { ChangesNotPermittedError } from './incremental-update';
import {
  SignatureFieldNameError,
  addSignatureFields,
  signatureFieldName,
} from './signature-fields-writer';
import { checkXrefChain } from './xref-check.testing';

const field = (id: string, extra: Partial<SignatureField> = {}): SignatureField => ({
  id,
  pageIndex: 0,
  rect: { x: 0.1, y: 0.7, width: 0.3, height: 0.08 },
  ...extra,
});

const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

async function blank(options: { pages?: number; objectStreams?: boolean } = {}) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < (options.pages ?? 1); i++) doc.addPage([400, 600]);
  return { doc, save: () => doc.save({ useObjectStreams: options.objectStreams ?? false }) };
}

describe('readSignatureFields', () => {
  it('reads empty, visible signature fields as SignatureFields', async () => {
    const { pdf } = await buildSignatureFixture([
      {
        name: 'Client',
        empty: true,
        rect: [100, 600, 300, 700],
        required: true,
        alternateName: 'Client signature',
      },
      { name: 'Provider', empty: true, rect: [100, 100, 300, 150] },
    ]);
    const fields = await readSignatureFields(pdf);

    expect(fields.map((f) => f.id)).toEqual(['Client', 'Provider']);
    expect(fields[0]).toMatchObject({
      pdfName: 'Client',
      inDocument: true,
      pageIndex: 0,
      required: true,
      label: 'Client signature',
    });
    expect(fields[0].rect.x).toBeCloseTo(100 / 595, 5);
    expect(fields[0].rect.y).toBeCloseTo((842 - 700) / 842, 5);
    expect(fields[0].rect.width).toBeCloseTo(200 / 595, 5);
    expect(fields[0].rect.height).toBeCloseTo(100 / 842, 5);
    expect(fields[1]).toMatchObject({ required: false, label: 'Provider' });
  });

  it('leaves out signed fields and invisible ones', async () => {
    const { pdf } = await buildSignatureFixture([
      { name: 'Open', empty: true },
      { name: 'Hidden', empty: true, rect: [0, 0, 0, 0] },
      { name: 'Done' },
    ]);
    expect((await readSignatureFields(pdf)).map((f) => f.id)).toEqual(['Open']);
    expect(await readSignatureFields(validRsaPdf())).toEqual([]);
  });

  it('returns nothing for a PDF without a form', async () => {
    const { save } = await blank();
    expect(await readSignatureFields(await save())).toEqual([]);
  });

  it('follows the field hierarchy: dotted names and widgets held in /Kids', async () => {
    const { doc, save } = await blank({ pages: 2 });
    const { context } = doc;
    const widget = (page: number, rect: number[]) =>
      context.register(
        context.obj({
          Type: 'Annot',
          Subtype: 'Widget',
          Rect: rect,
          P: doc.getPage(page).ref,
        }),
      );
    // Parent without a type, holding a typed field whose widget is a separate annotation.
    const parent = context.nextRef();
    const field = context.nextRef();
    const kid = widget(1, [50, 50, 150, 100]);
    context.assign(
      field,
      context.obj({ FT: 'Sig', T: PDFString.of('Sign'), Parent: parent, Kids: [kid] }),
    );
    context.assign(parent, context.obj({ T: PDFString.of('Contract'), Kids: [field] }));
    doc.getPage(1).node.set(PDFName.of('Annots'), context.obj([kid]));
    doc.catalog.set(PDFName.of('AcroForm'), context.obj({ Fields: [parent] }));

    const [found] = await readSignatureFields(await save());
    expect(found).toMatchObject({ id: 'Contract.Sign', pageIndex: 1 });
    expect(found.rect.x).toBeCloseTo(50 / 400, 5);
    expect(found.rect.width).toBeCloseTo(100 / 400, 5);
  });
});

describe('addSignatureFields', () => {
  describe('creating fields', () => {
    it('adds a form to a PDF that has none, keeping every original byte', async () => {
      const { save } = await blank();
      const original = await save();
      const output = await addSignatureFields(original, [
        field('client', { label: 'Client', required: true }),
        field('provider', {
          label: 'Provider',
          rect: { x: 0.5, y: 0.7, width: 0.3, height: 0.08 },
        }),
      ]);

      expect(same(output.subarray(0, original.length), original)).toBe(true);
      expect(checkXrefChain(output).kinds).toEqual(['table', 'table']);
      const fields = await readSignatureFields(output);
      expect(fields.map((f) => [f.pdfName, f.required, f.label])).toEqual([
        ['Client', true, 'Client'],
        ['Provider', false, 'Provider'],
      ]);
      // They are real, empty signature fields for any other reader of the file too.
      expect((await inspectPdfSignatures(output)).map((s) => [s.fieldName, s.signed])).toEqual([
        ['Client', false],
        ['Provider', false],
      ]);
    });

    it.each([0, 90, 180, 270])(
      'puts the field where it was placed on a page rotated %i degrees',
      async (angle) => {
        const { doc, save } = await blank();
        doc.getPage(0).setRotation(degrees(angle));
        const placed = field('f', { rect: { x: 0.2, y: 0.3, width: 0.4, height: 0.2 } });
        const output = await addSignatureFields(await save(), [placed]);
        const [read] = await readSignatureFields(output);
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expect(read.rect[key]).toBeCloseTo(placed.rect[key], 5);
        }
      },
    );

    it('writes the field as a printable /Sig widget, with the label as its alternate name', async () => {
      const { save } = await blank();
      const output = await addSignatureFields(await save(), [
        field('f', { pdfName: 'sig_1', label: 'Sign here', required: true }),
      ]);
      const doc = await PDFDocument.load(output);
      const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
      const widget = annots.lookup(0, PDFDict);
      expect(widget.lookup(PDFName.of('FT'), PDFName).decodeText()).toBe('Sig');
      expect(widget.lookup(PDFName.of('Subtype'), PDFName).decodeText()).toBe('Widget');
      expect(String(widget.lookup(PDFName.of('F')))).toBe('4');
      expect(String(widget.lookup(PDFName.of('Ff')))).toBe('2');
      expect(widget.lookup(PDFName.of('TU'), PDFString).decodeText()).toBe('Sign here');
      const form = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
      expect(form.lookup(PDFName.of('Fields'), PDFArray).size()).toBe(1);
    });

    it('supports fields on several pages and non-ASCII names', async () => {
      const { save } = await blank({ pages: 2 });
      const output = await addSignatureFields(await save(), [
        field('a', { pageIndex: 1, pdfName: 'Firma cliente ñ' }),
        field('b', { pageIndex: 0 }),
      ]);
      const fields = await readSignatureFields(output);
      expect(fields.map((f) => [f.pdfName, f.pageIndex])).toEqual([
        ['Firma cliente ñ', 1],
        ['b', 0],
      ]);
    });

    it('returns an identical copy when every field is already in the document', async () => {
      const { save } = await blank();
      const original = await save();
      const output = await addSignatureFields(original, [field('x', { inDocument: true })]);
      expect(same(output, original)).toBe(true);
      expect(output).not.toBe(original);
    });

    it('skips fields that came from the document and creates the rest', async () => {
      const { save } = await blank();
      const output = await addSignatureFields(await save(), [
        field('old', { inDocument: true, pdfName: 'Old' }),
        field('new'),
      ]);
      expect((await readSignatureFields(output)).map((f) => f.id)).toEqual(['new']);
    });

    it('can write an xref stream and chain updates, and read back what an earlier update added', async () => {
      const { save } = await blank();
      const first = await addSignatureFields(await save(), [field('one')], {
        xrefFormat: 'stream',
      });
      const second = await addSignatureFields(first, [field('two')]);
      expect(checkXrefChain(second).kinds).toEqual(['stream', 'stream', 'table']);
      expect((await readSignatureFields(second)).map((f) => f.id)).toEqual(['one', 'two']);
    });
  });

  describe('existing forms', () => {
    it('appends to a direct AcroForm and keeps its other fields', async () => {
      const { doc, save } = await blank();
      const { context } = doc;
      const textField = context.register(
        context.obj({
          FT: 'Tx',
          T: PDFString.of('Name'),
          Subtype: 'Widget',
          Type: 'Annot',
          Rect: [10, 10, 100, 30],
          P: doc.getPage(0).ref,
        }),
      );
      doc.getPage(0).node.set(PDFName.of('Annots'), context.obj([textField]));
      doc.catalog.set(
        PDFName.of('AcroForm'),
        context.obj({ Fields: [textField], NeedAppearances: true }),
      );
      const output = await addSignatureFields(await save(), [field('sig')]);

      const form = (await PDFDocument.load(output)).catalog.lookup(PDFName.of('AcroForm'), PDFDict);
      expect(form.lookup(PDFName.of('Fields'), PDFArray).size()).toBe(2);
      expect(String(form.lookup(PDFName.of('NeedAppearances')))).toBe('true');
      expect((await readSignatureFields(output)).map((f) => f.id)).toEqual(['sig']);
    });

    it('rewrites only the AcroForm when it is indirect, and only the array when /Fields is', async () => {
      const { doc, save } = await blank();
      const { context } = doc;
      const fieldsRef = context.register(context.obj([]));
      const formRef = context.register(
        context.obj({ Fields: fieldsRef, DA: PDFString.of('/Helv 0 Tf') }),
      );
      doc.catalog.set(PDFName.of('AcroForm'), formRef);
      const original = await save();
      const catalogRef = (await PDFDocument.load(original)).context.trailerInfo.Root;

      const output = await addSignatureFields(original, [field('sig')]);
      const written = [...text(output.subarray(original.length)).matchAll(/(\d+) \d+ obj\b/g)].map(
        (m) => Number(m[1]),
      );
      expect(written).toContain(fieldsRef.objectNumber);
      expect(written).not.toContain(formRef.objectNumber); // untouched
      expect(written).not.toContain((catalogRef as PDFRef).objectNumber); // untouched
      expect((await readSignatureFields(output)).map((f) => f.id)).toEqual(['sig']);
    });

    it('rejects a name already used by any field of the form, but not a free one', async () => {
      const { pdf } = await buildSignatureFixture([{ name: 'Taken', empty: true }]);
      await expect(
        addSignatureFields(pdf, [field('x', { pdfName: 'Taken' })]),
      ).rejects.toBeInstanceOf(SignatureFieldNameError);
      const output = await addSignatureFields(pdf, [field('x', { pdfName: 'Free' })]);
      expect((await readSignatureFields(output)).map((f) => f.id)).toEqual(['Taken', 'Free']);
    });
  });

  describe('documents that are already signed', () => {
    it('keeps the signatures valid and lists the new fields as empty', async () => {
      const original = twoSignaturesPdf();
      const output = await addSignatureFields(original, [field('third', { label: 'Third' })]);

      expect(same(output.subarray(0, original.length), original)).toBe(true);
      const report = await validatePdfSignatures(output, { trustAnchors: [TEST_ROOT_CA_PEM] });
      expect(report.status).toBe('valid');
      expect(report.results).toHaveLength(2);
      expect(report.unsignedFields).toEqual(['Third']);
      expect((await readSignatureFields(output)).map((f) => f.id)).toEqual(['Third']);
    });

    it('refuses a name that a signed field already has', async () => {
      await expect(
        addSignatureFields(validRsaPdf(), [field('x', { pdfName: 'Signature1' })]),
      ).rejects.toBeInstanceOf(SignatureFieldNameError);
    });

    it.each([1, 2] as const)('refuses form changes under DocMDP level %i', async (level) => {
      const { pdf } = await buildSignatureFixture([{ name: 'Cert', docMdp: level }]);
      await expect(addSignatureFields(pdf, [field('x')])).rejects.toBeInstanceOf(
        ChangesNotPermittedError,
      );
      expect(
        (await addSignatureFields(pdf, [field('x')], { ignoreDocMdp: true })).length,
      ).toBeGreaterThan(pdf.length);
    });

    it('allows form changes under DocMDP level 3', async () => {
      const { pdf } = await buildSignatureFixture([{ name: 'Cert', docMdp: 3 }]);
      expect((await readSignatureFields(await addSignatureFields(pdf, [field('x')]))).length).toBe(
        1,
      );
    });
  });

  describe('names and errors', () => {
    it('derives the name from the label, then the id, replacing dots', () => {
      expect(signatureFieldName(field('id'))).toBe('id');
      expect(signatureFieldName(field('id', { label: 'Client  signature' }))).toBe(
        'Client signature',
      );
      expect(signatureFieldName(field('id', { label: 'Sr. Pérez' }))).toBe('Sr_ Pérez');
      expect(signatureFieldName(field('id', { label: '   ' }))).toBe('id');
      expect(signatureFieldName(field('id', { pdfName: 'Explicit.Name' }))).toBe('Explicit.Name');
    });

    it('rejects empty names, dots in an explicit name and duplicates in the same batch', async () => {
      const { save } = await blank();
      const original = await save();
      await expect(
        addSignatureFields(original, [field('a', { pdfName: '' })]),
      ).rejects.toBeInstanceOf(SignatureFieldNameError);
      await expect(addSignatureFields(original, [field('a', { pdfName: 'A.B' })])).rejects.toThrow(
        /contains a dot/,
      );
      await expect(
        addSignatureFields(original, [
          field('a', { label: 'Same' }),
          field('b', { label: 'Same' }),
        ]),
      ).rejects.toThrow(/already used/);
    });

    it('fails on a missing page before writing anything', async () => {
      const { save } = await blank();
      await expect(
        addSignatureFields(await save(), [field('a', { pageIndex: 3 })]),
      ).rejects.toBeInstanceOf(RangeError);
    });
  });
});

describe('PDF text strings', () => {
  it('uses a hex text string only when the name is not plain ASCII', async () => {
    const { save } = await blank();
    const output = await addSignatureFields(await save(), [
      field('a', { pdfName: 'Plain' }),
      field('b', { pdfName: 'Ñandú' }),
    ]);
    const update = text(output);
    expect(update).toContain('/T (Plain)');
    expect(update).not.toContain('/T (Ñandú)');
    const doc = await PDFDocument.load(output);
    const widget = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(1, PDFDict);
    expect(widget.lookup(PDFName.of('T'), PDFHexString).decodeText()).toBe('Ñandú');
  });
});
