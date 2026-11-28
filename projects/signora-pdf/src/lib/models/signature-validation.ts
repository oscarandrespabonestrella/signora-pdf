import type { PadesLevel } from '../ports/digital-signature';
import type { PdfSignatureInfo } from './pdf-signature';

/** What a certificate says about itself. Parsed from the signature; trust is a separate question. */
export interface CertificateDetails {
  /** Subject distinguished name, e.g. `CN=Ada Lovelace, O=Example, C=ES`. */
  readonly subject: string;
  readonly issuer: string;
  /** Serial number in hexadecimal. */
  readonly serialNumber: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
  /** Algorithm name of the public key (`RSA`, `EC P-256`) or its OID when unknown. */
  readonly publicKeyAlgorithm: string;
  /** Algorithm the issuer used to sign this certificate, e.g. `sha256WithRSAEncryption`. */
  readonly signatureAlgorithm: string;
  /** `keyUsage` bits that are set, e.g. `digitalSignature`, `nonRepudiation`. */
  readonly keyUsage: readonly string[];
  /** `true` when subject and issuer are the same name. */
  readonly selfSigned: boolean;
  /** SHA-256 of the DER certificate, lower-case hex. */
  readonly fingerprintSha256: string;
  /** The certificate itself (DER). */
  readonly der: Uint8Array;
}

/**
 * - `valid`: the signature is cryptographically intact over the bytes it covers.
 * - `invalid`: it is broken, or the file was changed inside the signed bytes.
 * - `indeterminate`: it could not be checked (unsupported format or algorithm, signer certificate absent).
 *
 * `valid` does **not** mean trusted: see {@link SignatureChecks.certificateChain}.
 */
export type SignatureValidationStatus = 'valid' | 'invalid' | 'indeterminate';

/** Why a signature is `invalid` or `indeterminate`. */
export type SignatureProblemCode =
  /** `/ByteRange` is inconsistent with the file or with `/Contents`. */
  | 'BYTE_RANGE_MALFORMED'
  | 'CONTENTS_MISSING'
  | 'UNSUPPORTED_SUBFILTER'
  | 'CMS_MALFORMED'
  | 'UNSUPPORTED_ALGORITHM'
  | 'SIGNER_CERTIFICATE_MISSING'
  /** Trust anchors were provided and the certificate does not chain to one of them (or is expired, not a CA...). */
  | 'CERTIFICATE_CHAIN_INVALID'
  /** A certificate of the chain was revoked at or before the moment it is checked at. */
  | 'CERTIFICATE_REVOKED'
  /**
   * The document was changed after this signature in a way its author did not permit: a DocMDP
   * certification level, or a field lock (FieldMDP), forbids it. See `laterRevisions`.
   */
  | 'CHANGES_NOT_PERMITTED'
  /** Revocation was required (`revocation: 'require'`) and no usable CRL or OCSP evidence exists for a certificate. */
  | 'REVOCATION_UNKNOWN'
  /** The signed bytes no longer hash to the value the signer committed to. */
  | 'DIGEST_MISMATCH'
  /** The digest matches but the signature over it does not verify with the signer's key. */
  | 'SIGNATURE_INVALID'
  | 'VALIDATION_ERROR';

/** Something worth knowing about a signature that does not make it invalid. */
export type SignatureWarningCode =
  /** Bytes follow the signed range (a later revision or an appended change). */
  | 'REVISIONS_AFTER_SIGNATURE'
  | 'WEAK_DIGEST_ALGORITHM'
  /** The claimed signing time (`/M`) falls outside the certificate's validity. It is not trustworthy. */
  | 'SIGNING_TIME_OUTSIDE_CERTIFICATE_VALIDITY'
  | 'CERTIFICATE_KEY_USAGE_NOT_FOR_SIGNING'
  /** The signature carries a timestamp token that does not verify, so the signing time is not proven. */
  | 'TIMESTAMP_INVALID'
  /** The timestamp authority certificate is not meant for timestamping (no `timeStamping` usage). */
  | 'TIMESTAMP_CERTIFICATE_NOT_FOR_TIMESTAMPING'
  /** Trust anchors were provided and the timestamp authority does not chain to one of them. */
  | 'TIMESTAMP_AUTHORITY_NOT_TRUSTED'
  /** The chain was checked, but revocation could not be established for some certificate: no usable CRL or OCSP evidence. */
  | 'REVOCATION_NOT_CHECKED'
  /** A certificate of the chain was revoked, but after the moment it is checked at: the signature predates the revocation. */
  | 'CERTIFICATE_REVOKED_AFTER_SIGNING'
  /**
   * Page content, page structure or something unrecognized changed after the signature, and nothing
   * the signer set forbids it. The signed revision is intact, but the document is not what the
   * signer saw. See `laterRevisions`.
   */
  | 'CONTENT_CHANGED_AFTER_SIGNING';

export interface SignatureIssue<Code extends string> {
  readonly code: Code;
  readonly message: string;
}

/** Outcome of one check. `not-evaluated` means Signora does not perform it (yet), not that it passed. */
export type CheckOutcome = 'passed' | 'failed' | 'not-evaluated';

export interface SignatureChecks {
  /** `/ByteRange` is well formed and matches `/Contents`. */
  readonly byteRange: CheckOutcome;
  /** The signed bytes hash to the digest inside the signature. */
  readonly integrity: CheckOutcome;
  /** The signature verifies with the signer certificate's public key. */
  readonly signature: CheckOutcome;
  /** The signer certificate chains to a trust anchor you provided. */
  readonly certificateChain: CheckOutcome;
  /**
   * No certificate of the chain was revoked: `passed` when CRL or OCSP evidence shows every one
   * good, `failed` when one was revoked, `not-evaluated` when evidence is missing for some
   * certificate or revocation checking is off.
   */
  readonly revocation: CheckOutcome;
  /** The RFC 3161 timestamp covers this signature (or, for a document timestamp, the document) and verifies. `not-evaluated` when there is none. */
  readonly timestamp: CheckOutcome;
}

/** What CRL or OCSP evidence says about one certificate. */
export type RevocationStatus = 'good' | 'revoked' | 'unknown';

/** Revocation status of one certificate of a chain. */
export interface CertificateRevocationInfo {
  readonly subject: string;
  /** Serial number in hexadecimal. */
  readonly serialNumber: string;
  readonly status: RevocationStatus;
  /** What the decision is based on; absent when `unknown`. */
  readonly source?: 'ocsp' | 'crl';
  /**
   * Where the evidence came from: `embedded` in the signature, `dss` in the document's security
   * store, `provided` by you, or `fetched` by your fetcher.
   */
  readonly origin?: 'embedded' | 'dss' | 'provided' | 'fetched';
  /** The CRL or OCSP response (DER) the status is based on, to archive it or to store it in a DSS. */
  readonly evidence?: Uint8Array;
  /** When it was revoked, for `revoked`. May be later than the moment checked at: then it does not apply. */
  readonly revokedAt?: Date;
  /** Revocation reason, e.g. `keyCompromise`. */
  readonly reason?: string;
  /** When the evidence was issued and when it expires. */
  readonly thisUpdate?: Date;
  readonly nextUpdate?: Date;
  /** Why the status is `unknown`. */
  readonly message?: string;
}

/** How a certificate was checked against your trust anchors. */
export interface CertificateChainInfo {
  /** The moment the chain was checked at (certificates must be valid then). */
  readonly checkedAt: Date;
  /**
   * `timestamp`: the time proven by a valid, trusted timestamp. `validation-time`: the moment of
   * validation (or the `validationTime` option). The claimed signing time (`/M`) is never used.
   */
  readonly basis: 'timestamp' | 'validation-time';
  /** The path that was built, leaf first and trust anchor last. Empty when no path was found. */
  readonly path: readonly CertificateDetails[];
  /** Why the chain was rejected. */
  readonly error?: string;
  /**
   * Revocation status of every certificate of the path except the trust anchor, in path order.
   * Absent when revocation checking is off.
   */
  readonly revocation?: readonly CertificateRevocationInfo[];
}

/** What an RFC 3161 timestamp token proves: the data existed at `genTime`, according to the authority. */
export interface TimestampDetails {
  /** Time the authority says it stamped the data. Only as trustworthy as the authority. */
  readonly genTime: Date;
  /** Hash used for the message imprint, e.g. `SHA-256`. */
  readonly digestAlgorithm: string;
  /** Policy OID of the authority. */
  readonly policy: string;
  readonly serialNumber: string;
  /** Certificate of the timestamp authority, when embedded. */
  readonly authority?: CertificateDetails;
  /** The authority's certificate chains to a trust anchor you provided (`not-evaluated` without anchors). */
  readonly authorityChain: CheckOutcome;
}

/**
 * What kind of change a later revision made. They are the categories PDF's change permissions
 * (DocMDP, FieldMDP) are written in terms of.
 */
export type LaterChangeKind =
  /** A signature was added, or an existing signature field was signed. */
  | 'signature'
  /** An RFC 3161 document timestamp was added. */
  | 'document-timestamp'
  /** The DSS gained certificates, CRLs or OCSP responses. */
  | 'validation-data'
  /** An empty signature field was added. */
  | 'signature-field'
  /** An existing form field (not a signature) was filled in or edited. */
  | 'form-fill'
  /** A form field (not a signature) was added. */
  | 'form-field'
  /** Annotations (comments, stamps...) were added, changed or removed. */
  | 'annotation'
  /** The document information or metadata changed. */
  | 'metadata'
  /** What a page shows changed (content, resources, size, rotation...). */
  | 'page-content'
  /** Pages were added, removed or reordered. */
  | 'page-structure'
  /** Anything else, including everything that could not be recognized. */
  | 'other';

/** One kind of change found in the revisions after a signature. */
export interface LaterChange {
  readonly kind: LaterChangeKind;
  /** Form field it concerns, for `form-fill`, `signature` and the field kinds. */
  readonly field?: string;
  /** How many PDF objects of that kind changed. */
  readonly objects: number;
}

/** What the later revisions of a document did to what this signature signed. */
export interface LaterRevisions {
  /** The changes, one entry per kind (and field). */
  readonly changes: readonly LaterChange[];
  /** DocMDP level of the document's certification signature: 1 none, 2 forms and signing, 3 also annotations. */
  readonly docMdp?: 1 | 2 | 3;
  /** The signature locks form fields (FieldMDP). */
  readonly fieldLock?: boolean;
  /** The changes that the document's restrictions forbid. Empty when everything is permitted. */
  readonly forbidden: readonly LaterChange[];
  /** `true` when no change breaks a restriction the signer or certifier set. */
  readonly permitted: boolean;
}

/** Validation of one signature. */
export interface SignatureValidationResult {
  /** What the file declares about this signature. */
  readonly signature: PdfSignatureInfo;
  readonly status: SignatureValidationStatus;
  readonly checks: SignatureChecks;
  readonly problems: readonly SignatureIssue<SignatureProblemCode>[];
  readonly warnings: readonly SignatureIssue<SignatureWarningCode>[];
  /** How the signer (or, for a document timestamp, the authority) was checked against your trust anchors. Absent without anchors. */
  readonly chain?: CertificateChainInfo;
  /** Certificate of the signer, when it could be identified. */
  readonly signer?: CertificateDetails;
  /** Every certificate embedded in the signature (signer included). */
  readonly certificates: readonly CertificateDetails[];
  /** Hash used by the signer, e.g. `SHA-256`. */
  readonly digestAlgorithm?: string;
  /** Algorithm of the signature value, e.g. `sha256WithRSAEncryption`. */
  readonly signatureAlgorithm?: string;
  /**
   * What changed in the revisions after this signature, when there are some and they could be
   * read. Best effort: it compares the signed revision with the file object by object, and what it
   * does not recognize counts as `other`.
   */
  readonly laterRevisions?: LaterRevisions;
  /**
   * The timestamp token, when there is one: embedded in the signature, or the token itself for a
   * document timestamp. Present even if it failed to verify (see `checks.timestamp`).
   */
  readonly timestamp?: TimestampDetails;
  /**
   * Highest PAdES baseline level this signature evidences: `B-B` (CAdES with a signing-certificate
   * attribute), `B-T` (plus a valid timestamp), `B-LT` (plus revocation evidence for the whole chain
   * kept in the signature or the DSS) or `B-LTA` (plus a later document timestamp that already covered
   * that evidence). `B-LT` and `B-LTA` are only reported when `trustAnchors` were given, because they
   * claim the evidence belongs to a trusted chain. `undefined` for signatures that are not PAdES.
   */
  readonly padesLevel?: PadesLevel;
}

/** `no-signatures` when the PDF carries none; otherwise the worst status among them. */
export type DocumentValidationStatus = 'no-signatures' | SignatureValidationStatus;

/** Technical report of validating every signature of a document. */
export interface ValidationReport {
  readonly generatedAt: Date;
  /** SHA-256 of the validated file, lower-case hex. */
  readonly documentSha256: string;
  readonly status: DocumentValidationStatus;
  /** One entry per signed field, in signing order. */
  readonly results: readonly SignatureValidationResult[];
  /** Names of signature fields that nobody has signed. */
  readonly unsignedFields: readonly string[];
  /** What the document's security store (DSS) holds, when it has one. */
  readonly dss?: DocumentSecurityStoreSummary;
}

/** How much validation data a PDF keeps in its DSS. It is data to be checked, not trusted. */
export interface DocumentSecurityStoreSummary {
  readonly certificates: number;
  readonly crls: number;
  readonly ocsps: number;
  /** Signatures with their own `/VRI` entry. */
  readonly signatures: number;
}
