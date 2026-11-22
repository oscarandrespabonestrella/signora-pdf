import type { NormalizedRect } from './geometry';

/**
 * A reserved, named area of a page that is filled with a signature. Unlike a free
 * placement, a field says *where* a signature is expected, and can be required.
 * Fields are stored in normalized page coordinates, like placements.
 */
export interface SignatureField {
  readonly id: string;
  /** Zero-based page index. */
  readonly pageIndex: number;
  /** Area of the field, as fractions (0..1) of the visual page, origin top-left. */
  readonly rect: NormalizedRect;
  /** Name shown on the field and used by assistive technology, e.g. `Client signature`. */
  readonly label?: string;
  /** A required field must be filled before exporting with `requireAllFields`. */
  readonly required?: boolean;
  /** Who is expected to sign it. Not enforced here: for your own workflow. */
  readonly signerId?: string;
}
