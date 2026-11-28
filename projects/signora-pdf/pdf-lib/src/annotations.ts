import type { PDFArray, PDFDict, PDFPage, PDFRef } from 'pdf-lib';
import type { IncrementalUpdate } from './incremental-update';

/**
 * Adds annotation references to a page, writing a new revision of whichever object holds
 * `/Annots`: the array when it is indirect, otherwise the page itself.
 */
export function appendAnnotations(
  update: IncrementalUpdate,
  page: PDFPage,
  refs: readonly PDFRef[],
): void {
  const { PDFName, PDFArray: PDFArrayClass } = update.lib;
  const { context } = update;
  const key = PDFName.of('Annots');
  const existing = page.node.get(key);

  if (existing && 'objectNumber' in existing) {
    // /Annots is an indirect array: only that array gets a new revision, the page is untouched.
    const array = context.lookup(existing as PDFRef, PDFArrayClass) as PDFArray;
    const copy = array.clone(context);
    refs.forEach((ref) => copy.push(ref));
    update.replace(existing as PDFRef, copy);
    return;
  }

  const array = existing instanceof PDFArrayClass ? existing.clone(context) : context.obj([]);
  refs.forEach((ref) => array.push(ref));
  const copy: PDFDict = page.node.clone(context);
  copy.set(key, array);
  update.replace(page.ref, copy);
}
