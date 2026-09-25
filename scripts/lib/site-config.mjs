// Reads substackUrl from site.config.ts without a TypeScript toolchain.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export function siteBase() {
  const src = readFileSync(join(root, 'site.config.ts'), 'utf8');
  const m = src.match(/substackUrl:\s*'([^']*)'/);
  return (m?.[1] ?? '').replace(/\/+$/, '');
}
