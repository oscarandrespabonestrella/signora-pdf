import { InjectionToken } from '@angular/core';
import { createId, type SignatureAsset, type SignatureKind } from 'signora-pdf';

/* ------------------------------------------------------------------ strokes */

/** A sampled point of a {@link Stroke}, in the drawing pad's logical pixels. */
export interface StrokePoint {
  readonly x: number;
  readonly y: number;
  /** 0..1. Mouse and touch report a constant value. */
  readonly pressure: number;
}

/** One continuous pen stroke of a drawn signature. */
export interface Stroke {
  readonly points: readonly StrokePoint[];
  /** Pen strokes vary their width with pressure. */
  readonly pen: boolean;
}

function strokeWidth(stroke: Stroke, base: number): number {
  if (!stroke.pen || stroke.points.length === 0) return base;
  const average = stroke.points.reduce((sum, p) => sum + p.pressure, 0) / stroke.points.length;
  return base * (0.6 + 0.8 * average);
}

/** Draws smoothed strokes (quadratic curves through midpoints). */
export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  color: string,
  baseWidth: number,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  for (const stroke of strokes) {
    const points = stroke.points;
    if (points.length === 0) continue;
    const width = strokeWidth(stroke, baseWidth);
    ctx.lineWidth = width;

    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const mid = {
        x: (points[i].x + points[i + 1].x) / 2,
        y: (points[i].y + points[i + 1].y) / 2,
      };
      ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
}

/** Bounding box of all strokes, grown by `padding`. `null` when there is nothing drawn. */
export function strokesBounds(
  strokes: readonly Stroke[],
  padding: number,
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const p of stroke.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/** Renders strokes into a tightly cropped, transparent PNG asset. */
export function strokesToAsset(
  strokes: readonly Stroke[],
  color: string,
  baseWidth: number,
  scale = 2,
): SignatureAsset | null {
  const bounds = strokesBounds(strokes, baseWidth * 1.5);
  if (!bounds) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(bounds.width * scale));
  canvas.height = Math.max(1, Math.ceil(bounds.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.translate(-bounds.x, -bounds.y);
  drawStrokes(ctx, strokes, color, baseWidth);
  return {
    id: createId('drawn'),
    kind: 'drawn',
    label: 'Drawn signature',
    dataUrl: canvas.toDataURL('image/png'),
    aspectRatio: canvas.width / canvas.height,
  };
}

/* -------------------------------------------------------------------- typed */

/** A font offered by the typed-signature tab. */
export interface SignatureFont {
  readonly label: string;
  /** CSS `font-family` value. Load web fonts yourself (e.g. `@font-face`). */
  readonly family: string;
  /** Extra CSS font properties, e.g. `italic` or `600`. */
  readonly style?: string;
}

/** Fonts offered by the "Type" tab. Provide your own list to customize it. */
export const SIGNORA_SIGNATURE_FONTS = new InjectionToken<readonly SignatureFont[]>(
  'SIGNORA_SIGNATURE_FONTS',
  {
    factory: () => [
      {
        label: 'Script',
        family: '"Segoe Script", "Brush Script MT", "Snell Roundhand", "Apple Chancery", cursive',
      },
      {
        label: 'Handwriting',
        family: '"Bradley Hand", "Lucida Handwriting", "Comic Sans MS", cursive',
      },
      { label: 'Classic', family: 'Georgia, "Times New Roman", serif', style: 'italic' },
    ],
  },
);

/** Renders text with a font into a tightly cropped, transparent PNG asset. */
export async function typedSignatureToAsset(
  text: string,
  font: SignatureFont,
  color: string,
  size = 72,
  scale = 2,
): Promise<SignatureAsset | null> {
  const value = text.trim();
  if (!value) return null;
  const css = `${font.style ?? ''} ${size}px ${font.family}`.trim();
  try {
    await document.fonts?.load(css, value);
  } catch {
    // Unknown fonts fall back to the next family in the stack.
  }

  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return null;
  measure.font = css;
  const metrics = measure.measureText(value);
  const padding = size * 0.25;
  const width = Math.ceil(metrics.width + padding * 2);
  const height = Math.ceil(size * 1.5 + padding);

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.font = css;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, padding, size * 1.1);

  return {
    id: createId('typed'),
    kind: 'typed',
    label: value,
    dataUrl: canvas.toDataURL('image/png'),
    aspectRatio: width / height,
    metadata: { font: font.label },
  };
}

/* ------------------------------------------------------------ rasterization */

/** Options of {@link rasterizeToAsset}. */
export interface RasterizeOptions {
  readonly kind?: SignatureKind;
  readonly label?: string;
  readonly id?: string;
  /** Longest side of the result in pixels. Defaults to 1200. */
  readonly maxDimension?: number;
}

/**
 * Converts any image the browser can display (PNG, JPEG, WebP, SVG, from a
 * `Blob` or URL) into a PNG asset. PDF writers can embed PNG reliably, and the
 * conversion strips metadata and caps the size.
 */
export async function rasterizeToAsset(
  source: Blob | string,
  options: RasterizeOptions = {},
): Promise<SignatureAsset> {
  const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
  const url = objectUrl ?? (source as string);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    // SVGs without intrinsic size report 0: fall back to a sensible default.
    const naturalWidth = image.naturalWidth || 300;
    const naturalHeight = image.naturalHeight || 150;
    const max = options.maxDimension ?? 1200;
    const factor = Math.min(1, max / Math.max(naturalWidth, naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(naturalWidth * factor));
    canvas.height = Math.max(1, Math.round(naturalHeight * factor));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available.');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    return {
      id: options.id ?? createId(options.kind ?? 'image'),
      kind: options.kind ?? 'image',
      label: options.label,
      dataUrl: canvas.toDataURL('image/png'),
      aspectRatio: canvas.width / canvas.height,
    };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** Reads the signature ink color from the `--signora-signature-ink` token. */
export function readInkColor(element: Element): string {
  return getComputedStyle(element).getPropertyValue('--signora-signature-ink').trim() || '#1b1f3b';
}
