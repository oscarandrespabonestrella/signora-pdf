# Signora: gap analysis

Audit of 2026-11-25, updated after each feature. Scope decision: Signora **validates and
inspects**; it does **not** create cryptographic signatures. Signing (CMS/PAdES, PKCS#12, HSM) stays
delegated to a backend through `DigitalSignatureProvider`. Signora manages no users, signers,
workflows, approvals or notifications.

Status: ✅ implemented · 🟡 partial · ❌ not implemented · ➡️ delegated (by design).
Complexity: S, M, L, XL.

## Visual signatures

| Capability                             | Status          | Limitations                                                                                                                                                                             | Missing                                                     | Prio | Cx  |
| -------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---- | --- |
| Visual signatures from images          | ✅              | PNG/JPEG data URLs only                                                                                                                                                                 | none                                                        | n/a  | n/a |
| Placement by coordinates, page, size   | ✅              | none                                                                                                                                                                                    | none                                                        | n/a  | n/a |
| Several signatures per document        | ✅              | none                                                                                                                                                                                    | none                                                        | n/a  | n/a |
| Existing signature fields              | ✅ (2026-11-25) | `readSignatureFields()` (empty, visible fields), `exportPdf({ createFields })` / `addSignatureFields()` (incremental, never invalidates signatures), `fieldName` in the signing request | none; fields have no appearance and XFA forms are untouched | n/a  | n/a |
| Successive signatures keeping previous | ✅ (2026-11-25) | visual signatures are appended as stamp annotations and earlier signatures stay valid; the digital signature of the new revision is the backend's job                                   | none in Signora                                             | n/a  | n/a |
| Incremental modifications              | ✅ (2026-11-25) | ISO 32000 update with table or xref stream, `/Prev`, DocMDP check; encrypted PDFs refused                                                                                               | `/Sig` fields and form fields (next item)                   | n/a  | n/a |
| Signature inspection and extraction    | ✅ (2026-11-25) | declared data only                                                                                                                                                                      | none                                                        | n/a  | n/a |

## Digital signatures and cryptography

| Capability                      | Status          | Limitations                                                                                                                                                                   | Missing                                                                                        | Prio | Cx  |
| ------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---- | --- |
| X.509 certificates              | ✅ (2026-11-25) | parsed from signatures: subject, issuer, serial, validity, key, key usage, fingerprint                                                                                        | extensions such as policies, AIA, CRL distribution points                                      | P2   | S   |
| PKCS#12/PFX                     | ➡️              | not handled client side                                                                                                                                                       | nothing (backend)                                                                              | P3   | n/a |
| External keys and HSM           | ➡️              | via `DigitalSignatureProvider`                                                                                                                                                | nothing                                                                                        | n/a  | n/a |
| CMS signatures in PDF           | ➡️ / ✅ verify  | creating is delegated; reading and verifying `adbe.pkcs7.detached` and `ETSI.CAdES.detached` done                                                                             | RSA-PSS and EdDSA are untested; `adbe.pkcs7.sha1` unsupported                                  | P2   | S   |
| PAdES compatibility             | ✅ (2026-11-25) | CAdES signatures verify and their level (B-B to B-LTA) is detected                                                                                                            | none                                                                                           | n/a  | n/a |
| Cryptographic verification      | ✅ (2026-11-25) | digest and signature value, RSA/ECDSA, SHA-1..512                                                                                                                             | none for the supported formats                                                                 | n/a  | n/a |
| Detecting changes after signing | ✅ (2026-11-25) | changed signed bytes are `invalid`; later revisions are classified (signature, timestamp, DSS, form fill, annotation, page content...) and judged against DocMDP and FieldMDP | none; classification is best effort and skipped when the signed revision is not a complete PDF | n/a  | n/a |
| Certificate chain validation    | ✅ (2026-11-25) | caller-provided trust anchors (DER/PEM), embedded intermediates, time from a trusted timestamp else validation time, revocation (below)                                       | none                                                                                           | n/a  | n/a |
| OCSP and CRL                    | ✅ (2026-11-25) | evidence embedded in the signature, provided or fetched by the caller; verified, time-aware; no delta/indirect CRLs                                                           | reading the PDF's DSS (next item)                                                              | n/a  | n/a |
| RFC 3161 timestamps             | ✅ (2026-11-25) | signature timestamps and document timestamps verified; authority trust not evaluated                                                                                          | none                                                                                           | n/a  | n/a |

## Validation and preservation

| Capability                               | Status          | Limitations                                                                                                     | Missing                                               | Prio | Cx  |
| ---------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---- | --- |
| Document integrity validation            | ✅ (2026-11-25) | per signature, over the bytes it covers                                                                         | none                                                  | n/a  | n/a |
| Single and multiple signature validation | ✅ (2026-11-25) | each signature independently                                                                                    | none                                                  | n/a  | n/a |
| Identifying invalid signatures           | ✅ (2026-11-25) | typed problem codes                                                                                             | none                                                  | n/a  | n/a |
| Certificate information extraction       | ✅ (2026-11-25) | see X.509                                                                                                       | none                                                  | n/a  | n/a |
| Timestamp validation                     | ✅ (2026-11-25) | imprint, authority signature, `genTime`, authority certificate                                                  | chain of the authority (see chain validation)         | n/a  | n/a |
| Long-term validation (LTV)               | ✅ (2026-11-25) | reads the DSS (certificates, CRLs, OCSP, VRI), used as verified, time-aware evidence; `appendDss` writes it     | collecting a document's validation data automatically | P3   | M   |
| PAdES-B-B, B-T, B-LT, B-LTA              | ✅ (2026-11-25) | all four levels detected; B-LT/B-LTA need trust anchors; the timestamp authority's own evidence is not required | none                                                  | n/a  | n/a |
| Technical validation reports             | ✅ (2026-11-25) | stable JSON (`schemaVersion` 1) and a text summary                                                              | extend with chain, revocation, timestamps             | n/a  | n/a |

## Implementation order

1. Inspection of signatures (**done**, P0).
2. Cryptographic verification, certificate info, multiple validation, invalid reasons, report (**done**, P0).
3. Timestamps (signature and document) and B-B/B-T detection (**done**, P1), and certificate chains (**done**, P1).
4. Incremental writer (**done**, P1), and existing `/Sig` fields (**done**, P1).
5. OCSP/CRL, LTV (DSS) and B-LT/B-LTA (**done**, P2); classification of later changes (DocMDP/FieldMDP) (**done**, P2). Everything in the audit is implemented; what is left is P3.

Verification uses `pkijs` + `asn1js` in `signora-pdf/validation` as optional peer dependencies.
Fixtures are signed with OpenSSL, an implementation independent from the validator
(`scripts/generate-signature-fixtures.mjs`).
