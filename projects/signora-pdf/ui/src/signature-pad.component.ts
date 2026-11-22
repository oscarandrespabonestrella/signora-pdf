import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { SignatureAsset } from 'signora-pdf';
import { SIGNORA_LABELS } from './labels';
import { capturePointer } from './pointer-capture';
import {
  drawStrokes,
  readInkColor,
  strokesToAsset,
  type Stroke,
  type StrokePoint,
} from './signature-render';

const LOGICAL_WIDTH = 560;
const LOGICAL_HEIGHT = 200;

/**
 * Freehand drawing pad. Works with mouse, touch and stylus (pressure-aware)
 * through Pointer Events and emits a cropped transparent PNG asset.
 */
@Component({
  selector: 'signora-signature-pad',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="hint">{{ labels.drawHint }}</p>
    <canvas
      #canvas
      role="img"
      [attr.aria-label]="labels.drawCanvas"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerEnd($event)"
      (pointercancel)="onPointerEnd($event)"
    ></canvas>
    <div class="actions">
      <button type="button" (click)="undo()" [disabled]="!hasInk()">{{ labels.undo }}</button>
      <button type="button" (click)="clear()" [disabled]="!hasInk()">{{ labels.clear }}</button>
      <button type="button" class="primary" (click)="use()" [disabled]="!hasInk()">
        {{ labels.useSignature }}
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .hint {
      margin: 0 0 calc(var(--signora-space, 8px));
      color: var(--signora-color-text-muted, #5b6475);
      font-size: 0.85em;
    }
    canvas {
      display: block;
      width: 100%;
      aspect-ratio: 560 / 200;
      touch-action: none;
      cursor: crosshair;
      /* Ink is dark and ends up on the page: always draw on paper, whatever the theme. */
      background: var(--signora-signature-bg, var(--signora-page-bg, #fff));
      border: 1px dashed var(--signora-color-border, #d5d9e2);
      border-radius: var(--signora-radius-lg, min(var(--signora-radius, 8px), 16px));
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: calc(var(--signora-space, 8px) / 2);
      margin-top: var(--signora-space, 8px);
    }
    button {
      font: inherit;
      color: inherit;
      padding: 0.35rem 0.8rem;
      border: 1px solid var(--signora-color-border, #d5d9e2);
      border-radius: var(--signora-radius, 8px);
      background: var(--signora-color-surface, #fff);
      cursor: pointer;
    }
    button.primary {
      background: var(--signora-color-accent, #3b5bdb);
      border-color: var(--signora-color-accent, #3b5bdb);
      color: var(--signora-color-accent-contrast, #fff);
    }
    button:disabled {
      opacity: var(--signora-disabled-opacity, 0.4);
      cursor: not-allowed;
    }
    button:focus-visible {
      outline: 2px solid var(--signora-color-focus-ring, #3b5bdb);
      outline-offset: 1px;
    }
  `,
})
export class SignoraSignaturePadComponent {
  protected readonly labels = inject(SIGNORA_LABELS);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private strokes: Stroke[] = [];
  private current: { points: StrokePoint[]; pen: boolean; pointerId: number } | null = null;
  private pixelRatio = 1;

  /** Nominal pen width in logical pixels. */
  readonly penWidth = input(2.6);
  /** Emits when the user confirms the drawing. */
  readonly created = output<SignatureAsset>();

  protected readonly hasInk = signal(false);

  constructor() {
    afterNextRender(() => {
      const canvas = this.canvas().nativeElement;
      this.pixelRatio = globalThis.devicePixelRatio || 1;
      canvas.width = LOGICAL_WIDTH * this.pixelRatio;
      canvas.height = LOGICAL_HEIGHT * this.pixelRatio;
      this.redraw();
    });
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const canvas = this.canvas().nativeElement;
    capturePointer(canvas, event.pointerId);
    this.current = {
      points: [this.toPoint(event)],
      pen: event.pointerType === 'pen',
      pointerId: event.pointerId,
    };
    this.redraw();
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.current?.pointerId !== event.pointerId) return;
    // Coalesced events give smooth curves on fast strokes.
    const events = event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event];
    for (const e of events) this.current.points.push(this.toPoint(e));
    this.redraw();
  }

  protected onPointerEnd(event: PointerEvent): void {
    if (this.current?.pointerId !== event.pointerId) return;
    this.strokes.push({ points: this.current.points, pen: this.current.pen });
    this.current = null;
    this.hasInk.set(true);
    this.redraw();
  }

  protected undo(): void {
    this.strokes.pop();
    this.hasInk.set(this.strokes.length > 0);
    this.redraw();
  }

  protected clear(): void {
    this.strokes = [];
    this.current = null;
    this.hasInk.set(false);
    this.redraw();
  }

  protected use(): void {
    const color = readInkColor(this.canvas().nativeElement);
    const asset = strokesToAsset(this.strokes, color, this.penWidth());
    if (!asset) return;
    this.created.emit(asset);
    this.clear();
  }

  private toPoint(event: PointerEvent): StrokePoint {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * LOGICAL_WIDTH) / rect.width,
      y: ((event.clientY - rect.top) * LOGICAL_HEIGHT) / rect.height,
      pressure: event.pressure > 0 ? event.pressure : 0.5,
    };
  }

  private redraw(): void {
    const canvas = this.canvas().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    const all = this.current
      ? [...this.strokes, { points: this.current.points, pen: this.current.pen }]
      : this.strokes;
    drawStrokes(ctx, all, readInkColor(canvas), this.penWidth());
  }
}
