import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  SigningSession,
  SigningWorkflow,
  type CertificateInfo,
  type DigitalSignResult,
  type PadesLevel,
} from 'signora-pdf';
import {
  SimulatedCertificateProvider,
  SimulatedDigitalSignatureProvider,
} from '../simulated-signing';

type Mode = 'simulated' | 'http';

@Component({
  selector: 'app-digital-signing-demo',
  imports: [DatePipe, RouterLink],
  templateUrl: './digital-signing-demo.html',
  styleUrl: './digital-signing-demo.css',
})
export class DigitalSigningDemo {
  protected readonly session = inject(SigningSession);
  protected readonly workflow = inject(SigningWorkflow);
  private readonly simulatedSigner = new SimulatedDigitalSignatureProvider();
  private readonly simulatedCertificates = new SimulatedCertificateProvider();

  protected readonly levels: readonly PadesLevel[] = ['B-B', 'B-T', 'B-LT', 'B-LTA'];

  protected readonly mode = signal<Mode>('simulated');
  protected readonly certificates = signal<readonly CertificateInfo[]>([]);
  protected readonly certificatesError = signal<string | null>(null);
  protected readonly certificateId = signal('');
  protected readonly level = signal<PadesLevel>('B-B');
  protected readonly reason = signal('I approve this document');
  protected readonly location = signal('');
  protected readonly signerName = signal('');

  protected readonly result = signal<DigitalSignResult | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly downloadUrl = signal<string | null>(null);

  protected readonly canSign = computed(
    () => this.session.hasDocument() && !this.workflow.busy() && this.certificateId() !== '',
  );

  constructor() {
    // Reload the certificate list whenever the provider changes.
    effect((onCleanup) => {
      const mode = this.mode();
      let stale = false;
      onCleanup(() => (stale = true));
      this.certificates.set([]);
      this.certificateId.set('');
      this.certificatesError.set(null);

      const list =
        mode === 'simulated'
          ? this.simulatedCertificates.listCertificates()
          : this.workflow.listCertificates();
      list.then(
        (certs) => {
          if (stale) return;
          this.certificates.set(certs);
          this.certificateId.set(certs[0]?.id ?? '');
        },
        (error: unknown) => {
          if (!stale) this.certificatesError.set(messageOf(error));
        },
      );
    });
  }

  protected setMode(mode: Mode): void {
    this.result.set(null);
    this.error.set(null);
    this.releaseDownload();
    this.mode.set(mode);
  }

  protected async sign(): Promise<void> {
    this.error.set(null);
    this.result.set(null);
    this.releaseDownload();
    try {
      const result = await this.workflow.sign({
        // Without an explicit provider the registered one (the HTTP backend) is used.
        provider: this.mode() === 'simulated' ? this.simulatedSigner : undefined,
        certificateId: this.certificateId(),
        level: this.level(),
        reason: this.reason() || undefined,
        location: this.location() || undefined,
        signerName: this.signerName() || undefined,
      });
      this.result.set(result);
      this.downloadUrl.set(
        URL.createObjectURL(new Blob([result.pdf as BlobPart], { type: 'application/pdf' })),
      );
    } catch (error) {
      this.error.set(messageOf(error));
    }
  }

  protected fileName(): string {
    // A simulated result must never be named as if it were signed.
    return this.result()?.cryptographic
      ? 'document-signed.pdf'
      : 'document-SIMULATED-not-signed.pdf';
  }

  protected onText(target: 'reason' | 'location' | 'signerName', event: Event): void {
    this[target].set((event.target as HTMLInputElement).value);
  }

  private releaseDownload(): void {
    const url = this.downloadUrl();
    if (url) URL.revokeObjectURL(url);
    this.downloadUrl.set(null);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
