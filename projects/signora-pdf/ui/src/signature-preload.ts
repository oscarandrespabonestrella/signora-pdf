import { createId, type SignatureAsset } from 'signora-pdf';
import { rasterizeToAsset, typedSignatureToAsset, type SignatureFont } from './signature-render';

/** A signature to render from text, with one of the configured fonts. */
export interface PreloadedTypedSignature {
  /** The text to render, e.g. a person's name. */
  readonly text: string;
  /** Font: a `SignatureFont`, or the `label` of one of the configured fonts. First one by default. */
  readonly font?: SignatureFont | string;
  readonly label?: string;
  readonly id?: string;
}

/** A signature from an image (PNG, JPEG, WebP, SVG; as a URL, `data:` URL or `Blob`). */
export interface PreloadedImageSignature {
  readonly image: string | Blob;
  readonly label?: string;
  readonly id?: string;
}

/** Anything that can be preloaded: a ready asset, a text to render, or an image. */
export type PreloadedSignature = SignatureAsset | PreloadedTypedSignature | PreloadedImageSignature;

/** Options of {@link resolvePreloadedSignatures}. */
export interface ResolvePreloadedOptions {
  /** Fonts available to text signatures. */
  readonly fonts: readonly SignatureFont[];
  /** Ink color for text signatures. */
  readonly color: string;
}

/**
 * Turns a mixed list of ready assets, texts and images into assets. Items that fail
 * (unreadable image, empty text) are skipped and reported to `onError`. Order is kept.
 */
export async function resolvePreloadedSignatures(
  items: readonly PreloadedSignature[],
  options: ResolvePreloadedOptions,
  onError: (item: PreloadedSignature, error: unknown) => void = () => undefined,
): Promise<SignatureAsset[]> {
  const resolved = await Promise.all(
    items.map(async (item): Promise<SignatureAsset | null> => {
      try {
        if ('dataUrl' in item) return item;
        if ('image' in item) {
          return await rasterizeToAsset(item.image, {
            id: item.id,
            label: item.label,
            kind: 'image',
          });
        }
        const font = resolveFont(item.font, options.fonts);
        const asset = await typedSignatureToAsset(item.text, font, options.color);
        if (!asset) throw new Error('Empty text.');
        return {
          ...asset,
          id: item.id ?? createId('typed'),
          ...(item.label === undefined ? {} : { label: item.label }),
        };
      } catch (error) {
        onError(item, error);
        return null;
      }
    }),
  );
  return resolved.filter((asset): asset is SignatureAsset => asset !== null);
}

function resolveFont(font: PreloadedTypedSignature['font'], fonts: readonly SignatureFont[]) {
  if (typeof font === 'object') return font;
  const found = font ? fonts.find((f) => f.label === font) : undefined;
  return found ?? fonts[0] ?? { label: 'Default', family: 'cursive' };
}
