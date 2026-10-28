import { unitCost } from './cost';
import { computeProfile } from './profile';
import { describeRequirement, requirementMet, SYNERGY_ACTIVE_MIN } from './synergy';
import { runTest } from './test';
import type { GameData, Product, SynergyId } from './types';

export interface Advice {
  warnings: string[];
  suggestions: string[];
}

/** Assisted mode: compatibility warnings plus gentle suggestions. Uses the same sim. */
export function advise(product: Product, data: GameData, discovered: readonly SynergyId[]): Advice {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  const pr = computeProfile(product, data);
  const name = (id: string) => data.notes.find((n) => n.id === id)?.name ?? id;
  const total = product.notes.reduce((s, n) => s + n.amount, 0);
  const t = product.tuning;

  for (const [a, b] of pr.clashes) warnings.push(`${name(a)} and ${name(b)} clash (balance penalty).`);
  if (pr.strongNotes > 3) warnings.push('More than 3 strong notes are competing: balance penalty.');
  if (total > 0 && total < 40) warnings.push('The mix is thin. Add more game points.');
  if (pr.profile.cooling > 60) warnings.push('Very cold: only Ice Fans will be happy past this point.');
  if (t.intensity > 75) warnings.push('High intensity: casual buyers will call it harsh.');
  if (t.dependence >= 40) warnings.push('High dependence rating: reputation risk is climbing.');
  const cost = unitCost(product, data);
  if (product.brand.price <= cost.total) warnings.push(`Price (${product.brand.price}) is at or below unit cost (${cost.total}).`);

  // Synergy nudges: complete known ones explicitly, hint at unknown ones vaguely.
  for (const syn of data.synergies) {
    if (pr.activeSynergies.includes(syn.id)) continue;
    const missing = syn.needs.filter((r) => !requirementMet(r, product, data, SYNERGY_ACTIVE_MIN));
    if (missing.length !== 1 || missing.length === syn.needs.length) continue;
    if (discovered.includes(syn.id)) {
      suggestions.push(`Add ${describeRequirement(missing[0], data)} (15+ pts) to complete ${syn.name}.`);
    } else {
      const have = syn.needs.find((r) => !missing.includes(r));
      if (have) suggestions.push(`${describeRequirement(have, data)} seems to be looking for a partner...`);
    }
  }

  if (product.notes.length > 0) {
    const r = runTest(product, data, discovered);
    const worst = [...r.reactions].sort((a, b) => a.score - b.score)[0];
    const c = data.customers.find((x) => x.id === worst.customerId);
    const neg = worst.drivers.find((d) => d.delta < -3);
    if (c && neg) suggestions.push(`${c.name} is least happy (${Math.round(worst.score)}), mostly about "${neg.label.replace('_', ' ')}".`);
    if (r.margin > 0 && r.appeal > 60 && product.brand.tier !== 'premium') {
      suggestions.push('Strong appeal: you could try a premium tier and a higher price.');
    }
  } else {
    suggestions.push('Drag a bottle from the shelf into a slot to start.');
  }
  return { warnings, suggestions };
}
