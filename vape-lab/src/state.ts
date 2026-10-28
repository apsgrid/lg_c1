import { GAME_DATA } from './data';
import { emit, type Mode } from './events';
import { newProduct, productId } from './sim';
import type { Product, SynergyId, TestResult } from './sim/types';
import { storage } from './store/storage';

export const data = GAME_DATA;

function newLineage(): string {
  return `L${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

const saved = storage.loadCurrent();

export const state = {
  product: saved?.product ?? starterProduct(),
  lineage: saved?.lineage ?? newLineage(),
  mode: 'manual' as Mode,
  discovered: storage.loadDiscovered(),
  lastResult: null as TestResult | null,
  previousResult: null as TestResult | null,
  busy: false,
};

function starterProduct(): Product {
  const p = newProduct(Math.floor(Math.random() * 1e9));
  p.notes = [{ noteId: 'strawberry', amount: 40 }];
  p.id = productId(p);
  return p;
}

type Sub = (reason: string) => void;
const subs = new Set<Sub>();
export function subscribe(fn: Sub): void {
  subs.add(fn);
}
function notify(reason: string): void {
  for (const fn of subs) fn(reason);
}

/** Apply a change to the working product. Recomputes the stable id and persists. */
export function update(fn: (p: Product) => void, reason = 'product'): void {
  const p = JSON.parse(JSON.stringify(state.product)) as Product;
  fn(p);
  p.notes = p.notes.slice(0, 4);
  p.id = productId(p);
  state.product = p;
  storage.saveCurrent(p, state.lineage);
  emit({ type: 'product:changed', product: p });
  notify(reason);
}

export function replaceProduct(p: Product, opts: { newLineage?: boolean; lineage?: string } = {}): void {
  if (opts.lineage) state.lineage = opts.lineage;
  else if (opts.newLineage) state.lineage = newLineage();
  state.lastResult = null;
  state.previousResult = null;
  update((d) => Object.assign(d, JSON.parse(JSON.stringify(p))), 'replace');
}

export function setMode(mode: Mode): void {
  state.mode = mode;
  emit({ type: 'mode:changed', mode });
  notify('mode');
}

export function recordResult(r: TestResult): SynergyId[] {
  state.previousResult = state.lastResult;
  state.lastResult = r;
  const fresh = r.newlyDiscovered.filter((s) => !state.discovered.includes(s));
  if (fresh.length) {
    state.discovered = [...state.discovered, ...fresh];
    storage.saveDiscovered(state.discovered);
    for (const s of fresh) emit({ type: 'synergy:discovered', synergyId: s });
  }
  storage.pushHistory(state.lineage, state.product, r);
  emit({ type: 'test:completed', product: state.product, result: r });
  notify('result');
  return fresh;
}

export function setBusy(b: boolean): void {
  state.busy = b;
  notify('busy');
}

export function notifyAll(reason: string): void {
  notify(reason);
}

export { newLineage };
