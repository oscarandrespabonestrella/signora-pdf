---
title: Opciones del visor
description: Inputs de <signora-viewer> que cambian lo que ofrece el integrador.
---

Inputs de `<signora-viewer>` que cambian lo que ofrece el integrador. Todos son opcionales y los
valores por defecto mantienen el comportamiento anterior.

## Disposición de páginas: `viewMode`

```html
<signora-viewer [source]="url" viewMode="continuous" />
```

- `paged` (por defecto): una página a la vez; la barra y el teclado cambian de página.
- `continuous`: todas las páginas en una sola columna con scroll. Al desplazarse se actualiza la
  página actual, e ir a una página (barra, teclado, `session.goToPage()`) hace scroll hasta ella.
  Las páginas lejos del área visible solo se dibujan cuando se acercan, pero conservan su tamaño
  para que el scroll sea exacto.

El contenido proyectado en el visor (`<ng-content>`) se coloca sobre la página actual en ambos modos.

## Modos de firma: `signatureModes`

```html
<signora-viewer [showSignaturePanel]="true" [signatureModes]="['type', 'upload']" />
```

Elige qué formas de aportar una firma ofrece el panel: `draw`, `type`, `upload` y `other` (las
pestañas de los proveedores registrados, como `withOrganizationSignatures()`). Por defecto son
todas. Con una lista vacía el panel solo muestra la biblioteca de firmas. En
`<signora-signature-panel>` lo equivalente es `builtInTabs` más `providerTabs` (`true`, `false` o
una lista de ids de proveedor).

## Panel de firmas plegable: `signaturePanelBreakpoint`

```html
<signora-viewer [showSignaturePanel]="true" [signaturePanelBreakpoint]="760" />
```

El panel tiene un botón en su borde que lo pliega y lo despliega. Cuando el visor es más estrecho
que `signaturePanelBreakpoint` píxeles (por defecto `760`) el panel empieza plegado, para que la
página conserve el espacio; con más ancho empieza abierto. Usa `0` para no plegar nunca de forma
automática. En cuanto la persona pulsa el botón, su elección se mantiene aunque cambie el tamaño
del visor. Traduce el botón con las etiquetas `showSignaturePanel` y `hideSignaturePanel`.

## Precargar firmas: `preloadedSignatures`

```html
<signora-viewer [preloadedSignatures]="people" />
```

```ts
people: PreloadedSignature[] = [
  { text: 'Ada Lovelace' },                          // con la primera fuente
  { text: 'Grace Hopper', font: 'Classic' },         // fuente por etiqueta, o una SignatureFont
  { image: '/signatures/alan.png', label: 'Alan' },  // URL, data: URL o Blob
  readyMadeAsset,                                    // un SignatureAsset existente
];
```

Aparecen en la biblioteca de firmas, listas para hacer clic o arrastrar a una página. Los elementos
que no se pueden cargar se omiten con un aviso en la consola. Sin la UI, usa
`session.addAssets(assets)` o `resolvePreloadedSignatures()` de `signora-pdf/ui`.

## Solo coordenadas (sin dibujar el PDF en el navegador)

Cuando tu backend dibuja las firmas, omite el writer (`withPdfLibWriter()`) y pregunta a la sesión
dónde va cada una:

```ts
const placements = await session.exportCoordinates(); // sin imágenes
const withImages = await session.exportCoordinates({ includeImages: true });
```

Cada elemento es un `SignatureCoordinates`: `pageIndex`, el tamaño y la rotación de la página,
`normalized` (fracciones 0..1 de la página visual, origen arriba a la izquierda) y `pdf` (puntos en
el espacio de usuario del PDF, origen abajo a la izquierda, con `pageRotation`). Usa `normalized`
si tu backend trabaja sobre la página visual y `pdf` si usa directamente una librería PDF.

Dos outputs del visor informan de los cambios:

- `(coordinatesChange)` emite el `SignatureCoordinates[]` anterior tras cada cambio (una lista
  vacía si no queda ninguna). Las imágenes se omiten salvo con `[coordinatesIncludeImages]="true"`.
- `(placementsChange)` emite el `PlacedSignature[]` en bruto (caja normalizada más el asset
  completo, imagen incluida).

## Campos de firma

Un campo es un área reservada y con nombre de una página que recibe una firma. A diferencia de una
colocación libre, indica _dónde_ se espera una firma, puede ser obligatorio y se informa a tu
backend.

```ts
const fields: SignatureField[] = [
  {
    id: 'client',
    pageIndex: 0,
    rect: { x: 0.1, y: 0.72, width: 0.3, height: 0.07 }, // normalizado, origen arriba a la izquierda
    label: 'Client signature',
    required: true,
  },
];
```

```html
<signora-viewer
  [signatureFields]="fields"
  [freePlacement]="false"
  [showSignaturePanel]="true"
  (fieldsChange)="fields = $event"
/>
```

**Rellenar.** Los campos vacíos son cajas punteadas con su etiqueta (y `*` si son obligatorios).
La persona hace clic en un campo y luego crea o elige una firma, o arma una firma y hace clic en
el campo, o arrastra una desde la lista (`Enter` y `Espacio` funcionan en un campo con foco). La
firma se ajusta y se centra dentro del campo, sin recortarse ni deformarse. Se queda ahí: no se
puede mover ni redimensionar, solo borrar (`Delete`), lo que vacía el campo y lo conserva. Con
`[freePlacement]="false"` las firmas solo pueden ir en campos.

**Validar.** `session.validate()` devuelve `{ valid, missing }`.
`session.exportPdf({ requireAllFields: true })` se rechaza con `MissingSignatureFieldsError`
mientras un campo obligatorio esté vacío, y `session.missingRequiredFields()` es una signal para
desactivar un botón. Las coordenadas exportadas con `exportCoordinates()` / `(coordinatesChange)`
incluyen el `fieldId` de cada firma.

**Editar.** `[fieldsMode]="'edit'"` es para quien maqueta el documento: aparece una barra de
edición (añadir un campo, nombrarlo, marcarlo obligatorio, borrarlo), los campos se mueven y
redimensionan en la página (ratón, táctil o flechas; `Delete` los quita) y no se pueden colocar
firmas. Lee el resultado de `(fieldsChange)` o `session.fields()` y guárdalo: es lo que pasas como
`signatureFields` a quienes firman.

**Entrada y salida.** `signatureFields` se aplica cada vez que cambia y a cada documento que se
carga (los campos pertenecen a un documento). Devolver `(fieldsChange)` a la entrada es seguro.
Sin la UI: `setFields`, `addField`, `updateField`, `removeField`, `fillField(id, asset)`,
`clearField(id)`.

Tokens de tema: `--signora-field-color`, `--signora-field-bg`, `--signora-field-text`.

## Solo lectura: `readOnly`

```html
<signora-viewer [source]="url" [readOnly]="true" />
```

Muestra las firmas colocadas, pero nadie puede colocar, seleccionar, mover, redimensionar ni
borrarlas, y el panel de firmas se oculta. Las colocaciones añadidas mediante `SigningSession`
siguen apareciendo, y `coordinatesChange` sigue funcionando. La capa tiene el mismo input
`readOnly` si compones tu propio visor.
