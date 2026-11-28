import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFString, type PDFObject } from 'pdf-lib';

type Entries = Record<string, PDFObject | string | number | number[]>;

/** One signature field to put in a synthetic test PDF. */
export interface FixtureSignature {
  readonly name: string;
  /** Leave the field empty (no `/V`). */
  readonly empty?: boolean;
  readonly pageIndex?: number;
  /** Widget rectangle in PDF points. */
  readonly rect?: readonly [number, number, number, number];
  readonly reason?: string;
  readonly signerName?: string;
  readonly signingDate?: string;
  readonly subFilter?: string;
  /** Field flag: must be filled. */
  readonly required?: boolean;
  /** `/TU`, the user-facing name of the field. */
  readonly alternateName?: string;
  /** Lock form fields after signing (FieldMDP, as a `/Lock` entry of the field). */
  readonly lock?: {
    readonly action: 'All' | 'Include' | 'Exclude';
    readonly fields?: readonly string[];
  };
  /** Certify the document (DocMDP) with this permission level. */
  readonly docMdp?: 1 | 2 | 3;
  /** `DocTimeStamp` instead of `Sig`. */
  readonly timestamp?: boolean;
  /** DER bytes to place in `/Contents` (default: a tiny valid SEQUENCE). */
  readonly contents?: Uint8Array;
  /** Last signed byte: `'whole'` (default) or an absolute offset to simulate a signature over an earlier revision. */
  readonly signedUntil?: 'whole' | number;
}

export interface BuiltFixture {
  readonly pdf: Uint8Array;
  readonly contentsRanges: readonly { start: number; end: number }[];
  /** Final `/ByteRange` of each non-empty signature, in file order. */
  readonly byteRanges: readonly (readonly [number, number, number, number])[];
}

const DEFAULT_RESERVED_BYTES = 64;
const PLACEHOLDER = '9999999999';

/**
 * Builds a PDF with signature fields whose `/ByteRange` is consistent with the file. The
 * `/Contents` is NOT a real signature: use it to test structure reading, never validation.
 */
export async function buildSignatureFixture(
  signatures: readonly FixtureSignature[],
  pageSizes: readonly (readonly [number, number])[] = [[595, 842]],
  reservedBytes = DEFAULT_RESERVED_BYTES,
  extras: { readonly formFields?: readonly { name: string; value?: string }[] } = {},
): Promise<BuiltFixture> {
  const doc = await PDFDocument.create();
  const pages = pageSizes.map((size) => doc.addPage([size[0], size[1]]));
  const context = doc.context;

  const fieldRefs = [];
  let certification: ReturnType<typeof context.register> | undefined;
  const live: FixtureSignature[] = [];
  for (const signature of signatures) {
    const page = pages[signature.pageIndex ?? 0];
    const widget: Entries = {
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: PDFString.of(signature.name),
      Rect: [...(signature.rect ?? [50, 50, 250, 110])],
      F: 132,
      P: page.ref,
    };
    if (signature.required) widget['Ff'] = 2;
    if (signature.lock) {
      widget['Lock'] = context.obj({
        Type: 'SigFieldLock',
        Action: signature.lock.action,
        Fields: (signature.lock.fields ?? []).map((name) => PDFString.of(name)),
      } as never);
    }
    if (signature.alternateName) widget['TU'] = PDFString.of(signature.alternateName);
    if (!signature.empty) {
      const contents = signature.contents ?? new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x05]);
      const padded = new Uint8Array(reservedBytes);
      padded.set(contents);
      const value: Entries = {
        Type: signature.timestamp ? 'DocTimeStamp' : 'Sig',
        Filter: 'Adobe.PPKLite',
        SubFilter:
          signature.subFilter ?? (signature.timestamp ? 'ETSI.RFC3161' : 'ETSI.CAdES.detached'),
        ByteRange: [PLACEHOLDER, PLACEHOLDER, PLACEHOLDER, PLACEHOLDER].map(Number),
        Contents: PDFHexString.of(
          Array.from(padded, (b) => b.toString(16).padStart(2, '0')).join(''),
        ),
      };
      if (!signature.timestamp) {
        value['M'] = PDFString.of(signature.signingDate ?? "D:20260115103000+01'00'");
        if (signature.reason) value['Reason'] = PDFString.of(signature.reason);
        if (signature.signerName) value['Name'] = PDFString.of(signature.signerName);
      }
      if (signature.docMdp) {
        value['Reference'] = [
          {
            Type: 'SigRef',
            TransformMethod: 'DocMDP',
            TransformParams: { Type: 'TransformParams', P: signature.docMdp, V: '1.2' },
          },
        ] as never;
      }
      const valueRef = context.register(context.obj(value));
      widget['V'] = valueRef;
      if (signature.docMdp) certification = valueRef;
    }
    const ref = context.register(context.obj(widget));
    fieldRefs.push(ref);
    live.push(signature);

    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) annots.push(ref);
    else page.node.set(PDFName.of('Annots'), context.obj([ref]));
  }

  // Plain text fields, to have something to fill in after signing.
  (extras.formFields ?? []).forEach((field, index) => {
    const page = pages[0];
    const widget: Entries = {
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Tx',
      T: PDFString.of(field.name),
      Rect: [50, 400 - index * 40, 250, 430 - index * 40],
      F: 4,
      P: page.ref,
      DA: PDFString.of('/Helv 0 Tf 0 g'),
    };
    if (field.value !== undefined) widget['V'] = PDFString.of(field.value);
    const ref = context.register(context.obj(widget));
    fieldRefs.push(ref);
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) annots.push(ref);
    else page.node.set(PDFName.of('Annots'), context.obj([ref]));
  });

  doc.catalog.set(PDFName.of('AcroForm'), context.obj({ Fields: fieldRefs, SigFlags: 3 }));
  if (certification) doc.catalog.set(PDFName.of('Perms'), context.obj({ DocMDP: certification }));

  const bytes = await doc.save({ useObjectStreams: false });
  return patchByteRanges(bytes, live);
}

function patchByteRanges(bytes: Uint8Array, signatures: readonly FixtureSignature[]): BuiltFixture {
  const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const contentsRanges: { start: number; end: number }[] = [];
  const byteRanges: [number, number, number, number][] = [];
  const signed = signatures.filter((s) => !s.empty);

  let cursor = 0;
  const contentsMarker = text('/Contents <');
  const placeholders: { start: number; end: number }[] = [];
  signed.forEach(() => {
    const at = indexOf(bytes, contentsMarker, cursor);
    if (at < 0) throw new Error('Contents not found in fixture');
    const start = at + contentsMarker.length - 1; // offset of '<'
    const end = bytes.indexOf(0x3e, start) + 1; // after '>'
    contentsRanges.push({ start, end });
    cursor = end;
  });
  // The pdf-lib writer emits `/ByteRange [ 9999999999 ... ]` for each signature, in the same order.
  let searchFrom = 0;
  const brMarker = text('/ByteRange [');
  signed.forEach(() => {
    const at = indexOf(bytes, brMarker, searchFrom);
    if (at < 0) throw new Error('ByteRange not found in fixture');
    const open = at + brMarker.length;
    const close = bytes.indexOf(0x5d, open);
    placeholders.push({ start: open, end: close });
    searchFrom = close;
  });

  // Both lists follow the file order, which is registration order.
  for (let n = 0; n < signed.length; n++) {
    const { start, end } = contentsRanges[n];
    const until = signed[n].signedUntil ?? 'whole';
    const total = until === 'whole' ? bytes.length : until;
    const values: [number, number, number, number] = [0, start, end, total - end];
    byteRanges.push(values);
    const region = placeholders[n];
    const fixed = values.map((v) => String(v).padStart(PLACEHOLDER.length, '0')).join(' ');
    const original = new TextDecoder().decode(bytes.subarray(region.start, region.end)).trim();
    if (original.replace(/\s+/g, ' ').length !== fixed.length) {
      throw new Error(`Unexpected /ByteRange placeholder width: "${original}"`);
    }
    const padded = new TextEncoder().encode(
      ' ' + fixed + ' '.repeat(region.end - region.start - fixed.length - 1),
    );
    bytes.set(padded, region.start);
  }
  return { pdf: bytes, contentsRanges, byteRanges };
}

function indexOf(bytes: Uint8Array, needle: number[], from: number): number {
  outer: for (let i = from; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
