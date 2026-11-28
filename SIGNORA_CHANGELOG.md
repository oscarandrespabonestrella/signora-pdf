# Signora changelog (evolution)

Tracks the features added by the signature inspection/validation effort. The release changelog is
`CHANGELOG.md`; entries here are folded into it when released. See `SIGNORA_GAP_ANALYSIS.md`.

## 2026-11-25 (9)

### Added: classification of changes after a signature, DocMDP and FieldMDP (P2)

- `result.laterRevisions` (`LaterRevisions`): for a signature followed by more bytes, what the later
  revisions changed, by `LaterChangeKind` (`signature`, `document-timestamp`, `validation-data`,
  `signature-field`, `form-fill`, `form-field`, `annotation`, `metadata`, `page-content`,
  `page-structure`, `other`), with the form field name where it applies, plus `docMdp`, `fieldLock`,
  `forbidden` and `permitted`.
- Method: the signed revision (the file up to the end of the signed range) is parsed on its own and
  compared with the final file object by object; each changed object takes the role it had in the signed
  revision (catalog, page, annotations, AcroForm, field, DSS, metadata), new fields and annotations are
  classified from the final file. Unknown is `other` (conservative). If the signed revision is not a
  complete PDF, the analysis is skipped (`laterRevisions` absent).
- Restrictions: DocMDP level from the signed revision (1: validation data, document timestamps, metadata;
  2: + signing and form fill; 3: + annotations and new fields; anything else forbidden, also tampering
  with `/Perms`) and FieldMDP (`/Lock` or a FieldMDP transform: Include, Exclude, All) on the fields that
  existed when it was signed. A forbidden change: `invalid`, `CHANGES_NOT_PERMITTED`.
- Without restrictions: page content, page structure or `other` changes add the warning
  `CONTENT_CHANGED_AFTER_SIGNING` (valid but modified). `REVISIONS_AFTER_SIGNATURE` is unchanged and
  still raised whenever bytes follow, so existing consumers see no difference unless they look at the new
  field or the new codes (the new problem code only appears with a restriction that was broken).
- `collectFormFields` exported from `signora-pdf/pdf-lib`.
- Fixtures: a signed form (Name filled, City empty), the same with FieldMDP Include and All, with DocMDP
  1, 2 and 3 (all OpenSSL-signed), and two real successive signatures (the second an incremental update).
- Tests: 24 new, changes crafted with the library's own `IncrementalUpdate`. Mutation-checked: the DocMDP
  level 2 set, the "lock covers only fields that existed" rule and the "unrecognized is unexpected" rule
  each make a test fail when broken.
- Not done: classification inside page content streams (a changed `/Contents` is `page-content`), XFA
  forms, indirect document-level structures other than those listed (they count as `other`).

## 2026-11-25 (8)

### Added: long-term validation, DSS and PAdES B-LT / B-LTA (P2)

- The validator reads the document's `/DSS` by itself: its certificates are extra candidates to
  build chains (also for timestamp authorities) and its CRLs and OCSP responses are revocation
  evidence with `origin: 'dss'`, verified and time-checked like any other. Unreadable items are
  skipped. `ValidationReport.dss` (`DocumentSecurityStoreSummary`: counts of certificates, CRLs,
  OCSP responses and `/VRI` entries).
- `padesLevel` gains `B-LT` (trusted timestamp, trusted chain, and revocation evidence for every
  certificate of the chain from the signature or the DSS, never from `provided`/`fetched`) and
  `B-LTA` (a later, valid, trusted document timestamp whose covered file, read as it was then,
  already held everything the signature took from the DSS). Both require `trustAnchors`; without
  them the level stays `B-T`.
- `CertificateRevocationInfo.origin` can be `'dss'`; new `evidence` (the DER CRL or OCSP response a
  decision is based on), left out of the JSON report.
- `readDss(pdf)` and `appendDss(pdf, { certs, crls, ocsps, signatures? }, { xrefFormat? })`,
  `dssSignatureKey()` in `signora-pdf/pdf-lib`: reading and writing the DSS (Flate streams, `/VRI`
  per signature, merging with an existing DSS direct or indirect, no duplicates) as an incremental
  update, so existing signatures stay valid. Structure only: it collects and verifies nothing.
- Internal: `addToAcroForm` exported for tools that build signature fields by hand.
- Fixtures (OpenSSL + the library's own incremental code, bundled by the generator): B-LT, B-LTA, a
  DSS after the last timestamp, a DSS split around it, a DSS whose CRL revokes the signer, and an
  intermediate CA that only the DSS carries.
- Tests: 17 new for the validator and 10 for the DSS. Mutation-checked: breaking the coverage rule of
  `B-LTA` or the origin rule of `B-LT` makes a test fail.
- Not done: collecting a document's validation data automatically, requiring evidence of the
  timestamp authority itself for `B-LT`, DocMDP/FieldMDP classification of later changes.

## 2026-11-25 (7)

### Added: revocation, CRL and OCSP (P2)

- With `trustAnchors`, every certificate of a trusted chain except the anchor is checked for
  revocation. `ValidationOptions.revocation`: `'if-available'` (default), `'require'`, `'off'`;
  `revocationData: { crls, ocsps }`; `fetchRevocation(request)`; `httpRevocationFetcher(options)`.
- Evidence sources: embedded in the signature (CMS `crls`, `adbe-revocationInfoArchival`, CAdES
  `revocation-values`), provided, and fetched (OCSP first, then the CRL, only while still unknown).
  Signora does no I/O of its own.
- Evidence is verified, not believed: CRL signature with the issuer's key and issuer match; OCSP via
  PKI.js `BasicOCSPResponse.verify` (issuer or delegated `id-kp-OCSPSigning` responder). Forged,
  mismatched, OCSP "unknown", delta and indirect/partitioned CRL evidence is ignored.
- Time rule: with a trusted timestamp the evidence must be issued after it; otherwise it must be
  current at the validation time. The same moment as the chain check.
- Results: `checks.revocation`, `chain.revocation[]` (`CertificateRevocationInfo`: status, source,
  origin, `revokedAt`, `reason`, `thisUpdate`, `nextUpdate`); `CERTIFICATE_REVOKED` (invalid when
  revoked at or before the checked moment), `REVOCATION_UNKNOWN` (`require`), warnings
  `CERTIFICATE_REVOKED_AFTER_SIGNING` and `REVOCATION_NOT_CHECKED` (now also for partial evidence).
  Timestamp authorities are checked too (a revoked one: document timestamp `invalid`; signature
  timestamp `TIMESTAMP_AUTHORITY_NOT_TRUSTED`, level `B-B`; `require` without evidence for it: same).
- Behaviour change for existing users: none unless evidence exists. Without any, results are as
  before (`REVOCATION_NOT_CHECKED`). `SignatureChecks` gained `revocation` (additive).
- Errors: `RevocationDataError` (unreadable `revocationData`).
- Fixtures: CRLs from `openssl ca` and OCSP responses from `openssl ocsp` (including a delegated
  responder and "unknown"), a revoked signer, short-lived CRL, evidence from the TSA's CA, and
  signatures carrying a CRL (`crls`) and an OCSP response (`revocation-values`); OCSP/CRL checked by
  OpenSSL as they are made.
- Tests: 39 new (modes, good/revoked CRL and OCSP, delegated responder, forged and mismatched
  evidence, freshness, partial chains, timestamp basis incl. revoked before/after, authorities,
  embedded sources, fetcher behaviour and its error handling, `httpRevocationFetcher`).
- Not done: delta and indirect CRLs, revocation of the trust anchor, OCSP stapling formats beyond
  the above, reading the DSS of the PDF (next).

## 2026-11-25 (6)

### Added: signature fields in the PDF (P1)

- `readSignatureFields(pdf)` (`signora-pdf/pdf-lib`): the empty, visible `/Sig` fields of a document
  as `SignatureField`s (`id` and `pdfName` = qualified name, `label` from `/TU`, `required` from the
  flags, `inDocument: true`). Handles nested fields and widgets held in `/Kids`; leaves out signed
  and invisible fields.
- `addSignatureFields(pdf, fields, options)`: writes the fields that are not `inDocument` as empty
  AcroForm signature widgets in an incremental update (never invalidates existing signatures).
  Creates the AcroForm if there is none; handles a direct or indirect AcroForm and `/Fields`
  array (only the objects that change are rewritten). `SignatureFieldNameError` for empty, dotted or
  duplicate names (checked against every field of the form); DocMDP 1/2 refused; missing page
  `RangeError`.
- `session.exportPdf({ createFields: true })`; optional `PdfWriterPort.writeSignatureFields()`
  (implemented by the pdf-lib writer, always incremental whatever the `mode`). A writer without it
  fails clearly.
- Model (additive, optional): `SignatureField.pdfName`, `SignatureField.inDocument`;
  `DigitalSignRequest.fieldName` (travels in the HTTP metadata) so a backend signs into a field.
- Refactor: the field traversal of `inspectPdfSignatures` now lives in `signora-pdf/pdf-lib`
  (`collectSignatureFields`, `collectFieldNames`) and the validation entry point uses it; its
  behaviour and tests are unchanged. `appendAnnotations` extracted to a shared module.
- Playground example `pdf-signature-fields`; guide `docs/signature-fields.md` (EN/ES).
- Tests: 30 new (26 for reading and creating, 4 for the session). Checked independently with
  pdf.js in Edge: the widgets come back as `Sig` fields with the right names and rectangles at
  `/Rotate` 0/90/180/270 (expected values derived by hand), for unsigned and signed documents, with
  no recovery warnings.
- Not done: field appearances, XFA forms, fields with several widgets beyond the first.

## 2026-11-25 (5)

### Added: incremental writer (P1)

- `appendVisualSignatures(pdf, placements, { xrefFormat?, ignoreDocMdp? })` in `signora-pdf/pdf-lib`:
  adds the signatures as stamp annotations with an appearance stream in an ISO 32000 incremental
  update. Not one original byte changes, so existing digital signatures stay valid (the validator
  reports `REVISIONS_AFTER_SIGNATURE`). Same placement maths as rewrite mode (`computeImageDrawing`),
  including `/Rotate`.
- `withPdfLibWriter({ mode: 'rewrite' | 'incremental' | 'auto', incremental? })`. The default is
  `'rewrite'`, i.e. today's behaviour, and a signed PDF is still refused there: **no breaking
  change**.
- `IncrementalUpdate`: low-level class (load, `register()`, `replace()`, `build()`), classic table or
  xref stream matching the previous section (`/Prev` chain, `/Size`, `/Root`, `/Info`, `/ID`).
  `readDocMdpPermission()`.
- Errors: `IncrementalUpdateError`, `EncryptedPdfError`, `ChangesNotPermittedError` (DocMDP level 1
  or 2 unless `ignoreDocMdp`).
- Only the page object, or the `/Annots` array when it is indirect, is rewritten; existing
  annotations are kept; one image object per asset.
- Internal refactor: `signature-image.ts` and `page-info.ts` shared by both writers;
  `UnsupportedSignatureImageError` is still exported from the same entry point.
- Playground example `append-signature` and guide `docs/incremental-signing.md` (EN/ES).
- Verification: 31 tests with an independent strict xref reader (`xref-check.testing.ts`) that
  follows the `/Prev` chain and checks every entry; original bytes preserved; OpenSSL-signed
  fixtures (RSA, ECDSA, timestamp, two signatures, document timestamp) still validate with trust
  anchors after one or several updates and either xref kind; DocMDP 1/2/3; encrypted; errors.
  Rendered with pdf.js in Edge: the stamp lands on the exact rectangle at `/Rotate` 0/90/180/270
  for unsigned and signed documents, table and stream xref, with no recovery warnings (a corrupted
  `startxref` does raise them, as a control).
- Not done: creating `/Sig` fields (next), signing the new revision (backend), encrypted PDFs,
  files over 4 GiB.

## 2026-11-25 (4)

### Added: certificate chain validation (P1)

- `ValidationOptions.trustAnchors` (DER bytes or PEM strings) and `validationTime`. Signora ships no
  trust list. Without anchors nothing changes (`certificateChain` stays `not-evaluated`).
- With anchors the signer, and the authority of every timestamp, must chain to an anchor using the
  intermediates embedded in the signature (PKI.js chain engine: signatures, validity, basic and name
  constraints). Failure is `indeterminate` + `CERTIFICATE_CHAIN_INVALID`; the signature checks keep
  their own outcome.
- Time used: a valid timestamp from a trusted authority (`chain.basis === 'timestamp'`, so a
  signature outlives its certificate), otherwise `validationTime` (default now). The claimed `/M` is
  never used. A timestamp authority is checked as of the token's `genTime`.
- Results: `result.chain` (`CertificateChainInfo`: `checkedAt`, `basis`, `path` leaf first, `error`),
  `timestamp.authorityChain`, warnings `TIMESTAMP_AUTHORITY_NOT_TRUSTED` and
  `REVOCATION_NOT_CHECKED` (every passing chain, as revocation is not consulted). `padesLevel` is
  `B-B` instead of `B-T` when the authority is untrusted.
- `TrustAnchorError`: an unreadable anchor throws before validating (also when the PDF has no
  signatures).
- A certificate that is itself an anchor is accepted if valid at the checked time.
- Security: PKI.js picks the certificate to validate by itself (the last of its de-duplicated
  list); a path that does not start at the signer's certificate is rejected.
- Fixtures: separate TSA root CA, unrelated CA and an intermediate CA (signer "Alan Turing",
  `openssl cms -verify` checked). Playground example gains "Trust the test CAs".
- Tests: 14 new (no anchors, trusted signer, DER/PEM bundles/pinned certificate, intermediate path,
  untrusted, expired and not-yet-valid, tampered stays invalid, time from timestamp vs validation
  time, untrusted authority, document timestamp authority, unreadable anchors).
- Not done: revocation (OCSP/CRL), key usage / extended key usage policy of the signer, certificate
  policies.

## 2026-11-25 (3)

### Added: RFC 3161 timestamps and PAdES level (P1)

- `validatePdfSignatures` verifies the RFC 3161 token embedded in a signature (unsigned
  `signature-time-stamp` attribute) and document timestamps (`ETSI.RFC3161`, now results with
  `signature.kind === 'document-timestamp'` instead of `UNSUPPORTED_SUBFILTER`).
- `result.timestamp` (`TimestampDetails`: `genTime`, `digestAlgorithm`, `policy`, `serialNumber`,
  authority certificate), `checks.timestamp`, warnings `TIMESTAMP_INVALID` and
  `TIMESTAMP_CERTIFICATE_NOT_FOR_TIMESTAMPING`.
- `result.padesLevel`: `B-B` (CAdES with signing-certificate attribute) or `B-T` (plus a valid
  timestamp). B-LT/B-LTA are not detected yet.
- `SignatureChecks` gained `timestamp` (additive; existing fields unchanged).
- Report text shows the timestamp and the PAdES level.
- Fixtures: a real TSA (`openssl ts`) in `scripts/generate-signature-fixtures.mjs`, checked with
  `openssl ts -verify`; the signature-timestamp fixture is also accepted by `openssl cms -verify`.
- Tests: 8 new (B-B, no level for `adbe.pkcs7.detached`, B-T with authority details, corrupted
  signature timestamp, document timestamp valid / changed byte in its range / corrupted token /
  non-token contents).
- Not evaluated: whether the timestamp authority is trusted (needs chain validation).

### Changed

- When a timestamp token's imprint does not match, its authority signature is left `not-evaluated`
  (PKI.js re-checks the imprint while verifying, so the two cannot be told apart).

## 2026-11-25 (2)

### Added: cryptographic verification and validation report (P0)

- `validatePdfSignatures(pdf, { crypto? })` in `signora-pdf/validation`: for every signature checks
  that `/ByteRange` matches `/Contents`, that the signed bytes still hash to the committed
  `message-digest`, and that the signature value verifies with the signer certificate. Supports
  `adbe.pkcs7.detached` and `ETSI.CAdES.detached`, RSA and ECDSA, SHA-1/224/256/384/512.
- Results per signature: `status` (`valid` / `invalid` / `indeterminate`), `checks`, typed
  `problems` (`DIGEST_MISMATCH`, `SIGNATURE_INVALID`, `BYTE_RANGE_MALFORMED`, `CMS_MALFORMED`,
  `UNSUPPORTED_*`...), `warnings` (`REVISIONS_AFTER_SIGNATURE`, `WEAK_DIGEST_ALGORITHM`...), and
  `CertificateDetails` for the signer and every embedded certificate.
- `ValidationReport` with the SHA-256 of the file, plus `serializeValidationReport()` (stable JSON,
  `schemaVersion` 1) and `formatValidationReport()`.
- Core (types and port only, still no crypto): `SignatureValidatorPort`,
  `SIGNORA_SIGNATURE_VALIDATOR`, `withSignatureValidator()`, validation models. Adapter:
  `PkijsSignatureValidator` / `withPdfSignatureValidation()`.
- New optional peer dependencies: `pkijs`, `asn1js` (PeculiarVentures; WebCrypto, browser and Node).
- `valid` means intact, **not** trusted: `certificateChain` is `not-evaluated` until chain
  validation exists. Documented in `docs/validation.md`, `AGENTS.md` and the site (EN/ES).
- Playground example `examples/validate-signatures` (valid and tampered samples) with docs pages.
- Tests: 18 against real signatures made by OpenSSL (`scripts/generate-signature-fixtures.mjs`,
  which also checks each one with `openssl cms -verify`): RSA, ECDSA, two signatures, claimed time
  before the certificate, changed signed byte, corrupted signature value, moved `/ByteRange`,
  appended bytes, non-CMS contents, unsupported format, unsigned fields, JSON report, DI.

### Changed

- Inspection now fails closed: an unreadable signature field raises `PdfInspectionError` instead of
  being skipped.
- CI and ESLint boundaries also forbid `pkijs` and `asn1js` in core, UI and HTTP bundles.

## 2026-11-25

### Added: signature inspection (P0)

- New entry point `signora-pdf/validation` (needs the optional peer `pdf-lib`).
- `inspectPdfSignatures(pdf, { includeUnsigned? })`: lists `/Sig` and `DocTimeStamp` fields with
  filter, sub-filter, byte range, CMS bytes, claimed time, reason, location, page, normalized
  rectangle, revision and whether the signature covers the whole file. Empty fields are listed too.
- `byteRangeWellFormed` flags a forged or inconsistent `/ByteRange`.
- `PdfSignatureInfo` / `PdfSignatureKind` in the core (types only); `PdfInspectionError`;
  `parsePdfDate`.
- Docs: `docs/validation.md` (EN, ES in the site), `AGENTS.md`, `llms.txt`.
- 12 tests with synthetic fixtures (no cryptography involved).

### Changed

- Documentation wording: "never performs cryptography" is now "never creates signatures".
  No public API changed.
