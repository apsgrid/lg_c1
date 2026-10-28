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
  const total = (base + notes + tuning) * mul + packaging;
  return {
    base: round2(base * mul),
    notes: round2(notes * mul),
    tuning: round2(tuning * mul),
    packaging: round2(packaging),
    total: round2(total),
  };
}
