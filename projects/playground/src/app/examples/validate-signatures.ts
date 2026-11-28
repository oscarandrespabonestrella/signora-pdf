import { Component, signal } from '@angular/core';
import type { ValidationReport } from 'signora-pdf';
import { formatValidationReport, validatePdfSignatures } from 'signora-pdf/validation';

/**
 * Check the digital signatures of a PDF (needs `pdf-lib`, `pkijs` and `asn1js`). Nothing is sent
 * anywhere: the file is read and verified in the browser. Without trust anchors `valid` only means
 * the signature is intact. Tick "Trust the test CAs" to also check the signer and the timestamp
 * authority against them, and pick a CRL to check revocation against.
 */
@Component({
  selector: 'app-example-validate-signatures',
  host: { class: 'example' },
  template: `
    <div class="example-bar">
      <button type="button" (click)="check('samples/signed.pdf')">Validate signed sample</button>
      <button type="button" (click)="check('samples/signed-ltv.pdf')">
        Validate long-term sample
      </button>
      <button type="button" (click)="check('samples/signed-edited.pdf')">
        Validate certified, then edited sample
      </button>
      <button type="button" (click)="check('samples/signed-tampered.pdf')">
        Validate tampered sample
      </button>
      <label>
        <input type="checkbox" [checked]="trust()" (change)="toggleTrust($event)" />
        Trust the test CAs
      </label>
      <label>
        Revocation evidence
        <select [value]="crl()" (change)="toggleCrl($event)" [disabled]="!trust()">
          <option value="">none</option>
          <option value="samples/test-crl.der">CRL that lists nobody</option>
          <option value="samples/test-crl-revoked.der">CRL that revokes the signer</option>
        </select>
      </label>
      <label>
        Your PDF
        <input type="file" accept="application/pdf" (change)="onFile($event)" />
      </label>
    </div>
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
    @if (report(); as r) {
      <p data-testid="overall">
        Overall: <strong>{{ r.status }}</strong>
      </p>
      <pre>{{ summary() }}</pre>
    }
  `,
})
export class ValidateSignaturesExample {
  protected readonly report = signal<ValidationReport | null>(null);
  protected readonly summary = signal('');
  protected readonly error = signal('');
  protected readonly trust = signal(false);
  protected readonly crl = signal('');
  private last: Uint8Array | null = null;

  protected async toggleTrust(event: Event): Promise<void> {
    this.trust.set((event.target as HTMLInputElement).checked);
    if (this.last) await this.validate(this.last);
  }

  protected async toggleCrl(event: Event): Promise<void> {
    this.crl.set((event.target as HTMLSelectElement).value);
    if (this.last) await this.validate(this.last);
  }

  protected async check(url: string): Promise<void> {
    const response = await fetch(url);
    await this.validate(new Uint8Array(await response.arrayBuffer()));
  }

  protected async onFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) await this.validate(new Uint8Array(await file.arrayBuffer()));
  }

  private async validate(pdf: Uint8Array): Promise<void> {
    this.error.set('');
    this.last = pdf;
    try {
      const trustAnchors = this.trust()
        ? [await (await fetch('samples/test-trust-anchors.pem')).text()]
        : [];
      const crls =
        this.trust() && this.crl()
          ? [new Uint8Array(await (await fetch(this.crl())).arrayBuffer())]
          : [];
      const report = await validatePdfSignatures(pdf, { trustAnchors, revocationData: { crls } });
      this.report.set(report);
      this.summary.set(formatValidationReport(report));
    } catch (error) {
      this.report.set(null);
      this.error.set(error instanceof Error ? error.message : 'The file could not be read.');
    }
  }
}
