import type { Profile, Tuning, TuningKey } from './types';

export const DEFAULT_TUNING: Tuning = {
  intensity: 50,
  cooling: 30,
  smoothness: 50,
  vapour: 50,
  dependence: 20,
};

export const TUNING_LABELS: Record<TuningKey, string> = {
  intensity: 'Intensity',
  cooling: 'Cooling',
  smoothness: 'Smoothness',
  vapour: 'Vapour',
  dependence: 'Dependence rating',
};

/** Applies tuning to a raw formula profile. Mutates nothing; returns a copy. */
export function applyTuning(raw: Profile, t: Tuning): Profile {
  const p = { ...raw };
  // Intensity scales the flavour attributes up or down.
  const f = 0.75 + t.intensity / 200;
  p.sweetness *= f;
  p.tartness *= f;
  p.richness *= f;
  // Cooling dial pushes the cooling attribute around a neutral 30.
  p.cooling += (t.cooling - 30) * 0.5;
  // Smoothness rounds off edges: a little less complexity and tartness, a bit more balance.
  p.complexity -= t.smoothness * 0.08;
  p.tartness -= t.smoothness * 0.1;
  p.balance += (t.smoothness - 40) * 0.15;
  return p;
}

export interface TradeOff {
  key: TuningKey;
  text: string;
  tone: 'good' | 'bad' | 'mixed';
}

/** Plain-language trade-offs for the current tuning, shown next to the dials. */
export function describeTradeOffs(t: Tuning): TradeOff[] {
  const out: TradeOff[] = [];
  if (t.intensity >= 70) out.push({ key: 'intensity', text: 'Enthusiasts love the punch; casual buyers find it harsh.', tone: 'mixed' });
  else if (t.intensity <= 30) out.push({ key: 'intensity', text: 'Gentle and approachable, but enthusiasts call it faint.', tone: 'mixed' });
  if (t.cooling >= 75) out.push({ key: 'cooling', text: 'Ice Fans rejoice; most others drop past the chill threshold.', tone: 'mixed' });
  if (t.smoothness >= 70) out.push({ key: 'smoothness', text: 'Raises casual appeal; slightly flattens complexity.', tone: 'good' });
  else if (t.smoothness <= 25) out.push({ key: 'smoothness', text: 'Rough edges: casual buyers notice.', tone: 'bad' });
  if (t.vapour >= 70) out.push({ key: 'vapour', text: 'Big clouds please Ice Fans; costs a little more per unit.', tone: 'mixed' });
  if (t.dependence >= 40) out.push({ key: 'dependence', text: 'More repeat purchases, but reputation risk climbs fast.', tone: 'bad' });
  return out;
}
