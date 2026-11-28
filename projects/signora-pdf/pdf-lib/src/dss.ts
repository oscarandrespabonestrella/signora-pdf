import type { PDFDict, PDFRef } from 'pdf-lib';
import { IncrementalUpdate, type XrefFormat } from './incremental-update';

type PdfLib = typeof import('pdf-lib');

/** Validation data kept for one signature: a `/VRI` entry of the DSS. */
export interface DssSignatureData {
  /** DER certificates. */
  readonly certs: readonly Uint8Array[];
  /** DER CRLs. */
  readonly crls: readonly Uint8Array[];
  /** DER OCSP responses. */
  readonly ocsps: readonly Uint8Array[];
}

/**
 * The Document Security Store of a PDF (`/DSS`, ISO 32000-2 and ETSI EN 319 142): certificates,
 * CRLs and OCSP responses kept in the file so that its signatures can be validated long after the
 * certificates expired. Everything here is **data to be checked**, not trusted: it only counts once
 * it verifies.
 */
export interface DocumentSecurityStore extends DssSignatureData {
  /**
   * Data per signature, keyed by the upper-case hex SHA-1 of the signature's CMS (`/VRI`, see
   * {@link dssSignatureKey}). The lists above hold everything, whichever signature it belongs to.
   */
  readonly vri: Readonly<Record<string, DssSignatureData>>;
}

/** What {@link appendDss} adds. Items already in the DSS are not added again. */
export interface DssAdditions extends Partial<DssSignatureData> {
  /** Data that belongs to particular signatures: also listed in the `/VRI` of each. */
  readonly signatures?: readonly (Partial<DssSignatureData> & {
    /** The signature's CMS container (DER, as in `/Contents` without the zero padding). */
    readonly signature: Uint8Array;
  })[];
}

/** Options of {@link appendDss}. */
export interface AppendDssOptions {
  /** Kind of cross-reference section to write. By default the same kind the file ended with. */
  readonly xrefFormat?: XrefFormat;
}

/**
 * The `/VRI` key of a signature: the SHA-1 of its CMS container, in upper-case hex. Uses
 * `globalThis.crypto` (SHA-1 is only an index here, not a security function).
 */
export async function dssSignatureKey(signature: Uint8Array): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-1', signature as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function streamBytes(lib: PdfLib, object: unknown): Uint8Array | undefined {
  try {
    if (object instanceof lib.PDFRawStream)
      return new Uint8Array(lib.decodePDFRawStream(object).decode());
    const stream = object as { getContents?(): Uint8Array } | undefined;
    return stream?.getContents ? new Uint8Array(stream.getContents()) : undefined;
  } catch {
    return undefined; // an unsupported filter: the item is skipped
  }
}

function listOf(lib: PdfLib, holder: PDFDict | undefined, key: string): Uint8Array[] {
  const array = holder?.lookupMaybe(lib.PDFName.of(key), lib.PDFArray);
  const items: Uint8Array[] = [];
  for (let i = 0; array && i < array.size(); i++) {
    const bytes = streamBytes(lib, array.lookup(i));
    if (bytes) items.push(bytes);
  }
  return items;
}

/**
 * Reads the DSS of a PDF, or `undefined` if it has none. Only reads; items in a filter other than
 * Flate are skipped. Requires the optional peer dependency `pdf-lib`.
 */
export async function readDss(pdf: Uint8Array): Promise<DocumentSecurityStore | undefined> {
  const lib = await import('pdf-lib');
  const document = await lib.PDFDocument.load(pdf, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const dss = document.catalog.lookupMaybe(lib.PDFName.of('DSS'), lib.PDFDict);
  if (!dss) return undefined;

  const vri: Record<string, DssSignatureData> = {};
  const table = dss.lookupMaybe(lib.PDFName.of('VRI'), lib.PDFDict);
  for (const [name] of table?.entries() ?? []) {
    const entry = table!.lookupMaybe(name, lib.PDFDict);
    vri[name.decodeText().toUpperCase()] = {
      certs: listOf(lib, entry, 'Cert'),
      crls: listOf(lib, entry, 'CRL'),
      ocsps: listOf(lib, entry, 'OCSP'),
    };
  }
  return {
    certs: listOf(lib, dss, 'Certs'),
    crls: listOf(lib, dss, 'CRLs'),
    ocsps: listOf(lib, dss, 'OCSPs'),
    vri,
  };
}

const text = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join('');

/**
 * Adds certificates, CRLs and OCSP responses to the DSS of a PDF (creating it if needed), written as
 * an **incremental update**: no original byte changes, so existing digital signatures stay valid.
 * A DSS added after a signature is exactly how PAdES-B-LT stores its validation data, and a later
 * document timestamp over it gives B-LTA.
 *
 * This only stores what you give it: it does not collect or verify validation data. Items that
 * are already in the DSS are not added twice. Entries in `signatures` are also listed in the
 * `/VRI` of that signature.
 *
 * @throws {EncryptedPdfError} if the document is encrypted.
 */
export async function appendDss(
  pdf: Uint8Array,
  additions: DssAdditions,
  options: AppendDssOptions = {},
): Promise<Uint8Array> {
  const perSignature = additions.signatures ?? [];
  const nothing =
    !additions.certs?.length &&
    !additions.crls?.length &&
    !additions.ocsps?.length &&
    perSignature.every((s) => !s.certs?.length && !s.crls?.length && !s.ocsps?.length);
  if (nothing) return pdf.slice();

  const update = await IncrementalUpdate.load(pdf);
  const { lib, document, context } = update;
  const { PDFName, PDFDict, PDFArray, PDFRef } = lib;
  const catalog = document.catalog;

  const existingEntry = catalog.get(PDFName.of('DSS'));
  const existing = catalog.lookupMaybe(PDFName.of('DSS'), PDFDict);
  const dss: PDFDict = existing ? existing.clone(context) : context.obj({});

  // Streams already in the DSS, so the same bytes are never stored twice.
  const known = new Map<string, PDFRef>();
  const keep = (holder: PDFDict | undefined, key: string): PDFRef[] => {
    const array = holder?.lookupMaybe(PDFName.of(key), PDFArray);
    const refs: PDFRef[] = [];
    for (let i = 0; array && i < array.size(); i++) {
      const ref = array.get(i);
      if (!(ref instanceof PDFRef)) continue;
      refs.push(ref);
      const bytes = streamBytes(lib, array.lookup(i));
      if (bytes) known.set(text(bytes), ref);
    }
    return refs;
  };
  const refOf = (bytes: Uint8Array): PDFRef => {
    const key = text(bytes);
    let ref = known.get(key);
    if (!ref) {
      ref = context.register(context.flateStream(bytes));
      known.set(key, ref);
    }
    return ref;
  };
  const fill = (
    holder: PDFDict,
    key: string,
    items: readonly Uint8Array[] | undefined,
    old: PDFRef[],
  ) => {
    const refs = [...old];
    for (const item of items ?? []) {
      const ref = refOf(item);
      if (!refs.some((r) => r.objectNumber === ref.objectNumber)) refs.push(ref);
    }
    if (refs.length > 0) holder.set(PDFName.of(key), context.obj(refs));
  };

  // Global lists: everything given, plus what each signature brings.
  const all = (pick: 'certs' | 'crls' | 'ocsps') => [
    ...(additions[pick] ?? []),
    ...perSignature.flatMap((s) => s[pick] ?? []),
  ];
  const oldCerts = keep(existing, 'Certs');
  const oldCrls = keep(existing, 'CRLs');
  const oldOcsps = keep(existing, 'OCSPs');
  fill(dss, 'Certs', all('certs'), oldCerts);
  fill(dss, 'CRLs', all('crls'), oldCrls);
  fill(dss, 'OCSPs', all('ocsps'), oldOcsps);

  if (perSignature.length > 0) {
    const oldTable = existing?.lookupMaybe(PDFName.of('VRI'), PDFDict);
    const table: PDFDict = oldTable ? oldTable.clone(context) : context.obj({});
    for (const item of perSignature) {
      const name = PDFName.of(await dssSignatureKey(item.signature));
      const oldEntry = oldTable?.lookupMaybe(name, PDFDict);
      const entry: PDFDict = oldEntry ? oldEntry.clone(context) : context.obj({});
      fill(entry, 'Cert', item.certs, keep(oldEntry, 'Cert'));
      fill(entry, 'CRL', item.crls, keep(oldEntry, 'CRL'));
      fill(entry, 'OCSP', item.ocsps, keep(oldEntry, 'OCSP'));
      table.set(name, entry);
    }
    dss.set(PDFName.of('VRI'), table);
  }

  if (existingEntry instanceof PDFRef) {
    update.replace(existingEntry, dss); // an indirect DSS: only it changes
  } else {
    const copy = catalog.clone(context);
    copy.set(PDFName.of('DSS'), context.register(dss));
    update.replace(update.catalogRef, copy);
  }
  return update.build(options.xrefFormat);
}
