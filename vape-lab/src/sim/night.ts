// Night Round: after closing, regulars text in orders and you deliver them
// Paperboy-style along a street in the district you sell from. Pure and seeded.
import { deriveSeed, mulberry32 } from './rng';
import { nightUsed, sellLocId, type ShopState } from './shop';
import type { CustomerId, GameData } from './types';
import { clamp, round2 } from './util';

export interface NightOrder {
  regularId: string;
  name: string;
  archetype: CustomerId;
  productId: string;
  productName: string;
  price: number;
  /** House number on the street, for the porch sign. */
  door: number;
}

/** Loyalty needed before a regular will text you an order. */
export const ORDER_LOYALTY = 35;
const PERFECT_TIP = 0.2;

/** Tonight's orders: loyal regulars who want their usual (or anything you have). Uses up no stock until delivered. */
export function nightOrders(shop: ShopState, data: GameData): NightOrder[] {
  void data;
  const rng = mulberry32(deriveSeed(shop.seed, `orders:${shop.day}:${sellLocId(shop)}`));
  const left = new Map(shop.listings.map((l) => [l.product.id, l.stock]));
  const cap = Math.min(6, 2 + shop.tier);
  const doors = new Set<number>();
  const orders: NightOrder[] = [];
  const keen = shop.regulars.filter((r) => !r.gone && r.loyalty >= ORDER_LOYALTY).sort((a, b) => b.loyalty - a.loyalty);
  for (const r of keen) {
    if (orders.length >= cap) break;
    if (rng() > 0.35 + r.loyalty / 200) continue;
    const fav = shop.listings.find((l) => l.product.id === r.favourite && (left.get(l.product.id) ?? 0) > 0);
    const pick = fav ?? shop.listings.filter((l) => (left.get(l.product.id) ?? 0) > 0).sort((a, b) => b.stock - a.stock)[0];
    if (!pick) break;
    left.set(pick.product.id, (left.get(pick.product.id) ?? 0) - 1);
    let door = 2 + Math.floor(rng() * 60);
    while (doors.has(door)) door++;
    doors.add(door);
    orders.push({ regularId: r.id, name: r.name, archetype: r.archetype, productId: pick.product.id, productName: pick.product.brand.name, price: pick.price, door });
  }
  return orders;
}

export interface RoundResult {
  shop: ShopState;
  delivered: number;
  takings: number;
  tip: number;
  text: string;
}

/**
 * Settle a Night Round. `delivered` is the regulars whose doorstep you hit,
 * `wrongHits` the windows of houses that didn't order. Deliveries are paid,
 * build loyalty and use stock; missed orders cost loyalty; a perfect round
 * earns a tip and a little reputation; broken windows cost reputation and heat.
 */
export function nightRound(shop: ShopState, data: GameData, delivered: string[], wrongHits: number): RoundResult {
  const orders = nightOrders(shop, data);
  if (nightUsed(shop) || !orders.length) return { shop, delivered: 0, takings: 0, tip: 0, text: 'No round tonight.' };
  const s = JSON.parse(JSON.stringify(shop)) as ShopState;
  s.lastRoundDay = s.day;
  const got = new Set(delivered);
  let takings = 0, n = 0;
  for (const o of orders) {
    const reg = s.regulars.find((r) => r.id === o.regularId);
    const l = s.listings.find((x) => x.product.id === o.productId);
    if (got.has(o.regularId) && l && l.stock > 0) {
      l.stock--;
      l.soldTotal++;
      takings += o.price;
      n++;
      if (reg) reg.loyalty = clamp(reg.loyalty + 6);
    } else if (reg) reg.loyalty = clamp(reg.loyalty - 4);
  }
  const perfect = n === orders.length;
  const tip = perfect ? round2(takings * PERFECT_TIP) : 0;
  s.cash = round2(s.cash + takings + tip);
  if (perfect) s.reputation = clamp(s.reputation + 1.5);
  if (wrongHits > 0) {
    s.reputation = clamp(s.reputation - 1.5 * wrongHits);
    s.heat = clamp(s.heat + 2 * wrongHits);
  }
  let text = n ? `Delivered ${n} of ${orders.length} order${orders.length === 1 ? '' : 's'}: ${round2(takings)} cr.` : 'Not a single parcel reached a doorstep.';
  if (perfect) text += ` Perfect round: ${tip} cr in tips and your regulars are telling their friends.`;
  else if (n < orders.length) text += ` ${orders.length - n} regular${orders.length - n === 1 ? ' was' : 's were'} left waiting, and they'll remember.`;
  if (wrongHits) text += ` You broke ${wrongHits} window${wrongHits === 1 ? '' : 's'} on houses that didn't order: complaints, and a little heat.`;
  return { shop: s, delivered: n, takings: round2(takings), tip, text };
}
