import {
  BRANCH_COST, branchStatus, buyStash, cityLoc, closeBranch, districtsLed, forecastAt, INDIE, intelEstimate, isCrackdown,
  KNOCKOFF_AT, leader, moveStore, openBranch, parkCar, relocationCost, restockDays, sellLocId, STASH_COST, STASH_MOVE_COST,
  storageLocId, tierOf, turfOf, WIN_DISTRICTS, YOU, type CityLocation, type PlaceForecast, type ShopState,
} from '../sim';
import { onShop, shopAction, shopState } from '../shopState';
import { data } from '../state';
import { bar, clear, h } from './dom';
import { openDriveBy } from './driveby';
import { themeFor } from '../view/districtTheme';
import { toast } from './toast';

let selected = 'suburbs';
const listeners = new Set<() => void>();
function select(id: string): void {
  selected = id;
  for (const fn of listeners) fn();
}

const pct = (v: number) => `${v >= 1 ? '+' : '−'}${Math.round(Math.abs(v - 1) * 100)}%`;
const YOU_COLOUR = '#ff4fa3';
const INDIE_COLOUR = '#6b7090';

function ownerColour(s: ShopState, owner: string): string {
  if (owner === YOU) return YOU_COLOUR;
  if (owner === INDIE) return INDIE_COLOUR;
  return s.rivals.find((r) => r.id === owner)?.colour ?? '#888';
}

function ownerName(s: ShopState, owner: string): string {
  if (owner === YOU) return 'You';
  if (owner === INDIE) return 'Independents';
  return s.rivals.find((r) => r.id === owner)?.name ?? owner;
}

function heatLabel(h: number): string {
  return h >= 70 ? 'Scorching: expect a bust' : h >= 45 ? 'Hot: police are watching' : h >= 20 ? 'Warm' : 'Cool';
}

// --- The map ---------------------------------------------------------------------------------

export function mountCityMap(stage: HTMLElement): void {
  const canvas = h('canvas.city-map', { role: 'img', 'aria-label': 'City map' });
  stage.append(canvas);
  let hover: string | null = null;
  const t0 = performance.now();
  let base: HTMLCanvasElement | null = null;
  let baseKey = '';

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
    const turf = turfOf(s, data);
    // Pins and labels scale with the map so small screens stay readable.
    const k = Math.max(0.6, Math.min(1, Math.min(L.sx, L.sy) / 560));
    const P = (x: number, y: number) => toPx(L, x, y);

    // Ground, blocks, parks and water (cached), then a shimmer on the harbour.
    const key = `${L.w}x${L.h}@${dpr}`;
    if (key !== baseKey) {
      base = paintCityBase(L.w, L.h, dpr, L.ox, L.oy, L.sx, L.sy);
      baseKey = key;
    }
    ctx.drawImage(base!, 0, 0, L.w, L.h);
    ctx.save();
    waterPath(ctx, P);
    ctx.clip();
    ctx.strokeStyle = 'rgba(160,210,255,0.18)';
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 9; k++) {
      const [ax, ay] = P(70 + ((k * 37) % 30) + Math.sin(t * 0.6 + k) * 2, 78 + k * 2.6);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + 18 + (k % 3) * 8, ay); ctx.stroke();
    }
    ctx.restore();
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
    // Night traffic: headlights and tail lights moving along the streets.
    for (let k = 0; k < 16; k++) {
      const vertical = k % 2 === 0;
      const lane = [8, 22, 36, 50, 64, 78, 92, 44][k % 8];
      const dir = k % 4 < 2 ? 1 : -1;
      const pos = ((t * (5 + (k % 5) * 1.5) + k * 23) % 96) + 2;
      const along = dir > 0 ? pos : 100 - pos;
      const off = dir * 0.6;
      const [cx, cy] = vertical ? P(lane + off, along) : P(along, lane + off);
      if (vertical && lane === 44) continue;
      const [dx, dy] = vertical ? [0, dir] : [dir, 0];
      ctx.fillStyle = '#ff3344aa';
      ctx.fillRect(cx - dx * 3 - 1, cy - dy * 3 - 1, 2, 2);
      ctx.fillStyle = '#fff3c4';
      ctx.shadowColor = '#fff3c4';
      ctx.shadowBlur = 6;
      ctx.fillRect(cx + dx * 2 - 1, cy + dy * 2 - 1, 2.2, 2.2);
      ctx.shadowBlur = 0;
    }

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
      ctx.fillStyle = isSel ? '#3a2a4a' : mixHex(themeFor(loc.id).neonA, '#1e2032', 0.8);
      ctx.strokeStyle = isSel ? '#ff4fa3' : isHover ? '#a39fbb' : '#3a4060';
      ctx.lineWidth = isSel ? 3 : 1.5;
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
      ctx.beginPath(); ctx.arc(px, py, 20 * k, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.stroke();
      // Market-share ring: who owns this district.
      const shares = turf[loc.id] ?? {};
      let a0 = -Math.PI / 2;
      for (const [owner, v] of Object.entries(shares).sort((x, y) => y[1] - x[1])) {
        if (v < 0.5) continue;
        const a1 = a0 + (v / 100) * Math.PI * 2;
        ctx.strokeStyle = ownerColour(s, owner);
        ctx.lineWidth = 5 * k;
        ctx.beginPath(); ctx.arc(px, py, 25 * k, a0, a1); ctx.stroke();
        a0 = a1;
      }
      const lead = leader(shares);
      if (lead.owner === YOU && lead.share >= 30) {
        ctx.strokeStyle = 'rgba(255,79,163,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, (30 + Math.sin(t * 3) * 1.5) * k, 0, Math.PI * 2); ctx.stroke();
      }
      if (isCrackdown(s, loc.id)) {
        ctx.font = `${Math.round(14 * k)}px system-ui, "Apple Color Emoji", sans-serif`;
        ctx.fillText('🚨', px - 26 * k, py - 20 * k);
      }
      ctx.font = `${Math.round(20 * k)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(loc.icon, px, py + 1);
      ctx.font = `600 ${Math.max(9, Math.round(11 * k))}px system-ui, sans-serif`;
      ctx.fillStyle = isSel ? '#ffd1ea' : '#cfcbe0';
      // On small maps only the selected place gets its full name.
      const label = k < 0.8 && !isSel ? loc.type.split(' ')[0] : loc.name;
      ctx.lineWidth = 3.5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#100f18';
      ctx.strokeText(label, px, py + 38 * k);
      ctx.fillText(label, px, py + 38 * k);
      // Police presence dots.
      const dots = Math.round(loc.police * 4);
      for (let i = 0; i < dots; i++) {
        ctx.fillStyle = '#5a8cff';
        ctx.beginPath(); ctx.arc(px + (-9 + i * 6) * k, py - 27 * k, 2.2 * k, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Rival stores (every branch).
    const crowd: Record<string, number> = {};
    for (const r of s.rivals) for (const id of r.stores) {
      const loc = cityLoc(data, id);
      if (!loc) continue;
      const [px, py] = P(loc.x, loc.y);
      const n = crowd[id] = (crowd[id] ?? 0) + 1;
      const closed = r.closedUntil >= s.day;
      ctx.save();
      ctx.translate(px + (24 + (n - 1) * 15) * k, py - 22 * k);
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
    marker(s.store, '🏪', 24, 16, '#ff4fa3');
    for (const b of s.branches ?? []) marker(b, '🏬', 24, 16, '#ff4fa3');

    // How close you are to running the city.
    const led = districtsLed(s, data).length;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const banner = s.wonDay ? '👑 You run the city' : `Districts you lead: ${led} / ${WIN_DISTRICTS}`;
    ctx.fillStyle = 'rgba(16,15,24,0.82)';
    roundRect(ctx, L.ox - 2, L.oy - 2, ctx.measureText(banner).width + 18, 24, 8);
    ctx.fill();
    ctx.fillStyle = s.wonDay ? '#ffd96a' : '#e9e6f2';
    ctx.fillText(banner, L.ox + 7, L.oy + 4);
    marker(s.car, '🚗', 0, 22 + Math.sin(t * 3) * 1.5, '#5ad7ff');

    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

const PARKS: Array<[number, number, number, number]> = [[26, 32, 10, 8], [62, 56, 9, 7], [8, 64, 8, 9]];

function waterPath(ctx: CanvasRenderingContext2D, P: (x: number, y: number) => readonly [number, number]): void {
  ctx.beginPath();
  const [wx, wy] = P(72, 100);
  ctx.moveTo(wx, wy + 10);
  ctx.quadraticCurveTo(...P(80, 74), ...P(104, 70));
  ctx.lineTo(...P(104, 104));
  ctx.closePath();
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 7), 16), pb = parseInt(b.slice(1, 7), 16);
  const ch = [16, 8, 0].map((sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

/**
 * The static part of the map (ground, district glows, city blocks with little
 * buildings, parks, water), painted once per size into an offscreen canvas.
 */
function paintCityBase(w: number, hh: number, dpr: number, ox: number, oy: number, sx: number, sy: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(hh * dpr);
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const P = (x: number, y: number) => [ox + (x / 100) * sx, oy + (y / 100) * sy] as const;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  ctx.fillStyle = '#100f18';
  ctx.fillRect(0, 0, w, hh);
  ctx.fillStyle = '#1a1c2a';
  roundRect(ctx, ox - 10, oy - 10, sx + 20, sy + 20, 18);
  ctx.fill();
  ctx.save();
  roundRect(ctx, ox - 10, oy - 10, sx + 20, sy + 20, 18);
  ctx.clip();
  // Each district glows in its own colour.
  const locs = data.city ?? [];
  for (const loc of locs) {
    const [px, py] = P(loc.x, loc.y);
    const r = Math.min(sx, sy) * 0.2;
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `${themeFor(loc.id).neonA}2a`);
    g.addColorStop(1, `${themeFor(loc.id).neonA}00`);
    ctx.fillStyle = g;
    ctx.fillRect(px - r, py - r, r * 2, r * 2);
  }
  // Water.
  waterPath(ctx, P);
  const wg = ctx.createLinearGradient(...P(80, 74), ...P(100, 100));
  wg.addColorStop(0, '#173a5c');
  wg.addColorStop(1, '#0c2236');
  ctx.fillStyle = wg;
  ctx.fill();
  ctx.strokeStyle = '#d9c99a55';
  ctx.lineWidth = 3;
  waterPath(ctx, P);
  ctx.stroke();
  const inWater = (x: number, y: number) => { waterPath(ctx, P); const [px, py] = P(x, y); return ctx.isPointInPath(px * dpr, py * dpr); };
  const inPark = (x: number, y: number) => PARKS.some(([px, py, pw, ph]) => x > px - 2 && x < px + pw + 2 && y > py - 2 && y < py + ph + 2);
  const nearest = (x: number, y: number) => locs.reduce((best, l) => (Math.hypot(l.x - x, l.y - y) < Math.hypot(best.x - x, best.y - y) ? l : best), locs[0]);
  // City blocks between the streets, filled with little buildings.
  const lines = [2, 8, 22, 36, 50, 64, 78, 92, 98];
  for (let i = 0; i < lines.length - 1; i++) for (let j = 0; j < lines.length - 1; j++) {
    const x0 = lines[i] + 1.6, x1 = lines[i + 1] - 1.6, y0 = lines[j] + 1.6, y1 = lines[j + 1] - 1.6;
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (inWater(cx, cy) || inWater(x0, y1) || inWater(x1, y1)) continue;
    if (inPark(cx, cy)) continue;
    const [bx0, by0] = P(x0, y0), [bx1, by1] = P(x1, y1);
    ctx.fillStyle = '#23263a';
    roundRect(ctx, bx0, by0, bx1 - bx0, by1 - by0, 4);
    ctx.fill();
    const near = nearest(cx, cy);
    const tint = themeFor(near?.id).wall;
    const cols = (bx1 - bx0) > 50 ? 3 : 2, rows = (by1 - by0) > 50 ? 3 : 2;
    const cw = (bx1 - bx0 - 4) / cols, ch = (by1 - by0 - 4) / rows;
    for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
      if (rnd() < 0.12) continue;
      const fx = bx0 + 2 + a * cw + 1.5, fy = by0 + 2 + b * ch + 1.5, fw = cw - 3, fh = ch - 3;
      const tall = 2 + rnd() * Math.min(10, fh * 0.6);
      const roof = mixHex(tint, '#2a2d44', 0.45 + rnd() * 0.25);
      // South wall (with a few lit windows), then the roof lifted by its height.
      ctx.fillStyle = mixHex(tint, '#0c0b14', 0.6);
      ctx.fillRect(fx, fy + fh - tall, fw, tall);
      ctx.fillStyle = '#ffd27a';
      for (let wx = fx + 2; wx < fx + fw - 2; wx += 4) if (rnd() < 0.35 && tall > 4) { ctx.globalAlpha = 0.4 + rnd() * 0.5; ctx.fillRect(wx, fy + fh - tall + 1.5 + rnd() * (tall - 4), 1.6, 1.6); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = roof;
      ctx.fillRect(fx, fy - tall, fw, fh);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(fx, fy - tall, fw, 1.5);
    }
  }
  // Parks with trees.
  for (const [x, y, pw, ph] of PARKS) {
    const [px, py] = P(x, y);
    const w2 = (pw / 100) * sx, h2 = (ph / 100) * sy;
    ctx.fillStyle = '#1b3524';
    roundRect(ctx, px, py, w2, h2, 8);
    ctx.fill();
    ctx.strokeStyle = '#2a4a34';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    for (let k = 0; k < Math.round((w2 * h2) / 260); k++) {
      const tx = px + 6 + rnd() * (w2 - 12), ty = py + 6 + rnd() * (h2 - 12), r = 3 + rnd() * 3;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(tx + 1.5, ty + 1.5, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rnd() < 0.5 ? '#2f6b3a' : '#3a7a44';
      ctx.beginPath(); ctx.arc(tx, ty, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  return c;
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

function grudgeLabel(g: number): string {
  return g >= 1.5 ? 'serious' : g >= 0.5 ? 'some' : 'none';
}

const forecastCache = new Map<string, PlaceForecast>();
/** "If you sold here": five days of the real sim with your current range. */
function forecastBlock(s: ShopState, loc: CityLocation): HTMLElement | null {
  if (s.tier === 1 || !s.listings.length) return null;
  const key = `${loc.id}|${s.day}|${s.tier}|${Math.round(s.reputation)}|${Math.round(s.heat / 10)}|${s.listings.map((l) => `${l.product.id}@${l.price}`).join(',')}|${(s.upgrades ?? []).length}`;
  let f = forecastCache.get(key);
  if (!f) {
    f = forecastAt(s, data, loc.id);
    if (forecastCache.size > 60) forecastCache.clear();
    forecastCache.set(key, f);
  }
  const here = sellLocId(s) === loc.id;
  return h('div.place-forecast', {},
    h('div.fine', {}, here ? 'Here, with your current range (5-day trial run):' : s.tier === 0 ? 'If you parked and sold here (5-day trial run):' : 'If your store were here (5-day trial run):'),
    h('div.pf-row', {},
      h('div', {}, h('span.muted', {}, 'Profit'), h('b', { class: f.profitPerDay >= 0 ? 'good' : 'bad' }, `${Math.round(f.profitPerDay)} cr/day`)),
      h('div', {}, h('span.muted', {}, 'Customers'), h('b', {}, `${Math.round(f.visitorsPerDay)}/day`)),
      h('div', {}, h('span.muted', {}, 'Restock'), h('b', {}, f.restockDays === 1 ? 'next day' : `${f.restockDays} days`)),
      h('div', {}, h('span.muted', {}, 'Bust risk'), h('b', { class: f.bustRisk === 'high' ? 'bad' : f.bustRisk === 'medium' ? 'warn' : 'good' }, f.bustRisk)),
    ),
  );
}

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
    const rivalsHere = s.rivals.filter((r) => r.stores.includes(loc.id));
    const yours = [
      s.home === loc.id ? '🏠 Home & garage' : null,
      s.car === loc.id ? '🚗 Your car' : null,
      s.stash === loc.id ? '📦 Your stash' : null,
      s.store === loc.id ? '🏪 Your store' : null,
      (s.branches ?? []).includes(loc.id) ? '🏬 Your branch' : null,
      isCrackdown(s, loc.id) ? '🚨 Police crackdown' : null,
    ].filter(Boolean) as string[];
    const shares = Object.entries(turfOf(s, data)[loc.id] ?? {}).sort((a, b) => b[1] - a[1]);

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
      h('h3', {}, 'Who sells here'),
      h('div.share-bar', { role: 'img', 'aria-label': shares.map(([o, v]) => `${ownerName(s, o)} ${Math.round(v)}%`).join(', ') },
        ...shares.filter(([, v]) => v >= 1).map(([o, v]) => h('div', { style: `width:${v}%;background:${ownerColour(s, o)}`, title: `${ownerName(s, o)} ${Math.round(v)}%` }))),
      h('div.share-legend', {}, ...shares.filter(([, v]) => v >= 3).map(([o, v]) => h('span', {}, h('i', { style: `background:${ownerColour(s, o)}` }), `${ownerName(s, o)} ${Math.round(v)}%`))),
      forecastBlock(s, loc),
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
    if (s.tier >= 4 || (s.branches ?? []).length) {
      if ((s.branches ?? []).includes(loc.id)) {
        acts.append(h('button', {
          disabled: shopState.playing,
          onclick: () => { shopAction((x) => closeBranch(x, loc.id), 'upgrade'); toast(`Closed your ${loc.name} branch.`); },
        }, `🏬 Close this branch`));
      } else {
        const st = branchStatus(s, loc.id);
        acts.append(h('button', {
          class: st.ok ? 'primary' : '', disabled: shopState.playing || !st.ok,
          onclick: () => { shopAction((x) => openBranch(x, loc.id), 'upgrade'); toast(`Opened a branch in ${loc.name}.`); },
        }, `🏬 Open a branch here`, h('span.fine', {}, st.ok ? ` · ${BRANCH_COST} cr, ~55 cr/day rent` : ` · ${st.reason}`)));
      }
    }
    for (const r of rivalsHere) {
      const closed = r.closedUntil >= s.day;
      acts.append(h('button.danger-btn', {
        disabled: shopState.playing || closed || s.lastDriveByDay === s.day,
        onclick: () => openDriveBy(r.id),
      }, `🔥 Drive-by on ${r.name}`, h('span.fine', {}, closed ? ' · already shut' : s.lastDriveByDay === s.day ? ' · one per night' : ' · big heat')));
    }
    if (acts.childElementCount) body.append(h('h3', {}, 'Do something here'), acts);
    if (rivalsHere.length) body.append(...rivalsHere.map((r) => h('p.fine', {}, `${r.name} has a ${r.loc === loc.id ? 'flagship store' : 'branch'} here. ${r.closedUntil >= s.day ? `Shut until day ${r.closedUntil + 1}.` : `Grudge against you: ${grudgeLabel(r.grudge)}.`}`)));
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
    const led = districtsLed(s, data);
    body.append(
      h('div.win', { class: s.wonDay ? 'won' : '' },
        h('div.win-head', {}, h('b', {}, s.wonDay ? `👑 You ran the city on day ${s.wonDay}` : 'Run the city'), h('span', {}, `${led.length} / ${WIN_DISTRICTS} districts`)),
        bar((led.length / WIN_DISTRICTS) * 100, 'var(--accent)'),
        h('p.fine', {}, led.length ? `You lead: ${led.map((l) => name(l)).join(', ')}.` : 'Lead a district by having the biggest share there (at least 30%).'),
        h('p.fine', {}, `Lead ${WIN_DISTRICTS} of ${(data.city ?? []).length} districts to win. Your share grows where you trade, with good reputation, a range that suits the locals, and fair prices. Leading draws the police, though.`),
      ),
      heatBlock(s),
      h('ul.heat-notes', {},
        h('li', {}, 'Raised by: selling from the car, serving kids, drive-bys, protests, refusing refunds, and leading districts (big leads bring 🚨 crackdowns).'),
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
      h('h3', {}, 'Your chain'),
      (s.branches ?? []).length
        ? h('div.sites', {}, ...(s.branches ?? []).map((b) => h('div', {}, h('span', {}, `🏬 ${name(b)}`), h('b', {}, `${Math.round(turfOf(s, data)[b]?.[YOU] ?? 0)}% share`))))
        : h('p.fine', {}, s.tier >= 4 ? `Open up to 4 branches (${BRANCH_COST} cr each) from a place's panel. Each one fights for its district and sells from its own deliveries.` : 'From the Large store you can open branches across the city.'),
    );
  };
  onShop((r) => { if (r !== 'live') render(); });
  render();
}

// --- Rivals (one place for everything about them) -----------------------------------------------

export function mountCityRivals(root: HTMLElement): void {
  const body = h('div');
  root.append(body);
  const render = () => {
    clear(body);
    const s = shopState.shop;
    const turf = turfOf(s, data);
    const name = (id?: string) => cityLoc(data, id)?.name ?? '—';
    body.append(h('p.hint', {}, tierOf(s).rivals
      ? `Three chains want the city. They open branches where they're winning, close the ones that struggle, start price wars, and hit back when you take their customers. Their secret shoppers learn your recipes; at ${KNOCKOFF_AT}% they sell a knock-off.`
      : 'The rival chains haven\'t noticed you yet. Once you open a store, expect competition, secret shoppers and worse.'));
    for (const r of s.rivals) {
      const closed = r.closedUntil >= s.day;
      const leads = Object.keys(turf).filter((l) => leader(turf[l]).owner === r.id && leader(turf[l]).share >= 30);
      const war = (r.priceWarUntil ?? 0) >= s.day;
      const intel = s.listings.map((l) => {
        const est = intelEstimate(s, r, l.product.id);
        return h('div.intel-row', {},
          h('span', {}, l.product.brand.name || 'Untitled'),
          est === null ? h('span.muted.fine', {}, 'unknown') : h('div.intel', {}, bar(est, est >= KNOCKOFF_AT ? 'var(--bad)' : est >= 40 ? 'var(--mid)' : 'var(--good)'), h('span.fine', {}, `~${est}%`)),
        );
      });
      body.append(h('div.rival', { style: `--c:${r.colour}` },
        h('div.rival-head', {}, h('span.swatch'), h('b', {}, r.name),
          h('span.fine', {}, closed ? `🔥 shut until day ${r.closedUntil + 1}` : `${'●'.repeat(Math.round(r.aggression * 5))}${'○'.repeat(5 - Math.round(r.aggression * 5))} aggression`)),
        h('div.fine', {}, `Stores: ${r.stores.map((l) => `${name(l)}${l === r.loc ? ' (HQ)' : ''}`).join(', ')}`),
        h('div.fine', {}, `Leads ${leads.length} district${leads.length === 1 ? '' : 's'} · grudge: ${grudgeLabel(r.grudge)} · shoppers caught: ${r.caught}${r.bannedUntil >= s.day ? ` (banned until day ${r.bannedUntil})` : ''}`),
        war ? h('div.ko', {}, `Price war until day ${r.priceWarUntil}: keep your average price under 12 cr or lose customers where you meet them.`) : null,
        r.knockoffs.length ? h('div.ko', {}, `Knock-offs: ${r.knockoffs.map((k) => `“${k.name}” (day ${k.day})`).join(', ')}`) : null,
        h('div.fine.intel-title', {}, s.vigilance ? 'What your staff think they know about your recipes:' : 'Hire security in the Shop to get intel on what they know.'),
        s.vigilance ? h('div', {}, ...intel) : null,
        h('button.small.danger-btn', {
          disabled: shopState.playing || closed || s.lastDriveByDay === s.day,
          onclick: () => { select(r.loc); openDriveBy(r.id); },
        }, closed ? 'Shut' : s.lastDriveByDay === s.day ? 'One drive-by a night' : '🔥 Drive-by on their HQ'),
      ));
    }
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
