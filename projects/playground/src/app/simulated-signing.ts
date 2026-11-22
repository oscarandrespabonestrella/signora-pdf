import type {
  CertificateInfo,
  CertificateProvider,
  DigitalSignRequest,
  DigitalSignResult,
  DigitalSignatureProvider,
} from 'signora-pdf';

/**
 * DEMONSTRATION ONLY. This provider performs **no cryptography**: it returns
 * the PDF untouched after a short delay and reports `cryptographic: false`.
 * It exists to show how a provider plugs into the workflow without needing a
 * signing backend. Never use it to claim that a document was signed.
 */
export class SimulatedDigitalSignatureProvider implements DigitalSignatureProvider {
  readonly id = 'simulated';

  async sign(request: DigitalSignRequest): Promise<DigitalSignResult> {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return {
      pdf: request.pdf,
      cryptographic: false,
      providerId: this.id,
      signedAt: new Date(),
    };
  }
}

/** DEMONSTRATION ONLY: fake certificates so the UI has something to list. */
export class SimulatedCertificateProvider implements CertificateProvider {
  readonly id = 'simulated';

  listCertificates(): Promise<readonly CertificateInfo[]> {
    return Promise.resolve([
      {
        id: 'sim-1',
        subject: 'SIMULATED · Ada Lovelace',
        issuer: 'SIMULATED Demo CA',
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validTo: new Date('2027-01-01T00:00:00Z'),
      },
      {
        id: 'sim-2',
        subject: 'SIMULATED · Acme Corp (seal)',
        issuer: 'SIMULATED Demo CA',
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validTo: new Date('2028-01-01T00:00:00Z'),
      },
    ]);
  }
}
