import realPosts from '../../content/posts.json';
import realTaxonomy from '../../content/taxonomy.json';
import demoPosts from '../../content/demo/posts.json';
import demoTaxonomy from '../../content/demo/taxonomy.json';
import { validateDataset, type ValidationResult } from '../../shared/schema.mjs';
import type { GraphEdge, GraphNode, Lens, LensGraph, Post, TagDef } from '../types';
import type { SiteConfig } from '../../site.config';

export interface Dataset {
  /** true when showing the bundled sample posts instead of the owner's */
  sample: boolean;
  posts: Post[];
  byId: Map<string, Post>;
  taxonomy: Record<Lens, Map<string, TagDef>>;
  graphs: Record<Lens, LensGraph>;
  validation: ValidationResult;
}

function realPostCount(raw: unknown): number {
  if (Array.isArray(raw)) return raw.length;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { posts?: unknown[] }).posts)) {
    return (raw as { posts: unknown[] }).posts.length;
  }
  return -1; // malformed: let validation report it
}

export function loadDataset(config: SiteConfig): Dataset {
  const useDemo =
    config.dataMode === 'demo' || (config.dataMode === 'auto' && realPostCount(realPosts) === 0);
  const validation = useDemo
    ? validateDataset(demoPosts, demoTaxonomy)
    : validateDataset(realPosts, realTaxonomy);

  if (import.meta.env.DEV && validation.warnings.length) {
    console.groupCollapsed(`[content-graph] ${validation.warnings.length} data warning(s)`);
    validation.warnings.forEach((w) => console.warn(w));
    console.groupEnd();
  }

  const posts = validation.posts;
  const byId = new Map(posts.map((p) => [p.id, p]));
  return {
    sample: useDemo,
    posts,
    byId,
    taxonomy: validation.taxonomy,
    graphs: {
      themes: buildLensGraph(posts, validation.taxonomy.themes, 'themes'),
      tones: buildLensGraph(posts, validation.taxonomy.tones, 'tones'),
    },
    validation,
  };
}

const MIN_R = 20;
const MAX_R = 50;

/** Nodes = tags with at least one post. Size = distinct posts. Edges = tags that co-occur on a post. */
export function buildLensGraph(posts: Post[], defs: Map<string, TagDef>, lens: Lens): LensGraph {
  const postIdsByTag = new Map<string, Set<string>>();
  const pairCounts = new Map<string, number>();
  let untagged = 0;

  for (const post of posts) {
    const tags = [...new Set(post[lens])].filter((t) => defs.has(t)).sort();
    if (!tags.length) {
      untagged++;
      continue;
    }
    for (const t of tags) {
      if (!postIdsByTag.has(t)) postIdsByTag.set(t, new Set());
      postIdsByTag.get(t)!.add(post.id);
    }
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = `${tags[i]}\u0000${tags[j]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const counts = [...postIdsByTag.values()].map((s) => s.size);
  const maxCount = Math.max(1, ...counts);
  const radius = (n: number) =>
    maxCount === 1 ? (MIN_R + MAX_R) / 2.4 : MIN_R + (MAX_R - MIN_R) * Math.sqrt((n - 1) / (maxCount - 1));

  const nodes: GraphNode[] = [...postIdsByTag.entries()]
    .map(([id, set]) => {
      const def = defs.get(id)!;
      return { ...def, count: set.size, postIds: [...set], r: radius(set.size) };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const edges: GraphEdge[] = [...pairCounts.entries()].map(([key, weight]) => {
    const [source, target] = key.split('\u0000');
    return { source, target, weight };
  });

  return { lens, nodes, edges, untagged };
}

// ---------- search ----------

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Queries match at the start of a word, so "ai" finds "AI tools" but not "email" or "chai".
 * Returns a global, case-insensitive RegExp; capture group 2 is the matched text.
 */
export function queryRegExp(q: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(q)})`, 'giu');
}

function textMatches(text: string | undefined, q: string): boolean {
  if (!text) return false;
  const re = queryRegExp(q);
  return re.test(text);
}

export function postMatches(post: Post, q: string): boolean {
  if (!q) return true;
  return textMatches(post.text, q) || textMatches(post.title, q) || textMatches(post.excerpt, q);
}

export function tagLabelMatches(node: TagDef, q: string): boolean {
  return !!q && (textMatches(node.label, q) || textMatches(node.id, q.replace(/\s+/g, '-')));
}

export interface SearchResult {
  /** Tags related to the query: their label matches, or at least one of their posts does. */
  relatedTags: Set<string>;
  matchingPostIds: Set<string>;
}

export function search(ds: Dataset, lens: Lens, q: string): SearchResult | null {
  if (!q) return null;
  const matchingPostIds = new Set(ds.posts.filter((p) => postMatches(p, q)).map((p) => p.id));
  const relatedTags = new Set<string>();
  for (const node of ds.graphs[lens].nodes) {
    if (tagLabelMatches(node, q) || node.postIds.some((id) => matchingPostIds.has(id))) {
      relatedTags.add(node.id);
    }
  }
  return { relatedTags, matchingPostIds };
}

/**
 * Order posts newest first, but keep thread parts together in thread order,
 * positioned where the newest part of that thread would sort.
 */
export function orderPosts(posts: Post[]): Post[] {
  const groups = new Map<string, Post[]>();
  for (const p of posts) {
    const key = p.threadId ? `t:${p.threadId}` : `p:${p.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const list = [...groups.values()].map((g) => {
    g.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.publishedAt.localeCompare(b.publishedAt));
    const newest = g.reduce((m, p) => (p.publishedAt > m ? p.publishedAt : m), '');
    return { g, newest };
  });
  list.sort((a, b) => b.newest.localeCompare(a.newest));
  return list.flatMap((x) => x.g);
}
