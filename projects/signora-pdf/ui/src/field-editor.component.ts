import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SigningSession } from 'signora-pdf';
import { SIGNORA_LABELS } from './labels';

/**
 * Controls to author signature fields: add a field, then name it, mark it required or delete it.
 * The viewer shows it when `fieldsMode` is `edit`; fields themselves are moved and resized on
 * the page.
 */
@Component({
  selector: 'signora-field-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="editor" role="group" [attr.aria-label]="labels.fieldsEditor">
      <button
        type="button"
        class="add"
        [attr.aria-pressed]="session.addingField()"
        (click)="session.armFieldCreation(!session.addingField())"
      >
        {{ labels.addField }}
      </button>
      @if (session.addingField()) {
        <span class="hint" role="status">{{ labels.addFieldHint }}</span>
      }
      @if (session.selectedField(); as field) {
        <label class="name">
          <span class="visually-hidden">{{ labels.fieldLabelInput }}</span>
          <input
            type="text"
            [placeholder]="labels.fieldLabelInput"
            [value]="field.label ?? ''"
            (input)="rename(field.id, $event)"
          />
        </label>
        <label class="required">
          <input
            type="checkbox"
            [checked]="!!field.required"
            (change)="setRequired(field.id, $event)"
          />
          {{ labels.fieldRequired }}
        </label>
        <button type="button" class="remove" (click)="session.removeField(field.id)">
          {{ labels.removeField }}
        </button>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .editor {
      display: flex;
      flex-wrap: wrap;
      gap: calc(var(--signora-space, 8px));
      align-items: center;
      padding: var(--signora-space, 8px) calc(var(--signora-space, 8px) * 1.5);
      border-bottom: 1px solid var(--signora-color-border, #d5d9e2);
      background: var(--signora-color-toolbar-bg, #fff);
      color: var(--signora-color-text, #1f2430);
      font-family: var(--signora-font-family, system-ui, sans-serif);
    }
    button,
    input[type='text'] {
      min-height: 2rem;
      padding: 0 calc(var(--signora-space, 8px) * 1.25);
      border: 1px solid var(--signora-color-border, #d5d9e2);
      border-radius: var(--signora-radius, 8px);
      background: var(--signora-color-surface, #fff);
      color: inherit;
      font: inherit;
    }
    button {
      cursor: pointer;
    }
    button:hover {
      background: var(--signora-color-hover, #eef1f7);
    }
    button[aria-pressed='true'] {
      border-color: var(--signora-color-accent, #3b5bdb);
      background: var(--signora-color-accent, #3b5bdb);
      color: var(--signora-color-accent-contrast, #fff);
    }
    .remove {
      border-color: var(--signora-color-danger, #c92a2a);
      color: var(--signora-color-danger, #c92a2a);
    }
    .required {
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }
    .hint {
      color: var(--signora-color-text-muted, #5b6475);
    }
    button:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--signora-color-focus-ring, #3b5bdb);
      outline-offset: 2px;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class SignoraFieldEditorComponent {
  protected readonly session = inject(SigningSession);
  protected readonly labels = inject(SIGNORA_LABELS);

  protected rename(id: string, event: Event): void {
    const label = (event.target as HTMLInputElement).value;
    this.session.updateField(id, { label: label.trim() ? label : undefined });
  }

  protected setRequired(id: string, event: Event): void {
    this.session.updateField(id, { required: (event.target as HTMLInputElement).checked });
  }
}
