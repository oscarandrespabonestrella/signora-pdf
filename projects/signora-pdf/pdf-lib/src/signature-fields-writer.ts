import { toPdfUserSpace, type SignatureField } from 'signora-pdf';
import type { PDFArray, PDFDict, PDFRef } from 'pdf-lib';
import { appendAnnotations } from './annotations';
import { collectFieldNames } from './form-fields';
import {
  ChangesNotPermittedError,
  IncrementalUpdate,
  IncrementalUpdateError,
  readDocMdpPermission,
  type XrefFormat,
} from './incremental-update';
import { pageInfo } from './page-info';

/** A signature field cannot be created with the name it was given. */
export class SignatureFieldNameError extends IncrementalUpdateError {
  constructor(
    readonly fieldName: string,
    reason: string,
  ) {
    super(`Signature field name "${fieldName}" ${reason}.`);
    this.name = 'SignatureFieldNameError';
  }
}

/** Options of {@link addSignatureFields}. */
export interface AddSignatureFieldsOptions {
  /** Kind of cross-reference section to write. By default the same kind the file ended with. */
  readonly xrefFormat?: XrefFormat;
  /**
   * Add the fields even if the document is certified (DocMDP) with a level that does not allow
   * changes to the form. Default `false`.
   */
  readonly ignoreDocMdp?: boolean;
}

/** Bit 2 of the field flags: the field must be filled. */
const REQUIRED_FLAG = 2;
/** Annotation flag: print. */
const PRINT_FLAG = 4;

/**
 * The name a field is created with: `pdfName` as given, or one derived from its label (or id) with
 * the dots replaced, because a dot separates the levels of a field hierarchy.
 */
export function signatureFieldName(field: SignatureField): string {
  if (field.pdfName !== undefined) return field.pdfName;
  return (field.label ?? field.id).replace(/\./g, '_').replace(/\s+/g, ' ').trim() || field.id;
}

/**
 * Adds empty signature fields (`/FT /Sig` widgets) to a PDF, written as an incremental update, so
 * a backend can sign **into** them by name. Fields with `inDocument: true` already exist and are
 * skipped. Each field becomes a visible, printable widget on its page, at its rectangle; it gets
 * no appearance, since the signature that fills it brings its own.
 *
 * Nothing is signed. Existing digital signatures stay valid: no original byte changes.
 *
 * @throws {SignatureFieldNameError} if a name is empty, contains a dot, or is already used by a
 * field of the form or by another new field.
 * @throws {RangeError} if a field targets a page the document does not have.
 * @throws {ChangesNotPermittedError} if a DocMDP certification forbids form changes.
 * @throws {EncryptedPdfError} if the document is encrypted.
 */
export async function addSignatureFields(
  pdf: Uint8Array,
  fields: readonly SignatureField[],
  options: AddSignatureFieldsOptions = {},
): Promise<Uint8Array> {
  const fresh = fields.filter((field) => !field.inDocument);
  if (fresh.length === 0) return pdf.slice();

  const update = await IncrementalUpdate.load(pdf);
  const { lib, document, context } = update;
  const { PDFString, PDFHexString } = lib;

  const permission = readDocMdpPermission(lib, document);
  if ((permission === 1 || permission === 2) && !options.ignoreDocMdp) {
    throw new ChangesNotPermittedError(permission);
  }

  // Everything that can fail is checked before any object is created.
  const pages = document.getPages();
  const taken = collectFieldNames(lib, document);
  const named = fresh.map((field) => {
    const name = signatureFieldName(field);
    if (name === '') throw new SignatureFieldNameError(name, 'is empty');
    if (name.includes('.')) throw new SignatureFieldNameError(name, 'contains a dot');
    if (taken.has(name)) throw new SignatureFieldNameError(name, 'is already used by a field');
    taken.add(name);
    if (!pages[field.pageIndex]) {
      throw new RangeError(`Field "${field.id}" targets missing page ${field.pageIndex}.`);
    }
    return { field, name };
  });

  const text = (value: string) =>
    /^[\x20-\x7e]*$/.test(value) ? PDFString.of(value) : PDFHexString.fromText(value);

  const created: PDFRef[] = [];
  const perPage = new Map<number, PDFRef[]>();
  for (const { field, name } of named) {
    const page = pages[field.pageIndex];
    const box = toPdfUserSpace(field.rect, pageInfo(page, field.pageIndex));
    const entries: Record<string, unknown> = {
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: text(name),
      Rect: [box.x, box.y, box.x + box.width, box.y + box.height],
      F: PRINT_FLAG,
      P: page.ref,
    };
    if (field.label && field.label !== name) entries['TU'] = text(field.label);
    if (field.required) entries['Ff'] = REQUIRED_FLAG;

    const ref = context.register(context.obj(entries as never));
    created.push(ref);
    perPage.set(field.pageIndex, [...(perPage.get(field.pageIndex) ?? []), ref]);
  }
  for (const [pageIndex, refs] of perPage) appendAnnotations(update, pages[pageIndex], refs);

  addToAcroForm(update, created);
  return update.build(options.xrefFormat);
}

/**
 * Lists the new fields in the AcroForm, creating the form if the document has none.
 * @internal Shared with the tools that build signature fields by hand.
 */
export function addToAcroForm(update: IncrementalUpdate, refs: readonly PDFRef[]): void {
  const { lib, document, context } = update;
  const { PDFName, PDFDict, PDFArray } = lib;
  const acroKey = PDFName.of('AcroForm');
  const fieldsKey = PDFName.of('Fields');
  const catalog = document.catalog;
  const existing = catalog.get(acroKey);

  /** Appends to /Fields wherever it lives; returns true if the dictionary holding it changed. */
  const appendToFields = (form: PDFDict): boolean => {
    const current = form.get(fieldsKey);
    if (current && 'objectNumber' in current) {
      // /Fields is an indirect array: only it gets a new revision.
      const copy = (context.lookup(current as PDFRef, PDFArray) as PDFArray).clone(context);
      refs.forEach((ref) => copy.push(ref));
      update.replace(current as PDFRef, copy);
      return false;
    }
    const copy = current instanceof PDFArray ? current.clone(context) : context.obj([]);
    refs.forEach((ref) => copy.push(ref));
    form.set(fieldsKey, copy);
    return true;
  };

  if (existing && 'objectNumber' in existing) {
    // Indirect AcroForm: it, not the catalog, gets the new revision.
    const form = (context.lookup(existing as PDFRef, PDFDict) as PDFDict).clone(context);
    if (appendToFields(form)) update.replace(existing as PDFRef, form);
    return;
  }

  const form = existing instanceof PDFDict ? existing.clone(context) : context.obj({});
  const formChanged = appendToFields(form);
  if (!formChanged && existing instanceof PDFDict) return; // only the indirect /Fields array changed
  // The AcroForm is direct (or new): the catalog carries it.
  const catalogCopy = catalog.clone(context);
  catalogCopy.set(acroKey, existing instanceof PDFDict ? form : context.register(form));
  update.replace(update.catalogRef, catalogCopy);
}
