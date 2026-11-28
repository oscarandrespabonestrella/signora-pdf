import { Injectable, InjectionToken, inject } from '@angular/core';
import {
  SIGNORA_SIGNATURE_VALIDATOR,
  createSignoraFeature,
  type CertificateChainInfo,
  type CertificateDetails,
  type DocumentValidationStatus,
  type LaterChangeKind,
  type LaterRevisions,
  type PadesLevel,
  type PdfSignatureInfo,
  type SignatureChecks,
  type SignatureIssue,
  type SignatureProblemCode,
  type SignatureValidationResult,
  type SignatureValidationStatus,
  type SignatureValidatorPort,
  type SignatureWarningCode,
  type SignoraFeature,
  type TimestampDetails,
  type ValidationReport,
} from 'signora-pdf';
import { fromHex, sameBytes, toHex, trimDer } from './bytes';
import { DIGEST_OIDS, describeSignatureAlgorithm } from './certificate-details';
import {
  digest,
  embeddedCertificates,
  findSigner,
  parseSignedData,
  signatureValue,
  type CmsContext,
} from './cms';
import { inspectPdfSignatures } from './inspect-signatures';
import { LaterRevisionsAnalyzer } from './revisions';
import { promoteToArchival, readValidationStore, type ValidationStore } from './ltv';
import {
  RevocationSources,
  extractEmbeddedRevocation,
  sourcesFromData,
  type RevocationData,
  type RevocationFetcher,
  type RevocationMode,
} from './revocation';
import { SIGNATURE_TIMESTAMP_OID, validateTimestampToken } from './timestamp';
import {
  evaluateChain,
  parseTrustAnchors,
  type ChainEvaluation,
  type TrustAnchorInput,
} from './trust';

/** Options of {@link validatePdfSignatures}. */
export interface ValidationOptions {
  /** WebCrypto implementation. Defaults to `globalThis.crypto` (browsers and Node 20+). */
  readonly crypto?: Crypto;
  /**
   * Certificates (DER bytes, or PEM strings) that you trust. When given, the signer of every
   * signature and the authority of every timestamp must chain to one of them, or the signature
   * is `indeterminate` with `CERTIFICATE_CHAIN_INVALID`. Without anchors the chain is not
   * evaluated (`checks.certificateChain` is `not-evaluated`).
   *
   * Signora ships no trust list: you decide whom to trust (a national trusted list, your CA...).
   *
   * @throws {TrustAnchorError} from `validatePdfSignatures` if an anchor cannot be read.
   */
  readonly trustAnchors?: readonly TrustAnchorInput[];
  /**
   * The moment certificates must be valid at when the signature has no trusted timestamp.
   * Defaults to now. With a valid timestamp from a trusted authority, its time is used instead.
   */
  readonly validationTime?: Date;
  /**
   * What to do about revocation once a chain is trusted (only with `trustAnchors`):
   * `'if-available'` (default) uses the CRL and OCSP evidence it can find, `'require'` rejects a
   * certificate without usable evidence, `'off'` ignores revocation.
   *
   * Evidence comes from the signature itself (CMS `crls`, `adbe-revocationInfoArchival`, CAdES
   * `revocation-values`), from `revocationData`, and from `fetchRevocation`. Evidence is only
   * used if its issuer verifies and it is recent enough for the moment checked: with a trusted
   * timestamp it must have been issued after the timestamp, otherwise it must be current.
   */
  readonly revocation?: RevocationMode;
  /** CRLs and OCSP responses you already have (for example read from the PDF's DSS). */
  readonly revocationData?: RevocationData;
  /**
   * Fetches CRLs and OCSP responses the certificates point to. Signora never fetches by itself.
   * See {@link httpRevocationFetcher}, and mind SSRF on a server.
   */
  readonly fetchRevocation?: RevocationFetcher;
}

/** Injection token holding the {@link ValidationOptions}. Set by {@link withPdfSignatureValidation}. */
export const SIGNORA_VALIDATION_OPTIONS = new InjectionToken<ValidationOptions>(
  'SIGNORA_VALIDATION_OPTIONS',
  { factory: () => ({}) },
);

const SUPPORTED_SUB_FILTERS = new Set([
  'adbe.pkcs7.detached',
  'ETSI.CAdES.detached',
  'ETSI.RFC3161',
]);
const MESSAGE_DIGEST_OID = '1.2.840.113549.1.9.4';
/** `signing-certificate` (SHA-1) and `signing-certificate-v2` attributes: what makes CAdES baseline B-B. */
const SIGNING_CERTIFICATE_OIDS = new Set([
  '1.2.840.113549.1.9.16.2.12',
  '1.2.840.113549.1.9.16.2.47',
]);

/** Problems that make the signature `invalid`; any other problem leaves it `indeterminate`. */
const INVALID_CODES: ReadonlySet<SignatureProblemCode> = new Set([
  'BYTE_RANGE_MALFORMED',
  'CONTENTS_MISSING',
  'CMS_MALFORMED',
  'DIGEST_MISMATCH',
  'SIGNATURE_INVALID',
  'CERTIFICATE_REVOKED',
  'CHANGES_NOT_PERMITTED',
]);

/** Later changes that nothing about a signature explains: what a page shows, or what is not recognized. */
const UNEXPECTED_CHANGES: ReadonlySet<LaterChangeKind> = new Set([
  'page-content',
  'page-structure',
  'other',
]);

/**
 * Checks every digital signature of a PDF: that the signed bytes still hash to what the signer
 * committed to, that the signature verifies with the signer's certificate, what that certificate
 * says, and any RFC 3161 timestamp (embedded in the signature, or a document timestamp). Supports
 * `adbe.pkcs7.detached`, `ETSI.CAdES.detached` (PAdES) and `ETSI.RFC3161` signatures made with RSA
 * or ECDSA. The PDF is only read.
 *
 * A `valid` result means the signature is intact. It means the signer is trusted only if you
 * passed `trustAnchors` (see {@link ValidationOptions}); otherwise the certificate chain is
 * reported as `not-evaluated`. With anchors, revocation is checked too (CRL and OCSP evidence from the
 * signature, the document's DSS, `revocationData` or `fetchRevocation`; see {@link ValidationOptions}),
 * and the PAdES level (B-B to B-LTA) is reported. Requires the optional peer dependencies `pdf-lib`,
 * `pkijs` and `asn1js`.
 *
 * @throws {PdfInspectionError} if the bytes are not a readable PDF.
 * @throws {TrustAnchorError} if a trust anchor is not a readable certificate.
 */
export async function validatePdfSignatures(
  pdf: Uint8Array,
  options: ValidationOptions = {},
): Promise<ValidationReport> {
  const crypto = options.crypto ?? globalThis.crypto;
  const signatures = await inspectPdfSignatures(pdf);
  const documentSha256 = toHex(await digest(crypto, 'SHA-256', pdf));
  const signed = signatures.filter((s) => s.signed);

  let results: SignatureValidationResult[] = [];
  let store: ValidationStore | undefined;
  const wantsTrust =
    (options.trustAnchors?.length ?? 0) > 0 ||
    (options.revocationData?.crls?.length ?? 0) + (options.revocationData?.ocsps?.length ?? 0) > 0;
  if (signed.length > 0 || wantsTrust) {
    const [pkijs, asn1js] = await Promise.all([import('pkijs'), import('asn1js')]);
    store = await readValidationStore(pdf, pkijs);
    const context: CmsContext = {
      pkijs,
      asn1js,
      crypto,
      engine: new pkijs.CryptoEngine({ name: 'signora', crypto }),
      anchors: parseTrustAnchors(options.trustAnchors ?? [], pkijs),
      validationTime: options.validationTime ?? new Date(),
      revocation: {
        mode: options.revocation ?? 'if-available',
        provided: options.revocationData
          ? sourcesFromData(options.revocationData, pkijs)
          : new RevocationSources(),
        dss: store?.sources ?? new RevocationSources(),
        fetcher: options.fetchRevocation,
        cache: new Map(),
      },
      dssCertificates: store?.certificates ?? [],
      later: new LaterRevisionsAnalyzer(pdf),
    };
    for (const signature of signed) results.push(await validateOne(pdf, signature, context));
    results = await promoteToArchival(pdf, results, store);
  }

  return {
    generatedAt: new Date(),
    documentSha256,
    status: overallStatus(results),
    results,
    unsignedFields: signatures.filter((s) => !s.signed).map((s) => s.fieldName),
    ...(store ? { dss: store.summary } : {}),
  };
}

function overallStatus(results: readonly SignatureValidationResult[]): DocumentValidationStatus {
  if (results.length === 0) return 'no-signatures';
  if (results.some((r) => r.status === 'invalid')) return 'invalid';
  if (results.some((r) => r.status === 'indeterminate')) return 'indeterminate';
  return 'valid';
}

type Warning = SignatureIssue<SignatureWarningCode>;

async function validateOne(
  pdf: Uint8Array,
  signature: PdfSignatureInfo,
  context: CmsContext,
): Promise<SignatureValidationResult> {
  const problems: SignatureIssue<SignatureProblemCode>[] = [];
  const warnings: Warning[] = [];
  const checks: { -readonly [K in keyof SignatureChecks]: SignatureChecks[K] } = {
    byteRange: 'not-evaluated',
    integrity: 'not-evaluated',
    signature: 'not-evaluated',
    certificateChain: 'not-evaluated',
    revocation: 'not-evaluated',
    timestamp: 'not-evaluated',
  };
  let certificates: readonly CertificateDetails[] = [];
  let signer: CertificateDetails | undefined;
  let digestAlgorithm: string | undefined;
  let signatureAlgorithm: string | undefined;
  let timestamp: TimestampDetails | undefined;
  let padesLevel: PadesLevel | undefined;
  let chain: CertificateChainInfo | undefined;
  let laterRevisions: LaterRevisions | undefined;

  const problem = (code: SignatureProblemCode, message: string) => problems.push({ code, message });
  const applyChain = (
    evaluation: ChainEvaluation,
    checkedAt: Date,
    basis: CertificateChainInfo['basis'],
  ) => {
    if (evaluation.outcome === 'not-evaluated') return;
    checks.certificateChain = evaluation.outcome;
    chain = {
      checkedAt,
      basis,
      path: evaluation.path,
      error: evaluation.error,
      revocation: evaluation.revocation,
    };
    if (evaluation.revoked) {
      checks.revocation = 'failed';
      problem('CERTIFICATE_REVOKED', evaluation.error ?? 'A certificate of the chain was revoked.');
      return;
    }
    if (evaluation.outcome === 'failed') {
      problem(
        'CERTIFICATE_CHAIN_INVALID',
        `The certificate does not chain to a trust anchor: ${evaluation.error}`,
      );
      return;
    }
    if (context.revocation.mode === 'off') {
      warnings.push({
        code: 'REVOCATION_NOT_CHECKED',
        message: 'The certificate chain was verified, but revocation checking is off.',
      });
      return;
    }
    checks.revocation = evaluation.revocationOutcome ?? 'not-evaluated';
    if (checks.revocation === 'not-evaluated') {
      const unknown = (evaluation.revocation ?? [])
        .filter((entry) => entry.status === 'unknown')
        .map((entry) => entry.subject)
        .join('; ');
      const message = `No usable CRL or OCSP evidence for: ${unknown || 'the chain'}.`;
      if (context.revocation.mode === 'require') problem('REVOCATION_UNKNOWN', message);
      else warnings.push({ code: 'REVOCATION_NOT_CHECKED', message });
    }
    if (evaluation.revokedLater) {
      warnings.push({
        code: 'CERTIFICATE_REVOKED_AFTER_SIGNING',
        message: 'A certificate was revoked, but after the moment it is checked at.',
      });
    }
  };
  const finish = (): SignatureValidationResult => ({
    signature,
    status: statusOf(problems),
    checks,
    problems,
    warnings,
    signer,
    certificates,
    digestAlgorithm,
    signatureAlgorithm,
    timestamp,
    chain,
    laterRevisions,
    padesLevel: problems.length === 0 ? padesLevel : undefined,
  });

  try {
    const isTimestamp = signature.kind === 'document-timestamp';
    if (
      !signature.subFilter ||
      !SUPPORTED_SUB_FILTERS.has(signature.subFilter) ||
      isTimestamp !== (signature.subFilter === 'ETSI.RFC3161')
    ) {
      problem(
        'UNSUPPORTED_SUBFILTER',
        `Signature format "${signature.subFilter ?? 'none'}" is not supported.`,
      );
      return finish();
    }

    // 1. The byte range must be consistent with the file and with /Contents.
    const range = signature.byteRange;
    if (!range || !signature.byteRangeWellFormed) {
      checks.byteRange = 'failed';
      problem('BYTE_RANGE_MALFORMED', 'The /ByteRange does not match the structure of the file.');
      return finish();
    }
    const [, length1, start2, length2] = range;
    const embedded = fromHex(
      new TextDecoder('latin1').decode(pdf.subarray(length1 + 1, start2 - 1)),
    );
    if (!embedded || !signature.contents || !sameBytes(trimDer(embedded), signature.contents)) {
      checks.byteRange = 'failed';
      problem('BYTE_RANGE_MALFORMED', 'The gap in /ByteRange is not the signature in /Contents.');
      return finish();
    }
    checks.byteRange = 'passed';

    const covered = new Uint8Array(length1 + length2);
    covered.set(pdf.subarray(0, length1), 0);
    covered.set(pdf.subarray(start2, start2 + length2), length1);

    if (signature.coversWholeDocument === false) {
      warnings.push({
        code: 'REVISIONS_AFTER_SIGNATURE',
        message:
          'The file has content after the signed bytes (a later revision or an appended change).',
      });
      // What changed: a second signature, a timestamp or DSS are expected; the rest is not.
      const later = await context.later.analyze(range[2] + range[3], signature.fieldName);
      if (later) {
        laterRevisions = later;
        const kinds = (changes: readonly { kind: string }[]) =>
          [...new Set(changes.map((c) => c.kind))].join(', ');
        if (!later.permitted) {
          problem(
            'CHANGES_NOT_PERMITTED',
            `The document was changed after it was signed in a way its author did not permit: ${kinds(later.forbidden)}.`,
          );
        } else if (later.changes.some((c) => UNEXPECTED_CHANGES.has(c.kind))) {
          warnings.push({
            code: 'CONTENT_CHANGED_AFTER_SIGNING',
            message: `The signed revision is intact, but the document changed afterwards (${kinds(later.changes.filter((c) => UNEXPECTED_CHANGES.has(c.kind)))}).`,
          });
        }
      }
    }

    // 2. A document timestamp is a bare token over the signed ranges.
    if (isTimestamp) {
      const token = await validateTimestampToken(trimDer(embedded), covered, context);
      problems.push(...token.problems);
      certificates = token.certificates;
      timestamp = token.details;
      signer = token.details?.authority;
      digestAlgorithm = token.details?.digestAlgorithm;
      checks.integrity = token.imprint;
      checks.signature = token.signature;
      checks.timestamp = timestampOutcome(token.imprint, token.signature);
      if (!token.authorityMayTimestamp) warnings.push(notForTimestamping());
      if (token.details) applyChain(token.chain, token.details.genTime, 'timestamp');
      return finish();
    }

    // 3. Parse the CMS container.
    const signedData = parseSignedData(trimDer(embedded), context);
    if (!signedData) {
      problem('CMS_MALFORMED', 'The signature container is not a readable CMS SignedData.');
      return finish();
    }
    if (signedData.signerInfos.length !== 1) {
      problem('CMS_MALFORMED', 'A PDF signature must have exactly one signer.');
      return finish();
    }
    const signerInfo = signedData.signerInfos[0];

    const { parsed, details } = await embeddedCertificates(signedData, context);
    certificates = details;
    const signerIndex = findSigner(parsed, signerInfo, context);
    if (signerIndex >= 0) signer = certificates[signerIndex];

    const digestOid = signerInfo.digestAlgorithm.algorithmId;
    const known = DIGEST_OIDS[digestOid];
    digestAlgorithm = known?.name ?? digestOid;
    signatureAlgorithm = describeSignatureAlgorithm(
      signerInfo.signatureAlgorithm.algorithmId,
      known?.name,
    );
    if (!known) {
      problem('UNSUPPORTED_ALGORITHM', `Digest algorithm ${digestOid} is not supported.`);
      return finish();
    }
    if (known.name === 'SHA-1') {
      warnings.push({
        code: 'WEAK_DIGEST_ALGORITHM',
        message: 'The signature uses SHA-1, which is no longer considered collision resistant.',
      });
    }
    if (signerIndex < 0) {
      problem(
        'SIGNER_CERTIFICATE_MISSING',
        'The signer certificate is not embedded in the signature.',
      );
      return finish();
    }

    // 4. Integrity: do the signed bytes still hash to the committed digest?
    const committed = signerInfo.signedAttrs?.attributes.find((a) => a.type === MESSAGE_DIGEST_OID)
      ?.values[0] as { valueBlock?: { valueHexView?: Uint8Array } } | undefined;
    const committedBytes = committed?.valueBlock?.valueHexView;
    let integrityBroken = false;
    if (committedBytes) {
      const actual = await digest(context.crypto, known.webCrypto, covered);
      if (sameBytes(actual, new Uint8Array(committedBytes))) {
        checks.integrity = 'passed';
      } else {
        checks.integrity = 'failed';
        integrityBroken = true;
        problem('DIGEST_MISMATCH', 'The document was changed after it was signed.');
      }
    }

    // 5. The signature itself, with the signer certificate's public key.
    if (!integrityBroken) {
      try {
        const result = await signedData.verify(
          { signer: 0, data: covered.buffer as ArrayBuffer, extendedMode: true },
          context.engine,
        );
        if (result.signatureVerified) {
          checks.signature = 'passed';
          if (!committedBytes) checks.integrity = 'passed';
        } else {
          checks.signature = 'failed';
          if (!committedBytes) checks.integrity = 'failed';
          problem(
            'SIGNATURE_INVALID',
            'The signature does not verify with the signer certificate.',
          );
        }
      } catch (error) {
        const verified = (error as { signatureVerified?: boolean | null }).signatureVerified;
        if (verified === false) {
          checks.signature = 'failed';
          if (!committedBytes) checks.integrity = 'failed';
          problem(
            'SIGNATURE_INVALID',
            'The signature does not verify with the signer certificate.',
          );
        } else {
          problem(
            'VALIDATION_ERROR',
            error instanceof Error ? error.message : 'The signature could not be verified.',
          );
        }
      }
    }

    // 6. A timestamp inside the signature proves the signature existed at that time.
    const stamp = signerInfo.unsignedAttrs?.attributes.find(
      (a) => a.type === SIGNATURE_TIMESTAMP_OID,
    );
    if (stamp) {
      try {
        const der = new Uint8Array((stamp.values[0] as { toBER(): ArrayBuffer }).toBER());
        const token = await validateTimestampToken(der, signatureValue(signerInfo), context);
        timestamp = token.details;
        checks.timestamp = timestampOutcome(token.imprint, token.signature);
        if (checks.timestamp !== 'passed') {
          warnings.push({
            code: 'TIMESTAMP_INVALID',
            message: `The signature timestamp does not verify: ${token.problems.map((p) => p.message).join(' ')}`,
          });
        }
        if (!token.authorityMayTimestamp) warnings.push(notForTimestamping());
      } catch {
        checks.timestamp = 'failed';
        warnings.push({
          code: 'TIMESTAMP_INVALID',
          message: 'The signature timestamp is not readable.',
        });
      }
    }

    // 7. Is the signer trusted? Checked as of the time a trusted timestamp proves, if any.
    if (timestamp?.authorityChain === 'failed') {
      warnings.push({
        code: 'TIMESTAMP_AUTHORITY_NOT_TRUSTED',
        message: 'The timestamp authority does not chain to a trust anchor.',
      });
    }
    const trustedStamp = checks.timestamp === 'passed' && timestamp?.authorityChain === 'passed';
    const chainTime = trustedStamp && timestamp ? timestamp.genTime : context.validationTime;
    applyChain(
      await evaluateChain(
        parsed[signerIndex],
        [...parsed, ...context.dssCertificates],
        chainTime,
        trustedStamp ? 'timestamp' : 'validation-time',
        extractEmbeddedRevocation(signedData, context.pkijs),
        context,
      ),
      chainTime,
      trustedStamp ? 'timestamp' : 'validation-time',
    );

    // 8. Things worth knowing that do not break the signature.
    if (signer) {
      const time = signature.signingTime;
      if (time && (time < signer.notBefore || time > signer.notAfter)) {
        warnings.push({
          code: 'SIGNING_TIME_OUTSIDE_CERTIFICATE_VALIDITY',
          message: 'The claimed signing time is outside the validity period of the certificate.',
        });
      }
      const usage = signer.keyUsage;
      if (
        usage.length > 0 &&
        !usage.includes('digitalSignature') &&
        !usage.includes('nonRepudiation')
      ) {
        warnings.push({
          code: 'CERTIFICATE_KEY_USAGE_NOT_FOR_SIGNING',
          message: 'The certificate key usage does not allow digital signatures.',
        });
      }
    }

    // 9. PAdES baseline level the signature evidences.
    if (
      signature.subFilter === 'ETSI.CAdES.detached' &&
      signerInfo.signedAttrs?.attributes.some((a) => SIGNING_CERTIFICATE_OIDS.has(a.type))
    ) {
      padesLevel =
        checks.timestamp === 'passed' && timestamp?.authorityChain !== 'failed' ? 'B-T' : 'B-B';
      // B-LT: a trusted timestamp, and revocation evidence for the whole chain that the signature or
      // the document itself carries (evidence you provided or fetched does not make it long-term).
      if (
        padesLevel === 'B-T' &&
        context.anchors.length > 0 &&
        timestamp?.authorityChain === 'passed' &&
        checks.certificateChain === 'passed' &&
        checks.revocation === 'passed' &&
        (chain?.revocation?.length ?? 0) > 0 &&
        chain!.revocation!.every((entry) => entry.origin === 'embedded' || entry.origin === 'dss')
      ) {
        padesLevel = 'B-LT';
      }
    }
  } catch (error) {
    problem('VALIDATION_ERROR', error instanceof Error ? error.message : 'Validation failed.');
  }
  return finish();
}

function timestampOutcome(
  imprint: SignatureChecks['timestamp'],
  signature: SignatureChecks['timestamp'],
): SignatureChecks['timestamp'] {
  if (imprint === 'passed' && signature === 'passed') return 'passed';
  return imprint === 'failed' || signature === 'failed' ? 'failed' : 'not-evaluated';
}

function notForTimestamping(): Warning {
  return {
    code: 'TIMESTAMP_CERTIFICATE_NOT_FOR_TIMESTAMPING',
    message: 'The timestamp authority certificate does not have the timeStamping usage.',
  };
}

function statusOf(
  problems: readonly SignatureIssue<SignatureProblemCode>[],
): SignatureValidationStatus {
  if (problems.length === 0) return 'valid';
  return problems.some((p) => INVALID_CODES.has(p.code)) ? 'invalid' : 'indeterminate';
}

/** {@link SignatureValidatorPort} built on {@link validatePdfSignatures}. */
@Injectable()
export class PkijsSignatureValidator implements SignatureValidatorPort {
  private readonly options = inject(SIGNORA_VALIDATION_OPTIONS);

  validate(pdf: Uint8Array): Promise<ValidationReport> {
    return validatePdfSignatures(pdf, this.options);
  }
}

/** Validates existing signatures with PKI.js. Requires `pkijs`, `asn1js` and `pdf-lib`. */
export function withPdfSignatureValidation(options: ValidationOptions = {}): SignoraFeature {
  return createSignoraFeature('signature-validator', [
    { provide: SIGNORA_VALIDATION_OPTIONS, useValue: options },
    { provide: SIGNORA_SIGNATURE_VALIDATOR, useClass: PkijsSignatureValidator },
  ]);
}
