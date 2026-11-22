// Copies the English reference docs from ../docs into the site, so they have one source.
// Generated files are git-ignored; the Spanish versions are hand-written in content/docs/es.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, '..', 'docs');
const out = join(root, 'src', 'content', 'docs');

const pages = {
  'viewer-options': 'guides',
  theming: 'guides',
  'digital-signing': 'guides',
  architecture: 'concepts',
  coordinates: 'concepts',
};

for (const [name, section] of Object.entries(pages)) {
  let md = readFileSync(join(docs, `${name}.md`), 'utf8').replace(/\r\n/g, '\n');
  const h1 = /^# (.+)\n+/.exec(md);
  if (!h1) throw new Error(`${name}.md has no H1`);
  md = md.slice(h1[0].length);
  // First paragraph (plain text) becomes the description.
  const first = md.split('\n\n')[0].replace(/\s*\n\s*/g, ' ').replace(/[`*_]/g, '');
  const description = first.startsWith('#') ? '' : first.slice(0, 200);
  // Sibling links such as (theming.md#x) -> site routes.
  md = md.replace(/\]\(([a-z-]+)\.md(#[^)]*)?\)/g, (m, slug, hash = '') =>
    pages[slug] ? `](../../${pages[slug]}/${slug}/${hash})` : m,
  );
  const front = `---\ntitle: ${JSON.stringify(h1[1])}\n${
    description ? `description: ${JSON.stringify(description)}\n` : ''
  }---\n\n:::note[Generated]\nThis page is generated from \`docs/${name}.md\` in the repository.\n:::\n\n`;
  const dir = join(out, section);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), front + md);
}
console.log('Synced', Object.keys(pages).length, 'docs');
