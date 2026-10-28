import { describe, expect, it } from 'vitest';
import { GAME_DATA as data } from '../src/data';
import {
  advise, computeProfile, matchSynergies, mulberry32, newProduct, productId, runAuto, runTest, unitCost,
  type Product,
} from '../src/sim';

function make(notes: [string, number][], extra: Partial<Product> = {}): Product {
  const p = { ...newProduct(42), ...extra };
  p.notes = notes.map(([noteId, amount]) => ({ noteId, amount }));
  p.id = productId(p);
  return p;
}

describe('rng', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const c = mulberry32(124);
    const sa = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(sa);
    expect(c()).not.toEqual(sa[0]);
    for (const v of sa) expect(v >= 0 && v < 1).toBe(true);
  });
});

describe('id', () => {
  it('is stable and ignores branding and slot key order', () => {
    const a = make([['strawberry', 40], ['cream', 30]]);
    const b = { ...a, brand: { ...a.brand, name: 'Other' } };
    expect(productId(a)).toBe(productId(b));
    expect(productId(a)).toMatch(/^VL-[0-9a-f]{8}$/);
  });
  it('changes with formula, tuning or seed', () => {
    const a = make([['strawberry', 40]]);
    expect(productId({ ...a, seed: 43 })).not.toBe(productId(a));
    expect(productId({ ...a, tuning: { ...a.tuning, intensity: 70 } })).not.toBe(productId(a));
    expect(productId(make([['strawberry', 41]]))).not.toBe(productId(a));
  });
});

describe('profile', () => {
  it('is deterministic', () => {
    const p = make([['mango', 40], ['citrus', 25], ['mint', 15]]);
    expect(computeProfile(p, data)).toEqual(computeProfile(JSON.parse(JSON.stringify(p)), data));
  });
  it('keeps all attributes in 0-100', () => {
    const p = make([['caramel', 100], ['coffee', 100], ['cream', 100], ['vanilla_custard', 100]],
      { tuning: { intensity: 100, cooling: 100, smoothness: 0, vapour: 100, dependence: 100 } });
    for (const v of Object.values(computeProfile(p, data).profile)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
  it('penalises more than 3 strong notes', () => {
    const three = computeProfile(make([['mango', 30], ['watermelon', 30], ['strawberry', 30]]), data);
    const four = computeProfile(make([['mango', 30], ['watermelon', 30], ['strawberry', 30], ['bubblegum', 30]]), data);
    expect(four.strongNotes).toBe(4);
    expect(four.profile.balance).toBeLessThan(three.profile.balance);
  });
  it('detects clashes', () => {
    expect(computeProfile(make([['coffee', 30], ['bubblegum', 30]]), data).clashes).toHaveLength(1);
  });
  it('higher cooling dial raises cooling', () => {
    const lo = make([['mango', 50]], { tuning: { ...newProduct().tuning, cooling: 10 } });
    const hi = make([['mango', 50]], { tuning: { ...newProduct().tuning, cooling: 90 } });
    expect(computeProfile(hi, data).profile.cooling).toBeGreaterThan(computeProfile(lo, data).profile.cooling);
  });
});

describe('synergies', () => {
  it('fires each starting synergy', () => {
    const cases: [string, Product][] = [
      ['bakery_dessert', make([['cream', 30], ['vanilla_custard', 30]])],
      ['refreshing_citrus', make([['citrus', 30], ['mint', 20]])],
      ['refreshing_citrus', make([['citrus', 30]], { base: 'menthol_ice' })],
      ['rich_roast', make([['caramel', 30], ['coffee', 30]])],
      ['fruity_dessert', make([['strawberry', 30], ['cream', 30]])],
      ['icing_tang', make([['vanilla_custard', 30], ['lemonade', 20]])],
      ['fizzy_soda', make([['cola', 30], ['lemonade', 30]])],
    ];
    for (const [id, p] of cases) expect(matchSynergies(p, data).active).toContain(id);
  });
  it('is faint at low amounts, absent without partner', () => {
    expect(matchSynergies(make([['cream', 30], ['vanilla_custard', 6]]), data).faint).toContain('bakery_dessert');
    const none = matchSynergies(make([['cream', 30]]), data);
    expect(none.active).not.toContain('bakery_dessert');
    expect(none.faint).not.toContain('bakery_dessert');
  });
  it('adds its bonus', () => {
    const without = computeProfile(make([['cream', 30], ['caramel', 30]]), data).profile;
    const withSyn = computeProfile(make([['cream', 30], ['vanilla_custard', 30]]), data).profile;
    expect(withSyn.richness).toBeGreaterThan(without.richness);
  });
});

describe('runTest', () => {
  const p = make([['strawberry', 40], ['cream', 30]]);
  it('same seed + same inputs = same output', () => {
    expect(runTest(p, data)).toEqual(runTest(JSON.parse(JSON.stringify(p)), data));
  });
  it('different seed can change the panel', () => {
    const a = runTest(p, data);
    const b = runTest({ ...p, seed: 99 }, data);
    expect(a.reactions.map((r) => r.score)).not.toEqual(b.reactions.map((r) => r.score));
  });
  it('produces 3+ comment cards and discovers synergies', () => {
    const r = runTest(p, data, []);
    expect(r.reactions.length).toBeGreaterThanOrEqual(3);
    for (const c of r.reactions) expect(c.comment.length).toBeGreaterThan(0);
    expect(r.newlyDiscovered).toContain('fruity_dessert');
    expect(r.reactions.some((c) => c.hintSynergy === 'fruity_dessert')).toBe(true);
    expect(runTest(p, data, ['fruity_dessert']).newlyDiscovered).toEqual([]);
  });
  it('ice fan prefers cold products', () => {
    const iceFan = (x: Product) => runTest(x, data).reactions.find((r) => r.customerId === 'ice_fan')!.score;
    expect(iceFan(make([['mint', 50], ['citrus', 20]], { base: 'menthol_ice' }))).toBeGreaterThan(iceFan(make([['caramel', 50]], { base: 'dessert' })));
  });
  it('budget buyer is price-sensitive', () => {
    const at = (price: number) => runTest(make([['strawberry', 40]], { brand: { ...newProduct().brand, price } }), data)
      .reactions.find((r) => r.customerId === 'budget_buyer')!.score;
    expect(at(8)).toBeGreaterThan(at(40));
  });
  it('dependence raises repeat purchase and reputation risk', () => {
    const lo = runTest(make([['mango', 40]]), data);
    const hi = runTest(make([['mango', 40]], { tuning: { ...newProduct().tuning, dependence: 90 } }), data);
    expect(hi.repeatPurchase).toBeGreaterThan(lo.repeatPurchase);
    expect(hi.reputationRisk).toBeGreaterThan(lo.reputationRisk);
  });
  it('unit cost is positive and premium costs more', () => {
    const std = unitCost(p, data).total;
    const prem = unitCost({ ...p, brand: { ...p.brand, tier: 'premium', style: 'luxe' } }, data).total;
    expect(std).toBeGreaterThan(0);
    expect(prem).toBeGreaterThan(std);
  });
});

describe('auto', () => {
  it('is deterministic and never worse than its start', () => {
    const start = make([['strawberry', 40]]);
    const opts = { strategy: 'improve' as const, iterations: 40, seed: 7 };
    const a = runAuto(start, data, [], opts);
    const b = runAuto(start, data, [], opts);
    expect(a.best.product).toEqual(b.best.product);
    expect(a.best.score).toBeGreaterThanOrEqual(a.steps[0].score);
  });
  it('segment strategy improves the target customer', () => {
    const start = make([['caramel', 50]], { base: 'dessert' });
    const r = runAuto(start, data, [], { strategy: 'segment', target: 'ice_fan', iterations: 80, seed: 3 });
    const iceScore = (x: typeof r.best) => x.result.reactions.find((c) => c.customerId === 'ice_fan')!.score;
    expect(iceScore(r.best)).toBeGreaterThanOrEqual(iceScore(r.steps[0]));
  });
});

describe('assist', () => {
  it('warns about clashes and suggests completing known synergies', () => {
    const a = advise(make([['coffee', 30], ['bubblegum', 30]]), data, []);
    expect(a.warnings.some((w) => w.includes('clash'))).toBe(true);
    const b = advise(make([['cream', 30]]), data, ['bakery_dessert']);
    expect(b.suggestions.some((s) => s.includes('Smooth Dessert'))).toBe(true);
  });
});

describe('data integrity', () => {
  it('has the planned counts and valid references', () => {
    expect(data.notes).toHaveLength(13);
    expect(data.bases).toHaveLength(7);
    expect(data.customers).toHaveLength(6);
    expect(data.synergies.length).toBeGreaterThanOrEqual(6);
    const noteIds = new Set(data.notes.map((n) => n.id));
    const baseIds = new Set(data.bases.map((b) => b.id));
    for (const n of data.notes) for (const c of n.clashesWith) expect(noteIds.has(c)).toBe(true);
    for (const s of data.synergies) for (const req of s.needs) for (const tok of req.split('|')) {
      if (tok.startsWith('base:')) expect(baseIds.has(tok.slice(5))).toBe(true);
      else if (!tok.startsWith('tag:')) expect(noteIds.has(tok)).toBe(true);
    }
    for (const b of data.bases) for (const c of data.customers) expect(b.appeal[c.id]).toBeGreaterThan(0);
    for (const c of data.customers) {
      expect(c.comments.neutral?.length).toBeGreaterThan(0);
      for (const t of c.terms) {
        const hasAny = [`${t.label}+`, `${t.label}-`].some((k) => c.comments[k]);
        expect(hasAny).toBe(true);
      }
    }
  });
});
