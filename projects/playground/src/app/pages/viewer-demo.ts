import { Component, computed, inject, signal } from '@angular/core';
import { SigningSession, type PdfSource, type SignatureCoordinates } from 'signora-pdf';
import {
  ALL_SIGNATURE_MODES,
  SignoraThemeDirective,
  SignoraViewerComponent,
  type PreloadedSignature,
  type SignatureMode,
  type SignoraThemeTokens,
  type ViewMode,
} from 'signora-pdf/ui';
import { ExportPreview } from './export-preview';
import { ThemePanel } from './theme-panel';

interface SampleDocument {
  readonly label: string;
  readonly url: string;
}

@Component({
  selector: 'app-viewer-demo',
  imports: [SignoraViewerComponent, SignoraThemeDirective, ExportPreview, ThemePanel],
  templateUrl: './viewer-demo.html',
  styleUrl: './viewer-demo.css',
})
export class ViewerDemo {
  protected readonly session = inject(SigningSession);

  protected readonly samples: readonly SampleDocument[] = [
    { label: 'Contract (3 pages)', url: 'samples/contract.pdf' },
    { label: 'Mixed sizes and rotations', url: 'samples/mixed-pages.pdf' },
  ];

  protected readonly source = signal<PdfSource | null>('samples/contract.pdf');

  protected readonly viewMode = signal<ViewMode>('paged');
  protected readonly modeOptions = ALL_SIGNATURE_MODES;
  protected readonly modes = signal<readonly SignatureMode[]>(ALL_SIGNATURE_MODES);
  /** Typed signatures rendered on load: two people, available to place right away. */
  protected readonly preloaded: readonly PreloadedSignature[] = [
    { text: 'Ada Lovelace', label: 'Ada (typed)' },
    { text: 'Grace Hopper', font: 'Classic', label: 'Grace (typed)' },
  ];
  protected readonly readOnly = signal(false);
  protected readonly coordinates = signal<readonly SignatureCoordinates[] | null>(null);
  protected readonly coordinatesJson = computed(() => JSON.stringify(this.coordinates(), null, 2));

  protected toggleMode(mode: SignatureMode, enabled: boolean): void {
    this.modes.update((all) =>
      enabled
        ? ALL_SIGNATURE_MODES.filter((m) => m === mode || all.includes(m))
        : all.filter((m) => m !== mode),
    );
  }

  protected async showCoordinates(): Promise<void> {
    this.exportError.set(null);
    try {
      this.coordinates.set(await this.session.exportCoordinates());
    } catch (error) {
      this.exportError.set(error instanceof Error ? error.message : 'Could not read coordinates.');
    }
  }
  protected readonly fileName = signal('contract.pdf');
  protected readonly dragging = signal(false);
  protected readonly uploadError = signal<string | null>(null);
  protected readonly theme = signal<SignoraThemeTokens>({});

  protected readonly exporting = signal(false);
  protected readonly exportError = signal<string | null>(null);
  protected readonly previewBytes = signal<Uint8Array | null>(null);
  protected readonly canExport = computed(
    () => this.session.placements().length > 0 && !this.exporting(),
  );

  protected openSample(sample: SampleDocument): void {
    this.uploadError.set(null);
    this.fileName.set(sample.url.split('/').pop() ?? sample.label);
    this.source.set(sample.url);
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.openFile(input.files?.item(0));
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.openFile(event.dataTransfer?.files.item(0));
  }

  protected async preview(): Promise<void> {
    const bytes = await this.runExport();
    if (bytes) this.previewBytes.set(bytes);
  }

  protected async download(): Promise<void> {
    const bytes = await this.runExport();
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.fileName().replace(/\.pdf$/i, '')}-with-signatures.pdf`;
    link.click();
    // Give the browser time to start the download before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  private async runExport(): Promise<Uint8Array | null> {
    this.exporting.set(true);
    this.exportError.set(null);
    try {
      return await this.session.exportPdf();
    } catch (error) {
      this.exportError.set(error instanceof Error ? error.message : 'The export failed.');
      return null;
    } finally {
      this.exporting.set(false);
    }
  }

  private openFile(file: File | null | undefined): void {
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      this.uploadError.set(`"${file.name}" is not a PDF file.`);
      return;
    }
    this.uploadError.set(null);
    this.fileName.set(file.name);
    this.source.set(file);
  }
}
