#!/usr/bin/env node
/**
 * Copies the posts you chose from the importer inboxes (content/x-inbox.json, substack-inbox.json,
 * linkedin-inbox.json) into content/posts.json (what the site ships).
 *
 *   npm run publish:posts            add/update posts marked "publish": true
 *   npm run publish:posts -- --dry   show what would change without writing
 *
 * - Only posts with "publish": true are copied. Nothing else from the archive reaches the public file.
 * - Posts already in content/posts.json are updated in place (by id); posts you added by hand are kept.
 * - A post you un-publish in the inbox (publish: false) is removed from posts.json.
 * - Posts without any theme or tone are still copied, but listed so you can tag them.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTagId, validateDataset } from '../shared/schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS = join(root, 'content', 'posts.json');
const TAXONOMY = join(root, 'content', 'taxonomy.json');
const dry = process.argv.includes('--dry');

const inboxFiles = readdirSync(join(root, 'content')).filter((f) => f.endsWith('-inbox.json'));
if (!inboxFiles.length) {
  console.error('✗ No importer inbox found in content/. Run one of the importers first (see README).');
  process.exit(1);
}
const inbox = inboxFiles.flatMap((f) => JSON.parse(readFileSync(join(root, 'content', f), 'utf8')).posts ?? []);
console.log(`Reading ${inboxFiles.join(', ')}`);
const current = existsSync(POSTS) ? JSON.parse(readFileSync(POSTS, 'utf8')) : { version: 1, posts: [] };
const currentPosts = Array.isArray(current) ? current : current.posts ?? [];

const PUBLIC_FIELDS = ['id', 'platform', 'url', 'text', 'title', 'excerpt', 'publishedAt', 'themes', 'tones', 'media', 'threadId', 'sequence'];
const pick = (p) => {
  const out = Object.fromEntries(PUBLIC_FIELDS.filter((k) => p[k] !== undefined && p[k] !== null).map((k) => [k, p[k]]));
  for (const lens of ['themes', 'tones']) out[lens] = [...new Set((p[lens] ?? []).map(normalizeTagId).filter(Boolean))];
  return out;
};

const chosen = new Map(inbox.filter((p) => p.publish === true).map((p) => [p.id, pick(p)]));
const unpublished = new Set(inbox.filter((p) => p.publish !== true).map((p) => p.id));

let added = 0, updated = 0, removed = 0;
const next = [];
for (const p of currentPosts) {
  if (chosen.has(p.id)) {
    next.push(chosen.get(p.id));
    chosen.delete(p.id);
    updated++;
  } else if (unpublished.has(p.id)) {
    removed++;
  } else {
    next.push(p); // hand-written or from another source
  }
}
for (const p of chosen.values()) {
  next.push(p);
  added++;
}
next.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));

const out = { version: 1, posts: next };
const result = validateDataset(out, existsSync(TAXONOMY) ? JSON.parse(readFileSync(TAXONOMY, 'utf8')) : null);
const noTheme = result.posts.filter((p) => !p.themes.length).length;
const noTone = result.posts.filter((p) => !p.tones.length).length;

console.log(`${added} added, ${updated} updated, ${removed} removed → ${next.length} posts in content/posts.json${dry ? ' (dry run, nothing written)' : ''}.`);
if (noTheme) console.log(`! ${noTheme} published post(s) have no theme yet.`);
if (noTone) console.log(`! ${noTone} published post(s) have no tone yet.`);
for (const w of result.warnings) console.log(`! ${w}`);
if (!result.ok) {
  result.errors.forEach((e) => console.error(`✗ ${e}`));
  process.exit(1);
}
if (!dry) writeFileSync(POSTS, JSON.stringify(out, null, 2) + '\n');
