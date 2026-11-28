import type { ValidationReport } from '../models';

/**
 * Port that checks the digital signatures already present in a PDF. It only reads: it never
 * modifies the document. The default adapter is `PkijsSignatureValidator` in
 * `signora-pdf/validation`; register one with `withSignatureValidator()`.
 */
export interface SignatureValidatorPort {
  validate(pdf: Uint8Array): Promise<ValidationReport>;
}
