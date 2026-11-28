/**
 * pdf-lib implementation of the writer port: embeds visual signatures into PDFs, either by rewriting
 * the file or as an incremental update that keeps existing signatures valid. Also reads and writes
 * signature fields (`readSignatureFields`, `addSignatureFields`) and the DSS (`readDss`, `appendDss`).
 * Requires the optional peer dependency `pdf-lib`.
 *
 * @module signora-pdf/pdf-lib
 */
export * from './pdf-lib-writer';
export * from './placement-transform';
export * from './incremental-update';
export * from './incremental-writer';
export * from './form-fields';
export * from './signature-fields-writer';
export * from './dss';
