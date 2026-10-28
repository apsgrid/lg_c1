import {
  addListing, intelEstimate, KNOCKOFF_AT, maxOrder, MAX_STOCK, orderStock, removeListing, reviseListing,
  setAutoRestock, setPrice, setVigilance, SHELF_SLOTS, unitCost, VIGILANCE,
  type DayEventKind, type Product, type ShopState,
} from '../sim';
import { notifyShop, onShop, resetShop, runDay, shopAction, shopState } from '../shopState';
import { data, state } from '../state';
import { storage } from '../store/storage';
import type { ShopScene } from '../view/shopScene';
import { bar, clear, h, scoreColour } from './dom';
import { toast } from './toast';

const archetype = (id: string) => data.customers.find((c) => c.id === id);
const cr = (v: number) => `${v < 0 ? '−' : ''}${Math.round(Math.abs(v))} cr`;

function productName(shop: ShopState, pid?: string): string {
  return shop.listings.find((l) => l.product.id === pid)?.product.brand.name
    ?? storage.loadFormulas().find((f) => f.product.id === pid)?.product.brand.name
    ?? 'a discontinued product';
}

function knockoffsOf(shop: ShopState, pid: string) {
  return shop.rivals.flatMap((r) => r.knockoffs.filter((k) => k.productId === pid).map((k) => ({ rival: r, k })));
}

let sceneRef: ShopScene | null = null;

/** Open the shop for one day: simulate, then play it out in 3D. */
export async function openShop(): Promise<void> {
  if (shopState.playing) {
    sceneRef?.skip();
    return;
  }
  const before = shopState.shop;
  if (!before.listings.length) {
    toast('Put at least one product on the shelf first.');
    return;
  }
  if (!before.listings.some((l) => l.stock + l.incoming > 0)) {
    toast('Your shelves are empty. Order some stock first.');
    return;
  }
  // Show this morning's shelves (deliveries in) while the day plays.
  const morning: ShopState = { ...before, listings: before.listings.map((l) => ({ ...l, stock: l.stock + l.incoming, incoming: 0 })) };
  sceneRef?.setShop(morning);
  const { report, reveal } = runDay();
  shopState.playing = true;
  notifyShop('playing');
  await sceneRef?.playDay(report, morning);
  reveal();
  shopState.playing = false;
  sceneRef?.setShop(shopState.shop);
  notifyShop('day');
}

// --- Left panel: shop status + shelf ------------------------------------------------

export function mountShelf(root: HTMLElement, scene: ShopScene): void {
  sceneRef = scene;
  const nameInput = h('input#shop-name', {
    type: 'text', maxLength: 28, value: shopState.shop.name, placeholder: 'Name your shop', 'aria-label': 'Shop name',
    onchange: (e: Event) => shopAction((s) => ({ ...s, name: (e.target as HTMLInputElement).value.trim() || 'My Vape Store' })),
  });
  const status = h('div.shop-status');
  const vigil = h('div.chips', { role: 'radiogroup', 'aria-label': 'Security' });
  const list = h('div.listings');
  const addSel = h('select#add-product', { 'aria-label': 'Product to stock' });
  const addBtn = h('button', { onclick: add }, 'Put on shelf');
  const openBtn = h('button.primary.big.open-btn', { onclick: () => void openShop() });

  root.append(
    h('label', { for: 'shop-name' }, h('h3', {}, 'Shop name')),
    nameInput,
    status,
    h('h3', {}, 'Security ', h('span.muted', {}, '(catches secret shoppers)')),
    vigil,
    h('h3', {}, 'Shelf ', h('span.muted.shelf-count')),
    list,
    h('div.add-row', {}, addSel, addBtn),
    h('p.fine', {}, 'Stock comes from your Library. Save products in the Lab first. Orders are paid now and arrive tomorrow morning.'),
    openBtn,
    h('details.danger', {},
      h('summary', {}, 'Start over'),
      h('p.fine', {}, 'Closes this shop and opens a fresh one on day 1 with starting cash. Your lab formulas are kept.'),
      h('button.ghost', {
        onclick: (e: Event) => {
          const b = e.currentTarget as HTMLButtonElement;
          if (b.dataset.armed) { resetShop(); scene.setShop(shopState.shop); toast('New shop opened'); return; }
          b.dataset.armed = '1';
          b.textContent = 'Tap again to start over';
          setTimeout(() => { delete b.dataset.armed; b.textContent = 'Start a new shop'; }, 4000);
        },
      }, 'Start a new shop'),
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
    toast(`${p.brand.name || 'Untitled'} is on the shelf. Order some stock.`);
  }

  function render(): void {
    const s = shopState.shop;
    if (document.activeElement !== nameInput) nameInput.value = s.name;
    openBtn.textContent = shopState.playing ? 'Skip to closing time' : `Open shop: day ${s.day}`;

    clear(status);
    status.append(
      h('div', {}, h('span.muted', {}, 'Day'), h('b', {}, String(s.day))),
      h('div', {}, h('span.muted', {}, 'Cash'), h('b', { class: s.cash < 0 ? 'bad' : '' }, cr(s.cash))),
      h('div.rep', {}, h('span.muted', {}, 'Reputation'), h('b', {}, Math.round(s.reputation)), bar(s.reputation)),
    );

    clear(vigil);
    VIGILANCE.forEach((v, i) => vigil.append(h('button.chip', {
      class: s.vigilance === i ? 'on' : '', role: 'radio', 'aria-checked': String(s.vigilance === i),
      onclick: () => shopAction((x) => setVigilance(x, i as 0 | 1 | 2)),
    }, `${v.label}${v.wage ? ` · ${v.wage} cr/day` : ''}`)));

    (root.querySelector('.shelf-count') as HTMLElement).textContent = `(${s.listings.length}/${SHELF_SLOTS})`;
    clear(list);
    if (!s.listings.length) list.append(h('div.empty-state', {}, 'Nothing on the shelf yet. Pick a product below.'));
    s.listings.forEach((l, i) => {
      const p = l.product;
      const cost = unitCost(p, data).total;
      const margin = l.price - cost;
      const kos = knockoffsOf(s, p.id);
      const labIsRevision = state.product.id !== p.id && state.product.brand.name === p.brand.name && state.product.notes.length > 0;
      const priceVal = h('b', {}, `${l.price.toFixed(1)} cr`);
      const restockVal = h('b', {}, l.autoRestockTo ? `to ${l.autoRestockTo}` : 'off');
      list.append(h('div.listing', { style: `--c:${p.brand.labelColour}` },
        h('div.listing-head', {},
          h('span.swatch'),
          h('b', {}, p.brand.name || 'Untitled'),
          h('span.stock', { class: l.stock === 0 ? 'bad' : l.stock < 5 ? 'warn' : '' }, `${l.stock} in stock`, l.incoming ? h('span.muted', {}, ` +${l.incoming} tomorrow`) : null),
          h('button.icon', { title: 'Take off the shelf', 'aria-label': `Remove ${p.brand.name}`, onclick: () => shopAction((x) => removeListing(x, i)) }, '×'),
        ),
        kos.length ? h('div.ko', {}, `Knocked off by ${kos.map((k) => `${k.rival.name} (“${k.k.name}”)`).join(', ')}`) : null,
        h('label.inline', {}, h('span', {}, 'Price ', priceVal, h('span.muted', {}, ` · cost ${cost.toFixed(2)} · margin `), h('span', { class: margin > 0 ? 'good' : 'bad' }, margin.toFixed(2))),
          h('input', {
            type: 'range', min: 3, max: 60, step: 0.5, value: String(l.price), 'aria-label': `${p.brand.name} price`,
            oninput: (e: Event) => { priceVal.textContent = `${Number((e.target as HTMLInputElement).value).toFixed(1)} cr`; },
            onchange: (e: Event) => shopAction((x) => setPrice(x, i, Number((e.target as HTMLInputElement).value))),
          })),
        h('div.order-row', {},
          h('span.muted', {}, 'Order'),
          ...[10, 25].map((q) => h('button.small', {
            disabled: maxOrder(s, i, data) < 1,
            onclick: () => { const n = Math.min(q, maxOrder(shopState.shop, i, data)); shopAction((x) => orderStock(x, i, q, data)); toast(`Ordered ${n} × ${p.brand.name} (${(n * cost).toFixed(2)} cr)`); },
          }, `+${q}`)),
          h('button.small', {
            disabled: maxOrder(s, i, data) < 1,
            onclick: () => { const n = maxOrder(shopState.shop, i, data); shopAction((x) => orderStock(x, i, n, data)); toast(`Ordered ${n} × ${p.brand.name}`); },
          }, 'Max'),
        ),
        h('label.inline', {}, h('span', {}, 'Auto-restock ', restockVal),
          h('input', {
            type: 'range', min: 0, max: MAX_STOCK, step: 5, value: String(l.autoRestockTo), 'aria-label': `${p.brand.name} auto-restock level`,
            oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); restockVal.textContent = v ? `to ${v}` : 'off'; },
            onchange: (e: Event) => shopAction((x) => setAutoRestock(x, i, Number((e.target as HTMLInputElement).value))),
          })),
        labIsRevision ? h('button.small.ghost', {
          onclick: () => { shopAction((x) => reviseListing(x, i, state.product)); toast(`${p.brand.name} now uses your latest lab formula.`); },
        }, 'Use revised formula from the Lab') : null,
      ));
    });

    clear(addSel);
    const c = candidates();
    if (!c.length) addSel.append(h('option', { value: '' }, 'No new products. Save some in the Lab.'));
    for (const p of c) addSel.append(h('option', { value: p.id }, `${p.brand.name || 'Untitled'}${p.id === state.product.id ? ' (in the Lab now)' : ''}`));
    addBtn.disabled = !c.length || s.listings.length >= SHELF_SLOTS;
    openBtn.classList.toggle('pulse', !shopState.playing && s.listings.some((l) => l.stock + l.incoming > 0));
  }
  onShop(render);
  render();
}

// --- Today: the day report ------------------------------------------------------------

const EVENT_ICON: Record<DayEventKind, string> = {
  delivery: '📦', stockout: '⚠', regular_join: '★', regular_leave: '☆', caught: '🛑', knockoff: '🕵', suspicious: '👀', restock: '↻', broke: '💸',
};

export function mountToday(root: HTMLElement): void {
  const body = h('div.today');
  root.append(body);
  const render = () => {
    clear(body);
    const r = shopState.lastReport;
    const s = shopState.shop;
    if (shopState.playing) {
      body.append(h('div.empty-state', {}, `Day ${s.day} is under way. Watch the shop floor…`));
      return;
    }
    if (!r) {
      body.append(h('div.empty-state', {},
        h('b', {}, `Day ${s.day} at ${s.name}`), h('br'),
        'Stock your shelf on the left, then press Open shop. Customers walk in, regulars come back, and rival stores send secret shoppers.'));
      return;
    }
    const repD = r.reputationEnd - r.reputationStart;
    body.append(
      h('h3', {}, `Day ${r.day} report`),
      h('div.stats', {},
        h('div.stat', {}, h('span.muted', {}, 'Visitors'), h('b', {}, r.visitors), h('span.fine', {}, `${r.buyers} bought`)),
        h('div.stat', {}, h('span.muted', {}, 'Takings'), h('b', {}, cr(r.revenue))),
        h('div.stat', {}, h('span.muted', {}, 'Profit'), h('b', { class: r.profit >= 0 ? 'good' : 'bad' }, cr(r.profit)), h('span.fine', {}, `rent ${r.rent} · staff ${r.wages} · stock ${r.restockSpend.toFixed(0)}`)),
        h('div.stat', {}, h('span.muted', {}, 'Reputation'), h('b', {}, Math.round(r.reputationEnd)), h('span.fine', { class: repD >= 0 ? 'good' : 'bad' }, `${repD >= 0 ? '▲' : '▼'} ${Math.abs(repD).toFixed(1)}`)),
      ),
    );
    if (r.events.length) {
      body.append(h('h4', {}, 'What happened'), h('ul.events', {}, ...r.events.map((e) => h('li', { class: `ev-${e.kind}` }, h('span.ev-icon', { 'aria-hidden': 'true' }, EVENT_ICON[e.kind]), e.text))));
    }
    const sold = Object.entries(r.sales).sort((a, b) => b[1] - a[1]);
    if (sold.length) {
      body.append(h('h4', {}, 'Sales'), h('div.sales', {}, ...sold.map(([pid, n]) => h('div', {}, h('span', {}, productName(s, pid)), h('b', {}, `${n}`)))));
    }
    body.append(h('h4', {}, 'Visitor log'), h('div.visits', {}, ...r.visits.map((v) => {
      const c = archetype(v.archetype);
      const rival = v.caught ? s.rivals.find((x) => x.id === v.rivalId) : undefined;
      const outcome = v.caught ? `secret shopper from ${rival?.name}`
        : v.walkout === 'banned' ? 'turned away at the door'
          : v.walkout === 'stockout' ? 'left: favourite sold out'
            : v.walkout === 'nothing' ? 'browsed, bought nothing'
              : `bought ${v.qty} × ${productName(s, v.productId)}`;
      return h('div.visit', { class: v.caught || v.walkout === 'banned' ? 'caught' : v.qty ? 'bought' : 'left' },
        h('span.avatar', {}, c?.avatar ?? '?'),
        h('div', {},
          h('b', {}, v.regularId ? v.name : c?.name ?? v.name), v.regularId ? h('span.reg-badge', {}, 'regular') : null,
          h('div.fine', {}, outcome),
          v.tell && !v.caught ? h('div.tell', {}, `Seen: ${v.tell}`) : null,
        ),
        v.spent ? h('b.spent', {}, `+${v.spent.toFixed(0)}`) : null,
      );
    })));
  };
  onShop(render);
  render();
}

// --- Regulars ---------------------------------------------------------------------------

export function mountRegulars(root: HTMLElement): void {
  const body = h('div');
  root.append(h('p.hint', {}, 'Regulars come back on their own. Keep their favourite in stock and they get more loyal; let it sell out and they drift away.'), body);
  const render = () => {
    clear(body);
    const s = shopState.shop;
    const active = s.regulars.filter((r) => !r.gone).sort((a, b) => b.loyalty - a.loyalty);
    const gone = s.regulars.filter((r) => r.gone);
    if (!active.length) body.append(h('div.empty-state', {}, 'No regulars yet. Customers who love a product may start coming back.'));
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
  onShop(render);
  render();
}

// --- Rivals -----------------------------------------------------------------------------

export function mountRivals(root: HTMLElement): void {
  const body = h('div');
  root.append(h('p.hint', {}, `Rival stores send secret shoppers who look like everyone else. Each visit teaches them more about one of your formulas. At ${KNOCKOFF_AT}% they sell a knock-off. Watch the visitor log for odd behaviour, hire security, and revise copied formulas in the Lab.`), body);
  const render = () => {
    clear(body);
    const s = shopState.shop;
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
  onShop(render);
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
      ctx.fillText('Open the shop to start the ledger.', 12, hgt / 2);
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
  onShop(render);
  new ResizeObserver(() => draw()).observe(canvas);
  render();
}
