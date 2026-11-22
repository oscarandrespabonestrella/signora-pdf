// Generates the sample PDFs used by the playground and the tests.
// Usage: node scripts/generate-samples.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const OUT_DIR = new URL('../projects/playground/public/samples/', import.meta.url);

async function addMarkedPage(doc, font, { width, height, title, rotate }) {
  const page = doc.addPage([width, height]);
  const ink = rgb(0.12, 0.14, 0.19);

  page.drawRectangle({
    x: 20,
    y: 20,
    width: width - 40,
    height: height - 40,
    borderColor: rgb(0.23, 0.36, 0.86),
    borderWidth: 2,
  });
  page.drawText(title, { x: 48, y: height - 80, size: 26, font, color: ink });
  page.drawText('TOP-LEFT of the page as the author intended', {
    x: 48,
    y: height - 110,
    size: 12,
    font,
    color: rgb(0.36, 0.4, 0.46),
  });
  page.drawText(`${width} x ${height} pt${rotate ? `, /Rotate ${rotate}` : ''}`, {
    x: 48,
    y: height - 130,
    size: 12,
    font,
    color: rgb(0.36, 0.4, 0.46),
  });

  // Signature line near the bottom, where a signature is expected.
  page.drawLine({
    start: { x: 48, y: 110 },
    end: { x: 260, y: 110 },
    thickness: 1,
    color: ink,
  });
  page.drawText('Signature', { x: 48, y: 94, size: 10, font, color: ink });

  // A faint grid helps to verify positions after zoom and rotation.
  for (let x = 100; x < width - 20; x += 100) {
    page.drawLine({
      start: { x, y: 20 },
      end: { x, y: height - 20 },
      thickness: 0.3,
      color: rgb(0.85, 0.87, 0.91),
    });
  }
  for (let y = 100; y < height - 20; y += 100) {
    page.drawLine({
      start: { x: 20, y },
      end: { x: width - 20, y },
      thickness: 0.3,
      color: rgb(0.85, 0.87, 0.91),
    });
  }

  if (rotate) page.setRotation(degrees(rotate));
}

async function createDocument(title, pages) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer('Signora PDF sample generator');
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of pages) await addMarkedPage(doc, font, page);
  return doc.save();
}

await mkdir(OUT_DIR, { recursive: true });

await writeFile(
  new URL('contract.pdf', OUT_DIR),
  await createDocument('Sample contract', [
    { width: 595, height: 842, title: 'Service agreement - page 1' },
    { width: 595, height: 842, title: 'Service agreement - page 2' },
    { width: 595, height: 842, title: 'Service agreement - page 3' },
  ]),
);

await writeFile(
  new URL('mixed-pages.pdf', OUT_DIR),
  await createDocument('Mixed page sizes and rotations', [
    { width: 595, height: 842, title: 'A4 portrait' },
    { width: 792, height: 612, title: 'Letter landscape' },
    { width: 595, height: 842, title: 'A4 with /Rotate 90', rotate: 90 },
    { width: 612, height: 792, title: 'Letter with /Rotate 180', rotate: 180 },
    { width: 595, height: 842, title: 'A4 with /Rotate 270', rotate: 270 },
  ]),
);

console.log('Samples written to', OUT_DIR.pathname);
