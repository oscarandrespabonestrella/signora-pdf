import type { ValidationReport } from 'signora-pdf';

/** Version of the JSON layout produced by {@link serializeValidationReport}. */
export const VALIDATION_REPORT_SCHEMA_VERSION = 1;

/**
 * JSON for storage or audit: dates as ISO 8601, raw bytes (`contents`, certificate `der`) left
 * out, keys in a fixed order. Includes `schemaVersion`.
 */
export function serializeValidationReport(report: ValidationReport, space = 2): string {
  return JSON.stringify(
    { schemaVersion: VALIDATION_REPORT_SCHEMA_VERSION, ...report },
    (key, value: unknown) =>
      key === 'der' || key === 'contents' || key === 'evidence' ? undefined : value,
    space,
  );
}

/** Short, human-readable summary of a report. */
export function formatValidationReport(report: ValidationReport): string {
  const lines = [
    `Document SHA-256: ${report.documentSha256}`,
    `Overall: ${report.status.toUpperCase()} (${report.results.length} signature(s))`,
    ...(report.dss
      ? [
          `DSS: ${report.dss.certificates} certificate(s), ${report.dss.crls} CRL(s), ` +
            `${report.dss.ocsps} OCSP response(s)`,
        ]
      : []),
  ];
  for (const result of report.results) {
    const s = result.signature;
    lines.push(
      '',
      `[${result.status.toUpperCase()}] ${s.fieldName} (${s.subFilter ?? 'unknown format'})`,
      `  signer: ${result.signer?.subject ?? 'unknown'}`,
      `  claimed time: ${s.signingTime?.toISOString() ?? 'none'}`,
      ...(result.timestamp
        ? [
            `  timestamp: ${result.timestamp.genTime.toISOString()} by ` +
              `${result.timestamp.authority?.subject ?? 'unknown authority'}`,
          ]
        : []),
      ...(result.chain
        ? [
            `  chain (${result.chain.basis}): ` +
              (result.chain.path.map((c) => c.subject).join(' <- ') || result.chain.error),
          ]
        : []),
      ...(result.chain?.revocation
        ? [
            '  revocation: ' +
              result.chain.revocation
                .map((r) => `${r.status}${r.source ? ` (${r.source}, ${r.origin})` : ''}`)
                .join(', '),
          ]
        : []),
      ...(result.laterRevisions
        ? [
            '  later revisions: ' +
              (result.laterRevisions.changes.map((c) => c.kind).join(', ') || 'none') +
              (result.laterRevisions.permitted ? '' : ' (NOT PERMITTED)'),
          ]
        : []),
      ...(result.padesLevel ? [`  PAdES level: ${result.padesLevel}`] : []),
      `  checks: byte range ${result.checks.byteRange}, integrity ${result.checks.integrity}, ` +
        `signature ${result.checks.signature}, timestamp ${result.checks.timestamp}, ` +
        `chain ${result.checks.certificateChain}`,
    );
    for (const p of result.problems) lines.push(`  problem ${p.code}: ${p.message}`);
    for (const w of result.warnings) lines.push(`  warning ${w.code}: ${w.message}`);
  }
  if (report.unsignedFields.length > 0) {
    lines.push('', `Unsigned fields: ${report.unsignedFields.join(', ')}`);
  }
  return lines.join('\n');
}
