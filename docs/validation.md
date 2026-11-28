# Inspecting and validating signatures

Signora can read and verify the digital signatures a PDF already carries. This lives in its own entry point,
`signora-pdf/validation`, which needs the optional peer dependency `pdf-lib`. The core and the UI
stay free of it. **Reading is not trusting:** everything below is what the file _declares_, not
proof that a signature is valid. Signing is still delegated to your backend (see
[digital-signing.md](digital-signing.md)).

## Inspect

```ts
import { inspectPdfSignatures } from 'signora-pdf/validation';

const signatures = await inspectPdfSignatures(pdfBytes);
for (const s of signatures) {
  console.log(s.fieldName, s.signed, s.subFilter, s.signingTime, s.pageIndex, s.rect);
}
```

`inspectPdfSignatures(pdf, { includeUnsigned? })` returns one `PdfSignatureInfo` per signature
field, in signing order (empty fields last):

| Field                                             | Meaning                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| `fieldName`, `signed`                             | AcroForm field name; `false` for an empty field waiting to be signed       |
| `kind`                                            | `signature`, or `document-timestamp` (RFC 3161 `DocTimeStamp`)             |
| `filter`, `subFilter`                             | e.g. `ETSI.CAdES.detached` (PAdES), `adbe.pkcs7.detached`                  |
| `byteRange`                                       | the signed byte ranges                                                     |
| `byteRangeWellFormed`                             | starts at 0, one gap exactly around `/Contents`, inside the file           |
| `contents`                                        | the CMS container (DER), without zero padding                              |
| `signingTime`                                     | `/M`: claimed by the signer, **not trustworthy** without a timestamp token |
| `signerName`, `reason`, `location`, `contactInfo` | free text declared by the signer                                           |
| `pageIndex`, `rect`                               | page and widget box in normalized coordinates (same space as placements)   |
| `revision`                                        | how many `%%EOF` markers fall inside the signed bytes                      |
| `coversWholeDocument`                             | `false` when bytes follow the signature: a later revision or tampering     |

`byteRangeWellFormed: false` should always be treated as hostile: an attacker can move the gap
to make a signature appear to cover content it does not.

`PdfInspectionError` is thrown when the bytes are not a PDF or cannot be parsed. Encrypted PDFs
are read without decrypting the document; the signature dictionary itself is not encrypted.

## Validate

```ts
import { validatePdfSignatures, formatValidationReport } from 'signora-pdf/validation';

const report = await validatePdfSignatures(pdfBytes);
report.status; // 'no-signatures' | 'valid' | 'invalid' | 'indeterminate'
for (const r of report.results) {
  r.status; // per signature
  r.problems; // [{ code: 'DIGEST_MISMATCH', message }]
  r.warnings; // [{ code: 'REVISIONS_AFTER_SIGNATURE', message }]
  r.signer; // CertificateDetails: subject, issuer, serialNumber, validity, key, keyUsage...
}
```

It needs the optional peer dependencies `pdf-lib`, `pkijs` and `asn1js`. Verification runs with
WebCrypto in the browser and in Node; pass `{ crypto }` to use another implementation. It handles
`adbe.pkcs7.detached`, `ETSI.CAdES.detached` (PAdES) and `ETSI.RFC3161` (document timestamps)
signatures made with RSA or ECDSA and SHA-1/224/256/384/512. The PDF is never modified.

What is checked, per signature (`result.checks`):

| Check              | Meaning                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `byteRange`        | `/ByteRange` is well formed and its gap is exactly the `/Contents` signature                                         |
| `integrity`        | the signed bytes hash to the digest the signer committed to (`message-digest`)                                       |
| `signature`        | the signature verifies with the public key of the signer's certificate                                               |
| `timestamp`        | the RFC 3161 timestamp covers this signature (or document) and verifies; `not-evaluated` if there is none            |
| `revocation`       | no certificate of the chain was revoked, according to CRL or OCSP evidence; `not-evaluated` when evidence is missing |
| `certificateChain` | **always `not-evaluated` for now**: no trust anchors are checked                                                     |

**Reading `valid`:** the signature is intact over the bytes it covers. It does **not** say the
signer is who they claim to be, that the certificate is trusted or unrevoked, or that the claimed
time is true. Only when you pass `trustAnchors` does `valid` also mean that the signer (and any
timestamp authority) chains to a certificate you trust; even then **revocation is not checked**
unless CRL or OCSP evidence says otherwise (`checks.revocation`). Without anchors, do not present `valid` as "trusted".

Problem codes (`result.problems`): `BYTE_RANGE_MALFORMED`, `CONTENTS_MISSING`, `CMS_MALFORMED`,
`DIGEST_MISMATCH`, `SIGNATURE_INVALID`, `CERTIFICATE_REVOKED` and `CHANGES_NOT_PERMITTED` make the signature `invalid`; `UNSUPPORTED_SUBFILTER`,
`UNSUPPORTED_ALGORITHM`, `SIGNER_CERTIFICATE_MISSING`, `CERTIFICATE_CHAIN_INVALID`, `REVOCATION_UNKNOWN` and
`VALIDATION_ERROR` make it `indeterminate`. `DIGEST_MISMATCH` means the file changed inside the signed bytes;
`SIGNATURE_INVALID` means the digest is intact but the signature value is not.

Warnings (`result.warnings`) never change the status: `TIMESTAMP_INVALID` (the timestamp inside the
signature does not verify, so the signing time is not proven) and
`TIMESTAMP_CERTIFICATE_NOT_FOR_TIMESTAMPING`, `TIMESTAMP_AUTHORITY_NOT_TRUSTED`,
`REVOCATION_NOT_CHECKED` and `CERTIFICATE_REVOKED_AFTER_SIGNING`, `REVISIONS_AFTER_SIGNATURE` (bytes follow the
signed range; `laterRevisions` says what they are) and `CONTENT_CHANGED_AFTER_SIGNING`, `WEAK_DIGEST_ALGORITHM` (SHA-1),
`SIGNING_TIME_OUTSIDE_CERTIFICATE_VALIDITY` and `CERTIFICATE_KEY_USAGE_NOT_FOR_SIGNING`.

## Timestamps and PAdES level

A signature may carry an RFC 3161 token over its signature value (an unsigned `signature-time-stamp`
attribute), and a PDF may hold document timestamps (`ETSI.RFC3161`, shown as results with
`signature.kind === 'document-timestamp'`) that cover everything before them. For both,
`result.timestamp` has `genTime`, `digestAlgorithm`, `policy`, `serialNumber` and the authority's
`CertificateDetails`, and `checks.timestamp` says whether the token covers the right bytes and was
signed by the authority certificate it names.

- A **document timestamp** is judged on its own: a changed byte inside its range is
  `DIGEST_MISMATCH`, a bad authority signature is `SIGNATURE_INVALID`.
- A **signature timestamp** that fails only adds a `TIMESTAMP_INVALID` warning: the signature itself
  stays as valid as it was, but its time is no longer proven.
- `genTime` is only as trustworthy as the authority: with `trustAnchors`, `timestamp.authorityChain`
  says whether it chains to one of them. Prefer it to the signer's own `/M` time, which anyone can
  write.

`result.padesLevel` is the highest PAdES baseline level the signature evidences: `B-B` for a
CAdES signature with a signing-certificate attribute, `B-T` when it also has a valid timestamp (from
an authority that is not known to be untrusted), `B-LT` and `B-LTA` as described below.
`B-LT` and `B-LTA` need trusted validation data and are described in the next sections; the field
is `undefined` for `adbe.pkcs7.detached` and whenever the signature has problems.

## Trust: certificate chains

Signora ships **no trust list**; you decide whom to trust. Pass the certificates you accept (your
CA, a national trusted list, the roots of a trust service...) as DER bytes or PEM strings:

```ts
const report = await validatePdfSignatures(pdfBytes, {
  trustAnchors: [rootCaPem, tsaRootDer],
  validationTime: new Date(), // optional; this is the default
});
```

With anchors, each signer's certificate must build a path to one of them, using the intermediates
embedded in the signature, with valid signatures, validity periods, basic and name constraints.
The same goes for the authority of every timestamp (checked as of the token's own `genTime`). A
signature that is intact but does not chain is `indeterminate` with `CERTIFICATE_CHAIN_INVALID`,
`result.chain.error` says why, and `result.chain.path` lists the path that was built (leaf first).
A certificate that is itself in `trustAnchors` is accepted if it is valid at the checked time.

**Which time?** Never the signer's own `/M`. If the signature has a valid timestamp from a trusted
authority, the certificates are checked as of that `genTime`, so a signature stays valid after its
certificate expires (`result.chain.basis === 'timestamp'`). Otherwise they are checked as of
`validationTime` (default: now, `basis === 'validation-time'`), and an expired signer is rejected.

Once the chain is trusted, revocation is checked too: see the next section.

An anchor that cannot be read raises `TrustAnchorError` before anything is validated (it is never
silently ignored).

## Revocation: CRL and OCSP

With `trustAnchors`, once a chain is trusted every certificate of it except the anchor is checked
for revocation. What to do is `revocation`:

| `revocation`               | Behaviour                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `'if-available'` (default) | Use the evidence that can be found. A certificate with none is reported (`REVOCATION_NOT_CHECKED`), not rejected. |
| `'require'`                | Every certificate needs usable evidence, or the signature is `indeterminate` (`REVOCATION_UNKNOWN`).              |
| `'off'`                    | Do not look at revocation.                                                                                        |

**Where evidence comes from.** Signora never touches the network by itself.

- **Embedded in the signature**, used automatically: the CMS `crls` field, Adobe's
  `adbe-revocationInfoArchival` and CAdES `revocation-values`.
- **Yours**: `revocationData: { crls, ocsps }` (DER; an OCSP response may be the full `OCSPResponse`
  or the `BasicOCSPResponse`). Unreadable data throws `RevocationDataError`.
- **Fetched by you**: `fetchRevocation(request)` is called only for a certificate that is still
  unknown, OCSP first and then the CRL. It gets the URL the certificate names and, for OCSP, the DER
  request, and returns the bytes (or nothing; failing is fine). `httpRevocationFetcher()` is a
  ready-made one on top of `fetch`. **On a server, restrict it** (`allow`): the URLs come from the
  document being validated, so an open fetcher lets whoever made it make your server request any
  address.

**Evidence is checked, not believed.** A CRL counts only if its issuer's key verifies it and it
covers this certificate's issuer; an OCSP response only if it is signed by the issuer or by a
responder the issuer delegated to (`id-kp-OCSPSigning`). Forged, mismatched, "unknown" and
delta/indirect CRL evidence is ignored.

**Evidence must be recent enough for the moment checked at**, the same moment the chain is checked
at (see above). With a trusted timestamp it must have been issued **after** the timestamp, so that a
revocation before it would show; evidence issued earlier proves nothing about it. Without one, it
must be current at the validation time (`nextUpdate`, or 24 h for an OCSP response without one).

**Result.** `result.chain.revocation` lists each certificate: `status` (`good`, `revoked`,
`unknown`), `source` (`ocsp`/`crl`), `origin` (`embedded`/`provided`/`fetched`), `revokedAt`,
`reason` (e.g. `keyCompromise`), `thisUpdate`, `nextUpdate`.

- A certificate revoked **at or before** the moment checked at makes the signature `invalid`
  (`CERTIFICATE_REVOKED`, `checks.revocation: 'failed'`).
- One revoked **after** it (typical with a timestamp) stays `good` with the warning
  `CERTIFICATE_REVOKED_AFTER_SIGNING`: the signature predates the revocation.
- The same applies to a timestamp authority: a revoked one makes a document timestamp `invalid`, and
  a signature timestamp lose its trust (`TIMESTAMP_AUTHORITY_NOT_TRUSTED`, level `B-B`).

Not handled: delta CRLs, indirect CRLs, OCSP responders chosen by name only, and the trust anchor
itself (not checked).

## Long-term validation: the DSS

A signature stays checkable for years only if what is needed to check it travels with the file. A
PDF keeps that in its **Document Security Store** (`/DSS`): certificates, CRLs and OCSP responses,
plus optional per-signature entries (`/VRI`). Signora reads it on its own:

- its certificates are extra candidates to **build chains** (an intermediate CA the signature does not
  carry can come from the DSS);
- its CRLs and OCSP responses are **revocation evidence** (`origin: 'dss'`), under the same rules as
  any other: verified, and recent enough for the checked moment (see above). With a trusted
  timestamp, evidence stored in the DSS after the timestamp is exactly what proves the certificate
  was not revoked then, even years later.

The DSS is **not protected by the signatures it serves** (it is added afterwards), so nothing in it
is believed: forged, mismatched or too-old items are ignored like anywhere else, and unreadable
ones are skipped. `report.dss` says how much there is (`certificates`, `crls`, `ocsps`, `signatures`).

```ts
import { readDss, appendDss } from 'signora-pdf/pdf-lib';

const dss = await readDss(pdf); // the raw store, or undefined
const longTerm = await appendDss(pdf, { certs, crls, ocsps }); // incremental update
```

`appendDss` stores what you give it in an incremental update (see
[incremental-signing.md](incremental-signing.md)): existing signatures stay valid, repeated items are
not stored twice, and `signatures: [{ signature, crls }]` also fills the `/VRI` entry of that
signature (`dssSignatureKey()` is its key). It does not collect or verify anything; use
`chain.revocation[].evidence` of a validation (with `fetchRevocation`) as the source of the evidence
to archive.

### B-LT and B-LTA

- **`B-LT`**: the signature has a valid timestamp from a trusted authority, its chain is trusted,
  and **every certificate of the chain has revocation evidence kept in the signature or in the DSS**
  (`origin` `embedded` or `dss`: evidence you provided or fetched does not make a signature
  long-term) that shows it good as of the timestamp.
- **`B-LTA`**: `B-LT`, and a valid document timestamp from a trusted authority, made **after** the
  signature, already covered everything the signature takes from the DSS. A DSS added after the last
  document timestamp leaves the signature at `B-LT`; the check reads the file as it was when the
  timestamp was made.

Both need `trustAnchors`: they claim that the evidence belongs to a chain you trust, so without
anchors the level stops at `B-T`. The evidence of the timestamp authority itself is not required for
`B-LT` in this version.

## Changes after a signature

A signature covers the revision that was signed. A PDF can be saved on top of it again and again
(a second signer, a timestamp, a filled-in form, an edit), so "valid" never meant "unmodified". When
bytes follow the signed range, `result.laterRevisions` says **what** the later revisions changed, so a
second signature can be told from an edit nobody signed:

```ts
result.laterRevisions?.changes; // [{ kind: 'signature', field: 'Signature2', objects: 1 }, ...]
result.laterRevisions?.permitted; // false when a restriction the signer set was broken
```

It compares the signed revision (the file up to the end of the signed range) with the final file,
object by object, and gives each changed object the role it had in the signed revision.

| `kind`               | What changed                                                        |
| -------------------- | ------------------------------------------------------------------- |
| `signature`          | a signature was added, or an existing signature field was signed    |
| `document-timestamp` | an RFC 3161 document timestamp was added                            |
| `validation-data`    | the DSS gained certificates, CRLs or OCSP responses                 |
| `signature-field`    | an empty signature field was added                                  |
| `form-fill`          | an existing form field (not a signature) was filled in or edited    |
| `form-field`         | a form field (not a signature) was added                            |
| `annotation`         | annotations (comments, stamps...) were added, changed or removed    |
| `metadata`           | the document information or metadata changed (every save does this) |
| `page-content`       | what a page shows changed: content, resources, size, rotation       |
| `page-structure`     | pages were added, removed or reordered                              |
| `other`              | anything else, **including everything not recognized**              |

`field` names the form field for the field kinds. The analysis is best effort and conservative:
unknown is `other`. If the signed revision cannot be read as a PDF of its own (some signatures sign a
prefix that is not a complete revision), `laterRevisions` is absent and only the generic
`REVISIONS_AFTER_SIGNATURE` warning remains.

**Restrictions.** Two mechanisms let the author say what may still change, and Signora applies both
to the changes it finds (a forbidden change makes the signature `invalid` with
`CHANGES_NOT_PERMITTED`, and `laterRevisions.forbidden` lists them):

- **DocMDP** (certification): the level of the document's certification signature, read from the signed
  revision. Level 1 permits only `validation-data`, `document-timestamp` and `metadata`; level 2 adds
  `signature` and `form-fill`; level 3 adds `annotation`, `signature-field` and `form-field` (widgets
  are annotations). Anything else is forbidden, including touching the certification itself.
- **FieldMDP** (field lock): a signature whose field has a `/Lock` (or a FieldMDP transform) forbids
  `form-fill` and `signature` on the locked fields **that existed when it was signed**; new fields and
  everything that is not a field stay free.

**Without any restriction** nothing is forbidden, but a change to what a page shows (`page-content`,
`page-structure`) or something not recognized (`other`) adds the warning `CONTENT_CHANGED_AFTER_SIGNING`:
the signed revision is intact, but the document is not what the signer saw. Treat a `valid` signature
with that warning as **modified**.

## Report

`serializeValidationReport(report)` gives stable JSON (`schemaVersion: 1`, dates in ISO 8601, no
raw bytes) to store or audit; `formatValidationReport(report)` gives a short text summary. The
report carries the SHA-256 of the validated file.

Register it for injection with `provideSignora(withPdfSignatureValidation())` and inject
`SIGNORA_SIGNATURE_VALIDATOR`, or implement `SignatureValidatorPort` yourself and register it with
`withSignatureValidator()`.

## Not yet covered

Collecting the validation data of a document to store it (the pieces exist: `chain.revocation[].evidence`,
`appendDss`) and requiring the authority's own evidence for `B-LT` are planned; see
`SIGNORA_GAP_ANALYSIS.md` for the order. Signatures in other formats (`adbe.pkcs7.sha1`,
`adbe.x509.rsa_sha1`) report `UNSUPPORTED_SUBFILTER`.
