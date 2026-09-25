#!/usr/bin/env node
/**
 * Collect your LinkedIn posts for review from LinkedIn's own data export.
 * Writes content/linkedin-inbox.json (git-ignored). No login, scraping or API.
 *
 *   npm run import:linkedin -- <unzipped export folder | Shares.csv>
 *
 * Get the export on LinkedIn: Settings → Data privacy → Get a copy of your data → pick "Posts"
 * (LinkedIn names the file Shares.csv). Only Shares.csv is read; messages, connections and
 * everything else in the export are ignored. Posts marked connections-only are skipped.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, writeInbox } from './lib/inbox.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'content', 'linkedin-inbox.json');
const arg = process.argv[2];
if (!arg) {
  console.log('Usage: npm run import:linkedin -- <unzipped export folder | Shares.csv>');
  process.exit(1);
}
const p = resolve(arg);
if (!existsSync(p)) fail(`Not found: ${p}`);
if (p.endsWith('.zip')) fail('Please unzip the LinkedIn export first, then pass the folder.');
const csv = statSync(p).isDirectory() ? ['Shares.csv', 'shares.csv'].map((f) => join(p, f)).find(existsSync) : p;
if (!csv) fail(`No Shares.csv found in ${p}.`);

const rows = parseCsv(readFileSync(csv, 'utf8'));
let skipped = 0;
const posts = [];
for (const r of rows) {
  const text = (r.ShareCommentary ?? '').replace(/""/g, '"').trim();
  const url = (r.ShareLink ?? '').trim();
  const vis = (r.Visibility ?? '').trim();
  if (!url || (!text && !r.SharedUrl) || /CONNECTIONS/i.test(vis)) {
    skipped++;
    continue;
  }
  const date = new Date((r.Date ?? '').replace(' ', 'T') + (/[zZ+]/.test(r.Date ?? '') ? '' : 'Z'));
  const id = decodeURIComponent(url).match(/(\d{10,})/)?.[1] ?? Buffer.from(url).toString('base64url').slice(-16);
  posts.push({
    id: `linkedin:${id}`,
    platform: 'linkedin',
    url,
    text: text || r.SharedUrl,
    publishedAt: Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString(),
    themes: [],
    tones: [],
    sourceVisibility: vis || undefined,
    publish: false,
  });
}

const merged = writeInbox(OUT, 'LinkedIn', posts);
console.log(`Collected ${merged.length} LinkedIn post(s) into content/linkedin-inbox.json (private, for review).${skipped ? ` Skipped ${skipped} empty or connections-only row(s).` : ''}`);
console.log('Nothing was added to the site.');

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
