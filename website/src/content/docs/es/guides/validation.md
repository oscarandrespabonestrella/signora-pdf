---
title: Inspección y validación de firmas
description: Leer las firmas digitales que ya contiene un PDF.
---

Signora puede leer y verificar las firmas digitales que un PDF ya contiene. Vive en su propio entry point,
`signora-pdf/validation`, que requiere la dependencia peer opcional `pdf-lib`. El núcleo y la UI
no la usan. **Leer no es confiar:** lo que sigue es lo que el archivo _declara_, no prueba de que
una firma sea válida. Firmar sigue delegado en tu backend (ver [firma digital](../digital-signing/)).

## Inspeccionar

```ts
import { inspectPdfSignatures } from 'signora-pdf/validation';

const signatures = await inspectPdfSignatures(pdfBytes);
for (const s of signatures) {
  console.log(s.fieldName, s.signed, s.subFilter, s.signingTime, s.pageIndex, s.rect);
}
```

`inspectPdfSignatures(pdf, { includeUnsigned? })` devuelve un `PdfSignatureInfo` por campo de
firma, en orden de firma (los campos vacíos al final):

| Campo                  | Significado                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| `fieldName`, `signed`  | nombre del campo AcroForm; `false` si el campo está vacío                  |
| `kind`                 | `signature`, o `document-timestamp` (`DocTimeStamp` RFC 3161)              |
| `filter`, `subFilter`  | p. ej. `ETSI.CAdES.detached` (PAdES), `adbe.pkcs7.detached`                |
| `byteRange`            | los rangos de bytes firmados                                               |
| `byteRangeWellFormed`  | empieza en 0, un solo hueco justo alrededor de `/Contents`, dentro del archivo |
| `contents`             | el contenedor CMS (DER), sin el relleno de ceros                           |
| `signingTime`          | `/M`: lo declara quien firma, **no es fiable** sin sello de tiempo         |
| `pageIndex`, `rect`    | página y caja del widget en coordenadas normalizadas                       |
| `revision`             | cuántos marcadores `%%EOF` caen dentro de los bytes firmados               |
| `coversWholeDocument`  | `false` si hay bytes después de la firma: otra revisión o manipulación     |

Un `byteRangeWellFormed: false` debe tratarse como hostil. `PdfInspectionError` se lanza si los
bytes no son un PDF o no se pueden leer.

## Validar

```ts
import { validatePdfSignatures, formatValidationReport } from 'signora-pdf/validation';

const report = await validatePdfSignatures(pdfBytes);
report.status; // 'no-signatures' | 'valid' | 'invalid' | 'indeterminate'
for (const r of report.results) {
  r.status; // por firma
  r.problems; // [{ code: 'DIGEST_MISMATCH', message }]
  r.warnings; // [{ code: 'REVISIONS_AFTER_SIGNATURE', message }]
  r.signer; // CertificateDetails: sujeto, emisor, serie, validez, clave, keyUsage...
}
```

Requiere las dependencias peer opcionales `pdf-lib`, `pkijs` y `asn1js`. La verificación usa
WebCrypto, en el navegador y en Node; pasa `{ crypto }` para usar otra implementación. Soporta
firmas `adbe.pkcs7.detached`, `ETSI.CAdES.detached` (PAdES) y `ETSI.RFC3161` (sellos de documento)
con RSA o ECDSA y SHA-1/224/256/384/512. El PDF nunca se modifica.

Qué se comprueba por firma (`result.checks`):

| Comprobación       | Significado                                                                      |
| ------------------ | -------------------------------------------------------------------------------- |
| `byteRange`        | `/ByteRange` está bien formado y su hueco es exactamente la firma de `/Contents` |
| `integrity`        | los bytes firmados producen el resumen al que se comprometió quien firma         |
| `signature`        | la firma se verifica con la clave pública del certificado del firmante           |
| `timestamp`        | el sello RFC 3161 cubre esta firma (o documento) y se verifica; `not-evaluated` si no hay |
| `revocation`       | ningún certificado de la cadena está revocado según CRL u OCSP; `not-evaluated` si falta evidencia |
| `certificateChain` | quien firma encadena con alguna de tus `trustAnchors`; `not-evaluated` sin anclas |

**Cómo leer `valid`:** la firma está íntegra sobre los bytes que cubre. **No** dice que quien firma
sea quien afirma, que el certificado sea de confianza o no esté revocado, ni que la hora declarada
sea cierta. Solo si pasas `trustAnchors`, `valid` significa además que quien firma (y la autoridad de sellado)
encadena con un certificado de tu confianza; incluso entonces **no se comprueba la revocación**
(`REVOCATION_NOT_CHECKED`). Sin anclas, no presentes `valid` como "de confianza".

Códigos de problema: `BYTE_RANGE_MALFORMED`, `CONTENTS_MISSING`, `CMS_MALFORMED`,
`DIGEST_MISMATCH`, `SIGNATURE_INVALID`, `CERTIFICATE_REVOKED` y `CHANGES_NOT_PERMITTED` dejan la firma `invalid`; `UNSUPPORTED_SUBFILTER`,
`UNSUPPORTED_ALGORITHM`, `SIGNER_CERTIFICATE_MISSING`, `CERTIFICATE_CHAIN_INVALID`, `REVOCATION_UNKNOWN` y
`VALIDATION_ERROR`, `indeterminate`.
`DIGEST_MISMATCH` significa que el archivo cambió dentro de los bytes firmados; `SIGNATURE_INVALID`,
que el resumen está intacto pero el valor de la firma no.

Los avisos (`warnings`) nunca cambian el estado: `TIMESTAMP_INVALID` (el sello dentro de la firma no
se verifica, así que la hora no está probada), `TIMESTAMP_CERTIFICATE_NOT_FOR_TIMESTAMPING`, `TIMESTAMP_AUTHORITY_NOT_TRUSTED`,
`REVOCATION_NOT_CHECKED` y `CERTIFICATE_REVOKED_AFTER_SIGNING`, `REVISIONS_AFTER_SIGNATURE` (hay bytes tras el
rango firmado; `laterRevisions` dice qué son) y `CONTENT_CHANGED_AFTER_SIGNING`, `WEAK_DIGEST_ALGORITHM` (SHA-1), `SIGNING_TIME_OUTSIDE_CERTIFICATE_VALIDITY` y
`CERTIFICATE_KEY_USAGE_NOT_FOR_SIGNING`.

## Sellos de tiempo y nivel PAdES

Una firma puede llevar un token RFC 3161 sobre su valor de firma (atributo no firmado
`signature-time-stamp`), y un PDF puede tener sellos de documento (`ETSI.RFC3161`, resultados con
`signature.kind === 'document-timestamp'`) que cubren todo lo anterior. En ambos casos
`result.timestamp` trae `genTime`, `digestAlgorithm`, `policy`, `serialNumber` y el
`CertificateDetails` de la autoridad, y `checks.timestamp` indica si el token cubre los bytes
correctos y lo firmó el certificado de autoridad que nombra.

- Un **sello de documento** se juzga por sí solo: un byte cambiado en su rango es
  `DIGEST_MISMATCH`; una firma de autoridad inválida, `SIGNATURE_INVALID`.
- Un **sello dentro de la firma** que falla solo añade el aviso `TIMESTAMP_INVALID`: la firma
  sigue tan válida como antes, pero su hora ya no está probada.
- `genTime` es tan fiable como la autoridad: con `trustAnchors`, `timestamp.authorityChain` indica
  si encadena con alguna. Úsalo mejor que el `/M` del firmante, que cualquiera puede escribir.

`result.padesLevel` es el nivel base PAdES más alto que evidencia la firma: `B-B` para una firma
CAdES con atributo de certificado de firma, `B-T` si además tiene un sello válido. `B-LT` y `B-LTA`
necesitan datos de validación de confianza y se describen en las secciones siguientes; el campo es
`undefined` para `adbe.pkcs7.detached` y cuando la firma tiene problemas.

## Confianza: cadenas de certificados

Signora **no incluye lista de confianza**; decides tú en quién confiar. Pasa los certificados que
aceptas (tu CA, una lista de confianza nacional, las raíces de un servicio de confianza...) como
bytes DER o cadenas PEM:

```ts
const report = await validatePdfSignatures(pdfBytes, {
  trustAnchors: [rootCaPem, tsaRootDer],
  validationTime: new Date(), // opcional; es el valor por defecto
});
```

Con anclas, el certificado de cada firmante debe construir un camino hasta una de ellas, usando las
intermedias incrustadas en la firma, con firmas, periodos de validez y restricciones básicas y de
nombre correctos. Lo mismo para la autoridad de cada sello de tiempo (comprobada a la hora
`genTime` del propio token). Una firma íntegra que no encadena es `indeterminate` con
`CERTIFICATE_CHAIN_INVALID`; `result.chain.error` dice por qué y `result.chain.path` lista el camino
construido (hoja primero). Un certificado que está en `trustAnchors` se acepta si es válido en el
momento comprobado.

**¿Qué hora?** Nunca el `/M` de quien firma. Si la firma tiene un sello válido de una autoridad de
confianza, los certificados se comprueban a su `genTime`, de modo que una firma sigue siendo válida
cuando caduca su certificado (`result.chain.basis === 'timestamp'`). Si no, se comprueban a
`validationTime` (por defecto, ahora; `basis === 'validation-time'`) y un firmante caducado se rechaza.

Una vez de confianza la cadena, también se comprueba la revocación: ver la sección siguiente.

Un ancla ilegible lanza `TrustAnchorError` antes de validar nada (nunca se ignora en silencio).

## Revocación: CRL y OCSP

Con `trustAnchors`, una vez de confianza la cadena se comprueba la revocación de cada certificado
salvo el ancla. Qué hacer lo decide `revocation`:

| `revocation`               | Comportamiento                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `'if-available'` (defecto) | Usa la evidencia que encuentre. Un certificado sin ella se avisa (`REVOCATION_NOT_CHECKED`), no se rechaza. |
| `'require'`                | Todo certificado necesita evidencia utilizable o la firma es `indeterminate` (`REVOCATION_UNKNOWN`). |
| `'off'`                    | No mira la revocación.                                                                         |

**De dónde sale la evidencia.** Signora nunca usa la red por sí sola.

- **Incrustada en la firma**, se usa automáticamente: el campo `crls` del CMS,
  `adbe-revocationInfoArchival` de Adobe y `revocation-values` de CAdES.
- **La tuya**: `revocationData: { crls, ocsps }` (DER; una respuesta OCSP puede ser el
  `OCSPResponse` completo o el `BasicOCSPResponse`). Datos ilegibles lanzan `RevocationDataError`.
- **Descargada por ti**: se llama a `fetchRevocation(petición)` solo para un certificado aún
  desconocido, primero OCSP y luego la CRL. Recibe la URL que nombra el certificado y, para OCSP, la
  petición DER, y devuelve los bytes (o nada; fallar es válido). `httpRevocationFetcher()` es uno
  listo sobre `fetch`. **En un servidor, restríngelo** (`allow`): las URL salen del documento que se
  valida, así que un fetcher abierto deja que quien lo hizo haga que tu servidor pida cualquier
  dirección.

**La evidencia se comprueba, no se cree.** Una CRL solo cuenta si la verifica la clave de su emisor
y corresponde al emisor del certificado; una respuesta OCSP, si la firma el emisor o un respondedor
que este delegó (`id-kp-OCSPSigning`). La evidencia falsificada, ajena, "desconocida" y las CRL
delta o indirectas se ignoran.

**La evidencia debe ser lo bastante reciente para el momento comprobado**, el mismo en que se
comprueba la cadena (ver arriba). Con un sello de tiempo de confianza debe haberse emitido
**después** del sello, para que una revocación anterior se viera; la emitida antes no prueba nada.
Sin sello, debe estar vigente a `validationTime` (`nextUpdate`, o 24 h para una respuesta OCSP sin
él).

**Resultado.** `result.chain.revocation` lista cada certificado: `status` (`good`, `revoked`,
`unknown`), `source` (`ocsp`/`crl`), `origin` (`embedded`/`provided`/`fetched`), `revokedAt`,
`reason` (p. ej. `keyCompromise`), `thisUpdate`, `nextUpdate`.

- Un certificado revocado **en o antes del** momento comprobado deja la firma `invalid`
  (`CERTIFICATE_REVOKED`, `checks.revocation: 'failed'`).
- Uno revocado **después** (típico con sello de tiempo) sigue `good` con el aviso
  `CERTIFICATE_REVOKED_AFTER_SIGNING`: la firma es anterior a la revocación.
- Igual para una autoridad de sellado: una revocada deja `invalid` un sello de documento y quita la
  confianza a un sello de firma (`TIMESTAMP_AUTHORITY_NOT_TRUSTED`, nivel `B-B`).

No se tratan: CRL delta, CRL indirectas, respondedores OCSP identificados solo por nombre, ni el
propio ancla de confianza (no se comprueba).

## Validación a largo plazo: el DSS

Una firma sigue siendo comprobable años después solo si lo necesario para comprobarla viaja con el
archivo. Un PDF lo guarda en su **Document Security Store** (`/DSS`): certificados, CRL y
respuestas OCSP, y entradas opcionales por firma (`/VRI`). Signora lo lee por su cuenta:

- sus certificados son candidatos extra para **construir cadenas** (una CA intermedia que la firma
  no lleva puede venir del DSS);
- sus CRL y respuestas OCSP son **evidencia de revocación** (`origin: 'dss'`), con las mismas
  reglas que cualquier otra: verificada, y lo bastante reciente para el momento comprobado (ver
  arriba). Con un sello de tiempo de confianza, la evidencia guardada en el DSS después del sello es
  justo lo que prueba que el certificado no estaba revocado entonces, incluso años después.

El DSS **no está protegido por las firmas a las que sirve** (se añade después), así que nada de lo
que contiene se da por bueno: lo falsificado, ajeno o demasiado antiguo se ignora como en cualquier
otro sitio, y lo ilegible se salta. `report.dss` indica cuánto hay (`certificates`, `crls`,
`ocsps`, `signatures`).

```ts
import { readDss, appendDss } from 'signora-pdf/pdf-lib';

const dss = await readDss(pdf); // el almacén en bruto, o undefined
const longTerm = await appendDss(pdf, { certs, crls, ocsps }); // actualización incremental
```

`appendDss` guarda lo que le des en una actualización incremental (ver
[firmar un PDF ya firmado](../incremental-signing/)): las firmas existentes siguen válidas, lo
repetido no se guarda dos veces, y `signatures: [{ signature, crls }]` rellena además la entrada
`/VRI` de esa firma (`dssSignatureKey()` da su clave). No recoge ni verifica nada; usa
`chain.revocation[].evidence` de una validación (con `fetchRevocation`) como fuente de la evidencia
a archivar.

### B-LT y B-LTA

- **`B-LT`**: la firma tiene un sello válido de una autoridad de confianza, su cadena es de
  confianza y **todos los certificados de la cadena tienen evidencia de revocación guardada en la
  firma o en el DSS** (`origin` `embedded` o `dss`: la evidencia que tú aportas o descargas no hace
  una firma de largo plazo) que los muestra buenos a la hora del sello.
- **`B-LTA`**: `B-LT`, y un sello de documento válido de una autoridad de confianza, hecho
  **después** de la firma, ya cubría todo lo que la firma toma del DSS. Un DSS añadido después del
  último sello de documento deja la firma en `B-LT`; la comprobación lee el archivo tal como estaba
  cuando se hizo el sello.

Ambos necesitan `trustAnchors`: afirman que la evidencia pertenece a una cadena de tu confianza, así
que sin anclas el nivel se queda en `B-T`. La evidencia de la propia autoridad de sellado no se
exige para `B-LT` en esta versión.

## Cambios posteriores a una firma

Una firma cubre la revisión que se firmó. Un PDF puede guardarse una y otra vez encima (otro firmante,
un sello, un formulario relleno, una edición), así que "válida" nunca quiso decir "sin modificar".
Cuando hay bytes tras el rango firmado, `result.laterRevisions` dice **qué** cambiaron las revisiones
posteriores, para distinguir una segunda firma de una edición que nadie firmó:

```ts
result.laterRevisions?.changes; // [{ kind: 'signature', field: 'Signature2', objects: 1 }, ...]
result.laterRevisions?.permitted; // false si se rompió una restricción de quien firmó
```

Compara la revisión firmada (el archivo hasta el final del rango firmado) con el archivo final, objeto
a objeto, y da a cada objeto cambiado el papel que tenía en la revisión firmada.

| `kind`               | Qué cambió                                                             |
| -------------------- | ---------------------------------------------------------------------- |
| `signature`          | se añadió una firma, o se firmó un campo de firma existente             |
| `document-timestamp` | se añadió un sello de documento RFC 3161                                |
| `validation-data`    | el DSS recibió certificados, CRL o respuestas OCSP                      |
| `signature-field`    | se añadió un campo de firma vacío                                       |
| `form-fill`          | se rellenó o editó un campo de formulario existente (no de firma)       |
| `form-field`         | se añadió un campo de formulario (no de firma)                          |
| `annotation`         | se añadieron, cambiaron o quitaron anotaciones (comentarios, sellos...) |
| `metadata`           | cambió la información o los metadatos del documento (todo guardado lo hace) |
| `page-content`       | cambió lo que muestra una página: contenido, recursos, tamaño, rotación |
| `page-structure`     | se añadieron, quitaron o reordenaron páginas                            |
| `other`              | cualquier otra cosa, **incluido todo lo que no se reconoce**            |

`field` nombra el campo de formulario en los tipos de campo. El análisis es de mejor esfuerzo y
conservador: lo desconocido es `other`. Si la revisión firmada no se puede leer como un PDF por sí sola
(algunas firmas firman un prefijo que no es una revisión completa), `laterRevisions` no aparece y solo
queda el aviso genérico `REVISIONS_AFTER_SIGNATURE`.

**Restricciones.** Dos mecanismos permiten al autor decir qué puede seguir cambiando, y Signora aplica
ambos a los cambios que encuentra (un cambio prohibido deja la firma `invalid` con
`CHANGES_NOT_PERMITTED`, y `laterRevisions.forbidden` los lista):

- **DocMDP** (certificación): el nivel de la firma de certificación del documento, leído de la
  revisión firmada. El nivel 1 solo permite `validation-data`, `document-timestamp` y `metadata`; el 2
  añade `signature` y `form-fill`; el 3 añade `annotation`, `signature-field` y `form-field` (los widgets
  son anotaciones). Todo lo demás está prohibido, también tocar la propia certificación.
- **FieldMDP** (bloqueo de campos): una firma cuyo campo tiene `/Lock` (o una transformación FieldMDP)
  prohíbe `form-fill` y `signature` en los campos bloqueados **que existían al firmar**; los campos
  nuevos y todo lo que no es un campo siguen libres.

**Sin ninguna restricción** nada está prohibido, pero un cambio en lo que muestra una página
(`page-content`, `page-structure`) o algo no reconocido (`other`) añade el aviso
`CONTENT_CHANGED_AFTER_SIGNING`: la revisión firmada está intacta, pero el documento no es lo que vio
quien firmó. Trata una firma `valid` con ese aviso como **modificada**.

## Informe

`serializeValidationReport(report)` da JSON estable (`schemaVersion: 1`, fechas ISO 8601, sin bytes
crudos) para guardar o auditar; `formatValidationReport(report)`, un resumen en texto. Incluye el
SHA-256 del archivo validado.

Para inyectarlo: `provideSignora(withPdfSignatureValidation())` e inyecta
`SIGNORA_SIGNATURE_VALIDATOR`, o implementa `SignatureValidatorPort` y regístralo con
`withSignatureValidator()`.

## Pendiente

Recoger los datos de validación de un documento para guardarlos (las piezas existen:
`chain.revocation[].evidence`, `appendDss`) y exigir la evidencia de la propia autoridad para `B-LT`
están planificados; el
orden está en `SIGNORA_GAP_ANALYSIS.md`. Otros formatos (`adbe.pkcs7.sha1`, `adbe.x509.rsa_sha1`)
devuelven `UNSUPPORTED_SUBFILTER`.
