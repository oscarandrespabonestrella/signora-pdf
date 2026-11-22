# Roadmap

Milestones follow the intended development order. ✅ = done.

1. ✅ **Workspace and repository**: library + playground, lint, Vitest, CI, OSS files.
2. ✅ **Architecture and public API**: models, ports, DI features, entry points.
3. ✅ **Rendering and coordinates**: PDF.js adapter, viewer, normalized coordinate model.
4. ✅ **Signature creation**: draw pad (pointer events, touch, stylus pressure, smoothing), typed
   signatures with configurable fonts, image upload and organization signatures, logos and stamps
   (`withOrganizationSignatures`). Draw, type and upload are UI components that produce
   `SignatureAsset`s; only predefined sources go through the `SignatureProvider` port so far.
5. ✅ **Placement**: drag, move and resize on the page overlay, keyboard support, multiple
   signatures across pages, always stored in normalized coordinates.
6. ✅ **Visual export**: `PdfLibDocumentWriter` embeds images using `toPdfUserSpace`, respecting
   `/Rotate` and CropBox; preview and download.
7. ✅ **Digital signatures**: a backend-oriented `DigitalSignatureProvider` (HTTP) for PAdES
   services, a `CertificateProvider` for remote certificates, and a clearly labelled simulated
   provider for demos. No cryptography is implemented in the library.
8. **Playground and docs**: signature tabs, live theme panel, digital signing demo, integration
   tests, generated API docs, screenshots, first stable release.

Ideas after 1.0: continuous scrolling with virtualized pages, thumbnails sidebar, text
selection and search, form fields, i18n bundles.
