# Digital signing

A **visual signature** is an image placed on a page. It proves nothing. A **digital signature**
is a cryptographic seal made with a certificate, which lets a reader detect changes and identify
the signer. These are separate stages, and **this library never performs cryptography**: it
delegates it to a provider you control.

## The workflow

```
SigningSession (placements) ──► PdfWriterPort ──► DigitalSignatureProvider ──► signed PDF
                                 visual stage        cryptographic stage
```

`SigningWorkflow.sign()` runs both: it exports the document with its visual signatures and then
hands those bytes to the provider, so the digital signature covers the visual content.

```ts
const workflow = inject(SigningWorkflow);

const certificates = await workflow.listCertificates(); // from the CertificateProvider
const result = await workflow.sign({
  certificateId: certificates[0].id,
  level: 'B-T', // PAdES baseline level, interpreted by your service
  reason: 'I approve this document',
});

result.pdf; // Uint8Array
result.cryptographic; // true only if a real signature was applied
```

Register providers with `provideSignora()`:

```ts
(provideHttpClient(),
  provideSignora(
    withHttpDigitalSigner({ signUrl: '/api/sign' }),
    withHttpCertificateProvider({ url: '/api/certificates' }),
  ));
```

Or implement `DigitalSignatureProvider` / `CertificateProvider` yourself (a trust service SDK, a
hardware token bridge...) and register it with `withDigitalSigner()` / `withCertificateProvider()`.
`workflow.sign({ provider })` overrides the registered signer for a single call.

## What the workflow guards against

- A provider that claims `cryptographic: true` but returns a PDF with **no signature dictionary**
  (`/ByteRange`) is rejected with a `DigitalSigningError`.
- A response that is not a PDF at all (for example a login page returned by a proxy) is rejected.
- `cryptographic: false` results are accepted but are always reported as such, so simulated
  providers cannot be mistaken for real ones.

The `/ByteRange` check is a sanity check. It does **not** validate the signature, the certificate
chain or the document integrity. Validate on the server and in the readers you trust.

## HTTP contract (`signora-pdf/http`)

The HTTP adapter uses Angular's `HttpClient`, so your interceptors (authentication, tenant
headers...) apply. Provide `provideHttpClient()` in your application.

**Sign**

```
POST {signUrl}
Content-Type: multipart/form-data

pdf        file, application/pdf   the document, visual signatures already embedded
metadata   application/json        { certificateId?, level?, reason?, location?,
                                      signerName?, options? }

200 application/pdf                 the signed PDF
4xx/5xx                             optional JSON body { "message": "..." } (shown to the user)
```

**Certificates**

```
GET {url}

200 application/json  [ { id, subject, issuer?, validFrom?, validTo?, metadata? } ]
```

Dates are ISO 8601 strings.

## Building the server side

Use an existing, audited implementation. For example an open-source PAdES library on your
backend, or a qualified trust service provider's remote signing API. Keep keys and certificates
there; never ship them to the browser. Authenticate the user, authorize the certificate they may
use, and log what was signed.

A pre-existing digital signature in the source document would be invalidated by the visual stage
(pdf-lib rewrites the file), which is why the writer refuses already-signed PDFs by default.
Place visual signatures first and sign last.

## The playground

The _Digital signing_ page lets you run both providers:

- **Simulated**: returns the PDF as it is and reports `cryptographic: false`. The UI and the
  download name state that the file is **not signed**. It exists to show the workflow.
- **Remote service (HTTP)**: calls `/api/sign` and `/api/certificates`. The playground ships no
  backend, so these calls fail until you provide one (the repository's end-to-end checks mock
  one at the network level to exercise this path).
