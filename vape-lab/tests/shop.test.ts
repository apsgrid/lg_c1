import { describe, expect, it } from 'vitest';
import { GAME_DATA as data } from '../src/data';
import {
  addListing, beginDay, canUpgrade, faultChance, ID_FINE, KNOCKOFF_AT, migrateShop, newProduct, newShop, orderStock,
  productId, resolve, reviseListing, setVigilance, simulateDay, step, unitCost, upgradeShop,
  type DaySession, type Encounter, type Product, type ShopState,
} from '../src/sim';

function product(name: string, notes: [string, number][], seed = 1, brand: Partial<Product['brand']> = {}): Product {
  const p = newProduct(seed);
  p.brand = { ...p.brand, name, ...brand };
  p.notes = notes.map(([noteId, amount]) => ({ noteId, amount }));
  p.id = productId(p);
  return p;
}

function stocked(tier = 0, cash = 300): ShopState {
  let s = { ...newShop(123), tier, cash };
  s = addListing(s, product('Berry Cream', [['strawberry', 40], ['cream', 30]]), data);
  s = addListing(s, product('Citrus Chill', [['citrus', 35], ['mint', 25]], 2), data);
  s = orderStock(s, 0, 20, data);
  s = orderStock(s, 1, 20, data);
  return { ...s, listings: s.listings.map((l) => ({ ...l, autoRestockTo: 20 })) };
}

function run(s: ShopState, days: number, choose?: (e: Encounter, sess: DaySession) => string): ShopState {
  for (let i = 0; i < days; i++) s = simulateDay(s, data, choose).shop;
  return s;
}

/** Plays every day, collecting each encounter kind seen. */
function encountersSeen(s: ShopState, days: number): Set<string> {
  const seen = new Set<string>();
  run(s, days, (e) => { seen.add(e.kind); return e.kind === 'id' ? 'check' : e.kind === 'return' ? 'refund' : e.kind === 'probe' ? 'vague' : e.kind === 'shoplift' ? 'ignore' : 'browse'; });
  return seen;
}

describe('shop basics', () => {
  it('starts as a car boot with 2 slots', () => {
    const s = newShop(1);
    expect(s.tier).toBe(0);
    let t = addListing(s, product('A', [['mango', 40]]), data);
    t = addListing(t, product('B', [['mint', 40]], 2), data);
    t = addListing(t, product('C', [['cola', 40]], 3), data);
    expect(t.listings).toHaveLength(2);
  });
  it('orders are paid now and delivered next morning', () => {
    const s = stocked();
    const cost = unitCost(s.listings[0].product, data).total * 20 + unitCost(s.listings[1].product, data).total * 20;
    expect(s.cash).toBeCloseTo(300 - cost, 1);
    const sess = beginDay(s, data);
    expect(sess.shop.listings[0].stock).toBe(20);
    expect(sess.events.some((e) => e.kind === 'delivery')).toBe(true);
  });
  it('is deterministic', () => {
    expect(simulateDay(stocked(2), data)).toEqual(simulateDay(stocked(2), data));
  });
  it('earns money and builds regulars over time', () => {
    const after = run(stocked(), 20);
    expect(after.history).toHaveLength(20);
    expect(after.history.reduce((t, d) => t + d.revenue, 0)).toBeGreaterThan(0);
    expect(after.regulars.length).toBeGreaterThan(0);
  });
  it('migrates v1 saves to a small store', () => {
    const old = { ...newShop(1), version: 1 } as unknown as Record<string, unknown>;
    delete old.tier;
    delete old.pendingReturns;
    const m = migrateShop(old);
    expect(m.tier).toBe(2);
    expect(m.pendingReturns).toEqual([]);
  });
});

describe('progression', () => {
  it('needs cash and reputation, then unlocks more slots', () => {
    const s = newShop(1);
    expect(canUpgrade(s).ok).toBe(false);
    const rich = { ...s, cash: 1000, reputation: 60 };
    expect(canUpgrade(rich).ok).toBe(true);
    const up = upgradeShop(rich);
    expect(up.tier).toBe(1);
    expect(up.cash).toBe(500);
    expect(upgradeShop({ ...s, cash: 1000, reputation: 40 }).tier).toBe(0);
  });
  it('no rivals or shoplifters at the car boot', () => {
    const seen = encountersSeen(stocked(0), 25);
    expect(seen.has('shoplift')).toBe(false);
    const after = run(stocked(0), 25);
    for (const r of after.rivals) expect(Object.keys(r.knowledge)).toHaveLength(0);
  });
  it('bigger shops bring more visitors', () => {
    const visitors = (tier: number) => run(stocked(tier, 5000), 10).history.reduce((t, d) => t + d.visitors, 0);
    expect(visitors(4)).toBeGreaterThan(visitors(0));
  });
});

describe('encounters', () => {
  it('shows recommendations, ID checks, probes and shoplifters at a bigger shop', () => {
    const seen = encountersSeen(stocked(4, 5000), 30);
    for (const k of ['recommend', 'id', 'probe', 'shoplift']) expect(seen.has(k)).toBe(true);
  });
  it('serving a minor is fined; checking ID refuses them', () => {
    let fined = 0, refused = 0;
    run(stocked(0), 30, (e, sess) => {
      if (e.kind !== 'id') return 'browse';
      const v = sess.visitors[sess.pos];
      if (v.age < 18) {
        const served = resolve(sess, 'serve', data);
        if (served.session.fines >= ID_FINE) fined++;
        const checked = resolve(sess, 'check', data);
        if (checked.visit.walkout === 'underage') refused++;
      }
      return 'check';
    });
    expect(fined).toBeGreaterThan(0);
    expect(refused).toBe(fined);
  });
  it('catching the right shoplifter beats accusing the wrong one', () => {
    let tested = 0;
    run(stocked(4, 5000), 30, (e, sess) => {
      if (e.kind === 'shoplift') {
        const v = sess.visitors[sess.pos];
        const right = resolve(sess, `stop:${v.thiefSlot}`, data);
        const wrongSlot = ((v.thiefSlot ?? 0) + 1) % 3;
        const wrong = resolve(sess, `stop:${wrongSlot}`, data);
        expect(right.session.shop.reputation).toBeGreaterThan(wrong.session.shop.reputation);
        expect(right.outcome.tone).toBe('good');
        tested++;
      }
      return e.kind === 'id' ? 'check' : 'browse';
    });
    expect(tested).toBeGreaterThan(0);
  });
  it('a good recommendation earns more goodwill than a bad one', () => {
    let compared = 0;
    run(stocked(2, 2000), 20, (e, sess) => {
      if (e.kind === 'recommend') {
        const recs = e.options.filter((o) => o.id.startsWith('rec:'));
        const results = recs.map((o) => resolve(sess, o.id, data));
        const reps = results.map((r) => r.session.shop.reputation);
        if (Math.max(...reps) > Math.min(...reps)) compared++;
      }
      return e.kind === 'id' ? 'check' : 'browse';
    });
    expect(compared).toBeGreaterThan(0);
  });
});

describe('disposables', () => {
  it('cost less, fail more, and come back as returns', () => {
    const refill = product('R', [['mango', 40]], 1, { format: 'refillable', tier: 'budget' });
    const disp = product('D', [['mango', 40]], 1, { format: 'disposable', tier: 'budget' });
    expect(unitCost(disp, data).total).toBeLessThan(unitCost(refill, data).total);
    expect(faultChance(disp)).toBeGreaterThan(faultChance(refill) * 4);
    let s = { ...newShop(9), cash: 2000 };
    s = addListing(s, disp, data);
    s = orderStock(s, 0, 40, data);
    s = { ...s, listings: s.listings.map((l) => ({ ...l, autoRestockTo: 40 })) };
    let returns = 0;
    run(s, 15, (e) => { if (e.kind === 'return') returns++; return e.kind === 'id' ? 'check' : e.kind === 'return' ? 'refund' : 'browse'; });
    expect(returns).toBeGreaterThan(0);
  });
  it('refusing a refund hurts reputation more than refunding', () => {
    let s = { ...newShop(9), cash: 2000 };
    s = addListing(s, product('D', [['mango', 40]], 1, { format: 'disposable', tier: 'budget' }), data);
    s = orderStock(s, 0, 40, data);
    s = { ...s, listings: s.listings.map((l) => ({ ...l, autoRestockTo: 40 })) };
    let checked = false;
    run(s, 15, (e, sess) => {
      if (e.kind === 'return' && !checked) {
        checked = true;
        expect(resolve(sess, 'refuse', data).session.shop.reputation).toBeLessThan(resolve(sess, 'refund', data).session.shop.reputation);
      }
      return e.kind === 'id' ? 'check' : e.kind === 'return' ? 'refund' : 'browse';
    });
    expect(checked).toBe(true);
  });
});

describe('rivals', () => {
  it('learn formulas and launch knock-offs; revising shakes them off', () => {
    let s = run(stocked(2, 3000), 40);
    const ko = s.rivals.flatMap((r) => r.knockoffs);
    expect(ko.length).toBeGreaterThan(0);
    const target = s.listings.findIndex((l) => l.product.id === ko[0].productId);
    const revised = { ...s.listings[target].product, tuning: { ...s.listings[target].product.tuning, smoothness: 77 } };
    revised.id = productId(revised);
    s = reviseListing(s, target, revised);
    for (const rival of s.rivals) expect(rival.knowledge[revised.id] ?? 0).toBeLessThan(KNOCKOFF_AT);
  });
  it('explaining recipes to a rival teaches them more than staying vague', () => {
    const know = (answer: string) => run(stocked(2, 3000), 20, (e) => (e.kind === 'probe' ? answer : e.kind === 'id' ? 'check' : 'browse'))
      .rivals.reduce((t, r) => t + Object.values(r.knowledge).reduce((a, b) => a + b, 0), 0);
    expect(know('explain')).toBeGreaterThan(know('vague'));
  });
  it('security catches more secret shoppers', () => {
    const caught = (v: 0 | 2) => run(setVigilance(stocked(2, 100000), v), 40).rivals.reduce((t, r) => t + r.caught, 0);
    expect(caught(2)).toBeGreaterThan(caught(0));
  });
});

describe('step', () => {
  it('serves until done and never loops forever', () => {
    let sess = beginDay(stocked(3, 3000), data);
    let n = 0;
    for (;;) {
      const r = step(sess, data);
      sess = r.session;
      if (r.done) break;
      if (r.encounter) sess = resolve(sess, r.encounter.options[0].id, data).session;
      if (++n > 400) throw new Error('loop');
    }
    expect(sess.pos).toBe(sess.visitors.length);
  });
});
