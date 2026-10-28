import type { Brand, GameData, Logo, NoteSlot } from '../sim/types';

export function drawLogo(ctx: CanvasRenderingContext2D, logo: Logo, cx: number, cy: number, r: number, colour: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineWidth = r * 0.16;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (logo) {
    case 'drop':
      ctx.moveTo(0, -r);
      ctx.bezierCurveTo(r * 0.9, -r * 0.1, r * 0.8, r, 0, r);
      ctx.bezierCurveTo(-r * 0.8, r, -r * 0.9, -r * 0.1, 0, -r);
      ctx.fill();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r : r * 0.45;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 'leaf':
      ctx.moveTo(-r * 0.8, r * 0.8);
      ctx.quadraticCurveTo(-r, -r, r * 0.8, -r * 0.8);
      ctx.quadraticCurveTo(r, r, -r * 0.8, r * 0.8);
      ctx.fill();
      break;
    case 'bolt':
      ctx.moveTo(r * 0.2, -r);
      ctx.lineTo(-r * 0.6, r * 0.15);
      ctx.lineTo(-r * 0.05, r * 0.15);
      ctx.lineTo(-r * 0.25, r);
      ctx.lineTo(r * 0.6, -r * 0.2);
      ctx.lineTo(r * 0.05, -r * 0.2);
      ctx.closePath();
      ctx.fill();
      break;
    case 'crown':
      ctx.moveTo(-r, r * 0.6);
      ctx.lineTo(-r, -r * 0.5);
      ctx.lineTo(-r * 0.5, 0);
      ctx.lineTo(0, -r * 0.8);
      ctx.lineTo(r * 0.5, 0);
      ctx.lineTo(r, -r * 0.5);
      ctx.lineTo(r, r * 0.6);
      ctx.closePath();
      ctx.fill();
      break;
    case 'wave':
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(-r, k * r * 0.5);
        ctx.bezierCurveTo(-r * 0.5, k * r * 0.5 - r * 0.35, 0, k * r * 0.5 + r * 0.35, r * 0.5, k * r * 0.5);
        ctx.quadraticCurveTo(r * 0.75, k * r * 0.5 - r * 0.15, r, k * r * 0.5);
      }
      ctx.stroke();
      break;
    case 'heart':
      ctx.moveTo(0, r * 0.9);
      ctx.bezierCurveTo(-r * 1.3, 0, -r * 0.7, -r * 1.1, 0, -r * 0.35);
      ctx.bezierCurveTo(r * 0.7, -r * 1.1, r * 1.3, 0, 0, r * 0.9);
      ctx.fill();
      break;
    case 'circle':
      ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

const STYLE_FONT: Record<Brand['style'], string> = {
  classic: '700 {s}px Georgia, "Times New Roman", serif',
  minimal: '300 {s}px "Helvetica Neue", Arial, sans-serif',
  neon: '800 {s}px "Trebuchet MS", Arial, sans-serif',
  retro: 'italic 800 {s}px "Courier New", monospace',
  luxe: '400 {s}px "Didot", "Bodoni MT", Georgia, serif',
};

/** Draws the packaging label. Used for the 3D texture and the branding preview. */
export function drawLabel(canvas: HTMLCanvasElement, brand: Brand, notes: NoteSlot[], data: GameData): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const c = brand.labelColour;
  const ink = luminance(c) > 0.55 ? '#1a1a22' : '#ffffff';
  ctx.clearRect(0, 0, W, H);

  // Background per style.
  if (brand.style === 'neon') {
    ctx.fillStyle = '#0c0b16';
    ctx.fillRect(0, 0, W, H);
    ctx.shadowColor = c;
    ctx.shadowBlur = 24;
    ctx.strokeStyle = c;
    ctx.lineWidth = 10;
    ctx.strokeRect(18, 18, W - 36, H - 36);
    ctx.shadowBlur = 0;
  } else if (brand.style === 'luxe') {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#111');
    g.addColorStop(1, '#2a2418');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#d8b56a';
    ctx.lineWidth = 4;
    ctx.strokeRect(22, 22, W - 44, H - 44);
    ctx.strokeRect(32, 32, W - 64, H - 64);
  } else if (brand.style === 'retro') {
    ctx.fillStyle = '#f4ead2';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? c : '#f4ead2';
      ctx.fillRect(0, H * 0.62 + i * 14, W, 14);
    }
  } else if (brand.style === 'minimal') {
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = c;
    ctx.fillRect(0, H - 24, W, 24);
  } else {
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.strokeRect(16, 16, W - 32, H - 32);
    ctx.globalAlpha = 1;
  }

  const textColour = brand.style === 'neon' ? c
    : brand.style === 'luxe' ? '#e8cc8a'
      : brand.style === 'retro' || brand.style === 'minimal' ? '#1d1b22'
        : ink;
  const logoColour = brand.style === 'minimal' || brand.style === 'retro' ? c : textColour;

  drawLogo(ctx, brand.logo, W / 2, H * 0.27, W * 0.13, logoColour);

  // Brand name, shrunk to fit.
  const name = (brand.name || 'Untitled').toUpperCase();
  let size = 64;
  const font = (s: number) => STYLE_FONT[brand.style].replace('{s}', String(s));
  ctx.font = font(size);
  while (ctx.measureText(name).width > W * 0.84 && size > 18) ctx.font = font(--size);
  ctx.fillStyle = textColour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (brand.style === 'neon') {
    ctx.shadowColor = c;
    ctx.shadowBlur = 18;
  }
  ctx.fillText(name, W / 2, H * 0.5);
  ctx.shadowBlur = 0;

  // Note chips.
  const active = notes.filter((n) => n.amount > 0);
  const chipW = 36, gap = 12;
  const startX = W / 2 - ((active.length * chipW + (active.length - 1) * gap) / 2);
  active.forEach((n, i) => {
    const def = data.notes.find((d) => d.id === n.noteId);
    ctx.fillStyle = def?.colour ?? '#888';
    ctx.beginPath();
    ctx.arc(startX + i * (chipW + gap) + chipW / 2, H * 0.68, chipW / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = textColour;
    ctx.stroke();
  });

  ctx.font = font(22);
  ctx.globalAlpha = 0.85;
  ctx.fillText(`${brand.tier.toUpperCase()} · ${brand.price.toFixed(1)} cr`, W / 2, H * 0.84);
  ctx.globalAlpha = 1;
}
