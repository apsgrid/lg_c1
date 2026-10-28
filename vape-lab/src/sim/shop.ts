// Day-by-day shop simulation. Pure and seeded like the rest of sim/: the same
// shop state + same choices always play out the same way.
//
// A day is a session: beginDay() lines up the visitors, step() serves them one
// at a time, and some stop at the counter with an Encounter the player resolves
// with resolve(). endDay() closes up. simulateDay() runs a whole day with safe
// default choices (used for tests and for "skip to closing").
import { COMMISSION_GREAT, COMMISSION_OK, makeBrief, scoreCommission, type Commission, type Want } from './commission';
import { faultChance, unitCost } from './cost';
import { productId } from './id';
import { deriveSeed, mulberry32, rngPick, rngRange, type Rng } from './rng';
import { runTest } from './test';
import type { CustomerId, GameData, Product, TestResult } from './types';
import { clamp, round1, round2 } from './util';

export const MAX_STOCK = 60;
export const START_CASH = 300;
export const ID_FINE = 250;
export const VIGILANCE = [
  { label: 'None', wage: 0, catchChance: 0.08 },
  { label: 'Watchful staff', wage: 25, catchChance: 0.35 },
  { label: 'Security guard', wage: 55, catchChance: 0.65 },
] as const;
/** Rival knowledge (0-100) at which they launch a knock-off. */
export const KNOCKOFF_AT = 70;

// --- Progression ----------------------------------------------------------------------

export type ShopTierId = 'car' | 'garage' | 'small' | 'medium' | 'large' | 'premium';

export interface ShopTier {
  id: ShopTierId;
  name: string;
  blurb: string;
  slots: number;
  rent: number;
  footfall: number;            // walk-in multiplier
  upgradeCost: number;         // cost to move INTO this tier
  repNeeded: number;
  rivals: boolean;             // rival stores notice you
  shoplift: number;            // daily chance of a shoplifter
  maxRegulars: number;
  youngShare: number;          // share of walk-ins who look under 25
  mix: Partial<Record<CustomerId, number>>;
}

export const SHOP_TIERS: ShopTier[] = [
  { id: 'car', name: 'Car boot', blurb: 'Selling from the boot of your car. Cheap, but few people find you.', slots: 2, rent: 5, footfall: 0.45, upgradeCost: 0, repNeeded: 0, rivals: false, shoplift: 0, maxRegulars: 3, youngShare: 0.22, mix: { budget_buyer: 3, fruit_fanatic: 2 } },
  { id: 'garage', name: 'Garage', blurb: 'Roller door up, folding table out. Word is getting round.', slots: 3, rent: 15, footfall: 0.7, upgradeCost: 300, repNeeded: 52, rivals: false, shoplift: 0.12, maxRegulars: 5, youngShare: 0.16, mix: { budget_buyer: 2, fruit_fanatic: 2, ice_fan: 1.5 } },
  { id: 'small', name: 'Small store', blurb: 'A real shop front. Rival stores start paying attention.', slots: 4, rent: 40, footfall: 1.0, upgradeCost: 500, repNeeded: 56, rivals: true, shoplift: 0.22, maxRegulars: 8, youngShare: 0.12, mix: {} },
  { id: 'medium', name: 'Medium store', blurb: 'More shelf space, more footfall, more eyes on you.', slots: 6, rent: 70, footfall: 1.4, upgradeCost: 1000, repNeeded: 60, rivals: true, shoplift: 0.32, maxRegulars: 10, youngShare: 0.1, mix: {} },
  { id: 'large', name: 'Large store', blurb: 'A destination shop. Busy days, busy rivals.', slots: 8, rent: 120, footfall: 1.9, upgradeCost: 1800, repNeeded: 65, rivals: true, shoplift: 0.42, maxRegulars: 14, youngShare: 0.08, mix: { novelty_seeker: 1.5 } },
  { id: 'premium', name: 'Premium boutique', blurb: 'Marble, soft lighting and customers who pay for quality.', slots: 8, rent: 200, footfall: 1.6, upgradeCost: 3200, repNeeded: 72, rivals: true, shoplift: 0.25, maxRegulars: 16, youngShare: 0.04, mix: { brand_loyalist: 2, novelty_seeker: 2, anti_sweet: 1.5, budget_buyer: 0.3 } },
];

export function tierOf(shop: ShopState): ShopTier {
  return SHOP_TIERS[Math.min(shop.tier, SHOP_TIERS.length - 1)];
}

export function nextTier(shop: ShopState): ShopTier | null {
  return SHOP_TIERS[shop.tier + 1] ?? null;
}

export function canUpgrade(shop: ShopState): { ok: boolean; reason: string } {
  const next = nextTier(shop);
  if (!next) return { ok: false, reason: 'You run the finest shop in town.' };
  if (shop.reputation < next.repNeeded) return { ok: false, reason: `Needs reputation ${next.repNeeded} (you have ${Math.round(shop.reputation)}).` };
  if (shop.cash < next.upgradeCost) return { ok: false, reason: `Needs ${next.upgradeCost} cr (you have ${Math.floor(shop.cash)}).` };
  return { ok: true, reason: `Move to a ${next.name.toLowerCase()} for ${next.upgradeCost} cr.` };
}

export function upgradeShop(shop: ShopState): ShopState {
  if (!canUpgrade(shop).ok) return shop;
  const s = clone(shop);
  const next = SHOP_TIERS[s.tier + 1];
  s.cash = round2(s.cash - next.upgradeCost);
  s.tier++;
  return s;
}

// --- State ----------------------------------------------------------------------------

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

export interface PendingReturn {
  productId: string;
  productName: string;
  paid: number;
  dueDay: number;
  customerName: string;
  archetype: CustomerId;
  regularId?: string;
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
  version: 2;
  name: string;
  seed: number;
  day: number;                 // next day to open
  tier: number;                // index into SHOP_TIERS
  cash: number;
  reputation: number;
  vigilance: 0 | 1 | 2;
  listings: Listing[];
  regulars: Regular[];
  rivals: Rival[];
  pendingReturns: PendingReturn[];
  history: DaySummary[];
  spentSinceOpen: number;
  nextRegularId: number;
  /** Shop upgrades bought so far (ids from UPGRADES). Kept when you move. */
  upgrades: string[];
  commissions: Commission[];
  nextCommissionId: number;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function newShop(seed: number, name = 'My Vape Store'): ShopState {
  return {
    version: 2,
    name,
    seed: seed >>> 0,
    day: 1,
    tier: 0,
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
    pendingReturns: [],
    history: [],
    spentSinceOpen: 0,
    nextRegularId: 1,
    upgrades: [],
    commissions: [],
    nextCommissionId: 1,
  };
}

/** Upgrade older saves. A v1 shop was already a small store. */
export function migrateShop(raw: unknown): ShopState {
  const s = raw as Partial<ShopState> & { version?: number };
  const extras = { upgrades: s.upgrades ?? [], commissions: s.commissions ?? [], nextCommissionId: s.nextCommissionId ?? 1 };
  if (s.version === 2) return { ...(s as ShopState), ...extras };
  return { ...(s as ShopState), ...extras, version: 2, tier: 2, pendingReturns: [] };
}

// --- Player actions (pure) ------------------------------------------------------------

export function shelfSlots(shop: ShopState): number {
  return tierOf(shop).slots + perk(shop, 'slots');
}

/** Your own Lab formulas can be sold once you've moved out of the car. */
export function canMakeOwn(shop: ShopState): boolean {
  return shop.tier >= 1;
}

// --- Shop upgrades ----------------------------------------------------------------------

export type PerkKey = 'footfall' | 'slots' | 'buyChance' | 'loyaltyGain' | 'advice' | 'adviceGrace' | 'cctv' | 'repRest' | 'idScanner' | 'drain';

export interface UpgradeDef {
  id: string;
  name: string;
  blurb: string;
  cost: number;
  minTier: number;
  perks: Partial<Record<PerkKey, number>>;
}

/** The whole upgrade content layer: add an entry here and it appears in the shop. */
export const UPGRADES: UpgradeDef[] = [
  { id: 'sign', name: 'Hand-painted sign', blurb: '+10% customers', cost: 150, minTier: 1, perks: { footfall: 0.1 } },
  { id: 'id_scanner', name: 'ID scanner', blurb: 'ID checks take seconds, and nobody takes offence', cost: 250, minTier: 1, perks: { idScanner: 1 } },
  { id: 'card_reader', name: 'Card reader', blurb: 'Fewer people leave empty-handed', cost: 200, minTier: 1, perks: { buyChance: 0.06 } },
  { id: 'sofa', name: 'Comfy sofa', blurb: 'Regulars linger; loyalty grows 30% faster', cost: 600, minTier: 2, perks: { loyaltyGain: 0.3 } },
  { id: 'tasting_bar', name: 'Tasting bar', blurb: 'More people ask for advice, and forgive near-misses', cost: 900, minTier: 2, perks: { advice: 0.12, adviceGrace: 5 } },
  { id: 'cctv', name: 'CCTV', blurb: 'Narrows a shoplifter down to two suspects; no wages', cost: 800, minTier: 2, perks: { cctv: 1 } },
  { id: 'second_till', name: 'Second till', blurb: 'The queue moves much faster on busy days', cost: 1200, minTier: 3, perks: { drain: 0.7 } },
  { id: 'neon', name: 'Neon window display', blurb: '+20% customers', cost: 1500, minTier: 3, perks: { footfall: 0.2 } },
  { id: 'extra_shelf', name: 'Extra shelving', blurb: '+2 product slots', cost: 2000, minTier: 3, perks: { slots: 2 } },
  { id: 'lounge', name: 'Lounge corner', blurb: 'Reputation settles at 60 instead of 50', cost: 4000, minTier: 4, perks: { repRest: 10 } },
];

export function perk(shop: ShopState, key: PerkKey): number {
  let total = 0;
  for (const id of shop.upgrades ?? []) total += UPGRADES.find((u) => u.id === id)?.perks[key] ?? 0;
  return total;
}

export function upgradeStatus(shop: ShopState, id: string): { owned: boolean; ok: boolean; reason: string } {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return { owned: false, ok: false, reason: 'Unknown upgrade.' };
  if ((shop.upgrades ?? []).includes(id)) return { owned: true, ok: false, reason: 'Owned' };
  if (shop.tier < u.minTier) return { owned: false, ok: false, reason: `From the ${SHOP_TIERS[u.minTier].name}` };
  if (shop.cash < u.cost) return { owned: false, ok: false, reason: `Needs ${u.cost} cr` };
  return { owned: false, ok: true, reason: `${u.cost} cr` };
}

export function buyUpgrade(shop: ShopState, id: string): ShopState {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u || !upgradeStatus(shop, id).ok) return shop;
  const s = clone(shop);
  s.cash = round2(s.cash - u.cost);
  s.upgrades = [...(s.upgrades ?? []), id];
  return s;
}

export function addListing(shop: ShopState, product: Product, data: GameData): ShopState {
  const s = clone(shop);
  if (s.listings.length >= shelfSlots(s)) return s;
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

/** Swap a listing's formula for a revised one. Rivals keep only part of what they learned. */
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

export function intelEstimate(shop: ShopState, rival: Rival, pid: string): number | null {
  if (shop.vigilance === 0) return null;
  const k = rival.knowledge[pid] ?? 0;
  return shop.vigilance === 2 ? Math.round(k / 10) * 10 : Math.round(k / 25) * 25;
}

export function sameFormula(a: Product, b: Product): boolean {
  return productId(a) === productId(b);
}

// --- Flavour text -----------------------------------------------------------------------

const FIRST = ['Ash', 'Bex', 'Cal', 'Dee', 'Eli', 'Fran', 'Gus', 'Hana', 'Ivo', 'Jo', 'Kit', 'Lou', 'Mo', 'Nia', 'Oz', 'Pip', 'Quin', 'Rae', 'Sid', 'Tam', 'Uma', 'Vic', 'Wren', 'Zed',
  'Ade', 'Bea', 'Cass', 'Dev', 'Esme', 'Finn', 'Gem', 'Hal', 'Isla', 'Jas', 'Kai', 'Lena', 'Max', 'Nell', 'Omar', 'Priya', 'Ravi', 'Suki', 'Theo', 'Vera', 'Yas', 'Zara'];
const NICK = ['the Cloud', 'from Upstairs', 'Two-Bags', 'in the Hoodie', 'with the Dog', 'Big Puff', 'the Critic', 'Night Shift', 'from the Garage', 'Quiet', 'the Postie', 'in the Van'];
const LOOKS = [
  'grey hoodie, earbuds in', 'red raincoat, dripping umbrella', 'paint-spattered work boots', 'tracksuit and a bum bag',
  'smart coat, briefcase', 'dog lead in one hand', 'cycling helmet under one arm', 'band T-shirt, lots of rings',
  'hi-vis jacket, coffee cup', 'big puffer coat', 'flat cap and scarf', 'denim jacket covered in badges',
];
const THIEF_TELLS = [
  'kept one hand in a bulging coat pocket', 'hovered by the shelf with eyes on the door', 'picked something up and the shelf looks emptier',
  'shuffled out quickly without queueing', 'wore a big coat on a warm day',
];
const INNOCENT_TELLS = ['checked their phone a lot', 'looked around nervously', 'browsed for ages', 'kept glancing at the door', 'asked lots of questions'];
const RIVAL_TELLS = ['has a notepad out', 'asks you to repeat the exact amounts', 'is taking photos of the label', 'wants to know who supplies you'];

const YOUNG_LOOKS = {
  minorObvious: ['school uniform under a coat', 'school rucksack and braces', 'counting out coins from a pencil case'],
  minorUnsure: ['baby-faced, could be 16 or 19', 'very young-looking, nervous', 'trying hard to look older'],
  adultUnsure: ['baby-faced, could be 17 or 20', 'looks young, uni hoodie', 'fresh-faced, confident'],
};

const ASKS: Record<string, string[]> = {
  fruit_fanatic: ['What\'s your fruitiest one?', 'I want something that tastes like actual fruit.', 'Got anything sweet and fruity?'],
  anti_sweet: ['Something not too sweet, please.', 'I can\'t stand sugary stuff. What have you got?', 'What\'s the most grown-up flavour here?'],
  ice_fan: ['Got anything really icy?', 'What\'s the coldest thing you sell?', 'I want brain-freeze cold.'],
  novelty_seeker: ['What\'s the weirdest thing you\'ve got?', 'Surprise me. Something new.', 'What would nobody else sell?'],
  budget_buyer: ['What\'s the best value?', 'Something decent that won\'t break the bank?', 'What\'s cheap but good?'],
  brand_loyalist: ['What\'s popular? Something classic.', 'What do most people buy?', 'Got something reliable, like a proper brand?'],
};

// --- Day session ------------------------------------------------------------------------

export type VisitorKind = 'walkin' | 'regular' | 'rival' | 'thief' | 'return';
export type EncounterKind = 'recommend' | 'id' | 'probe' | 'shoplift' | 'return' | 'commission' | 'pickup';

export interface Visitor {
  idx: number;
  kind: VisitorKind;
  name: string;
  archetype: CustomerId;
  look: string;
  age: number;
  looksYoung: boolean;
  youngLook?: string;
  regularId?: string;
  rivalId?: string;
  wantsAdvice?: boolean;
  probes?: boolean;
  returnOf?: PendingReturn;
  decoys?: { name: string; look: string; tell?: string }[];
  thiefSlot?: number;
  /** A regular asking for a bespoke flavour. */
  commissionOffer?: { text: string; wants: Want[]; dueDay: number };
  /** A regular collecting a commission you've handed in. */
  pickupId?: string;
}

export interface Visit {
  name: string;
  archetype: CustomerId;
  regularId?: string;
  rivalId?: string;
  productId?: string;
  qty: number;
  spent: number;
  walkout?: 'stockout' | 'nothing' | 'banned' | 'refused' | 'underage' | 'queue' | 'offended';
  tell?: string;
  caught?: boolean;
  young?: boolean;
  kind: VisitorKind;
  note?: string;
}

export interface EncounterOption {
  id: string;
  label: string;
  hint?: string;
  /** Minutes at the counter this choice takes; the queue grows while you're busy. */
  time?: number;
}

export interface Encounter {
  kind: EncounterKind;
  visitorIdx: number;
  who: string;
  archetype: CustomerId;
  look: string;
  title: string;
  line: string;
  detail?: string;
  options: EncounterOption[];
}

export interface Outcome {
  line: string;
  tone: 'good' | 'bad' | 'neutral';
  pop: string;
}

export type DayEventKind =
  | 'delivery' | 'stockout' | 'regular_join' | 'regular_leave' | 'caught' | 'knockoff' | 'suspicious' | 'restock'
  | 'broke' | 'return' | 'fine' | 'id_refused' | 'theft' | 'good_advice' | 'commission';

export interface DayEvent {
  kind: DayEventKind;
  text: string;
}

export interface DaySession {
  shop: ShopState;
  day: number;
  visitors: Visitor[];
  pos: number;
  visits: Visit[];
  events: DayEvent[];
  sales: Record<string, number>;
  revenue: number;
  refunds: number;
  fines: number;
  repStart: number;
  restockSpend: number;
  /** Minutes the queue is backed up. Careful choices take time; a long queue makes people leave. */
  queue: number;
}

export interface DayReport {
  day: number;
  tier: ShopTierId;
  visitors: number;
  buyers: number;
  revenue: number;
  refunds: number;
  fines: number;
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

const testCache = new Map<string, TestResult>();
function testFor(l: Listing, data: GameData): TestResult {
  const key = `${l.product.id}|${l.product.brand.format ?? 'r'}|${l.product.brand.tier}|${l.price}`;
  let t = testCache.get(key);
  if (!t) {
    if (testCache.size > 500) testCache.clear();
    t = runTest({ ...l.product, brand: { ...l.product.brand, price: l.price } }, data);
    testCache.set(key, t);
  }
  return t;
}

function vrng(s: DaySession | ShopState, day: number, i: number, salt: string): Rng {
  const seed = 'shop' in s ? s.shop.seed : s.seed;
  return mulberry32(deriveSeed(seed, `d${day}:v${i}:${salt}`));
}

function pickArchetype(rng: Rng, data: GameData, tier: ShopTier): CustomerId {
  const weights = data.customers.map((c) => tier.mix[c.id] ?? 1);
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return data.customers[i].id;
  }
  return data.customers[0].id;
}

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

/** Open up: morning deliveries, then line up today's visitors. */
export function beginDay(input: ShopState, data: GameData): DaySession {
  const shop = clone(input);
  const day = shop.day;
  const tier = tierOf(shop);
  const rng = mulberry32(deriveSeed(shop.seed, `day:${day}`));
  const events: DayEvent[] = [];

  for (const l of shop.listings) {
    if (l.incoming > 0) {
      events.push({ kind: 'delivery', text: `${l.incoming} × ${l.product.brand.name || 'Untitled'} delivered.` });
      l.stock += l.incoming;
      l.incoming = 0;
    }
  }

  const visitors: Omit<Visitor, 'idx'>[] = [];
  const base = (): Pick<Visitor, 'look' | 'age' | 'looksYoung'> => ({ look: rngPick(rng, LOOKS), age: 25 + Math.floor(rng() * 40), looksYoung: false });

  // Faulty units come back.
  const due = shop.pendingReturns.filter((r) => r.dueDay <= day);
  shop.pendingReturns = shop.pendingReturns.filter((r) => r.dueDay > day);
  for (const r of due) {
    visitors.push({ ...base(), kind: 'return', name: r.customerName, archetype: r.archetype, regularId: r.regularId, returnOf: r });
  }

  // Commissions: missed deadlines fail, and handed-in ones get collected today.
  for (const c of shop.commissions) {
    const r = shop.regulars.find((x) => x.id === c.regularId);
    if ((c.status === 'open' || c.status === 'ready') && (!r || r.gone)) {
      c.status = 'cancelled';
      continue;
    }
    if (c.status === 'open' && c.dueDay < day) {
      c.status = 'failed';
      if (r) r.loyalty = clamp(r.loyalty - 20);
      shop.reputation = clamp(shop.reputation - 1);
      events.push({ kind: 'commission', text: `You missed ${c.regularName}'s deadline (day ${c.dueDay}). They're gutted.` });
    }
  }
  const pickups = new Map(shop.commissions.filter((c) => c.status === 'ready').map((c) => [c.regularId, c.id]));
  let live = shop.commissions.filter((c) => c.status === 'open' || c.status === 'ready').length;

  // Regulars.
  for (const r of shop.regulars.filter((x) => !x.gone)) {
    const pickupId = pickups.get(r.id);
    if (!pickupId && rng() > 0.25 + r.loyalty / 200) {
      r.loyalty = clamp(r.loyalty - 0.5);
      continue;
    }
    const v: Omit<Visitor, 'idx'> = { ...base(), kind: 'regular', name: r.name, archetype: r.archetype, regularId: r.id, pickupId };
    visitors.push(v);
  }
  // At most one new commission offer a day, from a loyal regular who's in today.
  const askers = visitors.filter((v) => {
    const r = shop.regulars.find((x) => x.id === v.regularId);
    return v.kind === 'regular' && !v.pickupId && r && r.loyalty >= 35
      && !shop.commissions.some((c) => c.regularId === r.id && (c.status === 'open' || c.status === 'ready'));
  });
  if (askers.length && canMakeOwn(shop) && live < 2 && rng() < 0.15) {
    const v = rngPick(rng, askers);
    const dueDay = day + 3 + Math.floor(rng() * 3);
    v.commissionOffer = { ...makeBrief(v.archetype, data, rng, dueDay), dueDay };
    live++;
  }

  // Walk-ins, some of whom look young.
  const walkIns = Math.max(2, Math.round((4 + shop.reputation / 8 + rngRange(rng, 0, 4)) * tier.footfall * (1 + perk(shop, 'footfall'))));
  for (let i = 0; i < walkIns; i++) {
    const archetype = pickArchetype(rng, data, tier);
    const v: Omit<Visitor, 'idx'> = { ...base(), kind: 'walkin', name: rngPick(rng, FIRST), archetype };
    if (rng() < tier.youngShare) {
      v.looksYoung = true;
      const minor = rng() < 0.45;
      v.age = minor ? 15 + Math.floor(rng() * 3) : 18 + Math.floor(rng() * 5);
      v.youngLook = minor
        ? rngPick(rng, rng() < 0.4 ? YOUNG_LOOKS.minorObvious : YOUNG_LOOKS.minorUnsure)
        : rngPick(rng, YOUNG_LOOKS.adultUnsure);
    }
    v.wantsAdvice = rng() < 0.22 + perk(shop, 'advice');
    // Curious fans ask about recipes too, so a nosy question isn't proof of a rival.
    v.probes = tier.rivals && rng() < (archetype === 'novelty_seeker' ? 0.45 : archetype === 'anti_sweet' ? 0.2 : 0.04);
    visitors.push(v);
  }

  // Rival secret shoppers, disguised as ordinary customers.
  if (tier.rivals) {
    for (const rival of shop.rivals) {
      if (rng() > 0.1 + rival.aggression * 0.25) continue;
      const archetype = pickArchetype(rng, data, tier);
      visitors.push({
        ...base(), kind: 'rival', rivalId: rival.id, archetype,
        name: rngPick(rng, FIRST),
        probes: rng() < 0.55,
      });
    }
  }

  // Shuffle so returns, regulars and rivals are spread through the day.
  for (let i = visitors.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [visitors[i], visitors[j]] = [visitors[j], visitors[i]];
  }

  // A shoplifter strikes partway through, hiding among two other customers.
  if (rng() < tier.shoplift && shop.listings.some((l) => l.stock > 0)) {
    const at = Math.min(visitors.length, 2 + Math.floor(rng() * Math.max(1, visitors.length - 2)));
    const thiefSlot = Math.floor(rng() * 3);
    const decoys = [0, 1].map(() => ({ name: rngPick(rng, FIRST), look: rngPick(rng, LOOKS), tell: rng() < 0.6 ? rngPick(rng, INNOCENT_TELLS) : undefined }));
    visitors.splice(at, 0, {
      ...base(), kind: 'thief', name: rngPick(rng, FIRST), archetype: pickArchetype(rng, data, tier), decoys, thiefSlot,
    });
  }

  return {
    shop, day, events,
    visitors: visitors.map((v, idx) => ({ ...v, idx })),
    pos: 0, visits: [], sales: {}, revenue: 0, refunds: 0, fines: 0, queue: 0,
    repStart: shop.reputation,
    restockSpend: shop.spentSinceOpen,
  };
}

// --- Helpers used while serving ----------------------------------------------------------

function knockedOff(shop: ShopState, pid: string): boolean {
  return shop.rivals.some((r) => r.knockoffs.some((k) => k.productId === pid));
}

function rate(s: DaySession, l: Listing, archetype: CustomerId, data: GameData, regular?: Regular): number {
  const t = testFor(l, data);
  let score = t.reactions.find((r) => r.customerId === archetype)?.score ?? 40;
  score += (s.shop.reputation - 50) * 0.1;
  if (tierOf(s.shop).id === 'premium') score += l.product.brand.tier === 'premium' ? 8 : l.product.brand.tier === 'budget' ? -8 : 0;
  if (knockedOff(s.shop, l.product.id)) score -= regular ? 3 : 10;
  if (regular?.favourite === l.product.id) score += 8 + regular.loyalty * 0.05;
  return score;
}

function sell(s: DaySession, v: Visitor, l: Listing, qty: number, data: GameData): number {
  const n = Math.min(qty, l.stock);
  l.stock -= n;
  l.soldTotal += n;
  s.sales[l.product.id] = (s.sales[l.product.id] ?? 0) + n;
  const spent = round2(n * l.price);
  s.revenue += spent;
  const risk = testFor(l, data).reputationRisk;
  if (risk > 30) s.shop.reputation -= (risk - 30) * 0.02 * n;
  // Some units are duds and will come back in a day or two.
  const rng = vrng(s, s.day, v.idx, `fault:${l.product.id}`);
  const fc = faultChance(l.product);
  for (let k = 0; k < n; k++) {
    if (rng() < fc && v.kind !== 'rival' && v.kind !== 'thief') {
      s.shop.pendingReturns.push({
        productId: l.product.id, productName: l.product.brand.name || 'Untitled', paid: l.price,
        dueDay: s.day + 1 + Math.floor(rng() * 2), customerName: v.name, archetype: v.archetype, regularId: v.regularId,
      });
    }
  }
  return spent;
}

/** Reputation change. Gains shrink as you near the top, so 100 has to be earned. */
function rep(s: DaySession, d: number): void {
  const r = s.shop.reputation;
  const scaled = d > 0 ? d * clamp((100 - r) / 50, 0.1, 1) : d;
  s.shop.reputation = clamp(r + scaled);
}

function regularOf(s: DaySession, v: Visitor): Regular | undefined {
  return v.regularId ? s.shop.regulars.find((r) => r.id === v.regularId) : undefined;
}

function maybeRecruit(s: DaySession, v: Visitor, l: Listing, score: number, rng: Rng, boost = 0): void {
  if (v.kind !== 'walkin' || score <= 70) return;
  const active = s.shop.regulars.filter((x) => !x.gone).length;
  if (active >= tierOf(s.shop).maxRegulars || rng() > 0.35 + boost) return;
  const r: Regular = {
    id: `R${s.shop.nextRegularId++}`, name: regularName(rng), archetype: v.archetype, loyalty: 45,
    favourite: l.product.id, visits: 1, joinedDay: s.day, lastVisitDay: s.day, gone: false,
  };
  s.shop.regulars.push(r);
  s.events.push({ kind: 'regular_join', text: `${r.name} loved ${l.product.brand.name} and says they'll be back.` });
}

function learn(s: DaySession, rivalId: string, l: Listing, data: GameData, rng: Rng, mult: number): void {
  const rival = s.shop.rivals.find((r) => r.id === rivalId);
  if (!rival) return;
  const pid = l.product.id;
  const complexity = testFor(l, data).profile.complexity;
  const gain = rngRange(rng, 16, 30) * (1 - complexity / 250) * mult;
  rival.knowledge[pid] = round1(clamp((rival.knowledge[pid] ?? 0) + gain));
  if (rival.knowledge[pid] >= KNOCKOFF_AT && !rival.knockoffs.some((k) => k.productId === pid)) {
    const name = knockoffName(l.product.brand.name, rng);
    rival.knockoffs.push({ productId: pid, name, day: s.day });
    rep(s, -2);
    s.events.push({ kind: 'knockoff', text: `${rival.name} launched “${name}”, a knock-off of ${l.product.brand.name}. Revise the formula in the Lab to shake them off.` });
  }
}

function inStock(s: DaySession): Listing[] {
  return s.shop.listings.filter((l) => l.stock > 0);
}

function describeProduct(l: Listing, data: GameData): string {
  const p = testFor(l, data).profile;
  const tags: string[] = [];
  if (p.cooling > 55) tags.push('icy');
  if (p.sweetness > 55) tags.push('sweet');
  else if (p.sweetness < 30) tags.push('not sweet');
  if (p.tartness > 45) tags.push('tangy');
  if (p.richness > 55) tags.push('rich');
  if (p.originality > 55) tags.push('unusual');
  if (p.complexity > 55) tags.push('layered');
  if (l.product.brand.format === 'disposable') tags.push('disposable');
  return tags.slice(0, 3).join(', ') || 'easy-going';
}

/** What would happen if this visitor shopped on their own. */
function autoShop(s: DaySession, v: Visitor, data: GameData, rng: Rng): { listing?: Listing; score: number; walkout?: 'stockout' | 'nothing' } {
  const regular = regularOf(s, v);
  const fav = regular?.favourite ? s.shop.listings.find((l) => l.product.id === regular.favourite) : undefined;
  if (fav && fav.stock <= 0) return { score: 0, walkout: 'stockout' };
  const options = inStock(s).map((l) => ({ l, sc: rate(s, l, v.archetype, data, regular) }));
  if (!options.length) return { score: 0, walkout: 'stockout' };
  options.sort((a, b) => b.sc - a.sc);
  const best = options[0];
  const p = clamp((best.sc - 35) / 45 + perk(s.shop, 'buyChance'), 0.04, 0.95);
  return rng() < p ? { listing: best.l, score: best.sc } : { score: best.sc, walkout: 'nothing' };
}

function completePurchase(s: DaySession, v: Visitor, l: Listing, score: number, data: GameData, rng: Rng, extra: Partial<Visit> = {}): Visit {
  const regular = regularOf(s, v);
  const repeat = testFor(l, data).repeatPurchase;
  const qty = regular && repeat > 60 && rng() < 0.5 ? 2 : 1;
  const spent = sell(s, v, l, qty, data);
  if (regular) {
    regular.visits++;
    regular.lastVisitDay = s.day;
    const gain = (score - 55) * 0.3;
    regular.loyalty = clamp(regular.loyalty + (gain > 0 ? gain * (1 + perk(s.shop, 'loyaltyGain')) : gain));
    if (!regular.favourite || score > 70) regular.favourite = l.product.id;
  }
  if (score > 65) rep(s, 0.12);
  maybeRecruit(s, v, l, score, rng);
  return { name: v.name, archetype: v.archetype, regularId: v.regularId, productId: l.product.id, qty, spent, kind: v.kind, young: v.looksYoung, ...extra };
}

// --- Time at the counter ---------------------------------------------------------------------

/** Queue minutes each choice costs. Careful answers are slow answers. */
export function timeCost(choice: string, shop: ShopState): number {
  if (choice === 'check') return perk(shop, 'idScanner') ? 0.4 : 2;
  if (choice.startsWith('rec:')) return 1.5;
  if (choice.startsWith('stop:')) return 3;
  const t: Record<string, number> = {
    serve: 0.3, explain: 2.5, vague: 0.3, browse: 0.2, refund: 0.8, replace: 1.2, refuse: 2,
    ignore: 0, accept: 1.5, decline: 0.3, handover: 1,
  };
  return t[choice] ?? 0.5;
}

/** How fast the queue clears between customers. */
function queueDrain(shop: ShopState): number {
  return 0.9 + (shop.vigilance === 1 ? 0.5 : 0) + perk(shop, 'drain');
}

/** Above this many minutes, people in the queue start giving up. */
export const QUEUE_LIMIT = 2.5;

// --- Serving ------------------------------------------------------------------------------

export interface StepResult {
  session: DaySession;
  encounter: Encounter | null;
  visit: Visit | null;
  done: boolean;
}

/** Serve the next visitor. Returns either an auto-resolved visit or an encounter that needs a choice. */
export function step(input: DaySession, data: GameData): StepResult {
  const s = clone(input);
  const v = s.visitors[s.pos];
  if (!v) return { session: s, encounter: null, visit: null, done: true };
  const rng = vrng(s, s.day, v.idx, 'auto');
  const regular = regularOf(s, v);
  const enc = (e: Omit<Encounter, 'visitorIdx' | 'who' | 'archetype' | 'look'>): StepResult => ({
    session: s, visit: null, done: false,
    encounter: {
      ...e, visitorIdx: v.idx, who: v.name, archetype: v.archetype, look: v.youngLook ?? v.look,
      options: e.options.map((o) => ({ ...o, time: timeCost(o.id, s.shop) })),
    },
  });

  // The queue clears a little between customers; if it's long, people give up.
  s.queue = Math.max(0, s.queue - queueDrain(s.shop));
  if (s.queue > QUEUE_LIMIT && (v.kind === 'walkin' || v.kind === 'regular' || v.kind === 'rival')) {
    const chance = (s.queue - QUEUE_LIMIT) * 0.18 * (v.kind === 'regular' ? 0.5 : 1);
    if (rng() < chance) {
      s.pos++;
      rep(s, -0.1);
      if (regular) regular.loyalty = clamp(regular.loyalty - 2);
      const visit: Visit = { name: v.name, archetype: v.archetype, regularId: v.regularId, rivalId: v.rivalId, qty: 0, spent: 0, walkout: 'queue', kind: v.kind, young: v.looksYoung };
      s.visits.push(visit);
      return { session: s, encounter: null, visit, done: false };
    }
  }

  if (v.kind === 'return' && v.returnOf) {
    const r = v.returnOf;
    const sameInStock = s.shop.listings.find((l) => l.product.id === r.productId && l.stock > 0);
    return enc({
      kind: 'return', title: 'Faulty return',
      line: `This ${r.productName} stopped working after a day. Can I get my money back?`,
      detail: `They paid ${r.paid.toFixed(1)} cr.`,
      options: [
        { id: 'refund', label: `Refund ${r.paid.toFixed(1)} cr`, hint: 'Costs cash, keeps goodwill' },
        { id: 'replace', label: 'Swap for a new one', hint: sameInStock ? 'Costs one unit of stock' : 'Out of stock' },
        { id: 'refuse', label: 'Refuse', hint: 'Keeps the cash. Word gets around.' },
      ].filter((o) => o.id !== 'replace' || sameInStock),
    });
  }

  if (v.kind === 'thief' && v.decoys) {
    const suspects = [...v.decoys];
    const thiefTell = rngPick(rng, THIEF_TELLS);
    suspects.splice(v.thiefSlot ?? 0, 0, { name: v.name, look: v.look, tell: thiefTell });
    const guard = s.shop.vigilance === 2;
    const cctv = !guard && perk(s.shop, 'cctv') > 0;
    const thiefSlot = v.thiefSlot ?? 0;
    // CCTV only narrows it down: the thief plus one innocent near the shelf.
    const onCamera = new Set([thiefSlot, cctv ? (thiefSlot + 1 + Math.floor(rng() * 2)) % 3 : -1]);
    return enc({
      kind: 'shoplift', title: 'Shoplifter!',
      line: 'Something just went missing from the shelf. Which of these three took it?',
      detail: guard ? 'Your guard is pointing at one of them.' : cctv ? 'The CCTV shows two of them near the shelf.' : 'Look for the odd one out. Chasing someone leaves the counter empty.',
      options: [
        ...suspects.map((x, i) => ({
          id: `stop:${i}`,
          label: `Stop ${x.name}`,
          hint: `${x.look}${x.tell ? `; ${x.tell}` : ''}${guard && i === thiefSlot ? ' (guard nods)' : cctv && onCamera.has(i) ? ' (on CCTV)' : ''}`,
        })),
        { id: 'ignore', label: 'Let it go', hint: 'Lose 1-3 units, but the queue keeps moving' },
      ],
    });
  }

  if (v.pickupId) {
    const c = s.shop.commissions.find((x) => x.id === v.pickupId);
    if (c?.status === 'ready' && c.product) {
      return enc({
        kind: 'pickup', title: 'Commission pick-up',
        line: `Is it ready? I've been looking forward to this all week!`,
        detail: `Their brief: “${c.text}” You're handing over ${c.product.brand.name}.`,
        options: [{ id: 'handover', label: `Hand over ${c.product.brand.name}` }],
      });
    }
  }

  if (v.commissionOffer) {
    return enc({
      kind: 'commission', title: `${v.name} has a request`,
      line: v.commissionOffer.text,
      detail: `Design it in the Lab and hand it in before you open on day ${v.commissionOffer.dueDay}. They'll collect it at your next opening.`,
      options: [
        { id: 'accept', label: 'I\'ll make it for you', hint: 'Nail it: big loyalty, a tip, a friend, and a signature product' },
        { id: 'decline', label: 'Sorry, not this week', hint: 'They\'ll understand. Mostly.' },
      ],
    });
  }

  // Rivals may be caught by staff before they reach the counter.
  if (v.kind === 'rival') {
    const rival = s.shop.rivals.find((r) => r.id === v.rivalId);
    if (rival && rival.bannedUntil >= s.day) {
      s.pos++;
      s.events.push({ kind: 'caught', text: `Staff recognised a ${rival.name} shopper and turned them away.` });
      const visit: Visit = { name: v.name, archetype: v.archetype, rivalId: v.rivalId, qty: 0, spent: 0, walkout: 'banned', kind: v.kind };
      s.visits.push(visit);
      return { session: s, encounter: null, visit, done: false };
    }
    if (rival && rng() < VIGILANCE[s.shop.vigilance].catchChance) {
      s.pos++;
      rival.caught++;
      rival.bannedUntil = s.day + 5;
      const tell = rngPick(rng, RIVAL_TELLS);
      s.events.push({ kind: 'caught', text: `Staff caught a secret shopper from ${rival.name}. Banned for 5 days.` });
      const visit: Visit = { name: v.name, archetype: v.archetype, rivalId: v.rivalId, qty: 0, spent: 0, caught: true, kind: v.kind, tell };
      s.visits.push(visit);
      return { session: s, encounter: null, visit, done: false };
    }
  }

  if (v.looksYoung) {
    return enc({
      kind: 'id', title: 'Check ID?',
      line: 'Can I get one of these, please?',
      detail: 'They look young. Rule of thumb: if they look under 25, ask.',
      options: [
        { id: 'check', label: 'Ask for ID', hint: perk(s.shop, 'idScanner') ? 'Quick with the scanner' : 'Slow, and some adults take offence and leave' },
        { id: 'serve', label: 'Just serve them', hint: `Fast. But selling to a minor: ${ID_FINE} cr fine and a big reputation hit` },
      ],
    });
  }

  if (v.probes && inStock(s).length) {
    const target = [...inStock(s)].sort((a, b) => b.soldTotal - a.soldTotal)[0];
    // Tells are a hint, not proof: rivals don't always slip up, and fans can look shifty.
    const tell = v.kind === 'rival' ? (rng() < 0.65 ? rngPick(rng, RIVAL_TELLS) : undefined) : rng() < 0.35 ? rngPick(rng, INNOCENT_TELLS) : undefined;
    return enc({
      kind: 'probe', title: 'A nosy question',
      line: `What exactly goes into ${target.product.brand.name}? Like, what's in the mix?`,
      detail: tell ? `They ${tell}.` : 'They seem keen.',
      options: [
        { id: 'explain', label: 'Talk them through the notes', hint: 'Fans love it and may come back. Rivals learn a lot. Takes a while.' },
        { id: 'vague', label: '"House secret, sorry"', hint: 'Quick and safe, but fans often walk off' },
      ],
    });
  }

  const favOut = regular?.favourite && !s.shop.listings.some((l) => l.product.id === regular.favourite && l.stock > 0);
  if ((v.wantsAdvice || (regular && favOut && rng() < 0.7)) && inStock(s).length >= 1) {
    const asks = ASKS[v.archetype] ?? ['What would you recommend?'];
    const favName = s.shop.listings.find((l) => l.product.id === regular?.favourite)?.product.brand.name;
    const line = regular && favOut ? `My usual ${favName ?? 'one'}'s sold out. What else would I like?` : rngPick(rng, asks);
    return enc({
      kind: 'recommend', title: regular ? `${v.name} wants a recommendation` : 'A customer wants advice',
      line,
      options: [
        ...inStock(s).map((l) => ({ id: `rec:${l.product.id}`, label: l.product.brand.name || 'Untitled', hint: `${l.price.toFixed(1)} cr · ${describeProduct(l, data)}` })),
        { id: 'browse', label: 'Let them browse', hint: 'They pick for themselves' },
      ],
    });
  }

  // Plain sale, no conversation.
  s.pos++;
  const res = autoShop(s, v, data, rng);
  let visit: Visit;
  if (res.listing) {
    visit = completePurchase(s, v, res.listing, res.score, data, rng);
    if (v.kind === 'rival' && v.rivalId) {
      learn(s, v.rivalId, res.listing, data, rng, 1);
      const tell = rngPick(rng, RIVAL_TELLS);
      visit.tell = tell;
      s.events.push({ kind: 'suspicious', text: `A "${v.name}" ${tell}.` });
    }
  } else {
    if (res.walkout === 'stockout' && regular) {
      regular.loyalty = clamp(regular.loyalty - 8);
      rep(s, -0.4);
      const favName = s.shop.listings.find((l) => l.product.id === regular.favourite)?.product.brand.name ?? 'their usual';
      s.events.push({ kind: 'stockout', text: `${regular.name} came for ${favName} but it was sold out.` });
    } else if (regular) regular.loyalty = clamp(regular.loyalty - 2);
    visit = { name: v.name, archetype: v.archetype, regularId: v.regularId, rivalId: v.rivalId, qty: 0, spent: 0, walkout: res.walkout, kind: v.kind };
  }
  s.visits.push(visit);
  return { session: s, encounter: null, visit, done: false };
}

/** Resolve the encounter at the current visitor with the player's choice. */
export function resolve(input: DaySession, choice: string, data: GameData): { session: DaySession; visit: Visit; outcome: Outcome } {
  const s = clone(input);
  const v = s.visitors[s.pos];
  s.pos++;
  s.queue += timeCost(choice, s.shop);
  const rng = vrng(s, s.day, v.idx, `choice:${choice}`);
  const regular = regularOf(s, v);
  const finish = (visit: Visit, outcome: Outcome) => {
    s.visits.push(visit);
    return { session: s, visit, outcome };
  };
  const none = (extra: Partial<Visit> = {}): Visit => ({ name: v.name, archetype: v.archetype, regularId: v.regularId, rivalId: v.rivalId, qty: 0, spent: 0, kind: v.kind, young: v.looksYoung, ...extra });

  // Commission collected.
  if (choice === 'handover' && v.pickupId) {
    const c = s.shop.commissions.find((x) => x.id === v.pickupId);
    if (c?.product) {
      const score = c.score ?? 0;
      const price = c.product.brand.price;
      c.status = 'delivered';
      c.deliveredDay = s.day;
      const great = score >= COMMISSION_GREAT;
      const ok = score >= COMMISSION_OK;
      const tip = round2(great ? price * 3 : ok ? price : 0);
      s.revenue += tip;
      if (regular) regular.loyalty = clamp(regular.loyalty + (great ? 25 : ok ? 8 : -15));
      rep(s, great ? 2 : ok ? 0.5 : -0.5);
      if (great) {
        if (regular) regular.favourite = c.product.id;
        const active = s.shop.regulars.filter((x) => !x.gone).length;
        if (active < tierOf(s.shop).maxRegulars) {
          const friend: Regular = {
            id: `R${s.shop.nextRegularId++}`, name: `${rngPick(rng, FIRST)}, ${v.name.split(' ')[0]}'s mate`, archetype: v.archetype,
            loyalty: 50, favourite: c.product.id, visits: 0, joinedDay: s.day, lastVisitDay: s.day, gone: false,
          };
          s.shop.regulars.push(friend);
          s.events.push({ kind: 'regular_join', text: `${v.name} brought a friend: ${friend.name} is a regular now.` });
        }
      }
      s.events.push({
        kind: 'commission',
        text: great ? `${v.name} loved ${c.product.brand.name} (${Math.round(score)}/100) and tipped ${tip} cr. It's now a signature product.`
          : ok ? `${v.name} liked ${c.product.brand.name} well enough (${Math.round(score)}/100).`
            : `${v.name} was disappointed with ${c.product.brand.name} (${Math.round(score)}/100).`,
      });
      return finish(none({ spent: tip, note: 'collected a commission' }), {
        line: great ? 'This is PERFECT. Exactly what I asked for. Keep the change!' : ok ? 'Oh, nice. Thanks for doing this.' : 'Hmm. Not really what I asked for, but thanks.',
        tone: great ? 'good' : ok ? 'neutral' : 'bad',
        pop: great ? `+${Math.round(tip)} cr tip` : ok ? 'Pleased' : 'Let down',
      });
    }
  }

  // Commission offered: accept or decline, then they shop as normal.
  if ((choice === 'accept' || choice === 'decline') && v.commissionOffer) {
    const o = v.commissionOffer;
    if (choice === 'accept' && v.regularId) {
      s.shop.commissions.push({
        id: `C${s.shop.nextCommissionId++}`, regularId: v.regularId, regularName: v.name, archetype: v.archetype,
        text: o.text, wants: o.wants, createdDay: s.day, dueDay: o.dueDay, status: 'open',
      });
      s.events.push({ kind: 'commission', text: `${v.name} commissioned a flavour, due by day ${o.dueDay}. Find it in the Lab under Orders.` });
    } else if (regular) regular.loyalty = clamp(regular.loyalty - 3);
    const res = autoShop(s, v, data, rng);
    const line = choice === 'accept' ? `Brilliant! See you by day ${o.dueDay}.` : 'Ah, fair enough.';
    if (res.listing) {
      const visit = completePurchase(s, v, res.listing, res.score, data, rng);
      return finish(visit, { line, tone: choice === 'accept' ? 'good' : 'neutral', pop: choice === 'accept' ? 'Commission!' : `+${Math.round(visit.spent)} cr` });
    }
    return finish(none({ walkout: res.walkout }), { line, tone: choice === 'accept' ? 'good' : 'neutral', pop: choice === 'accept' ? 'Commission!' : '…' });
  }

  // Faulty return.
  if (v.kind === 'return' && v.returnOf) {
    const r = v.returnOf;
    if (choice === 'replace') {
      const l = s.shop.listings.find((x) => x.product.id === r.productId && x.stock > 0);
      if (l) {
        l.stock--;
        rep(s, 0.3);
        if (regular) regular.loyalty = clamp(regular.loyalty + 4);
        s.events.push({ kind: 'return', text: `Swapped a faulty ${r.productName} for ${v.name}.` });
        return finish(none({ note: 'swapped a faulty unit' }), { line: 'Cheers, that\'s sorted then!', tone: 'good', pop: 'Swapped' });
      }
    }
    if (choice === 'refuse') {
      rep(s, -2.5);
      if (regular) regular.loyalty = clamp(regular.loyalty - 20);
      s.events.push({ kind: 'return', text: `Refused ${v.name}'s refund on a faulty ${r.productName}. They're telling everyone.` });
      return finish(none({ walkout: 'refused', note: 'refund refused' }), { line: 'Unbelievable. I\'m leaving a review.', tone: 'bad', pop: 'Angry' });
    }
    s.refunds = round2(s.refunds + r.paid);
    rep(s, -0.3);
    if (regular) regular.loyalty = clamp(regular.loyalty + 2);
    s.events.push({ kind: 'return', text: `Refunded ${r.paid.toFixed(1)} cr to ${v.name} for a faulty ${r.productName}.` });
    return finish(none({ note: 'refunded' }), { line: 'Thanks for sorting it.', tone: 'neutral', pop: `−${Math.round(r.paid)} cr` });
  }

  // Shoplifter.
  if (v.kind === 'thief') {
    const victim = [...inStock(s)].sort((a, b) => b.price - a.price)[0];
    if (choice === `stop:${v.thiefSlot ?? 0}`) {
      rep(s, 0.6);
      s.events.push({ kind: 'theft', text: `You caught ${v.name} shoplifting and got the stock back.` });
      return finish(none({ caught: true, note: 'caught shoplifting' }), { line: 'Alright, alright! Here, take it back.', tone: 'good', pop: 'Caught!' });
    }
    const lost = victim ? Math.min(victim.stock, 1 + Math.floor(rng() * 3)) : 0;
    if (victim) victim.stock -= lost;
    const what = victim ? `${lost} × ${victim.product.brand.name}` : 'nothing';
    if (choice.startsWith('stop:')) {
      const idx = Number(choice.slice(5));
      const wrong = v.decoys?.[idx > (v.thiefSlot ?? 0) ? idx - 1 : idx];
      rep(s, -1.5);
      s.events.push({ kind: 'theft', text: `You stopped ${wrong?.name ?? 'the wrong person'}, who was innocent and furious. The real thief got away with ${what}.` });
      return finish(none({ note: 'stole from you' }), { line: 'How dare you! I\'ve done nothing!', tone: 'bad', pop: 'Wrong person' });
    }
    s.events.push({ kind: 'theft', text: `A shoplifter got away with ${what}.` });
    return finish(none({ note: 'stole from you' }), { line: 'They slipped out the door.', tone: 'bad', pop: `−${lost} stock` });
  }

  // ID check.
  if (v.looksYoung && (choice === 'check' || choice === 'serve')) {
    const minor = v.age < 18;
    if (choice === 'check' && minor) {
      rep(s, 0.3);
      s.events.push({ kind: 'id_refused', text: `Asked for ID; they were ${v.age} and you refused the sale. Good call.` });
      return finish(none({ walkout: 'underage' }), { line: 'Er… left it at home. Never mind.', tone: 'good', pop: 'Refused' });
    }
    if (choice === 'serve' && minor) {
      s.fines = round2(s.fines + ID_FINE);
      rep(s, -6);
      s.events.push({ kind: 'fine', text: `You sold to a ${v.age}-year-old. Trading Standards fined you ${ID_FINE} cr.` });
      const l = autoShop(s, v, data, rng).listing ?? inStock(s)[0];
      const spent = l ? sell(s, v, l, 1, data) : 0;
      return finish(none({ productId: l?.product.id, qty: l ? 1 : 0, spent, walkout: undefined, note: 'underage sale' }), { line: 'They were underage. That\'s a fine.', tone: 'bad', pop: `−${ID_FINE} cr` });
    }
    // Adult. Being carded can sting: some leave without buying (not with a quick scanner).
    if (choice === 'check' && rng() < (perk(s.shop, 'idScanner') ? 0.04 : 0.18)) {
      return finish(none({ walkout: 'offended' }), { line: `Seriously? I'm ${v.age}. Forget it.`, tone: 'bad', pop: 'Offended' });
    }
    const res = autoShop(s, v, data, rng);
    if (res.listing) {
      const visit = completePurchase(s, v, res.listing, res.score, data, rng);
      return finish(visit, { line: choice === 'check' ? `Here you go, I'm ${v.age}. Fair enough you asked.` : 'Cheers!', tone: 'neutral', pop: `+${Math.round(visit.spent)} cr` });
    }
    return finish(none({ walkout: res.walkout }), { line: 'Actually, I\'ll leave it today.', tone: 'neutral', pop: '…' });
  }

  // Nosy question.
  if (choice === 'explain' || choice === 'vague') {
    const target = [...inStock(s)].sort((a, b) => b.soldTotal - a.soldTotal)[0];
    if (v.kind === 'rival' && v.rivalId && target) {
      learn(s, v.rivalId, target, data, rng, choice === 'explain' ? 2.2 : 0.3);
      if (choice === 'explain') s.events.push({ kind: 'suspicious', text: `You told a curious "${v.name}" all about ${target.product.brand.name}. They took notes.` });
    }
    const res = autoShop(s, v, data, rng);
    const happy = v.kind !== 'rival' && choice === 'explain';
    if (happy) rep(s, 0.35);
    if (v.kind !== 'rival' && choice === 'vague') rep(s, -0.1);
    if (res.listing && (choice === 'explain' || rng() < 0.5)) {
      const visit = completePurchase(s, v, res.listing, res.score + (happy ? 10 : 0), data, rng);
      if (happy) maybeRecruit(s, v, res.listing, res.score + 15, rng, 0.25);
      return finish(visit, { line: happy ? 'That\'s fascinating. I\'ll take one!' : choice === 'vague' ? 'Fair enough. I\'ll take one anyway.' : 'Very interesting… thanks.', tone: happy ? 'good' : 'neutral', pop: `+${Math.round(visit.spent)} cr` });
    }
    return finish(none({ walkout: 'nothing' }), { line: choice === 'vague' ? 'Oh. Okay then.' : 'Thanks, I\'ll think about it.', tone: 'neutral', pop: '…' });
  }

  // Recommendation.
  if (choice.startsWith('rec:')) {
    const l = s.shop.listings.find((x) => x.product.id === choice.slice(4) && x.stock > 0);
    if (l) {
      const score = rate(s, l, v.archetype, data, regular);
      const grace = perk(s.shop, 'adviceGrace');
      if (score >= 45 - grace) {
        const great = score >= 60 - grace;
        const visit = completePurchase(s, v, l, score + (great ? 6 : 0), data, rng);
        if (great) {
          rep(s, 0.4);
          if (regular) regular.loyalty = clamp(regular.loyalty + 5);
          if (regular) regular.favourite = l.product.id;
          maybeRecruit(s, v, l, score + 10, rng, 0.2);
          s.events.push({ kind: 'good_advice', text: `${v.name} loved your pick: ${l.product.brand.name}.` });
        }
        return finish(visit, { line: great ? 'Perfect, that\'s exactly what I wanted!' : 'It\'s alright. I\'ll take it.', tone: great ? 'good' : 'neutral', pop: `+${Math.round(visit.spent)} cr` });
      }
      rep(s, -0.2);
      if (regular) regular.loyalty = clamp(regular.loyalty - 3);
      return finish(none({ walkout: 'nothing' }), { line: 'Hmm, that\'s not really what I asked for.', tone: 'bad', pop: 'No sale' });
    }
  }

  // "Let them browse" or anything else.
  const res = autoShop(s, v, data, rng);
  if (res.listing) {
    const visit = completePurchase(s, v, res.listing, res.score, data, rng);
    if (v.kind === 'rival' && v.rivalId) learn(s, v.rivalId, res.listing, data, rng, 1);
    return finish(visit, { line: 'I\'ll go with this one.', tone: 'neutral', pop: `+${Math.round(visit.spent)} cr` });
  }
  return finish(none({ walkout: res.walkout }), { line: 'Nothing for me today.', tone: 'neutral', pop: '…' });
}

/** The cautious choice staff make when you skip ahead. */
export function defaultChoice(e: Encounter): string {
  switch (e.kind) {
    case 'recommend': return 'browse';
    case 'id': return 'check';
    case 'probe': return 'vague';
    case 'shoplift': return 'ignore';
    case 'return': return 'refund';
    case 'commission': return 'decline';
    case 'pickup': return 'handover';
  }
}

/** Hand a Lab formula in for a commission. It's collected at your next opening. */
export function submitCommission(shop: ShopState, id: string, product: Product, data: GameData): ShopState {
  const c0 = shop.commissions.find((x) => x.id === id);
  if (!c0 || (c0.status !== 'open' && c0.status !== 'ready') || shop.day > c0.dueDay || !product.notes.length) return shop;
  const s = clone(shop);
  const c = s.commissions.find((x) => x.id === id)!;
  c.product = clone(product);
  c.score = scoreCommission(c.wants, c.archetype, product, data).score;
  c.status = 'ready';
  return s;
}

/** Close up: wages, rent, loyalty, auto-restock, summary. */
export function endDay(input: DaySession, data: GameData): { shop: ShopState; report: DayReport } {
  const s = clone(input);
  const shop = s.shop;
  const tier = tierOf(shop);

  for (const r of shop.regulars) {
    if (!r.gone && r.loyalty < 8) {
      r.gone = true;
      s.events.push({ kind: 'regular_leave', text: `${r.name} has stopped coming in.` });
    }
  }

  const queued = s.visits.filter((v) => v.walkout === 'queue').length;
  if (queued) s.events.push({ kind: 'stockout', text: `${queued} ${queued === 1 ? 'person' : 'people'} gave up queueing while you were busy at the counter.` });
  const offended = s.visits.filter((v) => v.walkout === 'offended').length;
  if (offended) s.events.push({ kind: 'id_refused', text: `${offended} adult${offended === 1 ? '' : 's'} took offence at being asked for ID and left.` });

  const wages = tier.rivals || tier.shoplift > 0 ? VIGILANCE[shop.vigilance].wage : 0;
  shop.cash = round2(shop.cash + s.revenue - s.refunds - s.fines - wages - tier.rent);
  shop.spentSinceOpen = 0;
  // Word of mouth fades: reputation drifts back toward 50 unless you keep earning it.
  const rest = 50 + perk(shop, 'repRest');
  shop.reputation = round1(clamp(shop.reputation + (rest - shop.reputation) * 0.05));
  shop.day = s.day + 1;

  let next: ShopState = shop;
  shop.listings.forEach((l, i) => {
    const want = l.autoRestockTo - l.stock - l.incoming;
    if (want > 0) {
      const before = next.cash;
      next = orderStock(next, i, want, data);
      const got = next.listings[i].incoming - l.incoming;
      if (got > 0) s.events.push({ kind: 'restock', text: `Auto-ordered ${got} × ${l.product.brand.name} (${round2(before - next.cash)} cr).` });
    }
  });
  if (next.cash < 0) s.events.push({ kind: 'broke', text: 'You\'re in debt. Cut costs or raise prices.' });

  const report: DayReport = {
    day: s.day,
    tier: tier.id,
    visitors: s.visits.length,
    buyers: s.visits.filter((v) => v.qty > 0).length,
    revenue: round2(s.revenue),
    refunds: s.refunds,
    fines: s.fines,
    wages,
    rent: tier.rent,
    restockSpend: s.restockSpend,
    profit: round2(s.revenue - s.refunds - s.fines - wages - tier.rent - s.restockSpend),
    cashEnd: next.cash,
    reputationStart: s.repStart,
    reputationEnd: next.reputation,
    sales: s.sales,
    visits: s.visits,
    events: s.events,
  };
  next.history = [...next.history, {
    day: s.day, revenue: report.revenue, profit: report.profit, cash: next.cash, reputation: next.reputation, visitors: s.visits.length,
  }].slice(-60);
  return { shop: next, report };
}

/** Whole day with a fixed choice policy (default: the cautious staff choice). */
export function simulateDay(shop: ShopState, data: GameData, choose: (e: Encounter, s: DaySession) => string = defaultChoice): { shop: ShopState; report: DayReport } {
  let s = beginDay(shop, data);
  for (let guard = 0; guard < 500; guard++) {
    const r = step(s, data);
    s = r.session;
    if (r.done) break;
    if (r.encounter) s = resolve(s, choose(r.encounter, s), data).session;
  }
  return endDay(s, data);
}

export interface Forecast {
  days: number;
  unitsPerDay: number;
  revenuePerDay: number;
  /** Takings minus build cost and refunds, before rent. */
  profitPerDay: number;
  returnsPerDay: number;
}

/**
 * How a product would do on its own in your current shop: a short trial run of
 * the real day sim (same tier, reputation and upgrades; no rivals), with staff
 * making the cautious choices. Deterministic for a given product and shop.
 */
export function forecast(product: Product, shop: ShopState, data: GameData, days = 5): Forecast {
  let t: ShopState = {
    ...newShop(deriveSeed(shop.seed, `forecast:${product.id}:${product.brand.price}`)),
    tier: shop.tier, reputation: shop.reputation, upgrades: [...(shop.upgrades ?? [])], cash: 1e9, rivals: [],
  };
  t = addListing(t, product, data);
  t.listings[0].price = product.brand.price;
  t.listings[0].stock = 9999;
  const cost = unitCost(product, data).total;
  let units = 0, revenue = 0, refunds = 0, returns = 0;
  for (let i = 0; i < days; i++) {
    const { shop: next, report } = simulateDay(t, data);
    units += report.sales[product.id] ?? 0;
    revenue += report.revenue;
    refunds += report.refunds;
    returns += report.visits.filter((v) => v.kind === 'return').length;
    t = next;
  }
  return {
    days,
    unitsPerDay: round1(units / days),
    revenuePerDay: round1(revenue / days),
    profitPerDay: round1((revenue - refunds - units * cost) / days),
    returnsPerDay: round1(returns / days),
  };
}
