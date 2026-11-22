---
title: Temas y personalización
description: Todos los estilos leen una propiedad CSS --signora-*; reestiliza sin tocar la librería.
---

Nada visual está fijo en el código: cada estilo lee una propiedad CSS `--signora-*` con un valor
por defecto integrado, así que la UI funciona sin configuración y se puede reestilizar sin tocar
la librería.

## Aplicar un tema

CSS normal, en el visor o en cualquier ancestro:

```css
signora-viewer {
  --signora-color-accent: #e11d48;
  --signora-radius: 999px;
}
```

O desde código, con la directiva `signoraTheme` (las claves omiten el prefijo `--signora-`), lo
que hace trivial crear editores de tema en vivo:

```html
<signora-viewer [signoraTheme]="{ 'color-accent': '#e11d48', radius: '999px' }" />
```

## Tokens

| Token                             | Por defecto               | Se usa para                                                                                                                          |
| --------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--signora-color-bg`              | `#e9ecf1`                 | fondo del visor                                                                                                                      |
| `--signora-color-toolbar-bg`      | `#fff`                    | fondo de la barra                                                                                                                    |
| `--signora-color-surface`         | `#fff`                    | campos de entrada                                                                                                                    |
| `--signora-color-text`            | `#1f2430`                 | texto                                                                                                                                |
| `--signora-color-text-muted`      | `#5b6475`                 | texto secundario                                                                                                                     |
| `--signora-color-border`          | `#d5d9e2`                 | bordes                                                                                                                               |
| `--signora-color-hover`           | `#eef1f7`                 | hover de botones                                                                                                                     |
| `--signora-color-focus-ring`      | `#3b5bdb`                 | contornos de foco                                                                                                                    |
| `--signora-signature-bg`          | fondo de la página        | «papel» tras las vistas previas de firma y el pad de dibujo                                                                          |
| `--signora-page-bg`               | `#fff`                    | fondo de la página                                                                                                                   |
| `--signora-page-shadow`           | sombra suave              | elevación de la página                                                                                                               |
| `--signora-radius`                | `8px`                     | esquinas                                                                                                                             |
| `--signora-radius-lg`             | `min(radius, 16px)`       | superficies grandes: marco del visor, tarjetas, pad de dibujo. Permite que `radius` sea una píldora (`999px`) en botones sin deformar áreas grandes |
| `--signora-space`                 | `8px`                     | unidad de espaciado                                                                                                                  |
| `--signora-toolbar-height`        | `48px`                    | altura mínima de la barra                                                                                                            |
| `--signora-font-family`           | `system-ui, sans-serif`   | tipografía                                                                                                                           |
| `--signora-disabled-opacity`      | `0.4`                     | controles desactivados                                                                                                               |
| `--signora-color-accent`          | `#3b5bdb`                 | botones primarios, pestaña activa                                                                                                    |
| `--signora-color-accent-contrast` | `#fff`                    | texto sobre el acento                                                                                                                |
| `--signora-color-danger`          | `#c92a2a`                 | botón de borrar, errores                                                                                                             |
| `--signora-color-panel-bg`        | fondo de la barra         | panel de firmas                                                                                                                      |
| `--signora-panel-width`           | `340px`                   | ancho del panel de firmas                                                                                                            |
| `--signora-signature-ink`         | `#1b1f3b`                 | tinta de las firmas dibujadas y escritas                                                                                             |
| `--signora-selection-color`       | acento                    | contorno de la colocación seleccionada                                                                                               |
| `--signora-field-color`           | acento                    | borde de los campos de firma                                                                                                         |
| `--signora-field-bg`              | acento translúcido        | fondo de los campos de firma vacíos                                                                                                  |
| `--signora-field-text`            | acento                    | etiqueta de los campos de firma                                                                                                      |
| `--signora-handle-size`           | `12px`                    | tiradores de redimensionado                                                                                                          |

La UI de firmas es opt-in con `<signora-viewer [showSignaturePanel]="true" />`. El color de la
tinta se lee al crear una firma, por lo que cambiarlo no recolorea las existentes.

## Sustituir secciones

```html
<signora-viewer [source]="url">
  <ng-template signoraSlot="toolbar" let-session>…tu barra…</ng-template>
  <ng-template signoraSlot="empty">…</ng-template>
  <ng-template signoraSlot="loading">…</ng-template>
  <ng-template signoraSlot="error">…</ng-template>
  <ng-template signoraSlot="signatures" let-session>…tu panel de firmas…</ng-template>
</signora-viewer>
```

La plantilla recibe la `SigningSession` como variable implícita.

## Traducir los textos

Provee `SIGNORA_LABELS` con tus cadenas:

```ts
{ provide: SIGNORA_LABELS, useValue: { ...DEFAULT_SIGNORA_LABELS, nextPage: 'Página siguiente' } }
```

## Totalmente a medida

Omite `signora-pdf/ui` y usa `SigningSession` más las funciones de coordenadas de `signora-pdf`.
