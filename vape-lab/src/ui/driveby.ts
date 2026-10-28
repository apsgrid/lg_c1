import { driveBy } from '../sim';
import { shopAction, shopState } from '../shopState';
import { data } from '../state';
import { h } from './dom';
import { toast } from './toast';

const W = 640, H = 300;
const SHOP_W = 230, WIN_X = 55, WIN_W = 120;
const THROWS = 3;
/** Bottles thrown from the car land about here (throw early: they take ~0.65s). */
const LAND_X = 253;

interface Bomb { x: number; y: number; vx: number; vy: number; spin: number; done: boolean }
interface Fire { x: number; y: number; life: number; hit: boolean }

/**
 * A silly drive-by: your car rolls past at night, you lob flaming bottles at
 * the rival's window. Three throws; hits shut them for that many days.
 * Cartoon only: the shop is empty and the flames are mostly comic.
 */
export function openDriveBy(rivalId: string): void {
  const found = shopState.shop.rivals.find((r) => r.id === rivalId);
  if (!found) return;
  const rival = found;
  const canvas = h('canvas.driveby-canvas', { width: W * 2, height: H * 2 });
  const status = h('div.driveby-status', {}, `Throw just before the window reaches the dotted line. Tap THROW or press space. ${THROWS} bottles.`);
  const throwBtn = h('button.primary.big', { onclick: () => doThrow() }, '🔥 THROW');
  const close = h('button.ghost', { onclick: () => finish(true) }, 'Abort');
  const overlay = h('div.driveby', { role: 'dialog', 'aria-label': `Drive-by on ${rival.name}` },
    h('div.driveby-card', {},
      h('div.driveby-title', {}, h('b', {}, `Drive-by: ${rival.name}`), close),
      canvas, status, throwBtn),
  );
  document.body.append(overlay);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);

  let shopX = W + 160;
  const speed = 150;
  let left = THROWS;
  let hits = 0;
  const bombs: Bomb[] = [];
  const fires: Fire[] = [];
  const pops: { text: string; x: number; y: number; life: number; colour: string }[] = [];
  let last = performance.now();
  let ended = false;
  let raf = 0;
  const carX = 90, carY = 238;

  function doThrow(): void {
    if (left <= 0 || ended) return;
    left--;
    bombs.push({ x: carX + 30, y: carY - 30, vx: 200, vy: -260, spin: 0, done: false });
    throwBtn.textContent = left ? `🔥 THROW (${left})` : 'No bottles left';
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') { e.preventDefault(); doThrow(); }
    if (e.key === 'Escape') finish(true);
  };
  window.addEventListener('keydown', onKey);
  canvas.addEventListener('pointerdown', doThrow);

  function finish(aborted = false): void {
    if (ended && !aborted) return;
    ended = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    if (aborted && hits === 0 && left === THROWS) {
      overlay.remove();
      return;
    }
    const res = driveBy(shopState.shop, rivalId, hits, data);
    shopAction(() => res.shop, 'driveby');
    overlay.querySelector('.driveby-card')!.replaceChildren(
      h('div.driveby-result', {},
        h('div.big-emoji', {}, res.caught ? '🚓' : hits ? '🔥' : '💨'),
        h('h2', {}, hits === 3 ? 'Direct hits all round!' : hits ? `${hits} hit${hits === 1 ? '' : 's'}!` : 'Missed!'),
        h('p', {}, res.text),
        h('p.fine', {}, `Heat is now ${Math.round(res.shop.heat)}. ${rival.name} won't forget this.`),
        h('button.primary.big', { onclick: () => overlay.remove() }, res.caught ? 'Ugh. Fine.' : 'Drive home'),
      ),
    );
    toast(res.caught ? 'Busted after the drive-by!' : hits ? `${rival.name} is shut for ${hits} day${hits === 1 ? '' : 's'}.` : 'Missed everything.', res.caught ? 'info' : 'gold');
  }

  function drawShopFront(x: number): void {
    // Neighbours either side so you have to time it.
    ctx.fillStyle = '#2a2638';
    ctx.fillRect(x - 170, 70, 160, 150);
    ctx.fillRect(x + SHOP_W + 10, 80, 150, 140);
    ctx.fillStyle = '#ffd27a33';
    ctx.fillRect(x - 150, 110, 50, 40);
    ctx.fillRect(x + SHOP_W + 40, 115, 50, 40);
    // The rival shop.
    ctx.fillStyle = '#3a3248';
    ctx.fillRect(x, 60, SHOP_W, 160);
    ctx.fillStyle = rival.colour;
    ctx.fillRect(x, 60, SHOP_W, 34);
    ctx.fillStyle = '#111';
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(rival.name.toUpperCase(), x + SHOP_W / 2, 84);
    // Window (the target).
    ctx.fillStyle = '#9fd8ff55';
    ctx.fillRect(x + WIN_X, 110, WIN_W, 80);
    ctx.strokeStyle = '#d0ecff';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + WIN_X, 110, WIN_W, 80);
    ctx.fillStyle = '#fff6';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText('CLOSED', x + WIN_X + WIN_W / 2, 154);
  }

  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    shopX -= speed * dt;

    // Sky, moon, street.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d0b1a');
    g.addColorStop(1, '#241a3a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.arc(560, 40, 16, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = '#ffffff55';
      ctx.fillRect((i * 97 + 13) % W, (i * 53) % 60 + 5, 1.5, 1.5);
    }
    drawShopFront(shopX);
    ctx.fillStyle = '#2b2f40';
    ctx.fillRect(0, 220, W, 80);
    ctx.fillStyle = '#ffd96a';
    for (let x = (-shopX * 0.7) % 60; x < W; x += 60) ctx.fillRect(x + 60, 262, 30, 4);

    // Where bottles land: line it up with the window.
    ctx.strokeStyle = '#ffd96a88';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(LAND_X, 100); ctx.lineTo(LAND_X, 215); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd96a';
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('▼ lands here', LAND_X, 96);

    // Fires on the shop front.
    for (const f of fires) {
      f.life += dt;
      const fx = shopX + f.x;
      for (let k = 0; k < 6; k++) {
        const fl = Math.sin(now / 80 + k * 1.7) * 6;
        ctx.fillStyle = k % 2 ? '#ff7a1a' : '#ffd23a';
        ctx.beginPath();
        ctx.ellipse(fx + (k - 2.5) * 9, f.y - 10 - k * 3 + fl * 0.3, 8, 18 + fl, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Bottles in flight.
    for (const b of bombs) {
      if (b.done) continue;
      b.vy += 520 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.spin += dt * 14;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.spin);
      ctx.fillStyle = '#7ad46a';
      ctx.fillRect(-4, -9, 8, 18);
      ctx.fillStyle = '#ffb020';
      ctx.beginPath(); ctx.arc(0, -12, 4 + Math.random() * 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (b.y >= 150 && b.vy > 0) {
        b.done = true;
        const rel = b.x - shopX;
        const hit = rel >= WIN_X && rel <= WIN_X + WIN_W;
        if (hit) {
          hits++;
          fires.push({ x: rel, y: 190, life: 0, hit: true });
          pops.push({ text: ['WHOOMPH!', 'KA-BOOM!', 'FWOOSH!'][hits - 1] ?? 'BOOM!', x: b.x, y: 120, life: 0, colour: '#ffd23a' });
        } else {
          pops.push({ text: rel > -170 && rel < SHOP_W + 160 ? 'Wrong shop!' : 'Missed!', x: b.x, y: 150, life: 0, colour: '#a39fbb' });
        }
      }
    }

    // Your car (wobbly, of course).
    const bob = Math.sin(now / 90) * 1.5;
    ctx.fillStyle = '#3a6df0';
    ctx.beginPath();
    ctx.moveTo(carX - 50, carY + bob);
    ctx.lineTo(carX + 50, carY + bob);
    ctx.lineTo(carX + 46, carY - 20 + bob);
    ctx.lineTo(carX + 20, carY - 22 + bob);
    ctx.lineTo(carX + 6, carY - 40 + bob);
    ctx.lineTo(carX - 30, carY - 40 + bob);
    ctx.lineTo(carX - 46, carY - 20 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#9fd8ff';
    ctx.fillRect(carX - 24, carY - 36 + bob, 26, 14);
    ctx.fillStyle = '#111';
    for (const wx of [carX - 28, carX + 30]) {
      ctx.beginPath(); ctx.arc(wx, carY + 2, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#888';
      ctx.beginPath(); ctx.arc(wx, carY + 2, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
    }
    ctx.fillStyle = '#ff4fa3';
    ctx.beginPath(); ctx.arc(carX - 10, carY - 46 + bob, 7, 0, Math.PI * 2); ctx.fill();

    for (const p of pops) {
      p.life += dt;
      ctx.globalAlpha = Math.max(0, 1 - p.life / 1.2);
      ctx.fillStyle = p.colour;
      ctx.font = '900 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y - p.life * 30 - (pops.indexOf(p) % 3) * 24);
      ctx.globalAlpha = 1;
    }

    const msg = `Hits: ${hits} · bottles left: ${left}`;
    if (status.textContent !== msg) status.textContent = msg;
    const allLanded = bombs.every((b) => b.done);
    if (shopX < -SHOP_W - 200 || (left === 0 && allLanded && pops.every((p) => p.life > 0.8))) {
      finish();
      return;
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
}
