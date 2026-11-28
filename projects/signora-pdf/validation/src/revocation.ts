import type { CertificateRevocationInfo, CheckOutcome, RevocationStatus } from 'signora-pdf';
import type * as Pkijs from 'pkijs';
import { toHex } from './bytes';
import { formatName } from './certificate-details';
import type { CmsContext } from './cms';

/** What to do about revocation (CRL and OCSP) when a chain is checked. */
export type RevocationMode =
  /** Do not look at revocation. */
  | 'off'
  /** Use the evidence that is available; a certificate without any is reported, not rejected. Default. */
  | 'if-available'
  /** Every certificate of the chain needs usable evidence, or the signature is `indeterminate`. */
  | 'require';

/** CRLs and OCSP responses you already have, as DER. */
export interface RevocationData {
  readonly crls?: readonly Uint8Array[];
  /** `OCSPResponse` (the full response) or `BasicOCSPResponse`. */
  readonly ocsps?: readonly Uint8Array[];
}

/** A request for revocation evidence that Signora wants your code to fetch. */
export interface RevocationRequest {
  readonly kind: 'ocsp' | 'crl';
  /** The `http` or `https` URL taken from the certificate (AIA or CRL distribution point). */
  readonly url: string;
  /** For `ocsp`: the DER `OCSPRequest` to `POST` with `Content-Type: application/ocsp-request`. For `crl`: none, `GET` the URL. */
  readonly body?: Uint8Array;
}

/**
 * Fetches revocation evidence. Return the DER bytes, or `undefined` if there are none. It may
 * throw: that only means the evidence is unavailable. Signora never fetches anything by itself.
 *
 * **The URLs come from the certificates being validated, that is, from the document.** On a
 * server this is an SSRF vector: only fetch what you allow (see {@link httpRevocationFetcher}).
 */
export type RevocationFetcher = (request: RevocationRequest) => Promise<Uint8Array | undefined>;

/** `revocationData` could not be read. Raised before anything is validated. */
export class RevocationDataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RevocationDataError';
  }
}

type Origin = 'embedded' | 'dss' | 'provided' | 'fetched';
interface Item<T> {
  readonly value: T;
  readonly origin: Origin;
  /** The bytes it was read from. */
  readonly der: Uint8Array;
}

/** A set of CRLs and OCSP responses to look evidence up in. */
export class RevocationSources {
  readonly crls: Item<Pkijs.CertificateRevocationList>[] = [];
  readonly ocsps: Item<Pkijs.BasicOCSPResponse>[] = [];

  merge(other: RevocationSources): RevocationSources {
    const merged = new RevocationSources();
    merged.crls.push(...this.crls, ...other.crls);
    merged.ocsps.push(...this.ocsps, ...other.ocsps);
    return merged;
  }
}

const OCSP_BASIC_OID = '1.3.6.1.5.5.7.48.1.1';
const OCSP_RESPONSE_REVINFO_OID = '1.3.6.1.5.5.7.16.2';
const ADBE_REVOCATION_OID = '1.2.840.113583.1.1.8';
const CADES_REVOCATION_VALUES_OID = '1.2.840.113549.1.9.16.2.24';
const AIA_OID = '1.3.6.1.5.5.7.1.1';
const AIA_OCSP_OID = '1.3.6.1.5.5.7.48.1';
const CDP_OID = '2.5.29.31';
const ISSUING_DISTRIBUTION_POINT_OID = '2.5.29.28';
const DELTA_CRL_INDICATOR_OID = '2.5.29.27';
const REASON_CODE_OID = '2.5.29.21';
const BASIC_CONSTRAINTS_OID = '2.5.29.19';

/** Clock skew tolerated between the issuer of the evidence and us. */
const SKEW_MS = 5 * 60_000;
/** An OCSP response without `nextUpdate` is trusted this long after `thisUpdate`. */
const OCSP_MAX_AGE_MS = 24 * 3600_000;

const REASONS = [
  'unspecified',
  'keyCompromise',
  'cACompromise',
  'affiliationChanged',
  'superseded',
  'cessationOfOperation',
  'certificateHold',
  'removeFromCRL',
  'privilegeWithdrawn',
  'aACompromise',
];

// ---------------------------------------------------------------------------------------------
// Reading evidence

/** Parses a CRL, or `undefined` if the bytes are not one. */
export function parseCrl(
  der: Uint8Array,
  pkijs: typeof Pkijs,
): Pkijs.CertificateRevocationList | undefined {
  try {
    return pkijs.CertificateRevocationList.fromBER(der as Uint8Array<ArrayBuffer>);
  } catch {
    return undefined;
  }
}

/** Parses an `OCSPResponse` (successful, basic) or a bare `BasicOCSPResponse`. */
export function parseOcsp(
  der: Uint8Array,
  pkijs: typeof Pkijs,
): Pkijs.BasicOCSPResponse | undefined {
  try {
    const response = pkijs.OCSPResponse.fromBER(der as Uint8Array<ArrayBuffer>);
    if (response.responseStatus.valueBlock.valueDec !== 0 || !response.responseBytes) {
      return undefined;
    }
    if (response.responseBytes.responseType !== OCSP_BASIC_OID) return undefined;
    return pkijs.BasicOCSPResponse.fromBER(
      new Uint8Array(response.responseBytes.response.valueBlock.valueHexView),
    );
  } catch {
    // Not a wrapped response: maybe the BasicOCSPResponse itself.
  }
  try {
    return pkijs.BasicOCSPResponse.fromBER(der as Uint8Array<ArrayBuffer>);
  } catch {
    return undefined;
  }
}

/** CRLs and OCSP responses of a DSS. Unreadable items are skipped: like any embedded data, they only count if they verify. */
export function sourcesFromDss(
  dss: { readonly crls: readonly Uint8Array[]; readonly ocsps: readonly Uint8Array[] },
  pkijs: typeof Pkijs,
): RevocationSources {
  const sources = new RevocationSources();
  for (const der of dss.crls) {
    const crl = parseCrl(der, pkijs);
    if (crl) sources.crls.push({ value: crl, origin: 'dss', der });
  }
  for (const der of dss.ocsps) {
    const ocsp = parseOcsp(der, pkijs);
    if (ocsp) sources.ocsps.push({ value: ocsp, origin: 'dss', der });
  }
  return sources;
}

/** Builds sources from DER bytes the caller provided. Unreadable bytes are an error, not ignored. */
export function sourcesFromData(data: RevocationData, pkijs: typeof Pkijs): RevocationSources {
  const sources = new RevocationSources();
  for (const der of data.crls ?? []) {
    const crl = parseCrl(der, pkijs);
    if (!crl) throw new RevocationDataError('A CRL in revocationData is not readable.');
    sources.crls.push({ value: crl, origin: 'provided', der });
  }
  for (const der of data.ocsps ?? []) {
    const ocsp = parseOcsp(der, pkijs);
    if (!ocsp) throw new RevocationDataError('An OCSP response in revocationData is not readable.');
    sources.ocsps.push({ value: ocsp, origin: 'provided', der });
  }
  return sources;
}

/** The little of an asn1js node that is read here. */
interface Asn1 {
  idBlock: { tagClass: number; tagNumber: number };
  valueBlock: { value?: Asn1[] };
  toBER(): ArrayBuffer;
}

/**
 * Items of a `RevocationValues`-like structure: `SEQUENCE { [0] SEQUENCE OF crl, [1] SEQUENCE OF
 * ocsp, ... }`. The same shape serves Adobe's `adbe-revocationInfoArchival` and CAdES
 * `revocation-values`. Explicit and implicit tagging are both accepted.
 */
export function readRevocationAttribute(
  value: unknown,
  pkijs: typeof Pkijs,
  into: RevocationSources,
): void {
  const root = value as Asn1 | undefined;
  for (const child of root?.valueBlock?.value ?? []) {
    if (child?.idBlock?.tagClass !== 3) continue; // context-specific
    const tag = child.idBlock.tagNumber;
    if (tag !== 0 && tag !== 1) continue;
    const inner = child.valueBlock.value ?? [];
    // Explicit tagging wraps a SEQUENCE OF items; implicit tagging makes the tag the SEQUENCE OF.
    // With a single item the two look alike, so try the explicit reading and fall back to the other.
    const explicit = inner.length === 1 ? (inner[0].valueBlock.value ?? []) : [];
    const read = (nodes: readonly Asn1[]): number => {
      let found = 0;
      for (const item of nodes) {
        const der = new Uint8Array(item.toBER());
        if (tag === 0) {
          const crl = parseCrl(der, pkijs);
          if (crl) into.crls.push({ value: crl, origin: 'embedded', der });
          found += crl ? 1 : 0;
        } else {
          const ocsp = parseOcsp(der, pkijs);
          if (ocsp) into.ocsps.push({ value: ocsp, origin: 'embedded', der });
          found += ocsp ? 1 : 0;
        }
      }
      return found;
    };
    if (read(explicit) === 0) read(inner);
  }
}

/**
 * The revocation evidence a CMS signature carries: its `crls` field, Adobe's
 * `adbe-revocationInfoArchival` and CAdES `revocation-values`, in any signer attribute. Unreadable
 * items are skipped: embedded data is not trusted anyway, it only counts if it verifies.
 */
export function extractEmbeddedRevocation(
  signedData: Pkijs.SignedData,
  pkijs: typeof Pkijs,
): RevocationSources {
  const sources = new RevocationSources();

  for (const entry of signedData.crls ?? []) {
    if (entry instanceof pkijs.CertificateRevocationList) {
      sources.crls.push({
        value: entry,
        origin: 'embedded',
        der: new Uint8Array(entry.toSchema().toBER()),
      });
    } else if (
      (entry as Pkijs.OtherRevocationInfoFormat).otherRevInfoFormat === OCSP_RESPONSE_REVINFO_OID
    ) {
      const holder = (entry as Pkijs.OtherRevocationInfoFormat).otherRevInfo as unknown as Asn1;
      const der = holder ? new Uint8Array(holder.toBER()) : undefined;
      const ocsp = der ? parseOcsp(der, pkijs) : undefined;
      if (ocsp && der) sources.ocsps.push({ value: ocsp, origin: 'embedded', der });
    }
  }

  for (const signerInfo of signedData.signerInfos) {
    for (const attributes of [signerInfo.signedAttrs, signerInfo.unsignedAttrs]) {
      for (const attribute of attributes?.attributes ?? []) {
        if (
          attribute.type === ADBE_REVOCATION_OID ||
          attribute.type === CADES_REVOCATION_VALUES_OID
        ) {
          for (const value of attribute.values) readRevocationAttribute(value, pkijs, sources);
        }
      }
    }
  }
  return sources;
}

// ---------------------------------------------------------------------------------------------
// Evaluating evidence

interface Evidence {
  readonly status: RevocationStatus;
  readonly source: 'ocsp' | 'crl';
  readonly origin: Origin;
  readonly der: Uint8Array;
  readonly revokedAt?: Date;
  readonly reason?: string;
  readonly thisUpdate: Date;
  readonly nextUpdate?: Date;
}

/** Result of checking the revocation of every certificate of a path. */
export interface RevocationEvaluation {
  readonly entries: readonly CertificateRevocationInfo[];
  /** `passed`: all good. `failed`: one was revoked. `not-evaluated`: some are unknown. */
  readonly outcome: CheckOutcome;
  /** A certificate was revoked at or before the moment it is checked at. */
  readonly revoked: boolean;
  /** A certificate was revoked, but after that moment. */
  readonly revokedLater: boolean;
}

/** Per-validation state for revocation: what was provided, the fetcher and what it already fetched. */
export interface RevocationContext {
  readonly mode: RevocationMode;
  readonly provided: RevocationSources;
  /** What the document's own DSS holds. */
  readonly dss: RevocationSources;
  readonly fetcher?: RevocationFetcher;
  readonly cache: Map<string, Promise<Uint8Array | undefined>>;
}

/** The `basis` of a chain check: see `CertificateChainInfo.basis`. */
type Basis = 'timestamp' | 'validation-time';

const sameInteger = (a: { isEqual(other: unknown): boolean }, b: unknown) => a.isEqual(b);

/** Can evidence issued at `thisUpdate` be relied on for the moment `at`? */
function usable(
  thisUpdate: Date,
  nextUpdate: Date | undefined,
  at: Date,
  basis: Basis,
  now: Date,
  ocsp: boolean,
): boolean {
  if (thisUpdate.getTime() > now.getTime() + SKEW_MS) return false; // from the future
  if (basis === 'timestamp') {
    // Proving the status at a past moment: the evidence must have been issued after it, so that a
    // revocation before it would show.
    return thisUpdate.getTime() >= at.getTime();
  }
  // The present: the evidence must be current.
  if (thisUpdate.getTime() > at.getTime() + SKEW_MS) return false;
  if (nextUpdate) return nextUpdate.getTime() >= at.getTime();
  return !ocsp || at.getTime() - thisUpdate.getTime() <= OCSP_MAX_AGE_MS;
}

function reasonName(code: number | undefined): string | undefined {
  return code === undefined ? undefined : (REASONS[code] ?? String(code));
}

async function ocspEvidence(
  item: Item<Pkijs.BasicOCSPResponse>,
  certificate: Pkijs.Certificate,
  issuer: Pkijs.Certificate,
  context: CmsContext,
): Promise<Evidence | undefined> {
  const response = item.value;
  try {
    // Authenticates the responder: the issuer itself, or a delegated responder it certified.
    const verified = await response.verify(
      { trustedCerts: [...context.anchors], issuerCerts: [issuer] },
      context.engine,
    );
    if (!verified) return undefined;
    const answer = await response.getCertificateStatus(certificate, issuer, context.engine);
    if (!answer.isForCertificate || answer.status === 2) return undefined;

    const single = response.tbsResponseData.responses.find((r) =>
      sameInteger(r.certID.serialNumber, certificate.serialNumber),
    );
    if (!single) return undefined;
    let revokedAt: Date | undefined;
    let reason: number | undefined;
    if (answer.status === 1) {
      const status = single.certStatus as {
        valueBlock?: {
          value?: {
            toDate?(): Date;
            idBlock?: { tagNumber: number };
            valueBlock?: { value?: { valueBlock?: { valueDec?: number } }[] };
          }[];
        };
      };
      const children = status.valueBlock?.value ?? [];
      revokedAt = children.find((c) => typeof c.toDate === 'function')?.toDate?.();
      reason = children.find((c) => c.idBlock?.tagNumber === 0)?.valueBlock?.value?.[0]?.valueBlock
        ?.valueDec;
    }
    return {
      status: answer.status === 0 ? 'good' : 'revoked',
      source: 'ocsp',
      origin: item.origin,
      der: item.der,
      revokedAt,
      reason: reasonName(reason),
      thisUpdate: single.thisUpdate,
      nextUpdate: single.nextUpdate,
    };
  } catch {
    return undefined;
  }
}

function isCa(certificate: Pkijs.Certificate): boolean {
  const extension = certificate.extensions?.find((e) => e.extnID === BASIC_CONSTRAINTS_OID);
  return !!(extension?.parsedValue as { cA?: boolean } | undefined)?.cA;
}

async function crlEvidence(
  item: Item<Pkijs.CertificateRevocationList>,
  certificate: Pkijs.Certificate,
  issuer: Pkijs.Certificate,
  context: CmsContext,
): Promise<Evidence | undefined> {
  const crl = item.value;
  try {
    if (!crl.issuer.isEqual(certificate.issuer)) return undefined;
    const extensions = crl.crlExtensions?.extensions ?? [];
    // Delta CRLs and indirect or partitioned CRLs say only part of the story: not handled.
    if (extensions.some((e) => e.extnID === DELTA_CRL_INDICATOR_OID)) return undefined;
    const scope = extensions.find((e) => e.extnID === ISSUING_DISTRIBUTION_POINT_OID)
      ?.parsedValue as
      | {
          indirectCRL?: boolean;
          onlyContainsUserCerts?: boolean;
          onlyContainsCACerts?: boolean;
          onlyContainsAttributeCerts?: boolean;
        }
      | undefined;
    if (scope) {
      if (scope.indirectCRL || scope.onlyContainsAttributeCerts) return undefined;
      if (scope.onlyContainsUserCerts && isCa(certificate)) return undefined;
      if (scope.onlyContainsCACerts && !isCa(certificate)) return undefined;
    }
    if (!(await crl.verify({ issuerCertificate: issuer }, context.engine))) return undefined;

    const entry = crl.revokedCertificates?.find((r) =>
      sameInteger(r.userCertificate, certificate.serialNumber),
    );
    const reasonExtension = entry?.crlEntryExtensions?.extensions.find(
      (e) => e.extnID === REASON_CODE_OID,
    )?.parsedValue as { valueBlock?: { valueDec?: number } } | undefined;
    return {
      status: entry ? 'revoked' : 'good',
      source: 'crl',
      origin: item.origin,
      der: item.der,
      revokedAt: entry?.revocationDate.value,
      reason: reasonName(reasonExtension?.valueBlock?.valueDec),
      thisUpdate: crl.thisUpdate.value,
      nextUpdate: crl.nextUpdate?.value,
    };
  } catch {
    return undefined;
  }
}

/** URLs (`http`/`https`) of the OCSP responders and CRL distribution points a certificate names. */
export function revocationUrls(certificate: Pkijs.Certificate): { ocsp: string[]; crl: string[] } {
  const ocsp: string[] = [];
  const crl: string[] = [];
  const web = (value: unknown): value is string =>
    typeof value === 'string' && /^https?:\/\//i.test(value);
  for (const extension of certificate.extensions ?? []) {
    if (extension.extnID === AIA_OID) {
      const descriptions = (
        extension.parsedValue as {
          accessDescriptions?: {
            accessMethod: string;
            accessLocation: { type: number; value: unknown };
          }[];
        }
      ).accessDescriptions;
      for (const d of descriptions ?? []) {
        if (
          d.accessMethod === AIA_OCSP_OID &&
          d.accessLocation.type === 6 &&
          web(d.accessLocation.value)
        ) {
          ocsp.push(d.accessLocation.value);
        }
      }
    } else if (extension.extnID === CDP_OID) {
      const points = (
        extension.parsedValue as {
          distributionPoints?: { distributionPoint?: { type: number; value: unknown }[] }[];
        }
      ).distributionPoints;
      for (const point of points ?? []) {
        // `distributionPoint` is a fullName: a list of general names.
        const names = Array.isArray(point.distributionPoint) ? point.distributionPoint : [];
        for (const name of names) if (name.type === 6 && web(name.value)) crl.push(name.value);
      }
    }
  }
  return { ocsp, crl };
}

async function fetchEvidence(
  kind: 'ocsp' | 'crl',
  certificate: Pkijs.Certificate,
  issuer: Pkijs.Certificate,
  context: CmsContext,
): Promise<RevocationSources> {
  const fetched = new RevocationSources();
  const fetcher = context.revocation.fetcher;
  if (!fetcher) return fetched;
  const { cache } = context.revocation;
  const urls = revocationUrls(certificate);

  const once = (key: string, request: RevocationRequest) => {
    let pending = cache.get(key);
    if (!pending) {
      pending = Promise.resolve()
        .then(() => fetcher(request))
        .catch(() => undefined);
      cache.set(key, pending);
    }
    return pending;
  };

  if (kind === 'ocsp') {
    for (const url of urls.ocsp) {
      const request = new context.pkijs.OCSPRequest();
      await request.createForCertificate(
        certificate,
        { hashAlgorithm: 'SHA-1', issuerCertificate: issuer },
        context.engine,
      );
      const body = new Uint8Array(request.toSchema(true).toBER(false));
      const der = await once(`ocsp:${url}:${toHex(body)}`, { kind, url, body });
      const ocsp = der ? parseOcsp(der, context.pkijs) : undefined;
      if (ocsp && der) fetched.ocsps.push({ value: ocsp, origin: 'fetched', der });
    }
  } else {
    for (const url of urls.crl) {
      const der = await once(`crl:${url}`, { kind, url });
      const crl = der ? parseCrl(der, context.pkijs) : undefined;
      if (crl && der) fetched.crls.push({ value: crl, origin: 'fetched', der });
    }
  }
  return fetched;
}

async function evidenceFor(
  sources: RevocationSources,
  certificate: Pkijs.Certificate,
  issuer: Pkijs.Certificate,
  context: CmsContext,
): Promise<Evidence[]> {
  const all = await Promise.all([
    ...sources.ocsps.map((item) => ocspEvidence(item, certificate, issuer, context)),
    ...sources.crls.map((item) => crlEvidence(item, certificate, issuer, context)),
  ]);
  return all.filter((e): e is Evidence => e !== undefined);
}

/** Decides one certificate's status from the evidence that can be relied on at `at`. */
function decide(
  evidence: readonly Evidence[],
  at: Date,
  basis: Basis,
  now: Date,
): { status: RevocationStatus; chosen?: Evidence; revokedLater?: Date } {
  const relevant = evidence.filter((e) =>
    usable(e.thisUpdate, e.nextUpdate, at, basis, now, e.source === 'ocsp'),
  );
  const revoked = relevant.filter((e) => e.status === 'revoked');
  const revokedNow = revoked
    .filter((e) => e.revokedAt && e.revokedAt.getTime() <= at.getTime())
    .sort((a, b) => a.revokedAt!.getTime() - b.revokedAt!.getTime());
  if (revokedNow[0]) return { status: 'revoked', chosen: revokedNow[0] };
  const later = revoked.find((e) => e.revokedAt && e.revokedAt.getTime() > at.getTime());
  const good = relevant.find((e) => e.status === 'good') ?? later;
  if (good) return { status: 'good', chosen: good, revokedLater: later?.revokedAt };
  return { status: 'unknown' };
}

/**
 * Revocation status of every certificate of `path` (leaf first, trust anchor last; the anchor
 * itself is not checked), as of `at`. Evidence comes from `embedded`, from what the caller provided
 * and, if still unknown, from the fetcher.
 */
export async function checkPathRevocation(
  path: readonly Pkijs.Certificate[],
  embedded: RevocationSources,
  at: Date,
  basis: Basis,
  context: CmsContext,
): Promise<RevocationEvaluation> {
  const now = context.validationTime;
  const entries: CertificateRevocationInfo[] = [];
  let revoked = false;
  let revokedLater = false;
  let unknown = false;

  for (let i = 0; i < path.length - 1; i++) {
    const certificate = path[i];
    const issuer = path[i + 1];
    const sources = context.revocation.provided.merge(context.revocation.dss).merge(embedded);
    let evidence = await evidenceFor(sources, certificate, issuer, context);
    let decision = decide(evidence, at, basis, now);

    // Ask for evidence only while it is still unknown: OCSP first, then the CRL.
    for (const kind of ['ocsp', 'crl'] as const) {
      if (decision.status !== 'unknown' || !context.revocation.fetcher) break;
      const fetched = await fetchEvidence(kind, certificate, issuer, context);
      evidence = [...evidence, ...(await evidenceFor(fetched, certificate, issuer, context))];
      decision = decide(evidence, at, basis, now);
    }

    const subject = certificateSubject(certificate);
    const serialNumber = toHex(new Uint8Array(certificate.serialNumber.valueBlock.valueHexView));
    const { chosen } = decision;
    entries.push({
      subject,
      serialNumber,
      status: decision.status,
      ...(chosen
        ? {
            source: chosen.source,
            origin: chosen.origin,
            evidence: chosen.der,
            revokedAt: chosen.status === 'revoked' ? chosen.revokedAt : decision.revokedLater,
            reason: chosen.reason,
            thisUpdate: chosen.thisUpdate,
            nextUpdate: chosen.nextUpdate,
          }
        : {
            message:
              evidence.length === 0
                ? 'No CRL or OCSP evidence for this certificate.'
                : 'The CRL or OCSP evidence is not current enough for the checked moment.',
          }),
    });
    if (decision.status === 'revoked') revoked = true;
    if (decision.status === 'unknown') unknown = true;
    if (decision.revokedLater) revokedLater = true;
  }

  const outcome: CheckOutcome = revoked
    ? 'failed'
    : unknown || entries.length === 0
      ? 'not-evaluated'
      : 'passed';
  return { entries, outcome, revoked, revokedLater };
}

const certificateSubject = (certificate: Pkijs.Certificate): string =>
  formatName(certificate.subject);

// ---------------------------------------------------------------------------------------------
// A ready-made fetcher

/** Options of {@link httpRevocationFetcher}. */
export interface HttpRevocationFetcherOptions {
  /** `fetch` implementation. Defaults to the global one. */
  readonly fetch?: typeof fetch;
  /** Give up after this many milliseconds. Default 10 000. */
  readonly timeoutMs?: number;
  /**
   * Decide which URLs may be fetched. Defaults to every `http` and `https` URL. **Restrict it on a
   * server**: the URLs come from the document being validated, so an unrestricted fetcher lets
   * whoever made the document make your server request any address (SSRF).
   */
  readonly allow?: (url: URL) => boolean;
  /** Rewrite a URL before fetching, e.g. to go through a CORS proxy. */
  readonly rewrite?: (url: string) => string;
  /** Largest response accepted, in bytes. Default 5 MiB. */
  readonly maxBytes?: number;
}

/**
 * A {@link RevocationFetcher} on top of `fetch`: OCSP by `POST` (`application/ocsp-request`), CRL by
 * `GET`. In a browser the responders must allow CORS, or use `rewrite` to go through a proxy.
 * Errors, other statuses and oversized bodies yield no evidence.
 */
export function httpRevocationFetcher(
  options: HttpRevocationFetcherOptions = {},
): RevocationFetcher {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  return async (request) => {
    const url = new URL(options.rewrite ? options.rewrite(request.url) : request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (options.allow && !options.allow(url)) return undefined;
    const doFetch = options.fetch ?? globalThis.fetch;
    const response = await doFetch(url, {
      method: request.kind === 'ocsp' ? 'POST' : 'GET',
      headers:
        request.kind === 'ocsp'
          ? { 'content-type': 'application/ocsp-request', accept: 'application/ocsp-response' }
          : { accept: 'application/pkix-crl' },
      body: request.kind === 'ocsp' ? (request.body as Uint8Array<ArrayBuffer>) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!response.ok) return undefined;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length <= maxBytes ? bytes : undefined;
  };
}
