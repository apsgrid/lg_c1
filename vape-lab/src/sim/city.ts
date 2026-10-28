// The city: locations with gently different customer bases, police and rent.
import type { CustomerId } from './types';

export interface CityLocation {
  id: string;
  name: string;
  type: string;
  icon: string;
  x: number;                   // 0-100 map units
  y: number;
  blurb: string;
  mix: Partial<Record<CustomerId, number>>;
  footfall: number;            // ~0.85-1.15: small on purpose
  young: number;               // added to the tier's share of young-looking walk-ins
  minorShare: number;          // of young-looking walk-ins, how many are actually under 18
  police: number;              // 0-1 presence
  rent: number;                // store rent multiplier
}

export function distance(a: CityLocation | undefined, b: CityLocation | undefined): number {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Extra days a restock takes for a given haul distance (0 = next morning). */
export function haulDays(dist: number): number {
  return dist < 30 ? 0 : dist < 60 ? 1 : 2;
}
