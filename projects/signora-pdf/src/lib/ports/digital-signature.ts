/**
 * Contracts for cryptographic (PAdES-style) signing. The library never
 * implements cryptography itself: these ports are meant to be backed by a
 * backend service, a remote signing provider or a hardware token.
 */

export interface CertificateInfo {
  readonly id: string;
  readonly subject: string;
  readonly issuer?: string;
  readonly validFrom?: Date;
  readonly validTo?: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Source of the certificates a user may sign with, typically backed by a remote service. Register it with `withCertificateProvider()`. */
export interface CertificateProvider {
  readonly id: string;
  listCertificates(): Promise<readonly CertificateInfo[]>;
}

/** PAdES baseline conformance level requested from the signing service (B-B, B-T, B-LT, B-LTA). Interpreted by your service; the library only forwards it. */
export type PadesLevel = 'B-B' | 'B-T' | 'B-LT' | 'B-LTA';

/** What a {@link DigitalSignatureProvider} receives: the PDF to sign plus signing metadata. */
export interface DigitalSignRequest {
  /** PDF to sign, already containing any visual signatures. */
  readonly pdf: Uint8Array;
  readonly certificateId?: string;
  readonly level?: PadesLevel;
  readonly reason?: string;
  readonly location?: string;
  readonly signerName?: string;
  /**
   * Name of the PDF signature field to sign into (`SignatureField.pdfName`). Without it the
   * service decides where the signature goes.
   */
  readonly fieldName?: string;
  /** Free-form data forwarded to the provider (tokens, workflow ids...). */
  readonly options?: Readonly<Record<string, unknown>>;
}

/** What a {@link DigitalSignatureProvider} returns. Check `cryptographic` before presenting a document as signed. */
export interface DigitalSignResult {
  readonly pdf: Uint8Array;
  /**
   * `true` only if a real cryptographic signature was applied. Simulated
   * providers must set this to `false`.
   */
  readonly cryptographic: boolean;
  readonly providerId: string;
  readonly signedAt: Date;
}

/** Applies a cryptographic signature to a PDF, usually by calling a backend or trust service. The library never performs cryptography itself. Register it with `withDigitalSigner()`. */
export interface DigitalSignatureProvider {
  readonly id: string;
  sign(request: DigitalSignRequest): Promise<DigitalSignResult>;
}
