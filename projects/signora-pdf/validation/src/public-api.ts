/**
 * Reading and validating the digital signatures already present in a PDF. Never signs anything.
 * Requires the optional peer dependencies `pdf-lib`, `pkijs` and `asn1js`.
 *
 * @module signora-pdf/validation
 */
export * from './inspect-signatures';
export * from './report';
export { TrustAnchorError, type TrustAnchorInput } from './trust';
export * from './validate-signatures';
export {
  RevocationDataError,
  httpRevocationFetcher,
  type HttpRevocationFetcherOptions,
  type RevocationData,
  type RevocationFetcher,
  type RevocationMode,
  type RevocationRequest,
} from './revocation';
