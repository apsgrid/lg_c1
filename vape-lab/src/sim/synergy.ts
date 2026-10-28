import type { GameData, Product, SynergyDef, SynergyId } from './types';

/** Minimum game points per requirement for a synergy to fully fire. */
export const SYNERGY_ACTIVE_MIN = 15;
/** Minimum for a faint "something's there" hint. */
export const SYNERGY_FAINT_MIN = 4;

function tokenMet(token: string, product: Product, data: GameData, minAmount: number): boolean {
  if (token.startsWith('base:')) return product.base === token.slice(5);
  const present = product.notes.filter((n) => n.amount >= minAmount);
  if (token.startsWith('tag:')) {
    const tag = token.slice(4);
    return present.some((slot) => {
      const def = data.notes.find((d) => d.id === slot.noteId);
      if (!def) return false;
      if (tag === 'tart') return def.weights.tartness >= 50;
      if (tag === 'cool') return def.weights.cooling >= 50;
      return false;
    });
  }
  return present.some((n) => n.noteId === token);
}

export function requirementMet(req: string, product: Product, data: GameData, minAmount: number): boolean {
  return req.split('|').some((token) => tokenMet(token.trim(), product, data, minAmount));
}

export function matchSynergies(product: Product, data: GameData): { active: SynergyId[]; faint: SynergyId[] } {
  const active: SynergyId[] = [];
  const faint: SynergyId[] = [];
  for (const syn of data.synergies) {
    if (syn.needs.every((r) => requirementMet(r, product, data, SYNERGY_ACTIVE_MIN))) active.push(syn.id);
    else if (syn.needs.every((r) => requirementMet(r, product, data, SYNERGY_FAINT_MIN))) faint.push(syn.id);
  }
  return { active, faint };
}

/** How many of a synergy's requirements the product currently meets. */
export function synergyProgress(syn: SynergyDef, product: Product, data: GameData): number {
  return syn.needs.filter((r) => requirementMet(r, product, data, SYNERGY_ACTIVE_MIN)).length;
}

/** Human-readable label for one requirement token, e.g. "Mint or Menthol/Ice base". */
export function describeRequirement(req: string, data: GameData): string {
  return req.split('|').map((token) => {
    if (token.startsWith('base:')) {
      const b = data.bases.find((x) => x.id === token.slice(5));
      return `${b?.name ?? token.slice(5)} base`;
    }
    if (token === 'tag:tart') return 'a tart note';
    if (token === 'tag:cool') return 'a cooling note';
    return data.notes.find((n) => n.id === token)?.name ?? token;
  }).join(' or ');
}
