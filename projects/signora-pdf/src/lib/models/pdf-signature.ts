import type { NormalizedRect } from './geometry';

/** Kind of signature field found in a PDF. */
export type PdfSignatureKind = 'signature' | 'document-timestamp';

/**
 * What a PDF says about one of its signature fields. This is **declared data read from the file**:
 * nothing here means the signature is valid or trusted. Validation is a separate step.
 */
export interface PdfSignatureInfo {
  /** Position in signing order (earliest revision first); unsigned fields come last. */
  readonly index: number;
  /** Fully qualified AcroForm field name (`/T` joined with dots). */
  readonly fieldName: string;
  /** An ordinary signature, or an RFC 3161 document timestamp (PAdES-LTA). */
  readonly kind: PdfSignatureKind;
  /** `false` for an empty signature field that nobody has signed yet. */
  readonly signed: boolean;
  /** `/Filter`, e.g. `Adobe.PPKLite`. */
  readonly filter?: string;
  /** `/SubFilter`, e.g. `ETSI.CAdES.detached` (PAdES) or `adbe.pkcs7.detached`. */
  readonly subFilter?: string;
  /** `/ByteRange` as `[start1, length1, start2, length2]`. */
  readonly byteRange?: readonly [number, number, number, number];
  /**
   * `true` when the byte range has the expected shape: it starts at 0, leaves a single gap exactly
   * around the `/Contents` hex string and stays inside the file. `false` is a strong warning sign.
   */
  readonly byteRangeWellFormed?: boolean;
  /** The CMS/PKCS#7 container (DER), trimmed of the zero padding. */
  readonly contents?: Uint8Array;
  /** Signing time claimed in `/M` (not trustworthy by itself; a timestamp token is). */
  readonly signingTime?: Date;
  readonly signerName?: string;
  readonly reason?: string;
  readonly location?: string;
  readonly contactInfo?: string;
  /** Zero-based page holding the signature widget, when it has one. */
  readonly pageIndex?: number;
  /** Widget rectangle in normalized page coordinates (same space as placements). */
  readonly rect?: NormalizedRect;
  /** One-based revision (count of `%%EOF` markers up to the end of the signed bytes). */
  readonly revision?: number;
  /** `true` if the signature covers every byte of the file, `false` if bytes were appended after it. */
  readonly coversWholeDocument?: boolean;
}
