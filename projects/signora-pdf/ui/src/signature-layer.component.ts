import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  CORNERS,
  SigningSession,
  cornerPoint,
  createId,
  createFieldRect,
  createPlacementRect,
  fromViewportPoint,
  moveRect,
  resizeFieldFromCorner,
  normalizedHeightRatio,
  resizeRectFromCorner,
  scaleRect,
  toViewportPoint,
  toViewportRect,
  type Corner,
  type NormalizedRect,
  type SignatureAsset,
  type SignatureField,
  type PageInfo,
  type PlacedSignature,
  type Point,
} from 'signora-pdf';
import { SIGNORA_LABELS } from './labels';
import { capturePointer } from './pointer-capture';

/** `DataTransfer` type used to drag a signature asset from the panel onto a page. */
export const SIGNORA_ASSET_MIME = 'application/x-signora-asset';

type DragMode = 'move' | Corner;

/** How the signature fields of a layer behave. */
export type FieldsMode = 'fill' | 'edit';

interface DragState {
  /** `field` drags edit a signature field instead of a signature. */
  readonly target: 'placement' | 'field';
  readonly id: string;
  readonly mode: DragMode;
  readonly pointerId: number;
  readonly startPointer: Point;
  readonly startRect: NormalizedRect;
  readonly ratio: number;
}

/**
 * Interactive layer over a page: places the armed signature on click or drop,
 * and lets users move, resize (corner handles, proportions kept), nudge with the
 * keyboard and delete placed signatures. Geometry is always stored normalized.
 */
@Component({
  selector: 'signora-signature-layer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="layer"
      [class.armed]="!locked() && session.armedAsset() !== null"
      (pointerdown)="onLayerPointerDown($event)"
      (dragover)="onDragOver($event)"
      (drop)="onDrop($event)"
    >
      @for (field of fieldItems(); track field.field.id) {
        <div
          class="field"
          data-signora-field
          [attr.data-field-id]="field.field.id"
          [attr.role]="field.interactive ? 'button' : 'group'"
          [attr.tabindex]="field.interactive || editing() ? 0 : null"
          [class.filled]="field.filled"
          [class.required]="field.field.required"
          [class.waiting]="field.waiting"
          [class.editing]="editing()"
          [class.selected]="field.selected"
          [attr.aria-label]="field.aria"
          [style.left.px]="field.view.x"
          [style.top.px]="field.view.y"
          [style.width.px]="field.view.width"
          [style.height.px]="field.view.height"
          (pointerdown)="onFieldPointerDown($event, field.field)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="endDrag($event)"
          (pointercancel)="endDrag($event)"
          (keydown)="onFieldKeydown($event, field.field)"
        >
          @if (!field.filled) {
            <span class="field-label"
              >{{ field.name }}
              @if (field.field.required) {
                <span aria-hidden="true"> *</span>
              }
            </span>
            @if (field.interactive) {
              <span class="field-hint">{{ labels.fieldHint }}</span>
            }
          }
          @if (editing() && field.selected) {
            @for (handle of field.handles; track handle.corner) {
              <span
                class="handle"
                role="presentation"
                [attr.data-corner]="handle.corner"
                [style.left.px]="handle.left"
                [style.top.px]="handle.top"
                (pointerdown)="onFieldHandlePointerDown($event, field.field, handle.corner)"
              ></span>
            }
            <button
              type="button"
              class="remove"
              [attr.aria-label]="labels.removeField"
              [title]="labels.removeField"
              (pointerdown)="$event.stopPropagation()"
              (click)="session.removeField(field.field.id)"
            >
              ×
            </button>
          }
        </div>
      }
      @for (item of items(); track item.placement.id) {
        <div
          class="placement"
          data-signora-placement
          role="group"
          [attr.tabindex]="locked() ? null : 0"
          [class.readonly]="locked()"
          [class.selected]="item.selected"
          [attr.aria-label]="item.label"
          [style.left.px]="item.view.x"
          [style.top.px]="item.view.y"
          [style.width.px]="item.view.width"
          [style.height.px]="item.view.height"
          (pointerdown)="onPlacementPointerDown($event, item.placement)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="endDrag($event)"
          (pointercancel)="endDrag($event)"
          (keydown)="onPlacementKeydown($event, item.placement)"
          (focus)="!locked() && session.selectPlacement(item.placement.id)"
        >
          <img
            class="art"
            alt=""
            draggable="false"
            [src]="item.placement.asset.dataUrl"
            [style.width.px]="item.natural.width"
            [style.height.px]="item.natural.height"
            [style.transform]="'translate(-50%, -50%) rotate(' + rotation() + 'deg)'"
          />
          @if (item.selected) {
            @for (handle of item.handles; track handle.corner) {
              <span
                class="handle"
                role="presentation"
                [attr.data-corner]="handle.corner"
                [style.left.px]="handle.left"
                [style.top.px]="handle.top"
                (pointerdown)="onHandlePointerDown($event, item.placement, handle.corner)"
              ></span>
            }
            <button
              type="button"
              class="remove"
              [attr.aria-label]="labels.removePlacement"
              [title]="labels.removePlacement"
              (pointerdown)="$event.stopPropagation()"
              (click)="remove(item.placement)"
            >
              ×
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      display: block;
    }
    .layer {
      position: absolute;
      inset: 0;
    }
    .layer.armed {
      cursor: crosshair;
    }
    .field {
      position: absolute;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 2px;
      overflow: visible;
      border: 2px dashed var(--signora-field-color, var(--signora-color-accent, #3b5bdb));
      border-radius: calc(var(--signora-radius, 8px) / 2);
      background: var(--signora-field-bg, rgb(59 91 219 / 0.08));
      color: var(--signora-field-text, var(--signora-color-accent, #3b5bdb));
      font: 600 0.75rem/1.2 var(--signora-font-family, system-ui, sans-serif);
      text-align: center;
      touch-action: none;
    }
    .field[role='button'] {
      cursor: pointer;
    }
    .field.required:not(.filled) {
      border-color: var(--signora-color-danger, #c92a2a);
      color: var(--signora-color-danger, #c92a2a);
    }
    .field.filled {
      border-style: solid;
      border-width: 1px;
      background: transparent;
      opacity: 0.55;
      pointer-events: none;
    }
    .field.waiting,
    .field.selected,
    .field:focus-visible {
      outline: 2px solid var(--signora-selection-color, var(--signora-color-accent, #3b5bdb));
      outline-offset: 1px;
    }
    .field.editing {
      cursor: move;
    }
    .field.editing.filled {
      pointer-events: auto;
      opacity: 1;
    }
    .field-label,
    .field-hint {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .field-hint {
      font-weight: 400;
      opacity: 0.8;
    }
    .placement {
      position: absolute;
      box-sizing: border-box;
      touch-action: none;
      cursor: move;
      outline: 1px dashed transparent;
    }
    .placement.readonly {
      cursor: default;
    }
    .placement:not(.readonly):hover {
      outline-color: var(--signora-color-accent, #3b5bdb);
    }
    .placement.selected,
    .placement:focus-visible {
      outline: 2px solid var(--signora-selection-color, var(--signora-color-accent, #3b5bdb));
    }
    .art {
      position: absolute;
      top: 50%;
      left: 50%;
      max-width: none;
      user-select: none;
      pointer-events: none;
    }
    .handle {
      position: absolute;
      width: var(--signora-handle-size, 12px);
      height: var(--signora-handle-size, 12px);
      margin: calc(var(--signora-handle-size, 12px) / -2) 0 0
        calc(var(--signora-handle-size, 12px) / -2);
      box-sizing: border-box;
      border: 2px solid var(--signora-selection-color, var(--signora-color-accent, #3b5bdb));
      border-radius: 50%;
      background: var(--signora-color-surface, #fff);
      touch-action: none;
    }
    .handle[data-corner='nw'],
    .handle[data-corner='se'] {
      cursor: nwse-resize;
    }
    .handle[data-corner='ne'],
    .handle[data-corner='sw'] {
      cursor: nesw-resize;
    }
    .remove {
      position: absolute;
      top: -14px;
      right: -14px;
      transform: translate(0, -100%);
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: var(--signora-color-danger, #c92a2a);
      color: #fff;
      line-height: 1;
      cursor: pointer;
    }
    .remove:focus-visible {
      outline: 2px solid var(--signora-color-focus-ring, #3b5bdb);
      outline-offset: 2px;
    }
  `,
})
export class SignoraSignatureLayerComponent {
  protected readonly session = inject(SigningSession);
  protected readonly labels = inject(SIGNORA_LABELS);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private drag: DragState | null = null;

  /** Zero-based index of the page this layer belongs to. */
  readonly pageIndex = input.required<number>();
  /** Geometry of that page; the layer renders nothing until it is known. */
  readonly info = input.required<PageInfo | null>();
  /** Shows the placed signatures without letting users place, move, resize or delete them. */
  readonly readOnly = input(false);
  /**
   * `fill` (default): users fill the signature fields. `edit`: users create, move, resize and
   * delete the fields instead, and signatures cannot be placed.
   */
  readonly fieldsMode = input<FieldsMode>('fill');
  /** When `false`, signatures can only go inside a signature field. */
  readonly freePlacement = input(true);

  protected readonly editing = computed(() => this.fieldsMode() === 'edit' && !this.readOnly());
  /** Signatures cannot be placed, moved or removed (read-only, or editing fields). */
  protected readonly locked = computed(() => this.readOnly() || this.fieldsMode() === 'edit');

  protected readonly fieldItems = computed(() => {
    const info = this.info();
    if (!info) return [];
    const viewport = this.session.viewport();
    const index = this.pageIndex();
    const filled = this.session.filledFieldIds();
    const selectedId = this.session.selectedFieldId();
    const editing = this.editing();
    return this.session
      .fields()
      .filter((f) => f.pageIndex === index)
      .map((field) => {
        const view = toViewportRect(field.rect, info, viewport);
        const isFilled = filled.has(field.id);
        const name = field.label ?? this.labels.fieldName;
        const interactive = !this.readOnly() && !editing && !isFilled;
        return {
          field,
          view,
          name,
          filled: isFilled,
          interactive,
          selected: editing && field.id === selectedId,
          waiting: !editing && field.id === selectedId,
          aria: this.labels.fieldAria(name, !!field.required, isFilled),
          handles: CORNERS.map((corner) => {
            const point = toViewportPoint(cornerPoint(field.rect, corner), info, viewport);
            return { corner, left: point.x - view.x, top: point.y - view.y };
          }),
        };
      });
  });

  protected readonly rotation = computed(() => this.session.rotation());

  protected readonly items = computed(() => {
    const info = this.info();
    if (!info) return [];
    const viewport = this.session.viewport();
    const selectedId = this.locked() ? null : this.session.selectedPlacementId();
    const index = this.pageIndex();
    return this.session
      .placements()
      .filter((p) => p.pageIndex === index)
      .map((placement, i) => {
        const view = toViewportRect(placement.rect, info, viewport);
        return {
          placement,
          view,
          selected: placement.id === selectedId,
          label: this.labels.placementLabel(
            i + 1,
            placement.asset.label ?? this.labels.signatureName,
          ),
          // Unrotated size: the image is centred in the box and rotated with the view.
          natural: {
            width: placement.rect.width * info.width * viewport.scale,
            height: placement.rect.height * info.height * viewport.scale,
          },
          // A signature in a field stays where the field is: no resize handles.
          handles: placement.fieldId
            ? []
            : CORNERS.map((corner) => {
                const point = toViewportPoint(cornerPoint(placement.rect, corner), info, viewport);
                return { corner, left: point.x - view.x, top: point.y - view.y };
              }),
        };
      });
  });

  /* ------------------------------------------------------------- placing */

  protected onLayerPointerDown(event: PointerEvent): void {
    if (this.readOnly()) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-signora-placement], [data-signora-field]')) return;
    const info = this.info();
    if (this.editing()) {
      if (this.session.addingField() && info) {
        const field: SignatureField = {
          id: createId('field'),
          pageIndex: this.pageIndex(),
          rect: createFieldRect(info, this.toNormalized(event)),
        };
        this.session.addField(field);
        this.session.selectField(field.id);
        this.session.armFieldCreation(false);
      } else {
        this.session.selectField(null);
      }
      return;
    }
    const asset = this.session.armedAsset();
    if (asset && info) {
      this.placeOrFill(asset, this.toNormalized(event));
    } else {
      this.session.selectPlacement(null);
      this.session.selectField(null);
    }
  }

  protected onDragOver(event: DragEvent): void {
    if (this.locked()) return;
    if (event.dataTransfer?.types.includes(SIGNORA_ASSET_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  protected onDrop(event: DragEvent): void {
    if (this.locked()) return;
    const id = event.dataTransfer?.getData(SIGNORA_ASSET_MIME);
    const asset = id ? this.session.assets().find((a) => a.id === id) : undefined;
    if (!asset || !this.info()) return;
    event.preventDefault();
    this.placeOrFill(asset, this.toNormalized(event));
  }

  /** Puts the asset in the empty field under `point` or, if allowed, freely on the page. */
  private placeOrFill(asset: SignatureAsset, point: Point): void {
    const field = this.fieldAt(point);
    if (field) {
      void this.session.fillField(field.id, asset);
    } else if (this.freePlacement()) {
      this.place(asset, point);
    } else {
      return;
    }
    this.session.arm(null);
  }

  private fieldAt(point: Point): SignatureField | undefined {
    const filled = this.session.filledFieldIds();
    return this.session
      .fields()
      .find(
        (f) =>
          f.pageIndex === this.pageIndex() &&
          !filled.has(f.id) &&
          point.x >= f.rect.x &&
          point.x <= f.rect.x + f.rect.width &&
          point.y >= f.rect.y &&
          point.y <= f.rect.y + f.rect.height,
      );
  }

  private place(asset: SignatureAsset, center: Point): void {
    const info = this.info();
    if (!info) return;
    const placement: PlacedSignature = {
      id: createId('placement'),
      asset,
      pageIndex: this.pageIndex(),
      rect: createPlacementRect(asset, info, center),
    };
    this.session.addPlacement(placement);
    this.session.selectPlacement(placement.id);
  }

  /* ------------------------------------------------------- move / resize */

  protected onPlacementPointerDown(event: PointerEvent, placement: PlacedSignature): void {
    if (this.locked()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).focus();
    this.session.selectPlacement(placement.id);
    // A signature in a field cannot be dragged away from it.
    if (!placement.fieldId) this.beginDrag(event, placement, 'move');
  }

  protected onHandlePointerDown(
    event: PointerEvent,
    placement: PlacedSignature,
    corner: Corner,
  ): void {
    if (this.locked()) return;
    event.stopPropagation();
    this.beginDrag(event, placement, corner);
  }

  /* -------------------------------------------------------------- fields */

  protected onFieldPointerDown(event: PointerEvent, field: SignatureField): void {
    if (this.readOnly()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.stopPropagation();
    if (this.editing()) {
      (event.currentTarget as HTMLElement).focus();
      this.session.selectField(field.id);
      this.beginFieldDrag(event, field, 'move');
      return;
    }
    if (this.session.filledFieldIds().has(field.id)) return;
    this.useField(field);
  }

  protected onFieldHandlePointerDown(
    event: PointerEvent,
    field: SignatureField,
    corner: Corner,
  ): void {
    if (!this.editing()) return;
    event.stopPropagation();
    this.beginFieldDrag(event, field, corner);
  }

  /** Fills the field with the armed signature, or waits for the next one the user picks. */
  private useField(field: SignatureField): void {
    const asset = this.session.armedAsset();
    if (asset) {
      void this.session.fillField(field.id, asset);
      this.session.arm(null);
    } else {
      this.session.selectField(field.id);
    }
  }

  private beginFieldDrag(event: PointerEvent, field: SignatureField, mode: DragMode): void {
    if (!this.info()) return;
    capturePointer(event.target as HTMLElement, event.pointerId);
    this.drag = {
      target: 'field',
      id: field.id,
      mode,
      pointerId: event.pointerId,
      startPointer: this.toNormalized(event),
      startRect: field.rect,
      ratio: 1,
    };
  }

  protected onFieldKeydown(event: KeyboardEvent, rendered: SignatureField): void {
    if (this.readOnly() || event.altKey || event.ctrlKey || event.metaKey) return;
    const field = this.session.fields().find((f) => f.id === rendered.id) ?? rendered;
    const info = this.info();
    if (!info) return;

    if (!this.editing()) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (this.session.filledFieldIds().has(field.id)) return;
      this.useField(field);
    } else {
      const arrows: Record<string, Point> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      };
      const arrow = arrows[event.key];
      if (arrow) {
        const step = event.shiftKey ? 20 : 4;
        const viewport = this.session.viewport();
        const from = fromViewportPoint({ x: 0, y: 0 }, info, viewport);
        const to = fromViewportPoint({ x: arrow.x * step, y: arrow.y * step }, info, viewport);
        this.session.updateField(field.id, {
          rect: moveRect(field.rect, to.x - from.x, to.y - from.y),
        });
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        this.session.removeField(field.id);
      } else if (event.key === 'Escape') {
        this.session.selectField(null);
        (event.currentTarget as HTMLElement).blur();
      } else {
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
  }

  private beginDrag(event: PointerEvent, placement: PlacedSignature, mode: DragMode): void {
    const info = this.info();
    if (!info) return;
    capturePointer(event.target as HTMLElement, event.pointerId);
    this.drag = {
      target: 'placement',
      id: placement.id,
      mode,
      pointerId: event.pointerId,
      startPointer: this.toNormalized(event),
      startRect: placement.rect,
      ratio: normalizedHeightRatio(info, placement.asset.aspectRatio),
    };
  }

  protected onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pointer = this.toNormalized(event);
    if (drag.target === 'field') {
      const next =
        drag.mode === 'move'
          ? moveRect(
              drag.startRect,
              pointer.x - drag.startPointer.x,
              pointer.y - drag.startPointer.y,
            )
          : resizeFieldFromCorner(drag.startRect, drag.mode, pointer);
      this.session.updateField(drag.id, { rect: next });
      return;
    }
    const rect =
      drag.mode === 'move'
        ? moveRect(drag.startRect, pointer.x - drag.startPointer.x, pointer.y - drag.startPointer.y)
        : resizeRectFromCorner(drag.startRect, drag.mode, pointer, drag.ratio);
    this.session.updatePlacement(drag.id, { rect });
  }

  protected endDrag(event: PointerEvent): void {
    if (this.drag?.pointerId === event.pointerId) this.drag = null;
  }

  /* ------------------------------------------------------------ keyboard */

  protected onPlacementKeydown(event: KeyboardEvent, rendered: PlacedSignature): void {
    if (this.locked()) return;
    // Key repeat can fire several events before the view re-renders: always start from the
    // placement as it is now, not from the one captured when the template last ran.
    const placement = this.session.placements().find((p) => p.id === rendered.id) ?? rendered;
    const info = this.info();
    if (!info || event.altKey || event.ctrlKey || event.metaKey) return;

    const arrows: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const arrow = arrows[event.key];
    const ratio = normalizedHeightRatio(info, placement.asset.aspectRatio);

    if (placement.fieldId && (arrow || ['+', '=', '-'].includes(event.key))) return; // stays in its field
    if (arrow) {
      // Arrows follow what the user sees, whatever the viewer rotation is.
      const step = event.shiftKey ? 20 : 4;
      const viewport = this.session.viewport();
      const from = fromViewportPoint({ x: 0, y: 0 }, info, viewport);
      const to = fromViewportPoint({ x: arrow.x * step, y: arrow.y * step }, info, viewport);
      this.session.updatePlacement(placement.id, {
        rect: moveRect(placement.rect, to.x - from.x, to.y - from.y),
      });
    } else if (event.key === '+' || event.key === '=') {
      this.session.updatePlacement(placement.id, { rect: scaleRect(placement.rect, 1.05, ratio) });
    } else if (event.key === '-') {
      this.session.updatePlacement(placement.id, { rect: scaleRect(placement.rect, 0.95, ratio) });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      this.remove(placement);
    } else if (event.key === 'Escape') {
      this.session.selectPlacement(null);
      (event.currentTarget as HTMLElement).blur();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  protected remove(placement: PlacedSignature): void {
    if (this.locked()) return;
    // Removing a signature from a field empties the field and keeps it.
    if (placement.fieldId) this.session.clearField(placement.fieldId);
    else this.session.removePlacement(placement.id);
  }

  private toNormalized(event: MouseEvent): Point {
    const info = this.info();
    const box = this.host.getBoundingClientRect();
    return fromViewportPoint(
      { x: event.clientX - box.left, y: event.clientY - box.top },
      info ?? { width: 1, height: 1 },
      this.session.viewport(),
    );
  }
}
