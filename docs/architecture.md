# Architecture

## Goals

- A reusable SDK, not an application: every concern sits behind an interface.
- The core never depends on a PDF engine. Engines are adapters.
- Visual signing and cryptographic signing are independent.
- A complete default UI exists, but everything it uses is exposed so you can build your own.

## Entry points

```
                 ┌──────────────────────────┐
                 │  signora-pdf   (core)   │  Angular only
                 │  models · ports · coords │
                 │  SigningSession · DI     │
                 └───────▲───────▲───────▲──┘
                         │       │       │
        ┌────────────────┘       │       └────────────────┐
┌───────┴────────┐      ┌────────┴───────┐       ┌────────┴───────┐
│ signora-pdf/  │      │ signora-pdf/  │       │ signora-pdf/  │
│ pdfjs          │      │ pdf-lib        │       │ ui             │
│ (pdfjs-dist)   │      │ (pdf-lib)      │       │ viewer, slots  │
└────────────────┘      └───────▲────────┘       └────────────────┘
                                 │
┌────────────────┐      ┌───────┴────────┐
│ signora-pdf/  │      │ signora-pdf/  │
│ http           │      │ validation     │
│ (HttpClient)   │      │ (pkijs, asn1js)│
└────────────────┘      └────────────────┘
```

`signora-pdf/http` and `signora-pdf/validation` also depend on the core; `validation` reuses the
PDF reading of `signora-pdf/pdf-lib`.

Dependencies are enforced three ways: separate packages entry points, optional peer dependencies,
and an ESLint `no-restricted-imports` rule on the core and `ui`. CI also greps the built core and
UI bundles for engine references.

## Ports

| Port                       | Purpose                                              | Default adapter                |
| -------------------------- | ---------------------------------------------------- | ------------------------------ |
| `PdfRenderingPort`         | load a document, page geometry, draw pages to canvas | `PdfJsRenderingAdapter`        |
| `PdfWriterPort`            | produce a PDF with visual signatures embedded        | `PdfLibDocumentWriter`         |
| `SignatureProvider`        | predefined visual signatures (organization stamps)   | `withOrganizationSignatures()` |
| `DigitalSignatureProvider` | cryptographic signing through a backend or service   | `HttpDigitalSignatureProvider` |
| `CertificateProvider`      | list available signing certificates                  | `HttpCertificateProvider`      |
| `SignatureValidatorPort`   | verify the signatures a PDF already has              | `PkijsSignatureValidator`      |

Register implementations with features:

```ts
provideSignora(
  withPdfJsRenderer({ workerSrc }),
  withPdfLibWriter(),
  withSignatureProvider(OrganizationSignatures),
  withDigitalSigner(MyBackendSigner),
);
```

A feature is `{ kind, providers }`; adapters and your own code can create more with
`createSignoraFeature()`.

## Session

`SigningSession` holds the state of one workflow with signals: document handle, status, current
page, zoom, rotation and placements. It has no DOM dependency. It is provided by
`provideSignora()`; add `providers: [SigningSession]` to a component for an independent instance.

## Signing workflow

```
 view / place  ──►  visual export  ──►  digital signature
 (SigningSession)   (PdfWriterPort)     (DigitalSignatureProvider)
```

Each stage consumes bytes and produces bytes. Visual signatures are applied first; the digital
signature is the last step, so it covers the visual content. Digital signing is expected to run
in a backend or remote service. `DigitalSignResult.cryptographic` makes it explicit whether a real
signature was applied, so simulated providers can never be mistaken for real ones.

## UI

`<signora-viewer>` composes `<signora-toolbar>` and `<signora-page>`. Sections can be replaced with
`<ng-template signoraSlot="toolbar|empty|loading|error|signatures">`; text comes from the `SIGNORA_LABELS`
token; visuals from `--signora-*` variables (see [theming](theming.md)). The page component
exposes an overlay layer, sized to the page, where signature elements are projected.

## Incremental updates

`signora-pdf/pdf-lib` can also write signatures as an incremental update (`withPdfLibWriter({ mode })`),
which keeps existing digital signatures valid; see [incremental-signing.md](incremental-signing.md).
Signature fields (`addSignatureFields`) and the DSS (`appendDss`) are always written that way.

## Validation

`signora-pdf/validation` reads and verifies the signatures a PDF already carries: byte ranges, CMS
integrity and signature, RFC 3161 timestamps, certificate chains against the anchors you pass,
CRL/OCSP, the DSS, the PAdES level and what changed after each signature. It never signs and does no
I/O of its own. Register it with `withPdfSignatureValidation()`; see [validation.md](validation.md).

## Digital signing

`SigningWorkflow` (core) sequences the two stages and validates what a provider returns; see
[digital-signing.md](digital-signing.md). The HTTP adapters live in `signora-pdf/http` so the core
does not depend on `HttpClient`.
