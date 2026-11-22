import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideSignora, withOrganizationSignatures } from 'signora-pdf';
import { withHttpCertificateProvider, withHttpDigitalSigner } from 'signora-pdf/http';
import { withPdfJsRenderer } from 'signora-pdf/pdfjs';
import { withPdfLibWriter } from 'signora-pdf/pdf-lib';
import { routes } from './app.routes';
import { loadAcmeSignatures } from './organization-signatures';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Hash routing: the playground can be hosted on any static path (GitHub Pages, docs iframes).
    provideRouter(routes, withHashLocation()),
    provideHttpClient(),
    // Everything the playground knows about the SDK comes from its public API.
    provideSignora(
      withPdfJsRenderer({
        workerSrc: new URL('assets/pdfjs/pdf.worker.min.mjs', document.baseURI).href,
      }),
      withPdfLibWriter(),
      // Real signing needs a backend; see docs/digital-signing.md. None ships with the playground.
      withHttpDigitalSigner({ signUrl: '/api/sign' }),
      withHttpCertificateProvider({ url: '/api/certificates' }),
      withOrganizationSignatures({ label: 'Acme Corp', assets: loadAcmeSignatures }),
    ),
  ],
};
