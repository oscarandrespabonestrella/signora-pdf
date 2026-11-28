import { TestBed } from '@angular/core/testing';
import type { PlacedSignature } from 'signora-pdf';
import { SIGNORA_WRITER, hasDigitalSignature, provideSignora } from 'signora-pdf';
import { PDFDocument, degrees } from 'pdf-lib';
import {
  PdfAlreadySignedError,
  UnsupportedSignatureImageError,
  withPdfLibWriter,
} from './pdf-lib-writer';

// 1x1 red PNG.
const RED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8Dwn4EIAAA/AQMBXY4aLQAAAABJRU5ErkJggg==';

const asset = { id: 'red', kind: 'image', dataUrl: RED_PNG, aspectRatio: 1 } as const;
const placement = (pageIndex: number, id = 'p'): PlacedSignature => ({
  id,
  asset,
  pageIndex,
  rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
});

async function createPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([792, 612]).setRotation(degrees(90));
  return doc.save();
}

function writer() {
  TestBed.configureTestingModule({ providers: [provideSignora(withPdfLibWriter())] });
  return TestBed.inject(SIGNORA_WRITER);
}

describe('PdfLibDocumentWriter', () => {
  it('round-trips a document without placements', async () => {
    const out = await writer().applyVisualSignatures(await createPdf(), []);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  it('adds an image to the target pages only, embedding a shared asset once', async () => {
    const source = await createPdf();
    const out = await writer().applyVisualSignatures(source, [
      placement(0, 'a'),
      placement(0, 'b'),
      placement(1, 'c'),
    ]);
    const doc = await PDFDocument.load(out);
    expect(out.length).toBeGreaterThan(source.length);
    // One embedded image object serves all three placements.
    const images = doc.context
      .enumerateIndirectObjects()
      .filter(([, obj]) => String(obj).includes('/Subtype /Image'));
    expect(images.length).toBe(1);
  });

  it('does not change the page count or sizes', async () => {
    const out = await writer().applyVisualSignatures(await createPdf(), [placement(1)]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(1).getSize()).toEqual({ width: 792, height: 612 });
    expect(doc.getPage(1).getRotation().angle).toBe(90);
  });

  it('rejects placements on missing pages', async () => {
    await expect(
      writer().applyVisualSignatures(await createPdf(), [placement(9)]),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('rejects assets that are not PNG or JPEG data URLs', async () => {
    const bad: PlacedSignature = {
      ...placement(0),
      asset: { ...asset, id: 'svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
    };
    await expect(writer().applyVisualSignatures(await createPdf(), [bad])).rejects.toBeInstanceOf(
      UnsupportedSignatureImageError,
    );
  });

  it('refuses to modify an already signed document unless allowed', async () => {
    const signed = new TextEncoder().encode(
      '%PDF-1.7\n<< /Type /Sig /ByteRange [0 10 20 30] /Contents <00> >>\n',
    );
    expect(hasDigitalSignature(signed)).toBe(true);
    expect(hasDigitalSignature(await createPdf())).toBe(false);
    await expect(writer().applyVisualSignatures(signed, [placement(0)])).rejects.toBeInstanceOf(
      PdfAlreadySignedError,
    );
  });

  it('returns the bytes unchanged when there is nothing to add, even if already signed', async () => {
    const signed = new TextEncoder().encode(
      '%PDF-1.7\n<< /Type /Sig /ByteRange [0 10 20 30] /Contents <00> >>\n',
    );
    const subject = writer();
    const out = await subject.applyVisualSignatures(signed, []);
    expect(out).toEqual(signed);
    expect(out).not.toBe(signed);
    const plain = await createPdf();
    expect(await subject.applyVisualSignatures(plain, [])).toEqual(plain);
  });
});
