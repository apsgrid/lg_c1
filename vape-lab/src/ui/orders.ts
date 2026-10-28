import { COMMISSION_GREAT, COMMISSION_OK, scoreCommission, submitCommission } from '../sim';
import { onShop, shopAction, shopState } from '../shopState';
import { data, state, subscribe } from '../state';
import { bar, clear, h, scoreColour } from './dom';
import { toast } from './toast';

/** Lab tab: commissions from regulars, checked live against the formula on the bench. */
export function mountOrders(root: HTMLElement, onNew: (count: number) => void): void {
  const body = h('div.orders');
  root.append(body);
  let seenOpen = 0;

  const render = () => {
    clear(body);
    const s = shopState.shop;
    const p = state.product;
    const live = s.commissions.filter((c) => c.status === 'open' || c.status === 'ready');
    const done = s.commissions.filter((c) => !['open', 'ready'].includes(c.status)).slice(-8).reverse();
    if (live.length > seenOpen) onNew(live.length);
    seenOpen = live.length;

    body.append(h('p.hint', {}, 'Loyal regulars sometimes ask you to make them something special. Design it here, then hand it in before the deadline. They collect it next time you open.'));
    if (!live.length) body.append(h('div.empty-state', {}, 'No orders right now. Keep your regulars happy and someone will ask.'));

    for (const c of live) {
      const c0 = data.customers.find((x) => x.id === c.archetype);
      const res = scoreCommission(c.wants, c.archetype, p, data);
      const daysLeft = c.dueDay - s.day;
      const canHand = !!p.notes.length && s.day <= c.dueDay && !shopState.playing;
      body.append(h('div.order', { class: c.status },
        h('div.order-head', {},
          h('span.avatar', {}, c0?.avatar ?? '?'),
          h('div', {}, h('b', {}, c.regularName), h('div.fine', {}, `${c0?.name} · due before you open day ${c.dueDay}`)),
          h('span.due', { class: daysLeft <= 0 ? 'bad' : daysLeft <= 1 ? 'warn' : '' }, daysLeft <= 0 ? 'Due today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`),
        ),
        h('div.bubble.small', {}, `“${c.text}”`),
        c.status === 'ready' && c.product
          ? h('div.handed', {}, `Handed in: ${c.product.brand.name} (${Math.round(c.score ?? 0)}/100). They collect it next opening. You can still swap it for a better one.`)
          : null,
        h('div.order-check-title.fine', {}, `Checked against what's on your bench: ${p.brand.name || 'Untitled'}`),
        h('ul.checks', {}, ...res.checks.map((k) => h('li', { class: k.met ? 'met' : k.credit > 0 ? 'part' : 'miss' },
          h('span.tick', { 'aria-hidden': 'true' }, k.met ? '✓' : k.credit > 0 ? '~' : '✗'),
          h('span', {}, h('b', {}, k.label), h('span.fine', {}, ` · ${k.detail}`)),
        ))),
        h('div.order-score', {},
          h('span', {}, `${c0?.name} would rate it `, h('b', {}, Math.round(res.customerScore))),
          h('span', {}, 'Match ', h('b', { style: `color:${scoreColour(res.score)}` }, `${Math.round(res.score)}/100`)),
        ),
        bar(res.score),
        h('div.fine', {}, res.score >= COMMISSION_GREAT ? 'They\'ll love it: tip, big loyalty, a friend, and a signature product.'
          : res.score >= COMMISSION_OK ? `They'll be pleased. ${COMMISSION_GREAT}+ makes it a triumph.` : `They'll be let down. Aim for ${COMMISSION_GREAT}+.`),
        h('button.primary', {
          disabled: !canHand,
          onclick: () => {
            shopAction((x) => submitCommission(x, c.id, p, data));
            toast(`Handed ${p.brand.name || 'it'} in for ${c.regularName}.`);
          },
        }, c.status === 'ready' ? 'Hand this one in instead' : 'Hand this formula in'),
      ));
    }

    if (done.length) {
      body.append(h('h4', {}, 'Past orders'), ...done.map((c) => h('div.past-order', { class: c.status },
        h('b', {}, c.regularName),
        h('span.fine', {}, c.status === 'delivered' ? `${c.product?.brand.name} · ${Math.round(c.score ?? 0)}/100${(c.score ?? 0) >= COMMISSION_GREAT ? ' ★ signature' : ''}` : c.status === 'failed' ? 'missed the deadline' : 'cancelled'),
      )));
    }
  };
  subscribe(render);
  onShop((r) => { if (r !== 'live') render(); });
  render();
}
