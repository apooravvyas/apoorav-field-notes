// Shared by the browser app and the Node scripts (validate / import / publish).
// Plain JS on purpose so the scripts run with `node` and no build step.

export const DATA_VERSION = 1;
export const PLATFORMS = ['x', 'substack', 'linkedin'];
export const LENSES = ['themes', 'tones'];

/** Named node colours. Taxonomy entries may use one of these names or any #hex. */
export const PALETTE = {
  rose: '#E6BAC1',
  lavender: '#C9BBDD',
  sage: '#BACAA9',
  mist: '#AFC2D4',
  wheat: '#E7D3A6',
  clay: '#DDB8A2',
};
const PALETTE_ORDER = ['rose', 'sage', 'lavender', 'mist', 'wheat', 'clay'];

/** "Building in Public" -> "building-in-public" */
export function normalizeTagId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "building-in-public" -> "building in public" */
export function labelFromId(id) {
  return id.replace(/-/g, ' ');
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function resolveColor(color, id) {
  if (typeof color === 'string') {
    if (PALETTE[color]) return PALETTE[color];
    if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  }
  return PALETTE[PALETTE_ORDER[hashString(id) % PALETTE_ORDER.length]];
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

function validateUrl(url, platform) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'url is not a valid absolute URL';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'url must start with https://';
  if (platform === 'linkedin' && !/(^|\.)linkedin\.com$/i.test(u.hostname)) {
    return 'LinkedIn url should be a linkedin.com post link';
  }
  if (platform === 'x') {
    const hostOk = /(^|\.)(x|twitter)\.com$/i.test(u.hostname);
    if (!hostOk || !/\/status(es)?\/\d+/.test(u.pathname)) {
      return 'X url should look like https://x.com/<handle>/status/<id>';
    }
  }
  return null;
}

/**
 * Validate one taxonomy file: { themes: TagDef[], tones: TagDef[] }.
 * Returns maps of id -> { id, label, color, description }.
 */
export function validateTaxonomy(raw, errors, warnings) {
  const out = { themes: new Map(), tones: new Map() };
  if (raw == null) return out;
  if (!isObj(raw)) {
    errors.push('taxonomy.json must be an object with "themes" and "tones" arrays.');
    return out;
  }
  for (const lens of LENSES) {
    const list = raw[lens] ?? [];
    if (!Array.isArray(list)) {
      errors.push(`taxonomy.${lens} must be an array.`);
      continue;
    }
    list.forEach((t, i) => {
      if (!isObj(t) || !isNonEmptyString(t.id)) {
        warnings.push(`taxonomy.${lens}[${i}] skipped: needs an "id".`);
        return;
      }
      const id = normalizeTagId(t.id);
      if (out[lens].has(id)) {
        warnings.push(`taxonomy.${lens}: duplicate id "${id}" ignored.`);
        return;
      }
      out[lens].set(id, {
        id,
        label: isNonEmptyString(t.label) ? t.label.trim() : labelFromId(id),
        color: resolveColor(t.color, id),
        description: isNonEmptyString(t.description) ? t.description.trim() : undefined,
      });
    });
  }
  return out;
}

function cleanTags(value, field, where, warnings) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${where}: "${field}" should be an array of tag ids; treated as empty.`);
    return [];
  }
  const seen = new Set();
  for (const v of value) {
    const id = normalizeTagId(v);
    if (id) seen.add(id);
  }
  return [...seen];
}

function cleanMedia(value, where, warnings) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    warnings.push(`${where}: "media" should be an array; ignored.`);
    return undefined;
  }
  const media = [];
  for (const m of value) {
    if (!isObj(m) || !isNonEmptyString(m.url)) continue;
    const type = ['image', 'video', 'gif'].includes(m.type) ? m.type : 'image';
    media.push({ type, url: m.url.trim(), alt: isNonEmptyString(m.alt) ? m.alt.trim() : undefined });
  }
  return media.length ? media : undefined;
}

/**
 * Validate a posts file and its taxonomy.
 * posts file shape: { version: 1, sample?: boolean, posts: Post[] }  (a bare array is also accepted)
 *
 * @returns {{ ok: boolean, sample: boolean, posts: any[], taxonomy: {themes: Map, tones: Map},
 *             errors: string[], warnings: string[], skipped: number }}
 */
export function validateDataset(rawPosts, rawTaxonomy) {
  const errors = [];
  const warnings = [];
  let list;
  let sample = false;

  if (Array.isArray(rawPosts)) {
    list = rawPosts;
  } else if (isObj(rawPosts) && Array.isArray(rawPosts.posts)) {
    list = rawPosts.posts;
    sample = rawPosts.sample === true;
    if (rawPosts.version !== undefined && rawPosts.version !== DATA_VERSION) {
      warnings.push(`posts file version ${rawPosts.version} is newer/older than expected (${DATA_VERSION}).`);
    }
  } else {
    errors.push('posts.json must be { "version": 1, "posts": [ ... ] } or an array of posts.');
    list = [];
  }

  const taxonomy = validateTaxonomy(rawTaxonomy, errors, warnings);
  const posts = [];
  const ids = new Set();
  let skipped = 0;

  list.forEach((p, i) => {
    const where = `posts[${i}]${isObj(p) && isNonEmptyString(p.id) ? ` (id ${p.id})` : ''}`;
    const problems = [];
    if (!isObj(p)) {
      warnings.push(`${where} skipped: not an object.`);
      skipped++;
      return;
    }
    if (!isNonEmptyString(p.id)) problems.push('missing "id"');
    else if (ids.has(p.id)) problems.push(`duplicate id "${p.id}"`);
    if (!PLATFORMS.includes(p.platform)) problems.push(`"platform" must be one of ${PLATFORMS.join(', ')}`);
    if (!isNonEmptyString(p.text) && !isNonEmptyString(p.title)) problems.push('needs "text" (or a "title")');
    if (!isNonEmptyString(p.publishedAt) || Number.isNaN(Date.parse(p.publishedAt))) {
      problems.push('"publishedAt" must be an ISO date like 2026-03-12T09:30:00Z');
    }
    if (sample) {
      if (p.url) problems.push('sample posts must not link anywhere; leave "url" empty');
    } else if (!isNonEmptyString(p.url)) {
      problems.push('missing "url" (the public permalink)');
    } else {
      const urlProblem = validateUrl(p.url, p.platform);
      if (urlProblem) problems.push(urlProblem);
    }
    if (problems.length) {
      warnings.push(`${where} skipped: ${problems.join('; ')}.`);
      skipped++;
      return;
    }
    ids.add(p.id);

    const post = {
      id: p.id,
      platform: p.platform,
      url: sample ? '' : p.url.trim(),
      text: isNonEmptyString(p.text) ? p.text.trim() : '',
      title: isNonEmptyString(p.title) ? p.title.trim() : undefined,
      excerpt: isNonEmptyString(p.excerpt) ? p.excerpt.trim() : undefined,
      publishedAt: new Date(p.publishedAt).toISOString(),
      themes: cleanTags(p.themes, 'themes', where, warnings),
      tones: cleanTags(p.tones, 'tones', where, warnings),
      media: cleanMedia(p.media, where, warnings),
      threadId: isNonEmptyString(p.threadId) ? p.threadId.trim() : undefined,
      sequence: Number.isInteger(p.sequence) && p.sequence > 0 ? p.sequence : undefined,
    };

    // Tags used on posts but not defined in taxonomy.json still work; they get a readable label and a colour.
    for (const lens of LENSES) {
      for (const id of post[lens]) {
        if (!taxonomy[lens].has(id)) {
          taxonomy[lens].set(id, { id, label: labelFromId(id), color: resolveColor(undefined, id), auto: true });
          warnings.push(`${lens.slice(0, -1)} "${id}" is used on a post but not defined in taxonomy.json (auto label/colour used).`);
        }
      }
    }
    posts.push(post);
  });

  return { ok: errors.length === 0, sample, posts, taxonomy, errors, warnings: dedupe(warnings), skipped };
}

function dedupe(arr) {
  return [...new Set(arr)];
}
