import {
  IncrementalUpdate,
  addToAcroForm,
  appendDss,
  appendVisualSignatures,
  collectFormFields,
} from 'signora-pdf/pdf-lib';
import { formatValidationReport, serializeValidationReport } from './report';
import {
  archivalPdf,
  certified1Pdf,
  certified2Pdf,
  certified3Pdf,
  crlClean,
  dssAfterTimestampPdf,
  formSignedPdf,
  lockedAllPdf,
  lockedIncludePdf,
  successivePdf,
  twoSignaturesPdf,
  validRsaPdf,
} from './signed-fixtures.testing';
import { validatePdfSignatures } from './validate-signatures';

const RED =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8Dwn4EIAAA/AQMBXY4aLQAAAABJRU5ErkJggg==';
const stamp = (pdf: Uint8Array, xrefFormat?: 'table' | 'stream', ignoreDocMdp = false) =>
  appendVisualSignatures(
    pdf,
    [
      {
        id: 'p',
        asset: { id: 'r', kind: 'image', dataUrl: RED, aspectRatio: 1 },
        pageIndex: 0,
        rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      },
    ],
    { xrefFormat, ignoreDocMdp },
  );

/** Appends an update built with the library's own incremental writer. */
async function change(pdf: Uint8Array, edit: (update: IncrementalUpdate) => void) {
  const update = await IncrementalUpdate.load(pdf);
  edit(update);
  return update.build();
}
const fieldOf = (update: IncrementalUpdate, name: string) =>
  collectFormFields(update.lib, update.document).find((f) => f.name === name)!;
const fillIn = (pdf: Uint8Array, name: string, value: string) =>
  change(pdf, (u) => {
    const record = fieldOf(u, name);
    const copy = record.field.clone(u.context);
    copy.set(u.lib.PDFName.of('V'), u.lib.PDFString.of(value));
    u.replace(record.ref!, copy);
  });

/** A signature field with a (not cryptographically real) value, as a later signer would add it. */
const addSignedField = (pdf: Uint8Array, name: string, type: 'Sig' | 'DocTimeStamp' = 'Sig') =>
  change(pdf, (u) => {
    const { context, lib } = u;
    const value = context.register(
      context.obj({
        Type: type,
        Filter: 'Adobe.PPKLite',
        SubFilter: type === 'Sig' ? 'ETSI.CAdES.detached' : 'ETSI.RFC3161',
        ByteRange: [0, 1, 2, 2000000000], // sorts after the real signature
        Contents: lib.PDFHexString.of('00'),
      }),
    );
    const widget = context.register(
      context.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Sig',
        T: lib.PDFString.of(name),
        Rect: [0, 0, 0, 0],
        P: u.document.getPage(0).ref,
        V: value,
      }),
    );
    addToAcroForm(u, [widget]);
  });

const emptyField = (pdf: Uint8Array, name: string, type: 'Sig' | 'Tx') =>
  change(pdf, (u) => {
    const widget = u.context.register(
      u.context.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        FT: type,
        T: u.lib.PDFString.of(name),
        Rect: [10, 10, 100, 40],
        P: u.document.getPage(0).ref,
      }),
    );
    addToAcroForm(u, [widget]);
  });

const rotatePage = (pdf: Uint8Array) =>
  change(pdf, (u) => {
    const page = u.document.getPage(0);
    const copy = page.node.clone(u.context);
    copy.set(u.lib.PDFName.of('Rotate'), u.lib.PDFNumber.of(90));
    u.replace(page.ref, copy);
  });

const touchInfo = (pdf: Uint8Array) =>
  change(pdf, (u) => {
    const ref = u.context.trailerInfo.Info as import('pdf-lib').PDFRef;
    const copy = (u.context.lookup(ref, u.lib.PDFDict) as import('pdf-lib').PDFDict).clone(
      u.context,
    );
    copy.set(u.lib.PDFName.of('ModDate'), u.lib.PDFString.of('D:20270101000000Z'));
    u.replace(ref, copy);
  });

const addPage = (pdf: Uint8Array) =>
  change(pdf, (u) => {
    const { context, lib } = u;
    const pagesRef = u.document.catalog.get(lib.PDFName.of('Pages')) as import('pdf-lib').PDFRef;
    const pages = (context.lookup(pagesRef, lib.PDFDict) as import('pdf-lib').PDFDict).clone(
      context,
    );
    const page = context.register(
      context.obj({ Type: 'Page', Parent: pagesRef, MediaBox: [0, 0, 100, 100] }),
    );
    const kids = pages.lookup(lib.PDFName.of('Kids'), lib.PDFArray).clone(context);
    kids.push(page);
    pages.set(lib.PDFName.of('Kids'), kids);
    pages.set(lib.PDFName.of('Count'), lib.PDFNumber.of(kids.size()));
    u.replace(pagesRef, pages);
  });

/** Replaces the dictionary of Ada's signature: something nobody should be able to do quietly. */
const rewriteSignature = (pdf: Uint8Array) =>
  change(pdf, (u) => {
    const record = fieldOf(u, 'Signature1');
    const ref = record.field.get(u.lib.PDFName.of('V')) as import('pdf-lib').PDFRef;
    const copy = (u.context.lookup(ref, u.lib.PDFDict) as import('pdf-lib').PDFDict).clone(
      u.context,
    );
    copy.set(u.lib.PDFName.of('Reason'), u.lib.PDFString.of('I never signed this'));
    u.replace(ref, copy);
  });

const dropPerms = (pdf: Uint8Array) =>
  change(pdf, (u) => {
    const copy = u.document.catalog.clone(u.context);
    copy.delete(u.lib.PDFName.of('Perms'));
    u.replace(u.catalogRef, copy);
  });

const removeFirstAnnotation = (pdf: Uint8Array) =>
  change(pdf, (u) => {
    const page = u.document.getPage(0);
    const copy = page.node.clone(u.context);
    const annots = copy.lookup(u.lib.PDFName.of('Annots'), u.lib.PDFArray).clone(u.context);
    annots.remove(0);
    copy.set(u.lib.PDFName.of('Annots'), annots);
    u.replace(page.ref, copy);
  });

const first = async (pdf: Uint8Array) => (await validatePdfSignatures(pdf)).results[0];
const kinds = (result: Awaited<ReturnType<typeof first>>) =>
  result.laterRevisions?.changes.map((c) => c.kind + (c.field ? `:${c.field}` : ''));
const codes = (items: readonly { code: string }[]) => items.map((i) => i.code);

describe('changes after a signature', () => {
  describe('what changed', () => {
    it('has nothing to say when the signature covers the whole file', async () => {
      const result = await first(formSignedPdf());
      expect(result.laterRevisions).toBeUndefined();
      expect(result.warnings).toEqual([]);
    });

    it('recognizes an added annotation, like a visual signature', async () => {
      const result = await first(await stamp(formSignedPdf()));
      expect(kinds(result)).toEqual(['annotation']);
      expect(result.laterRevisions?.permitted).toBe(true);
      expect(codes(result.warnings)).toEqual(['REVISIONS_AFTER_SIGNATURE']); // nothing unexpected
      expect(result.status).toBe('valid');
    });

    it('recognizes the same change in an update with an xref stream', async () => {
      const result = await first(await stamp(formSignedPdf(), 'stream'));
      expect(kinds(result)).toEqual(['annotation']);
    });

    it('recognizes a form field being filled in, by name', async () => {
      const result = await first(
        await fillIn(await fillIn(formSignedPdf(), 'City', 'Madrid'), 'Name', 'Grace'),
      );
      expect(kinds(result)?.sort()).toEqual(['form-fill:City', 'form-fill:Name']);
      expect(result.laterRevisions?.permitted).toBe(true);
      expect(result.status).toBe('valid');
    });

    it('recognizes a second, real signature added afterwards', async () => {
      const report = await validatePdfSignatures(successivePdf());
      const [ada, grace] = report.results;
      expect(report.status).toBe('valid');
      expect(kinds(ada)).toEqual(['signature:Signature2']);
      expect(ada.laterRevisions?.permitted).toBe(true);
      expect(grace.laterRevisions).toBeUndefined();
      expect(codes(ada.warnings)).toEqual(['REVISIONS_AFTER_SIGNATURE']);
    });

    it('tells a signature from a document timestamp', async () => {
      expect(kinds(await first(await addSignedField(formSignedPdf(), 'S2', 'Sig')))).toEqual([
        'signature:S2',
      ]);
      expect(
        kinds(await first(await addSignedField(formSignedPdf(), 'T2', 'DocTimeStamp'))),
      ).toEqual(['document-timestamp:T2']);
    });

    it('recognizes validation data added to the DSS, and a timestamp then DSS', async () => {
      expect(kinds(await first(await appendDss(formSignedPdf(), { crls: [crlClean()] })))).toEqual([
        'validation-data',
      ]);
      const [ada, stamp2] = (await validatePdfSignatures(dssAfterTimestampPdf())).results;
      expect(kinds(ada)).toEqual(['validation-data', 'document-timestamp:DocTimeStamp1']);
      expect(kinds(stamp2)).toEqual(['validation-data']);
      expect(kinds((await validatePdfSignatures(archivalPdf())).results[0])).toEqual([
        'validation-data',
        'document-timestamp:DocTimeStamp1',
      ]);
    });

    it('recognizes new fields, signature or not', async () => {
      expect(kinds(await first(await emptyField(formSignedPdf(), 'Later', 'Sig')))).toEqual([
        'signature-field:Later',
      ]);
      expect(kinds(await first(await emptyField(formSignedPdf(), 'Phone', 'Tx')))).toEqual([
        'form-field:Phone',
      ]);
    });

    it('recognizes a removed annotation', async () => {
      expect(kinds(await first(await removeFirstAnnotation(formSignedPdf())))).toEqual([
        'annotation',
      ]);
    });

    it('treats a document information update as metadata only', async () => {
      const result = await first(await touchInfo(formSignedPdf()));
      expect(kinds(result)).toEqual(['metadata']);
      expect(codes(result.warnings)).toEqual(['REVISIONS_AFTER_SIGNATURE']);
    });

    it('warns when what a page shows changed, without invalidating the signed revision', async () => {
      for (const [pdf, kind] of [
        [await rotatePage(formSignedPdf()), 'page-content'],
        [await addPage(formSignedPdf()), 'page-structure'],
      ] as const) {
        const result = await first(pdf);
        expect(kinds(result)).toContain(kind);
        expect(result.status).toBe('valid');
        expect(result.checks.integrity).toBe('passed');
        expect(codes(result.warnings)).toContain('CONTENT_CHANGED_AFTER_SIGNING');
      }
    });

    it('treats what it does not recognize as an unexpected change', async () => {
      // Rewriting the dictionary of the signature itself, in a later revision.
      const result = await first(await rewriteSignature(formSignedPdf()));
      expect(kinds(result)).toEqual(['other']);
      expect(codes(result.warnings)).toContain('CONTENT_CHANGED_AFTER_SIGNING');
    });

    it('says nothing when the signed revision cannot be read on its own', async () => {
      // The first signature of this fixture signs a prefix that is not a complete revision.
      const report = await validatePdfSignatures(twoSignaturesPdf());
      expect(report.results[0].laterRevisions).toBeUndefined();
      expect(codes(report.results[0].warnings)).toEqual(['REVISIONS_AFTER_SIGNATURE']);
    });
  });

  describe('what a certification (DocMDP) permits', () => {
    it('carries the level and allows nothing but validation data and metadata at level 1', async () => {
      const dss = await first(await appendDss(certified1Pdf(), { crls: [crlClean()] }));
      expect(dss.laterRevisions).toMatchObject({ docMdp: 1, permitted: true });
      expect(dss.status).toBe('valid');
      expect((await first(await touchInfo(certified1Pdf()))).laterRevisions?.permitted).toBe(true);

      for (const pdf of [
        await fillIn(certified1Pdf(), 'Name', 'x'),
        await stamp(certified1Pdf(), undefined, true),
        await addSignedField(certified1Pdf(), 'S2'),
        await rotatePage(certified1Pdf()),
      ]) {
        const result = await first(pdf);
        expect(result.laterRevisions?.permitted).toBe(false);
        expect(result.status).toBe('invalid');
        expect(codes(result.problems)).toEqual(['CHANGES_NOT_PERMITTED']);
        expect(result.checks.integrity).toBe('passed'); // the signature itself is fine
      }
    });

    it('allows form filling and signing, but not annotations, at level 2', async () => {
      expect((await first(await fillIn(certified2Pdf(), 'Name', 'x'))).status).toBe('valid');
      expect((await first(await addSignedField(certified2Pdf(), 'S2'))).status).toBe('valid');
      expect(
        (await first(await addSignedField(certified2Pdf(), 'T2', 'DocTimeStamp'))).status,
      ).toBe('valid');

      const annotated = await first(await stamp(certified2Pdf(), undefined, true));
      expect(annotated.status).toBe('invalid');
      expect(annotated.laterRevisions?.forbidden.map((c) => c.kind)).toEqual(['annotation']);
      expect((await first(await emptyField(certified2Pdf(), 'Later', 'Sig'))).status).toBe(
        'invalid',
      );
    });

    it('allows annotations and new fields at level 3, but not changes to the page', async () => {
      expect((await first(await stamp(certified3Pdf()))).status).toBe('valid');
      expect((await first(await emptyField(certified3Pdf(), 'Later', 'Sig'))).status).toBe('valid');
      expect((await first(await removeFirstAnnotation(certified3Pdf()))).status).toBe('valid');

      const rotated = await first(await rotatePage(certified3Pdf()));
      expect(rotated.status).toBe('invalid');
      expect(rotated.laterRevisions?.forbidden.map((c) => c.kind)).toEqual(['page-content']);
      expect((await first(await addPage(certified3Pdf()))).status).toBe('invalid');
    });

    it('does not let the certification itself be taken out', async () => {
      const result = await first(await dropPerms(certified3Pdf()));
      expect(kinds(result)).toEqual(['other']);
      expect(result.status).toBe('invalid');
    });

    it('does not apply to a document that is not certified', async () => {
      const result = await first(await rotatePage(formSignedPdf()));
      expect(result.laterRevisions?.docMdp).toBeUndefined();
      expect(result.status).toBe('valid');
    });
  });

  describe('what a field lock (FieldMDP) permits', () => {
    it('forbids changing a locked field and allows the others', async () => {
      const locked = await first(await fillIn(lockedIncludePdf(), 'Name', 'x'));
      expect(locked.status).toBe('invalid');
      expect(locked.laterRevisions).toMatchObject({ fieldLock: true, permitted: false });
      expect(locked.laterRevisions?.forbidden).toEqual([
        { kind: 'form-fill', field: 'Name', objects: 1 },
      ]);

      const free = await first(await fillIn(lockedIncludePdf(), 'City', 'Madrid'));
      expect(free.status).toBe('valid');
      expect(free.laterRevisions).toMatchObject({ fieldLock: true, permitted: true });
    });

    it('can lock every field, and still allows what is not a field', async () => {
      expect((await first(await fillIn(lockedAllPdf(), 'City', 'x'))).status).toBe('invalid');
      expect((await first(await stamp(lockedAllPdf()))).status).toBe('valid');
      expect((await first(await appendDss(lockedAllPdf(), { crls: [crlClean()] }))).status).toBe(
        'valid',
      );
    });

    it('does not lock fields that did not exist when it was signed', async () => {
      const result = await first(await addSignedField(lockedAllPdf(), 'S2'));
      expect(result.status).toBe('valid');
      expect(kinds(result)).toEqual(['signature:S2']);
    });

    it('does not mix with a signature that has no lock', async () => {
      const result = await first(await fillIn(formSignedPdf(), 'Name', 'x'));
      expect(result.laterRevisions?.fieldLock).toBeUndefined();
      expect(result.status).toBe('valid');
    });
  });

  describe('report', () => {
    it('lists the changes in the text and in the JSON', async () => {
      const report = await validatePdfSignatures(await fillIn(lockedIncludePdf(), 'Name', 'x'));
      const text = formatValidationReport(report);
      expect(text).toContain('later revisions: form-fill (NOT PERMITTED)');
      expect(text).toContain('problem CHANGES_NOT_PERMITTED');

      const json = JSON.parse(serializeValidationReport(report));
      expect(json.results[0].laterRevisions.changes).toEqual([
        { kind: 'form-fill', field: 'Name', objects: 1 },
      ]);
      expect(json.results[0].laterRevisions.permitted).toBe(false);
    });

    it('does not change a plain valid signature', async () => {
      const report = await validatePdfSignatures(validRsaPdf());
      expect(report.results[0].laterRevisions).toBeUndefined();
      expect(report.status).toBe('valid');
    });
  });
});
