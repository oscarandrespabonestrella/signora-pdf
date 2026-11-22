import type { SignatureAsset } from '../models';

/**
 * A source of visual signatures (draw pad, typed text, uploads, organisation
 * stamps...). Register implementations with `withSignatureProvider()`.
 */
export interface SignatureProvider {
  /** Stable identifier, e.g. `draw`, `type`, `organization`. */
  readonly id: string;
  /** Human readable name for tabs and menus. */
  readonly label: string;
  /** Assets available without user interaction (e.g. organisation stamps). */
  listAssets?(): Promise<readonly SignatureAsset[]>;
}
