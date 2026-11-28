import type { DocumentSecurityStoreSummary, SignatureValidationResult } from 'signora-pdf';
import { readDss, type DocumentSecurityStore } from 'signora-pdf/pdf-lib';
import type * as Pkijs from 'pkijs';
import { sameBytes } from './bytes';
import { RevocationSources, sourcesFromDss } from './revocation';

/** What a document's DSS contributes to validating it. */
export interface ValidationStore {
  readonly raw: DocumentSecurityStore;
  /** Certificates to build chains from (more candidates; they are verified like any other). */
  readonly certificates: readonly Pkijs.Certificate[];
  /** CRLs and OCSP responses, with origin `dss`. */
  readonly sources: RevocationSources;
  readonly summary: DocumentSecurityStoreSummary;
}

/** Reads the DSS of `pdf`. A DSS that cannot be read is treated as absent: it only adds evidence. */
export async function readValidationStore(
  pdf: Uint8Array,
  pkijs: typeof Pkijs,
): Promise<ValidationStore | undefined> {
  let raw: DocumentSecurityStore | undefined;
  try {
    raw = await readDss(pdf);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  const certificates: Pkijs.Certificate[] = [];
  for (const der of raw.certs) {
    try {
      certificates.push(pkijs.Certificate.fromBER(der as Uint8Array<ArrayBuffer>));
    } catch {
      // not a certificate: skipped
    }
  }
  return {
    raw,
    certificates,
    sources: sourcesFromDss(raw, pkijs),
    summary: {
      certificates: raw.certs.length,
      crls: raw.crls.length,
      ocsps: raw.ocsps.length,
      signatures: Object.keys(raw.vri).length,
    },
  };
}

const holds = (items: readonly Uint8Array[], wanted: Uint8Array) =>
  items.some((item) => sameBytes(item, wanted));

/** Does a DSS contain this certificate, CRL or OCSP response? */
function stores(dss: DocumentSecurityStore, wanted: Uint8Array): boolean {
  return holds(dss.certs, wanted) || holds(dss.crls, wanted) || holds(dss.ocsps, wanted);
}

/** What `result` took from the DSS: the evidence it relied on, and the chain certificates the signature does not carry. */
function takenFromDss(result: SignatureValidationResult, dss: DocumentSecurityStore): Uint8Array[] {
  const taken: Uint8Array[] = [];
  for (const entry of result.chain?.revocation ?? []) {
    if (entry.origin === 'dss' && entry.evidence) taken.push(entry.evidence);
  }
  const own = result.certificates.map((c) => c.der);
  // The last certificate of a path is the trust anchor, which the caller supplied.
  for (const certificate of (result.chain?.path ?? []).slice(0, -1)) {
    if (!holds(own, certificate.der) && holds(dss.certs, certificate.der))
      taken.push(certificate.der);
  }
  return taken;
}

/**
 * Promotes `B-LT` signatures to `B-LTA`: a valid, trusted document timestamp issued after the
 * signature must cover everything the signature took from the DSS, that is, the DSS as it was
 * when the timestamp was made already held it. A DSS added after the last timestamp does not count.
 */
export async function promoteToArchival(
  pdf: Uint8Array,
  results: readonly SignatureValidationResult[],
  store: ValidationStore | undefined,
): Promise<SignatureValidationResult[]> {
  const snapshots = new Map<number, Promise<DocumentSecurityStore | undefined>>();
  const dssUpTo = (end: number) => {
    let snapshot = snapshots.get(end);
    if (!snapshot) {
      snapshot = readDss(pdf.subarray(0, end)).catch(() => undefined);
      snapshots.set(end, snapshot);
    }
    return snapshot;
  };

  return Promise.all(
    results.map(async (result) => {
      const range = result.signature.byteRange;
      if (result.padesLevel !== 'B-LT' || !range) return result;
      const end = range[2] + range[3];
      const taken = store ? takenFromDss(result, store.raw) : [];

      for (const stamp of results) {
        const stampRange = stamp.signature.byteRange;
        if (
          stamp.signature.kind !== 'document-timestamp' ||
          stamp.status !== 'valid' ||
          stamp.timestamp?.authorityChain !== 'passed' ||
          !stampRange
        ) {
          continue;
        }
        const stampEnd = stampRange[2] + stampRange[3];
        if (stampEnd <= end) continue; // not after this signature
        if (taken.length === 0) return { ...result, padesLevel: 'B-LTA' as const };
        const covered = await dssUpTo(stampEnd);
        if (covered && taken.every((item) => stores(covered, item))) {
          return { ...result, padesLevel: 'B-LTA' as const };
        }
      }
      return result;
    }),
  );
}
