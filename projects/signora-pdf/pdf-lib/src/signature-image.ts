import type { SignatureAsset } from 'signora-pdf';

/** A signature asset could not be decoded into an embeddable image. */
export class UnsupportedSignatureImageError extends Error {
  constructor(assetId: string) {
    super(`Signature asset "${assetId}" is not a PNG or JPEG data URL.`);
    this.name = 'UnsupportedSignatureImageError';
  }
}

/** The raw bytes and format of a signature image. */
export interface DecodedSignatureImage {
  readonly format: 'png' | 'jpg';
  readonly bytes: Uint8Array;
}

/** Decodes the `data:` URL of a signature asset (PNG or JPEG). */
export function decodeSignatureImage(asset: SignatureAsset): DecodedSignatureImage {
  const match = /^data:image\/(png|jpe?g);base64,(.*)$/s.exec(asset.dataUrl);
  if (!match) throw new UnsupportedSignatureImageError(asset.id);
  return {
    format: match[1] === 'png' ? 'png' : 'jpg',
    bytes: Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)),
  };
}
