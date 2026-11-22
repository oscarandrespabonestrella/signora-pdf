import type { PlacedSignature } from '../models';

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
}
