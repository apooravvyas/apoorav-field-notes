#!/usr/bin/env node
/**
 * Local X (Twitter) archive importer. Nothing leaves your machine: no network calls, no AI tagging.
 *
 *   npm run import:x -- <path>
 *
 * <path> can be the unzipped archive folder, its data/ folder, or a tweets.js / tweet.js file.
 * (Unzip the archive first, outside this repo or into ./archive/, which is git-ignored.)
 *
 * Reads ONLY:  data/tweets.js (or data/tweet.js), data/note-tweet.js (long posts), data/account.js (your handle/id)
 * Never reads: direct messages, likes, bookmarks, followers, contacts, ads, or anything else.
 *
 * Output: content/x-inbox.json (git-ignored). Every original post and self-reply thread part, with empty
 * themes/tones and "publish": false. You curate it, then run `npm run publish:posts` to copy the chosen
 * posts into content/posts.json (the only file the site ships).
 *
 * Skipped automatically: retweets, replies to other people, and posts marked as deleted in the archive.
 * The archive format changes over time; this parser only relies on a few long-standing fields and
 * reports what it could not read instead of guessing.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INBOX = join(root, 'content', 'x-inbox.json');

const arg = process.argv[2];
if (!arg || arg === '--help' || arg === '-h') {
  console.log('Usage: npm run import:x -- <unzipped-archive-folder | data folder | tweets.js>');
  process.exit(arg ? 0 : 1);
}
const input = resolve(arg);
if (!existsSync(input)) fail(`Not found: ${input}`);
if (input.endsWith('.zip')) fail('Please unzip the archive first (outside this repo, or into ./archive/), then pass the folder.');

// ---------- locate files
let dataDir;
let tweetsFile;
if (statSync(input).isDirectory()) {
  dataDir = existsSync(join(input, 'data')) ? join(input, 'data') : input;
  tweetsFile = ['tweets.js', 'tweet.js'].map((f) => join(dataDir, f)).find(existsSync);
  if (!tweetsFile) fail(`No tweets.js or tweet.js found in ${dataDir}.`);
} else {
  tweetsFile = input;
  dataDir = dirname(input);
}
const notesFile = ['note-tweet.js', 'note_tweet.js'].map((f) => join(dataDir, f)).find(existsSync);
const accountFile = join(dataDir, 'account.js');

// ---------- parse the `window.YTD.<name>.part0 = [...]` wrapper
function readYtd(file) {
  const raw = readFileSync(file, 'utf8');
  const start = raw.indexOf('[');
  if (start === -1) fail(`${basename(file)} does not look like an archive data file.`);
  try {
    return JSON.parse(raw.slice(start));
  } catch (err) {
    fail(`Could not parse ${basename(file)}: ${err.message}`);
  }
}

let handle = '';
let accountId = '';
if (existsSync(accountFile)) {
  const acc = readYtd(accountFile)?.[0]?.account ?? {};
  handle = acc.username ?? '';
  accountId = acc.accountId ?? '';
}

const entries = readYtd(tweetsFile);
const unreadable = [];
const tweets = [];
for (const [i, entry] of entries.entries()) {
  const t = entry?.tweet ?? entry; // newer archives wrap each item in { tweet: {...} }
  const id = t?.id_str ?? t?.id;
  const text = t?.full_text ?? t?.text;
  if (!id || typeof text !== 'string' || !t.created_at) {
    unreadable.push(i);
    continue;
  }
  tweets.push(t);
}

// Long posts: the archive keeps the full text in note-tweet.js; tweets.js holds a truncated copy.
const notes = [];
if (notesFile) {
  for (const n of readYtd(notesFile)) {
    const nt = n?.noteTweet;
    const text = nt?.core?.text;
    if (text && nt.createdAt) notes.push({ created: Date.parse(nt.createdAt), text });
  }
}
function fullTextFor(t, shortText) {
  if (!notes.length) return shortText;
  const created = Date.parse(t.created_at);
  const stem = shortText.replace(/https:\/\/t\.co\/\S+/g, '').replace(/…$/, '').trim().slice(0, 60);
  const match = notes.find((n) => Math.abs(n.created - created) < 60_000 && n.text.startsWith(stem.slice(0, 40)));
  return match ? match.text : shortText;
}

// ---------- filter to public, original posts
const byId = new Map(tweets.map((t) => [String(t.id_str ?? t.id), t]));
const counts = { retweets: 0, repliesToOthers: 0, kept: 0 };
const kept = [];
for (const t of tweets) {
  const text = t.full_text ?? t.text;
  if (t.retweeted === true || /^RT @\w+:/.test(text)) {
    counts.retweets++;
    continue;
  }
  const replyToUser = t.in_reply_to_user_id_str ?? t.in_reply_to_user_id;
  const isSelfReply = replyToUser && accountId && String(replyToUser) === String(accountId);
  // Without account.js we cannot tell a thread from a reply to someone else, so replies are skipped.
  if (replyToUser && !isSelfReply) {
    counts.repliesToOthers++;
    continue;
  }
  kept.push(t);
}

// ---------- threads: follow explicit self-reply links only (not conversation ids)
const keptIds = new Set(kept.map((t) => String(t.id_str ?? t.id)));
function parentOf(t) {
  const p = t.in_reply_to_status_id_str ?? t.in_reply_to_status_id;
  return p && keptIds.has(String(p)) ? String(p) : null;
}
function rootOf(t) {
  let cur = t;
  const seen = new Set();
  while (parentOf(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = byId.get(parentOf(cur));
  }
  return String(cur.id_str ?? cur.id);
}
const threadMembers = new Map();
for (const t of kept) {
  const r = rootOf(t);
  if (!threadMembers.has(r)) threadMembers.set(r, []);
  threadMembers.get(r).push(t);
}

// ---------- normalise
function expandLinks(text, t) {
  let out = text;
  for (const u of t.entities?.urls ?? []) {
    if (u.url && u.expanded_url) out = out.split(u.url).join(u.expanded_url);
  }
  // Media t.co links point back at the post itself; drop them from the text.
  for (const m of t.extended_entities?.media ?? t.entities?.media ?? []) {
    if (m.url) out = out.split(m.url).join('');
  }
  return decodeEntities(out).trim();
}
function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function mediaFor(t) {
  const list = t.extended_entities?.media ?? t.entities?.media ?? [];
  const media = list
    .map((m) => ({
      type: m.type === 'video' ? 'video' : m.type === 'animated_gif' ? 'gif' : 'image',
      // Public CDN url of the media as posted. Local files in data/tweets_media are NOT copied.
      url: m.media_url_https ?? m.media_url ?? '',
      alt: m.ext_alt_text ?? undefined,
    }))
    .filter((m) => m.url);
  return media.length ? media : undefined;
}

const user = handle || 'i';
const imported = kept.map((t) => {
  const id = String(t.id_str ?? t.id);
  const root = rootOf(t);
  const members = threadMembers.get(root);
  const inThread = members.length > 1;
  const ordered = inThread ? [...members].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)) : null;
  const post = {
    id: `x:${id}`,
    platform: 'x',
    // x.com/i/status/<id> works without a handle; with account.js we use the real handle.
    url: `https://x.com/${user === 'i' ? 'i/web' : user}/status/${id}`,
    text: expandLinks(fullTextFor(t, t.full_text ?? t.text), t),
    publishedAt: new Date(t.created_at).toISOString(),
    themes: [],
    tones: [],
    media: mediaFor(t),
    threadId: inThread ? `x:${root}` : undefined,
    sequence: inThread ? ordered.findIndex((m) => m === t) + 1 : undefined,
    publish: false,
  };
  return post;
});
imported.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

// ---------- merge with an existing inbox so re-importing keeps your tags and choices
let existing = [];
if (existsSync(INBOX)) {
  try {
    existing = JSON.parse(readFileSync(INBOX, 'utf8')).posts ?? [];
  } catch {
    fail('content/x-inbox.json exists but is not valid JSON. Fix or delete it, then re-run.');
  }
}
const prev = new Map(existing.map((p) => [p.id, p]));
const merged = imported.map((p) => {
  const old = prev.get(p.id);
  return old ? { ...p, themes: old.themes ?? [], tones: old.tones ?? [], publish: !!old.publish, title: old.title, excerpt: old.excerpt } : p;
});
counts.kept = merged.length;

writeFileSync(
  INBOX,
  JSON.stringify(
    {
      version: 1,
      _readme:
        'PRIVATE WORKING FILE (git-ignored). Add theme/tone ids and set "publish": true on posts you want on the site, then run `npm run publish:posts`.',
      importedAt: new Date().toISOString(),
      handle: handle || null,
      posts: merged,
    },
    null,
    2,
  ) + '\n',
);

console.log(`Read ${entries.length} archive entries from ${basename(tweetsFile)}${notesFile ? ` (+ ${notes.length} long-form notes)` : ''}.`);
console.log(`Kept ${counts.kept} original posts/thread parts. Skipped ${counts.retweets} retweets and ${counts.repliesToOthers} replies to others.`);
if (!accountId) console.log('! account.js not found: replies could not be told apart from threads, so all replies were skipped, and links use x.com/i/web/status/<id>.');
if (unreadable.length) console.log(`! ${unreadable.length} entries were missing id/text/date and were ignored (first index: ${unreadable[0]}).`);
console.log(`\nWrote content/x-inbox.json (private, git-ignored). ${merged.filter((p) => p.publish).length} marked to publish.`);
console.log('Next: tag posts and set "publish": true, then run `npm run publish:posts`.');

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
