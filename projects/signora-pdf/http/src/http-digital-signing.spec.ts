import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  DigitalSigningError,
  SIGNORA_CERTIFICATE_PROVIDER,
  SIGNORA_DIGITAL_SIGNER,
  provideSignora,
} from 'signora-pdf';
import { withHttpCertificateProvider, withHttpDigitalSigner } from './http-digital-signing';

const bytes = (value: string) => new TextEncoder().encode(value);
/** An ArrayBuffer created in the test realm (jsdom), as Angular's testing backend expects. */
function buffer(value: string): ArrayBuffer {
  const source = bytes(value);
  const out = new ArrayBuffer(source.length);
  new Uint8Array(out).set(source);
  return out;
}
const SIGNED = '%PDF-1.7 << /Type /Sig /ByteRange [0 1 2 3] >>';

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideSignora(
        withHttpDigitalSigner({
          signUrl: '/api/sign',
          headers: { 'X-Tenant': 'acme' },
          withCredentials: true,
        }),
        withHttpCertificateProvider({ url: '/api/certificates' }),
      ),
    ],
  });
  return {
    http: TestBed.inject(HttpTestingController),
    signer: TestBed.inject(SIGNORA_DIGITAL_SIGNER),
    certificates: TestBed.inject(SIGNORA_CERTIFICATE_PROVIDER),
  };
}

describe('HttpDigitalSignatureProvider', () => {
  it('uploads the PDF and metadata as multipart and returns the signed PDF', async () => {
    const { http, signer } = setup();
    const pending = signer.sign({
      pdf: bytes('%PDF-1.7 visual'),
      certificateId: 'cert-1',
      level: 'B-T',
      reason: 'Approval',
      signerName: 'Ada',
      fieldName: 'Client',
    });

    const req = http.expectOne('/api/sign');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('X-Tenant')).toBe('acme');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.responseType).toBe('arraybuffer');

    const form = req.request.body as FormData;
    expect(await readBlob(form.get('pdf') as Blob)).toBe('%PDF-1.7 visual');
    expect(JSON.parse(await readBlob(form.get('metadata') as Blob))).toEqual({
      certificateId: 'cert-1',
      level: 'B-T',
      reason: 'Approval',
      signerName: 'Ada',
      fieldName: 'Client',
    });

    req.flush(buffer(SIGNED));
    const result = await pending;
    expect(new TextDecoder().decode(result.pdf)).toBe(SIGNED);
    expect(result.cryptographic).toBe(true);
    expect(result.providerId).toBe('http');
    http.verify();
  });

  it('rejects a response that is not a PDF', async () => {
    const { http, signer } = setup();
    const pending = signer.sign({ pdf: bytes('%PDF-1.7') });
    http.expectOne('/api/sign').flush(buffer('<html>login</html>'));
    await expect(pending).rejects.toThrow(/did not return a PDF/);
  });

  it('rejects a PDF that carries no signature instead of reporting success', async () => {
    const { http, signer } = setup();
    const pending = signer.sign({ pdf: bytes('%PDF-1.7') });
    http.expectOne('/api/sign').flush(buffer('%PDF-1.7 unsigned'));
    await expect(pending).rejects.toThrow(/no digital signature/);
  });

  it('turns HTTP errors into DigitalSigningError with status and server message', async () => {
    const { http, signer } = setup();
    const pending = signer.sign({ pdf: bytes('%PDF-1.7') });
    http.expectOne('/api/sign').flush(buffer(JSON.stringify({ message: 'Certificate expired' })), {
      status: 422,
      statusText: 'Unprocessable',
    });
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DigitalSigningError);
    expect((error as DigitalSigningError).details.status).toBe(422);
    expect((error as Error).message).toContain('Certificate expired');
  });

  it('reports an unreachable service', async () => {
    const { http, signer } = setup();
    const pending = signer.sign({ pdf: bytes('%PDF-1.7') });
    http.expectOne('/api/sign').error(new ProgressEvent('error'));
    await expect(pending).rejects.toThrow(/unreachable/);
  });
});

describe('HttpCertificateProvider', () => {
  it('parses certificates and their dates', async () => {
    const { http, certificates } = setup();
    const pending = certificates.listCertificates();
    http.expectOne('/api/certificates').flush([
      {
        id: 'c1',
        subject: 'CN=Ada',
        issuer: 'CN=CA',
        validFrom: '2026-01-01T00:00:00Z',
        validTo: 'not a date',
      },
    ]);
    const [cert] = await pending;
    expect(cert.subject).toBe('CN=Ada');
    expect(cert.validFrom).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(cert.validTo).toBeUndefined();
  });

  it('rejects malformed responses', async () => {
    const { http, certificates } = setup();
    let pending = certificates.listCertificates();
    http.expectOne('/api/certificates').flush({ not: 'a list' });
    await expect(pending).rejects.toThrow(/did not return a list/);

    pending = certificates.listCertificates();
    http.expectOne('/api/certificates').flush([{ id: 'x' }]);
    await expect(pending).rejects.toThrow(/missing "id" or "subject"/);
  });
});
