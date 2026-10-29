import { nightOrders, nightUsed, ORDER_LOYALTY } from '../sim';
import { shopState } from '../shopState';
import { data } from '../state';
import { h } from './dom';
import { openNightRound } from './driveby';

/** What you can do tonight, after closing: a Night Round for your regulars (or a drive-by, from the City). */
export function tonightCard(): HTMLElement {
  const s = shopState.shop;
  const card = h('div.tonight');
  if (shopState.playing) return card;
  if (nightUsed(s)) {
    card.append(h('b', {}, '🌙 Tonight'), h('p.fine', {}, s.lastRoundDay === s.day ? 'Round done. Get some sleep before you open up.' : 'You were out on a drive-by. Best lie low until morning.'));
    return card;
  }
  const orders = nightOrders(s, data);
  card.append(h('b', {}, '🌙 Tonight'));
  if (orders.length) {
    card.append(
      h('p.fine', {}, `${orders.length} regular${orders.length === 1 ? ' has' : 's have'} texted an order: ${orders.map((o) => `${o.name} (${o.productName})`).join(', ')}.`),
      h('button.primary', { onclick: () => openNightRound() }, `📦 Do the night round (${orders.length})`),
      h('p.fine', {}, 'One job a night: a round, or a drive-by from the City.'),
    );
  } else {
    card.append(h('p.fine', {}, s.regulars.some((r) => !r.gone && r.loyalty >= ORDER_LOYALTY)
      ? 'No orders tonight (or nothing in stock to deliver). Loyal regulars text in orders most nights.'
      : `No orders yet. Regulars with loyalty ${ORDER_LOYALTY}+ text you orders for a night round.`));
  }
  return card;
}
