import { fromPdfUserSpace, type NormalizedRect, type SignatureField } from 'signora-pdf';
import type { PDFArray, PDFDict, PDFDocument, PDFObject, PDFPage, PDFRef } from 'pdf-lib';
import { pageInfo } from './page-info';

type PdfLib = typeof import('pdf-lib');

/** Bit 2 of the field flags: the field must be filled. */
const REQUIRED_FLAG = 2;

/**
 * A signature field found in a PDF, with the objects it is made of.
 * @internal Shared with `signora-pdf/validation`; not part of the stable API.
 */
export interface SignatureFieldRecord {
  /** Fully qualified name (`/T` entries joined with dots). */
  readonly name: string;
  /** The field dictionary (for a merged field and widget, also the widget). */
  readonly field: PDFDict;
  readonly ref?: PDFRef;
  /** `/V` when the field is signed. */
  readonly value?: PDFDict;
  /** The widget annotation that shows the field. */
  readonly widget?: { readonly dict: PDFDict; readonly ref?: PDFRef };
  /** Zero-based page of the widget. */
  readonly pageIndex?: number;
  /** Widget rectangle in normalized page coordinates. */
  readonly rect?: NormalizedRect;
  /** Field flags (`/Ff`, inherited). */
  readonly flags: number;
  /** Alternate, user-facing name (`/TU`). */
  readonly alternateName?: string;
}

interface FieldVisit {
  readonly name: string;
  readonly dict: PDFDict;
  readonly ref?: PDFRef;
  readonly kids?: PDFArray;
  /** Field type (`/FT`), inherited from the parents. */
  readonly type?: string;
}

const MAX_DEPTH = 32;

/** Calls `visit` for every field and sub-field of the AcroForm, depth first, never twice for one dictionary. */
function walkFields(lib: PdfLib, document: PDFDocument, visit: (field: FieldVisit) => void): void {
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString } = lib;
  const acroForm = document.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const root = acroForm?.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!root) return;

  const seen = new Set<PDFDict>();
  const text = (object: PDFObject | undefined): string | undefined =>
    object instanceof PDFString || object instanceof PDFHexString ? object.decodeText() : undefined;

  const inherited = (dict: PDFDict, key: string): PDFObject | undefined => {
    let current: PDFDict | undefined = dict;
    for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
      const value = current.lookup(PDFName.of(key));
      if (value) return value;
      current = current.lookupMaybe(PDFName.of('Parent'), PDFDict);
    }
    return undefined;
  };

  const walk = (array: PDFArray, parentName: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    for (let i = 0; i < array.size(); i++) {
      const raw = array.get(i);
      const dict = array.lookupMaybe(i, PDFDict);
      if (!dict || seen.has(dict)) continue;
      seen.add(dict);

      const partial = text(dict.lookup(PDFName.of('T')));
      const name = partial ? (parentName ? `${parentName}.${partial}` : partial) : parentName;
      const kids = dict.lookupMaybe(PDFName.of('Kids'), PDFArray);
      if (kids) walk(kids, name, depth + 1);

      const type = inherited(dict, 'FT');
      visit({
        name,
        dict,
        ref: raw instanceof PDFRef ? raw : undefined,
        kids,
        type: type instanceof PDFName ? type.decodeText() : undefined,
      });
    }
  };
  walk(root, '', 0);
}

/**
 * A field of the form, of any type, with the objects it is made of.
 * @internal Shared with `signora-pdf/validation`; not part of the stable API.
 */
export interface FormFieldRecord {
  /** Fully qualified name (`/T` entries joined with dots). */
  readonly name: string;
  /** Field type (`/FT`, inherited): `Sig`, `Tx`, `Btn`, `Ch`; absent for a non-terminal node. */
  readonly type?: string;
  readonly field: PDFDict;
  readonly ref?: PDFRef;
  /** `/Kids`, when it has any (the widgets of the field, or sub-fields). */
  readonly kids?: PDFArray;
}

/**
 * Every field and sub-field of the AcroForm, whatever its type. Reads only.
 * @internal Shared with `signora-pdf/validation`; not part of the stable API.
 */
export function collectFormFields(lib: PdfLib, document: PDFDocument): FormFieldRecord[] {
  const fields: FormFieldRecord[] = [];
  walkFields(lib, document, ({ name, dict, ref, kids, type }) =>
    fields.push({ name, type, field: dict, ref, kids }),
  );
  return fields;
}

/**
 * Fully qualified names of every field of the form (of any type), to avoid name clashes.
 * @internal
 */
export function collectFieldNames(lib: PdfLib, document: PDFDocument): Set<string> {
  const names = new Set<string>();
  walkFields(lib, document, ({ name }) => name && names.add(name));
  return names;
}

/**
 * Every signature field (`/FT /Sig`) of the document: signed or not, visible or not, with its page
 * and rectangle. Reads only; nothing is modified.
 * @internal Shared with `signora-pdf/validation`; use `inspectPdfSignatures()` or
 * `readSignatureFields()` instead.
 */
export function collectSignatureFields(lib: PdfLib, document: PDFDocument): SignatureFieldRecord[] {
  const { PDFName, PDFDict, PDFArray, PDFNumber, PDFRef, PDFString, PDFHexString } = lib;
  const pages = document.getPages();
  const result: SignatureFieldRecord[] = [];

  const widgetOf = (field: PDFDict, ref: PDFRef | undefined, kids: PDFArray | undefined) => {
    if (field.has(PDFName.of('Rect'))) return { dict: field, ref };
    for (let i = 0; kids && i < kids.size(); i++) {
      const kid = kids.lookupMaybe(i, PDFDict);
      if (kid?.has(PDFName.of('Rect'))) {
        const kidRef = kids.get(i);
        return { dict: kid, ref: kidRef instanceof PDFRef ? kidRef : undefined };
      }
    }
    return undefined;
  };

  const pageOf = (widget: PDFDict, ref: PDFRef | undefined): number | undefined => {
    const parent = widget.get(PDFName.of('P'));
    if (parent instanceof PDFRef) {
      const index = pages.findIndex((p: PDFPage) => p.ref === parent);
      if (index >= 0) return index;
    }
    if (ref) {
      for (let i = 0; i < pages.length; i++) {
        const annots = pages[i].node.lookupMaybe(PDFName.of('Annots'), PDFArray);
        for (let j = 0; annots && j < annots.size(); j++) if (annots.get(j) === ref) return i;
      }
    }
    return undefined;
  };

  const locate = (widget: PDFDict, ref: PDFRef | undefined) => {
    const pageIndex = pageOf(widget, ref);
    const array = widget.lookupMaybe(PDFName.of('Rect'), PDFArray);
    if (pageIndex === undefined || !array || array.size() !== 4) return {};
    const values: number[] = [];
    for (let i = 0; i < 4; i++) {
      const n = array.lookup(i);
      if (!(n instanceof PDFNumber)) return { pageIndex };
      values.push(n.asNumber());
    }
    const [ax, ay, bx, by] = values;
    const width = Math.abs(bx - ax);
    const height = Math.abs(by - ay);
    if (width === 0 || height === 0) return { pageIndex }; // an invisible field
    return {
      pageIndex,
      rect: fromPdfUserSpace(
        { x: Math.min(ax, bx), y: Math.min(ay, by), width, height },
        pageInfo(pages[pageIndex], pageIndex),
      ),
    };
  };

  walkFields(lib, document, ({ name, dict, ref, kids, type }) => {
    if (type !== 'Sig') return;
    const widget = widgetOf(dict, ref, kids);
    const flags = dict.lookup(PDFName.of('Ff'));
    const alternate = dict.lookup(PDFName.of('TU'));
    result.push({
      name,
      field: dict,
      ref,
      value: dict.lookupMaybe(PDFName.of('V'), PDFDict),
      widget,
      ...(widget ? locate(widget.dict, widget.ref) : {}),
      flags: flags instanceof PDFNumber ? flags.asNumber() : 0,
      alternateName:
        alternate instanceof PDFString || alternate instanceof PDFHexString
          ? alternate.decodeText()
          : undefined,
    });
  });
  return result;
}

/**
 * The empty, visible signature fields of a PDF as {@link SignatureField}s, ready for the viewer's
 * `[signatureFields]` input or `session.setFields()`. Fields without a visible rectangle (invisible
 * signatures) and fields that are already signed are left out. Each one carries `pdfName` and
 * `inDocument: true`, so exporting never creates it again.
 *
 * Requires the optional peer dependency `pdf-lib`. Encrypted documents are read without decrypting
 * (the form structure is not encrypted).
 */
export async function readSignatureFields(pdf: Uint8Array): Promise<SignatureField[]> {
  const lib = await import('pdf-lib');
  const document = await lib.PDFDocument.load(pdf, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  return collectSignatureFields(lib, document)
    .filter((f) => f.rect && f.pageIndex !== undefined && !f.value)
    .map((f) => ({
      id: f.name,
      pageIndex: f.pageIndex!,
      rect: f.rect!,
      label: f.alternateName ?? f.name,
      required: (f.flags & REQUIRED_FLAG) !== 0,
      pdfName: f.name,
      inDocument: true,
    }));
}
