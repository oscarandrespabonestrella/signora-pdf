import {
  makeEnvironmentProviders,
  type EnvironmentProviders,
  type Provider,
  type Type,
} from '@angular/core';
import type {
  CertificateProvider,
  DigitalSignatureProvider,
  PdfRenderingPort,
  PdfWriterPort,
  SignatureProvider,
} from './ports';
import { SigningWorkflow } from './digital';
import { SigningSession } from './session';
import {
  SIGNORA_CERTIFICATE_PROVIDER,
  SIGNORA_DIGITAL_SIGNER,
  SIGNORA_RENDERER,
  SIGNORA_SIGNATURE_PROVIDERS,
  SIGNORA_WRITER,
} from './tokens';

/** Role of a {@link SignoraFeature}. Only one feature of each kind (except `signature-provider`) may be passed to {@link provideSignora}. */
export type SignoraFeatureKind =
  | 'renderer'
  | 'writer'
  | 'signature-provider'
  | 'digital-signer'
  | 'certificate-provider'
  | (string & {});

/**
 * A configurable piece of the SDK, passed to {@link provideSignora}. Adapter
 * packages (and your own code) create features with {@link createSignoraFeature}.
 */
export interface SignoraFeature {
  readonly kind: SignoraFeatureKind;
  readonly providers: readonly Provider[];
}

export function createSignoraFeature(
  kind: SignoraFeatureKind,
  providers: readonly Provider[],
): SignoraFeature {
  return { kind, providers };
}

/**
 * Registers the SDK in the application's injector.
 *
 * ```ts
 * provideSignora(
 *   withPdfJsRenderer({ workerSrc: '/pdf.worker.min.mjs' }),
 *   withPdfLibWriter(),
 *   withSignatureProvider(MyOrganizationSignatures),
 * )
 * ```
 */
export function provideSignora(...features: readonly SignoraFeature[]): EnvironmentProviders {
  const kinds = new Set<string>();
  for (const feature of features) {
    if (kinds.has(feature.kind) && feature.kind !== 'signature-provider') {
      throw new Error(`provideSignora(): feature "${feature.kind}" was provided more than once.`);
    }
    kinds.add(feature.kind);
  }
  return makeEnvironmentProviders([
    SigningSession,
    SigningWorkflow,
    ...features.flatMap((f) => f.providers),
  ]);
}

/** Uses a custom rendering engine implementing {@link PdfRenderingPort}. */
export function withRenderer(renderer: Type<PdfRenderingPort>): SignoraFeature {
  return createSignoraFeature('renderer', [{ provide: SIGNORA_RENDERER, useClass: renderer }]);
}

/** Uses a custom PDF writer implementing {@link PdfWriterPort}. */
export function withWriter(writer: Type<PdfWriterPort>): SignoraFeature {
  return createSignoraFeature('writer', [{ provide: SIGNORA_WRITER, useClass: writer }]);
}

/** Registers a visual signature provider. Can be used several times. */
export function withSignatureProvider(provider: Type<SignatureProvider>): SignoraFeature {
  return createSignoraFeature('signature-provider', [
    { provide: SIGNORA_SIGNATURE_PROVIDERS, useClass: provider, multi: true },
  ]);
}

/** Registers the backend used for cryptographic signing. */
export function withDigitalSigner(signer: Type<DigitalSignatureProvider>): SignoraFeature {
  return createSignoraFeature('digital-signer', [
    { provide: SIGNORA_DIGITAL_SIGNER, useClass: signer },
  ]);
}

/** Registers the source of signing certificates. */
export function withCertificateProvider(provider: Type<CertificateProvider>): SignoraFeature {
  return createSignoraFeature('certificate-provider', [
    { provide: SIGNORA_CERTIFICATE_PROVIDER, useClass: provider },
  ]);
}
