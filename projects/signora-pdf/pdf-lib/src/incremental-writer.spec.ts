import { TestBed } from '@angular/core/testing';
import {
  SIGNORA_WRITER,
  provideSignora,
  toPdfUserSpace,
  type PlacedSignature,
  type SignatureAsset,
} from 'signora-pdf';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFStream,
  degrees,
  type PDFRawStream,
} from 'pdf-lib';
import { inspectPdfSignatures } from '../../validation/src/inspect-signatures';
import { buildSignatureFixture } from '../../validation/src/signature-fixtures.testing';
import {
  TEST_ROOT_CA_PEM,
  TEST_TSA_ROOT_CA_PEM,
  documentTimestampPdf,
  signatureTimestampPdf,
  twoSignaturesPdf,
  validEcPdf,
  validRsaPdf,
} from '../../validation/src/signed-fixtures.testing';
import { validatePdfSignatures } from '../../validation/src/validate-signatures';
import {
  ChangesNotPermittedError,
  EncryptedPdfError,
  IncrementalUpdate,
  IncrementalUpdateError,
} from './incremental-update';
import { appendVisualSignatures } from './incremental-writer';
import {
  PdfAlreadySignedError,
  UnsupportedSignatureImageError,
  withPdfLibWriter,
} from './pdf-lib-writer';
import { computeImageDrawing } from './placement-transform';
import { pageInfo } from './page-info';
import { checkXrefChain } from './xref-check.testing';

// 1x1 red PNG.
const RED_PNG =
  'data:image/png;base64,iVBORw0KGgAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8Dwn4EIAAA/AQMBXY4aLQAAAABJRU5ErkJggg=='.replace(
    'iVBORw0KGgAAAANS',
    'iVBORw0KGgoAAAANS',
  );

const asset: SignatureAsset = { id: 'red', kind: 'image', dataUrl: RED_PNG, aspectRatio: 1 };
const placement = (
  pageIndex: number,
  id = 'p',
  rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
): PlacedSignature => ({ id, asset, pageIndex, rect });

const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

async function createPdf(objectStreams: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([792, 612]).setRotation(degrees(90));
  return doc.save({ useObjectStreams: objectStreams });
}

/** The annotations of a page in `pdf`, read back with pdf-lib. */
async function annotationsOf(pdf: Uint8Array, pageIndex: number): Promise<PDFDict[]> {
  const doc = await PDFDocument.load(pdf);
  const annots = doc.getPage(pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  return Array.from({ length: annots?.size() ?? 0 }, (_, i) => annots!.lookup(i, PDFDict));
}

/** The appearance stream (`/AP /N`) of an annotation. */
const appearanceOf = (stamp: PDFDict): PDFRawStream =>
  stamp.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFStream) as PDFRawStream;

const numbers = (dict: PDFDict, key: string): number[] => {
  const array = dict.lookup(PDFName.of(key), PDFArray);
  return Array.from({ length: array.size() }, (_, i) => array.lookup(i, PDFNumber).asNumber());
};

/** Object numbers written by the update (everything after the original bytes). */
const writtenObjects = (output: Uint8Array, originalLength: number): number[] =>
  [...text(output.subarray(originalLength)).matchAll(/(\d+) \d+ obj\b/g)].map((m) => Number(m[1]));

describe('appendVisualSignatures', () => {
  describe('structure', () => {
    it('keeps every original byte and adds a valid xref table (unsigned document)', async () => {
      const original = await createPdf(false);
      const output = await appendVisualSignatures(original, [placement(0)]);

      expect(same(output.subarray(0, original.length), original)).toBe(true);
      const report = checkXrefChain(output);
      expect(report.kinds).toEqual(['table', 'table']);
      expect(output.length).toBeGreaterThan(original.length);
      expect(text(output.subarray(original.length))).toContain(
        `/Prev ${/startxref\s+(\d+)/.exec(text(original))![1]}`,
      );
    });

    it('writes an xref stream when the document ended with one', async () => {
      const original = await createPdf(true);
      expect((await IncrementalUpdate.load(original)).previousXrefKind).toBe('stream');

      const output = await appendVisualSignatures(original, [placement(0), placement(1, 'q')]);
      const report = checkXrefChain(output);
      expect(report.kinds[0]).toBe('stream');
      expect(same(output.subarray(0, original.length), original)).toBe(true);
      expect(await annotationsOf(output, 0)).toHaveLength(1);
      expect(await annotationsOf(output, 1)).toHaveLength(1);
    });

    it('can force the other kind of xref section and chain several updates', async () => {
      const original = await createPdf(false);
      const first = await appendVisualSignatures(original, [placement(0)], {
        xrefFormat: 'stream',
      });
      expect(checkXrefChain(first).kinds).toEqual(['stream', 'table']);

      // The next update detects the stream and keeps going.
      const second = await appendVisualSignatures(first, [placement(0, 'second')]);
      const report = checkXrefChain(second);
      expect(report.kinds).toEqual(['stream', 'stream', 'table']);
      expect(same(second.subarray(0, first.length), first)).toBe(true);
      expect(await annotationsOf(second, 0)).toHaveLength(2);

      const third = await appendVisualSignatures(second, [placement(1)], { xrefFormat: 'table' });
      expect(checkXrefChain(third).kinds).toEqual(['table', 'stream', 'stream', 'table']);
    });

    it('does not reuse object numbers: new objects start after /Size', async () => {
      const original = await createPdf(false);
      const size = Number(/\/Size\s+(\d+)/.exec(text(original))![1]);
      const output = await appendVisualSignatures(original, [placement(0)]);
      const fresh = writtenObjects(output, original.length).filter(
        (n) => n !== (/\/Root\s+(\d+)/.exec(text(original))![1] as unknown),
      );
      expect(fresh.some((n) => n >= size)).toBe(true);
      const newSize = Number(/\/Size\s+(\d+)/.exec(text(output.subarray(original.length)))![1]);
      expect(newSize).toBeGreaterThan(Math.max(...fresh));
    });

    it('reuses one image object for the same asset and leaves other pages untouched', async () => {
      const original = await createPdf(false);
      const output = await appendVisualSignatures(original, [
        placement(0, 'a'),
        placement(0, 'b', { x: 0.5, y: 0.5, width: 0.2, height: 0.1 }),
      ]);
      const update = text(output.subarray(original.length));
      expect(update.match(/\/Subtype \/Image/g)).toHaveLength(1);
      expect(update.match(/\/Subtype \/Stamp/g)).toHaveLength(2);
      expect(await annotationsOf(output, 0)).toHaveLength(2);
      expect(await annotationsOf(output, 1)).toHaveLength(0);
    });

    it('starts the update on a new line when the file does not end with one', async () => {
      const original = await createPdf(false); // pdf-lib ends the file with "%%EOF" and no newline
      expect(text(original.subarray(original.length - 5))).toBe('%%EOF');
      const output = await appendVisualSignatures(original, [placement(0)]);
      expect(output[original.length]).toBe(0x0a);
      expect(checkXrefChain(output).kinds).toHaveLength(2);
    });
  });

  describe('annotations', () => {
    it('writes a stamp with an appearance stream at the placed rectangle', async () => {
      const original = await createPdf(false);
      const output = await appendVisualSignatures(original, [placement(0)]);
      const [stamp] = await annotationsOf(output, 0);

      expect(stamp.lookup(PDFName.of('Subtype'), PDFName).decodeText()).toBe('Stamp');
      expect(stamp.lookup(PDFName.of('F'), PDFNumber).asNumber()).toBe(132);
      const doc = await PDFDocument.load(output);
      const box = toPdfUserSpace(placement(0).rect, pageInfo(doc.getPage(0), 0));
      const rect = numbers(stamp, 'Rect');
      expect(rect[0]).toBeCloseTo(box.x, 3);
      expect(rect[1]).toBeCloseTo(box.y, 3);
      expect(rect[2]).toBeCloseTo(box.x + box.width, 3);
      expect(rect[3]).toBeCloseTo(box.y + box.height, 3);

      const appearance = appearanceOf(stamp);
      expect(numbers(appearance.dict, 'BBox')).toEqual(rect);
      expect(text(appearance.contents)).toMatch(/^q [\d. -]+ cm \/Im0 Do Q$/);
    });

    it.each([0, 90, 180, 270] as const)(
      'draws the image exactly where the rewrite mode draws it on a page rotated %i degrees',
      async (rotation) => {
        const doc = await PDFDocument.create();
        doc.addPage([400, 600]).setRotation(degrees(rotation));
        const original = await doc.save({ useObjectStreams: false });
        const p = placement(0, 'p', { x: 0.2, y: 0.3, width: 0.4, height: 0.2 });

        const output = await appendVisualSignatures(original, [p]);
        const [stamp] = await annotationsOf(output, 0);
        const content = text(appearanceOf(stamp).contents);
        const [a, b, c, d, e, f] = /^q (.+) cm/.exec(content)![1].split(' ').map(Number);

        const info = pageInfo((await PDFDocument.load(original)).getPage(0), 0);
        const drawing = computeImageDrawing(p.rect, info);
        const angle = (drawing.rotate * Math.PI) / 180;
        expect(a).toBeCloseTo(drawing.width * Math.round(Math.cos(angle)), 4);
        expect(b).toBeCloseTo(drawing.width * Math.round(Math.sin(angle)), 4);
        expect(c).toBeCloseTo(-drawing.height * Math.round(Math.sin(angle)), 4);
        expect(d).toBeCloseTo(drawing.height * Math.round(Math.cos(angle)), 4);
        expect([e, f]).toEqual([drawing.x, drawing.y]);

        // The whole drawn image lies inside the annotation rectangle.
        const rect = numbers(stamp, 'Rect');
        for (const [x, y] of [
          [e, f],
          [e + a, f + b],
          [e + c, f + d],
          [e + a + c, f + b + d],
        ]) {
          expect(x).toBeGreaterThanOrEqual(rect[0] - 1e-3);
          expect(x).toBeLessThanOrEqual(rect[2] + 1e-3);
          expect(y).toBeGreaterThanOrEqual(rect[1] - 1e-3);
          expect(y).toBeLessThanOrEqual(rect[3] + 1e-3);
        }
      },
    );

    it('keeps existing annotations and only rewrites the page when /Annots is direct', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([595, 842]);
      const link = doc.context.register(
        doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10] }),
      );
      page.node.set(PDFName.of('Annots'), doc.context.obj([link]));
      const original = await doc.save({ useObjectStreams: false });

      const output = await appendVisualSignatures(original, [placement(0)]);
      const annots = await annotationsOf(output, 0);
      expect(annots.map((a) => a.lookup(PDFName.of('Subtype'), PDFName).decodeText())).toEqual([
        'Link',
        'Stamp',
      ]);
      expect(writtenObjects(output, original.length)).toContain(
        (await PDFDocument.load(original)).getPage(0).ref.objectNumber,
      );
    });

    it('rewrites only the array, not the page, when /Annots is an indirect array', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([595, 842]);
      const arrayRef = doc.context.register(doc.context.obj([]));
      page.node.set(PDFName.of('Annots'), arrayRef);
      const original = await doc.save({ useObjectStreams: false });

      const output = await appendVisualSignatures(original, [placement(0)]);
      const written = writtenObjects(output, original.length);
      expect(written).toContain(arrayRef.objectNumber);
      expect(written).not.toContain((await PDFDocument.load(original)).getPage(0).ref.objectNumber);
      expect(await annotationsOf(output, 0)).toHaveLength(1);
    });
  });

  describe('existing digital signatures', () => {
    const anchors = [TEST_ROOT_CA_PEM, TEST_TSA_ROOT_CA_PEM];

    it.each([
      ['RSA PAdES', validRsaPdf],
      ['ECDSA', validEcPdf],
      ['signature timestamp', signatureTimestampPdf],
    ])('keeps a %s signature valid', async (_name, fixture) => {
      const original = fixture();
      const before = await validatePdfSignatures(original, { trustAnchors: anchors });
      const output = await appendVisualSignatures(original, [placement(0)]);

      expect(same(output.subarray(0, original.length), original)).toBe(true);
      expect(checkXrefChain(output).kinds[0]).toBe('table');
      const after = await validatePdfSignatures(output, { trustAnchors: anchors });
      expect(before.status).toBe('valid');
      expect(after.status).toBe('valid');
      expect(after.results.map((r) => r.status)).toEqual(before.results.map((r) => r.status));
      expect(after.results[0].warnings.map((w) => w.code)).toContain('REVISIONS_AFTER_SIGNATURE');
      expect((await inspectPdfSignatures(output))[0].coversWholeDocument).toBe(false);
    });

    it('keeps several signatures and a document timestamp valid', async () => {
      for (const fixture of [twoSignaturesPdf, documentTimestampPdf]) {
        const output = await appendVisualSignatures(fixture(), [placement(0)]);
        const report = await validatePdfSignatures(output, { trustAnchors: anchors });
        expect(report.status).toBe('valid');
        expect(report.results.length).toBe(2);
        expect(report.results.every((r) => r.status === 'valid')).toBe(true);
      }
    });

    it('keeps signatures valid across several updates and either xref kind', async () => {
      let output = validRsaPdf();
      for (const format of ['stream', 'table', 'stream'] as const) {
        output = await appendVisualSignatures(output, [placement(0, format)], {
          xrefFormat: format,
        });
      }
      expect(checkXrefChain(output).kinds).toEqual(['stream', 'table', 'stream', 'table']);
      const report = await validatePdfSignatures(output, { trustAnchors: anchors });
      expect(report.status).toBe('valid');
      expect(await annotationsOf(output, 0)).toHaveLength(4); // the signature widget + 3 stamps
    });

    it('a changed byte in the original part is still detected after the update', async () => {
      const tampered = validRsaPdf().slice();
      tampered[10] ^= 0xff;
      const output = await appendVisualSignatures(tampered, [placement(0)]);
      const [result] = (await validatePdfSignatures(output)).results;
      expect(result.status).toBe('invalid');
    });
  });

  describe('certified documents (DocMDP)', () => {
    it.each([1, 2] as const)('refuses permission level %i', async (level) => {
      const { pdf } = await buildSignatureFixture([{ name: 'Cert', docMdp: level }]);
      const error = await appendVisualSignatures(pdf, [placement(0)]).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ChangesNotPermittedError);
      expect((error as ChangesNotPermittedError).permission).toBe(level);
    });

    it('allows level 3 (annotations permitted)', async () => {
      const { pdf } = await buildSignatureFixture([{ name: 'Cert', docMdp: 3 }]);
      const output = await appendVisualSignatures(pdf, [placement(0)]);
      expect(checkXrefChain(output).kinds).toHaveLength(2);
    });

    it('can be forced with ignoreDocMdp', async () => {
      const { pdf } = await buildSignatureFixture([{ name: 'Cert', docMdp: 1 }]);
      const output = await appendVisualSignatures(pdf, [placement(0)], { ignoreDocMdp: true });
      expect(output.length).toBeGreaterThan(pdf.length);
    });
  });

  describe('errors', () => {
    it('refuses an encrypted document', async () => {
      const body = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n';
      const xref = body.length;
      const file =
        body +
        `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      await expect(
        appendVisualSignatures(
          Uint8Array.from(file, (c) => c.charCodeAt(0)),
          [placement(0)],
        ),
      ).rejects.toBeInstanceOf(EncryptedPdfError);
    });

    it('rejects bytes without a cross-reference section', async () => {
      const junk = Uint8Array.from('%PDF-1.7\nnot really a pdf\n', (c) => c.charCodeAt(0));
      await expect(appendVisualSignatures(junk, [placement(0)])).rejects.toBeInstanceOf(
        IncrementalUpdateError,
      );
    });

    it('fails on a missing page or an unsupported image before writing anything', async () => {
      const original = await createPdf(false);
      await expect(appendVisualSignatures(original, [placement(5)])).rejects.toBeInstanceOf(
        RangeError,
      );
      const bad = { ...placement(0), asset: { ...asset, dataUrl: 'data:image/gif;base64,AAAA' } };
      await expect(appendVisualSignatures(original, [bad])).rejects.toBeInstanceOf(
        UnsupportedSignatureImageError,
      );
    });

    it('finds startxref even with more than 2 KB of trailing bytes after %%EOF', async () => {
      const original = await createPdf(false);
      const padded = new Uint8Array(original.length + 4096);
      padded.set(original);
      padded.fill(0x20, original.length); // spaces, as some producers leave behind
      const output = await appendVisualSignatures(padded, [placement(0)]);
      expect(same(output.subarray(0, padded.length), padded)).toBe(true);
      expect((await annotationsOf(output, 0)).length).toBe(1);
    });

    it('returns an identical copy when there is nothing to add', async () => {
      const original = validRsaPdf();
      const output = await appendVisualSignatures(original, []);
      expect(same(output, original)).toBe(true);
      expect(output).not.toBe(original);
    });
  });
});

describe('PdfLibDocumentWriter modes', () => {
  const writer = (mode?: 'rewrite' | 'incremental' | 'auto') => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideSignora(withPdfLibWriter(mode ? { mode } : {}))],
    });
    return TestBed.inject(SIGNORA_WRITER);
  };

  it('still refuses a signed PDF by default (unchanged behaviour)', async () => {
    await expect(
      writer().applyVisualSignatures(validRsaPdf(), [placement(0)]),
    ).rejects.toBeInstanceOf(PdfAlreadySignedError);
  });

  it("'incremental' signs a signed PDF without invalidating it", async () => {
    const original = validRsaPdf();
    const output = await writer('incremental').applyVisualSignatures(original, [placement(0)]);
    expect(same(output.subarray(0, original.length), original)).toBe(true);
    expect((await validatePdfSignatures(output)).status).toBe('valid');
  });

  it("'auto' appends to a signed PDF but rewrites an unsigned one", async () => {
    const signed = validRsaPdf();
    const appended = await writer('auto').applyVisualSignatures(signed, [placement(0)]);
    expect(same(appended.subarray(0, signed.length), signed)).toBe(true);

    const unsigned = await createPdf(false);
    const rewritten = await writer('auto').applyVisualSignatures(unsigned, [placement(0)]);
    expect(same(rewritten.subarray(0, unsigned.length), unsigned)).toBe(false);
    expect(await annotationsOf(rewritten, 0)).toHaveLength(0); // drawn on the page instead
  });

  it("'incremental' on an unsigned PDF adds an annotation", async () => {
    const unsigned = await createPdf(true);
    const output = await writer('incremental').applyVisualSignatures(unsigned, [placement(1)]);
    expect(await annotationsOf(output, 1)).toHaveLength(1);
  });
});
