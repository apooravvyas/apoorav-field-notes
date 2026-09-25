/** The two graph lenses. Each post carries tags for both. */
export type Lens = 'themes' | 'tones';

/** Where a post was originally published. Add new sources here (the graph never looks at this). */
export type Platform = 'x' | 'substack' | 'linkedin';

export interface PostMedia {
  type: 'image' | 'video' | 'gif';
  url: string;
  alt?: string;
}

/**
 * One published post. Source-neutral: an X post, a Substack essay, or anything else with a permalink.
 * This is the shape of every entry in content/posts.json.
 */
export interface Post {
  /** Unique and stable. Convention: "<platform>:<native id>", e.g. "x:1790000000000000000". */
  id: string;
  platform: Platform;
  /** Public permalink to the original, e.g. https://x.com/handle/status/1790000000000000000 */
  url: string;
  /** The post text. For X this is the full tweet; for Substack a teaser or the opening paragraph. */
  text: string;
  /** Only when the original has one (Substack essays). Never invent a title for an X post. */
  title?: string;
  /** Optional shorter preview. */
  excerpt?: string;
  /** ISO 8601 timestamp. */
  publishedAt: string;
  /** Theme tag ids (see content/taxonomy.json). */
  themes: string[];
  /** Tone tag ids (see content/taxonomy.json). */
  tones: string[];
  media?: PostMedia[];
  /** Posts in the same thread share this id (the id of the first post in the thread). */
  threadId?: string;
  /** 1-based position inside the thread. */
  sequence?: number;
}

export interface TagDef {
  id: string;
  label: string;
  color: string;
  description?: string;
  /** true when the tag was used on a post but not defined in taxonomy.json */
  auto?: boolean;
}

export interface GraphNode extends TagDef {
  /** Number of distinct posts carrying this tag. */
  count: number;
  postIds: string[];
  r: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  /** Number of distinct posts carrying both tags. */
  weight: number;
}

export interface LensGraph {
  lens: Lens;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Posts that have no tag in this lens. */
  untagged: number;
}
