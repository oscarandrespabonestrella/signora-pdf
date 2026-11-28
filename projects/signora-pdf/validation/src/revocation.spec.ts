import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { formatValidationReport } from './report';
import {
  RevocationDataError,
  RevocationSources,
  httpRevocationFetcher,
  readRevocationAttribute,
  revocationUrls,
  type RevocationFetcher,
  type RevocationRequest,
} from './revocation';
import {
  LATEST_TIMESTAMP_TIME,
  REFERENCE_TIME,
  TEST_ROOT_CA_PEM,
  TEST_TSA_ROOT_CA_PEM,
  claimedBeforeCertificatePdf,
  crlClean,
  crlEarly,
  crlRevoked,
  crlRevokedAfter,
  crlShortLived,
  crlTsaClean,
  crlTsaRevoked,
  documentTimestampPdf,
  embeddedCrlPdf,
  embeddedOcspPdf,
  ocspDelegatedGood,
  ocspEarly,
  ocspGood,
  ocspMalloryRevoked,
  ocspRevoked,
  ocspRevokedAfter,
  ocspUnknown,
  revokedSignerPdf,
  signatureTimestampPdf,
  validEcPdf,
  validRsaPdf,
  viaIntermediatePdf,
} from './signed-fixtures.testing';
import { validatePdfSignatures, type ValidationOptions } from './validate-signatures';

const anchors = [TEST_ROOT_CA_PEM, TEST_TSA_ROOT_CA_PEM];
const run = (pdf: Uint8Array, extra: Partial<ValidationOptions> = {}) =>
  validatePdfSignatures(pdf, { trustAnchors: anchors, validationTime: REFERENCE_TIME, ...extra });
const first = async (pdf: Uint8Array, extra?: Partial<ValidationOptions>) =>
  (await run(pdf, extra)).results[0];
const codes = (items: readonly { code: string }[]) => items.map((i) => i.code);

/** Changes the last digit of the first time value (producedAt / thisUpdate): the signature no longer matches. */
function tamper(der: Uint8Array): Uint8Array {
  const text = Array.from(der, (c) => String.fromCharCode(c)).join('');
  const match = /\d{12,14}Z/.exec(text);
  if (!match) throw new Error('no time value found');
  const at = match.index + match[0].length - 2;
  const copy = der.slice();
  copy[at] = copy[at] === 0x39 ? 0x30 : copy[at] + 1;
  return copy;
}

describe('revocation', () => {
  describe('without evidence', () => {
    it('keeps a trusted chain valid, says revocation was not established and lists each certificate', async () => {
      const result = await first(validRsaPdf());
      expect(result.status).toBe('valid');
      expect(result.checks.revocation).toBe('not-evaluated');
      expect(codes(result.warnings)).toEqual(['REVOCATION_NOT_CHECKED']);
      expect(result.chain?.revocation?.map((r) => [r.subject, r.status])).toEqual([
        ['C=ES, O=Signora Test, CN=Ada Lovelace, emailAddress=ada@example.test', 'unknown'],
      ]);
      expect(result.chain?.revocation?.[0].message).toMatch(/No CRL or OCSP evidence/);
    });

    it("rejects the signature as indeterminate when revocation is 'require'", async () => {
      const result = await first(validRsaPdf(), { revocation: 'require' });
      expect(result.status).toBe('indeterminate');
      expect(codes(result.problems)).toEqual(['REVOCATION_UNKNOWN']);
      expect(result.checks).toMatchObject({ signature: 'passed', certificateChain: 'passed' });
    });

    it("skips revocation altogether when it is 'off'", async () => {
      const result = await first(validRsaPdf(), {
        revocation: 'off',
        revocationData: { crls: [crlRevoked()] }, // would revoke it
      });
      expect(result.status).toBe('valid');
      expect(result.checks.revocation).toBe('not-evaluated');
      expect(result.chain?.revocation).toBeUndefined();
      expect(result.warnings.map((w) => w.message)).toEqual([
        'The certificate chain was verified, but revocation checking is off.',
      ]);
    });

    it('is not evaluated without trust anchors, whatever evidence is given', async () => {
      const result = (
        await validatePdfSignatures(validRsaPdf(), {
          revocationData: { crls: [crlRevoked()] },
          validationTime: REFERENCE_TIME,
        })
      ).results[0];
      expect(result.status).toBe('valid');
      expect(result.checks.revocation).toBe('not-evaluated');
      expect(result.chain).toBeUndefined();
    });
  });

  describe('evidence you provide, as of the validation time', () => {
    it('accepts a CRL that does not list the certificate', async () => {
      const result = await first(validRsaPdf(), { revocationData: { crls: [crlClean()] } });
      expect(result.status).toBe('valid');
      expect(result.checks.revocation).toBe('passed');
      expect(result.warnings).toEqual([]);
      expect(result.chain?.revocation?.[0]).toMatchObject({
        status: 'good',
        source: 'crl',
        origin: 'provided',
      });
      expect(result.chain?.revocation?.[0].nextUpdate!.getTime()).toBeGreaterThan(
        result.chain!.revocation![0].thisUpdate!.getTime(),
      );
    });

    it('accepts an OCSP response that says good, from the CA or from a delegated responder', async () => {
      for (const response of [ocspGood(), ocspDelegatedGood()]) {
        const result = await first(validRsaPdf(), { revocationData: { ocsps: [response] } });
        expect(result.checks.revocation).toBe('passed');
        expect(result.chain?.revocation?.[0]).toMatchObject({ status: 'good', source: 'ocsp' });
      }
    });

    it.each([
      ['CRL', { crls: [crlRevoked()] }, 'crl'],
      ['OCSP response', { ocsps: [ocspRevoked()] }, 'ocsp'],
    ])('rejects a certificate that a %s says is revoked', async (_name, data, source) => {
      const result = await first(validRsaPdf(), { revocationData: data });
      expect(result.status).toBe('invalid');
      expect(codes(result.problems)).toEqual(['CERTIFICATE_REVOKED']);
      expect(result.checks).toMatchObject({ signature: 'passed', revocation: 'failed' });
      expect(result.chain?.revocation?.[0]).toMatchObject({
        status: 'revoked',
        source,
        reason: 'superseded',
      });
      expect(result.chain?.revocation?.[0].revokedAt?.toISOString()).toBe(
        '2026-01-01T00:00:00.000Z',
      );
      expect(result.chain?.error).toMatch(/revoked on 2026-01-01/);
    });

    it('rejects a revoked signer whose certificate chains fine', async () => {
      const result = await first(revokedSignerPdf(), {
        revocationData: { ocsps: [ocspMalloryRevoked()] },
      });
      expect(result.status).toBe('invalid');
      expect(result.chain?.revocation?.[0]).toMatchObject({
        status: 'revoked',
        reason: 'keyCompromise',
      });
      expect(result.checks.certificateChain).toBe('passed'.replace('passed', 'failed'));
    });

    it('treats a revocation dated after the time checked at as revoked when that time is now', async () => {
      // No trusted timestamp: the moment is the validation time, later than the revocation.
      const result = await first(validRsaPdf(), { revocationData: { crls: [crlRevokedAfter()] } });
      expect(result.status).toBe('invalid');
    });

    it('does not count an OCSP "unknown" answer or evidence about another certificate', async () => {
      // `ocspUnknown` is about Grace Hopper; it says nothing about Ada.
      const forAda = await first(validRsaPdf(), { revocationData: { ocsps: [ocspUnknown()] } });
      expect(forAda.chain?.revocation?.[0].status).toBe('unknown');
      // For Grace it answers "unknown": still not evidence.
      const forGrace = await first(validEcPdf(), { revocationData: { ocsps: [ocspUnknown()] } });
      expect(forGrace.chain?.revocation?.[0].status).toBe('unknown');
      expect(codes(forGrace.warnings)).toEqual(['REVOCATION_NOT_CHECKED']);
      // The OCSP response about Ada does not vouch for Grace either.
      const crossed = await first(validEcPdf(), { revocationData: { ocsps: [ocspGood()] } });
      expect(crossed.chain?.revocation?.[0].status).toBe('unknown');
    });

    it('ignores evidence whose signature does not verify', async () => {
      for (const data of [{ ocsps: [tamper(ocspRevoked())] }, { crls: [tamper(crlRevoked())] }]) {
        const result = await first(validRsaPdf(), { revocationData: data });
        expect(result.status).toBe('valid'); // not revoked: forged evidence cannot revoke
        expect(result.chain?.revocation?.[0].status).toBe('unknown');
      }
      // ...nor vouch for a certificate.
      const result = await first(validRsaPdf(), {
        revocationData: { ocsps: [tamper(ocspGood())] },
      });
      expect(result.chain?.revocation?.[0].status).toBe('unknown');
    });

    it('only uses evidence that is current at the validation time', async () => {
      // Issued after the moment we are validating at: it cannot say anything about it.
      const early = new Date('2026-03-01T00:00:00Z');
      const tooNew = await first(validRsaPdf(), {
        validationTime: early,
        revocationData: { crls: [crlClean()] },
      });
      expect(tooNew.chain?.revocation?.[0].status).toBe('unknown');
      // A CRL that already expired.
      const expired = await first(validRsaPdf(), {
        validationTime: new Date(REFERENCE_TIME.getTime() + 3 * 24 * 3600_000),
        revocationData: { crls: [crlShortLived()] },
      });
      expect(expired.chain?.revocation?.[0].status).toBe('unknown');
      // ...and the same CRL is fine while it is current.
      const current = await first(validRsaPdf(), {
        validationTime: new Date(REFERENCE_TIME.getTime() - 12 * 3600_000),
        revocationData: { crls: [crlShortLived()] },
      });
      expect(current.chain?.revocation?.[0].status).toBe('good');
    });

    it('reports each certificate of a longer chain on its own', async () => {
      // The root CA's CRL covers the intermediate CA, but not the signer the intermediate issued.
      const result = await first(viaIntermediatePdf(), { revocationData: { crls: [crlClean()] } });
      expect(result.status).toBe('valid');
      expect(
        result.chain?.revocation?.map((r) => [/CN=([^,]+)/.exec(r.subject)?.[1], r.status]),
      ).toEqual([
        ['Alan Turing', 'unknown'],
        ['Signora Test Intermediate CA', 'good'],
      ]);
      expect(result.checks.revocation).toBe('not-evaluated');
      expect(codes(result.warnings)).toEqual(['REVOCATION_NOT_CHECKED']);
      expect(result.warnings[0].message).toContain('Alan Turing');
    });

    it('throws for evidence that cannot be read, instead of ignoring it', async () => {
      await expect(
        run(validRsaPdf(), { revocationData: { crls: [new Uint8Array([1, 2, 3])] } }),
      ).rejects.toBeInstanceOf(RevocationDataError);
      await expect(
        run(validRsaPdf(), { revocationData: { ocsps: [new Uint8Array([1, 2, 3])] } }),
      ).rejects.toBeInstanceOf(RevocationDataError);
    });
  });

  describe('as of a trusted timestamp', () => {
    it('uses evidence issued after the timestamp, however long ago that was', async () => {
      const result = await first(signatureTimestampPdf(), {
        validationTime: new Date('2034-06-01T00:00:00Z'), // the certificates are still valid
        revocationData: { crls: [crlClean(), crlTsaClean()] },
      });
      expect(result.chain?.basis).toBe('timestamp');
      expect(result.status).toBe('valid');
      expect(result.checks.revocation).toBe('passed');
      expect(result.warnings).toEqual([]);
      expect(result.padesLevel).toBe('B-T');
    });

    it('rejects a signature whose certificate was revoked before the timestamp', async () => {
      const result = await first(signatureTimestampPdf(), {
        revocationData: { crls: [crlRevoked()] },
      });
      expect(result.status).toBe('invalid');
      expect(codes(result.problems)).toEqual(['CERTIFICATE_REVOKED']);
    });

    it('keeps the signature valid when the certificate was revoked after the timestamp', async () => {
      for (const data of [{ crls: [crlRevokedAfter()] }, { ocsps: [ocspRevokedAfter()] }]) {
        const result = await first(signatureTimestampPdf(), { revocationData: data });
        expect(result.status).toBe('valid');
        expect(codes(result.warnings)).toContain('CERTIFICATE_REVOKED_AFTER_SIGNING');
        const entry = result.chain!.revocation![0];
        expect(entry.status).toBe('good');
        expect(entry.revokedAt!.getTime()).toBe(LATEST_TIMESTAMP_TIME.getTime() + 1000);
        expect(entry.revokedAt!.getTime()).toBeGreaterThan(result.timestamp!.genTime.getTime());
      }
    });

    it('does not accept evidence issued before the timestamp', async () => {
      // It was made before the moment being proven: a later revocation would not show in it.
      const result = await first(signatureTimestampPdf(), {
        revocationData: { crls: [crlEarly()], ocsps: [ocspEarly()] },
      });
      expect(result.chain?.revocation?.[0].status).toBe('unknown');
      expect(codes(result.warnings)).toContain('REVOCATION_NOT_CHECKED');
    });
  });

  describe('timestamp authorities', () => {
    it('rejects a document timestamp from a revoked authority', async () => {
      const report = await run(documentTimestampPdf(), {
        revocationData: { crls: [crlClean(), crlTsaRevoked()] },
      });
      const [signature, stamp] = report.results;
      expect(signature.status).toBe('valid');
      expect(stamp.status).toBe('invalid');
      expect(codes(stamp.problems)).toEqual(['CERTIFICATE_REVOKED']);
      expect(stamp.chain?.revocation?.[0]).toMatchObject({
        status: 'revoked',
        reason: 'keyCompromise',
      });
      expect(report.status).toBe('invalid');
    });

    it('accepts one from an authority that is not revoked', async () => {
      const [signature, stamp] = (
        await run(documentTimestampPdf(), { revocationData: { crls: [crlClean(), crlTsaClean()] } })
      ).results;
      expect(signature.checks.revocation).toBe('passed');
      expect(stamp.status).toBe('valid');
      expect(stamp.checks.revocation).toBe('passed');
    });

    it('no longer trusts the time of a timestamp whose authority was revoked', async () => {
      const result = await first(signatureTimestampPdf(), {
        revocationData: { crls: [crlClean(), crlTsaRevoked()] },
      });
      expect(result.status).toBe('valid');
      expect(result.timestamp?.authorityChain).toBe('failed');
      expect(codes(result.warnings)).toContain('TIMESTAMP_AUTHORITY_NOT_TRUSTED');
      expect(result.padesLevel).toBe('B-B');
    });

    it("an authority without evidence is not trusted when revocation is 'require'", async () => {
      const result = await first(signatureTimestampPdf(), {
        revocation: 'require',
        revocationData: { crls: [crlClean()] }, // nothing about the authority
      });
      expect(result.timestamp?.authorityChain).toBe('failed');
      expect(result.status).toBe('valid');
      expect(result.padesLevel).toBe('B-B');
    });
  });

  describe('evidence embedded in the signature', () => {
    it('uses a CRL from the CMS crls field', async () => {
      const result = await first(embeddedCrlPdf());
      expect(result.status).toBe('valid');
      expect(result.checks.revocation).toBe('passed');
      expect(result.chain?.revocation?.[0]).toMatchObject({
        status: 'good',
        source: 'crl',
        origin: 'embedded',
      });
    });

    it('uses an OCSP response from a CAdES revocation-values attribute', async () => {
      const result = await first(embeddedOcspPdf());
      expect(result.checks.revocation).toBe('passed');
      expect(result.chain?.revocation?.[0]).toMatchObject({
        status: 'good',
        source: 'ocsp',
        origin: 'embedded',
      });
    });

    it('does not ask the fetcher when the signature already carries the evidence', async () => {
      const fetchRevocation = vi.fn();
      await first(embeddedCrlPdf(), { fetchRevocation });
      expect(fetchRevocation).not.toHaveBeenCalled();
    });

    it("reads Adobe's revocationInfoArchival and ETSI revocation values, tagged either way", () => {
      const sequence = (...items: unknown[]) => new asn1js.Sequence({ value: items as never });
      const tagged = (tag: number, ...items: unknown[]) =>
        new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: tag }, value: items as never });
      const crlAsn1 = pkijs.CertificateRevocationList.fromBER(
        crlClean() as Uint8Array<ArrayBuffer>,
      ).toSchema();
      const ocspAsn1 = pkijs.OCSPResponse.fromBER(ocspGood() as Uint8Array<ArrayBuffer>).toSchema();

      const explicit = sequence(tagged(0, sequence(crlAsn1)), tagged(1, sequence(ocspAsn1)));
      const implicit = sequence(tagged(0, crlAsn1), tagged(1, ocspAsn1));
      for (const attribute of [explicit, implicit]) {
        const sources = new RevocationSources();
        readRevocationAttribute(attribute, pkijs, sources);
        expect(sources.crls).toHaveLength(1);
        expect(sources.ocsps).toHaveLength(1);
        expect(sources.crls[0].origin).toBe('embedded');
      }

      // Garbage inside is skipped, not fatal.
      const broken = new RevocationSources();
      readRevocationAttribute(
        sequence(tagged(0, sequence(new asn1js.OctetString()))),
        pkijs,
        broken,
      );
      expect(broken.crls).toHaveLength(0);
    });
  });

  describe('fetching', () => {
    const calls: RevocationRequest[] = [];
    const serving =
      (answers: Partial<Record<'ocsp' | 'crl', () => Uint8Array | undefined>>): RevocationFetcher =>
      async (request) => {
        calls.push(request);
        return answers[request.kind]?.();
      };
    beforeEach(() => (calls.length = 0));

    it('reads the URLs a certificate names', async () => {
      const report = await run(validRsaPdf());
      const signer = report.results[0].signer!;
      const certificate = pkijs.Certificate.fromBER(signer.der as Uint8Array<ArrayBuffer>);
      expect(revocationUrls(certificate)).toEqual({
        ocsp: ['http://ocsp.example.test/ocsp'],
        crl: ['http://crl.example.test/root.crl'],
      });
    });

    it('asks OCSP first, and does not ask for the CRL once it is decided', async () => {
      const result = await first(validRsaPdf(), {
        fetchRevocation: serving({ ocsp: ocspGood, crl: crlClean }),
      });
      expect(calls.map((c) => [c.kind, c.url])).toEqual([
        ['ocsp', 'http://ocsp.example.test/ocsp'],
      ]);
      expect(result.chain?.revocation?.[0]).toMatchObject({
        status: 'good',
        source: 'ocsp',
        origin: 'fetched',
      });
      expect(result.checks.revocation).toBe('passed');

      // The request is a real OCSP request for this certificate.
      const request = pkijs.OCSPRequest.fromBER(calls[0].body as Uint8Array<ArrayBuffer>);
      const wanted = result.signer!.serialNumber;
      const asked = Array.from(
        new Uint8Array(
          request.tbsRequest.requestList[0].reqCert.serialNumber.valueBlock.valueHexView,
        ),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      expect(asked).toBe(wanted);
    });

    it('falls back to the CRL when OCSP gives nothing', async () => {
      const result = await first(validRsaPdf(), {
        fetchRevocation: serving({ crl: crlRevoked }),
      });
      expect(calls.map((c) => c.kind)).toEqual(['ocsp', 'crl']);
      expect(result.status).toBe('invalid');
      expect(result.chain?.revocation?.[0]).toMatchObject({
        status: 'revoked',
        source: 'crl',
        origin: 'fetched',
      });
    });

    it('treats a failing fetcher, or garbage from it, as no evidence', async () => {
      const failing = await first(validRsaPdf(), {
        fetchRevocation: async (request) => {
          calls.push(request);
          throw new Error('network down');
        },
      });
      expect(failing.status).toBe('valid');
      expect(codes(failing.warnings)).toEqual(['REVOCATION_NOT_CHECKED']);
      expect(calls.map((c) => c.kind)).toEqual(['ocsp', 'crl']);

      const garbage = await first(validRsaPdf(), {
        fetchRevocation: serving({
          ocsp: () => new Uint8Array([9, 9, 9]),
          crl: () => new Uint8Array([9]),
        }),
      });
      expect(garbage.chain?.revocation?.[0].status).toBe('unknown');
    });

    it('does not fetch when revocation is off, or without trust anchors', async () => {
      await first(validRsaPdf(), {
        revocation: 'off',
        fetchRevocation: serving({ ocsp: ocspGood }),
      });
      await validatePdfSignatures(validRsaPdf(), { fetchRevocation: serving({ ocsp: ocspGood }) });
      expect(calls).toEqual([]);
    });

    it('does not trust fetched evidence blindly: forged evidence is ignored like any other', async () => {
      const result = await first(validRsaPdf(), {
        fetchRevocation: serving({ ocsp: () => tamper(ocspGood()), crl: () => tamper(crlClean()) }),
      });
      expect(result.chain?.revocation?.[0].status).toBe('unknown');
    });

    it('fetches for the timestamp authority too, as of the token time', async () => {
      const result = await first(signatureTimestampPdf(), {
        fetchRevocation: serving({ crl: crlClean }),
      });
      // The signer's CRL is found; the authority's certificate names no responder, so it is unknown.
      expect(result.status).toBe('valid');
      expect(result.chain?.revocation?.[0].status).toBe('good');
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it('shows revocation in the text report', async () => {
    const report = await run(validRsaPdf(), { revocationData: { crls: [crlRevoked()] } });
    const text = formatValidationReport(report);
    expect(text).toContain('revocation: revoked (crl, provided)');
    expect(text).toContain('problem CERTIFICATE_REVOKED');
  });

  it('keeps a signature with a claimed time outside the certificate as it was', async () => {
    const result = await first(claimedBeforeCertificatePdf(), {
      revocationData: { crls: [crlClean()] },
    });
    expect(result.status).toBe('valid');
    expect(codes(result.warnings)).toEqual(['SIGNING_TIME_OUTSIDE_CERTIFICATE_VALIDITY']);
  });
});

describe('httpRevocationFetcher', () => {
  const answer = (body: Uint8Array, init: ResponseInit = {}) =>
    new Response(body.slice(), { status: 200, ...init });

  it('POSTs an OCSP request and GETs a CRL, and returns the bytes', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetcher = httpRevocationFetcher({
      fetch: (async (url: URL, init: RequestInit) => {
        seen.push({ url: String(url), init });
        return answer(new Uint8Array([1, 2, 3]));
      }) as typeof fetch,
    });
    const body = new Uint8Array([7, 7]);
    expect(await fetcher({ kind: 'ocsp', url: 'http://o.test/ocsp', body })).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(await fetcher({ kind: 'crl', url: 'https://c.test/a.crl' })).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    expect(seen[0].init.method).toBe('POST');
    expect((seen[0].init.headers as Record<string, string>)['content-type']).toBe(
      'application/ocsp-request',
    );
    expect(seen[0].init.body).toBe(body);
    expect(seen[1].init.method).toBe('GET');
    expect(seen[1].init.body).toBeUndefined();
  });

  it('refuses what is not allowed, and other schemes', async () => {
    const fetch = vi.fn(async () => answer(new Uint8Array([1])));
    const fetcher = httpRevocationFetcher({
      fetch: fetch as unknown as typeof globalThis.fetch,
      allow: (url) => url.hostname === 'ok.test',
    });
    expect(await fetcher({ kind: 'crl', url: 'http://169.254.169.254/latest' })).toBeUndefined();
    expect(await fetcher({ kind: 'crl', url: 'ldap://ok.test/crl' })).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(await fetcher({ kind: 'crl', url: 'http://ok.test/crl' })).toBeDefined();
  });

  it('gives nothing for error statuses and oversized bodies, and can rewrite URLs', async () => {
    const urls: string[] = [];
    const respond = vi.fn(async (url: URL) => {
      urls.push(String(url));
      return url.pathname === '/missing'
        ? answer(new Uint8Array([1]), { status: 404 })
        : answer(new Uint8Array(100));
    });
    const fetcher = httpRevocationFetcher({
      fetch: respond as unknown as typeof globalThis.fetch,
      maxBytes: 10,
      rewrite: (url) => url.replace('http://crl.test', 'https://proxy.test/p'),
    });
    expect(await fetcher({ kind: 'crl', url: 'http://crl.test/missing' })).toBeUndefined();
    expect(await fetcher({ kind: 'crl', url: 'http://crl.test/big' })).toBeUndefined();
    expect(urls[0]).toBe('https://proxy.test/p/missing');
  });
});
