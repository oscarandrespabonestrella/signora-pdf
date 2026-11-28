import type { CertificateDetails, CertificateRevocationInfo, CheckOutcome } from 'signora-pdf';
import type * as Pkijs from 'pkijs';
import { sameBytes } from './bytes';
import { describeCertificate } from './certificate-details';
import { digest, type CmsContext } from './cms';
import { checkPathRevocation, type RevocationSources } from './revocation';

/** A trust anchor: a DER certificate, or a string holding one or more PEM certificates. */
export type TrustAnchorInput = Uint8Array | string;

/** A trust anchor passed in the options is not a readable certificate. Raised before anything is validated. */
export class TrustAnchorError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TrustAnchorError';
  }
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;

/**
 * Parses the trust anchors given in the options. Fails closed: an anchor that cannot be read
 * throws instead of being ignored, because a silently smaller set of anchors would reject
 * signatures for a confusing reason and a silently larger one could never happen.
 */
export function parseTrustAnchors(
  input: readonly TrustAnchorInput[],
  pkijs: typeof Pkijs,
): Pkijs.Certificate[] {
  const anchors: Pkijs.Certificate[] = [];
  const parse = (der: Uint8Array) => {
    try {
      anchors.push(pkijs.Certificate.fromBER(der as Uint8Array<ArrayBuffer>));
    } catch (cause) {
      throw new TrustAnchorError('A trust anchor is not a readable X.509 certificate.', { cause });
    }
  };
  for (const item of input) {
    if (typeof item === 'string') {
      const blocks = [...item.matchAll(PEM_BLOCK)];
      if (blocks.length === 0) {
        throw new TrustAnchorError('A trust anchor string contains no PEM certificate.');
      }
      for (const block of blocks) {
        try {
          parse(Uint8Array.from(atob(block[1].replace(/\s+/g, '')), (c) => c.charCodeAt(0)));
        } catch (error) {
          if (error instanceof TrustAnchorError) throw error;
          throw new TrustAnchorError('A PEM trust anchor is not valid base64.', { cause: error });
        }
      }
    } else {
      parse(item);
    }
  }
  return anchors;
}

/** Result of checking one certificate against the trust anchors. */
export interface ChainEvaluation {
  readonly outcome: CheckOutcome;
  /** The path that was built (leaf first), when there is one. */
  readonly path: readonly CertificateDetails[];
  readonly error?: string;
  /** Revocation status of each certificate of the path but the anchor. Absent when not checked. */
  readonly revocation?: readonly CertificateRevocationInfo[];
  /** Outcome of the revocation check, when it was done. */
  readonly revocationOutcome?: CheckOutcome;
  /** The chain was rejected because a certificate was revoked. */
  readonly revoked?: boolean;
  /** A certificate was revoked, but after the moment checked at. */
  readonly revokedLater?: boolean;
}

const NOT_EVALUATED: ChainEvaluation = { outcome: 'not-evaluated', path: [] };

/**
 * Builds a path from `leaf` to one of the trust anchors using the other embedded certificates as
 * intermediates, and validates it as of `at`: signatures, validity periods, basic constraints and
 * name constraints. Then, unless revocation is off, every certificate but the anchor is checked
 * against CRL and OCSP evidence: embedded in the signature (`revocationSources`), provided in the
 * options, or fetched by the caller's fetcher. `basis` says how `at` was obtained, which decides
 * which evidence is recent enough.
 */
export async function evaluateChain(
  leaf: Pkijs.Certificate,
  embedded: readonly Pkijs.Certificate[],
  at: Date,
  basis: 'timestamp' | 'validation-time',
  revocationSources: RevocationSources,
  context: CmsContext,
): Promise<ChainEvaluation> {
  if (context.anchors.length === 0) return NOT_EVALUATED;

  const sha256 = (data: Uint8Array) => digest(context.crypto, 'SHA-256', data);
  const leafBytes = new Uint8Array(leaf.tbsView);
  const same = (a: Pkijs.Certificate, b: Pkijs.Certificate) =>
    sameBytes(new Uint8Array(a.tbsView), new Uint8Array(b.tbsView));

  // The certificate itself is a trust anchor (pinned): no path is needed, only validity.
  if (context.anchors.some((anchor) => sameBytes(new Uint8Array(anchor.tbsView), leafBytes))) {
    const path = [await describeCertificate(leaf, sha256)];
    const valid = at >= leaf.notBefore.value && at <= leaf.notAfter.value;
    return valid
      ? { outcome: 'passed', path }
      : {
          outcome: 'failed',
          path,
          error: `The trusted certificate is not valid at ${at.toISOString()}.`,
        };
  }

  const engine = new context.pkijs.CertificateChainValidationEngine({
    // PKI.js treats the last certificate as the one to validate.
    certs: [...embedded.filter((c) => c !== leaf), leaf],
    trustedCerts: [...context.anchors],
    checkDate: at,
  });
  try {
    const result = await engine.verify({ passedWhenNotRevValues: true }, context.engine);
    const found = result.certificatePath ?? [];
    const path = await Promise.all(found.map((c) => describeCertificate(c, sha256)));
    // PKI.js picks the certificate to validate itself (the last one after de-duplicating);
    // never accept a path that does not start at the certificate we were asked about.
    if (found.length > 0 && !same(found[0], leaf)) {
      return {
        outcome: 'failed',
        path,
        error: 'The chain engine validated a different certificate than the signer.',
      };
    }
    if (!result.result) {
      return {
        outcome: 'failed',
        path,
        error: result.resultMessage || 'No valid certificate path.',
      };
    }
    if (context.revocation.mode === 'off') return { outcome: 'passed', path };

    const revocation = await checkPathRevocation(found, revocationSources, at, basis, context);
    const base = {
      path,
      revocation: revocation.entries,
      revocationOutcome: revocation.outcome,
      revokedLater: revocation.revokedLater,
    };
    if (revocation.revoked) {
      const entry = revocation.entries.find((e) => e.status === 'revoked');
      return {
        outcome: 'failed',
        revoked: true,
        error: `The certificate "${entry?.subject}" was revoked${entry?.revokedAt ? ` on ${entry.revokedAt.toISOString()}` : ''}${entry?.reason ? ` (${entry.reason})` : ''}.`,
        ...base,
      };
    }
    return { outcome: 'passed', ...base };
  } catch (error) {
    return {
      outcome: 'failed',
      path: [],
      error: error instanceof Error ? error.message : 'No valid certificate path.',
    };
  }
}
