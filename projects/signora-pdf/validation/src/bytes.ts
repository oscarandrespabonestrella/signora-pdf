/** Lower-case hexadecimal. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Decodes a hexadecimal string (whitespace ignored). Returns `undefined` if it is not valid hex. */
export function fromHex(text: string): Uint8Array | undefined {
  const clean = text.replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) return undefined;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * `/Contents` is zero padded up to the reserved size; keep exactly the DER object. Returns the
 * bytes untouched when they do not start with a DER sequence.
 */
export function trimDer(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 2 || bytes[0] !== 0x30) return bytes;
  const first = bytes[1];
  let length: number;
  let header: number;
  if (first < 0x80) {
    length = first;
    header = 2;
  } else {
    const count = first & 0x7f;
    if (count === 0 || count > 4 || bytes.length < 2 + count) return bytes;
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + bytes[2 + i];
    header = 2 + count;
  }
  const total = header + length;
  return total <= bytes.length ? bytes.subarray(0, total) : bytes;
}

/** `true` if both arrays hold the same bytes. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
