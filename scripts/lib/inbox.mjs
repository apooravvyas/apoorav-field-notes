// Helpers shared by the Substack and LinkedIn importers.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, newlines inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

/** HTML -> readable plain text with paragraph breaks. */
export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|figure|figcaption)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-6]|li|blockquote|div)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
}

export function firstParagraphs(text, max = 420) {
  const out = [];
  for (const p of text.split(/\n\n+/)) {
    if (!p.trim()) continue;
    if (out.join('\n\n').length + p.length > max && out.length) break;
    out.push(p.trim());
    if (out.join('\n\n').length >= max) break;
  }
  const joined = out.join('\n\n');
  return joined.length > max + 80 ? `${joined.slice(0, max).replace(/\s+\S*$/, '')}…` : joined;
}

/** Write an inbox, keeping tags and publish choices from a previous run. */
export function writeInbox(file, source, posts, extra = {}) {
  let prev = new Map();
  if (existsSync(file)) {
    try {
      prev = new Map((JSON.parse(readFileSync(file, 'utf8')).posts ?? []).map((p) => [p.id, p]));
    } catch {
      throw new Error(`${file} exists but is not valid JSON. Fix or delete it, then re-run.`);
    }
  }
  const seen = new Set();
  const merged = posts.map((p) => {
    seen.add(p.id);
    const old = prev.get(p.id);
    return old ? { ...p, themes: old.themes ?? [], tones: old.tones ?? [], publish: !!old.publish } : p;
  });
  // Keep posts collected earlier (e.g. from an export) that this run's source did not include (e.g. a short RSS feed).
  for (const [id, old] of prev) if (!seen.has(id)) merged.push(old);
  merged.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  writeFileSync(
    file,
    JSON.stringify(
      {
        version: 1,
        _readme: `PRIVATE REVIEW FILE (git-ignored). Posts collected from ${source}. Nothing here is on the site until it is marked "publish": true and \`npm run publish:posts\` is run.`,
        importedAt: new Date().toISOString(),
        ...extra,
        posts: merged,
      },
      null,
      2,
    ) + '\n',
  );
  return merged;
}
