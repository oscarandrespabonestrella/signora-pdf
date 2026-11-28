import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import {
  DigitalSigningError,
  SIGNORA_CERTIFICATE_PROVIDER,
  SIGNORA_DIGITAL_SIGNER,
  createSignoraFeature,
  hasDigitalSignature,
  looksLikePdf,
  type CertificateInfo,
  type CertificateProvider,
  type DigitalSignRequest,
  type DigitalSignResult,
  type DigitalSignatureProvider,
  type SignoraFeature,
} from 'signora-pdf';
import { firstValueFrom } from 'rxjs';

interface HttpRequestOptions {
  /** Extra headers, e.g. `{ 'X-Tenant': 'acme' }`. Prefer an `HttpClient` interceptor for auth. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Send cookies with cross-origin requests. */
  readonly withCredentials?: boolean;
}

/** Options of {@link withHttpDigitalSigner}. */
export interface HttpSigningOptions extends HttpRequestOptions {
  /** Endpoint that signs a PDF. See `docs/digital-signing.md` for the contract. */
  readonly signUrl: string;
  /** Provider id reported in results. Defaults to `http`. */
  readonly id?: string;
}

/** Options of {@link withHttpCertificateProvider}. */
export interface HttpCertificatesOptions extends HttpRequestOptions {
  /** Endpoint returning the list of certificates the user may sign with. */
  readonly url: string;
  readonly id?: string;
}

/** Injection token holding the {@link HttpSigningOptions}. Set by {@link withHttpDigitalSigner}. */
export const SIGNORA_HTTP_SIGNING_OPTIONS = new InjectionToken<HttpSigningOptions>(
  'SIGNORA_HTTP_SIGNING_OPTIONS',
);
/** Injection token holding the {@link HttpCertificatesOptions}. Set by {@link withHttpCertificateProvider}. */
export const SIGNORA_HTTP_CERTIFICATES_OPTIONS = new InjectionToken<HttpCertificatesOptions>(
  'SIGNORA_HTTP_CERTIFICATES_OPTIONS',
);

/**
 * Sends the PDF to your backend (or a remote trust service) to be digitally
 * signed, e.g. with PAdES. **All cryptography happens on the server.**
 *
 * Request: `POST` `multipart/form-data` with a `pdf` file part and a `metadata`
 * JSON part (`certificateId`, `level`, `reason`, `location`, `signerName`, `fieldName`, `options`).
 * Response: the signed PDF as `application/pdf`.
 *
 * The response is checked to be a PDF that contains a signature dictionary
 * (`/ByteRange`). That is a sanity check, not validation: verify signatures
 * on the server.
 */
@Injectable()
export class HttpDigitalSignatureProvider implements DigitalSignatureProvider {
  private readonly http = inject(HttpClient);
  private readonly options = inject(SIGNORA_HTTP_SIGNING_OPTIONS);

  get id(): string {
    return this.options.id ?? 'http';
  }

  async sign(request: DigitalSignRequest): Promise<DigitalSignResult> {
    const { pdf, ...metadata } = request;
    const body = new FormData();
    body.append('pdf', new Blob([pdf as BlobPart], { type: 'application/pdf' }), 'document.pdf');
    body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));

    let signed: Uint8Array;
    try {
      const buffer = await firstValueFrom(
        this.http.post(this.options.signUrl, body, {
          responseType: 'arraybuffer',
          headers: this.options.headers ? { ...this.options.headers } : undefined,
          withCredentials: this.options.withCredentials,
        }),
      );
      signed = new Uint8Array(buffer);
    } catch (error) {
      throw toSigningError(error, 'The signing service rejected the request.');
    }

    if (!looksLikePdf(signed)) {
      throw new DigitalSigningError('The signing service did not return a PDF.');
    }
    if (!hasDigitalSignature(signed)) {
      throw new DigitalSigningError(
        'The signing service returned a PDF that contains no digital signature.',
      );
    }
    return { pdf: signed, cryptographic: true, providerId: this.id, signedAt: new Date() };
  }
}

/**
 * Lists signing certificates from your backend. Expects a JSON array of
 * `{ id, subject, issuer?, validFrom?, validTo?, metadata? }` with ISO dates.
 */
@Injectable()
export class HttpCertificateProvider implements CertificateProvider {
  private readonly http = inject(HttpClient);
  private readonly options = inject(SIGNORA_HTTP_CERTIFICATES_OPTIONS);

  get id(): string {
    return this.options.id ?? 'http';
  }

  async listCertificates(): Promise<readonly CertificateInfo[]> {
    let raw: unknown;
    try {
      raw = await firstValueFrom(
        this.http.get<unknown>(this.options.url, {
          headers: this.options.headers ? { ...this.options.headers } : undefined,
          withCredentials: this.options.withCredentials,
        }),
      );
    } catch (error) {
      throw toSigningError(error, 'The certificate list could not be loaded.');
    }
    if (!Array.isArray(raw)) {
      throw new DigitalSigningError('The certificate service did not return a list.');
    }
    return raw.map(parseCertificate);
  }
}

function parseCertificate(value: unknown): CertificateInfo {
  const entry = value as Record<string, unknown> | null;
  if (!entry || typeof entry['id'] !== 'string' || typeof entry['subject'] !== 'string') {
    throw new DigitalSigningError('A certificate entry is missing "id" or "subject".');
  }
  const date = (field: string): Date | undefined => {
    const raw = entry[field];
    const parsed = typeof raw === 'string' ? new Date(raw) : undefined;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  };
  return {
    id: entry['id'],
    subject: entry['subject'],
    issuer: typeof entry['issuer'] === 'string' ? entry['issuer'] : undefined,
    validFrom: date('validFrom'),
    validTo: date('validTo'),
    metadata: (entry['metadata'] as Record<string, unknown> | undefined) ?? undefined,
  };
}

function toSigningError(error: unknown, fallback: string): DigitalSigningError {
  if (error instanceof DigitalSigningError) return error;
  if (error instanceof HttpErrorResponse) {
    const detail = readErrorMessage(error.error);
    const reason =
      error.status === 0
        ? 'The signing service is unreachable.'
        : `${fallback} (HTTP ${error.status}${detail ? `: ${detail}` : ''})`;
    return new DigitalSigningError(reason, { status: error.status, cause: error });
  }
  return new DigitalSigningError(fallback, { cause: error });
}

/** Error bodies arrive as an `ArrayBuffer` because of `responseType: 'arraybuffer'`. */
function readErrorMessage(body: unknown): string | undefined {
  let text: string | undefined;
  // Tag check instead of instanceof: buffers can come from another realm (iframes, workers).
  if (Object.prototype.toString.call(body) === '[object ArrayBuffer]') {
    text = new TextDecoder().decode(body as ArrayBuffer);
  } else if (typeof body === 'string') text = body;
  if (!text) return undefined;
  try {
    const json = JSON.parse(text) as { message?: unknown };
    if (typeof json.message === 'string') return json.message.slice(0, 200);
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return text.slice(0, 200);
}

/** Signs through an HTTP backend. Requires `provideHttpClient()` in your application. */
export function withHttpDigitalSigner(options: HttpSigningOptions): SignoraFeature {
  return createSignoraFeature('digital-signer', [
    { provide: SIGNORA_HTTP_SIGNING_OPTIONS, useValue: options },
    { provide: SIGNORA_DIGITAL_SIGNER, useClass: HttpDigitalSignatureProvider },
  ]);
}

/** Lists certificates through an HTTP backend. Requires `provideHttpClient()`. */
export function withHttpCertificateProvider(options: HttpCertificatesOptions): SignoraFeature {
  return createSignoraFeature('certificate-provider', [
    { provide: SIGNORA_HTTP_CERTIFICATES_OPTIONS, useValue: options },
    { provide: SIGNORA_CERTIFICATE_PROVIDER, useClass: HttpCertificateProvider },
  ]);
}
