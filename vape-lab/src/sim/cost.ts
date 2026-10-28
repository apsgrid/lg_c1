import type { CostBreakdown, GameData, PackStyle, Product, Tier } from './types';
import { round2 } from './util';

export const PACK_COST: Record<PackStyle, number> = {
  classic: 0.8, minimal: 0.5, neon: 1.0, retro: 0.9, luxe: 2.2,
};

export const TIER_MULTIPLIER: Record<Tier, number> = {
  budget: 0.85, standard: 1, premium: 1.35,
};

/** Fictional production cost per unit, in credits. */
export function unitCost(product: Product, data: GameData): CostBreakdown {
  const base = data.bases.find((b) => b.id === product.base)?.cost ?? 2;
  let notes = 0;
  for (const slot of product.notes) {
    const def = data.notes.find((n) => n.id === slot.noteId);
    if (def) notes += (slot.amount / 100) * def.cost;
  }
  const t = product.tuning;
  const tuning = t.vapour * 0.012 + t.cooling * 0.008 + t.intensity * 0.006;
  const mul = TIER_MULTIPLIER[product.brand.tier];
  const packaging = PACK_COST[product.brand.style] * (product.brand.tier === 'premium' ? 1.3 : 1);
  // Disposables are built cheap: half the build cost, flimsier packaging.
  // Supplier stock carries the supplier's markup.
  const f = (product.brand.format === 'disposable' ? 0.5 : 1) * (product.brand.wholesale ? 1.6 : 1);
  const total = ((base + notes + tuning) * mul + packaging) * f;
  return {
    base: round2(base * mul * f),
    notes: round2(notes * mul * f),
    tuning: round2(tuning * mul * f),
    packaging: round2(packaging * f),
    total: round2(total),
  };
}

const FAULT_RATE: Record<'refillable' | 'disposable', Record<Tier, number>> = {
  refillable: { budget: 0.03, standard: 0.015, premium: 0.008 },
  disposable: { budget: 0.2, standard: 0.12, premium: 0.06 },
};

/** Chance (0-1) that one unit turns out faulty and comes back. */
export function faultChance(product: Product): number {
  return FAULT_RATE[product.brand.format ?? 'refillable'][product.brand.tier];
}
