import {
  addListing, beginDay, canUpgrade, defaultChoice, endDay, faultChance, intelEstimate, KNOCKOFF_AT, maxOrder, MAX_STOCK,
  nextTier, orderStock, removeListing, resolve, reviseListing, setAutoRestock, setPrice, setVigilance, shelfSlots, step,
  tierOf, unitCost, upgradeShop, VIGILANCE,
  type DayEventKind, type DaySession, type Product, type ShopState, type Visit,
} from '../sim';
import { notifyShop, onShop, resetShop, saveShop, shopAction, shopState } from '../shopState';
import { data, state } from '../state';
import { storage } from '../store/storage';
import type { ShopScene } from '../view/shopScene';
import { bar, clear, h, scoreColour } from './dom';
import { toast } from './toast';

const archetype = (id: string) => data.customers.find((c) => c.id === id);
const cr = (v: number) => `${v < 0 ? '−' : ''}${Math.round(Math.abs(v))} cr`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function productName(shop: ShopState, pid?: string): string {
  return shop.listings.find((l) => l.product.id === pid)?.product.brand.name
    ?? storage.loadFormulas().find((f) => f.product.id === pid)?.product.brand.name
    ?? 'a discontinued product';
}

function knockoffsOf(shop: ShopState, pid: string) {
  return shop.rivals.flatMap((r) => r.knockoffs.filter((k) => k.productId === pid).map((k) => ({ rival: r, k })));
}

/** The shop as currently shown: mid-day state while a day runs. */
const view = (): ShopState => shopState.live ?? shopState.shop;

// --- The day loop ------------------------------------------------------------------------

let sceneRef: ShopScene | null = null;
let pendingChoice: ((id: string) => void) | null = null;
let fastForward = false;

/** Called by the counter buttons. */
export function choose(id: string): void {
  const fn = pendingChoice;
  pendingChoice = null;
  fn?.(id);
}

function slotOf(s: ShopState, pid?: string): number {
  const i = s.listings.findIndex((l) => l.product.id === pid);
  return i >= 0 ? i : Math.floor(Math.random() * Math.max(1, s.listings.length));
}

function visitPop(v: Visit): { text: string; colour: string } | undefined {
  if (v.caught) return { text: 'Caught!', colour: '#3ddc84' };
  if (v.walkout === 'banned') return { text: 'Banned', colour: '#ff5a6a' };
  if (v.walkout === 'stockout') return { text: 'Sold out', colour: '#ff5a6a' };
  if (v.walkout === 'nothing') return { text: '…', colour: '#a39fbb' };
  if (v.qty > 0) return { text: `+${Math.round(v.spent)} cr`, colour: '#3ddc84' };
  return undefined;
}

const TONE_COLOUR = { good: '#3ddc84', bad: '#ff5a6a', neutral: '#e9e6f2' };

/** Open for the day: serve customers one by one, stopping at the counter for conversations. */
export async function openShop(): Promise<void> {
  if (shopState.playing) {
    // Skip: staff handle the rest with cautious choices.
    fastForward = true;
    if (pendingChoice && shopState.encounter) choose(defaultChoice(shopState.encounter));
    return;
  }
  const start = shopState.shop;
  if (!start.listings.length) {
    toast('Put at least one product out first.');
    return;
  }
  if (!start.listings.some((l) => l.stock + l.incoming > 0)) {
    toast('You have nothing to sell. Order some stock first.');
    return;
  }
  fastForward = false;
  let session: DaySession = beginDay(start, data);
  shopState.playing = true;
  shopState.live = session.shop;
  shopState.liveVisits = [];
  shopState.liveRevenue = 0;
  shopState.outcome = null;
  sceneRef?.clearPeople();
  sceneRef?.setShop(session.shop);
  notifyShop('playing');

  const gap = Math.max(200, 700 / tierOf(start).footfall);
  for (let guard = 0; guard < 600; guard++) {
    const r = step(session, data);
    session = r.session;
    if (r.done) break;
    const v = session.visitors[r.visit ? session.pos - 1 : session.pos];
    const shopper = { archetype: v.archetype, regular: !!v.regularId, young: v.looksYoung };

    if (r.visit) {
      shopState.liveVisits.unshift(r.visit);
      if (!fastForward) {
        sceneRef?.walkThrough(shopper, slotOf(session.shop, r.visit.productId), r.visit.qty > 0, visitPop(r.visit));
        sceneRef?.setShop(session.shop);
      }
    }

    if (r.encounter) {
      let choice: string;
      if (fastForward) {
        choice = defaultChoice(r.encounter);
      } else {
        if (r.encounter.kind === 'shoplift') sceneRef?.showSuspects(3);
        else await sceneRef?.toCounter(shopper, slotOf(session.shop));
        shopState.encounter = r.encounter;
        notifyShop('encounter');
        choice = fastForward ? defaultChoice(r.encounter) : await new Promise<string>((res) => { pendingChoice = res; });
      }
      const enc = r.encounter;
      const res = resolve(session, choice, data);
      session = res.session;
      shopState.encounter = null;
      shopState.liveVisits.unshift(res.visit);
      shopState.outcome = { ...res.outcome, who: enc.who };
      if (enc.kind === 'shoplift') {
        const picked = choice.startsWith('stop:') ? Number(choice.slice(5)) : null;
        sceneRef?.resolveSuspects(picked, res.outcome.tone === 'good');
      } else {
        sceneRef?.releaseCounter(res.outcome.pop, TONE_COLOUR[res.outcome.tone]);
      }
      sceneRef?.setShop(session.shop);
    }

    shopState.live = session.shop;
    shopState.liveRevenue = session.revenue - session.refunds - session.fines;
    notifyShop('live');
    if (!fastForward) await sleep(r.encounter ? 1100 : gap);
  }

  const { shop, report } = endDay(session, data);
  shopState.shop = shop;
  shopState.lastReport = report;
  shopState.live = null;
  shopState.playing = false;
  shopState.outcome = null;
  saveShop();
  sceneRef?.setShop(shop);
  notifyShop('day');
}

// --- Left panel: shop, progression, shelf ------------------------------------------------

export function mountShelf(root: HTMLElement, scene: ShopScene): void {
  sceneRef = scene;
  const nameInput = h('input#shop-name', {
    type: 'text', maxLength: 28, value: shopState.shop.name, placeholder: 'Name your shop', 'aria-label': 'Shop name',
    onchange: (e: Event) => shopAction((s) => ({ ...s, name: (e.target as HTMLInputElement).value.trim() || 'My Vape Store' })),
  });
  const tierCard = h('div.tier-card');
  const status = h('div.shop-status');
  const vigilHead = h('h3', {}, 'Security ', h('span.muted', {}, '(spots shoplifters and secret shoppers)'));
  const vigil = h('div.chips', { role: 'radiogroup', 'aria-label': 'Security' });
  const shelfHead = h('h3');
  const list = h('div.listings');
  const addSel = h('select#add-product', { 'aria-label': 'Product to stock' });
  const addBtn = h('button', { onclick: add }, 'Put out');
  const openBtn = h('button.primary.big.open-btn', { onclick: () => void openShop() });

  root.append(
    h('label', { for: 'shop-name' }, h('h3', {}, 'Shop name')),
    nameInput,
    status,
    tierCard,
    vigilHead,
    vigil,
    shelfHead,
    list,
    h('div.add-row', {}, addSel, addBtn),
    h('p.fine', {}, 'Stock comes from your Library: save products in the Lab first. Orders are paid now and arrive tomorrow morning.'),
    openBtn,
    h('details.danger', {},
      h('summary', {}, 'Start over'),
      h('p.fine', {}, 'Sells up and starts again from the car boot with starting cash. Your lab formulas are kept.'),
      h('button.ghost', {
        onclick: (e: Event) => {
          const b = e.currentTarget as HTMLButtonElement;
          if (b.dataset.armed) { resetShop(); scene.setShop(shopState.shop); toast('Back to the car boot!'); return; }
          b.dataset.armed = '1';
          b.textContent = 'Tap again to start over';
          setTimeout(() => { delete b.dataset.armed; b.textContent = 'Start again'; }, 4000);
        },
      }, 'Start again'),
    ),
  );

  function candidates(): Product[] {
    const seen = new Set<string>();
    const out: Product[] = [];
    for (const p of [state.product, ...storage.loadFormulas().map((f) => f.product)]) {
      if (!p.notes.length || seen.has(p.id) || shopState.shop.listings.some((l) => l.product.id === p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  }

  function add(): void {
    const p = candidates().find((x) => x.id === addSel.value);
    if (!p) return;
    shopAction((s) => addListing(s, p, data));
    toast(`${p.brand.name || 'Untitled'} is out. Order some stock.`);
  }

  function render(): void {
    const s = view();
    const busy = shopState.playing;
    const tier = tierOf(s);
    if (document.activeElement !== nameInput) nameInput.value = s.name;
    nameInput.disabled = busy;
    openBtn.textContent = busy ? 'Skip to closing (staff take over)' : `Open up: day ${s.day}`;

    clear(status);
    status.append(
      h('div', {}, h('span.muted', {}, 'Day'), h('b', {}, String(s.day))),
      h('div', {}, h('span.muted', {}, busy ? 'Cash (before today)' : 'Cash'), h('b', { class: s.cash < 0 ? 'bad' : '' }, cr(s.cash))),
      h('div.rep', {}, h('span.muted', {}, 'Reputation'), h('b', {}, Math.round(s.reputation)), bar(s.reputation)),
    );

    // Progression.
    clear(tierCard);
    const next = nextTier(s);
    const up = canUpgrade(s);
    tierCard.append(
      h('div.tier-steps', { 'aria-hidden': 'true' }, ...['Car', 'Garage', 'Small', 'Medium', 'Large', 'Premium'].map((n, i) => h('span', { class: i < s.tier ? 'done' : i === s.tier ? 'now' : '' }, n))),
      h('b', {}, tier.name),
      h('div.fine', {}, tier.blurb),
      h('div.fine', {}, `${tier.slots} product slots · rent ${tier.rent} cr/day · up to ${tier.maxRegulars} regulars`),
    );
    if (next) {
      const upBtn = h('button.small', {
        class: up.ok ? 'primary' : '', disabled: !up.ok || busy,
        onclick: (e: Event) => {
          const b = e.currentTarget as HTMLButtonElement;
          if (!b.dataset.armed) {
            b.dataset.armed = '1';
            b.textContent = `Tap again to pay ${next.upgradeCost} cr`;
            setTimeout(() => { delete b.dataset.armed; render(); }, 4000);
            return;
          }
          shopAction(upgradeShop, 'upgrade');
          scene.setShop(shopState.shop);
          toast(`Welcome to your ${next.name.toLowerCase()}!`);
        },
      }, `Move to ${next.name} (${next.upgradeCost} cr)`);
      tierCard.append(h('div.tier-next', {}, upBtn, h('div.fine', { class: up.ok ? 'good' : '' }, up.ok ? `Ready: ${next.blurb}` : up.reason)));
    }

    const needsSecurity = tier.rivals || tier.shoplift > 0;
    vigilHead.hidden = vigil.hidden = !needsSecurity;
    clear(vigil);
    VIGILANCE.forEach((v, i) => vigil.append(h('button.chip', {
      class: s.vigilance === i ? 'on' : '', role: 'radio', 'aria-checked': String(s.vigilance === i), disabled: busy,
      onclick: () => shopAction((x) => setVigilance(x, i as 0 | 1 | 2)),
    }, `${v.label}${v.wage ? ` · ${v.wage} cr/day` : ''}`)));

    clear(shelfHead);
    shelfHead.append(tier.id === 'car' ? 'In the boot ' : 'On display ', h('span.muted', {}, `(${s.listings.length}/${shelfSlots(s)})`));
    clear(list);
    if (!s.listings.length) list.append(h('div.empty-state', {}, 'Nothing out yet. Pick a product below.'));
    s.listings.forEach((l, i) => {
      const p = l.product;
      const cost = unitCost(p, data).total;
      const margin = l.price - cost;
      const kos = knockoffsOf(s, p.id);
      const fc = faultChance(p);
      const labIsRevision = state.product.id !== p.id && state.product.brand.name === p.brand.name && state.product.notes.length > 0;
      const priceVal = h('b', {}, `${l.price.toFixed(1)} cr`);
      const restockVal = h('b', {}, l.autoRestockTo ? `to ${l.autoRestockTo}` : 'off');
      list.append(h('div.listing', { style: `--c:${p.brand.labelColour}` },
        h('div.listing-head', {},
          h('span.swatch'),
          h('b', {}, p.brand.name || 'Untitled'),
          h('span.stock', { class: l.stock === 0 ? 'bad' : l.stock < 5 ? 'warn' : '' }, `${l.stock} in stock`, l.incoming ? h('span.muted', {}, ` +${l.incoming} tomorrow`) : null),
          h('button.icon', { disabled: busy, title: 'Take it off sale', 'aria-label': `Remove ${p.brand.name}`, onclick: () => shopAction((x) => removeListing(x, i)) }, '×'),
        ),
        h('div.tags', {},
          h('span.tag', {}, p.brand.format === 'disposable' ? 'Disposable' : 'Refillable'),
          h('span.tag', {}, p.brand.tier),
          h('span.tag', { class: fc >= 0.1 ? 'bad' : '' }, `~${Math.round(fc * 100)}% faulty`),
        ),
        kos.length ? h('div.ko', {}, `Knocked off by ${kos.map((k) => `${k.rival.name} (“${k.k.name}”)`).join(', ')}`) : null,
        h('label.inline', {}, h('span', {}, 'Price ', priceVal, h('span.muted', {}, ` · cost ${cost.toFixed(2)} · margin `), h('span', { class: margin > 0 ? 'good' : 'bad' }, margin.toFixed(2))),
          h('input', {
            type: 'range', min: 3, max: 60, step: 0.5, value: String(l.price), 'aria-label': `${p.brand.name} price`, disabled: busy,
            oninput: (e: Event) => { priceVal.textContent = `${Number((e.target as HTMLInputElement).value).toFixed(1)} cr`; },
            onchange: (e: Event) => shopAction((x) => setPrice(x, i, Number((e.target as HTMLInputElement).value))),
          })),
        h('div.order-row', {},
          h('span.muted', {}, 'Order'),
          ...[10, 25].map((q) => h('button.small', {
            disabled: busy || maxOrder(s, i, data) < 1,
            onclick: () => { const n = Math.min(q, maxOrder(shopState.shop, i, data)); shopAction((x) => orderStock(x, i, q, data)); toast(`Ordered ${n} × ${p.brand.name} (${(n * cost).toFixed(2)} cr)`); },
          }, `+${q}`)),
          h('button.small', {
            disabled: busy || maxOrder(s, i, data) < 1,
            onclick: () => { const n = maxOrder(shopState.shop, i, data); shopAction((x) => orderStock(x, i, n, data)); toast(`Ordered ${n} × ${p.brand.name}`); },
          }, 'Max'),
        ),
        h('label.inline', {}, h('span', {}, 'Auto-restock ', restockVal),
          h('input', {
            type: 'range', min: 0, max: MAX_STOCK, step: 5, value: String(l.autoRestockTo), 'aria-label': `${p.brand.name} auto-restock level`, disabled: busy,
            oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); restockVal.textContent = v ? `to ${v}` : 'off'; },
            onchange: (e: Event) => shopAction((x) => setAutoRestock(x, i, Number((e.target as HTMLInputElement).value))),
          })),
        labIsRevision && !busy ? h('button.small.ghost', {
          onclick: () => { shopAction((x) => reviseListing(x, i, state.product)); toast(`${p.brand.name} now uses your latest lab formula.`); },
        }, 'Use revised formula from the Lab') : null,
      ));
    });

    clear(addSel);
    const c = candidates();
    if (!c.length) addSel.append(h('option', { value: '' }, 'No new products. Save some in the Lab.'));
    for (const p of c) addSel.append(h('option', { value: p.id }, `${p.brand.name || 'Untitled'}${p.brand.format === 'disposable' ? ' (disposable)' : ''}${p.id === state.product.id ? ' (in the Lab now)' : ''}`));
    addBtn.disabled = busy || !c.length || s.listings.length >= shelfSlots(s);
    addSel.disabled = busy;
    openBtn.classList.toggle('pulse', !busy && s.listings.some((l) => l.stock + l.incoming > 0));
  }
  onShop(() => render());
  render();
}

// --- Counter: serve customers, then the day report ----------------------------------------

const EVENT_ICON: Record<DayEventKind, string> = {
  delivery: '📦', stockout: '⚠', regular_join: '★', regular_leave: '☆', caught: '🛑', knockoff: '🕵', suspicious: '👀',
  restock: '↻', broke: '💸', return: '↩', fine: '⚖', id_refused: '🪪', theft: '🫳', good_advice: '💬',
};

function visitLine(s: ShopState, v: Visit): string {
  if (v.note === 'caught shoplifting') return 'caught shoplifting';
  if (v.note === 'stole from you') return 'shoplifted';
  if (v.note === 'underage sale') return 'underage: you sold to them';
  if (v.note === 'refunded') return 'returned a faulty unit (refunded)';
  if (v.note === 'swapped a faulty unit') return 'returned a faulty unit (swapped)';
  if (v.note === 'refund refused') return 'returned a faulty unit (refused)';
  if (v.caught) return `secret shopper from ${s.rivals.find((x) => x.id === v.rivalId)?.name ?? 'a rival'}`;
  if (v.walkout === 'banned') return 'turned away at the door';
  if (v.walkout === 'underage') return 'no ID, refused';
  if (v.walkout === 'stockout') return 'left: favourite sold out';
  if (v.walkout === 'nothing') return 'browsed, bought nothing';
  return `bought ${v.qty} × ${productName(s, v.productId)}`;
}

function visitRow(s: ShopState, v: Visit): HTMLElement {
  const c = archetype(v.archetype);
  const bad = v.caught || v.walkout === 'banned' || v.note === 'stole from you' || v.note === 'underage sale' || v.note === 'refund refused';
  return h('div.visit', { class: bad ? 'caught' : v.qty ? 'bought' : 'left' },
    h('span.avatar', {}, v.kind === 'thief' ? '🫳' : c?.avatar ?? '?'),
    h('div', {},
      h('b', {}, v.kind === 'thief' ? 'Shoplifter' : v.regularId ? v.name : c?.name ?? v.name), v.regularId ? h('span.reg-badge', {}, 'regular') : null,
      h('div.fine', {}, visitLine(s, v)),
      v.tell && !v.caught ? h('div.tell', {}, `Seen: ${v.tell}`) : null,
    ),
    v.spent ? h('b.spent', {}, `+${v.spent.toFixed(0)}`) : null,
  );
}

export function mountCounter(root: HTMLElement): void {
  const body = h('div.today');
  root.append(body);

  const renderEncounter = (): HTMLElement => {
    const e = shopState.encounter!;
    const c = archetype(e.archetype);
    const s = view();
    const isRec = e.kind === 'recommend';
    return h('div.encounter', { class: `enc-${e.kind}` },
      h('div.enc-title', {}, e.title),
      h('div.enc-who', {},
        h('span.avatar.big', {}, e.kind === 'shoplift' ? '🫳' : c?.avatar ?? '?'),
        h('div', {}, h('b', {}, e.kind === 'shoplift' ? 'Three customers by the shelves' : e.who), e.kind === 'shoplift' ? null : h('div.fine', {}, e.look)),
      ),
      h('div.bubble', {}, `“${e.line}”`),
      e.detail ? h('div.enc-detail', {}, e.detail) : null,
      h('div.enc-options', { class: isRec ? 'recs' : '' }, ...e.options.map((o) => {
        const pid = o.id.startsWith('rec:') ? o.id.slice(4) : null;
        const l = pid ? s.listings.find((x) => x.product.id === pid) : null;
        return h('button.enc-opt', { class: o.id === 'serve' || o.id === 'refuse' ? 'risky' : '', style: l ? `--c:${l.product.brand.labelColour}` : '', onclick: () => choose(o.id) },
          l ? h('span.swatch') : null,
          h('span.opt-main', {}, h('b', {}, o.label), o.hint ? h('span.fine', {}, o.hint) : null),
        );
      })),
    );
  };

  const render = () => {
    clear(body);
    const s = view();
    if (shopState.playing) {
      body.append(h('div.live-head', {},
        h('b', {}, `Day ${s.day} · open`),
        h('span', {}, `Till: ${cr(shopState.liveRevenue)}`),
        h('button.small.ghost', { onclick: () => void openShop() }, 'Skip to closing'),
      ));
      if (shopState.encounter) {
        const card = renderEncounter();
        body.append(card);
        requestAnimationFrame(() => card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      }
      else {
        const o = shopState.outcome;
        body.append(o
          ? h('div.outcome', { class: `tone-${o.tone}` }, h('b', {}, o.who), h('div', {}, `“${o.line}”`))
          : h('div.empty-state', {}, 'Customers are coming in…'));
      }
      body.append(h('h4', {}, 'So far today'), h('div.visits', {}, ...shopState.liveVisits.slice(0, 30).map((v) => visitRow(s, v))));
      return;
    }
    const r = shopState.lastReport;
    if (!r) {
      body.append(h('div.empty-state', {},
        h('b', {}, `Day ${s.day} at ${s.name}`), h('br'),
        `You're selling from: ${tierOf(s).name.toLowerCase()}. Put products out, order stock, then press Open up. Most people just buy, but some will want a chat: advice, ID checks, returns. Keep an eye out for shoplifters.`));
      return;
    }
    const repD = r.reputationEnd - r.reputationStart;
    body.append(
      h('h3', {}, `Day ${r.day} report`),
      h('div.stats', {},
        h('div.stat', {}, h('span.muted', {}, 'Visitors'), h('b', {}, r.visitors), h('span.fine', {}, `${r.buyers} bought`)),
        h('div.stat', {}, h('span.muted', {}, 'Takings'), h('b', {}, cr(r.revenue)), r.refunds ? h('span.fine.bad', {}, `refunds ${cr(r.refunds)}`) : null),
        h('div.stat', {}, h('span.muted', {}, 'Profit'), h('b', { class: r.profit >= 0 ? 'good' : 'bad' }, cr(r.profit)),
          h('span.fine', {}, `rent ${r.rent}${r.wages ? ` · staff ${r.wages}` : ''} · stock ${r.restockSpend.toFixed(0)}${r.fines ? ` · fines ${r.fines}` : ''}`)),
        h('div.stat', {}, h('span.muted', {}, 'Reputation'), h('b', {}, Math.round(r.reputationEnd)), h('span.fine', { class: repD >= 0 ? 'good' : 'bad' }, `${repD >= 0 ? '▲' : '▼'} ${Math.abs(repD).toFixed(1)}`)),
      ),
    );
    if (r.events.length) {
      body.append(h('h4', {}, 'What happened'), h('ul.events', {}, ...r.events.map((e) => h('li', { class: `ev-${e.kind}` }, h('span.ev-icon', { 'aria-hidden': 'true' }, EVENT_ICON[e.kind]), e.text))));
    }
    const sold = Object.entries(r.sales).sort((a, b) => b[1] - a[1]);
    if (sold.length) body.append(h('h4', {}, 'Sales'), h('div.sales', {}, ...sold.map(([pid, n]) => h('div', {}, h('span', {}, productName(s, pid)), h('b', {}, `${n}`)))));
    body.append(h('h4', {}, 'Visitor log'), h('div.visits', {}, ...r.visits.map((v) => visitRow(s, v))));
  };
  onShop(render);
  render();
}

// --- Regulars ---------------------------------------------------------------------------

export function mountRegulars(root: HTMLElement): void {
  const body = h('div');
  root.append(h('p.hint', {}, 'Regulars come back on their own. Keep their favourite in stock and give them good advice and they get more loyal. Let it sell out, or refuse their refund, and they drift away.'), body);
  const render = () => {
    clear(body);
    const s = view();
    const active = s.regulars.filter((r) => !r.gone).sort((a, b) => b.loyalty - a.loyalty);
    const gone = s.regulars.filter((r) => r.gone);
    body.append(h('p.fine', {}, `${active.length} of up to ${tierOf(s).maxRegulars} at your ${tierOf(s).name.toLowerCase()}.`));
    if (!active.length) body.append(h('div.empty-state', {}, 'No regulars yet. Customers who love a product, or your advice, may start coming back.'));
    for (const r of active) {
      const c = archetype(r.archetype);
      const fav = s.listings.find((l) => l.product.id === r.favourite);
      body.append(h('div.regular', {},
        h('span.avatar', {}, c?.avatar ?? '?'),
        h('div.reg-main', {},
          h('b', {}, r.name),
          h('div.fine', {}, `${c?.name} · ${r.visits} visit${r.visits === 1 ? '' : 's'} · since day ${r.joinedDay}`),
          h('div.fine', {}, 'Favourite: ', h('span', { class: fav ? '' : 'bad' }, fav ? `${fav.product.brand.name}${fav.stock ? '' : ' (sold out!)'}` : `${productName(s, r.favourite)} (not stocked)`)),
          h('div.loyalty', {}, h('span.fine', {}, 'Loyalty'), bar(r.loyalty, scoreColour(r.loyalty))),
        ),
      ));
    }
    if (gone.length) body.append(h('details', {}, h('summary.muted', {}, `${gone.length} former regular${gone.length === 1 ? '' : 's'}`), ...gone.map((r) => h('div.fine', {}, `${r.name} (${archetype(r.archetype)?.name})`))));
  };
  onShop((r) => { if (r !== 'live') render(); });
  render();
}

// --- Rivals -----------------------------------------------------------------------------

export function mountRivals(root: HTMLElement): void {
  const body = h('div');
  root.append(body);
  const render = () => {
    clear(body);
    const s = view();
    if (!tierOf(s).rivals) {
      body.append(h('div.empty-state', {}, 'Rival stores don\'t notice a car boot or garage seller. Once you open a Small store, expect secret shoppers.'));
      return;
    }
    body.append(h('p.hint', {}, `Rival stores send secret shoppers who look like everyone else. Watch for nosy questions about your recipes. At ${KNOCKOFF_AT}% knowledge they sell a knock-off. Security catches shoppers; revising a formula in the Lab throws rivals off.`));
    for (const r of s.rivals) {
      const rows = s.listings.map((l) => {
        const est = intelEstimate(s, r, l.product.id);
        return h('div.intel-row', {},
          h('span', {}, l.product.brand.name || 'Untitled'),
          est === null ? h('span.muted.fine', {}, 'unknown') : h('div.intel', {}, bar(est, est >= KNOCKOFF_AT ? 'var(--bad)' : est >= 40 ? 'var(--mid)' : 'var(--good)'), h('span.fine', {}, `~${est}%`)),
        );
      });
      body.append(h('div.rival', { style: `--c:${r.colour}` },
        h('div.rival-head', {}, h('span.swatch'), h('b', {}, r.name),
          h('span.fine', {}, `${'●'.repeat(Math.round(r.aggression * 5))}${'○'.repeat(5 - Math.round(r.aggression * 5))} aggression`)),
        h('div.fine', {}, `Shoppers caught: ${r.caught}${r.bannedUntil >= s.day ? ` · banned until day ${r.bannedUntil}` : ''}`),
        r.knockoffs.length ? h('div.ko', {}, `Knock-offs: ${r.knockoffs.map((k) => `“${k.name}” (day ${k.day})`).join(', ')}`) : null,
        h('div.fine.intel-title', {}, s.vigilance ? 'What staff think they know:' : 'Hire security to get intel on what they know.'),
        s.vigilance ? h('div', {}, ...rows) : null,
      ));
    }
  };
  onShop((r) => { if (r !== 'live') render(); });
  render();
}

// --- Ledger -----------------------------------------------------------------------------

export function mountLedger(root: HTMLElement): void {
  const canvas = h('canvas.ledger-chart', { role: 'img', 'aria-label': 'Cash and daily profit over time' });
  const table = h('div.ledger-table');
  root.append(h('h3', {}, 'Cash and daily profit'), canvas, h('div.legend', {}, h('span.lg-cash', {}, 'Cash'), h('span.lg-profit', {}, 'Profit per day')), table);

  const draw = () => {
    const hist = shopState.shop.history;
    const w = canvas.clientWidth || 360;
    const hgt = 180;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    canvas.style.height = `${hgt}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue('--muted').trim();
    const grid = css.getPropertyValue('--grid').trim();
    const accent = css.getPropertyValue('--accent-2').trim();
    const good = css.getPropertyValue('--good').trim();
    const bad = css.getPropertyValue('--bad').trim();
    if (hist.length < 1) {
      ctx.fillStyle = muted;
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('Open up to start the ledger.', 12, hgt / 2);
      return;
    }
    const pad = { l: 44, r: 8, t: 10, b: 20 };
    const vals = hist.flatMap((d) => [d.cash, d.profit, 0]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo || 1;
    const y = (v: number) => pad.t + (1 - (v - lo) / span) * (hgt - pad.t - pad.b);
    const x = (i: number) => pad.l + ((i + 0.5) / hist.length) * (w - pad.l - pad.r);
    ctx.strokeStyle = grid;
    ctx.fillStyle = muted;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (const v of [lo, (lo + hi) / 2, hi, 0].filter((v, i, a) => a.indexOf(v) === i)) {
      ctx.beginPath();
      ctx.moveTo(pad.l, y(v));
      ctx.lineTo(w - pad.r, y(v));
      ctx.stroke();
      ctx.fillText(Math.round(v).toString(), pad.l - 4, y(v) + 3);
    }
    const bw = Math.max(2, ((w - pad.l - pad.r) / hist.length) * 0.6);
    hist.forEach((d, i) => {
      ctx.fillStyle = d.profit >= 0 ? good : bad;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x(i) - bw / 2, Math.min(y(0), y(d.profit)), bw, Math.abs(y(d.profit) - y(0)));
    });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    hist.forEach((d, i) => (i ? ctx.lineTo(x(i), y(d.cash)) : ctx.moveTo(x(i), y(d.cash))));
    ctx.stroke();
    const last = hist[hist.length - 1];
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x(hist.length - 1), y(last.cash), 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = muted;
    ctx.fillText(`day ${hist[0].day}`, x(0), hgt - 5);
    if (hist.length > 1) ctx.fillText(`day ${last.day}`, x(hist.length - 1), hgt - 5);
  };

  const render = () => {
    draw();
    clear(table);
    const hist = [...shopState.shop.history].reverse().slice(0, 14);
    if (!hist.length) return;
    table.append(h('div.lt-row.lt-head', {}, h('span', {}, 'Day'), h('span', {}, 'Visitors'), h('span', {}, 'Takings'), h('span', {}, 'Profit'), h('span', {}, 'Cash'), h('span', {}, 'Rep')));
    for (const d of hist) {
      table.append(h('div.lt-row', {}, h('span', {}, d.day), h('span', {}, d.visitors), h('span', {}, d.revenue.toFixed(0)),
        h('span', { class: d.profit >= 0 ? 'good' : 'bad' }, d.profit.toFixed(0)), h('span', {}, d.cash.toFixed(0)), h('span', {}, Math.round(d.reputation))));
    }
  };
  onShop((r) => { if (r !== 'live') render(); });
  new ResizeObserver(() => draw()).observe(canvas);
  render();
}
