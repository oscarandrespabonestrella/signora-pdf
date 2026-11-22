---
title: Arquitectura
description: Puertos y adaptadores, puntos de entrada y el flujo de firma.
---

## Objetivos

- Un SDK reutilizable, no una aplicación: cada responsabilidad está tras una interfaz.
- El núcleo nunca depende de un motor PDF. Los motores son adaptadores.
- La firma visual y la firma criptográfica son independientes.
- Existe una UI completa por defecto, pero todo lo que usa está expuesto para que construyas la tuya.

## Puntos de entrada

```
                 ┌──────────────────────────┐
                 │  signora-pdf   (core)   │  solo Angular
                 │  models · ports · coords │
                 │  SigningSession · DI     │
                 └───────▲───────▲───────▲──┘
                         │       │       │
        ┌────────────────┘       │       └────────────────┐
┌───────┴────────┐      ┌────────┴───────┐       ┌────────┴───────┐
│ signora-pdf/  │      │ signora-pdf/  │       │ signora-pdf/  │
│ pdfjs          │      │ pdf-lib        │       │ ui             │
│ (pdfjs-dist)   │      │ (pdf-lib)      │       │ viewer, slots  │
└────────────────┘      └────────────────┘       └────────────────┘
```

Las dependencias se imponen de tres formas: puntos de entrada de paquete separados, dependencias
peer opcionales y una regla ESLint `no-restricted-imports` en el núcleo y en `ui`. La CI también
busca referencias a motores en los bundles construidos del núcleo y la UI.

## Puertos

| Puerto                     | Propósito                                                     | Adaptador por defecto          |
| -------------------------- | ------------------------------------------------------------- | ------------------------------ |
| `PdfRenderingPort`         | cargar un documento, geometría de página, dibujar en canvas   | `PdfJsRenderingAdapter`        |
| `PdfWriterPort`            | producir un PDF con las firmas visuales incrustadas           | `PdfLibDocumentWriter`         |
| `SignatureProvider`        | fuentes de firmas visuales (dibujo, texto, organización...)   | hoja de ruta                   |
| `DigitalSignatureProvider` | firma criptográfica mediante un backend o servicio            | `HttpDigitalSignatureProvider` |
| `CertificateProvider`      | listar los certificados de firma disponibles                  | `HttpCertificateProvider`      |

Registra las implementaciones con features:

```ts
provideSignora(
  withPdfJsRenderer({ workerSrc }),
  withPdfLibWriter(),
  withSignatureProvider(OrganizationSignatures),
  withDigitalSigner(MyBackendSigner),
);
```

Una feature es `{ kind, providers }`; los adaptadores y tu propio código pueden crear más con
`createSignoraFeature()`.

## Sesión

`SigningSession` guarda el estado de un flujo con signals: manejador del documento, estado, página
actual, zoom, rotación y colocaciones. No depende del DOM. La provee `provideSignora()`; añade
`providers: [SigningSession]` a un componente para tener una instancia independiente.

## Flujo de firma (diseño objetivo)

```
 ver / colocar  ──►  exportación visual  ──►  firma digital
 (SigningSession)    (PdfWriterPort)          (DigitalSignatureProvider)
```

Cada etapa consume bytes y produce bytes. Las firmas visuales se aplican primero; la firma digital
es el último paso, así que cubre el contenido visual. Se espera que la firma digital se ejecute en
un backend o servicio remoto. `DigitalSignResult.cryptographic` deja explícito si se aplicó una
firma real, de modo que los proveedores simulados nunca se confundan con los reales.

## UI

`<signora-viewer>` compone `<signora-toolbar>` y `<signora-page>`. Las secciones se pueden
sustituir con `<ng-template signoraSlot="toolbar|empty|loading|error">`; los textos vienen del
token `SIGNORA_LABELS`; lo visual, de las variables `--signora-*` (ver [temas](../../guides/theming/)).
El componente de página expone una capa superpuesta, del tamaño de la página, donde se proyectan
los elementos de firma.

## Firma digital

`SigningWorkflow` (núcleo) secuencia las dos etapas y valida lo que devuelve un proveedor; ver
[firma digital](../../guides/digital-signing/). Los adaptadores HTTP viven en `signora-pdf/http`
para que el núcleo no dependa de `HttpClient`.
