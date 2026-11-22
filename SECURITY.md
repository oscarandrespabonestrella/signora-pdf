# Security Policy

## Supported versions

While the project is pre-1.0, only the latest published version receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's [private vulnerability reporting](https://github.com/oscarandrespabonestrella/signora-pdf/security/advisories/new)
for this repository. Include:

- a description of the issue and its impact,
- steps or a minimal PDF/project to reproduce it,
- the affected version and environment.

You can expect an acknowledgement within 5 working days. We will keep you informed while we
investigate, prepare a fix and a release, and credit you in the advisory if you wish.

## Scope and notes for integrators

- This library renders untrusted PDFs through PDF.js and modifies PDFs through pdf-lib. Keep both
  dependencies up to date and serve PDFs you do not control from a separate origin when possible.
- **Visual signatures are not digital signatures.** An image placed on a page carries no
  cryptographic proof of identity or integrity. Legally meaningful signing must use a real
  provider behind the `DigitalSignatureProvider` interface.
- The library does not implement cryptography. Keys, certificates and tokens belong in your
  backend or signing service, never in client-side code or in this repository.
- The playground's "simulated" signing providers are demonstrations only and must not be used to
  claim that a document was signed.
