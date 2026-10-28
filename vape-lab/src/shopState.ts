import { data } from './state';
import { newShop, simulateDay, type DayReport, type ShopState } from './sim';

const KEY = 'vapelab.v1.shop';

function load(): ShopState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as ShopState;
  } catch {
    /* fall through */
  }
  return newShop(Math.floor(Math.random() * 1e9));
}

export const shopState = {
  shop: load(),
  lastReport: null as DayReport | null,
  playing: false,
};

type Sub = (reason: string) => void;
const subs = new Set<Sub>();
export function onShop(fn: Sub): void {
  subs.add(fn);
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(shopState.shop));
  } catch {
    /* storage blocked: the shop still runs for this session */
  }
}

export function notifyShop(reason: string): void {
  for (const fn of subs) fn(reason);
}

/** Apply a pure shop action and persist. */
export function shopAction(fn: (s: ShopState) => ShopState, reason = 'shop'): void {
  shopState.shop = fn(shopState.shop);
  save();
  notifyShop(reason);
}

/** Simulate the day now (so it's saved even if the tab closes), but show it only after playback. */
export function runDay(): { report: DayReport; reveal: () => void } {
  const before = shopState.shop;
  const { shop, report } = simulateDay(before, data);
  try {
    localStorage.setItem(KEY, JSON.stringify(shop));
  } catch {
    /* ignore */
  }
  return {
    report,
    reveal: () => {
      shopState.shop = shop;
      shopState.lastReport = report;
    },
  };
}

export function resetShop(): void {
  shopState.shop = newShop(Math.floor(Math.random() * 1e9), shopState.shop.name);
  shopState.lastReport = null;
  save();
  notifyShop('reset');
}
