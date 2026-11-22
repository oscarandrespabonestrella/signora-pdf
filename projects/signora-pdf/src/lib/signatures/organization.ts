import { SIGNORA_SIGNATURE_PROVIDERS } from '../tokens';
import type { SignatureAsset } from '../models';
import type { SignatureProvider } from '../ports';
import { createSignoraFeature, type SignoraFeature } from '../providers';

/** Options of {@link withOrganizationSignatures}. */
export interface OrganizationSignaturesOptions {
  /** Predefined signatures, logos and stamps, or an async loader (e.g. from your API). */
  readonly assets: readonly SignatureAsset[] | (() => Promise<readonly SignatureAsset[]>);
  /** Tab label. Defaults to `Organization`. */
  readonly label?: string;
  /** Provider id. Defaults to `organization`; use distinct ids to register several. */
  readonly id?: string;
}

/**
 * Registers predefined organization signatures, logos and stamps as a
 * {@link SignatureProvider}. Assets should be PNG/JPEG data URLs so they can be
 * embedded in the PDF.
 */
export function withOrganizationSignatures(options: OrganizationSignaturesOptions): SignoraFeature {
  const { assets } = options;
  const provider: SignatureProvider = {
    id: options.id ?? 'organization',
    label: options.label ?? 'Organization',
    listAssets: () => (typeof assets === 'function' ? assets() : Promise.resolve(assets)),
  };
  return createSignoraFeature('signature-provider', [
    { provide: SIGNORA_SIGNATURE_PROVIDERS, useValue: provider, multi: true },
  ]);
}
