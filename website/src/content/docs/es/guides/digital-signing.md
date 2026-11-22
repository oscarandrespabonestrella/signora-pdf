---
title: Firma digital
description: Del PDF con firmas visuales a un PDF firmado criptográficamente mediante tu backend.
---

Una **firma visual** es una imagen colocada en una página. No prueba nada. Una **firma digital**
es un sello criptográfico hecho con un certificado, que permite a quien lee detectar cambios e
identificar a quien firma. Son etapas separadas, y **esta librería nunca realiza criptografía**: la
delega en un proveedor que controlas tú.

## El flujo

```
SigningSession (colocaciones) ──► PdfWriterPort ──► DigitalSignatureProvider ──► PDF firmado
                                   etapa visual       etapa criptográfica
```

`SigningWorkflow.sign()` ejecuta ambas: exporta el documento con sus firmas visuales y luego
entrega esos bytes al proveedor, de modo que la firma digital cubre el contenido visual.

```ts
const workflow = inject(SigningWorkflow);

const certificates = await workflow.listCertificates(); // desde el CertificateProvider
const result = await workflow.sign({
  certificateId: certificates[0].id,
  level: 'B-T', // nivel PAdES baseline, interpretado por tu servicio
  reason: 'I approve this document',
});

result.pdf; // Uint8Array
result.cryptographic; // true solo si se aplicó una firma real
```

Registra los proveedores con `provideSignora()`:

```ts
(provideHttpClient(),
  provideSignora(
    withHttpDigitalSigner({ signUrl: '/api/sign' }),
    withHttpCertificateProvider({ url: '/api/certificates' }),
  ));
```

O implementa tú mismo `DigitalSignatureProvider` / `CertificateProvider` (un SDK de un servicio de
confianza, un puente a un token hardware...) y regístralo con `withDigitalSigner()` /
`withCertificateProvider()`. `workflow.sign({ provider })` sustituye al firmador registrado en una
sola llamada.

## Contra qué protege el flujo

- Un proveedor que afirma `cryptographic: true` pero devuelve un PDF **sin diccionario de firma**
  (`/ByteRange`) se rechaza con un `DigitalSigningError`.
- Una respuesta que no es un PDF (por ejemplo una página de login devuelta por un proxy) se rechaza.
- Los resultados con `cryptographic: false` se aceptan pero siempre se informan como tales, así
  que un proveedor simulado nunca se confunde con uno real.

La comprobación de `/ByteRange` es un chequeo de cordura. **No** valida la firma, la cadena de
certificados ni la integridad del documento. Valida en el servidor y en los lectores en los que
confíes.

## Contrato HTTP (`signora-pdf/http`)

El adaptador HTTP usa el `HttpClient` de Angular, así que se aplican tus interceptores
(autenticación, cabeceras de tenant...). Provee `provideHttpClient()` en tu aplicación.

**Firmar**

```
POST {signUrl}
Content-Type: multipart/form-data

pdf        archivo, application/pdf    el documento, con las firmas visuales ya incrustadas
metadata   application/json            { certificateId?, level?, reason?, location?,
                                          signerName?, options? }

200 application/pdf                    el PDF firmado
4xx/5xx                                cuerpo JSON opcional { "message": "..." } (se muestra al usuario)
```

**Certificados**

```
GET {url}

200 application/json  [ { id, subject, issuer?, validFrom?, validTo?, metadata? } ]
```

Las fechas son cadenas ISO 8601.

## Construir el lado servidor

Usa una implementación existente y auditada. Por ejemplo una librería PAdES de código abierto en
tu backend, o la API de firma remota de un prestador de servicios de confianza cualificado. Guarda
allí las claves y certificados; nunca los envíes al navegador. Autentica al usuario, autoriza el
certificado que puede usar y registra lo que se firmó.

Una firma digital previa en el documento de origen quedaría invalidada por la etapa visual
(pdf-lib reescribe el archivo), por eso el writer rechaza por defecto los PDFs ya firmados. Coloca
primero las firmas visuales y firma al final.

## El playground

La página _Firma digital_ te deja ejecutar ambos proveedores:

- **Simulado**: devuelve el PDF tal cual e informa `cryptographic: false`. La UI y el nombre de la
  descarga indican que el archivo **no está firmado**. Existe para mostrar el flujo.
- **Servicio remoto (HTTP)**: llama a `/api/sign` y `/api/certificates`. El playground no incluye
  backend, así que estas llamadas fallan hasta que aportes uno (las comprobaciones de extremo a
  extremo del repositorio simulan uno a nivel de red para ejercitar esta ruta).
