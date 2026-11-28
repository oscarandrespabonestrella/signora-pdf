import type { PlacedSignature, SignatureField } from '../models';

/**
 * Port that produces a new PDF with visual signatures embedded. It performs
 * *visual* modifications only; cryptographic signing is a separate concern
 * (see `DigitalSignatureProvider`).
 */
export interface PdfWriterPort {
  applyVisualSignatures(
    pdf: Uint8Array,
    placements: readonly PlacedSignature[],
  ): Promise<Uint8Array>;

  /**
   * Optional. Creates empty PDF signature fields (AcroForm `/Sig`) for the given fields, so a
   * backend can sign into them. Required by `exportPdf({ createFields: true })`. It must not
   * invalidate digital signatures the document already has.
   */
  writeSignatureFields?(pdf: Uint8Array, fields: readonly SignatureField[]): Promise<Uint8Array>;
}
