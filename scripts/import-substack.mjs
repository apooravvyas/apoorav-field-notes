#!/usr/bin/env node
/**
 * Collect PUBLIC Substack posts for review. Writes content/substack-inbox.json (git-ignored).
 *
 *   npm run import:substack -- <export folder>          Substack export (Settings → Exports), unzipped
 *   npm run import:substack -- <feed.xml>               a saved copy of https://<name>.substack.com/feed
 *   npm run import:substack -- https://<name>.substack.com   fetch the public RSS feed (run on your own machine)
 *
 * From an export, only posts that are published AND free for everyone are kept; paid-only posts,
 * drafts and subscriber lists are ignored. The RSS feed only ever contains public posts
 * (usually the most recent ~20). No login, cookies or API keys are used.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteBase } from './lib/site-config.mjs';
import { decodeEntities, firstParagraphs, htmlToText, parseCsv, writeInbox } from './lib/inbox.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'content', 'substack-inbox.json');
const arg = process.argv[2];
if (!arg) {
  console.log('Usage: npm run import:substack -- <export folder | feed.xml | https://name.substack.com>');
  process.exit(1);
}

let posts;
if (/^https?:\/\//.test(arg)) {
  const base = arg.replace(/\/+$/, '').replace(/\/feed$/, '');
  const res = await fetch(`${base}/feed`, { headers: { 'user-agent': 'content-graph-importer (personal archive)' } });
  if (!res.ok) fail(`The feed returned HTTP ${res.status}. Try again later, or use a Substack export instead.`);
  posts = fromRss(await res.text(), base);
} else {
  const p = resolve(arg);
  if (!existsSync(p)) fail(`Not found: ${p}`);
  if (p.endsWith('.zip')) fail('Please unzip the Substack export first, then pass the folder.');
  posts = statSync(p).isDirectory() ? fromExport(p) : fromRss(readFileSync(p, 'utf8'), siteBase());
}

const merged = writeInbox(OUT, 'Substack', posts);
console.log(`Collected ${merged.length} public Substack post(s) into content/substack-inbox.json (private, for review).`);
console.log('Nothing was added to the site. Tag the ones you want, set "publish": true, then run `npm run publish:posts`.');

// ---------------------------------------------------------------- RSS
function fromRss(xml, base) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  if (!items.length) fail('No <item> entries found. Is this a Substack RSS feed?');
  const tag = (s, name) => {
    const m = s.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`));
    if (!m) return '';
    return m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim();
  };
  return items.map((it) => {
    const link = decodeEntities(tag(it, 'link'));
    const slug = (link.match(/\/p\/([^/?#]+)/) ?? [])[1] ?? link;
    const subtitle = htmlToText(tag(it, 'description'));
    const body = htmlToText(tag(it, 'content:encoded'));
    return post({
      slug,
      url: link || `${base}/p/${slug}`,
      title: decodeEntities(tag(it, 'title')),
      subtitle,
      text: firstParagraphs(body || subtitle),
      date: tag(it, 'pubDate'),
    });
  });
}

// ---------------------------------------------------------------- export
function fromExport(dir) {
  const csvPath = ['posts.csv'].map((f) => join(dir, f)).find(existsSync);
  if (!csvPath) fail(`No posts.csv in ${dir}. Pass the unzipped Substack export folder.`);
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  const postsDir = join(dir, 'posts');
  const htmlFiles = existsSync(postsDir) ? readdirSync(postsDir) : [];
  const base = siteBase();
  let skipped = 0;
  const out = [];
  for (const r of rows) {
    const published = String(r.is_published ?? '').toLowerCase() === 'true';
    const audience = String(r.audience ?? 'everyone').toLowerCase();
    if (!published || (audience && audience !== 'everyone')) {
      skipped++;
      continue;
    }
    const postId = r.post_id ?? '';
    const slug = postId.includes('.') ? postId.slice(postId.indexOf('.') + 1) : postId;
    const file = htmlFiles.find((f) => f === `${postId}.html`);
    const body = file ? htmlToText(readFileSync(join(postsDir, file), 'utf8')) : '';
    out.push(
      post({
        slug,
        url: `${base}/p/${slug}`,
        title: r.title ?? '',
        subtitle: r.subtitle ?? '',
        text: firstParagraphs(body || r.subtitle || ''),
        date: r.post_date,
      }),
    );
  }
  if (skipped) console.log(`Skipped ${skipped} draft or paid-only post(s).`);
  return out.filter(Boolean);
}

function post({ slug, url, title, subtitle, text, date }) {
  const publishedAt = new Date(date);
  return {
    id: `substack:${slug}`,
    platform: 'substack',
    url,
    title: title || undefined,
    excerpt: subtitle || undefined,
    text: text || subtitle || title,
    publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date(0).toISOString() : publishedAt.toISOString(),
    themes: [],
    tones: [],
    publish: false,
  };
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
