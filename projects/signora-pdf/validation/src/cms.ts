import type { CertificateDetails } from 'signora-pdf';
import type * as Pkijs from 'pkijs';
import { sameBytes } from './bytes';
import { describeCertificate } from './certificate-details';
import type { LaterRevisionsAnalyzer } from './revisions';
import type { RevocationContext } from './revocation';

/** PKI.js, asn1js and the WebCrypto engine, loaded once per validation. */
export interface CmsContext {
  readonly pkijs: typeof Pkijs;
  readonly asn1js: typeof import('asn1js');
  readonly crypto: Crypto;
  readonly engine: Pkijs.CryptoEngine;
  /** Parsed trust anchors. Empty means the chain is not evaluated. */
  readonly anchors: readonly Pkijs.Certificate[];
  /** When the chain of a signature without a trusted timestamp is checked. */
  readonly validationTime: Date;
  /** CRL and OCSP evidence: what to do, what was provided, what may be fetched. */
  readonly revocation: RevocationContext;
  /** Compares each signed revision with the final file to say what changed after it. */
  readonly later: LaterRevisionsAnalyzer;
  /** Certificates the document keeps in its DSS: more candidates to build a chain from. */
  readonly dssCertificates: readonly Pkijs.Certificate[];
}

export const SIGNED_DATA_OID = '1.2.840.113549.1.7.2';
const SUBJECT_KEY_IDENTIFIER_OID = '2.5.29.14';

export async function digest(
  crypto: Crypto,
  algorithm: string,
  data: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(algorithm, data as Uint8Array<ArrayBuffer>));
}

/** Parses a DER CMS `ContentInfo` holding a `SignedData`. Returns `undefined` if it is anything else. */
export function parseSignedData(
  der: Uint8Array,
  context: CmsContext,
): Pkijs.SignedData | undefined {
  try {
    const contentInfo = context.pkijs.ContentInfo.fromBER(der as Uint8Array<ArrayBuffer>);
    if (contentInfo.contentType !== SIGNED_DATA_OID) return undefined;
    return new context.pkijs.SignedData({ schema: contentInfo.content });
  } catch {
    return undefined;
  }
}

/** The certificates embedded in a `SignedData`, parsed and described. */
export async function embeddedCertificates(
  signedData: Pkijs.SignedData,
  context: CmsContext,
): Promise<{ parsed: Pkijs.Certificate[]; details: CertificateDetails[] }> {
  const parsed = (signedData.certificates ?? []).filter(
    (c): c is Pkijs.Certificate => c instanceof context.pkijs.Certificate,
  );
  const sha256 = (data: Uint8Array) => digest(context.crypto, 'SHA-256', data);
  return { parsed, details: await Promise.all(parsed.map((c) => describeCertificate(c, sha256))) };
}

/** Index in `certificates` of the one the signer info points to, or -1. */
export function findSigner(
  certificates: readonly Pkijs.Certificate[],
  signerInfo: Pkijs.SignerInfo,
  context: CmsContext,
): number {
  const { pkijs } = context;
  const sid = signerInfo.sid as unknown;
  if (sid instanceof pkijs.IssuerAndSerialNumber) {
    return certificates.findIndex(
      (c) => c.issuer.isEqual(sid.issuer) && c.serialNumber.isEqual(sid.serialNumber),
    );
  }
  // A subjectKeyIdentifier (an OCTET STRING). Checked by shape, not `instanceof asn1js.OctetString`:
  // PKI.js may build it with its own copy of asn1js, a different class than the one we import.
  const keyId = (sid as { valueBlock?: { valueHexView?: Uint8Array } } | null)?.valueBlock
    ?.valueHexView;
  if (keyId instanceof Uint8Array) {
    const wanted = new Uint8Array(keyId);
    return certificates.findIndex((c) => {
      const extension = c.extensions?.find((e) => e.extnID === SUBJECT_KEY_IDENTIFIER_OID);
      const view = extension?.parsedValue as
        { valueBlock?: { valueHexView: Uint8Array } } | undefined;
      return !!view?.valueBlock && sameBytes(new Uint8Array(view.valueBlock.valueHexView), wanted);
    });
  }
  return -1;
}

/** The raw bytes of the signature value of a signer. */
export function signatureValue(signerInfo: Pkijs.SignerInfo): Uint8Array {
  return new Uint8Array(signerInfo.signature.valueBlock.valueHexView);
}
