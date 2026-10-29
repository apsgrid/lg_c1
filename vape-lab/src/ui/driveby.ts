import { driveBy, type Rival } from '../sim';
import { shopAction, shopState } from '../shopState';
import { data } from '../state';
import { h } from './dom';
import { toast } from './toast';

/*
 * The drive-by, Paperboy style: you drive up a diagonal street at night and
 * lob bottles sideways at the rival's shopfronts, while dodging bins, cones,
 * oncoming traffic and a dog that wants your bottles. Every shopfront you
 * light shuts them for a day (up to 3). Hitting the neighbours adds heat.
 * Cartoon only: the shops are empty and the flames are mostly comic.
 */

const W = 480, H = 600;
// Oblique projection: the street runs up and to the right.
const OX = 205, OY = 505;
const KX = 0.95, KY = 0.42, DX = 0.5, DY = 0.74;
const FACADE = -110;        // building fronts, left side
const KERB = 62;            // road half-width
const LANE = 46;            // how far the car can steer either side
const END = 3900;
const START_BOTTLES = 8;
const MAX_DENTS = 3;
const THROW_VX = -280, THROW_VZ = 170, GRAVITY = 600, THROW_Z = 26;
const CAR_W = 14, CAR_L = 26;

type V3 = [number, number, number];
interface Win { y0: number; y1: number; z0: number; z1: number; lit: number }
interface Lot {
  y0: number; y1: number; depth: number; hgt: number;
  kind: 'rival' | 'shop' | 'house' | 'flats';
  wall: string; roof: string;
  sign?: string; signColour?: string;
  windows: Win[];
  burning: number;          // seconds since lit, -1 = not burning
}
type ThingKind = 'cone' | 'bin' | 'parked' | 'oncoming' | 'dog' | 'cat' | 'crate' | 'police' | 'roadworks';
interface Thing { kind: ThingKind; x: number; y: number; w: number; l: number; vx: number; vy: number; done: boolean; colour: string; t: number; chasing: number }
interface Bottle { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number }
interface Splat { x: number; y: number; z: number; life: number }
interface Pop { text: string; x: number; y: number; z: number; life: number; colour: string }

const NEIGHBOURS = ['Corner Shop', 'Launderette', 'Chippy', 'Bakery', 'Barber', 'Kebab House', 'Florist', 'Newsagent', 'Pet Shop', 'Cafe'];
const AWNINGS = ['#e85a5a', '#3a8a5a', '#d9a03a', '#3a6db0', '#8a4ab0', '#c0603a'];
const CAR_COLOURS = ['#c94a4a', '#e0c04a', '#4ab07a', '#d0d0d8', '#7a5ad0', '#2a2a34'];

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(f >= 1 ? c + (255 - c) * (f - 1) : c * f));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

function buildStreet(rival: Rival): Lot[] {
  const lots: Lot[] = [];
  const rivalAt = new Set([3, 7, 11, 15]);
  const rivalNames = [rival.name, `${rival.name} Express`, `${rival.name} Outlet`, `${rival.name} Depot`];
  let y = 140, i = 0, n = 0;
  while (y < END - 250) {
    let lot: Lot;
    if (rivalAt.has(i)) {
      const len = 200;
      lot = {
        y0: y, y1: y + len, depth: 120, hgt: 96, kind: 'rival', wall: '#2a2436', roof: '#1c1826',
        sign: rivalNames[n++ % 4].toUpperCase(), signColour: rival.colour, burning: -1,
        windows: [{ y0: 22, y1: len - 62, z0: 10, z1: 58, lit: -1 }],
      };
    } else {
      const r = Math.random();
      const len = 110 + Math.round(Math.random() * 110);
      if (r < 0.4) {
        lot = {
          y0: y, y1: y + len, depth: 110, hgt: 82, kind: 'shop', wall: ['#4a3a34', '#3a4048', '#4a4436', '#3e3448'][i % 4], roof: '#25222c',
          sign: NEIGHBOURS[Math.floor(Math.random() * NEIGHBOURS.length)], signColour: AWNINGS[Math.floor(Math.random() * AWNINGS.length)], burning: -1,
          windows: [{ y0: 16, y1: len - 46, z0: 12, z1: 50, lit: -1 }],
        };
      } else if (r < 0.75) {
        const windows: Win[] = [];
        for (let u = 14; u + 28 < len - 10; u += 46) windows.push({ y0: u, y1: u + 28, z0: 34, z1: 58, lit: -1 });
        lot = { y0: y, y1: y + len, depth: 100, hgt: 74, kind: 'house', wall: ['#5a4038', '#4a4a56', '#5a5046', '#3a4a44'][i % 4], roof: '#3a2a2a', burning: -1, windows };
      } else {
        const windows: Win[] = [];
        for (const z of [14, 56, 98]) for (let u = 12; u + 24 < len - 8; u += 38) windows.push({ y0: u, y1: u + 24, z0: z, z1: z + 24, lit: -1 });
        lot = { y0: y, y1: y + len, depth: 140, hgt: 136, kind: 'flats', wall: '#34384a', roof: '#22242e', burning: -1, windows };
      }
    }
    lots.push(lot);
    y = lot.y1 + (Math.random() < 0.3 ? 40 + Math.random() * 50 : 6);
    i++;
  }
  return lots;
}

function buildTraffic(): Thing[] {
  const things: Thing[] = [];
  const add = (kind: ThingKind, x: number, y: number, w: number, l: number, extra: Partial<Thing> = {}) =>
    things.push({ kind, x, y, w, l, vx: 0, vy: 0, done: false, colour: '#888', t: 0, chasing: 0, ...extra });
  const lane = () => (Math.random() * 2 - 1) * 36;
  for (let y = 420; y < END - 180; y += 170 + Math.random() * 110) {
    const r = Math.random();
    if (r < 0.18) add('cone', lane(), y, 10, 10);
    else if (r < 0.32) add('bin', lane(), y, 14, 14, { colour: Math.random() < 0.5 ? '#2f7a4a' : '#3a4a8a' });
    else if (r < 0.48) add('parked', Math.random() < 0.5 ? -48 : 48, y, 26, 52, { colour: CAR_COLOURS[Math.floor(Math.random() * CAR_COLOURS.length)] });
    else if (r < 0.64) add('oncoming', 30, y + 260, 26, 52, { vy: -120, colour: CAR_COLOURS[Math.floor(Math.random() * CAR_COLOURS.length)] });
    else if (r < 0.76) add('dog', 120, y, 10, 16);
    else if (r < 0.85) add('cat', -86, y, 8, 12, { vx: 55 });
    else if (r < 0.94) add('roadworks', lane() * 0.6, y, 34, 8);
    else add('police', 48, y, 26, 52, { colour: '#e8e8f0' });
  }
  for (const y of [1150, 2250, 3150]) add('crate', lane(), y, 16, 16);
  return things;
}

// --- Tiny sound effects (WebAudio, no files) ---------------------------------------------
let actx: AudioContext | null = null;
function sfx(kind: 'throw' | 'boom' | 'crash' | 'pick' | 'woof' | 'splat'): void {
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
    const [f0, f1, dur] = kind === 'throw' ? [300, 900, 0.18] : kind === 'pick' ? [660, 1320, 0.15] : [320, 180, 0.12];
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(f1, now + dur);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.start(now);
    o.stop(now + dur);
  } catch { /* no audio: play on in silence */ }
}

export function openDriveBy(rivalId: string): void {
  const found = shopState.shop.rivals.find((r) => r.id === rivalId);
  if (!found) return;
  const rival = found;
  const canvas = h('canvas.driveby-canvas', { width: W * 2, height: H * 2 });
  const throwBtn = h('button.primary.big.throw-btn', {}, '🔥 Throw');
  const leftBtn = h('button.steer', { 'aria-label': 'Steer left' }, '◀');
  const rightBtn = h('button.steer', { 'aria-label': 'Steer right' }, '▶');
  const close = h('button.ghost', { onclick: () => finish(true) }, 'Abort');
  const overlay = h('div.driveby', { role: 'dialog', 'aria-label': `Drive-by on ${rival.name}` },
    h('div.driveby-card', {},
      h('div.driveby-title', {}, h('b', {}, `Firebomb run: ${rival.name}`), close),
      canvas,
      h('div.driveby-controls', {}, leftBtn, throwBtn, rightBtn),
      h('div.driveby-status', {}, 'Keys: ← → steer · ↑ ↓ speed · Space throws'),
    ),
  );
  document.body.append(overlay);
  const ctx = canvas.getContext('2d')!;
  const SC = canvas.width / W;

  const lots = buildStreet(rival);
  const things = buildTraffic();
  const bottles: Bottle[] = [];
  const splats: Splat[] = [];
  const pops: Pop[] = [];
  const car = { x: -10, y: 0, speed: 0, steer: 0, dents: 0, invuln: 0, throwAnim: 0 };
  let bottlesLeft = START_BOTTLES;
  let rivalLit = 0, collateral = 0;
  let camY = -40, shake = 0;
  let phase: 'intro' | 'go' | 'over' = 'intro';
  let phaseT = 2.6;
  let overText = '';
  let ended = false;
  let raf = 0;
  let last = performance.now();
  const keys = new Set<string>();

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

  // --- Input -------------------------------------------------------------------------------
  function doThrow(): void {
    if (phase !== 'go' || ended) return;
    if (bottlesLeft <= 0) {
      pops.push({ text: 'Out of bottles!', x: car.x, y: car.y, z: 50, life: 0, colour: '#a39fbb' });
      return;
    }
    bottlesLeft--;
    car.throwAnim = 0.3;
    bottles.push({ x: car.x - 12, y: car.y, z: THROW_Z, vx: THROW_VX, vy: car.speed, vz: THROW_VZ, spin: 0 });
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
    if (aborted && rivalLit === 0 && collateral === 0 && bottlesLeft === START_BOTTLES) {
      overlay.remove();
      return;
    }
    const hits = Math.min(3, rivalLit);
    const res = driveBy(shopState.shop, rivalId, hits, data, collateral);
    shopAction(() => res.shop, 'driveby');
    const headline = rivalLit >= 4 ? 'Clean sweep!' : rivalLit ? `${rivalLit} shopfront${rivalLit === 1 ? '' : 's'} lit!` : 'Missed the lot!';
    overlay.querySelector('.driveby-card')!.replaceChildren(
      h('div.driveby-result', {},
        h('div.big-emoji', {}, res.caught ? '🚓' : rivalLit ? '🔥' : '💨'),
        h('h2', {}, headline),
        h('div.driveby-tally', {},
          h('span', {}, h('b', {}, String(rivalLit)), ' rival fronts'),
          h('span', {}, h('b', {}, String(collateral)), ' wrong buildings'),
          h('span', {}, h('b', {}, String(car.dents)), ' dents'),
        ),
        h('p', {}, res.text),
        h('p.fine', {}, `Heat is now ${Math.round(res.shop.heat)}. ${rival.name} won't forget this.`),
        h('button.primary.big', { onclick: () => overlay.remove() }, res.caught ? 'Ugh. Fine.' : 'Drive home'),
      ),
    );
    toast(res.caught ? 'Busted after the drive-by!' : hits ? `${rival.name} is shut for ${hits} day${hits === 1 ? '' : 's'}.` : 'Missed everything.', res.caught ? 'info' : 'gold');
  }

  // --- Simulation --------------------------------------------------------------------------
  const lotAt = (y: number) => lots.find((l) => y >= l.y0 && y <= l.y1);

  function crash(text: string): void {
    car.dents++;
    car.invuln = 1.4;
    car.speed *= 0.35;
    shake = 10;
    sfx('crash');
    pops.push({ text, x: car.x, y: car.y, z: 46, life: 0, colour: '#ff5a6a' });
    if (car.dents >= MAX_DENTS) { phase = 'over'; phaseT = 1.6; overText = "The car's had enough"; }
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
          pops.push({ text: 'WOOF!', x: t.x, y: t.y, z: 30, life: 0, colour: '#ffd96a' });
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
      // Collisions (the car's footprint against the thing's).
      if (!driving) continue;
      const hitX = Math.abs(t.x - car.x) < (t.w / 2 + CAR_W);
      const hitY = Math.abs(t.y - car.y) < (t.l / 2 + CAR_L);
      if (!hitX || !hitY) continue;
      if (t.kind === 'crate') {
        t.done = true;
        bottlesLeft += 3;
        sfx('pick');
        pops.push({ text: '+3 bottles', x: t.x, y: t.y, z: 30, life: 0, colour: '#3ddc84' });
      } else if (t.kind === 'dog') {
        t.done = true;
        if (bottlesLeft > 0) bottlesLeft--;
        sfx('woof');
        pops.push({ text: 'The dog nicked a bottle!', x: car.x, y: car.y, z: 50, life: 0, colour: '#ffd96a' });
      } else if (t.kind === 'cat') {
        t.done = true;
        pops.push({ text: 'MEOW!', x: t.x, y: t.y, z: 30, life: 0, colour: '#c69bff' });
      } else if (car.invuln <= 0) {
        crash(t.kind === 'oncoming' ? 'HONK! CRUNCH!' : t.kind === 'police' ? 'Oi! Watch it!' : t.kind === 'cone' ? 'Bonk!' : 'CLONK!');
        if (t.kind === 'cone' || t.kind === 'bin') { t.done = true; }
      }
    }

    for (let i = bottles.length - 1; i >= 0; i--) {
      const b = bottles[i];
      const px = b.x;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vz -= GRAVITY * dt;
      b.z += b.vz * dt;
      b.spin += dt * 16;
      let gone = false;
      if (px > FACADE && b.x <= FACADE) {
        const lot = lotAt(b.y);
        if (lot && b.z < lot.hgt) {
          gone = true;
          const u = b.y - lot.y0;
          if (lot.kind === 'rival' && b.z < 62) {
            if (lot.burning < 0) {
              lot.burning = 0;
              lot.windows[0].lit = 0;
              rivalLit++;
              shake = 8;
              sfx('boom');
              pops.push({ text: ['WHOOMPH!', 'KA-BOOM!', 'FWOOSH!', 'CLEAN SWEEP!'][rivalLit - 1] ?? 'BOOM!', x: FACADE, y: b.y, z: 90, life: 0, colour: '#ffd23a' });
            } else {
              pops.push({ text: 'Already toast', x: FACADE, y: b.y, z: 80, life: 0, colour: '#a39fbb' });
            }
          } else {
            const win = lot.windows.find((w) => u >= w.y0 && u <= w.y1 && b.z >= w.z0 && b.z <= w.z1);
            if (win && win.lit < 0) {
              win.lit = 0;
              collateral++;
              sfx('splat');
              pops.push({ text: 'Wrong shop! +heat', x: FACADE, y: b.y, z: b.z + 30, life: 0, colour: '#ff5a6a' });
            } else {
              splats.push({ x: FACADE + 2, y: b.y, z: b.z, life: 0 });
              sfx('splat');
            }
          }
        }
      }
      if (!gone && b.z <= 0) {
        gone = true;
        splats.push({ x: b.x, y: b.y, z: 0, life: 0 });
        sfx('splat');
        if (b.x > FACADE) pops.push({ text: 'Short!', x: b.x, y: b.y, z: 20, life: 0, colour: '#a39fbb' });
      }
      if (gone) bottles.splice(i, 1);
    }
    for (const l of lots) {
      if (l.burning >= 0) l.burning += dt;
      for (const w of l.windows) if (w.lit >= 0) w.lit += dt;
    }
    for (const s of splats) s.life += dt;
    for (let i = splats.length - 1; i >= 0; i--) if (splats[i].life > 1.4) splats.splice(i, 1);
    for (const p of pops) p.life += dt;
    for (let i = pops.length - 1; i >= 0; i--) if (pops[i].life > 1.3) pops.splice(i, 1);

    if (phase === 'go' && car.y >= END) { phase = 'over'; phaseT = 1.4; overText = 'Made it out!'; }
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

  function drawGround(now: number): void {
    const y0 = camY - 260, y1 = camY + 900;
    poly([[-500, y0, 0], [FACADE, y0, 0], [FACADE, y1, 0], [-500, y1, 0]], '#14121c');
    poly([[FACADE, y0, 0], [-KERB, y0, 0], [-KERB, y1, 0], [FACADE, y1, 0]], '#33313f');
    poly([[-KERB, y0, 0], [KERB, y0, 0], [KERB, y1, 0], [-KERB, y1, 0]], '#22202b');
    poly([[KERB, y0, 0], [KERB + 26, y0, 0], [KERB + 26, y1, 0], [KERB, y1, 0]], '#33313f');
    poly([[KERB + 26, y0, 0], [600, y0, 0], [600, y1, 0], [KERB + 26, y1, 0]], '#18241d');
    poly([[-KERB - 4, y0, 0], [-KERB, y0, 0], [-KERB, y1, 0], [-KERB - 4, y1, 0]], '#5a5868');
    poly([[KERB, y0, 0], [KERB + 4, y0, 0], [KERB + 4, y1, 0], [KERB, y1, 0]], '#5a5868');
    // Paving lines and road markings.
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let y = Math.floor(y0 / 36) * 36; y < y1; y += 36) {
      const [ax, ay] = P(FACADE, y), [bx, by] = P(-KERB - 4, y);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    for (let y = Math.floor(y0 / 80) * 80; y < y1; y += 80) poly([[-2, y, 0], [2, y, 0], [2, y + 40, 0], [-2, y + 40, 0]], '#d9c060');
    // The finish line.
    if (END > y0 && END < y1) {
      for (let k = 0; k < 12; k++) poly([[-KERB + k * (KERB / 6), END, 0], [-KERB + (k + 1) * (KERB / 6), END, 0], [-KERB + (k + 1) * (KERB / 6), END + 12, 0], [-KERB + k * (KERB / 6), END + 12, 0]], k % 2 ? '#fff' : '#222');
    }
    // Pools of light under the streetlamps and in front of the car.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let y = Math.floor(y0 / 300) * 300 + 150; y < y1; y += 300) {
      for (const lx of [-KERB - 18, KERB + 18]) {
        const [sx, sy] = P(lx, y + (lx > 0 ? 150 : 0));
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 80);
        g.addColorStop(0, 'rgba(255,200,120,0.22)');
        g.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(sx, sy, 90, 60, 0, 0, Math.PI * 2); ctx.fill();
      }
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
    // Puddles of fire.
    for (const s of splats) {
      if (s.z > 0) continue;
      const [sx, sy] = P(s.x, s.y);
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
    // Repaint the front in the wall colour, then dress it.
    poly([[x1, l.y0, 0], [x1, l.y1, 0], [x1, l.y1, l.hgt], [x1, l.y0, l.hgt]], l.wall);
    const len = l.y1 - l.y0;
    onFacade(x1, l.y0, () => {
      // Roof edge.
      ctx.fillStyle = shade(l.wall, 0.7);
      ctx.fillRect(0, -l.hgt, len, 6);
      for (const w of l.windows) {
        const burning = w.lit >= 0;
        const lit = l.kind === 'rival' ? '#9fe8ff' : (w.y0 * 7 + w.z0) % 3 === 0 ? '#2a2838' : '#ffd27a';
        ctx.fillStyle = burning ? `rgb(255,${120 + Math.round(Math.sin(now / 60 + w.y0) * 40)},40)` : lit;
        ctx.shadowColor = burning ? '#ff7a1a' : lit;
        ctx.shadowBlur = burning ? 20 : lit === '#2a2838' ? 0 : 10;
        ctx.fillRect(w.y0, -w.z1, w.y1 - w.y0, w.z1 - w.z0);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#15131c';
        ctx.lineWidth = 2;
        ctx.strokeRect(w.y0, -w.z1, w.y1 - w.y0, w.z1 - w.z0);
        if (l.kind === 'rival' && !burning) {
          // Display stands of boxed vapes in the window.
          for (let u = w.y0 + 10; u < w.y1 - 10; u += 16) {
            ctx.fillStyle = l.signColour ?? '#fff';
            ctx.fillRect(u, -w.z0 - 16, 8, 14);
          }
        }
      }
      if (l.kind === 'house') {
        ctx.fillStyle = '#2a1e1a';
        ctx.fillRect(len - 34, -40, 20, 40);
      }
      if (l.sign) {
        const bandZ = l.kind === 'rival' ? 66 : 54;
        ctx.fillStyle = l.signColour ?? '#555';
        ctx.fillRect(4, -bandZ - 18, len - 8, 18);
        if (l.kind === 'shop') {
          // Striped awning.
          for (let u = 6; u < len - 46; u += 12) {
            ctx.fillStyle = u % 24 < 12 ? '#ffffffcc' : (l.signColour ?? '#888');
            ctx.fillRect(u, -52, 12, 6);
          }
        }
        ctx.fillStyle = l.kind === 'rival' ? '#111' : '#fff';
        ctx.font = `800 ${l.kind === 'rival' ? 13 : 11}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(l.sign, len / 2, -bandZ - 9, len - 16);
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
      for (const w of l.windows) {
        if (w.lit < 0 || l.kind === 'rival') continue;
        flames((w.y0 + w.y1) / 2, -w.z1 + 4, w.y1 - w.y0, 18, now, w.y0);
      }
      // Smoke from anything burning.
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
    });
    // Wall splats.
    for (const s of splats) {
      if (s.z <= 0 || s.y < l.y0 || s.y > l.y1) continue;
      const [sx, sy] = P(FACADE, s.y, s.z);
      ctx.globalAlpha = Math.max(0, 1 - s.life / 1.4);
      flames(sx, sy + 6, 20, 20, now, s.y);
      ctx.globalAlpha = 1;
    }
  }

  function drawCarBody(x: number, y: number, colour: string, facingYou: boolean, now: number): void {
    ellipseAt(x + 4, y, 0, 26, 12, 'rgba(0,0,0,0.35)');
    box(x - CAR_W, x + CAR_W, y - CAR_L, y + CAR_L, 3, 15, colour);
    box(x - CAR_W + 2, x + CAR_W - 2, y - 12, y + 12, 15, 26, shade(colour, 0.8));
    // Windows on the visible faces.
    poly([[x - CAR_W + 4, y - 12, 17], [x + CAR_W - 4, y - 12, 17], [x + CAR_W - 4, y - 12, 24], [x - CAR_W + 4, y - 12, 24]], '#9fd8ff88');
    poly([[x + CAR_W - 2, y - 10, 17], [x + CAR_W - 2, y + 10, 17], [x + CAR_W - 2, y + 10, 24], [x + CAR_W - 2, y - 10, 24]], '#9fd8ff66');
    // Lights on the end you can see.
    const lightCol = facingYou ? '#fff6c4' : '#ff3344';
    for (const lx of [x - CAR_W + 4, x + CAR_W - 6]) {
      const [sx, sy] = P(lx, y - CAR_L, 10);
      ctx.fillStyle = lightCol;
      ctx.shadowColor = lightCol;
      ctx.shadowBlur = facingYou ? 16 : 8;
      ctx.fillRect(sx - 1, sy - 2, 5, 3);
      ctx.shadowBlur = 0;
    }
    void now;
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
        drawCarBody(t.x, t.y, t.colour, t.kind === 'oncoming', now);
        break;
      case 'police': {
        drawCarBody(t.x, t.y, t.colour, false, now);
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
        ctx.fillText('+3 🔥', sx, sy);
        break;
      }
    }
  }

  function drawPlayer(now: number): void {
    if (car.invuln > 0 && Math.floor(now / 90) % 2) return;
    const tilt = car.steer * 2;
    drawCarBody(car.x + tilt, car.y, '#3a6df0', false, now);
    // You, leaning out of the window to throw.
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

  function streetFurniture(y0: number, y1: number): Array<{ x: number; y: number; draw: () => void }> {
    const items: Array<{ x: number; y: number; draw: () => void }> = [];
    for (let y = Math.floor(y0 / 300) * 300 + 150; y < y1; y += 300) {
      for (const [lx, ly] of [[-KERB - 18, y], [KERB + 18, y + 150]] as const) {
        items.push({ x: lx, y: ly, draw: () => {
          const [bx, by] = P(lx, ly, 0), [tx, ty] = P(lx, ly, 96);
          ctx.strokeStyle = '#4a4858';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
          ctx.fillStyle = '#ffe6b0';
          ctx.shadowColor = '#ffcf8a';
          ctx.shadowBlur = 18;
          ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        } });
      }
    }
    for (let y = Math.floor(y0 / 170) * 170 + 60; y < y1; y += 170) {
      const tx = KERB + 60 + ((y * 13) % 50);
      items.push({ x: tx, y, draw: () => {
        ellipseAt(tx + 8, y, 0, 22, 10, 'rgba(0,0,0,0.35)');
        const [bx, by] = P(tx, y, 0), [cx, cy] = P(tx, y, 34);
        ctx.strokeStyle = '#3a2a20';
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(cx, cy); ctx.stroke();
        ctx.fillStyle = '#1f4a2c';
        ctx.beginPath(); ctx.arc(cx, cy - 8, 22, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2c6a3e';
        ctx.beginPath(); ctx.arc(cx - 6, cy - 14, 12, 0, Math.PI * 2); ctx.fill();
      } });
    }
    return items;
  }

  function drawHud(now: number): void {
    ctx.fillStyle = 'rgba(12,10,20,0.75)';
    ctx.fillRect(0, 0, W, 44);
    // Route progress.
    const prog = Math.max(0, Math.min(1, car.y / END));
    ctx.fillStyle = '#2a2638';
    ctx.fillRect(14, 36, W - 28, 4);
    ctx.fillStyle = '#ff4fa3';
    ctx.fillRect(14, 36, (W - 28) * prog, 4);
    ctx.font = '700 15px system-ui, "Apple Color Emoji", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(`🍾 ${bottlesLeft}`, 14, 18);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd23a';
    ctx.fillText(`🔥 ${rivalLit} / 4 shopfronts`, W / 2, 18);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${'❤️'.repeat(MAX_DENTS - car.dents)}${'🖤'.repeat(car.dents)}`, W - 14, 18);

    if (phase === 'intro') {
      ctx.fillStyle = 'rgba(12,10,20,0.82)';
      const bx = 40, by = 150, bw = W - 80, bh = 220;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 16); ctx.fill();
      ctx.strokeStyle = rival.colour;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd23a';
      ctx.font = '900 26px system-ui, sans-serif';
      ctx.fillText('FIREBOMB RUN', W / 2, by + 34);
      ctx.fillStyle = '#ece9f6';
      ctx.font = '600 13.5px system-ui, sans-serif';
      const lines = [
        `Lob bottles at ${rival.name} shopfronts`,
        '(their coloured signs). Each one shuts them a day.',
        'Leave the neighbours alone: wrong windows = heat.',
        'Dodge bins, cones and traffic. Grab crates for',
        'more bottles. The dog wants your bottles.',
      ];
      lines.forEach((ln, i) => ctx.fillText(ln, W / 2, by + 70 + i * 21));
      ctx.fillStyle = rival.colour;
      ctx.fillRect(W / 2 - 60, by + 182, 120, 4);
      ctx.fillStyle = '#fff';
      ctx.font = '900 22px system-ui, sans-serif';
      ctx.fillText(phaseT > 0.6 ? String(Math.ceil(phaseT - 0.6)) : 'GO!', W / 2, by + 204);
    }
    if (phase === 'over') {
      ctx.textAlign = 'center';
      ctx.font = '900 32px system-ui, sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#15131c';
      ctx.strokeText(overText, W / 2, H / 2);
      ctx.fillStyle = overText.startsWith('Made') ? '#3ddc84' : '#ff5a6a';
      ctx.fillText(overText, W / 2, H / 2);
    }
    void now;
  }

  function aimMarker(): void {
    if (phase !== 'go' || bottlesLeft <= 0) return;
    // Where a bottle thrown right now would meet the building fronts.
    const t = (car.x - 12 - FACADE) / -THROW_VX;
    const y = car.y + car.speed * t;
    const z = THROW_Z + THROW_VZ * t - (GRAVITY * t * t) / 2;
    const lot = lotAt(y);
    if (!lot || z <= 0 || z > lot.hgt) return;
    const good = lot.kind === 'rival' && z < 62 && lot.burning < 0;
    const [sx, sy] = P(FACADE, y, z);
    ctx.strokeStyle = good ? '#3ddc84' : lot.kind === 'rival' ? '#a39fbb' : '#ff5a6a88';
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
    // Buildings far to near, then everything else by depth on screen.
    for (const l of [...lots].reverse()) if (l.y1 > y0 && l.y0 < y1) drawLot(l, now);
    aimMarker();
    const items = streetFurniture(y0, y1).map((it) => ({ key: P(it.x, it.y)[1], draw: it.draw }));
    for (const t of things) if (!t.done && t.y > y0 && t.y < y1) items.push({ key: P(t.x, t.y)[1], draw: () => drawThing(t, now) });
    items.push({ key: P(car.x, car.y)[1], draw: () => drawPlayer(now) });
    items.sort((a, b) => a.key - b.key);
    for (const it of items) it.draw();
    for (const b of bottles) {
      ellipseAt(b.x, b.y, 0, 4, 2, 'rgba(0,0,0,0.4)');
      const [sx, sy] = P(b.x, b.y, b.z);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(b.spin);
      ctx.fillStyle = '#5ac46a';
      ctx.fillRect(-3, -7, 6, 14);
      ctx.fillStyle = '#ffb020';
      ctx.shadowColor = '#ff7a1a';
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(0, -10, 3.5 + Math.sin(now / 40) * 1, 0, Math.PI * 2); ctx.fill();
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
    // Night vignette.
    ctx.setTransform(SC, 0, 0, SC, 0, 0);
    const v = ctx.createRadialGradient(W / 2, H * 0.6, H * 0.3, W / 2, H * 0.55, H * 0.85);
    v.addColorStop(0, 'rgba(8,6,16,0)');
    v.addColorStop(1, 'rgba(8,6,16,0.7)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    drawHud(now);
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
