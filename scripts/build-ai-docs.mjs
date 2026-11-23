// Builds llms.txt and llms-full.txt from projects/signora-pdf/AGENTS.md, and checks that the guide
// mentions every public viewer input/output, session member and provider function.
//   node scripts/build-ai-docs.mjs          write the files
//   node scripts/build-ai-docs.mjs --check  fail if the guide is incomplete or the files are stale
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const lib = join(root, 'projects', 'signora-pdf');
const guide = readFileSync(join(lib, 'AGENTS.md'), 'utf8').replaceAll('\r\n', '\n');
const REPO = 'https://github.com/oscarandrespabonestrella/signora-pdf';
const RAW = `${REPO}/blob/main`;

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return /\.ts$/.test(name) && !/\.(spec|testing)\.ts$/.test(name) ? [path] : [];
  });
}
const read = (file) => readFileSync(file, 'utf8');

const required = new Set();
const viewer = read(join(lib, 'ui/src/viewer.component.ts'));
for (const m of viewer.matchAll(/readonly (\w+) = (?:input|output)/g)) required.add(m[1]);

const session = read(join(lib, 'src/lib/session/signing-session.ts'));
for (const m of session.matchAll(/^  (?:async )?([a-z]\w*)\(.*\{$/gm)) required.add(m[1]);
for (const m of session.matchAll(/^  readonly (\w+) = /gm)) required.add(m[1]);

for (const file of sources(lib)) {
  for (const m of read(file).matchAll(/^export function ((?:with|provide)[A-Z]\w*)\(/gm)) {
    required.add(m[1]);
  }
}
required.delete('constructor');

const missing = [...required].filter((name) => !guide.includes(name));

const full = `${guide.trimEnd()}\n`;
const index = `# signora-pdf

> Angular SDK to view PDFs, place visual signatures and, through your backend, add digital signatures. Standalone components and signals; the core has no dependency on PDF.js or pdf-lib.

Start with the complete guide: it fits in a single read and lists every input, output and method.

- [Complete guide for LLMs and agents](${RAW}/llms-full.txt): setup, API reference, recipes, gotchas
- [Viewer options](${RAW}/docs/viewer-options.md): view mode, signature modes, preloading, read-only, coordinates
- [Coordinates](${RAW}/docs/coordinates.md): normalized model, PDF points, rotation
- [Digital signing](${RAW}/docs/digital-signing.md): workflow and the HTTP contract for your backend
- [Theming](${RAW}/docs/theming.md): design tokens, slots, labels
- [Architecture](${RAW}/docs/architecture.md): ports and adapters

## Optional

- [README](${RAW}/README.md)
- [Changelog](${RAW}/CHANGELOG.md)
`;

if (process.argv.includes('--copy')) {
  // After `ng build`: ship the guide inside the npm package (node_modules/signora-pdf/AGENTS.md).
  const dist = join(root, 'dist', 'signora-pdf');
  if (!existsSync(dist)) {
    console.error('dist/signora-pdf not found: build the library first.');
    process.exit(1);
  }
  writeFileSync(join(dist, 'AGENTS.md'), full);
  copyFileSync(join(root, 'LICENSE'), join(dist, 'LICENSE')); // MIT requires shipping the license
  console.log('Copied AGENTS.md and LICENSE into dist/signora-pdf');
  process.exit(0);
}

if (process.argv.includes('--check')) {
  let failed = false;
  if (missing.length) {
    console.error(`AGENTS.md does not mention: ${missing.join(', ')}`);
    failed = true;
  }
  for (const [file, content] of [
    ['llms-full.txt', full],
    ['llms.txt', index],
  ]) {
    let current = '';
    try {
      current = read(join(root, file));
    } catch {}
    if (current.replace(/\r\n/g, '\n') !== content) {
      console.error(`${file} is stale: run "npm run docs:ai"`);
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}

writeFileSync(join(root, 'llms-full.txt'), full);
writeFileSync(join(root, 'llms.txt'), index);
if (missing.length) {
  console.warn(`Warning: AGENTS.md does not mention: ${missing.join(', ')}`);
  process.exitCode = 1;
}
console.log('Wrote llms.txt and llms-full.txt');
