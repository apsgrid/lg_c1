import { scorePanel } from './customers';
import { unitCost } from './cost';
import { productId } from './id';
import { computeProfile } from './profile';
import { deriveSeed, mulberry32 } from './rng';
import type { GameData, Product, SynergyId, TestResult } from './types';
import { clamp, round1, round2 } from './util';

/** Run a full test batch: profile, customer panel, cost and projections. Pure and deterministic. */
export function runTest(product: Product, data: GameData, discovered: readonly SynergyId[] = []): TestResult {
  const id = productId(product);
  const pr = computeProfile(product, data);
  const rng = mulberry32(deriveSeed(product.seed, `panel:${id}`));
  const reactions = scorePanel(product, pr, data, rng);
  const t = product.tuning;
  const p = pr.profile;

  const hasNotes = product.notes.some((n) => n.amount > 0);
  const appeal = hasNotes ? reactions.reduce((s, r) => s + r.score, 0) / reactions.length : 0;
  const repeatPurchase = hasNotes
    ? clamp(0.4 * appeal + 0.25 * p.balance + 0.45 * t.dependence + (t.smoothness - 50) * 0.1 - 10)
    : 0;
  const reputationRisk = clamp(t.dependence * 0.85 + Math.max(0, t.intensity - 75) * 0.8);

  const cost = unitCost(product, data);
  const margin = product.brand.price - cost.total;
  // Fictional weekly demand: appeal drives it, price and reputation risk drag on it.
  const priceDrag = Math.exp(-Math.max(0, product.brand.price - 12) / 35);
  const units = (Math.pow(appeal / 10, 1.6) * 4 * priceDrag * (1 + repeatPurchase / 200)) * (1 - reputationRisk / 220);
  const projectedProfit = hasNotes ? units * margin : 0;

  return {
    productId: id,
    profile: p,
    appeal: round1(appeal),
    originality: p.originality,
    balance: p.balance,
    repeatPurchase: round1(repeatPurchase),
    reputationRisk: round1(reputationRisk),
    unitCost: cost,
    margin: round2(margin),
    projectedProfit: round1(projectedProfit),
    reactions,
    activeSynergies: pr.activeSynergies,
    newlyDiscovered: pr.activeSynergies.filter((s) => !discovered.includes(s)),
  };
}
