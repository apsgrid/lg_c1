// Commissions: a regular asks for a bespoke flavour by a deadline. Briefs are
// judged with the same profile + customer scoring the Lab's test panel uses.
import { computeProfile } from './profile';
import { rngPick, type Rng } from './rng';
import { runTest } from './test';
import type { CustomerId, Family, Format, GameData, Product, ProfileKey, TuningKey } from './types';
import { clamp, round1 } from './util';

export type Want =
  | { kind: 'stat'; key: ProfileKey; min?: number; max?: number; label: string }
  | { kind: 'tuning'; key: TuningKey; min?: number; max?: number; label: string }
  | { kind: 'note'; noteId: string; label: string }
  | { kind: 'family'; family: Family; min: number; label: string }
  | { kind: 'price'; max: number; label: string }
  | { kind: 'format'; format: Format; label: string };

export type CommissionStatus = 'open' | 'ready' | 'delivered' | 'failed' | 'cancelled';

export interface Commission {
  id: string;
  regularId: string;
  regularName: string;
  archetype: CustomerId;
  text: string;
  wants: Want[];
  createdDay: number;
  dueDay: number;
  status: CommissionStatus;
  product?: Product;
  score?: number;
  deliveredDay?: number;
}

/** Score needed for a delighted customer (loyalty, tip, a friend, a signature product). */
export const COMMISSION_GREAT = 75;
/** Below this they're disappointed. */
export const COMMISSION_OK = 50;

const OCCASIONS = [
  'It\'s my partner\'s birthday on day {due}',
  'My mate\'s leaving do is on day {due}',
  'We\'ve got a festival weekend starting day {due}',
  'It\'s our anniversary on day {due}',
  'I finish a massive job on day {due} and want to celebrate',
  'My sister\'s visiting on day {due} and she\'s fussy',
];

const BY_ARCHETYPE: Record<string, Want[][]> = {
  fruit_fanatic: [
    [{ kind: 'family', family: 'fruit', min: 50, label: 'mostly fruit' }],
    [{ kind: 'stat', key: 'sweetness', min: 50, label: 'properly sweet' }, { kind: 'family', family: 'fruit', min: 40, label: 'fruity' }],
  ],
  anti_sweet: [
    [{ kind: 'stat', key: 'sweetness', max: 35, label: 'not too sweet' }],
    [{ kind: 'stat', key: 'sweetness', max: 40, label: 'not sugary' }, { kind: 'stat', key: 'complexity', min: 45, label: 'something with depth' }],
  ],
  ice_fan: [
    [{ kind: 'stat', key: 'cooling', min: 55, label: 'really icy' }],
    [{ kind: 'stat', key: 'cooling', min: 50, label: 'cold' }, { kind: 'tuning', key: 'vapour', min: 60, label: 'big clouds' }],
  ],
  novelty_seeker: [
    [{ kind: 'stat', key: 'originality', min: 55, label: 'something nobody else has' }],
    [{ kind: 'stat', key: 'originality', min: 50, label: 'unusual' }, { kind: 'stat', key: 'complexity', min: 50, label: 'lots going on' }],
  ],
  budget_buyer: [
    [{ kind: 'price', max: 10, label: '10 credits or less' }],
    [{ kind: 'price', max: 12, label: 'cheap' }, { kind: 'format', format: 'disposable', label: 'a disposable' }],
  ],
  brand_loyalist: [
    [{ kind: 'stat', key: 'balance', min: 65, label: 'smooth and well-rounded' }],
    [{ kind: 'stat', key: 'originality', max: 45, label: 'nothing weird' }, { kind: 'tuning', key: 'smoothness', min: 60, label: 'smooth' }],
  ],
};

function phrase(wants: Want[]): string {
  const labels = wants.map((w) => (w.kind === 'note' ? `it has to have ${w.label} in it` : w.label));
  if (labels.length === 1) return `Something ${labels[0]}.`;
  return `Something ${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}.`.replace('Something it has', 'It has');
}

/** Build a brief for a regular. Pure given the rng. */
export function makeBrief(archetype: CustomerId, data: GameData, rng: Rng, dueDay: number): { text: string; wants: Want[] } {
  const wants: Want[] = [...rngPick(rng, BY_ARCHETYPE[archetype] ?? BY_ARCHETYPE.brand_loyalist)];
  // A personal twist: a note they love.
  const note = rngPick(rng, data.notes.filter((n) => !(archetype === 'anti_sweet' && n.weights.sweetness > 75)));
  wants.push({ kind: 'note', noteId: note.id, label: note.name.toLowerCase() });
  const occasion = rngPick(rng, OCCASIONS).replace('{due}', String(dueDay));
  return { text: `${occasion}. ${phrase(wants)}`, wants };
}

function partialMin(v: number, min: number): number {
  return v >= min ? 1 : clamp(1 - (min - v) / 25, 0, 1);
}
function partialMax(v: number, max: number): number {
  return v <= max ? 1 : clamp(1 - (v - max) / 25, 0, 1);
}

export interface WantCheck {
  label: string;
  met: boolean;
  credit: number;              // 0-1
  detail: string;
}

/** How well a product meets a brief: per-want checks plus an overall 0-100 score. */
export function scoreCommission(wants: Want[], archetype: CustomerId, product: Product, data: GameData): { score: number; checks: WantCheck[]; customerScore: number } {
  const pr = computeProfile(product, data);
  const p = pr.profile;
  const total = product.notes.reduce((s, n) => s + n.amount, 0);
  const checks: WantCheck[] = wants.map((w) => {
    switch (w.kind) {
      case 'stat': {
        const v = p[w.key];
        const c = w.min !== undefined ? partialMin(v, w.min) : partialMax(v, w.max ?? 100);
        return { label: w.label, met: c >= 1, credit: c, detail: `${w.key} ${Math.round(v)} (${w.min !== undefined ? `needs ${w.min}+` : `needs ${w.max} or less`})` };
      }
      case 'tuning': {
        const v = product.tuning[w.key];
        const c = w.min !== undefined ? partialMin(v, w.min) : partialMax(v, w.max ?? 100);
        return { label: w.label, met: c >= 1, credit: c, detail: `${w.key} dial ${Math.round(v)} (${w.min !== undefined ? `needs ${w.min}+` : `needs ${w.max} or less`})` };
      }
      case 'note': {
        const amt = product.notes.find((n) => n.noteId === w.noteId)?.amount ?? 0;
        const c = amt >= 15 ? 1 : amt > 0 ? 0.5 : 0;
        return { label: w.label, met: c >= 1, credit: c, detail: amt ? `${amt} pts (needs 15+)` : 'missing' };
      }
      case 'family': {
        const v = pr.familyShare[w.family];
        const c = partialMin(v, w.min);
        return { label: w.label, met: c >= 1, credit: c, detail: `${Math.round(v)}% ${w.family} (needs ${w.min}%+)` };
      }
      case 'price': {
        const c = partialMax(product.brand.price, w.max) ** 2;
        return { label: w.label, met: product.brand.price <= w.max, credit: c, detail: `priced ${product.brand.price} cr` };
      }
      case 'format': {
        const ok = (product.brand.format ?? 'refillable') === w.format;
        return { label: w.label, met: ok, credit: ok ? 1 : 0, detail: ok ? w.format : `currently ${product.brand.format ?? 'refillable'}` };
      }
    }
  });
  const reqScore = checks.reduce((s, c) => s + c.credit, 0) / Math.max(1, checks.length);
  const customerScore = total > 0 ? runTest(product, data).reactions.find((r) => r.customerId === archetype)?.score ?? 0 : 0;
  const score = total > 0 ? round1(clamp(reqScore * 65 + customerScore * 0.35)) : 0;
  return { score, checks, customerScore };
}
