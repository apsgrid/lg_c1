import { PROFILE_KEYS, type Profile } from '../sim/types';

const LABELS: Record<keyof Profile, string> = {
  sweetness: 'Sweet', tartness: 'Tart', cooling: 'Cool', richness: 'Rich',
  complexity: 'Complex', balance: 'Balance', originality: 'Original',
};

/** Live 7-axis radar chart on a canvas. Eases toward the target profile. */
export class RadarChart {
  readonly canvas = document.createElement('canvas');
  private current: number[] = PROFILE_KEYS.map(() => 0);
  private target: number[] = PROFILE_KEYS.map(() => 0);
  private ghost: number[] | null = null;
  private raf = 0;

  constructor(private size = 260) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.canvas.className = 'radar';
    this.canvas.setAttribute('role', 'img');
    this.canvas.getContext('2d')!.scale(dpr, dpr);
  }

  set(profile: Profile, ghost?: Profile | null): void {
    this.target = PROFILE_KEYS.map((k) => profile[k]);
    this.ghost = ghost ? PROFILE_KEYS.map((k) => ghost[k]) : null;
    this.canvas.setAttribute('aria-label', PROFILE_KEYS.map((k) => `${LABELS[k]} ${Math.round(profile[k])}`).join(', '));
    if (!this.raf) this.raf = requestAnimationFrame(() => this.step());
  }

  private step(): void {
    let moving = false;
    this.current = this.current.map((v, i) => {
      const d = this.target[i] - v;
      if (Math.abs(d) > 0.2) moving = true;
      return v + d * 0.18;
    });
    this.draw();
    this.raf = moving ? requestAnimationFrame(() => this.step()) : 0;
  }

  private point(i: number, v: number, r: number, c: number): [number, number] {
    const a = -Math.PI / 2 + (i / PROFILE_KEYS.length) * Math.PI * 2;
    return [c + Math.cos(a) * r * (v / 100), c + Math.sin(a) * r * (v / 100)];
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d')!;
    const s = this.size, c = s / 2, r = s / 2 - 42;
    const css = getComputedStyle(document.documentElement);
    const grid = css.getPropertyValue('--grid').trim() || '#444';
    const ink = css.getPropertyValue('--muted').trim() || '#aaa';
    const accent = css.getPropertyValue('--accent').trim() || '#ff4fa3';
    ctx.clearRect(0, 0, s, s);

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (const ring of [25, 50, 75, 100]) {
      ctx.beginPath();
      PROFILE_KEYS.forEach((_, i) => ctx.lineTo(...this.point(i, ring, r, c)));
      ctx.closePath();
      ctx.stroke();
    }
    PROFILE_KEYS.forEach((k, i) => {
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(...this.point(i, 100, r, c));
      ctx.stroke();
      const [x, y] = this.point(i, 120, r, c);
      ctx.fillStyle = ink;
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(LABELS[k], x, y);
    });

    if (this.ghost) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = ink;
      ctx.beginPath();
      this.ghost.forEach((v, i) => ctx.lineTo(...this.point(i, v, r, c)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    this.current.forEach((v, i) => ctx.lineTo(...this.point(i, v, r, c)));
    ctx.closePath();
    ctx.fillStyle = `${accent}44`;
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    this.current.forEach((v, i) => {
      ctx.beginPath();
      ctx.arc(...this.point(i, v, r, c), 3, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
    });
  }
}
