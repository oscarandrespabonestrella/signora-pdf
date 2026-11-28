import { TestBed } from '@angular/core/testing';
import { SIGNORA_SIGNATURE_VALIDATOR, provideSignora } from 'signora-pdf';
import { PdfInspectionError, inspectPdfSignatures } from './inspect-signatures';
import { formatValidationReport, serializeValidationReport } from './report';
import { buildSignatureFixture } from './signature-fixtures.testing';
import {
  TEST_ROOT_CA_PEM,
  TEST_TSA_ROOT_CA_PEM,
  UNRELATED_ROOT_CA_PEM,
  claimedBeforeCertificatePdf,
  documentTimestampPdf,
  signatureTimestampPdf,
  twoSignaturesPdf,
  validEcPdf,
  validRsaPdf,
  viaIntermediatePdf,
} from './signed-fixtures.testing';
import { TrustAnchorError } from './trust';
import { validatePdfSignatures, withPdfSignatureValidation } from './validate-signatures';

/** Flips one hex digit of the `k`-th byte of a signature's /Contents. */
async function corruptContents(pdf: Uint8Array, signatureIndex: number, fromEnd: number) {
  const info = (await inspectPdfSignatures(pdf))[signatureIndex];
  const copy = pdf.slice();
  const position = info.byteRange![1] + 1 + 2 * (info.contents!.length - fromEnd);
  copy[position] = copy[position] === 0x30 ? 0x31 : 0x30;
  return copy;
}

describe('validatePdfSignatures', () => {
  describe('real signatures made by OpenSSL', () => {
    it('accepts an RSA PAdES signature and describes the signer', async () => {
      const report = await validatePdfSignatures(validRsaPdf());
      const [result] = report.results;

      expect(report.status).toBe('valid');
      expect(result.status).toBe('valid');
      expect(result.problems).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.checks).toEqual({
        byteRange: 'passed',
        integrity: 'passed',
        signature: 'passed',
        certificateChain: 'not-evaluated',
        revocation: 'not-evaluated',
        timestamp: 'not-evaluated',
      });
      expect(result.digestAlgorithm).toBe('SHA-256');
      expect(result.signatureAlgorithm).toBe('sha256WithRSAEncryption');
      expect(result.signer).toMatchObject({
        subject: 'C=ES, O=Signora Test, CN=Ada Lovelace, emailAddress=ada@example.test',
        issuer: 'C=ES, O=Signora Test, CN=Signora Test Root CA',
        publicKeyAlgorithm: 'RSA 2048',
        signatureAlgorithm: 'sha256WithRSAEncryption',
        selfSigned: false,
      });
      expect(result.signer?.keyUsage).toEqual(['digitalSignature', 'nonRepudiation']);
      expect(result.signer?.notBefore.toISOString()).toBe('2025-01-01T00:00:00.000Z');
      expect(result.signer?.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(report.documentSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('lists the embedded certificates, including a self-signed root', async () => {
      const [result] = (await validatePdfSignatures(validRsaPdf())).results;
      expect(result.certificates.map((c) => c.selfSigned).sort()).toEqual([false, true]);
    });

    it('accepts an ECDSA signature', async () => {
      const [result] = (await validatePdfSignatures(validEcPdf())).results;
      expect(result.status).toBe('valid');
      expect(result.signer?.publicKeyAlgorithm).toBe('EC P-256');
      expect(result.signatureAlgorithm).toBe('ecdsa-with-SHA256');
      expect(result.signature.subFilter).toBe('adbe.pkcs7.detached');
    });

    it('validates several signatures and warns about the one with later revisions', async () => {
      const report = await validatePdfSignatures(twoSignaturesPdf());
      expect(report.status).toBe('valid');
      expect(report.results.map((r) => [r.signature.fieldName, r.status])).toEqual([
        ['First', 'valid'],
        ['Second', 'valid'],
      ]);
      expect(report.results[0].warnings.map((w) => w.code)).toEqual(['REVISIONS_AFTER_SIGNATURE']);
      expect(report.results[1].warnings).toEqual([]);
    });

    it('warns when the claimed signing time precedes the certificate validity', async () => {
      const [result] = (await validatePdfSignatures(claimedBeforeCertificatePdf())).results;
      expect(result.status).toBe('valid');
      expect(result.warnings.map((w) => w.code)).toEqual([
        'SIGNING_TIME_OUTSIDE_CERTIFICATE_VALIDITY',
      ]);
    });
  });

  describe('detecting tampering', () => {
    it('flags a changed byte inside the signed range as DIGEST_MISMATCH', async () => {
      const pdf = validRsaPdf().slice();
      pdf[10] = pdf[10] ^ 0xff;
      const report = await validatePdfSignatures(pdf);
      const [result] = report.results;

      expect(report.status).toBe('invalid');
      expect(result.status).toBe('invalid');
      expect(result.problems.map((p) => p.code)).toEqual(['DIGEST_MISMATCH']);
      expect(result.checks.integrity).toBe('failed');
    });

    it('only invalidates the signature whose bytes were changed', async () => {
      // The second signer's name lies after the end of the first signature's range.
      const latin1 = Array.from(twoSignaturesPdf(), (c) => String.fromCharCode(c)).join('');
      expect(latin1).toContain('Grace Hopper');
      const pdf = Uint8Array.from(latin1.replace('Grace Hopper', 'Grace Hopped'), (c) =>
        c.charCodeAt(0),
      );
      const report = await validatePdfSignatures(pdf);
      expect(report.results.map((r) => r.status)).toEqual(['valid', 'invalid']);
      expect(report.status).toBe('invalid');
    });

    it('flags a corrupted signature value as SIGNATURE_INVALID with intact digest', async () => {
      const pdf = await corruptContents(validRsaPdf(), 0, 10);
      const [result] = (await validatePdfSignatures(pdf)).results;
      expect(result.status).toBe('invalid');
      expect(result.problems.map((p) => p.code)).toEqual(['SIGNATURE_INVALID']);
      expect(result.checks).toMatchObject({ integrity: 'passed', signature: 'failed' });
    });

    it('flags a corrupted ECDSA signature too', async () => {
      const pdf = await corruptContents(validEcPdf(), 0, 10);
      const [result] = (await validatePdfSignatures(pdf)).results;
      expect(result.status).toBe('invalid');
      expect(result.problems.map((p) => p.code)).toEqual(['SIGNATURE_INVALID']);
    });

    it('stays valid, with a warning, when bytes are appended after the signature', async () => {
      const original = validRsaPdf();
      const appended = new Uint8Array(original.length + 10);
      appended.set(original);
      appended.set(new TextEncoder().encode('\n%%EOF\n\n\nX'), original.length);
      const [result] = (await validatePdfSignatures(appended)).results;
      expect(result.status).toBe('valid');
      expect(result.warnings.map((w) => w.code)).toEqual(['REVISIONS_AFTER_SIGNATURE']);
    });

    it('rejects a /ByteRange that was moved', async () => {
      const latin1 = Array.from(validRsaPdf(), (c) => String.fromCharCode(c)).join('');
      const forged = Uint8Array.from(latin1.replace('[ 0000000000 ', '[ 0000000005 '), (c) =>
        c.charCodeAt(0),
      );
      const [result] = (await validatePdfSignatures(forged)).results;
      expect(result.status).toBe('invalid');
      expect(result.problems.map((p) => p.code)).toEqual(['BYTE_RANGE_MALFORMED']);
      expect(result.checks.byteRange).toBe('failed');
    });
  });

  describe('signatures that cannot be validated', () => {
    it('reports a /Contents that is not a CMS container as CMS_MALFORMED', async () => {
      const { pdf } = await buildSignatureFixture([{ name: 'Fake' }]);
      const [result] = (await validatePdfSignatures(pdf)).results;
      expect(result.status).toBe('invalid');
      expect(result.problems.map((p) => p.code)).toEqual(['CMS_MALFORMED']);
    });

    it('reports an unsupported format as indeterminate', async () => {
      const { pdf } = await buildSignatureFixture([
        { name: 'Old', subFilter: 'adbe.x509.rsa_sha1' },
      ]);
      const report = await validatePdfSignatures(pdf);
      expect(report.status).toBe('indeterminate');
      expect(report.results[0].problems.map((p) => p.code)).toEqual(['UNSUPPORTED_SUBFILTER']);
    });

    it('lists unsigned fields and reports no signatures when there are none signed', async () => {
      const { pdf } = await buildSignatureFixture([{ name: 'Pending', empty: true }]);
      const report = await validatePdfSignatures(pdf);
      expect(report.status).toBe('no-signatures');
      expect(report.results).toEqual([]);
      expect(report.unsignedFields).toEqual(['Pending']);
    });

    it('rejects bytes that are not a PDF', async () => {
      await expect(validatePdfSignatures(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
        PdfInspectionError,
      );
    });
  });

  describe('report', () => {
    it('serializes to stable JSON without raw bytes', async () => {
      const report = await validatePdfSignatures(validRsaPdf());
      const json = JSON.parse(serializeValidationReport(report));
      expect(json.schemaVersion).toBe(1);
      expect(json.status).toBe('valid');
      expect(json.generatedAt).toBe(report.generatedAt.toISOString());
      expect(json.results[0].signature.signingTime).toBe('2026-01-15T09:30:00.000Z');
      expect(json.results[0].signer.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(json.results[0].signer.der).toBeUndefined();
      expect(json.results[0].signature.contents).toBeUndefined();
    });

    it('formats a readable summary', async () => {
      const pdf = validRsaPdf().slice();
      pdf[10] = pdf[10] ^ 0xff;
      const text = formatValidationReport(await validatePdfSignatures(pdf));
      expect(text).toContain('Overall: INVALID');
      expect(text).toContain('problem DIGEST_MISMATCH');
      expect(text).toContain('CN=Ada Lovelace');
    });
  });

  it('is available through DI as the signature validator', async () => {
    TestBed.configureTestingModule({ providers: [provideSignora(withPdfSignatureValidation())] });
    const validator = TestBed.inject(SIGNORA_SIGNATURE_VALIDATOR);
    expect((await validator.validate(validEcPdf())).status).toBe('valid');
  });
});

describe('timestamps and PAdES level', () => {
  it('reports B-B for a CAdES signature without a timestamp', async () => {
    const [result] = (await validatePdfSignatures(validRsaPdf())).results;
    expect(result.padesLevel).toBe('B-B');
    expect(result.timestamp).toBeUndefined();
    expect(result.checks.timestamp).toBe('not-evaluated');
  });

  it('reports no PAdES level for adbe.pkcs7.detached', async () => {
    const [result] = (await validatePdfSignatures(validEcPdf())).results;
    expect(result.status).toBe('valid');
    expect(result.padesLevel).toBeUndefined();
  });

  it('verifies the RFC 3161 token inside a signature and reports B-T', async () => {
    const [result] = (await validatePdfSignatures(signatureTimestampPdf())).results;

    expect(result.status).toBe('valid');
    expect(result.warnings).toEqual([]);
    expect(result.checks.timestamp).toBe('passed');
    expect(result.padesLevel).toBe('B-T');
    expect(result.timestamp).toMatchObject({
      digestAlgorithm: 'SHA-256',
      policy: '1.2.3.4.1',
      serialNumber: expect.stringMatching(/^[0-9a-f]+$/),
    });
    expect(result.timestamp?.genTime.getUTCFullYear()).toBeGreaterThanOrEqual(2026);
    expect(result.timestamp?.authority?.subject).toBe('C=ES, O=Signora Test, CN=Signora Test TSA');
    expect(result.timestamp?.authority?.keyUsage).toEqual(['digitalSignature']);
  });

  it('keeps the signature valid but warns when its timestamp is corrupted', async () => {
    const pdf = await corruptContents(signatureTimestampPdf(), 0, 10);
    const [result] = (await validatePdfSignatures(pdf)).results;

    expect(result.status).toBe('valid');
    expect(result.checks.signature).toBe('passed');
    expect(result.checks.timestamp).toBe('failed');
    expect(result.warnings.map((w) => w.code)).toEqual(['TIMESTAMP_INVALID']);
    expect(result.padesLevel).toBe('B-B');
  });

  describe('document timestamps', () => {
    it('validates a signature followed by a document timestamp', async () => {
      const report = await validatePdfSignatures(documentTimestampPdf());
      const [signature, stamp] = report.results;

      expect(report.status).toBe('valid');
      expect(signature.status).toBe('valid');
      expect(signature.warnings.map((w) => w.code)).toEqual(['REVISIONS_AFTER_SIGNATURE']);

      expect(stamp.signature.kind).toBe('document-timestamp');
      expect(stamp.status).toBe('valid');
      expect(stamp.checks).toEqual({
        byteRange: 'passed',
        integrity: 'passed',
        signature: 'passed',
        certificateChain: 'not-evaluated',
        revocation: 'not-evaluated',
        timestamp: 'passed',
      });
      expect(stamp.timestamp?.authority?.subject).toContain('CN=Signora Test TSA');
      expect(stamp.signer?.subject).toContain('CN=Signora Test TSA');
      expect(stamp.padesLevel).toBeUndefined();
    });

    it('flags a change covered only by the document timestamp', async () => {
      const latin1 = Array.from(documentTimestampPdf(), (c) => String.fromCharCode(c)).join('');
      expect(latin1).toContain('DocTimeStamp1');
      const pdf = Uint8Array.from(latin1.replace('DocTimeStamp1', 'DocTimeStamp2'), (c) =>
        c.charCodeAt(0),
      );
      const report = await validatePdfSignatures(pdf);

      expect(report.results.map((r) => r.status)).toEqual(['valid', 'invalid']);
      expect(report.results[1].problems.map((p) => p.code)).toEqual(['DIGEST_MISMATCH']);
      expect(report.results[1].checks.timestamp).toBe('failed');
      expect(report.status).toBe('invalid');
    });

    it('flags a corrupted document timestamp token', async () => {
      const pdf = await corruptContents(documentTimestampPdf(), 1, 10);
      const [, stamp] = (await validatePdfSignatures(pdf)).results;
      expect(stamp.status).toBe('invalid');
      expect(stamp.problems.map((p) => p.code)).toEqual(['SIGNATURE_INVALID']);
      expect(stamp.checks).toMatchObject({ integrity: 'passed', signature: 'failed' });
    });

    it('rejects a document timestamp whose contents are not a token', async () => {
      const { pdf } = await buildSignatureFixture([{ name: 'TS', timestamp: true }]);
      const [stamp] = (await validatePdfSignatures(pdf)).results;
      expect(stamp.status).toBe('invalid');
      expect(stamp.problems.map((p) => p.code)).toEqual(['CMS_MALFORMED']);
    });
  });
});

describe('certificate chain', () => {
  const subjects = (path: readonly { subject: string }[] | undefined) =>
    path?.map((c) => /CN=([^,]+)/.exec(c.subject)?.[1]);
  const derOf = (pem: string) =>
    Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----|\s+/g, '')), (c) => c.charCodeAt(0));

  it('is not evaluated without trust anchors', async () => {
    const [result] = (await validatePdfSignatures(validRsaPdf())).results;
    expect(result.checks.certificateChain).toBe('not-evaluated');
    expect(result.chain).toBeUndefined();
    expect(result.warnings.map((w) => w.code)).not.toContain('REVOCATION_NOT_CHECKED');
  });

  it('trusts a signer that chains to an anchor, and says revocation was not checked', async () => {
    const report = await validatePdfSignatures(validRsaPdf(), { trustAnchors: [TEST_ROOT_CA_PEM] });
    const [result] = report.results;

    expect(result.status).toBe('valid');
    expect(result.checks.certificateChain).toBe('passed');
    expect(result.chain?.basis).toBe('validation-time');
    expect(subjects(result.chain?.path)).toEqual(['Ada Lovelace', 'Signora Test Root CA']);
    expect(result.warnings.map((w) => w.code)).toEqual(['REVOCATION_NOT_CHECKED']);
  });

  it('accepts anchors as DER bytes, several PEMs in one string, or the signer itself', async () => {
    const pdf = validRsaPdf();
    const viaDer = await validatePdfSignatures(pdf, { trustAnchors: [derOf(TEST_ROOT_CA_PEM)] });
    expect(viaDer.results[0].checks.certificateChain).toBe('passed');

    const several = await validatePdfSignatures(pdf, {
      trustAnchors: [`${UNRELATED_ROOT_CA_PEM}\n${TEST_ROOT_CA_PEM}`],
    });
    expect(several.results[0].checks.certificateChain).toBe('passed');

    const signer = viaDer.results[0].signer!;
    const direct = await validatePdfSignatures(pdf, { trustAnchors: [signer.der] });
    expect(direct.results[0].chain?.error).toBeUndefined();
    expect(direct.results[0].checks.certificateChain).toBe('passed');
    expect(direct.results[0].chain?.path).toHaveLength(1);

    const expired = await validatePdfSignatures(pdf, {
      trustAnchors: [signer.der],
      validationTime: new Date(Date.UTC(2040, 0, 1)),
    });
    expect(expired.results[0].checks.certificateChain).toBe('failed');
  });

  it('builds a path through an intermediate CA embedded in the signature', async () => {
    const [result] = (
      await validatePdfSignatures(viaIntermediatePdf(), { trustAnchors: [TEST_ROOT_CA_PEM] })
    ).results;
    expect(result.status).toBe('valid');
    expect(subjects(result.chain?.path)).toEqual([
      'Alan Turing',
      'Signora Test Intermediate CA',
      'Signora Test Root CA',
    ]);
  });

  it('marks a signer that does not chain to any anchor as indeterminate', async () => {
    const report = await validatePdfSignatures(validRsaPdf(), {
      trustAnchors: [UNRELATED_ROOT_CA_PEM],
    });
    const [result] = report.results;

    expect(report.status).toBe('indeterminate');
    expect(result.status).toBe('indeterminate');
    expect(result.problems.map((p) => p.code)).toEqual(['CERTIFICATE_CHAIN_INVALID']);
    expect(result.checks).toMatchObject({ signature: 'passed', certificateChain: 'failed' });
    expect(result.chain?.error).toBeTruthy();
    expect(result.padesLevel).toBeUndefined();
  });

  it('rejects a chain when the certificates are expired or not yet valid at the validation time', async () => {
    for (const year of [2040, 2020]) {
      const [result] = (
        await validatePdfSignatures(validRsaPdf(), {
          trustAnchors: [TEST_ROOT_CA_PEM],
          validationTime: new Date(Date.UTC(year, 0, 1)),
        })
      ).results;
      expect(result.checks.certificateChain).toBe('failed');
      expect(result.status).toBe('indeterminate');
    }
  });

  it('keeps a tampered signature invalid even when the chain is trusted', async () => {
    const pdf = validRsaPdf().slice();
    pdf[10] = pdf[10] ^ 0xff;
    const [result] = (await validatePdfSignatures(pdf, { trustAnchors: [TEST_ROOT_CA_PEM] }))
      .results;
    expect(result.status).toBe('invalid');
    expect(result.problems.map((p) => p.code)).toEqual(['DIGEST_MISMATCH']);
  });

  describe('with timestamps', () => {
    const both = [TEST_ROOT_CA_PEM, TEST_TSA_ROOT_CA_PEM];

    it('checks the signer at the time a trusted timestamp proves, not today', async () => {
      const [result] = (
        await validatePdfSignatures(signatureTimestampPdf(), {
          trustAnchors: both,
          validationTime: new Date(Date.UTC(2040, 0, 1)), // certificates have expired by then
        })
      ).results;

      expect(result.status).toBe('valid');
      expect(result.timestamp?.authorityChain).toBe('passed');
      expect(result.chain?.basis).toBe('timestamp');
      expect(result.chain?.checkedAt).toEqual(result.timestamp?.genTime);
      expect(result.padesLevel).toBe('B-T');
      expect(result.warnings.map((w) => w.code)).toEqual(['REVOCATION_NOT_CHECKED']);
    });

    it('does not use the time of a timestamp whose authority is not trusted', async () => {
      const [result] = (
        await validatePdfSignatures(signatureTimestampPdf(), {
          trustAnchors: [TEST_ROOT_CA_PEM],
          validationTime: new Date(Date.UTC(2040, 0, 1)),
        })
      ).results;

      expect(result.timestamp?.authorityChain).toBe('failed');
      expect(result.warnings.map((w) => w.code)).toContain('TIMESTAMP_AUTHORITY_NOT_TRUSTED');
      expect(result.chain?.basis).toBe('validation-time');
      expect(result.checks.certificateChain).toBe('failed'); // expired in 2040
      expect(result.status).toBe('indeterminate');
    });

    it('reports B-B, not B-T, when the timestamp authority is untrusted', async () => {
      const [result] = (
        await validatePdfSignatures(signatureTimestampPdf(), { trustAnchors: [TEST_ROOT_CA_PEM] })
      ).results;
      expect(result.status).toBe('valid');
      expect(result.padesLevel).toBe('B-B');
    });

    it('validates the authority of a document timestamp', async () => {
      const [, stamp] = (
        await validatePdfSignatures(documentTimestampPdf(), { trustAnchors: both })
      ).results;
      expect(stamp.status).toBe('valid');
      expect(stamp.checks.certificateChain).toBe('passed');
      expect(stamp.chain?.basis).toBe('timestamp');
      expect(subjects(stamp.chain?.path)).toEqual(['Signora Test TSA', 'Signora Test TSA Root CA']);
    });

    it('marks a document timestamp from an untrusted authority as indeterminate', async () => {
      const report = await validatePdfSignatures(documentTimestampPdf(), {
        trustAnchors: [TEST_ROOT_CA_PEM],
      });
      expect(report.results.map((r) => r.status)).toEqual(['valid', 'indeterminate']);
      expect(report.results[1].problems.map((p) => p.code)).toEqual(['CERTIFICATE_CHAIN_INVALID']);
      expect(report.status).toBe('indeterminate');
    });
  });

  describe('trust anchors that cannot be read', () => {
    it('throws instead of ignoring them', async () => {
      await expect(
        validatePdfSignatures(validRsaPdf(), { trustAnchors: ['not a certificate'] }),
      ).rejects.toBeInstanceOf(TrustAnchorError);
      await expect(
        validatePdfSignatures(validRsaPdf(), { trustAnchors: [new Uint8Array([1, 2, 3])] }),
      ).rejects.toBeInstanceOf(TrustAnchorError);
    });

    it('throws even when the PDF has no signatures', async () => {
      const { pdf } = await buildSignatureFixture([{ name: 'Pending', empty: true }]);
      await expect(validatePdfSignatures(pdf, { trustAnchors: ['x'] })).rejects.toBeInstanceOf(
        TrustAnchorError,
      );
    });
  });
});
