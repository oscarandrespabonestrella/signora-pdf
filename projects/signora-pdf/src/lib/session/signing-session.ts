import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { normalizeRotation } from '../coordinates';
import {
  placementToCoordinates,
  type CoordinatesExportOptions,
  type SignatureCoordinates,
} from '../signatures/coordinates-export';
import { MissingSignatureFieldsError, fitRectInField } from '../signatures/fields';
import { createId } from '../signatures/placement';
import type {
  PageInfo,
  PdfSource,
  PlacedSignature,
  Rotation,
  SignatureAsset,
  SignatureField,
  ViewportOptions,
} from '../models';
import type { PdfDocumentHandle } from '../ports';
import { SIGNORA_RENDERER, SIGNORA_WRITER } from '../tokens';

/** CSS pixels per PDF point at 100% zoom (96 dpi / 72 pt per inch). */
export const CSS_UNITS = 96 / 72;
/** Smallest zoom factor (0.25 = 25%). */
export const MIN_ZOOM = 0.25;
/** Largest zoom factor (4 = 400%). */
export const MAX_ZOOM = 4;
/** Factor applied by `zoomIn()`; `zoomOut()` divides by it. */
export const ZOOM_STEP = 1.25;

/** Loading state of a {@link SigningSession}. */
export type SessionStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Options of {@link SigningSession.exportPdf}. */
export interface ExportPdfOptions {
  /** Reject with {@link MissingSignatureFieldsError} while a required field is empty. */
  readonly requireAllFields?: boolean;
  /**
   * Also create the session's fields that are not in the document yet (`inDocument` not set) as
   * empty PDF signature fields, so a backend can sign into them by `pdfName`. Needs a writer that
   * implements `writeSignatureFields` (the pdf-lib one does). Default `false`.
   */
  readonly createFields?: boolean;
}

/**
 * Headless state of one signing workflow: the loaded document, what is being
 * viewed and which signatures were placed. It has no DOM or engine
 * dependencies, so custom UIs can be built on top of it.
 *
 * Provided by `provideSignora()`. To get an independent session (for example
 * two viewers on the same page) add `providers: [SigningSession]` to the
 * component that hosts the viewer.
 *
 * Conventions: `currentPage` is 1-based (it is shown to users), while page
 * indexes in models and ports (`pageIndex`) are 0-based.
 */
@Injectable()
export class SigningSession {
  private readonly renderer = inject(SIGNORA_RENDERER);
  private readonly writer = inject(SIGNORA_WRITER, { optional: true });
  private loadToken = 0;

  private readonly _document = signal<PdfDocumentHandle | null>(null);
  private readonly _status = signal<SessionStatus>('idle');
  private readonly _error = signal<unknown>(null);
  private readonly _currentPage = signal(1);
  private readonly _zoom = signal(1);
  private readonly _rotation = signal<Rotation>(0);
  private readonly _placements = signal<readonly PlacedSignature[]>([]);
  private readonly _assets = signal<readonly SignatureAsset[]>([]);
  private readonly _armedAsset = signal<SignatureAsset | null>(null);
  private readonly _selectedPlacementId = signal<string | null>(null);
  private readonly _fields = signal<readonly SignatureField[]>([]);
  private readonly _selectedFieldId = signal<string | null>(null);
  private readonly _addingField = signal(false);

  readonly document = this._document.asReadonly();
  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();
  /** 1-based number of the page being viewed. */
  readonly currentPage = this._currentPage.asReadonly();
  /** Zoom factor where 1 means 100%. */
  readonly zoom = this._zoom.asReadonly();
  /** Viewer rotation, on top of each page's intrinsic rotation. */
  readonly rotation = this._rotation.asReadonly();
  readonly placements = this._placements.asReadonly();
  /** Signatures available to place (created, uploaded or provided by the organization). */
  readonly assets = this._assets.asReadonly();
  /** Asset waiting to be placed with the next click on a page. */
  readonly armedAsset = this._armedAsset.asReadonly();
  readonly selectedPlacementId = this._selectedPlacementId.asReadonly();
  /** Signature fields of the document (reserved areas that get filled with a signature). */
  readonly fields = this._fields.asReadonly();
  /** Field chosen to receive the next signature that is created or picked. */
  readonly selectedFieldId = this._selectedFieldId.asReadonly();
  readonly selectedField = computed(
    () => this._fields().find((f) => f.id === this._selectedFieldId()) ?? null,
  );
  /** `true` while the next click on a page creates a field (edit mode). */
  readonly addingField = this._addingField.asReadonly();
  /** Ids of the fields that already hold a signature. */
  readonly filledFieldIds = computed(
    () => new Set(this._placements().flatMap((p) => (p.fieldId ? [p.fieldId] : []))),
  );
  /** Required fields that are still empty. */
  readonly missingRequiredFields = computed(() =>
    this._fields().filter((f) => f.required && !this.filledFieldIds().has(f.id)),
  );
  readonly selectedPlacement = computed(
    () => this._placements().find((p) => p.id === this._selectedPlacementId()) ?? null,
  );

  readonly pageCount = computed(() => this._document()?.pageCount ?? 0);
  readonly hasDocument = computed(() => this._document() !== null);
  /** CSS pixels per PDF point for the current zoom. */
  readonly scale = computed(() => this._zoom() * CSS_UNITS);
  readonly viewport = computed<ViewportOptions>(() => ({
    scale: this.scale(),
    rotation: this._rotation(),
  }));
  readonly canGoPrevious = computed(() => this._currentPage() > 1);
  readonly canGoNext = computed(() => this._currentPage() < this.pageCount());
  readonly canZoomIn = computed(() => this._zoom() < MAX_ZOOM);
  readonly canZoomOut = computed(() => this._zoom() > MIN_ZOOM);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.loadToken++;
      void this._document()?.destroy();
    });
  }

  /** Loads a document, replacing (and releasing) the current one. */
  async load(source: PdfSource): Promise<void> {
    const token = ++this.loadToken;
    this._status.set('loading');
    this._error.set(null);
    try {
      const handle = await this.renderer.load(source);
      if (token !== this.loadToken) {
        await handle.destroy();
        return;
      }
      const previous = this._document();
      this._document.set(handle);
      this._currentPage.set(1);
      this._rotation.set(0);
      this.resetPlacementState();
      this._status.set('ready');
      await previous?.destroy();
    } catch (error) {
      if (token !== this.loadToken) return;
      this._error.set(error);
      this._status.set('error');
    }
  }

  /** Closes the current document and resets the view. */
  async close(): Promise<void> {
    this.loadToken++;
    const previous = this._document();
    this._document.set(null);
    this._status.set('idle');
    this._error.set(null);
    this._currentPage.set(1);
    this._rotation.set(0);
    this.resetPlacementState();
    await previous?.destroy();
  }

  /** Goes to a 1-based page number, clamped to the document. */
  goToPage(page: number): void {
    const count = this.pageCount();
    if (count === 0 || !Number.isFinite(page)) return;
    this._currentPage.set(Math.min(Math.max(Math.round(page), 1), count));
  }

  nextPage(): void {
    this.goToPage(this._currentPage() + 1);
  }

  previousPage(): void {
    this.goToPage(this._currentPage() - 1);
  }

  setZoom(zoom: number): void {
    if (!Number.isFinite(zoom)) return;
    const clamped = Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
    this._zoom.set(Math.round(clamped * 1000) / 1000);
  }

  zoomIn(): void {
    this.setZoom(this._zoom() * ZOOM_STEP);
  }

  zoomOut(): void {
    this.setZoom(this._zoom() / ZOOM_STEP);
  }

  setRotation(rotation: number): void {
    this._rotation.set(normalizeRotation(rotation));
  }

  rotateClockwise(): void {
    this.setRotation(this._rotation() + 90);
  }

  rotateCounterClockwise(): void {
    this.setRotation(this._rotation() - 90);
  }

  addPlacement(placement: PlacedSignature): void {
    this._placements.update((list) => [...list, placement]);
  }

  updatePlacement(id: string, patch: Partial<Omit<PlacedSignature, 'id'>>): void {
    this._placements.update((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  removePlacement(id: string): void {
    this._placements.update((list) => list.filter((p) => p.id !== id));
    if (this._selectedPlacementId() === id) this._selectedPlacementId.set(null);
  }

  clearPlacements(): void {
    this._placements.set([]);
    this._selectedPlacementId.set(null);
  }

  selectPlacement(id: string | null): void {
    this._selectedPlacementId.set(id);
  }

  /* ------------------------------------------------------------ fields */

  /**
   * Replaces all fields (for example with the ones your backend defines). Signatures keep
   * their field when its id is still present; those of removed fields are dropped.
   */
  setFields(fields: readonly SignatureField[]): void {
    const ids = new Set(fields.map((f) => f.id));
    this._fields.set(fields);
    this._placements.update((list) =>
      list.filter((p) => p.fieldId === undefined || ids.has(p.fieldId)),
    );
    this.dropStaleSelections();
  }

  addField(field: SignatureField): void {
    this._fields.update((list) => (list.some((f) => f.id === field.id) ? list : [...list, field]));
  }

  /** Changes a field. A signature that fills it is fitted again inside the new area. */
  updateField(id: string, patch: Partial<Omit<SignatureField, 'id'>>): void {
    const current = this._fields().find((f) => f.id === id);
    if (!current) return;
    const next: SignatureField = { ...current, ...patch, id };
    this._fields.update((list) => list.map((f) => (f.id === id ? next : f)));
    const placed = this._placements().find((p) => p.fieldId === id);
    if (placed && (patch.rect || patch.pageIndex !== undefined)) void this.refit(placed, next);
  }

  /** Removes a field and the signature that fills it. */
  removeField(id: string): void {
    this._fields.update((list) => list.filter((f) => f.id !== id));
    this._placements.update((list) => list.filter((p) => p.fieldId !== id));
    this.dropStaleSelections();
  }

  clearFields(): void {
    this.setFields([]);
  }

  /** Chooses the field that receives the next signature created or picked (`null` to unset). */
  selectField(id: string | null): void {
    this._selectedFieldId.set(id);
    if (id) {
      this._armedAsset.set(null);
      this._selectedPlacementId.set(null);
    }
  }

  /** In edit mode, makes the next click on a page create a field. */
  armFieldCreation(on: boolean): void {
    this._addingField.set(on);
    if (on) {
      this._armedAsset.set(null);
      this._selectedFieldId.set(null);
    }
  }

  /**
   * Fills a field with a signature: it is fitted (never cropped or stretched) and centred inside
   * the field, and replaces any signature already there. Resolves to the placement.
   */
  async fillField(fieldId: string, asset: SignatureAsset): Promise<PlacedSignature | null> {
    const document = this._document();
    const field = this._fields().find((f) => f.id === fieldId);
    if (!document || !field) return null;
    const page = await document.getPageInfo(field.pageIndex);
    // The field may have changed or gone while the page info was loading.
    const current = this._fields().find((f) => f.id === fieldId);
    if (!current || this._document() !== document) return null;
    this.addAsset(asset);
    const placement: PlacedSignature = {
      id: createId('placement'),
      asset,
      pageIndex: current.pageIndex,
      rect: fitRectInField(current.rect, asset, page),
      fieldId,
    };
    this._placements.update((list) => [...list.filter((p) => p.fieldId !== fieldId), placement]);
    this._armedAsset.set(null);
    if (this._selectedFieldId() === fieldId) this._selectedFieldId.set(null);
    return placement;
  }

  /** Empties a field, keeping the field. */
  clearField(fieldId: string): void {
    this._placements.update((list) => list.filter((p) => p.fieldId !== fieldId));
  }

  /** Whether every required field is filled, and which ones are not. */
  validate(): { readonly valid: boolean; readonly missing: readonly SignatureField[] } {
    const missing = this.missingRequiredFields();
    return { valid: missing.length === 0, missing };
  }

  private async refit(placement: PlacedSignature, field: SignatureField): Promise<void> {
    const document = this._document();
    if (!document) return;
    const page = await document.getPageInfo(field.pageIndex);
    const rect = fitRectInField(field.rect, placement.asset, page);
    this._placements.update((list) =>
      list.map((p) => (p.id === placement.id ? { ...p, pageIndex: field.pageIndex, rect } : p)),
    );
  }

  private dropStaleSelections(): void {
    const selected = this._selectedFieldId();
    if (selected && !this._fields().some((f) => f.id === selected)) this._selectedFieldId.set(null);
    const placement = this._selectedPlacementId();
    if (placement && !this._placements().some((p) => p.id === placement)) {
      this._selectedPlacementId.set(null);
    }
  }

  /** Adds an asset to the library (ignored if an asset with the same id exists). */
  addAsset(asset: SignatureAsset): void {
    this._assets.update((list) => (list.some((a) => a.id === asset.id) ? list : [...list, asset]));
  }

  /** Adds several assets at once (preloading). Assets whose id already exists are ignored. */
  addAssets(assets: readonly SignatureAsset[]): void {
    this._assets.update((list) => {
      const known = new Set(list.map((a) => a.id));
      const fresh = assets.filter((a) => !known.has(a.id) && known.add(a.id));
      return fresh.length === 0 ? list : [...list, ...fresh];
    });
  }

  /** Removes an asset from the library. Placements already using it are kept. */
  removeAsset(id: string): void {
    this._assets.update((list) => list.filter((a) => a.id !== id));
    if (this._armedAsset()?.id === id) this._armedAsset.set(null);
  }

  /** Arms an asset so the next click on a page places it. Pass `null` to cancel. */
  arm(asset: SignatureAsset | null): void {
    const field = asset ? this._selectedFieldId() : null;
    if (asset && field) {
      // A field is waiting for a signature: use it instead of arming for free placement.
      void this.fillField(field, asset);
      return;
    }
    if (asset) {
      this.addAsset(asset);
      this._selectedPlacementId.set(null);
      this._addingField.set(false);
    }
    this._armedAsset.set(asset);
  }

  /**
   * Produces a new PDF with every placed signature embedded (visual only: this
   * is not a digital signature). The loaded document is not modified.
   * Rejects if no writer was registered (`withPdfLibWriter()` / `withWriter()`).
   */
  async exportPdf(options: ExportPdfOptions = {}): Promise<Uint8Array> {
    const document = this._document();
    if (!document) throw new Error('SigningSession.exportPdf(): no document is loaded.');
    if (options.requireAllFields) {
      const missing = this.missingRequiredFields();
      if (missing.length > 0) throw new MissingSignatureFieldsError(missing);
    }
    if (!this.writer) {
      throw new Error(
        'SigningSession.exportPdf(): no PDF writer is registered. Add withPdfLibWriter() to provideSignora().',
      );
    }
    let bytes = await document.getData();
    const placements = this._placements();
    if (options.createFields) {
      const fresh = this._fields().filter((field) => !field.inDocument);
      if (fresh.length > 0) {
        if (!this.writer.writeSignatureFields) {
          throw new Error(
            'SigningSession.exportPdf(): the registered writer cannot create signature fields (writeSignatureFields).',
          );
        }
        bytes = await this.writer.writeSignatureFields(bytes, fresh);
        if (placements.length === 0) return bytes;
      }
    }
    return this.writer.applyVisualSignatures(bytes, placements);
  }

  /**
   * Where every placed signature goes, as normalized and PDF-point boxes, so a backend can
   * stamp the PDF itself. Needs no writer. Images are left out unless `includeImages` is set.
   */
  async exportCoordinates(options: CoordinatesExportOptions = {}): Promise<SignatureCoordinates[]> {
    const document = this._document();
    if (!document) throw new Error('SigningSession.exportCoordinates(): no document is loaded.');
    const placements = this._placements();
    const pages = new Map<number, Promise<PageInfo>>();
    const pageOf = (index: number): Promise<PageInfo> => {
      let info = pages.get(index);
      if (!info) pages.set(index, (info = document.getPageInfo(index)));
      return info;
    };
    return Promise.all(
      placements.map(async (p) => placementToCoordinates(p, await pageOf(p.pageIndex), options)),
    );
  }

  /** The signature library survives across documents; everything tied to a document does not. */
  private resetPlacementState(): void {
    this._placements.set([]);
    this._selectedPlacementId.set(null);
    this._armedAsset.set(null);
    this._fields.set([]);
    this._selectedFieldId.set(null);
    this._addingField.set(false);
  }
}
