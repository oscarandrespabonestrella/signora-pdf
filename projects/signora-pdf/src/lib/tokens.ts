import { InjectionToken } from '@angular/core';
import type {
  CertificateProvider,
  DigitalSignatureProvider,
  PdfRenderingPort,
  PdfWriterPort,
  SignatureProvider,
} from './ports';

/** Rendering engine used by the viewer. Provide it with `withRenderer()` or an adapter feature. */
export const SIGNORA_RENDERER = new InjectionToken<PdfRenderingPort>('SIGNORA_RENDERER');

/** Engine that embeds visual signatures into the PDF. */
export const SIGNORA_WRITER = new InjectionToken<PdfWriterPort>('SIGNORA_WRITER');

/** All registered visual signature providers (multi-provider). */
export const SIGNORA_SIGNATURE_PROVIDERS = new InjectionToken<readonly SignatureProvider[]>(
  'SIGNORA_SIGNATURE_PROVIDERS',
);

/** Cryptographic signing backend. Optional. */
export const SIGNORA_DIGITAL_SIGNER = new InjectionToken<DigitalSignatureProvider>(
  'SIGNORA_DIGITAL_SIGNER',
);

/** Source of signing certificates. Optional. */
export const SIGNORA_CERTIFICATE_PROVIDER = new InjectionToken<CertificateProvider>(
  'SIGNORA_CERTIFICATE_PROVIDER',
);
