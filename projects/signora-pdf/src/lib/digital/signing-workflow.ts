import { Injectable, inject, signal } from '@angular/core';
import type {
  CertificateInfo,
  DigitalSignRequest,
  DigitalSignResult,
  DigitalSignatureProvider,
} from '../ports';
import { SigningSession, type ExportPdfOptions } from '../session';
import { SIGNORA_CERTIFICATE_PROVIDER, SIGNORA_DIGITAL_SIGNER } from '../tokens';
import { DigitalSigningError } from './errors';
import { hasDigitalSignature, looksLikePdf } from './pdf-signature-detection';

/** Options of {@link SigningWorkflow.sign}. */
export interface SignDocumentOptions extends Omit<DigitalSignRequest, 'pdf'> {
  /** Signs with this provider instead of the one registered with `withDigitalSigner()`. */
  readonly provider?: DigitalSignatureProvider;
  /**
   * Options of the visual export that runs first (see {@link SigningSession.exportPdf}). Use
   * `{ createFields: true }` to write fields that exist only in the session before signing into
   * one of them with `fieldName`, and `{ requireAllFields: true }` to refuse to sign while a
   * required field is empty. Not sent to the provider.
   */
  readonly export?: ExportPdfOptions;
}

/**
 * Orchestrates the two independent stages of signing a document:
 *
 * 1. visual signatures are embedded with the registered writer, then
 * 2. the resulting bytes are handed to a {@link DigitalSignatureProvider}.
 *
 * The digital signature is applied last so that it covers the visual content.
 * Cryptography is never done here: it is delegated to the provider.
 */
@Injectable()
export class SigningWorkflow {
  private readonly session = inject(SigningSession);
  private readonly defaultSigner = inject(SIGNORA_DIGITAL_SIGNER, { optional: true });
  private readonly certificates = inject(SIGNORA_CERTIFICATE_PROVIDER, { optional: true });

  private readonly _busy = signal(false);
  /** `true` while a signing request is in flight. */
  readonly busy = this._busy.asReadonly();

  /** Certificates offered by the registered certificate provider (empty if none). */
  async listCertificates(): Promise<readonly CertificateInfo[]> {
    return this.certificates ? this.certificates.listCertificates() : [];
  }

  /**
   * Exports the document with its visual signatures and digitally signs it.
   * The loaded document is not modified.
   *
   * @throws {MissingSignatureFieldsError} with `export.requireAllFields` while a required field is empty.
   * @throws {DigitalSigningError} if no signer is available, or if a provider claims to have
   * produced a cryptographic signature but returned something that is not a signed PDF.
   */
  async sign(options: SignDocumentOptions = {}): Promise<DigitalSignResult> {
    const { provider, export: exportOptions, ...request } = options;
    const signer = provider ?? this.defaultSigner;
    if (!signer) {
      throw new DigitalSigningError(
        'No digital signature provider is registered. Add withDigitalSigner() to provideSignora().',
      );
    }

    this._busy.set(true);
    try {
      const pdf = await this.session.exportPdf(exportOptions);
      const result = await signer.sign({ ...request, pdf });

      if (!looksLikePdf(result.pdf)) {
        throw new DigitalSigningError(`Provider "${signer.id}" did not return a PDF.`);
      }
      if (result.cryptographic && !hasDigitalSignature(result.pdf)) {
        throw new DigitalSigningError(
          `Provider "${signer.id}" reported a cryptographic signature, but the returned PDF contains none.`,
        );
      }
      return result;
    } finally {
      this._busy.set(false);
    }
  }
}
