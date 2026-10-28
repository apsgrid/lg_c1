// Day-by-day shop simulation. Pure and seeded like the rest of sim/: the same
// shop state + same day always plays out the same way.
import { unitCost } from './cost';
import { productId } from './id';
import { deriveSeed, mulberry32, rngPick, rngRange, type Rng } from './rng';
import { runTest } from './test';
import type { CustomerId, GameData, Product, TestResult } from './types';
import { clamp, round1, round2 } from './util';

export const SHELF_SLOTS = 6;
export const MAX_STOCK = 60;
export const RENT_PER_DAY = 40;
export const START_CASH = 600;
export const MAX_REGULARS = 10;
export const VIGILANCE = [
  { label: 'None', wage: 0, catchChance: 0.08 },
  { label: 'Watchful staff', wage: 25, catchChance: 0.35 },
  { label: 'Security guard', wage: 55, catchChance: 0.65 },
] as const;
/** Rival knowledge (0-100) at which they launch a knock-off. */
export const KNOCKOFF_AT = 70;

export interface Listing {
  product: Product;
  price: number;
  stock: number;
  incoming: number;
  autoRestockTo: number;
  soldTotal: number;
}

export interface Regular {
  id: string;
  name: string;
  archetype: CustomerId;
  loyalty: number;
  favourite?: string;          // product id
  visits: number;
  joinedDay: number;
  lastVisitDay: number;
  gone: boolean;
}

export interface Knockoff {
  productId: string;
  name: string;
  day: number;
}

export interface Rival {
  id: string;
  name: string;
  colour: string;
  aggression: number;          // 0-1: how often they send secret shoppers
  knowledge: Record<string, number>;
  knockoffs: Knockoff[];
  bannedUntil: number;
  caught: number;
}

export interface Visit {
  name: string;
  archetype: CustomerId;
  regularId?: string;
  rivalId?: string;
  productId?: string;          // what they bought
  qty: number;
  spent: number;
  walkout?: 'stockout' | 'nothing' | 'banned';
  tell?: string;
  caught?: boolean;
}

export type DayEventKind =
  | 'delivery' | 'stockout' | 'regular_join' | 'regular_leave' | 'caught' | 'knockoff' | 'suspicious' | 'restock' | 'broke';

export interface DayEvent {
  kind: DayEventKind;
  text: string;
}

export interface DayReport {
  day: number;
  visitors: number;
  buyers: number;
  revenue: number;
  wages: number;
  rent: number;
  restockSpend: number;
  profit: number;
  cashEnd: number;
  reputationStart: number;
  reputationEnd: number;
  sales: Record<string, number>;
  visits: Visit[];
  events: DayEvent[];
}

export interface DaySummary {
  day: number;
  revenue: number;
  profit: number;
  cash: number;
  reputation: number;
  visitors: number;
}

export interface ShopState {
  version: 1;
  name: string;
  seed: number;
  day: number;                 // next day to open
  cash: number;
  reputation: number;
  vigilance: 0 | 1 | 2;
  listings: Listing[];
  regulars: Regular[];
  rivals: Rival[];
  history: DaySummary[];
  spentSinceOpen: number;      // restock spend between days, reported on the next day
  nextRegularId: number;
}

const FIRST = ['Ash', 'Bex', 'Cal', 'Dee', 'Eli', 'Fran', 'Gus', 'Hana', 'Ivo', 'Jo', 'Kit', 'Lou', 'Mo', 'Nia', 'Oz', 'Pip', 'Quin', 'Rae', 'Sid', 'Tam', 'Uma', 'Vic', 'Wren', 'Zed'];
const NICK = ['the Cloud', 'from Upstairs', 'Two-Bags', 'the Regular', 'in the Hoodie', 'with the Dog', 'Big Puff', 'the Critic', 'Night Shift', 'the Student', 'from the Garage', 'Quiet'];
const TELLS = [
  'took photos of the shelf', 'asked what goes into the mix', 'bought one and left without trying it',
  'wrote notes at the counter', 'asked who designs your flavours', 'sniffed every bottle on display',
];
const INNOCENT_TELLS = ['asked lots of questions', 'took a photo of the shop sign', 'browsed for ages'];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function newShop(seed: number, name = 'My Vape Store'): ShopState {
  return {
    version: 1,
    name,
    seed: seed >>> 0,
    day: 1,
    cash: START_CASH,
    reputation: 50,
    vigilance: 0,
    listings: [],
    regulars: [],
    rivals: [
      { id: 'cloud_kings', name: 'Cloud Kings', colour: '#ff5a5a', aggression: 0.8, knowledge: {}, knockoffs: [], bannedUntil: 0, caught: 0 },
      { id: 'mist_co', name: 'Mist & Co.', colour: '#5ad7ff', aggression: 0.5, knowledge: {}, knockoffs: [], bannedUntil: 0, caught: 0 },
      { id: 'puff_palace', name: 'Puff Palace', colour: '#ffb020', aggression: 0.3, knowledge: {}, knockoffs: [], bannedUntil: 0, caught: 0 },
    ],
    history: [],
    spentSinceOpen: 0,
    nextRegularId: 1,
  };
}

// --- Player actions (pure: each returns a new state) ---------------------------------

export function addListing(shop: ShopState, product: Product, data: GameData): ShopState {
  const s = clone(shop);
  if (s.listings.length >= SHELF_SLOTS) return s;
  if (s.listings.some((l) => l.product.id === product.id)) return s;
  const cost = unitCost(product, data).total;
  s.listings.push({
    product: clone(product),
    price: round1(Math.max(product.brand.price, cost + 1)),
    stock: 0, incoming: 0, autoRestockTo: 0, soldTotal: 0,
  });
  return s;
}

export function removeListing(shop: ShopState, index: number): ShopState {
  const s = clone(shop);
  s.listings.splice(index, 1);
  return s;
}

export function setPrice(shop: ShopState, index: number, price: number): ShopState {
  const s = clone(shop);
  if (s.listings[index]) s.listings[index].price = round1(clamp(price, 3, 60));
  return s;
}

export function setAutoRestock(shop: ShopState, index: number, target: number): ShopState {
  const s = clone(shop);
  if (s.listings[index]) s.listings[index].autoRestockTo = clamp(Math.round(target), 0, MAX_STOCK);
  return s;
}

export function setVigilance(shop: ShopState, v: 0 | 1 | 2): ShopState {
  return { ...clone(shop), vigilance: v };
}

/** Largest order the shop can afford and fit for this listing. */
export function maxOrder(shop: ShopState, index: number, data: GameData): number {
  const l = shop.listings[index];
  if (!l) return 0;
  const cost = unitCost(l.product, data).total;
  return Math.max(0, Math.min(MAX_STOCK - l.stock - l.incoming, Math.floor(shop.cash / cost)));
}

/** Pay now, delivered next morning. */
export function orderStock(shop: ShopState, index: number, qty: number, data: GameData): ShopState {
  const s = clone(shop);
  const l = s.listings[index];
  if (!l) return s;
  const n = Math.min(Math.max(0, Math.floor(qty)), maxOrder(shop, index, data));
  if (n <= 0) return s;
  const cost = round2(unitCost(l.product, data).total * n);
  s.cash = round2(s.cash - cost);
  s.spentSinceOpen = round2(s.spentSinceOpen + cost);
  l.incoming += n;
  return s;
}

/**
 * Swap a listing's formula for a revised one (e.g. after a rival knock-off).
 * Stock carries over; rivals keep only part of what they learned.
 */
export function reviseListing(shop: ShopState, index: number, product: Product): ShopState {
  const s = clone(shop);
  const l = s.listings[index];
  if (!l || l.product.id === product.id) return s;
  for (const r of s.rivals) {
    const k = r.knowledge[l.product.id];
    if (k) r.knowledge[product.id] = Math.max(r.knowledge[product.id] ?? 0, round1(k * 0.4));
  }
  l.product = clone(product);
  return s;
}

// --- Day simulation ------------------------------------------------------------------

function regularName(rng: Rng): string {
  return `${rngPick(rng, FIRST)} ${rngPick(rng, NICK)}`;
}

function knockoffName(name: string, rng: Rng): string {
  const swaps: [RegExp, string][] = [[/oo/i, 'u'], [/er/i, 'ur'], [/c/i, 'k'], [/s\b/i, 'z'], [/y\b/i, 'ee'], [/ph/i, 'f'], [/o/i, '0']];
  let out = name || 'Untitled';
  for (const [re, rep] of swaps) if (re.test(out) && rng() < 0.6) out = out.replace(re, rep);
  if (out === name) out = `${name} 2`;
  return out;
}

export interface DayResult {
  shop: ShopState;
  report: DayReport;
}

export function simulateDay(input: ShopState, data: GameData): DayResult {
  const shop = clone(input);
  const day = shop.day;
  const rng = mulberry32(deriveSeed(shop.seed, `day:${day}`));
  const events: DayEvent[] = [];
  const visits: Visit[] = [];
  const sales: Record<string, number> = {};
  const repStart = shop.reputation;
  let revenue = 0;
  let rep = shop.reputation;

  // Morning deliveries.
  for (const l of shop.listings) {
    if (l.incoming > 0) {
      events.push({ kind: 'delivery', text: `${l.incoming} × ${l.product.brand.name || 'Untitled'} delivered.` });
      l.stock += l.incoming;
      l.incoming = 0;
    }
  }

  // How each archetype rates each listing at its shelf price (same panel as the lab).
  const tests = new Map<string, TestResult>();
  const testFor = (l: Listing): TestResult => {
    const key = `${l.product.id}@${l.price}`;
    let t = tests.get(key);
    if (!t) {
      t = runTest({ ...l.product, brand: { ...l.product.brand, price: l.price } }, data);
      tests.set(key, t);
    }
    return t;
  };
  const knockedOff = (pid: string) => shop.rivals.some((r) => r.knockoffs.some((k) => k.productId === pid));
  const rate = (l: Listing, archetype: CustomerId, regular?: Regular): number => {
    const t = testFor(l);
    let s = t.reactions.find((r) => r.customerId === archetype)?.score ?? 40;
    s += (rep - 50) * 0.1;
    if (knockedOff(l.product.id)) s -= regular ? 3 : 10;
    if (regular?.favourite === l.product.id) s += 8 + regular.loyalty * 0.05;
    return s;
  };

  const sell = (l: Listing, qty: number): number => {
    const n = Math.min(qty, l.stock);
    l.stock -= n;
    l.soldTotal += n;
    sales[l.product.id] = (sales[l.product.id] ?? 0) + n;
    const spent = round2(n * l.price);
    revenue += spent;
    const risk = testFor(l).reputationRisk;
    if (risk > 30) rep -= (risk - 30) * 0.02 * n;
    return spent;
  };

  /** One shopper picks the best-rated item in stock and maybe buys it. */
  const shopFor = (archetype: CustomerId, regular?: Regular): { listing?: Listing; score: number; walkout?: 'stockout' | 'nothing' } => {
    const fav = regular?.favourite ? shop.listings.find((l) => l.product.id === regular.favourite) : undefined;
    if (fav && fav.stock <= 0) return { score: 0, walkout: 'stockout' };
    const options = shop.listings.filter((l) => l.stock > 0).map((l) => ({ l, s: rate(l, archetype, regular) }));
    if (!options.length) return { score: 0, walkout: 'stockout' };
    options.sort((a, b) => b.s - a.s);
    const best = options[0];
    const p = clamp((best.s - 35) / 45, 0.04, 0.95);
    return rng() < p ? { listing: best.l, score: best.s } : { score: best.s, walkout: 'nothing' };
  };

  // Regulars drop by depending on loyalty (and how habit-forming their favourite is).
  for (const r of shop.regulars.filter((x) => !x.gone)) {
    const favListing = shop.listings.find((l) => l.product.id === r.favourite);
    const repeat = favListing ? testFor(favListing).repeatPurchase : 30;
    if (rng() > 0.25 + r.loyalty / 200 + repeat / 400) {
      r.loyalty = clamp(r.loyalty - 0.5);
      continue;
    }
    r.visits++;
    r.lastVisitDay = day;
    const res = shopFor(r.archetype, r);
    if (res.listing) {
      const qty = repeat > 60 && rng() < 0.5 ? 2 : 1;
      const spent = sell(res.listing, qty);
      r.loyalty = clamp(r.loyalty + (res.score - 55) * 0.3);
      if (!r.favourite || res.score > 70) r.favourite = res.listing.product.id;
      if (res.score > 65) rep += 0.12;
      visits.push({ name: r.name, archetype: r.archetype, regularId: r.id, productId: res.listing.product.id, qty, spent });
    } else {
      if (res.walkout === 'stockout') {
        r.loyalty = clamp(r.loyalty - 8);
        rep -= 0.4;
        const favName = favListing?.product.brand.name ?? 'their usual';
        events.push({ kind: 'stockout', text: `${r.name} came for ${favName} but it was sold out.` });
      } else r.loyalty = clamp(r.loyalty - 2);
      visits.push({ name: r.name, archetype: r.archetype, regularId: r.id, qty: 0, spent: 0, walkout: res.walkout });
    }
  }

  // Walk-ins.
  const walkIns = Math.max(2, Math.round(4 + rep / 8 + rngRange(rng, 0, 4)));
  for (let i = 0; i < walkIns; i++) {
    const c = rngPick(rng, data.customers);
    const res = shopFor(c.id);
    const tell = rng() < 0.08 ? rngPick(rng, INNOCENT_TELLS) : undefined;
    if (res.listing) {
      const spent = sell(res.listing, 1);
      if (res.score > 65) rep += 0.12;
      visits.push({ name: c.name, archetype: c.id, productId: res.listing.product.id, qty: 1, spent, tell });
      const active = shop.regulars.filter((x) => !x.gone).length;
      if (res.score > 70 && active < MAX_REGULARS && rng() < 0.35) {
        const r: Regular = {
          id: `R${shop.nextRegularId++}`, name: regularName(rng), archetype: c.id, loyalty: 45,
          favourite: res.listing.product.id, visits: 1, joinedDay: day, lastVisitDay: day, gone: false,
        };
        shop.regulars.push(r);
        events.push({ kind: 'regular_join', text: `${r.name} (${c.name}) loved ${res.listing.product.brand.name} and says they'll be back.` });
      }
    } else {
      visits.push({ name: c.name, archetype: c.id, qty: 0, spent: 0, walkout: res.walkout, tell });
    }
  }

  // Secret shoppers from rival stores.
  const catchChance = VIGILANCE[shop.vigilance].catchChance;
  for (const rival of shop.rivals) {
    if (rng() > 0.1 + rival.aggression * 0.25) continue;
    const disguise = rngPick(rng, data.customers);
    const tell = rngPick(rng, TELLS);
    if (rival.bannedUntil >= day) {
      visits.push({ name: disguise.name, archetype: disguise.id, rivalId: rival.id, qty: 0, spent: 0, walkout: 'banned', tell: 'was turned away at the door' });
      events.push({ kind: 'caught', text: `Staff recognised a ${rival.name} shopper and turned them away.` });
      continue;
    }
    const targets = shop.listings.filter((l) => l.stock > 0).sort((a, b) => b.soldTotal - a.soldTotal || b.price - a.price);
    const target = targets[0];
    if (!target) continue;
    const spent = sell(target, 1);
    const caught = rng() < catchChance;
    const visit: Visit = { name: disguise.name, archetype: disguise.id, rivalId: rival.id, productId: target.product.id, qty: 1, spent, tell, caught };
    visits.push(visit);
    if (caught) {
      rival.caught++;
      rival.bannedUntil = day + 5;
      events.push({ kind: 'caught', text: `Caught a secret shopper from ${rival.name} (they ${tell}). Banned for 5 days.` });
      continue;
    }
    events.push({ kind: 'suspicious', text: `A "${disguise.name}" ${tell}.` });
    const pid = target.product.id;
    const complexity = testFor(target).profile.complexity;
    const gain = rngRange(rng, 16, 30) * (1 - complexity / 250);
    rival.knowledge[pid] = round1(clamp((rival.knowledge[pid] ?? 0) + gain));
    if (rival.knowledge[pid] >= KNOCKOFF_AT && !rival.knockoffs.some((k) => k.productId === pid)) {
      const name = knockoffName(target.product.brand.name, rng);
      rival.knockoffs.push({ productId: pid, name, day });
      rep -= 2;
      events.push({ kind: 'knockoff', text: `${rival.name} launched “${name}”, a knock-off of ${target.product.brand.name}. Revise the formula in the lab to shake them off.` });
    }
  }

  // Loyalty decay and departures.
  for (const r of shop.regulars) {
    if (!r.gone && r.loyalty < 8) {
      r.gone = true;
      events.push({ kind: 'regular_leave', text: `${r.name} has stopped coming in.` });
    }
  }

  // Close: wages, rent, auto-restock for tomorrow.
  const wages = VIGILANCE[shop.vigilance].wage;
  const restockBefore = shop.spentSinceOpen;
  shop.cash = round2(shop.cash + revenue - wages - RENT_PER_DAY);
  shop.spentSinceOpen = 0;
  // Word of mouth fades: reputation drifts back toward 50 unless you keep earning it.
  rep += (50 - rep) * 0.05;
  shop.reputation = round1(clamp(rep));
  shop.day = day + 1;

  let next: ShopState = shop;
  next.listings.forEach((l, i) => {
    const want = l.autoRestockTo - l.stock - l.incoming;
    if (want > 0) {
      const before = next.cash;
      next = orderStock(next, i, want, data);
      const got = next.listings[i].incoming - l.incoming;
      if (got > 0) events.push({ kind: 'restock', text: `Auto-ordered ${got} × ${l.product.brand.name} (${round2(before - next.cash)} cr).` });
    }
  });
  if (next.cash < 0) events.push({ kind: 'broke', text: 'The shop is in debt. Cut costs or raise prices.' });

  const buyers = visits.filter((v) => v.qty > 0).length;
  const report: DayReport = {
    day,
    visitors: visits.length,
    buyers,
    revenue: round2(revenue),
    wages,
    rent: RENT_PER_DAY,
    restockSpend: restockBefore,
    profit: round2(revenue - wages - RENT_PER_DAY - restockBefore),
    cashEnd: next.cash,
    reputationStart: repStart,
    reputationEnd: next.reputation,
    sales,
    visits,
    events,
  };
  next.history = [...next.history, {
    day, revenue: report.revenue, profit: report.profit, cash: next.cash, reputation: next.reputation, visitors: visits.length,
  }].slice(-60);
  return { shop: next, report };
}

/** Staff estimate of what a rival knows: rounded to the nearest 25, only with staff on. */
export function intelEstimate(shop: ShopState, rival: Rival, pid: string): number | null {
  if (shop.vigilance === 0) return null;
  const k = rival.knowledge[pid] ?? 0;
  return shop.vigilance === 2 ? Math.round(k / 10) * 10 : Math.round(k / 25) * 25;
}

/** Re-key helper so callers can check whether a product changed since listing. */
export function sameFormula(a: Product, b: Product): boolean {
  return productId(a) === productId(b);
}

