// `ng build` writes the app to <output>/browser; move it to website/public/demo.
import { cpSync, existsSync, rmSync } from 'node:fs';
const from = 'website/public/demo-build/browser';
const to = 'website/public/demo';
if (!existsSync(from)) throw new Error(`${from} not found`);
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
rmSync('website/public/demo-build', { recursive: true, force: true });
