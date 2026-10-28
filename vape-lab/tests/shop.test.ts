import { describe, expect, it } from 'vitest';
import { GAME_DATA as data } from '../src/data';
import {
  addListing, KNOCKOFF_AT, newProduct, newShop, orderStock, productId, reviseListing, setVigilance, simulateDay, unitCost,
  type Product, type ShopState,
} from '../src/sim';

function product(name: string, notes: [string, number][], seed = 1): Product {
  const p = newProduct(seed);
  p.brand.name = name;
  p.notes = notes.map(([noteId, amount]) => ({ noteId, amount }));
  p.id = productId(p);
  return p;
}

function stocked(): ShopState {
  let s = newShop(123);
  s = addListing(s, product('Berry Cream', [['strawberry', 40], ['cream', 30]]), data);
  s = addListing(s, product('Citrus Chill', [['citrus', 35], ['mint', 25]], 2), data);
  s = orderStock(s, 0, 20, data);
  s = orderStock(s, 1, 20, data);
  return s;
}

function run(s: ShopState, days: number): ShopState {
  for (let i = 0; i < days; i++) s = simulateDay(s, data).shop;
  return s;
}

describe('shop', () => {
  it('orders are paid now and delivered next morning', () => {
    const s = stocked();
    const cost = unitCost(s.listings[0].product, data).total * 20 + unitCost(s.listings[1].product, data).total * 20;
    expect(s.cash).toBeCloseTo(600 - cost, 1);
    expect(s.listings[0].stock).toBe(0);
    const { shop, report } = simulateDay(s, data);
    expect(report.events.some((e) => e.kind === 'delivery')).toBe(true);
    expect(shop.listings[0].stock + (report.sales[shop.listings[0].product.id] ?? 0)).toBe(20);
  });
  it('cannot order more than it can afford', () => {
    let s = newShop(1);
    s = addListing(s, product('A', [['mango', 50]]), data);
    s = { ...s, cash: 10 };
    s = orderStock(s, 0, 50, data);
    expect(s.cash).toBeGreaterThanOrEqual(0);
  });
  it('is deterministic', () => {
    const a = simulateDay(stocked(), data);
    const b = simulateDay(stocked(), data);
    expect(a).toEqual(b);
  });
  it('sells stock, earns revenue and builds regulars over time', () => {
    let s = stocked();
    s = { ...s, listings: s.listings.map((l) => ({ ...l, autoRestockTo: 20 })) };
    const after = run(s, 20);
    expect(after.history).toHaveLength(20);
    expect(after.history.reduce((t, d) => t + d.revenue, 0)).toBeGreaterThan(0);
    expect(after.regulars.length).toBeGreaterThan(0);
  });
  it('stockouts upset regulars', () => {
    let s = stocked();
    const fav = s.listings[0].product.id;
    s.regulars.push({ id: 'R1', name: 'Test Regular', archetype: 'fruit_fanatic', loyalty: 100, favourite: fav, visits: 0, joinedDay: 0, lastVisitDay: 0, gone: false });
    s.listings[0].incoming = 0;
    const days = run(s, 3);
    expect(days.regulars[0].loyalty).toBeLessThan(100);
  });
  it('rivals learn formulas and launch knock-offs; revising shakes them off', () => {
    let s = stocked();
    s = { ...s, listings: s.listings.map((l) => ({ ...l, autoRestockTo: 30 })) };
    s = run(s, 40);
    const ko = s.rivals.flatMap((r) => r.knockoffs);
    expect(ko.length).toBeGreaterThan(0);
    const target = s.listings.findIndex((l) => l.product.id === ko[0].productId);
    const revised = { ...s.listings[target].product, tuning: { ...s.listings[target].product.tuning, smoothness: 77 } };
    revised.id = productId(revised);
    const r = reviseListing(s, target, revised);
    for (const rival of r.rivals) expect(rival.knowledge[revised.id] ?? 0).toBeLessThan(KNOCKOFF_AT);
  });
  it('security catches more secret shoppers', () => {
    const caught = (v: 0 | 2) => {
      let s = setVigilance(stocked(), v);
      s = { ...s, cash: 100000, listings: s.listings.map((l) => ({ ...l, autoRestockTo: 30 })) };
      return run(s, 40).rivals.reduce((t, r) => t + r.caught, 0);
    };
    expect(caught(2)).toBeGreaterThan(caught(0));
  });
});
