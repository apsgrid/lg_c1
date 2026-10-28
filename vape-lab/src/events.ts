import type { Product, SynergyId, TestResult } from './sim/types';

/**
 * Vape Lab emits plain events only. Nothing here writes to any outside runtime;
 * a host game can listen on window for 'vapelab' CustomEvents.
 */
export type LabEvent =
  | { type: 'product:changed'; product: Product }
  | { type: 'test:completed'; product: Product; result: TestResult }
  | { type: 'synergy:discovered'; synergyId: SynergyId }
  | { type: 'formula:saved'; product: Product }
  | { type: 'mode:changed'; mode: Mode };

export type Mode = 'manual' | 'assisted' | 'auto';

type Listener = (e: LabEvent) => void;
const listeners = new Set<Listener>();

export function on(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(e: LabEvent): void {
  for (const fn of listeners) fn(e);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('vapelab', { detail: e }));
}
