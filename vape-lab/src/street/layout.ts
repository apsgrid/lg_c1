// The street both runs drive down (Paperboy-style firebombing and the Night Round),
// laid out in the run's own units: x across the road (+ right), y along it, z up.
// Shared by the 2D run (src/ui/driveby.ts) and the 3D street (src/view/streetScene.ts).
import type { NightOrder } from '../sim';
import type { DistrictTheme } from '../view/districtTheme';

export type Rng = () => number;
export const FACADE = -110;        // building fronts, left side
export const KERB = 62;            // road half-width
export const LANE = 46;            // how far the car can steer either side
export const CAR_W = 14, CAR_L = 26;
/** Metres per run unit, for the 3D street (a car is about 4 m long). */
export const METRES = 0.075;

export type Mode = 'firebomb' | 'delivery';
export type Style = DistrictTheme['skyline'];
export interface Win { y0: number; y1: number; z0: number; z1: number; lit: number }
export interface Lot {
  y0: number; y1: number; depth: number; hgt: number;
  kind: 'rival' | 'shop' | 'house' | 'flats';
  wall: string; roof: string;
  sign?: string; signColour?: string; neon?: boolean;
  windows: Win[];
  burning: number;          // seconds since lit, -1 = not burning
  order?: NightOrder;
  delivered?: boolean;
}
export type ThingKind = 'cone' | 'bin' | 'parked' | 'oncoming' | 'dog' | 'cat' | 'crate' | 'police' | 'roadworks';
export interface Thing { kind: ThingKind; x: number; y: number; w: number; l: number; vx: number; vy: number; done: boolean; colour: string; t: number; chasing: number }
export interface StreetTargets { mode: Mode; rivalName?: string; rivalColour?: string; orders?: NightOrder[] }

export const SHOP_NAMES: Record<Style, string[]> = {
  towers: ['Sandwich Bar', 'Coffee Co.', 'Dry Cleaner', 'Phone Repair', 'Bank', 'Print Shop'],
  houses: ['Corner Shop', 'Launderette', 'Chippy', 'Bakery', 'Barber', 'Newsagent'],
  trees: ['Bookshop', 'Copy Shop', 'Noodle Bar', 'Bike Repair', 'Cafe', 'Records'],
  waves: ['Ice Cream', 'Surf Shop', 'Arcade', 'Fish & Chips', 'Rock Shop', 'Deckchairs'],
  spire: ['Florist', 'Tea Room', 'Charity Shop', 'Post Office', 'Bakery', 'Butcher'],
  sheds: ['Unit 3', 'Tyres', 'Scrap Metal', 'Trade Depot', 'Burger Van', 'Car Wash'],
  stalls: ['Fruit & Veg', 'Fabrics', 'Cheese', 'Market Cafe', 'Pound Shop', 'Butcher'],
  clubs: ['Club Nova', 'Bar 54', 'Karaoke', 'Late Bar', 'Kebab House', 'Cocktails'],
};
export const AWNINGS = ['#e85a5a', '#3a8a5a', '#d9a03a', '#3a6db0', '#8a4ab0', '#c0603a'];
export const CAR_COLOURS = ['#c94a4a', '#e0c04a', '#4ab07a', '#d0d0d8', '#7a5ad0', '#2a2a34'];

export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 7), 16), pb = parseInt(b.slice(1, 7), 16);
  const ch = [16, 8, 0].map((sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}


function neutralLot(y: number, i: number, style: Style, theme: DistrictTheme, rng: Rng): Lot {
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
  const r = rng();
  const shopShare = { towers: 0.4, houses: 0.35, trees: 0.4, waves: 0.5, spire: 0.35, sheds: 0.7, stalls: 0.75, clubs: 0.7 }[style];
  const flatsShare = { towers: 0.5, houses: 0.15, trees: 0.25, waves: 0.15, spire: 0.1, sheds: 0.1, stalls: 0.1, clubs: 0.3 }[style];
  const walls = ['#4a3a34', '#3a4048', '#4a4436', '#3e3448'].map((w) => mix(w, theme.wall, 0.45));
  const len = 110 + Math.round(rng() * 110);
  if (r < shopShare) {
    const neon = style === 'clubs';
    return {
      y0: y, y1: y + len, depth: 110, hgt: style === 'sheds' ? 70 : 82, kind: 'shop', wall: walls[i % 4], roof: '#25222c',
      sign: pick(SHOP_NAMES[style]), signColour: neon ? pick([theme.neonA, theme.neonB, '#5ad7ff']) : style === 'sheds' ? '#6a6a70' : pick(AWNINGS), neon, burning: -1,
      windows: [{ y0: 16, y1: len - 46, z0: 12, z1: 50, lit: -1 }],
    };
  }
  if (r < shopShare + flatsShare) {
    const tall = style === 'towers' ? 3 + Math.floor(rng() * 2) : 3;
    const windows: Win[] = [];
    for (let row = 0; row < tall; row++) for (let u = 12; u + 24 < len - 8; u += 38) windows.push({ y0: u, y1: u + 24, z0: 14 + row * 42, z1: 38 + row * 42, lit: -1 });
    return { y0: y, y1: y + len, depth: 140, hgt: 10 + tall * 42, kind: 'flats', wall: mix('#34384a', theme.wall, 0.4), roof: '#22242e', burning: -1, windows };
  }
  return houseLot(y, len, i, theme);
}

export function houseLot(y: number, len: number, i: number, theme: DistrictTheme): Lot {
  const windows: Win[] = [];
  for (let u = 14; u + 28 < len - 44; u += 46) windows.push({ y0: u, y1: u + 28, z0: 34, z1: 58, lit: -1 });
  const walls = ['#5a4038', '#4a4a56', '#5a5046', '#3a4a44'].map((w) => mix(w, theme.wall, 0.3));
  return { y0: y, y1: y + len, depth: 100, hgt: 74, kind: 'house', wall: walls[i % 4], roof: '#3a2a2a', burning: -1, windows };
}

/** Lay out the street: targets every few lots, neighbours in between. Returns the lots and where the street ends. */
export function buildStreet(cfg: StreetTargets, style: Style, theme: DistrictTheme, rng: Rng = Math.random): { lots: Lot[]; end: number } {
  const lots: Lot[] = [];
  const targets = cfg.mode === 'firebomb'
    ? [cfg.rivalName!, `${cfg.rivalName} Express`, `${cfg.rivalName} Outlet`, `${cfg.rivalName} Depot`].map((name) => ({ name }))
    : (cfg.orders ?? []).map((order) => ({ order }));
  const every = cfg.mode === 'firebomb' ? 4 : 3;
  let y = 140, i = 0, k = 0;
  while (k < targets.length || i < 3 + (targets.length - 1) * every + 3) {
    let lot: Lot;
    const t = i >= 3 && (i - 3) % every === 0 && k < targets.length ? targets[k++] : null;
    if (t && 'name' in t) {
      const len = 200;
      lot = {
        y0: y, y1: y + len, depth: 120, hgt: 96, kind: 'rival', wall: '#2a2436', roof: '#1c1826',
        sign: t.name.toUpperCase(), signColour: cfg.rivalColour ?? '#ff5a5a', burning: -1,
        windows: [{ y0: 22, y1: len - 62, z0: 10, z1: 58, lit: -1 }],
      };
    } else if (t && 'order' in t) {
      lot = { ...houseLot(y, 170, i, theme), order: t.order };
    } else lot = neutralLot(y, i, style, theme, rng);
    lots.push(lot);
    y = lot.y1 + (rng() < 0.3 ? 40 + rng() * 50 : 6);
    i++;
  }
  return { lots, end: y + 200 };
}

export function buildTraffic(end: number, police: number, rng: Rng = Math.random): Thing[] {
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
  const things: Thing[] = [];
  const add = (kind: ThingKind, x: number, y: number, w: number, l: number, extra: Partial<Thing> = {}) =>
    things.push({ kind, x, y, w, l, vx: 0, vy: 0, done: false, colour: '#888', t: 0, chasing: 0, ...extra });
  const lane = () => (rng() * 2 - 1) * 36;
  const pPolice = 0.03 + police * 0.12;
  const oncomingSpeed = -(100 + police * 80);
  for (let y = 420; y < end - 180; y += 170 + rng() * 110) {
    const r = rng();
    if (r < pPolice) add('police', 48, y, 26, 52, { colour: '#e8e8f0' });
    else if (r < 0.2) add('cone', lane(), y, 10, 10);
    else if (r < 0.33) add('bin', lane(), y, 14, 14, { colour: rng() < 0.5 ? '#2f7a4a' : '#3a4a8a' });
    else if (r < 0.48) add('parked', rng() < 0.5 ? -48 : 48, y, 26, 52, { colour: pick(CAR_COLOURS) });
    else if (r < 0.66) add('oncoming', 30, y + 260, 26, 52, { vy: oncomingSpeed, colour: pick(CAR_COLOURS) });
    else if (r < 0.78) add('dog', 120, y, 10, 16);
    else if (r < 0.88) add('cat', -86, y, 8, 12, { vx: 55 });
    else add('roadworks', lane() * 0.6, y, 34, 8);
  }
  for (let y = 1150; y < end - 300; y += 1050) add('crate', lane(), y, 16, 16);
  return things;
}

