import { PDFDocument, degrees } from 'pdf-lib';
import { PdfInspectionError, inspectPdfSignatures, parsePdfDate } from './inspect-signatures';
import { buildSignatureFixture } from './signature-fixtures.testing';

describe('inspectPdfSignatures', () => {
  it('returns nothing for a PDF without a form', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(await inspectPdfSignatures(await doc.save())).toEqual([]);
  });

  it('reads the declared data of a signature', async () => {
    const { pdf } = await buildSignatureFixture([
      {
        name: 'Client',
        reason: 'I approve',
        signerName: 'Ada Lovelace',
        rect: [100, 600, 300, 700],
      },
    ]);
    const [sig] = await inspectPdfSignatures(pdf);

    expect(sig).toMatchObject({
      index: 0,
      fieldName: 'Client',
      kind: 'signature',
      signed: true,
      filter: 'Adobe.PPKLite',
      subFilter: 'ETSI.CAdES.detached',
      reason: 'I approve',
      signerName: 'Ada Lovelace',
      pageIndex: 0,
      byteRangeWellFormed: true,
      coversWholeDocument: true,
      revision: 1,
    });
    expect(sig.signingTime?.toISOString()).toBe('2026-01-15T09:30:00.000Z');
    // x 100/595, top = (842-700)/842, width 200/595, height 100/842
    expect(sig.rect?.x).toBeCloseTo(100 / 595, 5);
    expect(sig.rect?.y).toBeCloseTo(142 / 842, 5);
    expect(sig.rect?.width).toBeCloseTo(200 / 595, 5);
    expect(sig.rect?.height).toBeCloseTo(100 / 842, 5);
  });

  it('trims the zero padding of /Contents to the DER object', async () => {
    const der = new Uint8Array([0x30, 0x04, 1, 2, 3, 4]);
    const { pdf } = await buildSignatureFixture([{ name: 'A', contents: der }]);
    const [sig] = await inspectPdfSignatures(pdf);
    expect(Array.from(sig.contents!)).toEqual(Array.from(der));
  });

  it('lists empty signature fields and can omit them', async () => {
    const { pdf } = await buildSignatureFixture([
      { name: 'Pending', empty: true },
      { name: 'Done' },
    ]);
    const all = await inspectPdfSignatures(pdf);
    expect(all.map((s) => [s.fieldName, s.signed])).toEqual([
      ['Done', true],
      ['Pending', false],
    ]);
    expect(all[1].rect).toBeDefined();
    expect(all[1].byteRange).toBeUndefined();

    const signedOnly = await inspectPdfSignatures(pdf, { includeUnsigned: false });
    expect(signedOnly.map((s) => s.fieldName)).toEqual(['Done']);
  });

  it('orders signatures by revision and flags the ones that do not cover the whole file', async () => {
    const first = await buildSignatureFixture([
      { name: 'Second' },
      { name: 'First', signedUntil: 1500 },
    ]);
    const sigs = await inspectPdfSignatures(first.pdf);
    expect(sigs.map((s) => s.fieldName)).toEqual(['First', 'Second']);
    expect(sigs[0].coversWholeDocument).toBe(false);
    expect(sigs[1].coversWholeDocument).toBe(true);
  });

  it('reports bytes appended after the signature', async () => {
    const { pdf } = await buildSignatureFixture([{ name: 'A' }]);
    const tampered = new Uint8Array(pdf.length + 12);
    tampered.set(pdf);
    tampered.set(new TextEncoder().encode('\n%%EOF extra'), pdf.length);
    const [sig] = await inspectPdfSignatures(tampered);
    expect(sig.coversWholeDocument).toBe(false);
  });

  it('identifies document timestamps', async () => {
    const { pdf } = await buildSignatureFixture([{ name: 'TS', timestamp: true }]);
    const [sig] = await inspectPdfSignatures(pdf);
    expect(sig.kind).toBe('document-timestamp');
    expect(sig.subFilter).toBe('ETSI.RFC3161');
  });

  it('maps the widget to the right page, also with a rotated page', async () => {
    const { pdf } = await buildSignatureFixture(
      [{ name: 'P2', pageIndex: 1, rect: [0, 0, 100, 50] }],
      [
        [595, 842],
        [600, 400],
      ],
    );
    const doc = await PDFDocument.load(pdf);
    doc.getPage(1).setRotation(degrees(90));
    // Rotating through pdf-lib rewrites the file and so the byte range; only the geometry matters here.
    const [sig] = await inspectPdfSignatures(await doc.save());
    expect(sig.pageIndex).toBe(1);
    // Bottom-left corner of an unrotated page is the top-left of a page rotated 90 degrees clockwise.
    expect(sig.rect?.x).toBeCloseTo(0, 5);
    expect(sig.rect?.y).toBeCloseTo(0, 5);
    expect(sig.rect?.width).toBeCloseTo(50 / 400, 5);
    expect(sig.rect?.height).toBeCloseTo(100 / 600, 5);
  });

  it('marks an inconsistent /ByteRange as not well formed', async () => {
    const { pdf } = await buildSignatureFixture([{ name: 'A' }]);
    // The first range must start at 0; claim it starts at 5 (same width, so offsets do not move).
    const latin1 = Array.from(pdf, (c) => String.fromCharCode(c)).join('');
    const forged = Uint8Array.from(latin1.replace('[ 0000000000 ', '[ 0000000005 '), (c) =>
      c.charCodeAt(0),
    );
    const [sig] = await inspectPdfSignatures(forged);
    expect(sig.byteRangeWellFormed).toBe(false);
  });

  it('rejects bytes that are not a PDF', async () => {
    await expect(inspectPdfSignatures(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
      PdfInspectionError,
    );
  });

  it('rejects a corrupt PDF with a typed error', async () => {
    const garbage = new TextEncoder().encode('%PDF-1.7\nthis is not a pdf');
    await expect(inspectPdfSignatures(garbage)).rejects.toBeInstanceOf(PdfInspectionError);
  });
});

describe('parsePdfDate', () => {
  it('handles offsets, UTC and partial dates', () => {
    expect(parsePdfDate("D:20260115103000+01'00'")?.toISOString()).toBe('2026-01-15T09:30:00.000Z');
    expect(parsePdfDate("D:20260115103000-05'30'")?.toISOString()).toBe('2026-01-15T16:00:00.000Z');
    expect(parsePdfDate('D:20260115103000Z')?.toISOString()).toBe('2026-01-15T10:30:00.000Z');
    expect(parsePdfDate('D:2026')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns undefined for junk', () => {
    expect(parsePdfDate('yesterday')).toBeUndefined();
    expect(parsePdfDate(undefined)).toBeUndefined();
  });

  it('rejects out-of-range fields instead of rolling them over', () => {
    expect(parsePdfDate('D:20261301')).toBeUndefined(); // month 13
    expect(parsePdfDate('D:20260231')).toBeUndefined(); // 31 February
    expect(parsePdfDate('D:20260115250000')).toBeUndefined(); // hour 25
    expect(parsePdfDate("D:20260115103000+24'00'")).toBeUndefined();
    expect(parsePdfDate('D:20240229')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });
});
