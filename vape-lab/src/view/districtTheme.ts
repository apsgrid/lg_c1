// How each district looks from inside your shop (or around your car).
import type { CityLocation } from '../sim';

export interface DistrictTheme {
  wall: string;
  floor: string;
  rug: string;
  neonA: string;
  neonB: string;
  ground: string;
  sky: string;
  /** Window view: sky colour at the top, street colour at the bottom. */
  view: [string, string];
  skyline: 'towers' | 'houses' | 'trees' | 'waves' | 'spire' | 'sheds' | 'stalls' | 'clubs';
}

const THEMES: Record<string, DistrictTheme> = {
  school: { wall: '#5a2e2a', floor: '#3a3530', rug: '#2f4a6a', neonA: '#ffd27a', neonB: '#7ad4ff', ground: '#3a3d33', sky: '#26314a', view: ['#8fc0ee', '#9cc488'], skyline: 'houses' },
  cbd: { wall: '#1f2a38', floor: '#3a4250', rug: '#24304a', neonA: '#9fd8ff', neonB: '#e8f4ff', ground: '#30343c', sky: '#161e2e', view: ['#2a3a5a', '#7c8cab'], skyline: 'towers' },
  neon_mile: { wall: '#1d1030', floor: '#1a1424', rug: '#4a1a4a', neonA: '#ff2fbf', neonB: '#7a4dff', ground: '#211a2c', sky: '#120a1e', view: ['#2a0a3a', '#ff4fa3'], skyline: 'clubs' },
  church: { wall: '#4a4440', floor: '#5a5048', rug: '#5a2a2a', neonA: '#ffd9a0', neonB: '#ffe8c4', ground: '#3a3a36', sky: '#26263a', view: ['#c9b98a', '#7a6a50'], skyline: 'spire' },
  uni: { wall: '#2a3a2e', floor: '#4a3a2a', rug: '#2a4a6a', neonA: '#9cff8a', neonB: '#ffd27a', ground: '#2e3a2c', sky: '#1e2a33', view: ['#8ac8ff', '#5a8a4a'], skyline: 'trees' },
  beach: { wall: '#2e5a5e', floor: '#b8a27a', rug: '#e8a05a', neonA: '#5ad7ff', neonB: '#ffcf5a', ground: '#bfa775', sky: '#2a5a7a', view: ['#5ab8ff', '#f0d79a'], skyline: 'waves' },
  industrial: { wall: '#3a3a3a', floor: '#55575a', rug: '#7a5a1a', neonA: '#ffb020', neonB: '#ff7a1a', ground: '#3a3a38', sky: '#2a2620', view: ['#6a6a70', '#8a7a6a'], skyline: 'sheds' },
  market: { wall: '#4a3020', floor: '#5a4030', rug: '#7a2a3a', neonA: '#ffcf8a', neonB: '#ff8a5a', ground: '#4a3a30', sky: '#2a2030', view: ['#ffb070', '#7a5a8a'], skyline: 'stalls' },
  suburbs: { wall: '#3a3448', floor: '#4a4038', rug: '#3a5a4a', neonA: '#ffd9a0', neonB: '#c69bff', ground: '#2f3a2c', sky: '#1e2440', view: ['#8ab0e0', '#6a9a5a'], skyline: 'houses' },
  mall: { wall: '#cfcbd6', floor: '#dedae2', rug: '#3a6df0', neonA: '#ffffff', neonB: '#5ad7ff', ground: '#5a5a64', sky: '#2a2a3a', view: ['#f4f2f8', '#bdb8c8'], skyline: 'towers' },
  hospital: { wall: '#bfdcd2', floor: '#d6e6e0', rug: '#3a8a7a', neonA: '#bfffe8', neonB: '#ffffff', ground: '#4a5a58', sky: '#1e2a33', view: ['#bfe0ff', '#d8ece4'], skyline: 'towers' },
};

export function themeFor(id: string | undefined): DistrictTheme {
  return THEMES[id ?? ''] ?? THEMES.suburbs;
}

/** A painted street view of the district for windows and backdrops. */
export function drawDistrictView(canvas: HTMLCanvasElement, loc: CityLocation | undefined, theme: DistrictTheme): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, theme.view[0]);
  g.addColorStop(1, theme.view[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Deterministic "random" from the location id.
  let seed = 0;
  for (const ch of loc?.id ?? 'x') seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const base = H * 0.72;
  ctx.fillStyle = 'rgba(20,18,30,0.55)';
  switch (theme.skyline) {
    case 'towers':
      for (let x = 0; x < W; x += W / 7) {
        const h = H * (0.25 + rnd() * 0.4);
        ctx.fillRect(x + 2, base - h, W / 7 - 6, h);
        ctx.fillStyle = 'rgba(255,240,180,0.5)';
        for (let wy = base - h + 8; wy < base - 6; wy += 12) for (let wx = x + 6; wx < x + W / 7 - 10; wx += 9) if (rnd() > 0.5) ctx.fillRect(wx, wy, 4, 5);
        ctx.fillStyle = 'rgba(20,18,30,0.55)';
      }
      break;
    case 'houses':
      for (let x = 0; x < W; x += W / 5) {
        const h = H * (0.12 + rnd() * 0.06);
        ctx.fillRect(x + 6, base - h, W / 5 - 12, h);
        ctx.beginPath(); ctx.moveTo(x + 2, base - h); ctx.lineTo(x + W / 10, base - h - H * 0.08); ctx.lineTo(x + W / 5 - 2, base - h); ctx.fill();
      }
      break;
    case 'trees':
      for (let x = 10; x < W; x += W / 6) {
        ctx.fillRect(x + 8, base - H * 0.08, 5, H * 0.08);
        ctx.beginPath(); ctx.arc(x + 10, base - H * 0.14, H * (0.06 + rnd() * 0.04), 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillRect(W * 0.3, base - H * 0.3, W * 0.4, H * 0.3);
      break;
    case 'waves':
      ctx.fillStyle = 'rgba(30,90,140,0.6)';
      ctx.fillRect(0, base - H * 0.12, W, H * 0.12);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      for (let y = base - H * 0.1; y < base; y += 8) {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 8) ctx.lineTo(x, y + Math.sin(x / 10 + y) * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath(); ctx.arc(W * 0.75, H * 0.22, H * 0.07, 0, Math.PI * 2); ctx.fill();
      break;
    case 'spire':
      ctx.fillRect(W * 0.35, base - H * 0.25, W * 0.3, H * 0.25);
      ctx.beginPath(); ctx.moveTo(W * 0.42, base - H * 0.25); ctx.lineTo(W * 0.5, base - H * 0.55); ctx.lineTo(W * 0.58, base - H * 0.25); ctx.fill();
      ctx.fillRect(W * 0.495, base - H * 0.64, 3, H * 0.1);
      ctx.fillRect(W * 0.47, base - H * 0.61, W * 0.06, 3);
      break;
    case 'sheds':
      for (let x = 0; x < W; x += W / 3) {
        const h = H * (0.14 + rnd() * 0.08);
        ctx.fillRect(x + 4, base - h, W / 3 - 8, h);
        ctx.fillRect(x + W / 6, base - h - H * 0.18, 6, H * 0.18);
      }
      break;
    case 'stalls':
      for (let x = 0; x < W; x += W / 4) {
        ctx.fillRect(x + 6, base - H * 0.12, W / 4 - 12, H * 0.12);
        ctx.fillStyle = ['#e85a5a', '#ffcf5a', '#5ad7ff', '#9cff8a'][Math.floor(rnd() * 4)];
        ctx.fillRect(x + 2, base - H * 0.17, W / 4 - 4, H * 0.05);
        ctx.fillStyle = 'rgba(20,18,30,0.55)';
      }
      break;
    case 'clubs':
      for (let x = 0; x < W; x += W / 4) {
        const h = H * (0.2 + rnd() * 0.15);
        ctx.fillRect(x + 4, base - h, W / 4 - 8, h);
        ctx.fillStyle = ['#ff2fbf', '#7a4dff', '#5ad7ff'][Math.floor(rnd() * 3)];
        ctx.fillRect(x + 10, base - h + 8, W / 4 - 20, 6);
        ctx.fillStyle = 'rgba(20,18,30,0.55)';
      }
      break;
  }
  ctx.fillStyle = 'rgba(20,18,30,0.75)';
  ctx.fillRect(0, base, W, H - base);
  ctx.font = `${Math.round(H * 0.12)}px system-ui, "Apple Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(loc?.icon ?? '', W / 2, base + (H - base) * 0.38);
  ctx.font = `700 ${Math.round(H * 0.055)}px system-ui, sans-serif`;
  ctx.fillStyle = '#ffffffcc';
  ctx.fillText(loc?.name ?? '', W / 2, base + (H - base) * 0.78);
}
