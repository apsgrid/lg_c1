import { rngPick, rngRange, type Rng } from './rng';
import type {
  Brand, CustomerDef, CustomerReaction, CustomerTerm, Driver, Family, GameData, Product, Profile, ProfileResult,
} from './types';
import { clamp, round1 } from './util';

const FAMILIAR_WORDS = [
  'classic', 'original', 'gold', 'ice', 'berry', 'cool', 'fresh', 'pure', 'vanilla', 'mint', 'smooth',
  'select', 'crown', 'blue', 'red', 'royal', 'co', 'labs', 'club', 'cloud', 'juice', 'max',
];

/** 0-100: how familiar a brand name and look feel to a cautious shopper. */
export function brandFamiliarity(brand: Brand): number {
  const words = brand.name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.length === 0) return 0;
  let f = 25 + Math.min(3, words.filter((w) => FAMILIAR_WORDS.includes(w)).length) * 15;
  if (brand.style === 'classic') f += 15;
  else if (brand.style === 'retro') f += 8;
  else if (brand.style === 'neon') f -= 10;
  if (brand.tier === 'standard') f += 5;
  if (brand.name.length > 18) f -= 10;
  return clamp(f);
}

export interface ScoreContext {
  profile: Profile;
  product: Product;
  familyShare: Record<Family, number>;
  familiarity: number;
}

export function statValue(stat: string, ctx: ScoreContext): number {
  if (stat.startsWith('t.')) return ctx.product.tuning[stat.slice(2) as keyof Product['tuning']] ?? 0;
  if (stat.startsWith('fam.')) return ctx.familyShare[stat.slice(4) as Family] ?? 0;
  if (stat === 'price') return ctx.product.brand.price;
  if (stat === 'tier.premium') return ctx.product.brand.tier === 'premium' ? 100 : 0;
  if (stat === 'format.disposable') return ctx.product.brand.format === 'disposable' ? 100 : 0;
  if (stat === 'familiarity') return ctx.familiarity;
  return ctx.profile[stat as keyof Profile] ?? 0;
}

export function termDelta(term: CustomerTerm, value: number): number {
  if (term.above !== undefined) return value > term.above ? term.weight * (value - term.above) : 0;
  if (term.below !== undefined) return value < term.below ? term.weight * (term.below - value) : 0;
  return term.weight * (value - (term.pivot ?? 50));
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

export function scoreCustomer(
  def: CustomerDef, ctx: ScoreContext, appealMul: number, rng: Rng, vars: Record<string, string>,
): CustomerReaction {
  const byLabel = new Map<string, number>();
  for (const term of def.terms) {
    const d = termDelta(term, statValue(term.stat, ctx));
    byLabel.set(term.label, (byLabel.get(term.label) ?? 0) + d);
  }
  const drivers: Driver[] = [...byLabel.entries()]
    .map(([label, delta]) => ({ label, delta: round1(delta) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const sum = drivers.reduce((s, d) => s + d.delta, 0);
  const noise = rngRange(rng, -3, 3);
  const score = round1(clamp(def.baseline + sum + (appealMul - 1) * 25 + noise));

  const top = drivers.find((d) => Math.abs(d.delta) >= 4 && def.comments[`${d.label}${d.delta > 0 ? '+' : '-'}`]);
  const key = top ? `${top.label}${top.delta > 0 ? '+' : '-'}` : 'neutral';
  const comment = fill(rngPick(rng, def.comments[key] ?? def.comments.neutral ?? ['...']), vars);
  return { customerId: def.id, score, drivers, comment };
}

/** Score the whole panel, then let synergies surface through customer comments. */
export function scorePanel(
  product: Product, pr: ProfileResult, data: GameData, rng: Rng,
): CustomerReaction[] {
  const ctx: ScoreContext = {
    profile: pr.profile, product, familyShare: pr.familyShare, familiarity: brandFamiliarity(product.brand),
  };
  const base = data.bases.find((b) => b.id === product.base);
  const topSlot = [...product.notes].filter((n) => n.amount > 0).sort((a, b) => b.amount - a.amount)[0];
  const vars = {
    note: data.notes.find((n) => n.id === topSlot?.noteId)?.name ?? 'the base',
    name: product.brand.name || 'this',
  };
  const reactions = data.customers.map((c) => scoreCustomer(c, ctx, base?.appeal[c.id] ?? 1, rng, vars));

  // Each active synergy is voiced by the happiest customer who hasn't voiced one yet.
  const byScore = [...reactions].sort((a, b) => b.score - a.score);
  let i = 0;
  for (const id of pr.activeSynergies) {
    const syn = data.synergies.find((s) => s.id === id);
    const r = byScore[i++ % byScore.length];
    if (!syn || !r) continue;
    r.hintSynergy = id;
    r.comment = `${syn.hint}. ${r.comment}`;
  }
  // Faint synergies get a vague nudge, but are not discovered.
  for (let f = 0; f < pr.faintSynergies.length; f++) {
    const r = byScore[i++ % byScore.length];
    if (r) r.comment += ' There\'s a hint of something special in there... it just needs more.';
  }
  return reactions;
}
