import { looksLikePdf, type PdfSignatureInfo } from 'signora-pdf';
import { collectSignatureFields, type SignatureFieldRecord } from 'signora-pdf/pdf-lib';
import type { PDFDict } from 'pdf-lib';
import { trimDer } from './bytes';

/** The bytes are not a PDF, or its structure cannot be read. */
export class PdfInspectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PdfInspectionError';
  }
}

/** Options of {@link inspectPdfSignatures}. */
export interface InspectOptions {
  /** Also list signature fields nobody has signed yet. Default `true`. */
  readonly includeUnsigned?: boolean;
}

/**
 * Lists the signature fields of a PDF and what each declares: byte range, `SubFilter`, signing
 * time, reason, page and position, and the CMS container. It performs **no cryptography**; use
 * the results as input for validation, never as proof that anything is signed correctly.
 *
 * The PDF is only read; it is never modified. Requires the optional peer dependency `pdf-lib`.
 *
 * @throws {PdfInspectionError} if the bytes are not a readable PDF.
 */
export async function inspectPdfSignatures(
  pdf: Uint8Array,
  options: InspectOptions = {},
): Promise<readonly PdfSignatureInfo[]> {
  if (!looksLikePdf(pdf)) throw new PdfInspectionError('The bytes are not a PDF document.');

  const lib = await import('pdf-lib');
  let document: Awaited<ReturnType<typeof lib.PDFDocument.load>>;
  try {
    document = await lib.PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  } catch (cause) {
    throw new PdfInspectionError('The PDF structure could not be read.', { cause });
  }

  let records: SignatureFieldRecord[];
  try {
    records = collectSignatureFields(lib, document);
  } catch (cause) {
    // Failing closed: a signature field that cannot be read must not be silently skipped.
    throw new PdfInspectionError('A signature field could not be read.', { cause });
  }

  const eofOffsets = findAll(pdf, '%%EOF');
  const { PDFName, PDFArray, PDFHexString, PDFString, PDFNumber } = lib;
  const text = (object: unknown): string | undefined =>
    object instanceof PDFString || object instanceof PDFHexString ? object.decodeText() : undefined;
  const name = (object: unknown): string | undefined =>
    object instanceof PDFName ? object.decodeText() : undefined;

  const readByteRange = (value: PDFDict): PdfSignatureInfo['byteRange'] => {
    const array = value.lookupMaybe(PDFName.of('ByteRange'), PDFArray);
    if (!array || array.size() !== 4) return undefined;
    const numbers: number[] = [];
    for (let i = 0; i < 4; i++) {
      const n = array.lookup(i);
      if (!(n instanceof PDFNumber)) return undefined;
      numbers.push(n.asNumber());
    }
    return numbers as unknown as [number, number, number, number];
  };

  const found: Omit<PdfSignatureInfo, 'index'>[] = records.map((record) => {
    const position = { pageIndex: record.pageIndex, rect: record.rect };
    const value = record.value;
    if (!value) return { fieldName: record.name, kind: 'signature', signed: false, ...position };

    const subFilter = name(value.lookup(PDFName.of('SubFilter')));
    const kind =
      name(value.lookup(PDFName.of('Type'))) === 'DocTimeStamp' || subFilter === 'ETSI.RFC3161'
        ? 'document-timestamp'
        : 'signature';
    const byteRange = readByteRange(value);
    const contentsObject = value.lookup(PDFName.of('Contents'));
    const contents =
      contentsObject instanceof PDFHexString || contentsObject instanceof PDFString
        ? trimDer(contentsObject.asBytes())
        : undefined;
    const end = byteRange ? byteRange[2] + byteRange[3] : undefined;
    return {
      fieldName: record.name,
      kind,
      signed: true,
      filter: name(value.lookup(PDFName.of('Filter'))),
      subFilter,
      byteRange,
      byteRangeWellFormed: byteRange ? isWellFormed(pdf, byteRange) : false,
      contents,
      signingTime: parsePdfDate(text(value.lookup(PDFName.of('M')))),
      signerName: text(value.lookup(PDFName.of('Name'))),
      reason: text(value.lookup(PDFName.of('Reason'))),
      location: text(value.lookup(PDFName.of('Location'))),
      contactInfo: text(value.lookup(PDFName.of('ContactInfo'))),
      ...position,
      revision: end === undefined ? undefined : eofOffsets.filter((o) => o < end).length,
      coversWholeDocument: end === undefined ? undefined : coversAll(pdf, end),
    };
  });

  const includeUnsigned = options.includeUnsigned ?? true;
  return found
    .filter((s) => includeUnsigned || s.signed)
    .sort((a, b) => {
      const ea = a.byteRange ? a.byteRange[2] + a.byteRange[3] : Number.POSITIVE_INFINITY;
      const eb = b.byteRange ? b.byteRange[2] + b.byteRange[3] : Number.POSITIVE_INFINITY;
      return ea - eb;
    })
    .map((s, index) => ({ ...s, index }));
}

/** Start offsets of every occurrence of an ASCII needle. */
function findAll(bytes: Uint8Array, needle: string): number[] {
  const codes = Array.from(needle, (c) => c.charCodeAt(0));
  const result: number[] = [];
  outer: for (let i = 0; i <= bytes.length - codes.length; i++) {
    for (let j = 0; j < codes.length; j++) if (bytes[i + j] !== codes[j]) continue outer;
    result.push(i);
  }
  return result;
}

/** Expected `/ByteRange` shape: `[0, a, b, c]` with the gap being exactly the `<hex>` of `/Contents`. */
function isWellFormed(pdf: Uint8Array, [s1, l1, s2, l2]: readonly number[]): boolean {
  if (![s1, l1, s2, l2].every((n) => Number.isInteger(n) && n >= 0)) return false;
  if (s1 !== 0 || l1 === 0 || s2 <= l1 || l2 < 0 || s2 + l2 > pdf.length) return false;
  return pdf[l1] === 0x3c /* < */ && pdf[s2 - 1] === 0x3e; /* > */
}

/** `true` if nothing but whitespace follows the signed bytes. */
function coversAll(pdf: Uint8Array, end: number): boolean {
  if (end > pdf.length) return false;
  for (let i = end; i < pdf.length; i++) {
    const c = pdf[i];
    if (c !== 0x0a && c !== 0x0d && c !== 0x20 && c !== 0x00) return false;
  }
  return true;
}

/** Parses a PDF date string (`D:YYYYMMDDHHmmSSOHH'mm'`). Returns `undefined` if it is malformed. */
export function parsePdfDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const m =
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Zz+-])(?:(\d{2})'?(?:(\d{2})'?)?)?)?/.exec(
      value.trim(),
    );
  if (!m) return undefined;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', sign, oh = '00', om = '00'] = m;
  // Date.UTC rolls over (month 13 becomes January): reject out-of-range fields instead.
  if (+mo < 1 || +mo > 12 || +d < 1 || +h > 23 || +mi > 59 || +s > 59 || +oh > 23 || +om > 59) {
    return undefined;
  }
  let time = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (new Date(time).getUTCDate() !== +d) return undefined; // e.g. 31 February
  if (sign === '+' || sign === '-') {
    const offset = (+oh * 60 + +om) * 60_000;
    time += sign === '+' ? -offset : offset;
  }
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
