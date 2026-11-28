import type { PDFContext, PDFDocument, PDFObject, PDFRef } from 'pdf-lib';

type PdfLib = typeof import('pdf-lib');

/** An incremental update could not be written. */
export class IncrementalUpdateError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IncrementalUpdateError';
  }
}

/** The PDF is encrypted: new objects would have to be encrypted too, which is not supported. */
export class EncryptedPdfError extends IncrementalUpdateError {
  constructor() {
    super('The PDF is encrypted; incremental updates of encrypted documents are not supported.');
    this.name = 'EncryptedPdfError';
  }
}

/**
 * The document carries a certification (DocMDP) signature whose permission level does not allow
 * the change. Appending it would make readers flag the document as modified in a forbidden way.
 */
export class ChangesNotPermittedError extends IncrementalUpdateError {
  constructor(readonly permission: 1 | 2) {
    super(
      permission === 1
        ? 'The document is certified: no changes are permitted.'
        : 'The document is certified: only form filling and signing are permitted, not annotations.',
    );
    this.name = 'ChangesNotPermittedError';
  }
}

/** Kind of cross-reference section to write: a classic `xref` table or an `/XRef` stream. */
export type XrefFormat = 'auto' | 'table' | 'stream';

interface PreviousSection {
  /** Offset of the last cross-reference section, from the final `startxref`. */
  readonly offset: number;
  readonly kind: 'table' | 'stream';
  readonly size: number;
  /** `N G R` of the catalog. */
  readonly root: string;
  /** `N G R` of the info dictionary, if any. */
  readonly info?: string;
}

const latin1 = (bytes: Uint8Array): string => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    text += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  return text;
};
const encode = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));

function indexOfText(bytes: Uint8Array, needle: string, from: number): number {
  const first = needle.charCodeAt(0);
  outer: for (let i = from; i <= bytes.length - needle.length; i++) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < needle.length; j++)
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

function lastIndexOfText(bytes: Uint8Array, needle: string): number {
  outer: for (let i = bytes.length - needle.length; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++)
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

/** Finds the last cross-reference section of the file and what its trailer says. */
function readPreviousSection(pdf: Uint8Array): PreviousSection {
  // Usually in the last few hundred bytes, but some producers leave padding after %%EOF.
  const at = lastIndexOfText(pdf, 'startxref');
  const last = at < 0 ? null : /^startxref\s+(\d+)/.exec(latin1(pdf.subarray(at, at + 64)));
  if (!last) throw new IncrementalUpdateError('The PDF has no startxref: it cannot be updated.');
  const offset = Number(last[1]);
  if (!(offset > 0 && offset < pdf.length)) {
    throw new IncrementalUpdateError('The PDF has an invalid startxref offset.');
  }

  const isTable = latin1(pdf.subarray(offset, offset + 4)) === 'xref';
  let dictionary: string;
  if (isTable) {
    const trailer = indexOfText(pdf, 'trailer', offset);
    if (trailer < 0) throw new IncrementalUpdateError('The last xref section has no trailer.');
    dictionary = latin1(pdf.subarray(trailer + 7, trailer + 7 + 4096));
    const end = dictionary.indexOf('startxref');
    if (end >= 0) dictionary = dictionary.slice(0, end);
  } else {
    dictionary = latin1(pdf.subarray(offset, offset + 4096));
    const end = dictionary.indexOf('stream');
    if (end >= 0) dictionary = dictionary.slice(0, end);
    if (!/\/Type\s*\/XRef/.test(dictionary)) {
      throw new IncrementalUpdateError('startxref does not point to a cross-reference section.');
    }
  }

  if (/\/Encrypt\b/.test(dictionary)) throw new EncryptedPdfError();
  const size = /\/Size\s+(\d+)/.exec(dictionary);
  const root = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(dictionary);
  if (!size || !root) throw new IncrementalUpdateError('The PDF trailer has no /Size or /Root.');
  const info = /\/Info\s+(\d+)\s+(\d+)\s+R/.exec(dictionary);
  return {
    offset,
    kind: isTable ? 'table' : 'stream',
    size: Number(size[1]),
    root: `${root[1]} ${root[2]} R`,
    info: info ? `${info[1]} ${info[2]} R` : undefined,
  };
}

/**
 * Appends changes to a PDF as an ISO 32000 incremental update: new and replaced objects, a new
 * cross-reference section and a trailer pointing back to the previous one (`/Prev`). **Not one byte
 * of the original file changes**, so digital signatures that cover it stay valid; a reader sees the
 * update as a later revision.
 *
 * Objects are built with pdf-lib: `register()` creates a new object and `replace()` writes a new
 * revision of an existing one. The document is only read, never saved.
 */
export class IncrementalUpdate {
  private readonly replacements = new Map<number, { ref: PDFRef; object: PDFObject }>();

  private constructor(
    private readonly pdf: Uint8Array,
    readonly lib: PdfLib,
    readonly document: PDFDocument,
    private readonly previous: PreviousSection,
    private readonly firstNewObject: number,
  ) {}

  /** @throws {EncryptedPdfError} for encrypted documents. */
  static async load(pdf: Uint8Array): Promise<IncrementalUpdate> {
    const previous = readPreviousSection(pdf);
    const lib = await import('pdf-lib');
    let document: PDFDocument;
    try {
      document = await lib.PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
    } catch (cause) {
      throw new IncrementalUpdateError('The PDF structure could not be read.', { cause });
    }
    if (document.context.trailerInfo.Encrypt) throw new EncryptedPdfError();
    // Never reuse a number the previous xref still lists (including free entries).
    const context = document.context;
    context.largestObjectNumber = Math.max(context.largestObjectNumber, previous.size - 1);
    return new IncrementalUpdate(pdf, lib, document, previous, context.largestObjectNumber + 1);
  }

  get context(): PDFContext {
    return this.document.context;
  }

  /** Reference to the document catalog, as the last trailer states it. */
  get catalogRef(): PDFRef {
    const [number, generation] = this.previous.root.split(' ').map(Number);
    return this.lib.PDFRef.of(number, generation);
  }

  /** The kind of cross-reference section the document ended with. */
  get previousXrefKind(): 'table' | 'stream' {
    return this.previous.kind;
  }

  /** Adds a new indirect object and returns its reference. */
  register(object: PDFObject): PDFRef {
    return this.context.register(object);
  }

  /** Writes a new revision of an existing object (it keeps its object number). */
  replace(ref: PDFRef, object: PDFObject): void {
    if (ref.objectNumber >= this.firstNewObject) {
      this.context.assign(ref, object); // an object created by this update: just change it
      return;
    }
    this.replacements.set(ref.objectNumber, { ref, object });
  }

  /** Serializes the original file followed by the update. */
  build(format: XrefFormat = 'auto'): Uint8Array {
    const entries: { ref: PDFRef; object: PDFObject }[] = [...this.replacements.values()];
    for (const [ref, object] of this.context.enumerateIndirectObjects()) {
      if (ref.objectNumber >= this.firstNewObject) entries.push({ ref, object });
    }
    entries.sort((a, b) => a.ref.objectNumber - b.ref.objectNumber);

    const chunks: Uint8Array[] = [this.pdf];
    let length = this.pdf.length;
    const push = (chunk: Uint8Array) => {
      chunks.push(chunk);
      length += chunk.length;
    };
    const last = this.pdf[this.pdf.length - 1];
    if (last !== 0x0a && last !== 0x0d) push(encode('\n'));

    const offsets: { number: number; generation: number; offset: number }[] = [];
    for (const { ref, object } of entries) {
      offsets.push({ number: ref.objectNumber, generation: ref.generationNumber, offset: length });
      push(encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
      push(serialize(object));
      push(encode('\nendobj\n\n'));
    }

    const kind = format === 'auto' ? this.previous.kind : format;
    const xrefOffset = length;
    const idArray = this.context.trailerInfo.ID;
    const idBytes = idArray ? serialize(idArray) : undefined;
    const common = (): Uint8Array[] => [
      encode(` /Root ${this.previous.root}`),
      ...(this.previous.info ? [encode(` /Info ${this.previous.info}`)] : []),
      ...(idBytes ? [encode(' /ID '), idBytes] : []),
      encode(` /Prev ${this.previous.offset}`),
    ];

    if (kind === 'table') {
      const size = Math.max(this.previous.size, ...offsets.map((o) => o.number + 1));
      push(encode('xref\n'));
      for (const group of groupConsecutive(offsets)) {
        push(encode(`${group[0].number} ${group.length}\n`));
        for (const o of group) {
          push(
            encode(
              `${String(o.offset).padStart(10, '0')} ${String(o.generation).padStart(5, '0')} n \n`,
            ),
          );
        }
      }
      push(encode(`trailer\n<< /Size ${size}`));
      common().forEach(push);
      push(encode(' >>\n'));
    } else {
      // The xref stream is an object too: it gets the next free number and lists itself.
      const number = Math.max(this.previous.size, ...offsets.map((o) => o.number + 1));
      const all = [...offsets, { number, generation: 0, offset: xrefOffset }];
      const groups = groupConsecutive(all);
      if (xrefOffset > 0xffffffff) {
        throw new IncrementalUpdateError('Files larger than 4 GiB are not supported.');
      }
      const data = new Uint8Array(all.length * 7);
      all.forEach((o, i) => {
        const at = i * 7;
        data[at] = 1;
        data[at + 1] = (o.offset >>> 24) & 0xff;
        data[at + 2] = (o.offset >>> 16) & 0xff;
        data[at + 3] = (o.offset >>> 8) & 0xff;
        data[at + 4] = o.offset & 0xff;
        data[at + 5] = (o.generation >>> 8) & 0xff;
        data[at + 6] = o.generation & 0xff;
      });
      const index = groups.map((g) => `${g[0].number} ${g.length}`).join(' ');
      push(
        encode(`${number} 0 obj\n<< /Type /XRef /Size ${number + 1} /W [1 4 2] /Index [${index}]`),
      );
      common().forEach(push);
      push(encode(` /Length ${data.length} >>\nstream\n`));
      push(data);
      push(encode('\nendstream\nendobj\n'));
    }
    push(encode(`startxref\n${xrefOffset}\n%%EOF\n`));

    const output = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      output.set(chunk, at);
      at += chunk.length;
    }
    return output;
  }
}

function serialize(object: PDFObject): Uint8Array {
  const bytes = new Uint8Array(object.sizeInBytes());
  object.copyBytesInto(bytes, 0);
  return bytes;
}

function groupConsecutive<T extends { number: number }>(items: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const group = groups[groups.length - 1];
    if (group && group[group.length - 1].number + 1 === item.number) group.push(item);
    else groups.push([item]);
  }
  return groups;
}

/**
 * The DocMDP permission level of the document's certification signature: `1` no changes, `2` form
 * filling and signing, `3` also annotations. `undefined` when the document is not certified.
 */
export function readDocMdpPermission(lib: PdfLib, document: PDFDocument): 1 | 2 | 3 | undefined {
  const { PDFName, PDFDict, PDFArray, PDFNumber } = lib;
  const perms = document.catalog.lookupMaybe(PDFName.of('Perms'), PDFDict);
  const signature = perms?.lookupMaybe(PDFName.of('DocMDP'), PDFDict);
  const references = signature?.lookupMaybe(PDFName.of('Reference'), PDFArray);
  if (!references) return undefined;
  for (let i = 0; i < references.size(); i++) {
    const reference = references.lookupMaybe(i, PDFDict);
    const method = reference?.lookup(PDFName.of('TransformMethod'));
    if (!(method instanceof PDFName) || method.decodeText() !== 'DocMDP') continue;
    const params = reference?.lookupMaybe(PDFName.of('TransformParams'), PDFDict);
    const value = params?.lookupMaybe(PDFName.of('P'), PDFNumber)?.asNumber();
    // 2 is the default when /P is absent.
    return value === 1 || value === 3 ? value : 2;
  }
  return undefined;
}
