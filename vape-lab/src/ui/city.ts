import {
  buyStash, cityLoc, distance, moveStore, parkCar, relocationCost, restockDays, sellLocId, STASH_COST, STASH_MOVE_COST,
  storageLocId, tierOf, type CityLocation, type ShopState,
} from '../sim';
import { onShop, shopAction, shopState } from '../shopState';
import { data } from '../state';
import { bar, clear, h } from './dom';
import { openDriveBy } from './driveby';
import { toast } from './toast';

let selected = 'suburbs';
const listeners = new Set<() => void>();
function select(id: string): void {
  selected = id;
  for (const fn of listeners) fn();
}

const pct = (v: number) => `${v >= 1 ? '+' : '−'}${Math.round(Math.abs(v - 1) * 100)}%`;

function heatLabel(h: number): string {
  return h >= 70 ? 'Scorching: expect a bust' : h >= 45 ? 'Hot: police are watching' : h >= 20 ? 'Warm' : 'Cool';
}

// --- The map ---------------------------------------------------------------------------------

export function mountCityMap(stage: HTMLElement): void {
  const canvas = h('canvas.city-map', { role: 'img', 'aria-label': 'City map' });
  stage.append(canvas);
  let hover: string | null = null;
  const t0 = performance.now();

  const layout = () => {
    const w = stage.clientWidth || 1, hh = stage.clientHeight || 1;
    const pad = 28;
    const size = Math.min(w, hh) - pad * 2;
    // Stretch a little to fill wide or tall stages.
    const sx = Math.max(size, Math.min(w - pad * 2, size * 1.5));
    const sy = Math.max(size, Math.min(hh - pad * 2, size * 1.4));
    return { w, h: hh, ox: (w - sx) / 2, oy: (hh - sy) / 2, sx, sy };
  };
  const toPx = (L: ReturnType<typeof layout>, x: number, y: number) => [L.ox + (x / 100) * L.sx, L.oy + (y / 100) * L.sy] as const;

  const hit = (ev: MouseEvent): string | null => {
    const r = canvas.getBoundingClientRect();
    const L = layout();
    let best: string | null = null, bd = 30 * Math.max(0.6, Math.min(1, Math.min(L.sx, L.sy) / 560)) + 6;
    for (const loc of data.city ?? []) {
      const [px, py] = toPx(L, loc.x, loc.y);
      const d = Math.hypot(ev.clientX - r.left - px, ev.clientY - r.top - py);
      if (d < bd) { bd = d; best = loc.id; }
    }
    return best;
  };
  canvas.addEventListener('click', (ev) => {
    const id = hit(ev);
    if (!id) return;
    select(id);
    for (const fn of tapListeners) fn();
  });
  canvas.addEventListener('pointermove', (ev) => { hover = hit(ev); canvas.style.cursor = hover ? 'pointer' : ''; });

  const draw = () => {
    // Skip drawing while the City view is hidden or the drive-by covers it.
    if (!canvas.offsetParent || document.querySelector('.driveby')) {
      requestAnimationFrame(draw);
      return;
    }
    const L = layout();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(L.w * dpr) || canvas.height !== Math.round(L.h * dpr)) {
      canvas.width = Math.round(L.w * dpr);
      canvas.height = Math.round(L.h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = (performance.now() - t0) / 1000;
    const s = shopState.shop;
    // Pins and labels scale with the map so small screens stay readable.
    const k = Math.max(0.6, Math.min(1, Math.min(L.sx, L.sy) / 560));
    const P = (x: number, y: number) => toPx(L, x, y);

    // Ground, water and parks.
    ctx.fillStyle = '#171a28';
    ctx.fillRect(0, 0, L.w, L.h);
    ctx.fillStyle = '#1e2234';
    roundRect(ctx, L.ox - 10, L.oy - 10, L.sx + 20, L.sy + 20, 18);
    ctx.fill();
    ctx.fillStyle = '#16314a';
    ctx.beginPath();
    const [wx, wy] = P(72, 100);
    ctx.moveTo(wx, wy + 10);
    ctx.quadraticCurveTo(...P(80, 74), ...P(104, 70));
    ctx.lineTo(...P(104, 104));
    ctx.closePath();
    ctx.fill();
    for (const [x, y, w, hh] of [[26, 32, 10, 8], [62, 56, 9, 7], [8, 64, 8, 9]]) {
      const [px, py] = P(x, y);
      ctx.fillStyle = '#1d3326';
      roundRect(ctx, px, py, (w / 100) * L.sx, (hh / 100) * L.sy, 8);
      ctx.fill();
    }
    // Streets.
    ctx.strokeStyle = '#2b3048';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (let g = 8; g <= 92; g += 14) {
      ctx.beginPath(); ctx.moveTo(...P(g, 2)); ctx.lineTo(...P(g, 98)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...P(2, g)); ctx.lineTo(...P(98, g)); ctx.stroke();
    }
    ctx.strokeStyle = '#3a4060';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(...P(2, 44)); ctx.lineTo(...P(98, 44)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...P(50, 2)); ctx.lineTo(...P(50, 98)); ctx.stroke();
    ctx.setLineDash([8, 10]);
    ctx.strokeStyle = '#5a6080';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(...P(2, 44)); ctx.lineTo(...P(98, 44)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...P(50, 2)); ctx.lineTo(...P(50, 98)); ctx.stroke();
    ctx.setLineDash([]);

    // Heat glow around where you sell.
    const sell = cityLoc(data, sellLocId(s));
    if (sell && s.heat > 2) {
      const [hx, hy] = P(sell.x, sell.y);
      const r = 30 + s.heat * 1.4 + Math.sin(t * 2) * 4;
      const grd = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
      grd.addColorStop(0, `rgba(255,70,60,${0.15 + s.heat / 250})`);
      grd.addColorStop(1, 'rgba(255,70,60,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2); ctx.fill();
    }

    // Restock route: storage -> car -> shop.
    const route = [cityLoc(data, storageLocId(s)), cityLoc(data, s.car), s.tier === 0 ? undefined : sell].filter(Boolean) as CityLocation[];
    if (route.length > 1) {
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -t * 20;
      ctx.strokeStyle = '#ffd96a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      route.forEach((loc, i) => (i ? ctx.lineTo(...P(loc.x, loc.y)) : ctx.moveTo(...P(loc.x, loc.y))));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Locations.
    for (const loc of data.city ?? []) {
      const [px, py] = P(loc.x, loc.y);
      const isSel = loc.id === selected;
      const isHover = loc.id === hover;
      ctx.fillStyle = isSel ? '#3a2a4a' : '#262a3e';
      ctx.strokeStyle = isSel ? '#ff4fa3' : isHover ? '#a39fbb' : '#3a4060';
      ctx.lineWidth = isSel ? 3 : 1.5;
      ctx.beginPath(); ctx.arc(px, py, 20 * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = `${Math.round(20 * k)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(loc.icon, px, py + 1);
      ctx.font = `600 ${Math.max(9, Math.round(11 * k))}px system-ui, sans-serif`;
      ctx.fillStyle = isSel ? '#ffd1ea' : '#cfcbe0';
      // On small maps only the selected place gets its full name.
      ctx.fillText(k < 0.8 && !isSel ? loc.type.split(' ')[0] : loc.name, px, py + 32 * k);
      // Police presence dots.
      const dots = Math.round(loc.police * 4);
      for (let i = 0; i < dots; i++) {
        ctx.fillStyle = '#5a8cff';
        ctx.beginPath(); ctx.arc(px + (-9 + i * 6) * k, py - 27 * k, 2.2 * k, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Rival stores.
    for (const r of s.rivals) {
      const loc = cityLoc(data, r.loc);
      if (!loc) continue;
      const [px, py] = P(loc.x, loc.y);
      const closed = r.closedUntil >= s.day;
      ctx.save();
      ctx.translate(px + 22 * k, py - 14 * k);
      ctx.scale(k, k);
      ctx.fillStyle = closed ? '#3a2020' : r.colour;
      roundRect(ctx, -2, -10, 18, 16, 4);
      ctx.fill();
      ctx.font = '11px system-ui, "Apple Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(closed ? '🔥' : '🏪', 7, -2);
      ctx.restore();
    }

    // Your places.
    const marker = (id: string | undefined, icon: string, dx: number, dy: number, glow?: string) => {
      const loc = cityLoc(data, id);
      if (!loc) return;
      const [px, py] = P(loc.x, loc.y);
      if (glow) {
        ctx.shadowColor = glow;
        ctx.shadowBlur = 14;
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(px + dx * k, py + dy * k, 11 * k, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = `${Math.round(14 * k)}px system-ui, "Apple Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, px + dx * k, py + dy * k + 1);
    };
    marker(s.home, '🏠', -22, 14);
    marker(s.stash, '📦', -22, -14, '#ffd96a');
    marker(s.store, '🏪', 22, 14, '#ff4fa3');
    marker(s.car, '🚗', 0, 22 + Math.sin(t * 3) * 1.5, '#5ad7ff');

    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// --- Selected place ----------------------------------------------------------------------------

function heatBlock(s: ShopState): HTMLElement {
  return h('div.heat', { class: s.heat >= 45 ? 'hot' : '' },
    h('div.heat-head', {}, h('span', {}, '🔥 Heat'), h('b', {}, Math.round(s.heat)), h('span.fine', {}, heatLabel(s.heat))),
    bar(s.heat, s.heat >= 70 ? 'var(--bad)' : s.heat >= 45 ? 'var(--mid)' : 'var(--accent-2)'),
  );
}

export function mountCityPanel(root: HTMLElement): void {
  const body = h('div.city-panel');
  root.append(body);
  const render = () => {
    clear(body);
    const s = shopState.shop;
    const loc = cityLoc(data, selected);
    body.append(heatBlock(s));
    if (!loc) return;
    const tier = tierOf(s);
    const rivalsHere = s.rivals.filter((r) => r.loc === loc.id);
    const yours = [
      s.home === loc.id ? '🏠 Home & garage' : null,
      s.car === loc.id ? '🚗 Your car' : null,
      s.stash === loc.id ? '📦 Your stash' : null,
      s.store === loc.id ? '🏪 Your store' : null,
    ].filter(Boolean) as string[];

    body.append(h('div.place', {},
      h('div.place-head', {}, h('span.place-icon', {}, loc.icon), h('div', {}, h('h2', {}, loc.name), h('div.fine', {}, loc.type))),
      h('p.place-blurb', {}, loc.blurb),
      yours.length ? h('div.chips', {}, ...yours.map((y) => h('span.tag', {}, y))) : null,
      h('div.place-stats', {},
        h('div', {}, h('span.muted', {}, 'Customers'), h('b', {}, pct(loc.footfall))),
        h('div', {}, h('span.muted', {}, 'Police'), bar(loc.police * 100, loc.police > 0.6 ? 'var(--bad)' : loc.police > 0.4 ? 'var(--mid)' : 'var(--good)')),
        h('div', {}, h('span.muted', {}, 'Store rent'), h('b', {}, pct(loc.rent))),
        h('div', {}, h('span.muted', {}, 'Young faces'), h('b', {}, loc.young > 0.08 ? 'lots' : loc.young > 0.02 ? 'some' : 'few')),
      ),
      h('div.mix', {}, ...Object.entries(loc.mix).map(([id, m]) => {
        const c = data.customers.find((x) => x.id === id);
        return h('span.rating', { title: `${c?.name}: ${pct(m ?? 1)}`, style: `--sc:${(m ?? 1) >= 1 ? 'var(--good)' : 'var(--bad)'}` }, c?.avatar ?? '?', h('b', {}, (m ?? 1) >= 1 ? '▲' : '▼'));
      })),
    ));

    // Actions.
    const acts = h('div.place-actions');
    if (s.car !== loc.id) {
      const after = restockDays(parkCar(s, loc.id), data);
      acts.append(h('button', {
        disabled: shopState.playing,
        onclick: () => { shopAction((x) => parkCar(x, loc.id)); toast(`Car parked at ${loc.name}.`); },
      }, `🚗 Park car here`, h('span.fine', {}, tier.id === 'car' ? ` · sell here, restock ${after}d` : ` · restock ${after}d`)));
    }
    if (s.tier >= 2 && s.store !== loc.id) {
      const cost = relocationCost(s);
      acts.append(h('button', {
        class: 'primary', disabled: shopState.playing || s.cash < cost,
        onclick: () => { shopAction((x) => moveStore(x, loc.id, data), 'upgrade'); toast(`Your store has moved to ${loc.name}. The heat's dying down.`); },
      }, `🏪 Move store here`, h('span.fine', {}, ` · ${cost} cr, heat −60%`)));
    }
    if (s.stash !== loc.id) {
      const cost = s.stash ? STASH_MOVE_COST : STASH_COST;
      acts.append(h('button', {
        disabled: shopState.playing || s.cash < cost,
        onclick: () => { shopAction((x) => buyStash(x, loc.id)); toast(`Stash house set up at ${loc.name}.`); },
      }, `📦 ${s.stash ? 'Move stash here' : 'Buy a stash house here'}`, h('span.fine', {}, ` · ${cost} cr, +10 cr/day`)));
    }
    for (const r of rivalsHere) {
      const closed = r.closedUntil >= s.day;
      acts.append(h('button.danger-btn', {
        disabled: shopState.playing || closed || s.lastDriveByDay === s.day,
        onclick: () => openDriveBy(r.id),
      }, `🔥 Drive-by on ${r.name}`, h('span.fine', {}, closed ? ' · already shut' : s.lastDriveByDay === s.day ? ' · one per night' : ' · big heat')));
    }
    if (acts.childElementCount) body.append(h('h3', {}, 'Do something here'), acts);
    if (rivalsHere.length) body.append(...rivalsHere.map((r) => h('p.fine', {}, `${r.name} trades here. ${r.closedUntil >= s.day ? `Shut until day ${r.closedUntil + 1}.` : `Grudge against you: ${r.grudge >= 1.5 ? 'serious' : r.grudge >= 0.5 ? 'some' : 'none'}.`}`)));
  };
  listeners.add(render);
  onShop((r) => { if (r !== 'live') render(); });
  render();
}

// --- Overview ----------------------------------------------------------------------------------

export function mountCityOverview(root: HTMLElement): void {
  const body = h('div.city-overview');
  root.append(body);
  const render = () => {
    clear(body);
    const s = shopState.shop;
    const name = (id?: string) => cityLoc(data, id)?.name ?? '—';
    const days = restockDays(s, data);
    body.append(
      heatBlock(s),
      h('ul.heat-notes', {},
        h('li', {}, 'Raised by: selling from the car, serving kids, drive-bys, protests, refusing refunds.'),
        h('li', {}, 'Cools by 4 a day. Busts cut it, and moving your store cuts it by 60%.'),
        h('li', {}, 'Police dots on the map show how closely each area is watched.'),
      ),
      h('h3', {}, 'Your places'),
      h('div.sites', {},
        h('div', {}, h('span', {}, '🏠 Home & garage'), h('b', {}, name(s.home))),
        h('div', {}, h('span', {}, '📦 Stock kept at'), h('b', {}, s.stash ? `${name(s.stash)} (stash)` : `${name(s.home)} (garage)`)),
        h('div', {}, h('span', {}, '🚗 Car'), h('b', {}, name(s.car))),
        h('div', {}, h('span', {}, '🛒 Selling from'), h('b', {}, s.tier === 0 ? `${name(s.car)} (car boot)` : s.tier === 1 ? `${name(s.home)} (garage)` : `${name(s.store)} (store)`)),
        h('div', {}, h('span', {}, '⏱ Restocks arrive'), h('b', { class: days > 1 ? 'warn' : '' }, days === 1 ? 'next morning' : `in ${days} days`)),
      ),
      h('p.fine', {}, s.tier === 0
        ? 'Your car is your shop. Park it near your stock for fast restocks, and somewhere quiet if things get hot.'
        : 'Stock travels from your garage or stash, in your car, to where you sell. Keep the car between them.'),
      h('h3', {}, 'Rival stores'),
      ...s.rivals.map((r) => {
        const closed = r.closedUntil >= s.day;
        const dist = Math.round(distance(cityLoc(data, r.loc), cityLoc(data, sellLocId(s))));
        return h('div.rival', { style: `--c:${r.colour}` },
          h('div.rival-head', {}, h('span.swatch'), h('b', {}, r.name), h('span.fine', {}, closed ? '🔥 shut' : `${name(r.loc)} · ${dist < 25 ? 'nearby' : 'across town'}`)),
          h('div.fine', {}, `Grudge: ${r.grudge >= 1.5 ? 'serious' : r.grudge >= 0.5 ? 'some' : 'none'}${tierOf(s).rivals ? '' : ' · they haven\'t noticed you yet'}`),
          h('button.small.danger-btn', {
            disabled: shopState.playing || closed || s.lastDriveByDay === s.day,
            onclick: () => { select(r.loc); openDriveBy(r.id); },
          }, closed ? 'Shut' : s.lastDriveByDay === s.day ? 'One drive-by a night' : '🔥 Drive-by'),
        );
      }),
    );
  };
  onShop((r) => { if (r !== 'live') render(); });
  render();
}

export function selectPlace(id: string): void {
  select(id);
}

/** Called when the player taps a place on the map (phones jump to its details). */
export function onPlaceTapped(fn: () => void): void {
  tapListeners.add(fn);
}
const tapListeners = new Set<() => void>();
