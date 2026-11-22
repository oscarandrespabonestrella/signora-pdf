// Captures the README screenshots by driving the playground like a user would.
//
// Usage:  npm start            (in another terminal)
//         node scripts/screenshots.mjs [baseUrl] [outDir]
//
// Uses an installed browser (no download): set SCREENSHOT_BROWSER to `chrome`,
// `msedge` or `chromium`. Defaults to Edge on Windows and Chrome elsewhere.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const baseUrl = process.argv[2] ?? 'http://localhost:4200';
const outDir = process.argv[3] ?? fileURLToPath(new URL('../docs/images/', import.meta.url));
const channel =
  process.env.SCREENSHOT_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chrome');

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const settle = (ms = 700) => page.waitForTimeout(ms);
const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('saved', name);
};

/** Draws a flowing stroke with the mouse on the pad, without confirming it. */
async function drawStrokeOnPad() {
  const box = await page.locator('signora-signature-pad canvas').boundingBox();
  const points = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    points.push([
      box.x + box.width * (0.08 + 0.84 * t),
      box.y + box.height * (0.55 + 0.3 * Math.sin(t * 9) * (1 - t * 0.6) - 0.2 * t),
    ]);
  }
  await page.mouse.move(...points[0]);
  await page.mouse.down();
  for (const point of points) await page.mouse.move(...point);
  await page.mouse.up();
  await settle(300);
}

/** Draws a signature and confirms it. */
async function drawSignature() {
  await drawStrokeOnPad();
  await page.getByRole('button', { name: 'Use signature' }).click();
  await settle(300);
}

async function placeAt(fx, fy) {
  const canvas = await page.locator('main signora-page canvas').boundingBox();
  await page.mouse.click(canvas.x + canvas.width * fx, canvas.y + canvas.height * fy);
  await settle(400);
}

/** Zooms out so a whole A4 page fits and clicks stay inside the visible scroll area. */
async function fitPage() {
  await page.getByRole('button', { name: 'Zoom out' }).first().click();
  await page.getByRole('button', { name: 'Zoom out' }).first().click();
  await settle(900);
}

// 1. Viewer with signatures placed ------------------------------------------------------
await page.goto(baseUrl);
await page.waitForSelector('signora-page canvas');
await settle(900);
await fitPage();
await drawSignature();
await placeAt(0.22, 0.83); // on the page's signature line
await page.getByRole('tab', { name: 'Acme Corp' }).click();
await settle(500);
await page.locator('[role=tabpanel] .asset', { hasText: 'Approved stamp' }).click();
await placeAt(0.72, 0.5);
await shot('viewer-signing');

// 2. Export preview -----------------------------------------------------------------------
await page.getByRole('button', { name: 'Preview result' }).click();
await page.waitForSelector('dialog[open] signora-page canvas');
await settle(1200);
await shot('export-preview');
await page.keyboard.press('Escape');
await settle(300);

// 3. Live theme: a dark preset (the drawing pad stays on paper so ink is visible) --------------
const themeSummary = page.locator('summary', { hasText: 'Theme' });
await themeSummary.click();
await page.locator('app-theme-panel select').first().selectOption('midnight');
await themeSummary.click();
await page.getByRole('tab', { name: 'Draw' }).click();
await settle(400);
await drawStrokeOnPad();
await shot('theme-midnight');

// ...and the editor itself, with a custom accent on top of the Rose preset.
await themeSummary.click();
await page.locator('app-theme-panel select').first().selectOption('rose');
await page.locator('app-theme-panel [data-token="color-accent"]').fill('#7c3aed');
await settle(500);
await shot('theme-editor');
await themeSummary.click();

// 4. Pages with their own rotation, viewed rotated -------------------------------------------------
await page.goto(baseUrl);
await page.waitForSelector('signora-page canvas');
await page.getByRole('button', { name: 'Mixed sizes and rotations' }).click();
await settle(900);
await fitPage();
await page.getByRole('button', { name: 'Next page' }).first().click();
await page.getByRole('button', { name: 'Next page' }).first().click();
await settle(700);
await page.getByRole('tab', { name: 'Acme Corp' }).click();
await settle(500);
await page.locator('[role=tabpanel] .asset', { hasText: 'Jane Roe' }).click();
await placeAt(0.5, 0.4);
await shot('rotated-page');

// 5. Custom templates -----------------------------------------------------------------------------------
await page.getByRole('link', { name: 'Custom templates' }).click();
await page.waitForSelector('.custom-toolbar');
await settle(900);
await shot('custom-templates');

// 6. Digital signing (simulated, clearly labelled) ----------------------------------------------------------
// Navigate inside the app so the session (and its placed signature) is kept.
await page.getByRole('link', { name: 'Viewer' }).click();
await page.waitForSelector('signora-page canvas');
await settle(700);
await page.getByRole('link', { name: 'Digital signing' }).click();
await page.waitForSelector('.banner');
await page.getByRole('button', { name: 'Run simulated signing' }).click();
await page.waitForSelector('.result');
await page.locator('.result').scrollIntoViewIfNeeded();
await settle(400);
await shot('digital-signing');

await browser.close();
