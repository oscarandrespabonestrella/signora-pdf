/**
 * Cheap check for an existing signature dictionary: every PDF signature has a
 * `/ByteRange` entry. This is a sanity check, **not** signature verification:
 * it says nothing about whether a signature is valid or trusted.
 */
export function hasDigitalSignature(pdf: Uint8Array): boolean {
  const needle = new TextEncoder().encode('/ByteRange');
  outer: for (let i = 0; i <= pdf.length - needle.length; i++) {
    if (pdf[i] !== needle[0]) continue;
    for (let j = 1; j < needle.length; j++) {
      if (pdf[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** `true` when the bytes start with the `%PDF-` header. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}
