import { productId } from './id';
import { deriveSeed, mulberry32, rngInt, rngPick, rngRange, type Rng } from './rng';
import { runTest } from './test';
import {
  MAX_SLOTS, PACK_STYLES, TUNING_KEYS,
  type CustomerId, type GameData, type Product, type SynergyId, type TestResult,
} from './types';
import { clamp, round1 } from './util';

export type Strategy = 'profit' | 'originality' | 'segment' | 'premium' | 'improve';

export const STRATEGIES: { id: Strategy; label: string; blurb: string }[] = [
  { id: 'profit', label: 'Maximise profit', blurb: 'Chase projected profit, minus reputation risk.' },
  { id: 'originality', label: 'Maximise originality', blurb: 'Something new that still sells.' },
  { id: 'segment', label: 'Target a segment', blurb: 'Win over one customer type.' },
  { id: 'premium', label: 'Premium product', blurb: 'Luxe packaging, high margin, high balance.' },
  { id: 'improve', label: 'Improve existing', blurb: 'Small nudges to the current product.' },
];

export interface AutoOptions {
  strategy: Strategy;
  target?: CustomerId;
  iterations: number;
  seed: number;
}

export interface AutoStep {
  iteration: number;
  change: string;
  accepted: boolean;
  score: number;
  product: Product;
  result: TestResult;
}

export function objective(r: TestResult, product: Product, opts: Pick<AutoOptions, 'strategy' | 'target'>): number {
  switch (opts.strategy) {
    case 'profit':
      return r.projectedProfit - r.reputationRisk * 0.5;
    case 'originality':
      return r.originality * 0.6 + r.appeal * 0.4 - r.reputationRisk * 0.2;
    case 'segment': {
      const t = r.reactions.find((x) => x.customerId === opts.target);
      return (t?.score ?? 0) * 0.8 + r.appeal * 0.2 - r.reputationRisk * 0.2;
    }
    case 'premium':
      return r.appeal * 0.5 + r.balance * 0.2 + r.margin * 1.2 - r.reputationRisk * 0.3
        + (product.brand.tier === 'premium' ? 10 : 0);
    case 'improve':
      return r.appeal * 0.5 + r.projectedProfit * 0.02 + r.repeatPurchase * 0.2 - r.reputationRisk * 0.3;
  }
}

function clone(p: Product): Product {
  return JSON.parse(JSON.stringify(p)) as Product;
}

function mutate(src: Product, data: GameData, rng: Rng, opts: AutoOptions): { product: Product; change: string } {
  const p = clone(src);
  const small = opts.strategy === 'improve';
  const noteName = (id: string) => data.notes.find((n) => n.id === id)?.name ?? id;
  const unused = data.notes.filter((n) => !p.notes.some((s) => s.noteId === n.id));
  const roll = rng();
  let change = '';

  if (roll < 0.3 && p.notes.length > 0) {
    const slot = rngPick(rng, p.notes);
    const delta = Math.round(rngRange(rng, small ? -8 : -20, small ? 8 : 20));
    slot.amount = clamp(slot.amount + delta, 5, 100);
    change = `${noteName(slot.noteId)} ${delta >= 0 ? '+' : ''}${delta}`;
  } else if (roll < 0.42 && p.notes.length < MAX_SLOTS && unused.length) {
    const n = rngPick(rng, unused);
    p.notes.push({ noteId: n.id, amount: rngInt(rng, 10, small ? 20 : 40) });
    change = `add ${n.name}`;
  } else if (roll < 0.52 && p.notes.length > 1) {
    const i = rngInt(rng, 0, p.notes.length - 1);
    change = `drop ${noteName(p.notes[i].noteId)}`;
    p.notes.splice(i, 1);
  } else if (roll < 0.62 && !small && p.notes.length > 0 && unused.length) {
    const slot = rngPick(rng, p.notes);
    const n = rngPick(rng, unused);
    change = `swap ${noteName(slot.noteId)} -> ${n.name}`;
    slot.noteId = n.id;
  } else if (roll < 0.68 && !small) {
    const b = rngPick(rng, data.bases);
    p.base = b.id;
    change = `base ${b.name}`;
  } else if (roll < 0.88) {
    const key = rngPick(rng, TUNING_KEYS);
    const delta = Math.round(rngRange(rng, small ? -8 : -18, small ? 8 : 18));
    p.tuning[key] = clamp(p.tuning[key] + delta);
    change = `${key} ${delta >= 0 ? '+' : ''}${delta}`;
  } else {
    const delta = round1(rngRange(rng, -3, 3));
    p.brand.price = clamp(round1(p.brand.price + delta), 3, 60);
    change = `price ${delta >= 0 ? '+' : ''}${delta}`;
  }
  p.id = productId(p);
  return { product: p, change };
}

/** Random-but-seeded starting formula for strategies that start from scratch. */
function seedFormula(start: Product, data: GameData, rng: Rng, opts: AutoOptions): Product {
  const p = clone(start);
  if (opts.strategy === 'improve') return p;
  p.base = rngPick(rng, data.bases).id;
  const pool = [...data.notes];
  p.notes = [];
  const count = rngInt(rng, 2, 3);
  for (let i = 0; i < count; i++) {
    const n = pool.splice(rngInt(rng, 0, pool.length - 1), 1)[0];
    p.notes.push({ noteId: n.id, amount: rngInt(rng, 20, 50) });
  }
  if (opts.strategy === 'premium') {
    p.brand.tier = 'premium';
    p.brand.style = 'luxe';
    p.brand.price = Math.max(p.brand.price, 28);
  } else if (!PACK_STYLES.includes(p.brand.style)) {
    p.brand.style = 'classic';
  }
  p.id = productId(p);
  return p;
}

/**
 * Strategy loop: seeded hill-climb with a little annealing. Every candidate is
 * scored with exactly the same runTest() the manual mode uses.
 */
export function runAuto(start: Product, data: GameData, discovered: readonly SynergyId[], opts: AutoOptions): {
  steps: AutoStep[];
  best: AutoStep;
} {
  const rng = mulberry32(deriveSeed(opts.seed, `auto:${opts.strategy}:${opts.target ?? ''}`));
  let current = seedFormula(start, data, rng, opts);
  let currentResult = runTest(current, data, discovered);
  let currentScore = objective(currentResult, current, opts);
  const first: AutoStep = {
    iteration: 0, change: opts.strategy === 'improve' ? 'start from current' : 'seed formula',
    accepted: true, score: currentScore, product: current, result: currentResult,
  };
  const steps: AutoStep[] = [first];
  let best = first;

  for (let i = 1; i <= opts.iterations; i++) {
    const { product, change } = mutate(current, data, rng, opts);
    const result = runTest(product, data, discovered);
    const score = objective(result, product, opts);
    const temp = Math.max(0.01, 1 - i / opts.iterations) * 3;
    const accepted = score >= currentScore || rng() < Math.exp((score - currentScore) / temp);
    const step: AutoStep = { iteration: i, change, accepted, score, product, result };
    steps.push(step);
    if (accepted) {
      current = product;
      currentResult = result;
      currentScore = score;
    }
    if (score > best.score) best = step;
  }
  return { steps, best };
}
