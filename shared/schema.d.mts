import type { Post, TagDef, Lens } from '../src/types';

export const DATA_VERSION: number;
export const PLATFORMS: readonly string[];
export const LENSES: readonly Lens[];
export const PALETTE: Record<string, string>;
export function normalizeTagId(value: unknown): string;
export function labelFromId(id: string): string;
export function resolveColor(color: unknown, id: string): string;

export interface ValidationResult {
  ok: boolean;
  sample: boolean;
  posts: Post[];
  taxonomy: Record<Lens, Map<string, TagDef>>;
  errors: string[];
  warnings: string[];
  skipped: number;
}
export function validateDataset(rawPosts: unknown, rawTaxonomy: unknown): ValidationResult;
