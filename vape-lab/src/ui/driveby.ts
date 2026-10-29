import { cityLoc, driveBy, nightOrders, nightRound, sellLocId, type NightOrder, type Rival } from '../sim';
import { shopAction, shopState } from '../shopState';
import { data } from '../state';
import { themeFor } from '../view/districtTheme';
import { AWNINGS, buildStreet, buildTraffic, CAR_L, CAR_W, FACADE, KERB, LANE, mix, type Lot, type Mode, type Thing } from '../street/layout';
import { h } from './dom';
import { toast } from './toast';

/*
 * The street run, Paperboy style: you drive up a diagonal street at night and
 * lob things sideways at the buildings on the left, while dodging bins, cones,
 * oncoming traffic and a dog that wants your cargo. Two modes share it:
 *
 * - Night Round: deliver parcels to the doorsteps of regulars who ordered
 *   (porch light on, name by the door). Don't break anyone else's windows.
 * - Firebomb Run: light the rival's shopfronts. Each one shuts them a day.
 *   Cartoon only: the shops are empty and the flames are mostly comic.
 *
 * Every street takes its look from its district, and busier-policed districts
 * have more police cars and faster traffic.
 */

const W = 480, H = 600;
// Oblique projection: the street runs up and to the right.
const OX = 205, OY = 505;
const KX = 0.95, KY = 0.42, DX = 0.5, DY = 0.74;
const MAX_DENTS = 3;
const THROW_VX = -280, THROW_VZ = 170, GRAVITY = 600, THROW_Z = 26;
/** Below this height a throw counts as reaching the shopfront or doorstep. */
const TARGET_Z = 62;
/** The landing marker only shows for your first few runs of each kind. */
const AIM_HELP_RUNS = 2;

type V3 = [number, number, number];
interface Throwable { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number }
interface Splat { x: number; y: number; z: number; life: number }
interface Pop { text: string; x: number; y: number; z: number; life: number; colour: string }

export interface RunStats { hits: number; targets: number; wrong: number; dents: number; delivered: string[]; aborted: boolean }

interface RunConfig {
  mode: Mode;
  title: string;
  locId: string;
  rival?: Rival;
  orders?: NightOrder[];
  intro: string[];
  /** Apply the result to the game and return the result card's contents. */
  settle: (stats: RunStats) => HTMLElement[];
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(f >= 1 ? c + (255 - c) * (f - 1) : c * f));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}
// --- Tiny sound effects (WebAudio, no files) ---------------------------------------------
let actx: AudioContext | null = null;
function sfx(kind: 'throw' | 'boom' | 'crash' | 'pick' | 'woof' | 'splat' | 'ding'): void {
  try {
    actx ??= new AudioContext();
    const a = actx;
    const now = a.currentTime;
    const gain = a.createGain();
    gain.connect(a.destination);
    if (kind === 'boom' || kind === 'splat' || kind === 'crash') {
      const len = kind === 'boom' ? 0.6 : 0.25;
      const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
      const src = a.createBufferSource();
      src.buffer = buf;
      const f = a.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = kind === 'boom' ? 700 : kind === 'crash' ? 1800 : 2600;
      src.connect(f).connect(gain);
      gain.gain.value = kind === 'boom' ? 0.5 : 0.25;
      src.start(now);
      return;
    }
    const o = a.createOscillator();
    o.connect(gain);
    o.type = kind === 'woof' ? 'square' : 'sine';
    const [f0, f1, dur] = kind === 'throw' ? [300, 900, 0.18] : kind === 'pick' ? [660, 1320, 0.15] : kind === 'ding' ? [880, 1760, 0.3] : [320, 180, 0.12];
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(f1, now + dur);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.start(now);
    o.stop(now + dur);
  } catch { /* no audio: play on in silence */ }
}

function runCount(mode: Mode): number {
  try { return Number(localStorage.getItem(`vapelab.v1.runs.${mode}`) ?? 0) || 0; } catch { return 0; }
}
function bumpRunCount(mode: Mode): void {
  try { localStorage.setItem(`vapelab.v1.runs.${mode}`, String(runCount(mode) + 1)); } catch { /* ignore */ }
}

// --- Entry points --------------------------------------------------------------------------

export function openDriveBy(rivalId: string): void {
  const rival = shopState.shop.rivals.find((r) => r.id === rivalId);
  if (!rival) return;
  runStreet({
    mode: 'firebomb',
    title: `Firebomb run: ${rival.name}`,
    locId: rival.loc,
    rival,
    intro: [
      `Lob bottles at ${rival.name} shopfronts`,
      '(their coloured signs). Each one shuts them a day.',
      'Leave the neighbours alone: wrong windows = heat.',
      'Dodge bins, cones and traffic. Grab crates for',
      'more bottles. The dog wants your bottles.',
    ],
    settle: (st) => {
      const hits = Math.min(3, st.hits);
      const res = driveBy(shopState.shop, rival.id, hits, data, st.wrong, st.hits >= st.targets);
      shopAction(() => res.shop, 'driveby');
      toast(res.caught ? 'Busted after the drive-by!' : hits ? `${rival.name} is shut for ${hits} day${hits === 1 ? '' : 's'}.` : 'Missed everything.', res.caught ? 'info' : 'gold');
      return [
        h('div.big-emoji', {}, res.caught ? '🚓' : st.hits ? '🔥' : '💨'),
        h('h2', {}, st.hits >= st.targets ? 'Clean sweep!' : st.hits ? `${st.hits} shopfront${st.hits === 1 ? '' : 's'} lit!` : 'Missed the lot!'),
        h('div.driveby-tally', {},
          h('span', {}, h('b', {}, String(st.hits)), ' rival fronts'),
          h('span', {}, h('b', {}, String(st.wrong)), ' wrong buildings'),
          h('span', {}, h('b', {}, String(st.dents)), ' dents'),
        ),
        h('p', {}, res.text),
        h('p.fine', {}, `Heat is now ${Math.round(res.shop.heat)}. ${rival.name} won't forget this.`),
      ];
    },
  });
}

export function openNightRound(): void {
  const s = shopState.shop;
  const orders = nightOrders(s, data);
  if (!orders.length) return;
  const locId = sellLocId(s);
  const where = cityLoc(data, locId)?.name ?? 'your patch';
  runStreet({
    mode: 'delivery',
    title: `Night round: ${where}`,
    locId,
    orders,
    intro: [
      `${orders.length} regular${orders.length === 1 ? ' has' : 's have'} ordered. Their porch lights`,
      'are on, with their name by the door. Lob a',
      'parcel onto each doorstep as you drive past.',
      "Don't break anyone else's windows. Dodge the",
      'traffic, and the dog: it nicks parcels.',
    ],
    settle: (st) => {
      const res = nightRound(shopState.shop, data, st.delivered, st.wrong);
      shopAction(() => res.shop, 'round');
      toast(res.delivered ? `Night round: ${res.delivered} delivered, ${Math.round(res.takings + res.tip)} cr.` : 'Nothing delivered tonight.', res.delivered ? 'gold' : 'info');
      const perfect = res.delivered === orders.length;
      return [
        h('div.big-emoji', {}, perfect ? '🌟' : res.delivered ? '📦' : '💨'),
        h('h2', {}, perfect ? 'Perfect round!' : `${res.delivered} of ${orders.length} delivered`),
        h('div.driveby-tally', {},
          h('span', {}, h('b', {}, `${Math.round(res.takings + res.tip)} cr`), ' taken'),
          h('span', {}, h('b', {}, String(st.wrong)), ' broken windows'),
          h('span', {}, h('b', {}, String(st.dents)), ' dents'),
        ),
        h('ul.round-list', {}, ...orders.map((o) => h('li', { class: st.delivered.includes(o.regularId) ? 'good' : 'bad' },
          `${st.delivered.includes(o.regularId) ? '✓' : '✗'} ${o.name}, no. ${o.door}: ${o.productName}`))),
        h('p', {}, res.text),
      ];
    },
  });
}

// --- The run itself ----------------------------------------------------------------------

function runStreet(cfg: RunConfig): void {
  const delivery = cfg.mode === 'delivery';
  const loc = cityLoc(data, cfg.locId);
  const theme = themeFor(cfg.locId);
  const style = theme.skyline;
  const police = loc?.police ?? 0.5;
  const accent = delivery ? '#ffd27a' : cfg.rival!.colour;

  const canvas = h('canvas.driveby-canvas', { width: W * 2, height: H * 2 });
  const throwBtn = h('button.primary.big.throw-btn', {}, delivery ? '📦 Throw' : '🔥 Throw');
  const leftBtn = h('button.steer', { 'aria-label': 'Steer left' }, '◀');
  const rightBtn = h('button.steer', { 'aria-label': 'Steer right' }, '▶');
  const close = h('button.ghost', { onclick: () => finish(true) }, 'Abort');
  const overlay = h('div.driveby', { role: 'dialog', 'aria-label': cfg.title },
    h('div.driveby-card', {},
      h('div.driveby-title', {}, h('b', {}, cfg.title), close),
      canvas,
      h('div.driveby-controls', {}, leftBtn, throwBtn, rightBtn),
      h('div.driveby-status', {}, 'Keys: ← → steer · ↑ ↓ speed · Space throws'),
    ),
  );
  document.body.append(overlay);
  const ctx = canvas.getContext('2d')!;
  const SC = canvas.width / W;

  const { lots, end: END } = buildStreet({ mode: cfg.mode, rivalName: cfg.rival?.name, rivalColour: cfg.rival?.colour, orders: cfg.orders }, style, theme);
  const targets = delivery ? (cfg.orders?.length ?? 0) : 4;
  const things = buildTraffic(END, police);
  const flying: Throwable[] = [];
  const splats: Splat[] = [];
  const pops: Pop[] = [];
  const car = { x: -10, y: 0, speed: 0, steer: 0, dents: 0, invuln: 0, throwAnim: 0 };
  const startAmmo = delivery ? targets + 3 : 8;
  let ammo = startAmmo;
  let hits = 0, wrong = 0;
  const delivered: string[] = [];
  let camY = -40, shake = 0;
  let phase: 'intro' | 'go' | 'over' = 'intro';
  let phaseT = 2.8;
  let overText = '';
  let ended = false;
  let raf = 0;
  let last = performance.now();
  const keys = new Set<string>();
  const aimHelp = runCount(cfg.mode) < AIM_HELP_RUNS;
  const ammoIcon = delivery ? '📦' : '🍾';

  // --- Projection & primitives -----------------------------------------------------------
  const P = (x: number, y: number, z = 0): [number, number] => {
    const d = y - camY;
    return [OX + x * KX + d * DX, OY + x * KY - d * DY - z];
  };
  const poly = (pts: V3[], fill: string) => {
    ctx.beginPath();
    pts.forEach((p, i) => { const [sx, sy] = P(...p); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  /** A box: only the three faces you can see (top, +x side, -y end). */
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: string) => {
    poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], shade(colour, 0.62));
    poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], shade(colour, 0.85));
    poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], colour);
  };
  /** Draw in a building front's own space: u runs along the street, -z is down. */
  const onFacade = (x: number, y0: number, fn: () => void) => {
    const [ox, oy] = P(x, y0, 0);
    ctx.save();
    ctx.setTransform(SC * DX, -SC * DY, 0, SC, SC * ox, SC * oy);
    fn();
    ctx.restore();
  };
  const ellipseAt = (x: number, y: number, z: number, rx: number, ry: number, fill: string) => {
    const [sx, sy] = P(x, y, z);
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  };
  const pop = (text: string, x: number, y: number, z: number, colour: string) => pops.push({ text, x, y, z, life: 0, colour });

  // --- Input -------------------------------------------------------------------------------
  function doThrow(): void {
    if (phase !== 'go' || ended) return;
    if (ammo <= 0) {
      pop(delivery ? 'Out of parcels!' : 'Out of bottles!', car.x, car.y, 50, '#a39fbb');
      return;
    }
    ammo--;
    car.throwAnim = 0.3;
    flying.push({ x: car.x - 12, y: car.y, z: THROW_Z, vx: THROW_VX, vy: car.speed, vz: THROW_VZ, spin: 0 });
    sfx('throw');
  }
  throwBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); doThrow(); });
  canvas.addEventListener('pointerdown', doThrow);
  const hold = (btn: HTMLElement, dir: number) => {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); car.steer = dir; btn.setPointerCapture(e.pointerId); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => { if (car.steer === dir) car.steer = 0; });
  };
  hold(leftBtn, -1);
  hold(rightBtn, 1);
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.key === 'f') { e.preventDefault(); if (!e.repeat) doThrow(); return; }
    if (e.key === 'Escape') { finish(true); return; }
    if (e.key.startsWith('Arrow') || 'wasd'.includes(e.key)) e.preventDefault();
    keys.add(e.key);
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  function finish(aborted = false): void {
    if (ended) {
      if (aborted) overlay.remove();
      return;
    }
    ended = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    if (aborted && hits === 0 && wrong === 0 && ammo === startAmmo) {
      overlay.remove();
      return;
    }
    bumpRunCount(cfg.mode);
    const content = cfg.settle({ hits, targets, wrong, dents: car.dents, delivered, aborted });
    overlay.querySelector('.driveby-card')!.replaceChildren(
      h('div.driveby-result', {}, ...content, h('button.primary.big', { onclick: () => overlay.remove() }, 'Drive home')),
    );
  }

  // --- Simulation --------------------------------------------------------------------------
  const lotAt = (y: number) => lots.find((l) => y >= l.y0 && y <= l.y1);

  function crash(text: string): void {
    car.dents++;
    car.invuln = 1.4;
    car.speed *= 0.35;
    shake = 10;
    sfx('crash');
    pop(text, car.x, car.y, 46, '#ff5a6a');
    if (car.dents >= MAX_DENTS) { phase = 'over'; phaseT = 1.6; overText = "The car's had enough"; }
  }

  function landOnFacade(b: Throwable, lot: Lot): void {
    const u = b.y - lot.y0;
    if (lot.kind === 'rival' && b.z < TARGET_Z) {
      if (lot.burning < 0) {
        lot.burning = 0;
        lot.windows[0].lit = 0;
        hits++;
        shake = 8;
        sfx('boom');
        pop(['WHOOMPH!', 'KA-BOOM!', 'FWOOSH!', 'CLEAN SWEEP!'][hits - 1] ?? 'BOOM!', FACADE, b.y, 90, '#ffd23a');
      } else pop('Already toast', FACADE, b.y, 80, '#a39fbb');
      return;
    }
    if (lot.order && b.z < TARGET_Z) {
      if (!lot.delivered) {
        lot.delivered = true;
        hits++;
        delivered.push(lot.order.regularId);
        sfx('ding');
        pop(`Delivered! ${lot.order.name} 💛`, FACADE, b.y, 80, '#3ddc84');
        splats.push({ x: FACADE + 10, y: b.y, z: 0, life: -99 });
      } else pop('Already got one', FACADE, b.y, 70, '#a39fbb');
      return;
    }
    const win = lot.windows.find((w) => u >= w.y0 && u <= w.y1 && b.z >= w.z0 && b.z <= w.z1);
    if (win && win.lit < 0) {
      win.lit = 0;
      wrong++;
      sfx('splat');
      pop(delivery ? 'SMASH! Wrong house' : 'Wrong shop! +heat', FACADE, b.y, b.z + 30, '#ff5a6a');
    } else {
      splats.push({ x: FACADE + (delivery ? 10 : 2), y: b.y, z: delivery ? 0 : b.z, life: 0 });
      sfx('splat');
    }
  }

  function update(dt: number): void {
    if (phase === 'intro') {
      phaseT -= dt;
      if (phaseT <= 0) phase = 'go';
    }
    const driving = phase === 'go';
    const steerKey = (keys.has('ArrowLeft') || keys.has('a') ? -1 : 0) + (keys.has('ArrowRight') || keys.has('d') ? 1 : 0);
    const steer = steerKey || car.steer;
    const target = !driving ? 0 : keys.has('ArrowUp') || keys.has('w') ? 260 : keys.has('ArrowDown') || keys.has('s') ? 100 : 175;
    car.speed += (target - car.speed) * Math.min(1, dt * (driving ? 1.6 : 3));
    if (driving) car.x = Math.max(-LANE, Math.min(LANE, car.x + steer * 150 * dt));
    car.y += car.speed * dt;
    camY = car.y - 40;
    car.invuln = Math.max(0, car.invuln - dt);
    car.throwAnim = Math.max(0, car.throwAnim - dt);
    shake = Math.max(0, shake - dt * 30);

    for (const t of things) {
      if (t.done) continue;
      t.t += dt;
      const ahead = t.y - car.y;
      if (t.kind === 'oncoming' && ahead < 700) t.y += t.vy * dt;
      if (t.kind === 'cat' && ahead < 260) t.x += t.vx * dt;
      if (t.kind === 'dog') {
        if (!t.chasing && ahead < 150 && ahead > -20 && driving) {
          t.chasing = 3.2;
          pop('WOOF!', t.x, t.y, 30, '#ffd96a');
          sfx('woof');
        }
        if (t.chasing > 0) {
          t.chasing -= dt;
          t.y += Math.max(0, car.speed * 1.02 + (car.y + 10 - t.y) * 1.5) * dt;
          t.x += Math.sign(car.x + CAR_W + 6 - t.x) * Math.min(Math.abs(car.x + CAR_W + 6 - t.x), 110 * dt);
          if (t.chasing <= 0) t.x = 999;
        }
      }
      if (ahead < -200) { t.done = true; continue; }
      if (!driving) continue;
      const hitX = Math.abs(t.x - car.x) < (t.w / 2 + CAR_W);
      const hitY = Math.abs(t.y - car.y) < (t.l / 2 + CAR_L);
      if (!hitX || !hitY) continue;
      if (t.kind === 'crate') {
        t.done = true;
        const n = delivery ? 2 : 3;
        ammo += n;
        sfx('pick');
        pop(`+${n} ${delivery ? 'parcels' : 'bottles'}`, t.x, t.y, 30, '#3ddc84');
      } else if (t.kind === 'dog') {
        t.done = true;
        if (ammo > 0) ammo--;
        sfx('woof');
        pop(`The dog nicked a ${delivery ? 'parcel' : 'bottle'}!`, car.x, car.y, 50, '#ffd96a');
      } else if (t.kind === 'cat') {
        t.done = true;
        pop('MEOW!', t.x, t.y, 30, '#c69bff');
      } else if (car.invuln <= 0) {
        crash(t.kind === 'oncoming' ? 'HONK! CRUNCH!' : t.kind === 'police' ? 'Oi! Watch it!' : t.kind === 'cone' ? 'Bonk!' : 'CLONK!');
        if (t.kind === 'cone' || t.kind === 'bin') t.done = true;
      }
    }

    for (let i = flying.length - 1; i >= 0; i--) {
      const b = flying[i];
      const px = b.x;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vz -= GRAVITY * dt;
      b.z += b.vz * dt;
      b.spin += dt * (delivery ? 8 : 16);
      let gone = false;
      if (px > FACADE && b.x <= FACADE) {
        const lot = lotAt(b.y);
        if (lot && b.z < lot.hgt) {
          gone = true;
          landOnFacade(b, lot);
        }
      }
      if (!gone && b.z <= 0) {
        gone = true;
        splats.push({ x: b.x, y: b.y, z: 0, life: 0 });
        sfx('splat');
        if (b.x > FACADE) pop('Short!', b.x, b.y, 20, '#a39fbb');
      }
      if (gone) flying.splice(i, 1);
    }
    for (const l of lots) {
      if (l.burning >= 0) l.burning += dt;
      for (const w of l.windows) if (w.lit >= 0) w.lit += dt;
    }
    for (const s of splats) s.life += dt;
    for (let i = splats.length - 1; i >= 0; i--) if (splats[i].life > 1.4) splats.splice(i, 1);
    for (const p of pops) p.life += dt;
    for (let i = pops.length - 1; i >= 0; i--) if (pops[i].life > 1.3) pops.splice(i, 1);

    if (phase === 'go' && car.y >= END) {
      phase = 'over';
      phaseT = 1.4;
      overText = delivery ? (hits === targets ? 'Every parcel home!' : 'End of the round') : 'Made it out!';
    }
    if (phase === 'over') {
      phaseT -= dt;
      if (phaseT <= 0) finish();
    }
  }

  // --- Drawing -------------------------------------------------------------------------------
  function flames(cx: number, base: number, width: number, height: number, now: number, seed = 0): void {
    for (let k = 0; k < 6; k++) {
      const fl = Math.sin(now / 70 + k * 1.9 + seed) * 0.25 + 1;
      const x = cx + (k - 2.5) * (width / 6);
      ctx.fillStyle = k % 2 ? 'rgba(255,122,26,0.9)' : 'rgba(255,210,58,0.95)';
      ctx.beginPath();
      ctx.ellipse(x, base - (height * fl) / 2, width / 8, (height * fl) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const verge = { waves: '#5a5038', towers: '#2c2a36', clubs: '#241c2e', stalls: '#2e2a30', sheds: '#29292b', houses: '#18241d', trees: '#18241d', spire: '#18241d' }[style];

  function drawGround(now: number): void {
    const y0 = camY - 260, y1 = camY + 900;
    poly([[-500, y0, 0], [FACADE, y0, 0], [FACADE, y1, 0], [-500, y1, 0]], '#14121c');
    poly([[FACADE, y0, 0], [-KERB, y0, 0], [-KERB, y1, 0], [FACADE, y1, 0]], mix('#33313f', theme.ground, 0.25));
    poly([[-KERB, y0, 0], [KERB, y0, 0], [KERB, y1, 0], [-KERB, y1, 0]], '#22202b');
    poly([[KERB, y0, 0], [KERB + 26, y0, 0], [KERB + 26, y1, 0], [KERB, y1, 0]], '#33313f');
    poly([[KERB + 26, y0, 0], [600, y0, 0], [600, y1, 0], [KERB + 26, y1, 0]], verge);
    if (style === 'waves') {
      // The sea beyond the sand, with moonlit ripples.
      poly([[170, y0, 0], [600, y0, 0], [600, y1, 0], [170, y1, 0]], '#12304a');
      ctx.strokeStyle = 'rgba(180,220,255,0.25)';
      ctx.lineWidth = 1.5;
      for (let y = Math.floor(y0 / 60) * 60; y < y1; y += 60) {
        const [ax, ay] = P(185 + ((y / 60) % 3) * 20 + Math.sin(now / 600 + y) * 4, y), [bx, by] = P(205 + ((y / 60) % 3) * 20, y + 30);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      poly([[166, y0, 0], [172, y0, 0], [172, y1, 0], [166, y1, 0]], 'rgba(230,240,255,0.35)');
    }
    poly([[-KERB - 4, y0, 0], [-KERB, y0, 0], [-KERB, y1, 0], [-KERB - 4, y1, 0]], '#5a5868');
    poly([[KERB, y0, 0], [KERB + 4, y0, 0], [KERB + 4, y1, 0], [KERB, y1, 0]], '#5a5868');
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let y = Math.floor(y0 / 36) * 36; y < y1; y += 36) {
      const [ax, ay] = P(FACADE, y), [bx, by] = P(-KERB - 4, y);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    for (let y = Math.floor(y0 / 80) * 80; y < y1; y += 80) poly([[-2, y, 0], [2, y, 0], [2, y + 40, 0], [-2, y + 40, 0]], '#d9c060');
    if (END > y0 && END < y1) {
      for (let k = 0; k < 12; k++) poly([[-KERB + k * (KERB / 6), END, 0], [-KERB + (k + 1) * (KERB / 6), END, 0], [-KERB + (k + 1) * (KERB / 6), END + 12, 0], [-KERB + k * (KERB / 6), END + 12, 0]], k % 2 ? '#fff' : '#222');
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lampTint = style === 'clubs' ? '255,80,200' : '255,200,120';
    for (let y = Math.floor(y0 / 300) * 300 + 150; y < y1; y += 300) {
      for (const lx of [-KERB - 18, KERB + 18]) {
        const [sx, sy] = P(lx, y + (lx > 0 ? 150 : 0));
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 80);
        g.addColorStop(0, `rgba(${lampTint},0.22)`);
        g.addColorStop(1, `rgba(${lampTint},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(sx, sy, 90, 60, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Porch lights pool on the pavement outside houses waiting for a parcel.
    for (const l of lots) {
      if (!l.order || l.y1 < y0 || l.y0 > y1) continue;
      const [sx, sy] = P(FACADE + 18, l.y1 - 30);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 60);
      g.addColorStop(0, l.delivered ? 'rgba(61,220,132,0.3)' : 'rgba(255,210,122,0.4)');
      g.addColorStop(1, 'rgba(255,210,122,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(sx, sy, 70, 45, 0, 0, Math.PI * 2); ctx.fill();
    }
    const [hx, hy] = P(car.x, car.y + CAR_L);
    const [fx, fy] = P(car.x, car.y + 230);
    const beam = ctx.createLinearGradient(hx, hy, fx, fy);
    beam.addColorStop(0, 'rgba(255,240,190,0.28)');
    beam.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    for (const [i, p] of ([[car.x - 10, car.y + CAR_L], [car.x + 10, car.y + CAR_L], [car.x + 55, car.y + 230], [car.x - 55, car.y + 230]] as const).entries()) {
      const [sx, sy] = P(p[0], p[1]);
      if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
    }
    ctx.fill();
    ctx.restore();
    // Things on the ground: fire puddles, or parcels that missed (or landed on a doorstep).
    for (const s of splats) {
      if (s.z > 0) continue;
      const [sx, sy] = P(s.x, s.y);
      if (delivery) {
        ctx.globalAlpha = s.life < 0 ? 1 : Math.max(0, 1 - s.life / 1.4);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(0.3);
        ctx.fillStyle = '#c08a4a';
        ctx.fillRect(-6, -5, 12, 9);
        ctx.fillStyle = '#e8d4a8';
        ctx.fillRect(-1, -5, 2, 9);
        ctx.restore();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.globalAlpha = Math.max(0, 1 - s.life / 1.4);
      ctx.fillStyle = 'rgba(255,140,40,0.5)';
      ctx.beginPath(); ctx.ellipse(sx, sy, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
      flames(sx, sy, 22, 18 * (1 - s.life / 1.4), now, s.y);
      ctx.globalAlpha = 1;
    }
  }

  function drawLot(l: Lot, now: number): void {
    const x1 = FACADE, x0 = FACADE - l.depth;
    box(x0, x1, l.y0, l.y1, 0, l.hgt, l.roof);
    poly([[x1, l.y0, 0], [x1, l.y1, 0], [x1, l.y1, l.hgt], [x1, l.y0, l.hgt]], l.wall);
    const len = l.y1 - l.y0;
    onFacade(x1, l.y0, () => {
      ctx.fillStyle = shade(l.wall, 0.7);
      ctx.fillRect(0, -l.hgt, len, 6);
      for (const w of l.windows) {
        const broken = w.lit >= 0;
        const fire = broken && !delivery;
        const lit = l.kind === 'rival' ? '#9fe8ff' : l.order ? '#ffd27a' : (w.y0 * 7 + w.z0) % 3 === 0 ? '#2a2838' : '#ffd27a';
        ctx.fillStyle = fire ? `rgb(255,${120 + Math.round(Math.sin(now / 60 + w.y0) * 40)},40)` : broken ? '#141220' : lit;
        ctx.shadowColor = fire ? '#ff7a1a' : lit;
        ctx.shadowBlur = fire ? 20 : broken || lit === '#2a2838' ? 0 : 10;
        ctx.fillRect(w.y0, -w.z1, w.y1 - w.y0, w.z1 - w.z0);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#15131c';
        ctx.lineWidth = 2;
        ctx.strokeRect(w.y0, -w.z1, w.y1 - w.y0, w.z1 - w.z0);
        if (broken && delivery) {
          // A cartoon crack.
          ctx.strokeStyle = '#cfd8ff';
          ctx.lineWidth = 1.2;
          const cx = (w.y0 + w.y1) / 2, cz = -(w.z0 + w.z1) / 2;
          for (let k = 0; k < 5; k++) {
            ctx.beginPath(); ctx.moveTo(cx, cz);
            ctx.lineTo(cx + Math.cos(k * 1.3) * (w.y1 - w.y0) * 0.5, cz + Math.sin(k * 1.3) * (w.z1 - w.z0) * 0.5);
            ctx.stroke();
          }
        }
        if (l.kind === 'rival' && !broken) {
          for (let u = w.y0 + 10; u < w.y1 - 10; u += 16) {
            ctx.fillStyle = l.signColour ?? '#fff';
            ctx.fillRect(u, -w.z0 - 16, 8, 14);
          }
        }
      }
      if (l.kind === 'house') {
        ctx.fillStyle = l.order ? '#6a2a3a' : '#2a1e1a';
        ctx.fillRect(len - 34, -40, 20, 40);
        if (l.order) {
          // Porch light, doorstep and the plaque with their name and number.
          ctx.fillStyle = l.delivered ? '#3ddc84' : '#ffe6b0';
          ctx.shadowColor = l.delivered ? '#3ddc84' : '#ffcf8a';
          ctx.shadowBlur = 16;
          ctx.beginPath(); ctx.arc(len - 40, -46, 3.5, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#8a8494';
          ctx.fillRect(len - 40, -3, 32, 3);
          ctx.fillStyle = 'rgba(12,10,20,0.85)';
          ctx.fillRect(len - 112, -74, 104, 16);
          ctx.fillStyle = l.delivered ? '#3ddc84' : '#ffd27a';
          ctx.font = '800 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${l.delivered ? '✓ ' : ''}${l.order.door} · ${l.order.name}`, len - 60, -66, 100);
        }
      }
      if (l.sign) {
        const bandZ = l.kind === 'rival' ? 66 : 54;
        ctx.fillStyle = l.neon ? '#140c1e' : (l.signColour ?? '#555');
        ctx.fillRect(4, -bandZ - 18, len - 8, 18);
        if (l.kind === 'shop' && !l.neon) {
          for (let u = 6; u < len - 46; u += 12) {
            ctx.fillStyle = u % 24 < 12 ? '#ffffffcc' : (l.signColour ?? '#888');
            ctx.fillRect(u, -52, 12, 6);
          }
        }
        ctx.fillStyle = l.kind === 'rival' ? '#111' : l.neon ? (l.signColour ?? '#fff') : '#fff';
        if (l.neon) { ctx.shadowColor = l.signColour ?? '#fff'; ctx.shadowBlur = 12; }
        ctx.font = `800 ${l.kind === 'rival' ? 13 : 11}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(l.sign, len / 2, -bandZ - 9, len - 16);
        ctx.shadowBlur = 0;
        if (l.kind === 'rival') {
          ctx.fillStyle = '#15131c';
          ctx.fillRect(len - 52, -50, 28, 50);
          ctx.fillStyle = '#ffffff22';
          ctx.fillRect(len - 49, -47, 22, 44);
        }
      }
      if (l.burning >= 0) {
        const w = l.windows[0];
        flames((w.y0 + w.y1) / 2, -w.z1 + 6, w.y1 - w.y0, 30 + Math.min(1, l.burning) * 30, now, l.y0);
      }
      if (!delivery) {
        for (const w of l.windows) {
          if (w.lit < 0 || l.kind === 'rival') continue;
          flames((w.y0 + w.y1) / 2, -w.z1 + 4, w.y1 - w.y0, 18, now, w.y0);
        }
        for (const w of l.windows) {
          if (w.lit < 0) continue;
          for (let j = 0; j < 5; j++) {
            const ph = (now / 1600 + j / 5) % 1;
            ctx.fillStyle = `rgba(90,86,100,${(1 - ph) * 0.35})`;
            ctx.beginPath();
            ctx.arc((w.y0 + w.y1) / 2 + Math.sin(j * 3 + now / 500) * 10, -w.z1 - 20 - ph * 90, 6 + ph * 16, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    });
    if (!delivery) {
      for (const s of splats) {
        if (s.z <= 0 || s.y < l.y0 || s.y > l.y1) continue;
        const [sx, sy] = P(FACADE, s.y, s.z);
        ctx.globalAlpha = Math.max(0, 1 - s.life / 1.4);
        flames(sx, sy + 6, 20, 20, now, s.y);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawCarBody(x: number, y: number, colour: string, facingYou: boolean): void {
    ellipseAt(x + 4, y, 0, 26, 12, 'rgba(0,0,0,0.35)');
    box(x - CAR_W, x + CAR_W, y - CAR_L, y + CAR_L, 3, 15, colour);
    box(x - CAR_W + 2, x + CAR_W - 2, y - 12, y + 12, 15, 26, shade(colour, 0.8));
    poly([[x - CAR_W + 4, y - 12, 17], [x + CAR_W - 4, y - 12, 17], [x + CAR_W - 4, y - 12, 24], [x - CAR_W + 4, y - 12, 24]], '#9fd8ff88');
    poly([[x + CAR_W - 2, y - 10, 17], [x + CAR_W - 2, y + 10, 17], [x + CAR_W - 2, y + 10, 24], [x + CAR_W - 2, y - 10, 24]], '#9fd8ff66');
    const lightCol = facingYou ? '#fff6c4' : '#ff3344';
    for (const lx of [x - CAR_W + 4, x + CAR_W - 6]) {
      const [sx, sy] = P(lx, y - CAR_L, 10);
      ctx.fillStyle = lightCol;
      ctx.shadowColor = lightCol;
      ctx.shadowBlur = facingYou ? 16 : 8;
      ctx.fillRect(sx - 1, sy - 2, 5, 3);
      ctx.shadowBlur = 0;
    }
  }

  function drawThing(t: Thing, now: number): void {
    switch (t.kind) {
      case 'cone':
        ellipseAt(t.x, t.y, 0, 7, 3, 'rgba(0,0,0,0.3)');
        poly([[t.x - 5, t.y - 5, 0], [t.x + 5, t.y - 5, 0], [t.x, t.y, 18]], '#ff7a1a');
        poly([[t.x + 5, t.y - 5, 0], [t.x + 5, t.y + 5, 0], [t.x, t.y, 18]], '#d05a10');
        poly([[t.x - 3, t.y - 3, 7], [t.x + 3, t.y - 3, 7], [t.x + 2, t.y - 2, 11], [t.x - 2, t.y - 2, 11]], '#fff');
        break;
      case 'bin':
        ellipseAt(t.x + 3, t.y, 0, 10, 5, 'rgba(0,0,0,0.3)');
        box(t.x - 6, t.x + 6, t.y - 6, t.y + 6, 0, 22, t.colour);
        box(t.x - 7, t.x + 7, t.y - 7, t.y + 7, 22, 25, shade(t.colour, 0.7));
        break;
      case 'parked':
      case 'oncoming':
        drawCarBody(t.x, t.y, t.colour, t.kind === 'oncoming');
        break;
      case 'police': {
        drawCarBody(t.x, t.y, t.colour, false);
        const on = Math.floor(now / 180) % 2;
        for (const [k, col] of [[-5, '#3a6dff'], [5, '#ff3344']] as const) {
          const [sx, sy] = P(t.x + k, t.y, 29);
          ctx.fillStyle = (k < 0) === !!on ? col : shade(col, 0.4);
          ctx.shadowColor = col;
          ctx.shadowBlur = (k < 0) === !!on ? 18 : 0;
          ctx.fillRect(sx - 3, sy - 2, 6, 4);
          ctx.shadowBlur = 0;
        }
        const [sx, sy] = P(t.x, t.y, 40);
        ctx.fillStyle = '#cfd8ff';
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('POLICE', sx, sy);
        break;
      }
      case 'roadworks':
        ellipseAt(t.x, t.y, 0, 20, 5, 'rgba(0,0,0,0.3)');
        for (let k = 0; k < 4; k++) box(t.x - 17 + k * 8.5, t.x - 8.5 + k * 8.5, t.y - 3, t.y + 3, 8, 16, k % 2 ? '#ffffff' : '#e83a3a');
        for (const lx of [t.x - 15, t.x + 13]) box(lx, lx + 2, t.y - 2, t.y + 2, 0, 8, '#333');
        break;
      case 'dog': {
        const hop = Math.abs(Math.sin(now / 80)) * (t.chasing > 0 ? 5 : 1);
        ellipseAt(t.x, t.y, 0, 9, 4, 'rgba(0,0,0,0.3)');
        box(t.x - 4, t.x + 4, t.y - 8, t.y + 6, 4 + hop, 12 + hop, '#a0703a');
        box(t.x - 4, t.x + 4, t.y + 4, t.y + 10, 10 + hop, 17 + hop, '#b8844a');
        break;
      }
      case 'cat':
        ellipseAt(t.x, t.y, 0, 7, 3, 'rgba(0,0,0,0.3)');
        box(t.x - 6, t.x + 4, t.y - 3, t.y + 3, 2, 9, '#1a1820');
        box(t.x + 4, t.x + 8, t.y - 2, t.y + 2, 7, 12, '#1a1820');
        break;
      case 'crate': {
        const bob = Math.sin(now / 200) * 3;
        ellipseAt(t.x, t.y, 0, 11, 5, 'rgba(0,0,0,0.3)');
        box(t.x - 8, t.x + 8, t.y - 8, t.y + 8, 0, 12, '#a8743a');
        const [sx, sy] = P(t.x, t.y, 30 + bob);
        ctx.fillStyle = '#3ddc84';
        ctx.font = '800 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(delivery ? '+2 📦' : '+3 🔥', sx, sy);
        break;
      }
    }
  }

  function drawPlayer(now: number): void {
    if (car.invuln > 0 && Math.floor(now / 90) % 2) return;
    drawCarBody(car.x + car.steer * 2, car.y, '#3a6df0', false);
    const lean = car.throwAnim > 0 ? 6 : 0;
    const [hx, hy] = P(car.x - CAR_W - lean * 0.6, car.y + 2, 30 + lean * 0.5);
    ctx.fillStyle = '#ff4fa3';
    ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
    if (car.throwAnim > 0) {
      const [ax, ay] = P(car.x - CAR_W - 14, car.y + 6, 36);
      ctx.strokeStyle = '#ffb4d9';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx, hy + 4); ctx.lineTo(ax, ay); ctx.stroke();
    }
    if (car.dents >= 2) {
      for (let j = 0; j < 3; j++) {
        const ph = (now / 900 + j / 3) % 1;
        const [sx, sy] = P(car.x, car.y + 20, 20 + ph * 40);
        ctx.fillStyle = `rgba(120,120,130,${(1 - ph) * 0.5})`;
        ctx.beginPath(); ctx.arc(sx + ph * 10, sy, 4 + ph * 8, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  /** Lamps, plus the district's own kerbside props on the right: trees, palms, planters, stalls, fences. */
  function streetFurniture(y0: number, y1: number, now: number): Array<{ x: number; y: number; draw: () => void }> {
    const items: Array<{ x: number; y: number; draw: () => void }> = [];
    const lampCol = style === 'clubs' ? theme.neonA : '#ffcf8a';
    for (let y = Math.floor(y0 / 300) * 300 + 150; y < y1; y += 300) {
      for (const [lx, ly] of [[-KERB - 18, y], [KERB + 18, y + 150]] as const) {
        items.push({ x: lx, y: ly, draw: () => {
          const [bx, by] = P(lx, ly, 0), [tx, ty] = P(lx, ly, 96);
          ctx.strokeStyle = '#4a4858';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
          ctx.fillStyle = '#ffe6b0';
          ctx.shadowColor = lampCol;
          ctx.shadowBlur = 18;
          ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        } });
      }
    }
    for (let y = Math.floor(y0 / 170) * 170 + 60; y < y1; y += 170) {
      const tx = KERB + 60 + ((y * 13) % 50);
      let draw: () => void;
      switch (style) {
        case 'waves':
          draw = () => {
            ellipseAt(tx + 8, y, 0, 18, 8, 'rgba(0,0,0,0.3)');
            const [bx, by] = P(tx, y, 0), [cx, cy] = P(tx + 6, y, 56);
            ctx.strokeStyle = '#7a5a3a';
            ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + 2, (by + cy) / 2, cx, cy); ctx.stroke();
            ctx.strokeStyle = '#2f7a44';
            ctx.lineWidth = 4;
            for (let k = 0; k < 6; k++) {
              const a = (k / 6) * Math.PI * 2 + Math.sin(now / 900) * 0.1;
              ctx.beginPath(); ctx.moveTo(cx, cy); ctx.quadraticCurveTo(cx + Math.cos(a) * 14, cy - 8, cx + Math.cos(a) * 22, cy + Math.abs(Math.sin(a)) * 8 + 4); ctx.stroke();
            }
          };
          break;
        case 'towers':
        case 'clubs':
          draw = () => {
            box(tx - 10, tx + 10, y - 16, y + 16, 0, 12, style === 'clubs' ? '#2a1838' : '#3a3a48');
            ellipseAt(tx, y, 14, 9, 5, '#2c6a3e');
            if (style === 'clubs') {
              const [sx, sy] = P(tx + 10, y, 6);
              ctx.fillStyle = theme.neonB;
              ctx.shadowColor = theme.neonB;
              ctx.shadowBlur = 10;
              ctx.fillRect(sx - 1, sy - 8, 2, 8);
              ctx.shadowBlur = 0;
            }
          };
          break;
        case 'stalls':
          draw = () => {
            box(tx - 14, tx + 14, y - 22, y + 22, 0, 16, '#5a4030');
            for (let k = 0; k < 4; k++) box(tx - 16, tx + 16, y - 24 + k * 12, y - 12 + k * 12, 26, 29, k % 2 ? '#f2e8d8' : AWNINGS[(((Math.floor(y / 170) + 1) % AWNINGS.length) + AWNINGS.length) % AWNINGS.length]);
          };
          break;
        case 'sheds':
          draw = () => {
            for (let k = -2; k <= 2; k++) {
              const [bx, by] = P(KERB + 40, y + k * 34, 0), [tx2, ty2] = P(KERB + 40, y + k * 34, 30);
              ctx.strokeStyle = '#6a6a70';
              ctx.lineWidth = 2;
              ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx2, ty2); ctx.stroke();
            }
            const [ax, ay] = P(KERB + 40, y - 68, 26), [bx2, by2] = P(KERB + 40, y + 68, 26);
            ctx.strokeStyle = 'rgba(150,150,160,0.6)';
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx2, by2); ctx.stroke();
          };
          break;
        default:
          draw = () => {
            ellipseAt(tx + 8, y, 0, 22, 10, 'rgba(0,0,0,0.35)');
            const [bx, by] = P(tx, y, 0), [cx, cy] = P(tx, y, 34);
            ctx.strokeStyle = '#3a2a20';
            ctx.lineWidth = 5;
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(cx, cy); ctx.stroke();
            ctx.fillStyle = '#1f4a2c';
            ctx.beginPath(); ctx.arc(cx, cy - 8, 22, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#2c6a3e';
            ctx.beginPath(); ctx.arc(cx - 6, cy - 14, 12, 0, Math.PI * 2); ctx.fill();
          };
      }
      items.push({ x: tx, y, draw });
    }
    return items;
  }

  function drawHud(): void {
    ctx.fillStyle = 'rgba(12,10,20,0.75)';
    ctx.fillRect(0, 0, W, 44);
    const prog = Math.max(0, Math.min(1, car.y / END));
    ctx.fillStyle = '#2a2638';
    ctx.fillRect(14, 36, W - 28, 4);
    ctx.fillStyle = delivery ? '#ffd27a' : '#ff4fa3';
    ctx.fillRect(14, 36, (W - 28) * prog, 4);
    ctx.font = '700 15px system-ui, "Apple Color Emoji", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${ammoIcon} ${ammo}`, 14, 18);
    ctx.textAlign = 'center';
    ctx.fillStyle = delivery ? '#3ddc84' : '#ffd23a';
    ctx.fillText(delivery ? `🏠 ${hits} / ${targets} delivered` : `🔥 ${hits} / ${targets} shopfronts`, W / 2, 18);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${'❤️'.repeat(MAX_DENTS - car.dents)}${'🖤'.repeat(car.dents)}`, W - 14, 18);

    if (phase === 'intro') {
      ctx.fillStyle = 'rgba(12,10,20,0.84)';
      const bx = 36, by = 140, bw = W - 72, bh = 250;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 16); ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = delivery ? '#ffd27a' : '#ffd23a';
      ctx.font = '900 26px system-ui, sans-serif';
      ctx.fillText(delivery ? 'NIGHT ROUND' : 'FIREBOMB RUN', W / 2, by + 34);
      ctx.fillStyle = '#a39fbb';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillText(`${(loc?.name ?? '').toUpperCase()} · ${police >= 0.6 ? 'HEAVY POLICE' : police >= 0.4 ? 'SOME POLICE' : 'QUIET STREETS'}`, W / 2, by + 58);
      ctx.fillStyle = '#ece9f6';
      ctx.font = '600 13.5px system-ui, sans-serif';
      cfg.intro.forEach((ln, i) => ctx.fillText(ln, W / 2, by + 88 + i * 21));
      ctx.fillStyle = accent;
      ctx.fillRect(W / 2 - 60, by + 200, 120, 4);
      ctx.fillStyle = '#fff';
      ctx.font = '900 22px system-ui, sans-serif';
      ctx.fillText(phaseT > 0.6 ? String(Math.ceil(phaseT - 0.6)) : 'GO!', W / 2, by + 226);
    }
    if (phase === 'over') {
      ctx.textAlign = 'center';
      ctx.font = '900 32px system-ui, sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#15131c';
      ctx.strokeText(overText, W / 2, H / 2);
      ctx.fillStyle = car.dents >= MAX_DENTS ? '#ff5a6a' : '#3ddc84';
      ctx.fillText(overText, W / 2, H / 2);
    }
  }

  function aimMarker(): void {
    if (!aimHelp || phase !== 'go' || ammo <= 0) return;
    const t = (car.x - 12 - FACADE) / -THROW_VX;
    const y = car.y + car.speed * t;
    const z = THROW_Z + THROW_VZ * t - (GRAVITY * t * t) / 2;
    const lot = lotAt(y);
    if (!lot || z <= 0 || z > lot.hgt) return;
    const good = z < TARGET_Z && ((lot.kind === 'rival' && lot.burning < 0) || (!!lot.order && !lot.delivered));
    const [sx, sy] = P(FACADE, y, z);
    ctx.strokeStyle = good ? '#3ddc84' : lot.kind === 'rival' || lot.order ? '#a39fbb' : '#ff5a6a88';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(sx, sy, good ? 9 : 6, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  function draw(now: number): void {
    ctx.setTransform(SC, 0, 0, SC, 0, 0);
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.fillStyle = '#100e18';
    ctx.fillRect(-20, -20, W + 40, H + 40);
    drawGround(now);
    const y0 = camY - 260, y1 = camY + 900;
    for (const l of [...lots].reverse()) if (l.y1 > y0 && l.y0 < y1) drawLot(l, now);
    aimMarker();
    const items = streetFurniture(y0, y1, now).map((it) => ({ key: P(it.x, it.y)[1], draw: it.draw }));
    for (const t of things) if (!t.done && t.y > y0 && t.y < y1) items.push({ key: P(t.x, t.y)[1], draw: () => drawThing(t, now) });
    items.push({ key: P(car.x, car.y)[1], draw: () => drawPlayer(now) });
    items.sort((a, b) => a.key - b.key);
    for (const it of items) it.draw();
    for (const b of flying) {
      ellipseAt(b.x, b.y, 0, 4, 2, 'rgba(0,0,0,0.4)');
      const [sx, sy] = P(b.x, b.y, b.z);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(b.spin);
      if (delivery) {
        ctx.fillStyle = '#c08a4a';
        ctx.fillRect(-6, -5, 12, 10);
        ctx.fillStyle = '#e8d4a8';
        ctx.fillRect(-1, -5, 2, 10);
        ctx.fillRect(-6, -1, 12, 2);
      } else {
        ctx.fillStyle = '#5ac46a';
        ctx.fillRect(-3, -7, 6, 14);
        ctx.fillStyle = '#ffb020';
        ctx.shadowColor = '#ff7a1a';
        ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(0, -10, 3.5 + Math.sin(now / 40) * 1, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    for (const p of pops) {
      const [sx, sy] = P(p.x, p.y, p.z);
      ctx.globalAlpha = Math.max(0, 1 - p.life / 1.3);
      ctx.font = '900 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#15131c';
      ctx.strokeText(p.text, sx, sy - p.life * 34);
      ctx.fillStyle = p.colour;
      ctx.fillText(p.text, sx, sy - p.life * 34);
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(SC, 0, 0, SC, 0, 0);
    const v = ctx.createRadialGradient(W / 2, H * 0.6, H * 0.3, W / 2, H * 0.55, H * 0.85);
    v.addColorStop(0, 'rgba(8,6,16,0)');
    v.addColorStop(1, 'rgba(8,6,16,0.7)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    drawHud();
  }

  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    if (ended) return;
    draw(now);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
}
