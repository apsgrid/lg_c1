import { migrateShop, newShop, type DayReport, type Encounter, type Outcome, type ShopState, type Visit } from './sim';

const KEY = 'vapelab.v1.shop';

function load(): ShopState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrateShop(JSON.parse(raw));
  } catch {
    /* fall through */
  }
  return newShop(Math.floor(Math.random() * 1e9));
}

export const shopState = {
  shop: load(),
  lastReport: null as DayReport | null,
  playing: false,
  /** Shop as it stands mid-day (stock, cash in the till) while a day is running. */
  live: null as ShopState | null,
  liveVisits: [] as Visit[],
  liveRevenue: 0,
  /** Minutes the queue is backed up (see QUEUE_LIMIT). */
  liveQueue: 0,
  encounter: null as Encounter | null,
  outcome: null as (Outcome & { who: string }) | null,
};

type Sub = (reason: string) => void;
const subs = new Set<Sub>();
export function onShop(fn: Sub): void {
  subs.add(fn);
}

export function saveShop(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(shopState.shop));
  } catch {
    /* storage blocked: the shop still runs for this session */
  }
}

export function notifyShop(reason: string): void {
  for (const fn of subs) fn(reason);
}

/** Apply a pure shop action and persist. Ignored while a day is running. */
export function shopAction(fn: (s: ShopState) => ShopState, reason = 'shop'): void {
  if (shopState.playing) return;
  shopState.shop = fn(shopState.shop);
  saveShop();
  notifyShop(reason);
}

export function resetShop(): void {
  shopState.shop = newShop(Math.floor(Math.random() * 1e9), shopState.shop.name);
  shopState.lastReport = null;
  saveShop();
  notifyShop('reset');
}

