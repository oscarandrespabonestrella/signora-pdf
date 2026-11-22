import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideSignora, withOrganizationSignatures } from 'signora-pdf';
import { withHttpCertificateProvider, withHttpDigitalSigner } from 'signora-pdf/http';
import { withPdfJsRenderer } from 'signora-pdf/pdfjs';
import { withPdfLibWriter } from 'signora-pdf/pdf-lib';
import { routes } from './app.routes';
import { loadAcmeSignatures } from './organization-signatures';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    // Everything the playground knows about the SDK comes from its public API.
    provideSignora(
      withPdfJsRenderer({ workerSrc: '/assets/pdfjs/pdf.worker.min.mjs' }),
      withPdfLibWriter(),
      // Real signing needs a backend; see docs/digital-signing.md. None ships with the playground.
      withHttpDigitalSigner({ signUrl: '/api/sign' }),
      withHttpCertificateProvider({ url: '/api/certificates' }),
      withOrganizationSignatures({ label: 'Acme Corp', assets: loadAcmeSignatures }),
    ),
  ],
};
