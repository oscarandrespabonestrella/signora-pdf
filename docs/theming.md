# Theming and customization

Nothing visual is hard-coded: every style reads a `--signora-*` custom property with a built-in
fallback, so the UI works with no setup and can be restyled without touching the library.

## Applying a theme

Plain CSS, on the viewer or any ancestor:

```css
signora-viewer {
  --signora-color-accent: #e11d48;
  --signora-radius: 999px;
}
```

Or from code, with the `signoraTheme` directive (keys omit the `--signora-` prefix), which makes
live theme editors trivial:

```html
<signora-viewer [signoraTheme]="{ 'color-accent': '#e11d48', radius: '999px' }" />
```

## Tokens

| Token                             | Default                 | Used for                                                                                                                     |
| --------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--signora-color-bg`              | `#e9ecf1`               | viewer background                                                                                                            |
| `--signora-color-toolbar-bg`      | `#fff`                  | toolbar background                                                                                                           |
| `--signora-color-surface`         | `#fff`                  | inputs                                                                                                                       |
| `--signora-color-text`            | `#1f2430`               | text                                                                                                                         |
| `--signora-color-text-muted`      | `#5b6475`               | secondary text                                                                                                               |
| `--signora-color-border`          | `#d5d9e2`               | borders                                                                                                                      |
| `--signora-color-hover`           | `#eef1f7`               | button hover                                                                                                                 |
| `--signora-color-focus-ring`      | `#3b5bdb`               | focus outlines                                                                                                               |
| `--signora-signature-bg`          | page background         | paper behind signature previews and the drawing pad                                                                          |
| `--signora-page-bg`               | `#fff`                  | page background                                                                                                              |
| `--signora-page-shadow`           | soft drop shadow        | page elevation                                                                                                               |
| `--signora-radius`                | `8px`                   | corners                                                                                                                      |
| `--signora-radius-lg`             | `min(radius, 16px)`     | large surfaces: viewer frame, cards, drawing pad. Lets `radius` be a pill (`999px`) for buttons without distorting big areas |
| `--signora-space`                 | `8px`                   | spacing unit                                                                                                                 |
| `--signora-toolbar-height`        | `48px`                  | toolbar min height                                                                                                           |
| `--signora-font-family`           | `system-ui, sans-serif` | typography                                                                                                                   |
| `--signora-disabled-opacity`      | `0.4`                   | disabled controls                                                                                                            |
| `--signora-color-accent`          | `#3b5bdb`               | primary buttons, active tab                                                                                                  |
| `--signora-color-accent-contrast` | `#fff`                  | text on accent                                                                                                               |
| `--signora-color-danger`          | `#c92a2a`               | delete button, errors                                                                                                        |
| `--signora-color-panel-bg`        | toolbar background      | signature panel                                                                                                              |
| `--signora-panel-width`           | `340px`                 | signature panel width                                                                                                        |
| `--signora-signature-ink`         | `#1b1f3b`               | ink of drawn and typed signatures                                                                                            |
| `--signora-selection-color`       | accent                  | selected placement outline                                                                                                   |
| `--signora-field-color`           | accent                  | border of signature fields                                                                                                   |
| `--signora-field-bg`              | translucent accent      | background of empty signature fields                                                                                         |
| `--signora-field-text`            | accent                  | label of signature fields                                                                                                    |
| `--signora-handle-size`           | `12px`                  | resize handles                                                                                                               |

The signature UI is opt-in with `<signora-viewer [showSignaturePanel]="true" />`. The ink color is
read when a signature is created, so changing it does not recolor existing ones.

## Replacing sections

```html
<signora-viewer [source]="url">
  <ng-template signoraSlot="toolbar" let-session>…your toolbar…</ng-template>
  <ng-template signoraSlot="empty">…</ng-template>
  <ng-template signoraSlot="loading">…</ng-template>
  <ng-template signoraSlot="error">…</ng-template>
  <ng-template signoraSlot="signatures" let-session>…your signature panel…</ng-template>
</signora-viewer>
```

The template receives the `SigningSession` as its implicit variable.

## Translating text

Provide `SIGNORA_LABELS` with your strings:

```ts
{ provide: SIGNORA_LABELS, useValue: { ...DEFAULT_SIGNORA_LABELS, nextPage: 'Página siguiente' } }
```

## Going fully custom

Skip `signora-pdf/ui` and use `SigningSession` plus the coordinate functions from `signora-pdf`.
