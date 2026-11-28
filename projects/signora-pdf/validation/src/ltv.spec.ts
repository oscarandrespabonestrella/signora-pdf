import { appendDss } from 'signora-pdf/pdf-lib';
import { inspectPdfSignatures } from './inspect-signatures';
import { formatValidationReport, serializeValidationReport } from './report';
import {
  REFERENCE_TIME,
  TEST_ROOT_CA_PEM,
  TEST_TSA_ROOT_CA_PEM,
  archivalPdf,
  crlClean,
  crlEarly,
  crlTsaClean,
  dssAfterTimestampPdf,
  dssRevokedPdf,
  dssSplitAroundTimestampPdf,
  ltvPdf,
  signatureTimestampPdf,
  turingDssPdf,
  turingNoIntermediatePdf,
} from './signed-fixtures.testing';
import { validatePdfSignatures, type ValidationOptions } from './validate-signatures';

const anchors = [TEST_ROOT_CA_PEM, TEST_TSA_ROOT_CA_PEM];
const run = (pdf: Uint8Array, extra: Partial<ValidationOptions> = {}) =>
  validatePdfSignatures(pdf, { trustAnchors: anchors, validationTime: REFERENCE_TIME, ...extra });
const codes = (items: readonly { code: string }[]) => items.map((i) => i.code);
const subjects = (path: readonly { subject: string }[] | undefined) =>
  path?.map((c) => /CN=([^,]+)/.exec(c.subject)?.[1]);

/** Changes the last digit of the first time value: a signature over it no longer matches. */
function tamper(der: Uint8Array): Uint8Array {
  const text = Array.from(der, (c) => String.fromCharCode(c)).join('');
  const match = /\d{12,14}Z/.exec(text)!;
  const copy = der.slice();
  const at = match.index + match[0].length - 2;
  copy[at] = copy[at] === 0x39 ? 0x30 : copy[at] + 1;
  return copy;
}

/** Flips a hex digit near the end of the n-th signature's /Contents (its signature value). */
async function corruptSignature(pdf: Uint8Array, n: number): Promise<Uint8Array> {
  const info = (await inspectPdfSignatures(pdf))[n];
  const copy = pdf.slice();
  const at = info.byteRange![1] + 1 + 2 * (info.contents!.length - 10);
  copy[at] = copy[at] === 0x30 ? 0x31 : 0x30;
  return copy;
}

describe('long-term validation', () => {
  describe('PAdES-B-LT: evidence kept in the document', () => {
    it('reports B-LT when a DSS holds revocation evidence for the whole chain', async () => {
      const report = await run(ltvPdf());
      const [result] = report.results;

      expect(report.status).toBe('valid');
      expect(result.status).toBe('valid');
      expect(result.padesLevel).toBe('B-LT');
      expect(result.checks).toMatchObject({
        timestamp: 'passed',
        certificateChain: 'passed',
        revocation: 'passed',
      });
      expect(result.chain?.basis).toBe('timestamp');
      expect(result.chain?.revocation?.[0]).toMatchObject({
        status: 'good',
        source: 'crl',
        origin: 'dss',
      });
      expect(result.chain?.revocation?.[0].evidence).toBeInstanceOf(Uint8Array);
      expect(report.dss).toEqual({ certificates: 3, crls: 2, ocsps: 0, signatures: 1 });
    });

    it('is still valid, as of the timestamp, long after the certificates would have expired', async () => {
      const [result] = (await run(ltvPdf(), { validationTime: new Date('2034-06-01T00:00:00Z') }))
        .results;
      expect(result.status).toBe('valid');
      expect(result.padesLevel).toBe('B-LT');
    });

    it('does not claim B-LT without trust anchors: the evidence would belong to no trusted chain', async () => {
      const [result] = (await validatePdfSignatures(ltvPdf(), { validationTime: REFERENCE_TIME }))
        .results;
      expect(result.status).toBe('valid');
      expect(result.padesLevel).toBe('B-T');
      expect(result.chain).toBeUndefined();
    });

    it('does not count evidence you provide or fetch as long-term', async () => {
      const result = (
        await run(signatureTimestampPdf(), {
          revocationData: { crls: [crlClean(), crlTsaClean()] },
        })
      ).results[0];
      expect(result.checks.revocation).toBe('passed');
      expect(result.chain?.revocation?.[0].origin).toBe('provided');
      expect(result.padesLevel).toBe('B-T');
    });

    it('stays B-T when the document keeps nothing', async () => {
      const report = await run(signatureTimestampPdf());
      expect(report.results[0].padesLevel).toBe('B-T');
      expect(report.dss).toBeUndefined();
    });

    it('uses a revoked certificate found in the DSS', async () => {
      const [result] = (await run(dssRevokedPdf())).results;
      expect(result.status).toBe('invalid');
      expect(codes(result.problems)).toEqual(['CERTIFICATE_REVOKED']);
      expect(result.chain?.revocation?.[0]).toMatchObject({ status: 'revoked', origin: 'dss' });
      expect(result.padesLevel).toBeUndefined();
    });
  });

  describe('the DSS is only data to be checked', () => {
    it('ignores forged evidence', async () => {
      const pdf = await appendDss(signatureTimestampPdf(), { crls: [tamper(crlClean())] });
      const [result] = (await run(pdf)).results;
      expect(result.chain?.revocation?.[0].status).toBe('unknown');
      expect(result.padesLevel).toBe('B-T');
    });

    it('ignores evidence issued before the timestamp', async () => {
      const pdf = await appendDss(signatureTimestampPdf(), { crls: [crlEarly()] });
      const [result] = (await run(pdf)).results;
      expect(result.chain?.revocation?.[0].status).toBe('unknown');
      expect(result.padesLevel).toBe('B-T');
    });

    it('skips items that are not what they claim to be', async () => {
      const garbage = new Uint8Array([1, 2, 3, 4]);
      const pdf = await appendDss(signatureTimestampPdf(), {
        certs: [garbage],
        crls: [garbage],
        ocsps: [garbage],
      });
      const report = await run(pdf);
      expect(report.results[0].status).toBe('valid');
      expect(report.dss).toMatchObject({ certificates: 1, crls: 1, ocsps: 1 });
    });

    it('takes intermediate certificates from the DSS to build a chain', async () => {
      const without = (await run(turingNoIntermediatePdf())).results[0];
      expect(without.status).toBe('indeterminate');
      expect(codes(without.problems)).toEqual(['CERTIFICATE_CHAIN_INVALID']);

      const withDss = (await run(turingDssPdf())).results[0];
      expect(withDss.status).toBe('valid');
      expect(subjects(withDss.chain?.path)).toEqual([
        'Alan Turing',
        'Signora Test Intermediate CA',
        'Signora Test Root CA',
      ]);
    });
  });

  describe('PAdES-B-LTA: a document timestamp over the evidence', () => {
    it('reports B-LTA when a later document timestamp already covered the DSS', async () => {
      const report = await run(archivalPdf());
      const [signature, stamp] = report.results;

      expect(report.status).toBe('valid');
      expect(stamp.signature.kind).toBe('document-timestamp');
      expect(stamp.status).toBe('valid');
      expect(signature.padesLevel).toBe('B-LTA');
      expect(report.dss?.crls).toBe(2);
    });

    it('stays at B-LT when the DSS was added after the last document timestamp', async () => {
      const report = await run(dssAfterTimestampPdf());
      const [signature, stamp] = report.results;
      expect(stamp.status).toBe('valid');
      expect(signature.padesLevel).toBe('B-LT');
    });

    it('stays at B-LT when the timestamp covered only part of what the signature relies on', async () => {
      // The DSS had the certificates when the timestamp was made, but the CRL was added after it.
      const [signature, stamp] = (await run(dssSplitAroundTimestampPdf())).results;
      expect(stamp.status).toBe('valid');
      expect(signature.chain?.revocation?.[0].origin).toBe('dss');
      expect(signature.padesLevel).toBe('B-LT');
    });

    it('stays at B-LT when the document timestamp does not verify', async () => {
      const pdf = await corruptSignature(archivalPdf(), 1);
      const [signature, stamp] = (await run(pdf)).results;
      expect(stamp.status).toBe('invalid');
      expect(signature.padesLevel).toBe('B-LT');
    });

    it('needs trust anchors for the timestamp authority too', async () => {
      const [signature] = (await run(archivalPdf(), { trustAnchors: [TEST_ROOT_CA_PEM] })).results;
      // The signer's chain is trusted, the timestamp authority is not: not even B-T.
      expect(signature.padesLevel).not.toBe('B-LTA');
      expect(signature.padesLevel).not.toBe('B-LT');
    });

    it('stays B-T without trust anchors', async () => {
      const [signature] = (
        await validatePdfSignatures(archivalPdf(), { validationTime: REFERENCE_TIME })
      ).results;
      expect(signature.padesLevel).toBe('B-T');
    });
  });

  describe('report', () => {
    it('shows the DSS and the level in the text, and keeps raw evidence out of the JSON', async () => {
      const report = await run(archivalPdf());
      const text = formatValidationReport(report);
      expect(text).toContain('DSS: 3 certificate(s), 2 CRL(s), 0 OCSP response(s)');
      expect(text).toContain('PAdES level: B-LTA');
      expect(text).toContain('revocation: good (crl, dss)');

      const json = JSON.parse(serializeValidationReport(report));
      expect(json.dss).toEqual({ certificates: 3, crls: 2, ocsps: 0, signatures: 1 });
      expect(json.results[0].chain.revocation[0].evidence).toBeUndefined();
      expect(json.results[0].chain.revocation[0].origin).toBe('dss');
    });
  });
});
