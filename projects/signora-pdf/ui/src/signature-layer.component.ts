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
  createPlacementRect,
  fromViewportPoint,
  moveRect,
  normalizedHeightRatio,
  resizeRectFromCorner,
  scaleRect,
  toViewportPoint,
  toViewportRect,
  type Corner,
  type NormalizedRect,
  type PageInfo,
  type PlacedSignature,
  type Point,
} from 'signora-pdf';
import { SIGNORA_LABELS } from './labels';
import { capturePointer } from './pointer-capture';

/** `DataTransfer` type used to drag a signature asset from the panel onto a page. */
export const SIGNORA_ASSET_MIME = 'application/x-signora-asset';

type DragMode = 'move' | Corner;

interface DragState {
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
      [class.armed]="!readOnly() && session.armedAsset() !== null"
      (pointerdown)="onLayerPointerDown($event)"
      (dragover)="onDragOver($event)"
      (drop)="onDrop($event)"
    >
      @for (item of items(); track item.placement.id) {
        <div
          class="placement"
          data-signora-placement
          role="group"
          [attr.tabindex]="readOnly() ? null : 0"
          [class.readonly]="readOnly()"
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
          (focus)="!readOnly() && session.selectPlacement(item.placement.id)"
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

  protected readonly rotation = computed(() => this.session.rotation());

  protected readonly items = computed(() => {
    const info = this.info();
    if (!info) return [];
    const viewport = this.session.viewport();
    const selectedId = this.readOnly() ? null : this.session.selectedPlacementId();
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
          handles: CORNERS.map((corner) => {
            const point = toViewportPoint(cornerPoint(placement.rect, corner), info, viewport);
            return { corner, left: point.x - view.x, top: point.y - view.y };
          }),
        };
      });
  });

  /* ------------------------------------------------------------- placing */

  protected onLayerPointerDown(event: PointerEvent): void {
    if (this.readOnly()) return;
    if ((event.target as HTMLElement).closest('[data-signora-placement]')) return;
    const asset = this.session.armedAsset();
    const info = this.info();
    if (asset && info) {
      this.place(asset, this.toNormalized(event));
      this.session.arm(null);
    } else {
      this.session.selectPlacement(null);
    }
  }

  protected onDragOver(event: DragEvent): void {
    if (this.readOnly()) return;
    if (event.dataTransfer?.types.includes(SIGNORA_ASSET_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  protected onDrop(event: DragEvent): void {
    if (this.readOnly()) return;
    const id = event.dataTransfer?.getData(SIGNORA_ASSET_MIME);
    const asset = id ? this.session.assets().find((a) => a.id === id) : undefined;
    if (!asset || !this.info()) return;
    event.preventDefault();
    this.place(asset, this.toNormalized(event));
    this.session.arm(null);
  }

  private place(asset: PlacedSignature['asset'], center: Point): void {
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
    if (this.readOnly()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).focus();
    this.session.selectPlacement(placement.id);
    this.beginDrag(event, placement, 'move');
  }

  protected onHandlePointerDown(
    event: PointerEvent,
    placement: PlacedSignature,
    corner: Corner,
  ): void {
    if (this.readOnly()) return;
    event.stopPropagation();
    this.beginDrag(event, placement, corner);
  }

  private beginDrag(event: PointerEvent, placement: PlacedSignature, mode: DragMode): void {
    const info = this.info();
    if (!info) return;
    capturePointer(event.target as HTMLElement, event.pointerId);
    this.drag = {
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
    if (this.readOnly()) return;
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
    if (this.readOnly()) return;
    this.session.removePlacement(placement.id);
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
