#!/usr/bin/env node
// Checks content/posts.json + content/taxonomy.json (and the sample set) against the schema.
// Usage: npm run validate            (runs automatically before `npm run build`)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateDataset } from '../shared/schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(rel) {
  const file = join(root, rel);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`✗ ${rel}: ${err.code === 'ENOENT' ? 'file not found' : `invalid JSON (${err.message})`}`);
    process.exit(1);
  }
}

let failed = false;
for (const [label, postsFile, taxFile] of [
  ['your posts', 'content/posts.json', 'content/taxonomy.json'],
  ['sample posts', 'content/demo/posts.json', 'content/demo/taxonomy.json'],
]) {
  const result = validateDataset(readJson(postsFile), readJson(taxFile));
  const untaggedThemes = result.posts.filter((p) => !p.themes.length).length;
  const untaggedTones = result.posts.filter((p) => !p.tones.length).length;
  console.log(`\n${label} (${postsFile})`);
  console.log(`  ${result.posts.length} valid post(s), ${result.skipped} skipped`);
  if (result.posts.length) {
    console.log(`  ${result.taxonomy.themes.size} theme(s), ${result.taxonomy.tones.size} tone(s) in use or defined`);
    if (untaggedThemes) console.log(`  ${untaggedThemes} post(s) have no theme (they will not appear on the Themes graph)`);
    if (untaggedTones) console.log(`  ${untaggedTones} post(s) have no tone (they will not appear on the Tone graph)`);
  }
  for (const e of result.errors) console.error(`  ✗ ${e}`);
  for (const w of result.warnings) console.warn(`  ! ${w}`);
  if (!result.ok || result.skipped > 0) failed = true;
}

if (failed) {
  console.error('\nValidation failed. Fix the errors (✗) and skipped posts (!) above.');
  process.exit(1);
}
console.log('\nOK');
