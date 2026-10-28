import type { Product } from './types';

/** Canonical JSON: sorted object keys so equal data always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a 32-bit. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stable product ID: hash of formula + tuning + seed (branding excluded). */
export function productId(p: Pick<Product, 'base' | 'notes' | 'tuning' | 'seed'>): string {
  const notes = p.notes
    .filter((n) => n.amount > 0)
    .map((n) => ({ noteId: n.noteId, amount: Math.round(n.amount) }));
  const tuning = Object.fromEntries(Object.entries(p.tuning).map(([k, v]) => [k, Math.round(v)]));
  const key = canonicalJson({ base: p.base, notes, tuning, seed: p.seed >>> 0 });
  return `VL-${fnv1a(key).toString(16).padStart(8, '0')}`;
}

export function withId<T extends Omit<Product, 'id'> & { id?: string }>(p: T): Product {
  return { ...p, id: productId(p) } as Product;
}
