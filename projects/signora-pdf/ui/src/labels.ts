import { InjectionToken } from '@angular/core';

/** Every user-facing string of the default UI, so it can be translated. */
export interface SignoraLabels {
  readonly viewer: string;
  readonly pages: string;
  readonly toolbar: string;
  readonly previousPage: string;
  readonly nextPage: string;
  readonly pageNumber: string;
  readonly zoomOut: string;
  readonly zoomIn: string;
  readonly zoomLevel: string;
  readonly rotateCounterClockwise: string;
  readonly rotateClockwise: string;
  readonly empty: string;
  readonly loading: string;
  readonly error: string;
  readonly pageOf: (page: number, total: number) => string;
  readonly pageAlt: (page: number) => string;

  // Signature panel
  readonly signaturePanel: string;
  readonly tabDraw: string;
  readonly tabType: string;
  readonly tabUpload: string;
  readonly drawCanvas: string;
  readonly drawHint: string;
  readonly undo: string;
  readonly clear: string;
  readonly useSignature: string;
  readonly typeInput: string;
  readonly typePlaceholder: string;
  readonly typeFont: string;
  readonly typePreview: string;
  readonly uploadChoose: string;
  readonly uploadHelp: string;
  readonly uploadInvalid: string;
  readonly uploadTooLarge: string;
  readonly organizationEmpty: string;
  readonly librarySection: string;
  readonly libraryEmpty: string;
  readonly removeFromLibrary: string;
  readonly armedHint: string;
  readonly cancelPlacing: string;

  // Placed signatures
  readonly placementLabel: (index: number, name: string) => string;
  readonly signatureName: string;
  readonly removePlacement: string;
  readonly resizeHandle: string;
  readonly fieldsEditor: string;
  readonly addField: string;
  readonly addFieldHint: string;
  readonly fieldLabelInput: string;
  readonly fieldRequired: string;
  readonly removeField: string;
  readonly fieldHint: string;
  readonly fieldName: string;
  readonly fieldAria: (label: string, required: boolean, filled: boolean) => string;
}

/** English strings used unless `SIGNORA_LABELS` is overridden. Spread it to override only some strings. */
export const DEFAULT_SIGNORA_LABELS: SignoraLabels = {
  viewer: 'PDF viewer',
  pages: 'Document pages',
  toolbar: 'PDF toolbar',
  previousPage: 'Previous page',
  nextPage: 'Next page',
  pageNumber: 'Page number',
  zoomOut: 'Zoom out',
  zoomIn: 'Zoom in',
  zoomLevel: 'Zoom level',
  rotateCounterClockwise: 'Rotate counter-clockwise',
  rotateClockwise: 'Rotate clockwise',
  empty: 'No document loaded',
  loading: 'Loading document…',
  error: 'The document could not be loaded.',
  pageOf: (page, total) => `Page ${page} of ${total}`,
  pageAlt: (page) => `Page ${page}`,

  signaturePanel: 'Signatures',
  tabDraw: 'Draw',
  tabType: 'Type',
  tabUpload: 'Upload',
  drawCanvas: 'Signature drawing area',
  drawHint: 'Draw your signature with a mouse, finger or stylus.',
  undo: 'Undo',
  clear: 'Clear',
  useSignature: 'Use signature',
  typeInput: 'Your name',
  typePlaceholder: 'Type your name',
  typeFont: 'Style',
  typePreview: 'Signature preview',
  uploadChoose: 'Choose an image',
  uploadHelp: 'PNG, JPEG, WebP or SVG. Transparent backgrounds work best.',
  uploadInvalid: 'That file is not a supported image.',
  uploadTooLarge: 'That image is too large.',
  organizationEmpty: 'No organization signatures are available.',
  librarySection: 'Ready to place',
  libraryEmpty: 'Create or choose a signature above.',
  removeFromLibrary: 'Remove from list',
  armedHint: 'Click on the page to place it, or drag it from the list.',
  cancelPlacing: 'Cancel',

  placementLabel: (index, name) => `${name} ${index}`,
  signatureName: 'Signature',
  removePlacement: 'Remove signature',
  resizeHandle: 'Resize',

  fieldsEditor: 'Signature fields',
  addField: 'Add signature field',
  addFieldHint: 'Click on the page to place the field.',
  fieldLabelInput: 'Field label',
  fieldRequired: 'Required',
  removeField: 'Remove field',
  fieldHint: 'Click to sign',
  fieldName: 'Signature field',
  fieldAria: (label, required, filled) =>
    `${label}${required ? ', required' : ''}${filled ? ', signed' : ', empty. Press Enter to sign'}`,
};

/** Override to translate or reword the default UI. */
export const SIGNORA_LABELS = new InjectionToken<SignoraLabels>('SIGNORA_LABELS', {
  factory: () => DEFAULT_SIGNORA_LABELS,
});
