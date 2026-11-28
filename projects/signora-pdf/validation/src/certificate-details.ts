import type { CertificateDetails } from 'signora-pdf';
import type { Certificate } from 'pkijs';
import { toHex } from './bytes';

const NAME_OIDS: Readonly<Record<string, string>> = {
  '2.5.4.3': 'CN',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'street',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.12': 'title',
  '2.5.4.42': 'GN',
  '2.5.4.97': 'organizationIdentifier',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '0.9.2342.19200300.100.1.25': 'DC',
};

const SIGNATURE_OIDS: Readonly<Record<string, string>> = {
  '1.2.840.113549.1.1.1': 'rsaEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.10045.4.1': 'ecdsa-with-SHA1',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',
  '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
  '1.3.101.112': 'Ed25519',
};

export const DIGEST_OIDS: Readonly<Record<string, { name: string; webCrypto: string }>> = {
  '1.3.14.3.2.26': { name: 'SHA-1', webCrypto: 'SHA-1' },
  '2.16.840.1.101.3.4.2.4': { name: 'SHA-224', webCrypto: 'SHA-224' },
  '2.16.840.1.101.3.4.2.1': { name: 'SHA-256', webCrypto: 'SHA-256' },
  '2.16.840.1.101.3.4.2.2': { name: 'SHA-384', webCrypto: 'SHA-384' },
  '2.16.840.1.101.3.4.2.3': { name: 'SHA-512', webCrypto: 'SHA-512' },
};

const CURVES: Readonly<Record<string, string>> = {
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
};

const KEY_USAGE_BITS = [
  'digitalSignature',
  'nonRepudiation',
  'keyEncipherment',
  'dataEncipherment',
  'keyAgreement',
  'keyCertSign',
  'cRLSign',
  'encipherOnly',
  'decipherOnly',
] as const;

export const signatureAlgorithmName = (oid: string): string => SIGNATURE_OIDS[oid] ?? oid;

/**
 * Name of the algorithm of a signature value. CMS usually says only `rsaEncryption` and keeps the
 * hash apart, so the digest is folded in to match what certificates report.
 */
export function describeSignatureAlgorithm(oid: string, digestName: string | undefined): string {
  if (oid === '1.2.840.113549.1.1.1' && digestName) {
    return `${digestName.replace('-', '').toLowerCase()}WithRSAEncryption`;
  }
  return signatureAlgorithmName(oid);
}

export function formatName(name: Certificate['subject']): string {
  return name.typesAndValues
    .map((entry) => {
      const value = (entry.value.valueBlock as { value?: unknown }).value;
      return `${NAME_OIDS[entry.type] ?? entry.type}=${typeof value === 'string' ? value : ''}`;
    })
    .join(', ');
}

function publicKeyName(certificate: Certificate): string {
  const info = certificate.subjectPublicKeyInfo;
  const oid = info.algorithm.algorithmId;
  if (oid === '1.2.840.113549.1.1.1') {
    const modulus = (info.parsedKey as { modulus?: { valueBlock: { valueHexView: Uint8Array } } })
      ?.modulus;
    if (!modulus) return 'RSA';
    const bytes = modulus.valueBlock.valueHexView;
    const significant = bytes.length > 0 && bytes[0] === 0 ? bytes.length - 1 : bytes.length;
    return `RSA ${significant * 8}`;
  }
  if (oid === '1.2.840.10045.2.1') {
    const curve = (
      info.algorithm.algorithmParams as { valueBlock?: { toString(): string } }
    )?.valueBlock?.toString();
    return `EC ${(curve && CURVES[curve]) ?? curve ?? ''}`.trim();
  }
  return SIGNATURE_OIDS[oid] ?? oid;
}

function keyUsage(certificate: Certificate): string[] {
  const extension = certificate.extensions?.find((e) => e.extnID === '2.5.29.15');
  const bits = (extension?.parsedValue as { valueBlock?: { valueHexView: Uint8Array } } | undefined)
    ?.valueBlock?.valueHexView;
  if (!bits || bits.length === 0) return [];
  const result: string[] = [];
  KEY_USAGE_BITS.forEach((usage, index) => {
    const byte = bits[Math.floor(index / 8)];
    if (byte !== undefined && (byte & (0x80 >> (index % 8))) !== 0) result.push(usage);
  });
  return result;
}

/** Describes a parsed certificate. `digest` hashes bytes with SHA-256. */
export async function describeCertificate(
  certificate: Certificate,
  sha256: (data: Uint8Array) => Promise<Uint8Array>,
): Promise<CertificateDetails> {
  const der = new Uint8Array(certificate.toSchema(true).toBER(false));
  const subject = formatName(certificate.subject);
  const issuer = formatName(certificate.issuer);
  return {
    subject,
    issuer,
    serialNumber: toHex(certificate.serialNumber.valueBlock.valueHexView),
    notBefore: certificate.notBefore.value,
    notAfter: certificate.notAfter.value,
    publicKeyAlgorithm: publicKeyName(certificate),
    signatureAlgorithm: signatureAlgorithmName(certificate.signatureAlgorithm.algorithmId),
    keyUsage: keyUsage(certificate),
    selfSigned: subject === issuer,
    fingerprintSha256: toHex(await sha256(der)),
    der,
  };
}
