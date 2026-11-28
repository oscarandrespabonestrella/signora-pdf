import type {
  CertificateDetails,
  CheckOutcome,
  SignatureIssue,
  SignatureProblemCode,
  TimestampDetails,
} from 'signora-pdf';
import { sameBytes, toHex } from './bytes';
import { DIGEST_OIDS } from './certificate-details';
import { digest, embeddedCertificates, findSigner, parseSignedData, type CmsContext } from './cms';
import { extractEmbeddedRevocation } from './revocation';
import { evaluateChain, type ChainEvaluation } from './trust';

/** `id-ct-TSTInfo`: what a timestamp token signs. */
const TST_INFO_OID = '1.2.840.113549.1.9.16.1.4';
const TIME_STAMPING_EKU = '1.3.6.1.5.5.7.3.8';
/** Unsigned attribute of a CMS signature that carries an RFC 3161 token (`id-aa-signatureTimeStampToken`). */
export const SIGNATURE_TIMESTAMP_OID = '1.2.840.113549.1.9.16.2.14';

/** What checking one timestamp token found. */
export interface TokenValidation {
  /** Present whenever the token could be read, even if it did not verify. */
  readonly details?: TimestampDetails;
  /** Every certificate embedded in the token. */
  readonly certificates: readonly CertificateDetails[];
  /** The token's hash of the stamped data equals the hash computed here. */
  readonly imprint: CheckOutcome;
  /** The token is signed by the certificate it names. */
  readonly signature: CheckOutcome;
  /** The authority's certificate checked against the trust anchors as of `genTime`. */
  readonly chain: ChainEvaluation;
  /** `true` when the authority certificate carries the `timeStamping` usage (or has none to check). */
  readonly authorityMayTimestamp: boolean;
  readonly problems: readonly SignatureIssue<SignatureProblemCode>[];
}

/**
 * Checks an RFC 3161 timestamp token (a CMS `SignedData` over a `TSTInfo`): that it hashes
 * `stamped` to the value it committed to and that the authority really signed it. Whether the
 * authority is trusted is evaluated only when trust anchors were given.
 *
 * @param stamped the exact bytes the token must cover (a signature value, or the signed ranges of a document).
 */
export async function validateTimestampToken(
  der: Uint8Array,
  stamped: Uint8Array,
  context: CmsContext,
): Promise<TokenValidation> {
  const problems: SignatureIssue<SignatureProblemCode>[] = [];
  const fail = (code: SignatureProblemCode, message: string): TokenValidation => ({
    certificates: [],
    imprint: 'not-evaluated',
    signature: 'not-evaluated',
    authorityMayTimestamp: true,
    chain: { outcome: 'not-evaluated', path: [] },
    problems: [{ code, message }],
  });

  const { pkijs } = context;
  const signedData = parseSignedData(der, context);
  if (!signedData) return fail('CMS_MALFORMED', 'The timestamp is not a readable CMS SignedData.');
  if (signedData.encapContentInfo.eContentType !== TST_INFO_OID) {
    return fail('CMS_MALFORMED', 'The timestamp does not contain a TSTInfo.');
  }
  const content = signedData.encapContentInfo.eContent;
  if (!content || signedData.signerInfos.length !== 1) {
    return fail('CMS_MALFORMED', 'The timestamp must hold one TSTInfo and one signer.');
  }

  let info: InstanceType<typeof pkijs.TSTInfo>;
  try {
    info = pkijs.TSTInfo.fromBER(new Uint8Array(content.valueBlock.valueHexView));
  } catch {
    return fail('CMS_MALFORMED', 'The timestamp TSTInfo is not readable.');
  }

  const { parsed, details: certificates } = await embeddedCertificates(signedData, context);
  const signerInfo = signedData.signerInfos[0];
  const signerIndex = findSigner(parsed, signerInfo, context);
  const authority = signerIndex >= 0 ? certificates[signerIndex] : undefined;

  let chain: ChainEvaluation = authority
    ? await evaluateChain(
        parsed[signerIndex],
        [...parsed, ...context.dssCertificates],
        info.genTime,
        'timestamp',
        extractEmbeddedRevocation(signedData, pkijs),
        context,
      )
    : { outcome: 'not-evaluated', path: [] };

  if (
    chain.outcome === 'passed' &&
    context.revocation.mode === 'require' &&
    chain.revocationOutcome === 'not-evaluated'
  ) {
    // Revocation was required and the authority has no usable evidence: it cannot be trusted.
    chain = {
      ...chain,
      outcome: 'failed',
      error: 'Revocation of the timestamp authority is unknown.',
    };
  }

  const hashOid = info.messageImprint.hashAlgorithm.algorithmId;
  const known = DIGEST_OIDS[hashOid];
  const details: TimestampDetails = {
    genTime: info.genTime,
    digestAlgorithm: known?.name ?? hashOid,
    policy: info.policy,
    serialNumber: toHex(new Uint8Array(info.serialNumber.valueBlock.valueHexView)),
    authority,
    authorityChain: chain.outcome,
  };
  const result = (patch: Partial<TokenValidation>): TokenValidation => ({
    details,
    certificates,
    imprint: 'not-evaluated',
    signature: 'not-evaluated',
    authorityMayTimestamp: true,
    chain,
    problems,
    ...patch,
  });

  if (!known) {
    problems.push({
      code: 'UNSUPPORTED_ALGORITHM',
      message: `Timestamp hash algorithm ${hashOid} is not supported.`,
    });
    return result({});
  }
  if (!authority) {
    problems.push({
      code: 'SIGNER_CERTIFICATE_MISSING',
      message: 'The timestamp authority certificate is not embedded in the token.',
    });
    return result({});
  }

  // The token must cover exactly these bytes.
  const actual = await digest(context.crypto, known.webCrypto, stamped);
  const wanted = new Uint8Array(info.messageImprint.hashedMessage.valueBlock.valueHexView);
  const imprint: CheckOutcome = sameBytes(actual, wanted) ? 'passed' : 'failed';
  if (imprint === 'failed') {
    problems.push({
      code: 'DIGEST_MISMATCH',
      message: 'The timestamp does not cover these bytes: they changed after it was issued.',
    });
  }

  // The authority must have signed the token. PKI.js re-checks the imprint itself for a TSTInfo,
  // so with a broken imprint the signature cannot be told apart: it is left unevaluated.
  if (imprint === 'failed') return result({ imprint });
  let signature: CheckOutcome = 'failed';
  try {
    const verified = await signedData.verify(
      { signer: 0, data: stamped.slice().buffer, extendedMode: true },
      context.engine,
    );
    if (verified.signatureVerified) signature = 'passed';
  } catch (error) {
    const verified = (error as { signatureVerified?: boolean | null }).signatureVerified;
    if (verified !== false) {
      problems.push({
        code: 'VALIDATION_ERROR',
        message: error instanceof Error ? error.message : 'The timestamp could not be verified.',
      });
      return result({ imprint });
    }
  }
  if (signature === 'failed') {
    problems.push({
      code: 'SIGNATURE_INVALID',
      message: 'The timestamp signature does not verify with the authority certificate.',
    });
  }

  const eku = parsed[signerIndex].extensions?.find((e) => e.extnID === '2.5.29.37')?.parsedValue as
    { keyPurposes?: string[] } | undefined;
  const authorityMayTimestamp = !eku?.keyPurposes || eku.keyPurposes.includes(TIME_STAMPING_EKU);

  return result({ imprint, signature, authorityMayTimestamp });
}
