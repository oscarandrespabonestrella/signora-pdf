import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  type OnInit,
} from '@angular/core';
import {
  SIGNORA_SIGNATURE_PROVIDERS,
  SigningSession,
  type SignatureAsset,
  type SignatureProvider,
} from 'signora-pdf';
import { SIGNORA_LABELS } from './labels';
import { SIGNORA_ASSET_MIME } from './signature-layer.component';
import { SignoraSignaturePadComponent } from './signature-pad.component';
import { SignoraSignatureTypedComponent } from './signature-typed.component';
import { SignoraSignatureUploadComponent } from './signature-upload.component';

/** Identifier of a tab in the signature panel: a built-in tab or a provider id. */
export type SignatureTabId = 'draw' | 'type' | 'upload' | (string & {});

/**
 * A way of providing a signature that the integrator can switch on or off: the built-in
 * `draw`, `type` and `upload` tabs, and `other` for the tabs of registered providers
 * (organization signatures, your own sources).
 */
export type SignatureMode = 'draw' | 'type' | 'upload' | 'other';

/** Every {@link SignatureMode}, in display order. */
export const ALL_SIGNATURE_MODES: readonly SignatureMode[] = ['draw', 'type', 'upload', 'other'];

interface Tab {
  readonly id: SignatureTabId;
  readonly label: string;
  /** Present for tabs backed by a provider with predefined assets. */
  readonly provider?: SignatureProvider;
}

/**
 * Panel to create, choose and arm signatures: Draw, Type and Upload tabs plus
 * one tab per registered provider that lists predefined assets (for example
 * organization signatures, logos and stamps).
 */
@Component({
  selector: 'signora-signature-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SignoraSignaturePadComponent,
    SignoraSignatureTypedComponent,
    SignoraSignatureUploadComponent,
  ],
  template: `
    <section class="panel" [attr.aria-label]="labels.signaturePanel">
      @if (tabs().length > 0) {
        <div class="tabs" role="tablist" [attr.aria-label]="labels.signaturePanel">
          @for (tab of tabs(); track tab.id) {
            <button
              type="button"
              role="tab"
              [id]="'signora-tab-' + tab.id"
              [attr.aria-selected]="active() === tab.id"
              [attr.aria-controls]="'signora-tabpanel-' + tab.id"
              [attr.tabindex]="active() === tab.id ? 0 : -1"
              (click)="active.set(tab.id)"
              (keydown)="onTabKeydown($event)"
            >
              {{ tab.label }}
            </button>
          }
        </div>

        <div
          class="tabpanel"
          role="tabpanel"
          [id]="'signora-tabpanel-' + active()"
          [attr.aria-labelledby]="'signora-tab-' + active()"
        >
          @switch (active()) {
            @case ('draw') {
              <signora-signature-pad (created)="onCreated($event)" />
            }
            @case ('type') {
              <signora-signature-typed (created)="onCreated($event)" />
            }
            @case ('upload') {
              <signora-signature-upload (created)="onCreated($event)" />
            }
            @default {
              @let items = providerAssets()[active()] ?? [];
              @if (items.length === 0) {
                <p class="muted">{{ labels.organizationEmpty }}</p>
              } @else {
                <ul class="grid">
                  @for (asset of items; track asset.id) {
                    <li>
                      <button type="button" class="asset" (click)="session.arm(asset)">
                        <img [src]="asset.dataUrl" alt="" />
                        <span>{{ asset.label }}</span>
                      </button>
                    </li>
                  }
                </ul>
              }
            }
          }
        </div>
      }

      <p class="section-title" id="signora-library-title">{{ labels.librarySection }}</p>
      @if (session.armedAsset(); as armed) {
        <p class="armed" role="status">
          {{ labels.armedHint }}
          <button type="button" class="link" (click)="session.arm(null)">
            {{ labels.cancelPlacing }}
          </button>
        </p>
      }
      @if (session.assets().length === 0) {
        <p class="muted">{{ labels.libraryEmpty }}</p>
      } @else {
        <ul class="grid" aria-labelledby="signora-library-title">
          @for (asset of session.assets(); track asset.id) {
            <li class="library-item">
              <button
                type="button"
                class="asset"
                [class.armed]="session.armedAsset()?.id === asset.id"
                [attr.aria-pressed]="session.armedAsset()?.id === asset.id"
                draggable="true"
                (click)="session.arm(asset)"
                (dragstart)="onDragStart($event, asset)"
              >
                <img [src]="asset.dataUrl" alt="" draggable="false" />
                @if (asset.label) {
                  <span>{{ asset.label }}</span>
                }
              </button>
              <button
                type="button"
                class="remove"
                [attr.aria-label]="labels.removeFromLibrary"
                [title]="labels.removeFromLibrary"
                (click)="session.removeAsset(asset.id)"
              >
                ×
              </button>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      color: var(--signora-color-text, #1f2430);
      font-family: var(--signora-font-family, system-ui, sans-serif);
    }
    .panel {
      padding: calc(var(--signora-space, 8px) * 1.5);
    }
    .tabs {
      display: flex;
      gap: calc(var(--signora-space, 8px) / 2);
      margin-bottom: var(--signora-space, 8px);
      border-bottom: 1px solid var(--signora-color-border, #d5d9e2);
    }
    [role='tab'] {
      font: inherit;
      color: var(--signora-color-text-muted, #5b6475);
      padding: 0.4rem 0.7rem;
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      cursor: pointer;
    }
    [role='tab'][aria-selected='true'] {
      color: var(--signora-color-accent, #3b5bdb);
      border-bottom-color: var(--signora-color-accent, #3b5bdb);
    }
    button:focus-visible {
      outline: 2px solid var(--signora-color-focus-ring, #3b5bdb);
      outline-offset: 1px;
    }
    .section-title {
      margin: calc(var(--signora-space, 8px) * 2) 0 var(--signora-space, 8px);
      font-size: 0.9em;
      font-weight: 600;
    }
    .muted {
      margin: 0;
      color: var(--signora-color-text-muted, #5b6475);
      font-size: 0.9em;
    }
    .armed {
      margin: 0 0 var(--signora-space, 8px);
      padding: var(--signora-space, 8px);
      border-radius: var(--signora-radius-lg, min(var(--signora-radius, 8px), 16px));
      background: var(--signora-color-hover, #eef1f7);
      font-size: 0.9em;
    }
    .link {
      font: inherit;
      padding: 0;
      border: 0;
      background: none;
      color: var(--signora-color-accent, #3b5bdb);
      text-decoration: underline;
      cursor: pointer;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: var(--signora-space, 8px);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .library-item {
      position: relative;
    }
    .asset {
      display: grid;
      gap: calc(var(--signora-space, 8px) / 2);
      width: 100%;
      font: inherit;
      color: inherit;
      padding: var(--signora-space, 8px);
      border: 1px solid var(--signora-color-border, #d5d9e2);
      border-radius: var(--signora-radius-lg, min(var(--signora-radius, 8px), 16px));
      background: var(--signora-color-surface, #fff);
      cursor: grab;
      text-align: center;
    }
    .asset.armed {
      border-color: var(--signora-color-accent, #3b5bdb);
      box-shadow: 0 0 0 1px var(--signora-color-accent, #3b5bdb);
    }
    .asset img {
      width: 100%;
      height: 44px;
      box-sizing: border-box;
      padding: 2px;
      object-fit: contain;
      /* Signatures are placed on white pages: preview them on paper in any theme. */
      background: var(--signora-signature-bg, var(--signora-page-bg, #fff));
      border-radius: calc(var(--signora-radius, 8px) / 2);
    }
    .asset span {
      overflow: hidden;
      font-size: 0.75em;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--signora-color-text-muted, #5b6475);
    }
    .remove {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 1.4rem;
      height: 1.4rem;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: var(--signora-color-hover, #eef1f7);
      color: inherit;
      line-height: 1;
      cursor: pointer;
    }
  `,
})
export class SignoraSignaturePanelComponent implements OnInit {
  protected readonly session = inject(SigningSession);
  protected readonly labels = inject(SIGNORA_LABELS);
  private readonly providers = inject(SIGNORA_SIGNATURE_PROVIDERS, { optional: true }) ?? [];

  /** Built-in tabs to show. */
  readonly builtInTabs = input<readonly ('draw' | 'type' | 'upload')[]>(['draw', 'type', 'upload']);
  /**
   * Show the tabs of registered providers that list assets (organization signatures…).
   * `true` for all, `false` for none, or the ids of the providers to keep.
   */
  readonly providerTabs = input<boolean | readonly string[]>(true);

  protected readonly providerAssets = signal<Readonly<Record<string, readonly SignatureAsset[]>>>(
    {},
  );
  protected readonly active = signal<SignatureTabId>('draw');

  protected readonly tabs = computed<readonly Tab[]>(() => {
    const names = {
      draw: this.labels.tabDraw,
      type: this.labels.tabType,
      upload: this.labels.tabUpload,
    };
    return [
      ...this.builtInTabs().map((id) => ({ id, label: names[id] })),
      ...this.providers
        .filter((provider) => provider.listAssets && this.providerAllowed(provider.id))
        .map((provider) => ({ id: provider.id, label: provider.label, provider })),
    ];
  });

  constructor() {
    // Keep the active tab valid when the available modes change.
    effect(() => {
      const tabs = this.tabs();
      const active = untracked(this.active);
      if (tabs.length > 0 && !tabs.some((t) => t.id === active)) this.active.set(tabs[0].id);
    });
  }

  private providerAllowed(id: string): boolean {
    const allowed = this.providerTabs();
    return typeof allowed === 'boolean' ? allowed : allowed.includes(id);
  }

  ngOnInit(): void {
    const first = this.tabs()[0];
    if (first) this.active.set(first.id);
    for (const provider of this.providers) {
      void provider.listAssets?.().then(
        (assets) => this.providerAssets.update((all) => ({ ...all, [provider.id]: assets })),
        () => this.providerAssets.update((all) => ({ ...all, [provider.id]: [] })),
      );
    }
  }

  protected onCreated(asset: SignatureAsset): void {
    this.session.arm(asset);
  }

  protected onDragStart(event: DragEvent, asset: SignatureAsset): void {
    event.dataTransfer?.setData(SIGNORA_ASSET_MIME, asset.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const tabs = this.tabs();
    const index = tabs.findIndex((t) => t.id === this.active());
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const id = tabs[next].id;
    this.active.set(id);
    // Tabs with tabindex="-1" can still be focused programmatically.
    (event.currentTarget as HTMLElement).parentElement
      ?.querySelector<HTMLElement>(`#signora-tab-${id}`)
      ?.focus();
  }
}
