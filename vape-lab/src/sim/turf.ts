// Turf war: every district has a market share split between you, the three
// rival chains and independent corner shops. Shares drift toward each side's
// strength (presence x quality). Rivals act on it: they open branches where
// they're winning, close the ones that are dying, start price wars, and hold a
// grudge when you take their customers. Hold a majority in enough districts and
// you run the city. Pure and seeded like the rest of sim/.
import { distance, haulDays } from './city';
import { unitCost } from './cost';
import { deriveSeed, mulberry32, type Rng } from './rng';
import { runTest } from './test';
import type { GameData, Product } from './types';
import { clamp, round1, round2 } from './util';
import { cityLoc, storageLocId, type DayEvent, type ShopState } from './shop';

export const YOU = 'you';
export const INDIE = 'indie';
export const WIN_DISTRICTS = 6;
export const MAJORITY = 50;
export const BRANCH_COST = 1500;
export const MAX_BRANCHES = 4;
export const BRANCH_MIN_TIER = 4;
export const RIVAL_MAX_STORES = 4;
export const BANKRUPT_AT = -1000;

export type Turf = Record<string, Record<string, number>>;

const INDIE_STRENGTH = 0.6 * 0.35;

export function owners(shop: ShopState): string[] {
  return [YOU, ...shop.rivals.map((r) => r.id), INDIE];
}

/** Where you trade, and how much each site counts. */
export function yourSites(shop: ShopState): { loc: string; weight: number }[] {
  if (shop.tier === 0) return [{ loc: shop.car, weight: 0.4 }];
  if (shop.tier === 1) return [{ loc: shop.home, weight: 0.6 }];
  return [...(shop.store ? [{ loc: shop.store, weight: 1 }] : []), ...(shop.branches ?? []).map((loc) => ({ loc, weight: 0.85 }))];
}

function presenceAt(sites: { loc: string; weight: number }[], locId: string, data: GameData): number {
  const here = cityLoc(data, locId);
  let w = 0;
  for (const s of sites) {
    const d = distance(here, cityLoc(data, s.loc));
    w += s.loc === locId ? s.weight : d < 25 ? s.weight * 0.35 : 0;
  }
  return Math.min(w, 1.4);
}

const fitCache = new Map<string, number>();
/** How well your range suits a district's customers: about -0.1 to +0.2. */
function rangeFit(shop: ShopState, locId: string, data: GameData): number {
  const loc = cityLoc(data, locId);
  const items = shop.listings.filter((l) => l.stock > 0 || l.incoming > 0);
  if (!loc || !items.length) return -0.1;
  const key = `${locId}|${items.map((l) => `${l.product.id}@${l.price}`).join(',')}`;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  let total = 0, weight = 0;
  for (const c of data.customers) {
    const w = loc.mix[c.id] ?? 1;
    let best = 0;
    for (const l of items) {
      const p: Product = { ...l.product, brand: { ...l.product.brand, price: l.price } };
      best = Math.max(best, runTest(p, data).reactions.find((r) => r.customerId === c.id)?.score ?? 0);
    }
    total += best * w;
    weight += w;
  }
  const fit = clamp((total / weight - 50) / 100, -0.1, 0.2);
  if (fitCache.size > 400) fitCache.clear();
  fitCache.set(key, fit);
  return fit;
}

function avgPrice(shop: ShopState): number {
  return shop.listings.length ? shop.listings.reduce((s, l) => s + l.price, 0) / shop.listings.length : 14;
}

/** Each side's strength in a district: presence x quality. */
export function strengths(shop: ShopState, locId: string, data: GameData): Record<string, number> {
  const out: Record<string, number> = {};
  const priceWar = shop.rivals.some((r) => (r.priceWarUntil ?? 0) >= shop.day && r.closedUntil < shop.day && r.stores.includes(locId));
  let q = 0.4 + shop.reputation / 200 + rangeFit(shop, locId, data);
  // A price war bites unless you're already cheap.
  if (priceWar && avgPrice(shop) > 12) q *= 0.8;
  out[YOU] = presenceAt(yourSites(shop), locId, data) * q;
  for (const r of shop.rivals) {
    const open = r.closedUntil < shop.day;
    const rq = (r.strength ?? 0.55) + r.knockoffs.length * 0.03;
    out[r.id] = open ? presenceAt(r.stores.map((loc) => ({ loc, weight: loc === r.loc ? 1 : 0.8 })), locId, data) * rq : 0;
  }
  out[INDIE] = INDIE_STRENGTH;
  return out;
}

function target(str: Record<string, number>): Record<string, number> {
  const pow: Record<string, number> = {};
  let sum = 0;
  for (const [k, v] of Object.entries(str)) {
    pow[k] = Math.max(0, v) ** 1.5;
    sum += pow[k];
  }
  for (const k of Object.keys(pow)) pow[k] = sum > 0 ? (pow[k] / sum) * 100 : 0;
  return pow;
}

/** Shares as they stand, settling them on first use. */
export function turfOf(shop: ShopState, data: GameData): Turf {
  if (shop.turf && Object.keys(shop.turf).length) return shop.turf;
  const t: Turf = {};
  for (const loc of data.city ?? []) {
    const tg = target(strengths(shop, loc.id, data));
    t[loc.id] = Object.fromEntries(Object.entries(tg).map(([k, v]) => [k, round1(v)]));
  }
  return t;
}

export function shareOf(shop: ShopState, data: GameData, locId: string | undefined, owner = YOU): number {
  if (!locId) return 0;
  return turfOf(shop, data)[locId]?.[owner] ?? 0;
}

/** Who leads each district, and whether anyone holds a majority. */
export function leader(shares: Record<string, number> | undefined): { owner: string; share: number } {
  let owner = INDIE, share = 0;
  for (const [k, v] of Object.entries(shares ?? {})) if (v > share) { owner = k; share = v; }
  return { owner, share };
}

/** Districts where an owner has the biggest share (and at least 30%). Lead WIN_DISTRICTS of them to win the city. */
export function districtsLed(shop: ShopState, data: GameData, owner = YOU): string[] {
  const t = turfOf(shop, data);
  return Object.keys(t).filter((loc) => {
    const l = leader(t[loc]);
    return l.owner === owner && l.share >= 30;
  });
}

/** Footfall multiplier from your share where you sell. Holding a district brings the crowds. */
export function shareFootfall(share: number): number {
  return 0.85 + (share / 100) * 0.6;
}

export function isCrackdown(shop: ShopState, locId: string | undefined): boolean {
  return !!locId && (shop.crackdowns?.[locId] ?? 0) >= shop.day;
}

// --- Your chain -------------------------------------------------------------------------

export function branchStatus(shop: ShopState, locId: string): { ok: boolean; reason: string } {
  if (shop.tier < BRANCH_MIN_TIER) return { ok: false, reason: 'Branches open up at the Large store.' };
  const branches = shop.branches ?? [];
  if (branches.includes(locId) || shop.store === locId) return { ok: false, reason: 'You already trade here.' };
  if (branches.length >= MAX_BRANCHES) return { ok: false, reason: `You can run up to ${MAX_BRANCHES} branches.` };
  if (shop.cash < BRANCH_COST) return { ok: false, reason: `Needs ${BRANCH_COST} cr.` };
  return { ok: true, reason: `${BRANCH_COST} cr` };
}

export function openBranch(shop: ShopState, locId: string): ShopState {
  if (!branchStatus(shop, locId).ok) return shop;
  return { ...shop, cash: round2(shop.cash - BRANCH_COST), branches: [...(shop.branches ?? []), locId] };
}

export function closeBranch(shop: ShopState, locId: string): ShopState {
  return { ...shop, branches: (shop.branches ?? []).filter((b) => b !== locId) };
}

export interface TurfDay {
  branchRevenue: number;
  branchRent: number;
  branchFines: number;
}

/**
 * The end-of-day turf update. Mutates the shop it's given (endDay passes its
 * own working copy) and appends events.
 */
export function turfTick(shop: ShopState, data: GameData, day: number, events: DayEvent[]): TurfDay {
  const rng: Rng = mulberry32(deriveSeed(shop.seed, `turf:${day}`));
  const before = turfOf(shop, data);
  const after: Turf = {};
  // 1. Shares drift toward strength.
  for (const loc of data.city ?? []) {
    const tg = target(strengths(shop, loc.id, data));
    const cur = before[loc.id] ?? tg;
    after[loc.id] = {};
    for (const k of Object.keys(tg)) after[loc.id][k] = round1((cur[k] ?? 0) + (tg[k] - (cur[k] ?? 0)) * 0.15);
  }
  shop.turf = after;

  // 2. Rivals hold a grudge for customers you take from them.
  for (const r of shop.rivals) {
    let lost = 0;
    for (const loc of r.stores) lost += Math.max(0, (before[loc]?.[r.id] ?? 0) - (after[loc]?.[r.id] ?? 0));
    r.grudge = round2(r.grudge + lost * 0.05);
  }

  // 3. Rival moves: expand, close dying branches, start price wars.
  for (const r of shop.rivals) {
    if (r.closedUntil >= day) continue;
    r.lowDays = r.lowDays ?? {};
    for (const loc of [...r.stores]) {
      const sh = after[loc]?.[r.id] ?? 0;
      r.lowDays[loc] = sh < 8 ? (r.lowDays[loc] ?? 0) + 1 : 0;
      if (r.lowDays[loc] >= 5 && loc !== r.loc) {
        r.stores = r.stores.filter((x) => x !== loc);
        delete r.lowDays[loc];
        events.push({ kind: 'turf', text: `${r.name} closed their ${cityLoc(data, loc)?.name} branch. The district is up for grabs.` });
      }
    }
    const avg = r.stores.reduce((s, loc) => s + (after[loc]?.[r.id] ?? 0), 0) / Math.max(1, r.stores.length);
    // They only start expanding once you're a real shop, and not every week.
    const canExpand = shop.tier >= 2 && day - (r.lastExpandDay ?? -99) >= 8;
    if (canExpand && r.stores.length < RIVAL_MAX_STORES && avg > 30 && rng() < 0.03 + r.aggression * 0.04) {
      // Go where the customers are, preferring districts you're doing well in.
      const options = (data.city ?? []).filter((l) => !r.stores.includes(l.id)
        && r.stores.some((s) => distance(cityLoc(data, s), l) < 45));
      if (options.length) {
        options.sort((a, b) => ((after[b.id]?.[YOU] ?? 0) + (after[b.id]?.[INDIE] ?? 0)) - ((after[a.id]?.[YOU] ?? 0) + (after[a.id]?.[INDIE] ?? 0)));
        const pick = options[Math.floor(rng() * Math.min(3, options.length))];
        r.stores = [...r.stores, pick.id];
        r.lastExpandDay = day;
        events.push({ kind: 'turf', text: `${r.name} opened a new branch in ${pick.name}.` });
      }
    }
    if ((r.priceWarUntil ?? 0) < day) {
      const contested = r.stores.find((loc) => (after[loc]?.[YOU] ?? 0) > (after[loc]?.[r.id] ?? 0) && (after[loc]?.[YOU] ?? 0) > 20);
      if (contested && rng() < 0.05 + r.grudge * 0.02) {
        r.priceWarUntil = day + 5;
        events.push({ kind: 'turf', text: `${r.name} slashed prices in ${cityLoc(data, contested)?.name} to win back customers. Cut your prices below 12 cr or hit back.` });
      }
    }
  }

  // 4. Winning draws the police. Leading districts raises heat; big leads bring crackdowns.
  shop.crackdowns = shop.crackdowns ?? {};
  const held = Object.keys(after).filter((loc) => {
    const l = leader(after[loc]);
    return l.owner === YOU && l.share >= 30;
  });
  shop.heat = clamp(shop.heat + held.length * 0.5);
  for (const loc of held) {
    const big = (after[loc][YOU] ?? 0) > MAJORITY - 5;
    if (big && (shop.crackdowns[loc] ?? 0) < day && yourSites(shop).some((s) => s.loc === loc) && rng() < 0.06) {
      shop.crackdowns[loc] = day + 5;
      shop.heat = clamp(shop.heat + 6);
      events.push({ kind: 'turf', text: `Police crackdown in ${cityLoc(data, loc)?.name}: you're the biggest seller there now. Extra patrols for 5 days.` });
    }
  }

  // 5. Your branches trade on their own. Your car delivers to them, so their
  // stock is bought at cost as it sells and doesn't empty the main store.
  const out: TurfDay = { branchRevenue: 0, branchRent: 0, branchFines: 0 };
  const range = shop.listings.filter((l) => l.stock > 0 || l.incoming > 0 || l.autoRestockTo > 0);
  let unitsSold = 0;
  if (range.length) {
    const price = range.reduce((t, l) => t + l.price, 0) / range.length;
    const cost = range.reduce((t, l) => t + unitCost(l.product, data).total, 0) / range.length;
    for (const b of shop.branches ?? []) {
      const loc = cityLoc(data, b);
      if (!loc) continue;
      out.branchRent += round1(55 * loc.rent);
      if (isCrackdown(shop, b) && rng() < 0.15 + (shop.heat / 100) * 0.4) {
        out.branchFines += 150;
        events.push({ kind: 'fine', text: `Police raided your ${loc.name} branch during the crackdown: 150 cr fine, no sales there today.` });
        continue;
      }
      const supply = 1 - 0.15 * haulDays(distance(cityLoc(data, storageLocId(shop)), loc));
      const units = Math.round(10 * loc.footfall * ((after[b]?.[YOU] ?? 0) / 100) * 2.4 * supply);
      unitsSold += units;
      out.branchRevenue += units * price;
      out.branchRent += units * cost;
    }
  }
  if ((shop.branches ?? []).length) {
    events.push({ kind: 'turf', text: `Your branches sold ${unitsSold} units (${Math.round(out.branchRevenue)} cr) against ${Math.round(out.branchRent)} cr rent and stock.` });
  }
  out.branchRevenue = round2(out.branchRevenue);
  out.branchRent = round2(out.branchRent);

  // 6. Win and lose.
  if (!shop.wonDay && held.length >= WIN_DISTRICTS) {
    shop.wonDay = day;
    events.push({ kind: 'win', text: `You lead ${held.length} of ${Object.keys(after).length} districts. You run the city!` });
  }
  return out;
}
