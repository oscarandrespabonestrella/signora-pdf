---
title: Coordenadas
description: Cómo las firmas se mantienen en su sitio con cualquier zoom, rotación o tamaño de pantalla.
---

Las firmas deben quedarse en el mismo punto de la página sea cual sea el zoom, la rotación del
visor, el tamaño de pantalla o la rotación propia de la página. Para lograrlo, las colocaciones se
guardan en **coordenadas normalizadas** y solo se convierten en los bordes.

## Los tres espacios

| Espacio                   | Unidad               | Origen            | Lo usa                                |
| ------------------------- | -------------------- | ----------------- | ------------------------------------- |
| Normalizado               | fracción 0..1        | arriba-izquierda  | almacenamiento (`PlacedSignature.rect`) |
| Viewport                  | píxeles CSS          | arriba-izquierda  | UI: eventos de puntero, capa          |
| Espacio de usuario del PDF | puntos (1/72 pulgada) | abajo-izquierda   | escritores de PDF                     |

**Normalizado** es relativo al tamaño _visual_ de la página: la caja visible (CropBox, o si no
MediaBox) con el `/Rotate` del documento aplicado, tal como el autor quiso que se leyera, y sin la
rotación extra que la persona aplicó en el visor.

## Funciones (`signora-pdf`)

| Función                                         | Dirección                                                  |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `toViewportRect(rect, page, {scale, rotation})` | normalizado → píxeles CSS de la página renderizada         |
| `fromViewportRect(rect, page, options)`         | píxeles CSS → normalizado                                  |
| `toViewportPoint` / `fromViewportPoint`         | lo mismo, para puntos como los eventos de puntero          |
| `toPdfUserSpace(rect, page)`                    | normalizado → puntos PDF, abajo-izquierda, página sin rotar |
| `fromPdfUserSpace(rect, page)`                  | inversa                                                    |
| `getViewportSize(page, options)`                | tamaño renderizado, con los ejes intercambiados a 90/270   |
| `clampNormalizedRect(rect)`                     | mantiene una colocación dentro de la página                |

`scale` son píxeles CSS por punto PDF (`SigningSession.scale()`, es decir `zoom * 96/72`), y
`PageInfo` viene de `PdfDocumentHandle.getPageInfo(index)`.

## Reglas prácticas

- Convierte las posiciones del puntero con `fromViewportPoint` en cuanto entren en tu código;
  guarda solo valores normalizados.
- Renderiza las capas llamando a `toViewportRect` en cada cambio de zoom/rotación. Nunca cachees
  píxeles.
- Para exportar, `toPdfUserSpace` devuelve la caja sin rotar más `pageRotation`; el contenido
  dibujado ahí debe rotarse `pageRotation` para verse derecho.
- Un documento puede tener páginas de distinto tamaño y rotación; pasa siempre el `PageInfo` de la
  página a la que pertenece la colocación.

La suite de pruebas comprueba los viajes de ida y vuelta con las cuatro rotaciones, varios tamaños
de página, valores `/Rotate` intrínsecos y un CropBox que no empieza en el origen.

## Exportación

`signora-pdf/pdf-lib` convierte una colocación en una llamada `drawImage` con
`computeImageDrawing()`: `toPdfUserSpace()` da la caja en la página sin rotar, y como pdf-lib rota
las imágenes en sentido antihorario alrededor de su esquina inferior izquierda, una página con
`/Rotate R` necesita la imagen rotada `R` y su ancla movida a la esquina correspondiente de la
caja. Está cubierto con pruebas unitarias para las cuatro rotaciones y CropBoxes desplazados, y se
verificó de extremo a extremo exportando colocaciones en páginas con `/Rotate` 0, 90, 180 y 270 y
midiendo dónde se renderizan.

## Limitaciones de la exportación

- La salida es un archivo reescrito (pdf-lib no tiene actualización incremental), por lo que
  cualquier firma digital existente queda invalidada; el writer rechaza esos documentos por
  defecto.
- Solo se pueden incrustar assets PNG y JPEG. La UI normaliza las subidas a PNG.
- Los PDFs cifrados no están soportados.
