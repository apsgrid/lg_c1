import { deriveSeed, mulberry32, rngRange } from './rng';
import { matchSynergies } from './synergy';
import { applyTuning } from './tuning';
import {
  FAMILIES, NOTE_ATTRS, PROFILE_KEYS, STRONG_NOTE_AMOUNT,
  type Family, type GameData, type NoteDef, type NoteId, type Product, type Profile, type ProfileResult,
} from './types';
import { clamp, round1 } from './util';

export function emptyProfile(): Profile {
  return { sweetness: 0, tartness: 0, cooling: 0, richness: 0, complexity: 0, balance: 0, originality: 0 };
}

export function activeNotes(product: Product, data: GameData): { def: NoteDef; amount: number }[] {
  const out: { def: NoteDef; amount: number }[] = [];
  for (const slot of product.notes) {
    const def = data.notes.find((n) => n.id === slot.noteId);
    if (def && slot.amount > 0) out.push({ def, amount: slot.amount });
  }
  return out;
}

export function findClashes(product: Product, data: GameData): [NoteId, NoteId][] {
  const notes = activeNotes(product, data);
  const clashes: [NoteId, NoteId][] = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const a = notes[i].def;
      const b = notes[j].def;
      if (a.clashesWith.includes(b.id) || b.clashesWith.includes(a.id)) clashes.push([a.id, b.id]);
    }
  }
  return clashes;
}

/** Formula + base + tuning + hidden synergies -> the 7 profile attributes. */
export function computeProfile(product: Product, data: GameData): ProfileResult {
  const notes = activeNotes(product, data);
  const base = data.bases.find((b) => b.id === product.base);
  const total = notes.reduce((s, n) => s + n.amount, 0);
  const familyShare = Object.fromEntries(FAMILIES.map((f) => [f, 0])) as Record<Family, number>;
  const p = emptyProfile();

  // 1. Weighted note attributes. Under 100 total points the mix is weaker.
  const denom = Math.max(total, 100);
  for (const { def, amount } of notes) {
    for (const attr of NOTE_ATTRS) p[attr] += (def.weights[attr] * amount) / denom;
    familyShare[def.family] += total > 0 ? (amount / total) * 100 : 0;
  }

  // 2. Variety adds complexity.
  const families = new Set(notes.map((n) => n.def.family)).size;
  if (notes.length > 0) p.complexity += (notes.length - 1) * 5 + Math.max(0, families - 1) * 4;

  // 3. Balance: start healthy, then penalise clutter, clashes and thinness.
  const strongNotes = notes.filter((n) => n.amount >= STRONG_NOTE_AMOUNT).length;
  const clashes = findClashes(product, data);
  p.balance = notes.length === 0 ? 40 : 72;
  p.balance -= Math.max(0, strongNotes - 3) * 14;
  p.balance -= clashes.length * 12;
  if (total < 40) p.balance -= (40 - total) * 0.4;
  if (total > 250) p.balance -= (total - 250) * 0.1;

  // 4. Originality: rarer notes and unusual family mixes stand out.
  if (total > 0) {
    const avgCommon = notes.reduce((s, n) => s + n.def.commonness * n.amount, 0) / total;
    p.originality = (100 - avgCommon) * 0.9 + Math.max(0, families - 1) * 6;
  }

  // 5. Base offsets.
  if (base) for (const k of PROFILE_KEYS) p[k] += base.offsets[k] ?? 0;

  // 6. Tuning.
  const tuned = applyTuning(p, product.tuning);

  // 7. Hidden synergies.
  const { active, faint } = matchSynergies(product, data);
  for (const id of active) {
    const syn = data.synergies.find((s) => s.id === id);
    if (syn) for (const k of PROFILE_KEYS) tuned[k] += syn.bonus[k] ?? 0;
  }

  // 8. Tiny deterministic batch variance from the seed.
  const rng = mulberry32(deriveSeed(product.seed, 'profile'));
  if (notes.length > 0) tuned.originality += rngRange(rng, -2, 2);

  for (const k of PROFILE_KEYS) tuned[k] = round1(clamp(tuned[k]));
  for (const f of FAMILIES) familyShare[f] = round1(familyShare[f]);

  return { profile: tuned, activeSynergies: active, faintSynergies: faint, clashes, strongNotes, familyShare };
}
