/** A digital signing request failed or returned something that cannot be trusted. */
export class DigitalSigningError extends Error {
  constructor(
    message: string,
    readonly details: { readonly status?: number; readonly cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'DigitalSigningError';
  }
}
