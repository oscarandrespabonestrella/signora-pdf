import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import {
  TEST_ROOT_CA_PEM,
  crlClean,
  crlTsaClean,
  ocspGood,
  validRsaPdf,
} from '../../validation/src/signed-fixtures.testing';
import { validatePdfSignatures } from '../../validation/src/validate-signatures';
import { appendDss, dssSignatureKey, readDss } from './dss';
import { checkXrefChain } from './xref-check.testing';

const derOf = (pem: string) =>
  Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----|\s+/g, '')), (c) => c.charCodeAt(0));
const rootCert = () => derOf(TEST_ROOT_CA_PEM);
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const sameList = (a: readonly Uint8Array[], b: readonly Uint8Array[]) =>
  a.length === b.length && a.every((v, i) => same(v, b[i]));

async function blank(objectStreams = false) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  return { doc, save: () => doc.save({ useObjectStreams: objectStreams }) };
}

describe('Document Security Store', () => {
  it('is absent from a PDF that has none', async () => {
    const { save } = await blank();
    expect(await readDss(await save())).toBeUndefined();
    expect(await readDss(validRsaPdf())).toBeUndefined();
  });

  it('writes certificates, CRLs and OCSP responses and reads them back', async () => {
    const { save } = await blank();
    const original = await save();
    const output = await appendDss(original, {
      certs: [rootCert()],
      crls: [crlClean()],
      ocsps: [ocspGood()],
    });

    expect(same(output.subarray(0, original.length), original)).toBe(true);
    expect(checkXrefChain(output).kinds).toEqual(['table', 'table']);
    const dss = (await readDss(output))!;
    expect(sameList(dss.certs, [rootCert()])).toBe(true);
    expect(sameList(dss.crls, [crlClean()])).toBe(true);
    expect(sameList(dss.ocsps, [ocspGood()])).toBe(true);
    expect(dss.vri).toEqual({});
  });

  it('stores the data compressed', async () => {
    const { save } = await blank();
    const output = await appendDss(await save(), { crls: [crlClean()] });
    const update = new TextDecoder('latin1').decode(output);
    expect(update).toContain('/Filter /FlateDecode');
  });

  it('adds to an existing DSS without repeating what it already holds', async () => {
    const { save } = await blank();
    const first = await appendDss(await save(), { certs: [rootCert()], crls: [crlClean()] });
    const second = await appendDss(first, {
      certs: [rootCert()], // already there
      crls: [crlClean(), crlTsaClean()],
      ocsps: [ocspGood()],
    });

    const dss = (await readDss(second))!;
    expect(dss.certs).toHaveLength(1);
    expect(sameList(dss.crls, [crlClean(), crlTsaClean()])).toBe(true);
    expect(dss.ocsps).toHaveLength(1);
    expect(same(second.subarray(0, first.length), first)).toBe(true);
    expect(checkXrefChain(second).kinds).toHaveLength(3);
  });

  it('lists per-signature data in the /VRI under the key of that signature', async () => {
    const { save } = await blank();
    const signature = new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x05]);
    const output = await appendDss(await save(), {
      signatures: [{ signature, certs: [rootCert()], crls: [crlClean()] }],
    });

    const dss = (await readDss(output))!;
    const key = await dssSignatureKey(signature);
    expect(key).toMatch(/^[0-9A-F]{40}$/);
    expect(Object.keys(dss.vri)).toEqual([key]);
    expect(sameList(dss.vri[key].crls, [crlClean()])).toBe(true);
    expect(dss.vri[key].ocsps).toEqual([]);
    // What a signature brings is also in the global lists.
    expect(sameList(dss.certs, [rootCert()])).toBe(true);
  });

  it('merges /VRI entries across updates', async () => {
    const { save } = await blank();
    const signature = new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x07]);
    const first = await appendDss(await save(), {
      signatures: [{ signature, crls: [crlClean()] }],
    });
    const second = await appendDss(first, { signatures: [{ signature, ocsps: [ocspGood()] }] });
    const dss = (await readDss(second))!;
    const entry = dss.vri[await dssSignatureKey(signature)];
    expect(entry.crls).toHaveLength(1);
    expect(entry.ocsps).toHaveLength(1);
  });

  it('works with an xref stream and when the DSS is an indirect object', async () => {
    const { doc, save } = await blank(true);
    const stored = doc.context.register(doc.context.obj({}));
    doc.catalog.set(PDFName.of('DSS'), stored);
    const original = await save();
    const output = await appendDss(original, { crls: [crlClean()] });
    expect(checkXrefChain(output).kinds[0]).toBe('stream');

    const written = [
      ...new TextDecoder('latin1')
        .decode(output.subarray(original.length))
        .matchAll(/(\d+) \d+ obj\b/g),
    ].map((m) => Number(m[1]));
    const catalogRef = (await PDFDocument.load(original)).context.trailerInfo.Root;
    expect(written).toContain(stored.objectNumber); // the DSS object itself was revised
    expect(written).not.toContain((catalogRef as unknown as { objectNumber: number }).objectNumber);
    expect((await readDss(output))!.crls).toHaveLength(1);
  });

  it('merges into a direct DSS dictionary of the catalog', async () => {
    const { doc, save } = await blank();
    const crl = doc.context.register(doc.context.flateStream(crlClean()));
    doc.catalog.set(PDFName.of('DSS'), doc.context.obj({ CRLs: [crl] }));
    const output = await appendDss(await save(), { ocsps: [ocspGood()] });
    const dss = (await readDss(output))!;
    expect(dss.crls).toHaveLength(1);
    expect(dss.ocsps).toHaveLength(1);
    const loaded = await PDFDocument.load(output);
    expect(loaded.catalog.lookup(PDFName.of('DSS'), PDFDict)).toBeDefined();
  });

  it('returns an identical copy when there is nothing to add', async () => {
    const original = validRsaPdf();
    const output = await appendDss(original, { signatures: [{ signature: new Uint8Array([1]) }] });
    expect(same(output, original)).toBe(true);
    expect(output).not.toBe(original);
  });

  it('keeps the digital signatures of the document valid', async () => {
    const original = validRsaPdf();
    const output = await appendDss(original, { certs: [rootCert()], crls: [crlClean()] });
    expect(same(output.subarray(0, original.length), original)).toBe(true);
    const report = await validatePdfSignatures(output, { trustAnchors: [TEST_ROOT_CA_PEM] });
    expect(report.status).toBe('valid');
    expect((await readDss(output))!.crls).toHaveLength(1);
  });
});
